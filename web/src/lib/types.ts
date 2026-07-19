// Mirrors the relay's JSON responses (src/reads.ts, src/git.ts, src/writes.ts).

export interface Workspace {
	id: string
	directory_name: string | null
	workspace_name: string | null
	branch: string | null
	derived_status: string | null
	manual_status: string | null
	updated_at: string
	unread: number | null
	pinned_at: string | null
	active_session_id: string | null
	intended_target_branch: string | null
	repo_name: string | null
	session_status: string | null
	session_title: string | null
	model: string | null
	context_used_percent: number | null
}

export interface ActuatorInfo {
	name: string
	caveat: string
	precise: boolean
	available: boolean
}

export interface StateResponse {
	workspaces: Workspace[]
	actuator: ActuatorInfo
}

export type Role = 'user' | 'assistant' | 'tool' | 'thinking' | 'system'

export interface TranscriptEntry {
	id: string
	rowid: number
	role: Role
	text: string
	tool?: string
	ts: string
	queued: boolean
}

export interface MessagesResponse {
	entries: TranscriptEntry[]
	cursor: number
}

export interface DiffFile {
	path: string
	added: number
	removed: number
}

export interface WorkspaceDiff {
	base: string
	mergeBase: string | null
	files: DiffFile[]
	patch: string
	truncated: boolean
}

export interface SendResult {
	ok: boolean
	strategy: string
	warning?: string
	error?: string
}
