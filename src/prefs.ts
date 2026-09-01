/**
 * Device-independent PWA state, durable on the host Mac.
 *
 * localStorage remains the live, offline-first copy. This store is the sync peer that
 * survives a PWA origin change and lets another phone or browser pick up where the first
 * stopped. It deliberately does not contain the access token, pending HTTP requests, or
 * other device-scoped state.
 */
import fs from 'node:fs'
import path from 'node:path'
import { stateDir } from './config.ts'
import type { ParkedAgentPatch } from './parked.ts'

export interface SyncedDraft {
	/** Empty is valid when agent settings have been staged before any text is typed. */
	text: string
	/** Text and its next-send agent choices are one intent and therefore one revision. */
	agent: ParkedAgentPatch
	/** Client-side logical timestamp. Newer revisions win; deletion wins an exact tie. */
	updatedAt: number
	/** Kept as a tombstone so an offline device cannot restore an already-sent draft. */
	deleted: boolean
}

export interface Prefs {
	/** Session `updated_at` values. A mark can only advance, so these merge by max. */
	readMarks: Record<string, string>
	drafts: Record<string, SyncedDraft>
}

export type PrefsPatch = Partial<Prefs>

const MAX_KEYS = 50_000
const MAX_KEY_LENGTH = 256
const MAX_MARK_LENGTH = 128
const MAX_DRAFT_LENGTH = 1_000_000
const MAX_AGENT_LABEL_LENGTH = 256

function object(raw: unknown): Record<string, unknown> | null {
	return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function validKey(key: string): boolean {
	return key.length > 0 && key.length <= MAX_KEY_LENGTH
}

function sanitizeAgent(raw: unknown): ParkedAgentPatch {
	const value = object(raw)
	if (!value) return {}
	const agent: ParkedAgentPatch = {}
	if (typeof value.model === 'string' && value.model.length <= MAX_AGENT_LABEL_LENGTH) agent.model = value.model
	if (typeof value.effort === 'string' && value.effort.length <= MAX_AGENT_LABEL_LENGTH) agent.effort = value.effort
	if (typeof value.plan === 'boolean') agent.plan = value.plan
	if (typeof value.fast === 'boolean') agent.fast = value.fast
	return agent
}

function sanitizeReadMarks(raw: unknown): Record<string, string> {
	const value = object(raw)
	if (!value) return {}
	const entries = Object.entries(value)
		.filter((entry): entry is [string, string] => {
			const [key, mark] = entry
			return validKey(key) && typeof mark === 'string' && mark.length > 0 && mark.length <= MAX_MARK_LENGTH
		})
		.sort((a, b) => b[1].localeCompare(a[1]))
		.slice(0, MAX_KEYS)
	return Object.fromEntries(entries)
}

function sanitizeDraft(raw: unknown): SyncedDraft | null {
	const value = object(raw)
	if (!value) return null
	const updatedAt = Number(value.updatedAt)
	if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) return null
	const deleted = value.deleted === true
	if (deleted) return { text: '', agent: {}, updatedAt, deleted: true }
	if (typeof value.text !== 'string' || value.text.length > MAX_DRAFT_LENGTH) return null
	return { text: value.text, agent: sanitizeAgent(value.agent), updatedAt, deleted: false }
}

function sanitizeDrafts(raw: unknown): Record<string, SyncedDraft> {
	const value = object(raw)
	if (!value) return {}
	const entries: [string, SyncedDraft][] = []
	for (const [key, candidate] of Object.entries(value)) {
		if (!validKey(key)) continue
		const draft = sanitizeDraft(candidate)
		if (draft) entries.push([key, draft])
	}
	entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
	return Object.fromEntries(entries.slice(0, MAX_KEYS))
}

function sanitize(raw: unknown): Prefs {
	const value = object(raw)
	return {
		readMarks: sanitizeReadMarks(value?.readMarks),
		drafts: sanitizeDrafts(value?.drafts)
	}
}

function sameDraft(a: SyncedDraft, b: SyncedDraft): boolean {
	return (
		a.text === b.text &&
		a.updatedAt === b.updatedAt &&
		a.deleted === b.deleted &&
		a.agent.model === b.agent.model &&
		a.agent.effort === b.agent.effort &&
		a.agent.plan === b.agent.plan &&
		a.agent.fast === b.agent.fast
	)
}

/** Cached, single-process JSON store. A custom file keeps its merge rules easy to test. */
export class PrefsStore {
	private readonly file: string
	private cache: Prefs | null = null

	constructor(file = path.join(stateDir(), 'prefs.json')) {
		this.file = file
	}

	read(): Prefs {
		if (this.cache) return this.cache
		try {
			this.cache = sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8')))
		} catch {
			this.cache = { readMarks: {}, drafts: {} }
		}
		return this.cache
	}

	/** Merge a client snapshot. Marks take max; draft revisions use LWW with deletion winning a tie. */
	patch(raw: unknown): Prefs {
		const input = object(raw)
		if (!input) return this.read()
		const current = this.read()
		const next: Prefs = { readMarks: { ...current.readMarks }, drafts: { ...current.drafts } }
		let changed = false

		if (Object.hasOwn(input, 'readMarks')) {
			for (const [key, mark] of Object.entries(sanitizeReadMarks(input.readMarks))) {
				if ((next.readMarks[key] ?? '') >= mark) continue
				next.readMarks[key] = mark
				changed = true
			}
		}

		if (Object.hasOwn(input, 'drafts')) {
			for (const [key, draft] of Object.entries(sanitizeDrafts(input.drafts))) {
				const previous = next.drafts[key]
				const wins =
					!previous ||
					draft.updatedAt > previous.updatedAt ||
					(draft.updatedAt === previous.updatedAt && draft.deleted && !previous.deleted)
				if (!wins || (previous && sameDraft(previous, draft))) continue
				next.drafts[key] = draft
				changed = true
			}
		}

		if (!changed) return current
		this.persist(next)
		this.cache = next
		return next
	}

	private persist(prefs: Prefs): void {
		const dir = path.dirname(this.file)
		const temporary = `${this.file}.${process.pid}.tmp`
		try {
			fs.mkdirSync(dir, { recursive: true })
			fs.writeFileSync(temporary, `${JSON.stringify(prefs, null, '\t')}\n`, { mode: 0o600 })
			fs.renameSync(temporary, this.file)
		} catch (err) {
			try {
				fs.unlinkSync(temporary)
			} catch {}
			console.warn(`⚠ could not persist synced preferences (${err instanceof Error ? err.message : err})`)
		}
	}
}

const store = new PrefsStore()

export function readPrefs(): Prefs {
	return store.read()
}

export function writePrefs(patch: PrefsPatch): Prefs {
	return store.patch(patch)
}
