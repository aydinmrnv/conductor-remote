// Mirrors the relay's JSON responses (src/reads.ts, src/git.ts, src/writes.ts).

/**
 * How to render a repo's sidebar avatar (mirrors `RepoIcon` in src/icons.ts).
 * `emoji`/`named` render inline; `file` is fetched from `/api/repos/:name/icon`;
 * `github` loads `github.com/<owner>.png`. Null → letter monogram.
 */
export type RepoIcon =
	| { kind: 'emoji'; value: string }
	| { kind: 'named'; value: string }
	| { kind: 'file' }
	| { kind: 'github'; owner: string }

export interface Workspace {
	id: string
	directory_name: string | null
	workspace_name: string | null
	branch: string | null
	/** Conductor's cached PR title; present iff the workspace has a PR (in-review/done). */
	pr_title: string | null
	derived_status: string | null
	manual_status: string | null
	created_at: string
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
	/** How to render the repo's sidebar avatar; null → letter monogram. */
	icon: RepoIcon | null
}

export interface ActuatorInfo {
	name: string
	caveat: string
	precise: boolean
	available: boolean
}

export interface UpdateStatus {
	current: string
	latest: string | null
	available: boolean
	checkedAt: number | null
	mode: 'off' | 'check' | 'auto'
	lastError: string | null
}

export interface StateResponse {
	workspaces: Workspace[]
	actuator: ActuatorInfo
	/** Relay version this daemon is running. */
	version?: string
	/** Self-update state (see src/autoupdate.ts). */
	update?: UpdateStatus
}

export interface Session {
	id: string
	status: string | null
	title: string | null
	model: string | null
	permission_mode: string | null
	context_used_percent: number | null
	unread_count: number | null
	created_at: string
	updated_at: string
	last_user_message_at: string | null
}

export interface SessionsResponse {
	sessions: Session[]
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

export interface NewChatResult {
	ok: boolean
	/** Id of the freshly-created session, if the relay detected it in time. */
	sessionId?: string | null
	error?: string
}
