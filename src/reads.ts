import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ConductorDb } from './db.ts'
import { describeRepoIcon, type RepoIcon, type ResolvedIcon, resolveRepoIcon } from './icons.ts'
import { parseMessage, type TranscriptEntry } from './transcript.ts'

export interface WorkspaceRow {
	id: string
	directory_name: string | null
	workspace_name: string | null
	branch: string | null
	derived_status: string | null
	manual_status: string | null
	created_at: string
	updated_at: string
	unread: number | null
	pinned_at: string | null
	active_session_id: string | null
	intended_target_branch: string | null
	repo_name: string | null
	repo_root: string | null
	repo_icon: string | null
	remote_url: string | null
	default_branch: string | null
	session_status: string | null
	session_title: string | null
	model: string | null
	context_used_percent: number | null
}

export interface SessionRow {
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

export interface Workspace extends WorkspaceRow {
	/** Absolute path to the git worktree on disk, or null if it can't be resolved. */
	worktree: string | null
	baseBranch: string
	/** How to render the repo's sidebar avatar; null → letter monogram. See `describeRepoIcon`. */
	icon: RepoIcon | null
}

const worktreeCache = new Map<string, string | null>()

/**
 * Resolve a workspace's worktree path. Conductor lays worktrees out as
 * `<workspacesRoot>/<repoName>/<directoryName>`, but we verify against
 * `git worktree list` (matched by branch) so a layout change can't silently
 * point us at the wrong tree.
 */
function resolveWorktree(
	workspacesRoot: string,
	repoName: string | null,
	directoryName: string | null,
	branch: string | null,
	repoRoot: string | null
): string | null {
	if (repoName && directoryName) {
		const guess = path.join(workspacesRoot, repoName, directoryName)
		if (fs.existsSync(path.join(guess, '.git'))) return guess
	}
	if (!(repoRoot && branch)) return null
	const cacheKey = repoRoot
	let listing = worktreeCache.get(cacheKey)
	if (listing === undefined) {
		try {
			listing = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
				encoding: 'utf8',
				timeout: 5000
			})
		} catch {
			listing = null
		}
		worktreeCache.set(cacheKey, listing)
	}
	if (!listing) return null
	// Porcelain: blocks of "worktree <path>" / "branch refs/heads/<name>"
	const blocks = listing.split('\n\n')
	for (const block of blocks) {
		if (block.includes(`refs/heads/${branch}`)) {
			const m = block.match(/^worktree (.+)$/m)
			if (m) return m[1]
		}
	}
	return null
}

export class Reads {
	private readonly db: ConductorDb
	private readonly workspacesRoot: string

	constructor(db: ConductorDb, workspacesRoot: string) {
		this.db = db
		this.workspacesRoot = workspacesRoot
	}

	listWorkspaces(): Workspace[] {
		const rows = this.db.query<WorkspaceRow>(
			`SELECT w.id, w.directory_name, w.workspace_name, w.branch, w.derived_status, w.manual_status,
			        w.created_at, w.updated_at, w.unread, w.pinned_at, w.active_session_id, w.intended_target_branch,
			        r.name AS repo_name, r.root_path AS repo_root, r.icon AS repo_icon,
			        r.remote_url AS remote_url, r.default_branch AS default_branch,
			        s.status AS session_status, s.title AS session_title, s.model AS model,
			        s.context_used_percent AS context_used_percent
			 FROM workspaces w
			 LEFT JOIN repos r ON r.id = w.repository_id
			 LEFT JOIN sessions s ON s.id = w.active_session_id
			 WHERE w.state = 'ready'
			 ORDER BY (w.pinned_at IS NULL), w.updated_at DESC`
		)
		return rows.map(r => ({
			...r,
			worktree: resolveWorktree(this.workspacesRoot, r.repo_name, r.directory_name, r.branch, r.repo_root),
			baseBranch: r.intended_target_branch || r.default_branch || 'main',
			icon: describeRepoIcon({ icon: r.repo_icon, repoRoot: r.repo_root, remoteUrl: r.remote_url })
		}))
	}

	getWorkspace(id: string): Workspace | null {
		return this.listWorkspaces().find(w => w.id === id) ?? null
	}

	/** Resolve a repo's icon by its name (the sidebar avatar) — null if the repo or icon is unknown. */
	resolveRepoIcon(repoName: string): ResolvedIcon | null {
		const rows = this.db.query<{ root_path: string | null }>('SELECT root_path FROM repos WHERE name = ? LIMIT 1', [
			repoName
		])
		const root = rows[0]?.root_path
		return root ? resolveRepoIcon(root) : null
	}

	listSessions(workspaceId: string): SessionRow[] {
		// created_at ASC keeps tab order stable (matches the desktop app) instead of jumping on activity.
		return this.db.query<SessionRow>(
			`SELECT id, status, title, model, permission_mode, context_used_percent, unread_count,
			        created_at, updated_at, last_user_message_at
			 FROM sessions
			 WHERE workspace_id = ? AND COALESCE(is_hidden, 0) = 0
			 ORDER BY created_at ASC`,
			[workspaceId]
		)
	}

	/** Incremental transcript fetch. `afterRowid` is the cursor from a prior call. */
	getMessages(sessionId: string, afterRowid = 0): { entries: TranscriptEntry[]; cursor: number } {
		const rows = this.db.query<{
			rowid: number
			id: string
			role: string | null
			content: string | null
			full_message: string | null
			created_at: string
			sent_at: string | null
			queue_order: number | null
		}>(
			`SELECT rowid, id, role, content, full_message, created_at, sent_at, queue_order
			 FROM session_messages
			 WHERE session_id = ? AND rowid > ?
			 ORDER BY rowid ASC`,
			[sessionId, afterRowid]
		)
		const entries: TranscriptEntry[] = []
		let cursor = afterRowid
		for (const row of rows) {
			cursor = row.rowid
			const entry = parseMessage(row)
			if (entry) entries.push(entry)
		}
		return { entries, cursor }
	}
}
