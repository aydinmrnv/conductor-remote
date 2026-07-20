import type {
	MergePrecheck,
	MergeResult,
	MessagesResponse,
	NewChatResult,
	SendResult,
	SessionsResponse,
	StateResponse,
	WorkspaceDiff
} from './types.ts'

const TOKEN_KEY = 'conductor-remote-token'

/** Pull a `#token=…` out of the URL on first load, persist it, and clean the hash. */
export function bootstrapToken(): string | null {
	const hash = new URLSearchParams(location.hash.slice(1))
	const fromHash = hash.get('token')
	if (fromHash) {
		localStorage.setItem(TOKEN_KEY, fromHash)
		history.replaceState(null, '', location.pathname + location.search)
	}
	return localStorage.getItem(TOKEN_KEY)
}

export function getToken(): string | null {
	return localStorage.getItem(TOKEN_KEY)
}

export function clearToken(): void {
	localStorage.removeItem(TOKEN_KEY)
}

/** Persist a token that arrived outside the URL flow (e.g. pasted into the TokenGate). */
export function setStoredToken(token: string): void {
	localStorage.setItem(TOKEN_KEY, token)
}

/** Accept a bare token or anything containing `token=…` (a full `/#token=` URL, say); null if neither. */
export function parseTokenInput(raw: string): string | null {
	const s = raw.trim()
	if (!s) return null
	const m = s.match(/token=([^&\s]+)/)
	if (m) return decodeURIComponent(m[1])
	return /\s/.test(s) ? null : s
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message)
	}
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
	const token = getToken()
	const res = await fetch(path, {
		...opts,
		headers: {
			authorization: `Bearer ${token ?? ''}`,
			'content-type': 'application/json',
			...opts.headers
		}
	})
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string }
		throw new ApiError(body.error || `HTTP ${res.status}`, res.status)
	}
	return res.json() as Promise<T>
}

export const client = {
	state: () => api<StateResponse>('/api/state'),
	/** Image URL for a repo's icon. `<img>` can't send the auth header, so carry the token as a query param. */
	repoIconUrl: (repoName: string) =>
		`/api/repos/${encodeURIComponent(repoName)}/icon?token=${encodeURIComponent(getToken() ?? '')}`,
	sessions: (workspaceId: string) =>
		api<SessionsResponse>(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`),
	messages: (sessionId: string, after: number) =>
		api<MessagesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messages?after=${after}`),
	diff: (workspaceId: string) => api<WorkspaceDiff>(`/api/workspaces/${encodeURIComponent(workspaceId)}/diff`),
	sendPrompt: (sessionId: string, text: string, workspaceId: string) =>
		api<SendResult>(`/api/sessions/${encodeURIComponent(sessionId)}/prompt`, {
			method: 'POST',
			body: JSON.stringify({ text, workspaceId })
		}),
	/** Open a new chat ("New chat, same files" / Cmd+T) in a workspace. */
	newChat: (workspaceId: string) =>
		api<NewChatResult>(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`, { method: 'POST' }),
	/** Can this workspace's branch merge into its base? (advisory, for the confirm sheet) */
	mergePrecheck: (workspaceId: string) =>
		api<MergePrecheck>(`/api/workspaces/${encodeURIComponent(workspaceId)}/merge`),
	/** Merge the workspace branch into its base — local `git merge`, like Conductor's button. */
	merge: (workspaceId: string) =>
		api<MergeResult>(`/api/workspaces/${encodeURIComponent(workspaceId)}/merge`, { method: 'POST' })
}
