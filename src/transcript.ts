/**
 * Conductor stores each turn's raw Claude Code SDK stream JSON in
 * `session_messages.content`. User-typed prompts are stored as plain text.
 * This turns a row into compact, phone-renderable entries.
 *
 * Classification rule (verified against the whole DB): a JSON frame with
 * `type:"user"` is ALWAYS tool plumbing — every one of them carries
 * tool_result blocks, never the user's own words. Real prompts are the
 * plain-text rows. Never render an SDK user frame as a user bubble.
 */

export interface TranscriptEntry {
	id: string
	rowid: number
	/** Display role: user | assistant | tool | thinking | system */
	role: 'user' | 'assistant' | 'tool' | 'thinking' | 'system'
	/** Human-readable text. For tool rows: the call's description, else the tool name. */
	text: string
	/** Tool name when role === 'tool'. */
	tool?: string
	/** Mono secondary line for tool rows (command, path, pattern, …). */
	detail?: string
	/** True when this row is a failed tool result. */
	error?: boolean
	ts: string
	/** True when the message is queued but not yet sent (queue_order set, sent_at null). */
	queued: boolean
}

interface RawRow {
	rowid: number
	id: string
	role: string | null
	content: string | null
	full_message: string | null
	created_at: string
	sent_at: string | null
	queue_order: number | null
}

interface SdkBlock {
	type: string
	text?: string
	thinking?: string
	name?: string
	input?: unknown
	content?: unknown
	is_error?: boolean
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Make tool details repo-relative: absolute worktree paths waste the whole line on a phone. */
function stripWorktree(s: string, worktree: string | null): string {
	if (!worktree) return s
	// Conductor prefixes commands with `cd <worktree>` (newline- or &&-joined) — drop the whole clause.
	if (s.startsWith(`cd ${worktree}`)) s = s.slice(`cd ${worktree}`.length).replace(/^\s*(&&)?\s*/, '')
	return s.replaceAll(`${worktree}/`, '').replaceAll(worktree, '.')
}

/**
 * Mirror Conductor's one-line tool rows: the human description as the title
 * (Bash always has one), the primary input as a mono detail. Tools without a
 * recognizable primary input get the title alone — dumping raw JSON is noise.
 */
function summarizeToolUse(name: string, input: unknown, worktree: string | null): { text: string; detail?: string } {
	if (!input || typeof input !== 'object') return { text: name }
	const o = input as Record<string, unknown>
	const text = str(o.description) ?? name
	const detail =
		str(o.command) ?? str(o.file_path) ?? str(o.path) ?? str(o.pattern) ?? str(o.url) ?? str(o.skill) ?? str(o.prompt)
	if (!detail || detail === text) return { text }
	return { text, detail: clip(stripWorktree(detail, worktree).replace(/\s+/g, ' '), 160) }
}

function resultText(content: unknown): string {
	let s = ''
	if (typeof content === 'string') s = content
	else if (Array.isArray(content)) {
		s = content
			.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
			.join('')
	}
	return clip(s.replace(/<\/?tool_use_error>/g, '').trim(), 400)
}

export function parseMessage(row: RawRow, worktree: string | null = null): TranscriptEntry[] {
	const queued = row.queue_order !== null && row.sent_at === null
	const base = { rowid: row.rowid, ts: row.created_at, queued }
	const content = row.content ?? ''

	// Plain user prompt (not SDK JSON) — the only source of real user bubbles.
	if (!content.startsWith('{')) {
		if (!content.trim()) return []
		return [{ ...base, id: row.id, role: 'user', text: content }]
	}

	let parsed: { type?: string; subtype?: string; message?: { content?: SdkBlock[] } }
	try {
		parsed = JSON.parse(content)
	} catch {
		return [{ ...base, id: row.id, role: 'system', text: clip(content, 200) }]
	}

	// Bookkeeping frames: hooks, init, token accounting, end-of-turn results.
	if (parsed.type === 'system' || parsed.type === 'result') return []

	const blocks = parsed.message?.content
	if (!Array.isArray(blocks)) {
		if (parsed.type === 'user' || parsed.type === 'assistant') return []
		// Unknown frame shape — keep a dim raw dump so Conductor drift stays visible.
		return [{ ...base, id: row.id, role: 'system', text: clip(content, 200) }]
	}

	const entries: TranscriptEntry[] = []
	const push = (e: Pick<TranscriptEntry, 'role' | 'text'> & Partial<TranscriptEntry>) =>
		entries.push({ ...base, ...e, id: `${row.id}:${entries.length}` })

	let pending: string[] = []
	const flush = () => {
		const text = pending.join('\n').trim()
		if (text) push({ role: 'assistant', text })
		pending = []
	}

	for (const b of blocks) {
		if (b.type === 'text' && typeof b.text === 'string') {
			// Text inside an SDK user frame would be injected context, not the user.
			if (parsed.type !== 'user') pending.push(b.text)
		} else if (b.type === 'thinking') {
			flush()
			const text = str(b.thinking) ?? str(b.text)
			if (text) push({ role: 'thinking', text })
		} else if (b.type === 'tool_use' && typeof b.name === 'string') {
			flush()
			push({ role: 'tool', tool: b.name, ...summarizeToolUse(b.name, b.input, worktree) })
		} else if (b.type === 'tool_result' && b.is_error) {
			// Successful results are noise on a phone; surface only failures.
			flush()
			push({ role: 'tool', error: true, text: resultText(b.content) || '(tool error)' })
		}
	}
	flush()
	return entries
}
