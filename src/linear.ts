import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stateDir } from './config.ts'

/**
 * Linear, for "Create from a Linear issue" on the phone.
 *
 * Conductor keeps its own Linear connection private, so the relay needs a key of its
 * own to *list* issues — creating from one still goes through Conductor's `linear_id`
 * deep link and needs nothing here. The key is a personal API key (Linear ▸ Settings ▸
 * Security & access), entered once from the phone's Settings and kept in
 * `stateDir()/linear.json` at 0600, or supplied as `LINEAR_API_KEY` in the environment.
 */

export interface LinearIssue {
	id: string
	/** `ENG-123` — what the deep link takes. */
	identifier: string
	title: string
	url: string
	state: string
	/** backlog | unstarted | started | completed | canceled | triage */
	stateType: string
	team: string | null
	project: string | null
	priority: number
	updatedAt: string
}

interface LinearViewerIssues {
	data?: {
		viewer?: {
			name?: string
			assignedIssues?: { nodes?: LinearIssueNode[] }
		}
	}
	errors?: Array<{ message: string }>
}

interface LinearIssueNode {
	id: string
	identifier: string
	title: string
	url: string
	priority?: number
	updatedAt: string
	state?: { name?: string; type?: string } | null
	team?: { key?: string } | null
	project?: { name?: string } | null
}

const KEY_FILE = () => path.join(stateDir(), 'linear.json')

export function linearApiKey(): string | null {
	const env = process.env.LINEAR_API_KEY?.trim()
	if (env) return env
	try {
		const raw = JSON.parse(readFileSync(KEY_FILE(), 'utf8')) as { apiKey?: string }
		return raw.apiKey?.trim() || null
	} catch {
		return null
	}
}

/** Store (or, with null, forget) the key. Owner-only on disk, like push.json. */
export function saveLinearApiKey(apiKey: string | null): void {
	const file = KEY_FILE()
	if (!apiKey?.trim()) {
		if (existsSync(file)) unlinkSync(file)
		return
	}
	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, JSON.stringify({ apiKey: apiKey.trim() }), { mode: 0o600 })
	chmodSync(file, 0o600)
}

const QUERY = `query SidecarIssues {
  viewer {
    name
    assignedIssues(first: 60, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
      nodes { id identifier title url priority updatedAt state { name type } team { key } project { name } }
    }
  }
}`

/** The GraphQL reply as the phone lists it, open issues only, most recently touched first. */
export function issuesFromReply(reply: LinearViewerIssues): { viewer: string | null; issues: LinearIssue[] } {
	if (reply.errors?.length) throw new Error(reply.errors.map(e => e.message).join('; '))
	const nodes = reply.data?.viewer?.assignedIssues?.nodes ?? []
	const issues = nodes
		.map(n => ({
			id: n.id,
			identifier: n.identifier,
			title: n.title,
			url: n.url,
			state: n.state?.name ?? '',
			stateType: n.state?.type ?? '',
			team: n.team?.key ?? null,
			project: n.project?.name ?? null,
			priority: n.priority ?? 0,
			updatedAt: n.updatedAt
		}))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
	return { viewer: reply.data?.viewer?.name ?? null, issues }
}

/** Issues assigned to the key's user. Throws with Linear's own wording on a bad key. */
export async function listAssignedIssues(apiKey: string): Promise<{ viewer: string | null; issues: LinearIssue[] }> {
	const res = await fetch('https://api.linear.app/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: apiKey },
		body: JSON.stringify({ query: QUERY }),
		signal: AbortSignal.timeout(20_000)
	})
	if (res.status === 401 || res.status === 403) throw new Error('Linear rejected the API key')
	if (!res.ok) throw new Error(`Linear answered HTTP ${res.status}`)
	return issuesFromReply((await res.json()) as LinearViewerIssues)
}
