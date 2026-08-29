import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PrStatus, Workspace } from './reads.ts'

const exec = promisify(execFile)

/**
 * The one place this relay reaches outside the local box: GitHub PR state, which
 * `draft`/`merged` are facts of and have no local signal. It's deliberately kept
 * *soft* so the "reads are uncoupled and durable" rule still mostly holds:
 *   - `/api/state` never awaits GitHub. `attachPrStatus` is synchronous — it only
 *     reads the caches below and colours from whatever's there, kicking stale
 *     entries off to refresh in the background (like the icon resolver).
 *   - `conflicts` vs `mergeable` is computed **locally** with `git merge-tree`,
 *     not GitHub's lazily-computed (and usually `UNKNOWN`) `mergeable` field.
 *   - Any failure (no `gh`, unauthenticated, not a GitHub remote) degrades to
 *     `pr_status = null` → the PWA shows the default blue dot. Nothing breaks.
 */

interface GhPr {
	headRefName: string
	number: number
	url: string
	state: 'OPEN' | 'CLOSED' | 'MERGED'
	isDraft: boolean
	updatedAt: string
	statusCheckRollup?: Array<{ conclusion?: string | null; state?: string | null }> | null
}

const REPO_TTL = 60_000
const CONFLICT_TTL = 30_000

// Resolved PR map per repo root (null = gh unavailable / not a GitHub repo).
const repoCache = new Map<string, { at: number; prs: Map<string, GhPr> | null }>()
const repoInflight = new Set<string>()
// Local merge-conflict verdict per worktree.
const conflictCache = new Map<string, { at: number; conflicts: boolean }>()
const conflictInflight = new Set<string>()

/**
 * Colour every workspace's `pr_status` from cache and schedule background
 * refreshes for anything stale. Synchronous by design: the state endpoint must
 * not block on (or be taken down by) GitHub.
 */
export function attachPrStatus(workspaces: Workspace[]): void {
	const now = Date.now()
	const repos = new Set<string>()
	for (const w of workspaces) {
		w.pr_status = null
		w.pr_number = null
		w.pr_url = null
		if (!w.branch || !w.repo_root) continue
		repos.add(w.repo_root)
		const pr = repoCache.get(w.repo_root)?.prs?.get(w.branch)
		if (!pr) continue
		w.pr_number = pr.number
		w.pr_url = pr.url
		if (pr.state === 'MERGED') w.pr_status = 'merged'
		else if (pr.state === 'OPEN') {
			if (pr.isDraft) w.pr_status = 'draft'
			else {
				const c = w.worktree ? conflictCache.get(w.worktree) : undefined
				// Optimistically green until the local merge check says otherwise (self-corrects within CONFLICT_TTL).
				w.pr_status = c?.conflicts ? 'conflicts' : hasFailedChecks(pr.statusCheckRollup) ? 'checks_failed' : 'mergeable'
				if (w.worktree && (!c || now - c.at > CONFLICT_TTL)) refreshConflict(w.worktree, w.baseBranch)
			}
		}
		// CLOSED-but-not-merged stays null (neutral) — no colour claimed.
	}
	for (const root of repos) {
		const c = repoCache.get(root)
		if (!c || now - c.at > REPO_TTL) refreshRepo(root)
	}
}

function refreshRepo(root: string): void {
	if (repoInflight.has(root)) return
	repoInflight.add(root)
	fetchRepoPRs(root)
		.then(prs => repoCache.set(root, { at: Date.now(), prs }))
		.finally(() => repoInflight.delete(root))
}

/** One `gh` call per repo → its PRs keyed by head branch. Never rejects. */
async function fetchRepoPRs(root: string): Promise<Map<string, GhPr> | null> {
	try {
		const { stdout } = await exec(
			'gh',
			[
				'pr',
				'list',
				'--state',
				'all',
				'--limit',
				'100',
				'--json',
				'headRefName,number,url,state,isDraft,updatedAt,statusCheckRollup'
			],
			{ cwd: root, encoding: 'utf8', timeout: 15_000 }
		)
		const list = JSON.parse(stdout) as GhPr[]
		// Oldest first so the newest PR wins when a branch has been reused across PRs.
		list.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
		const map = new Map<string, GhPr>()
		for (const pr of list) map.set(pr.headRefName, pr)
		return map
	} catch {
		return null
	}
}

const FAILED_CHECK_CONCLUSIONS = new Set([
	'ACTION_REQUIRED',
	'CANCELLED',
	'FAILURE',
	'STALE',
	'STARTUP_FAILURE',
	'TIMED_OUT'
])
const FAILED_CHECK_STATES = new Set(['ERROR', 'FAILURE'])

/**
 * Check runs carry their terminal result in `conclusion`; legacy status contexts
 * use `state`. Pending checks remain green because this marker calls out failures.
 */
export function hasFailedChecks(checks: GhPr['statusCheckRollup']): boolean {
	return !!checks?.some(
		check =>
			(check.conclusion && FAILED_CHECK_CONCLUSIONS.has(check.conclusion)) ||
			(check.state && FAILED_CHECK_STATES.has(check.state))
	)
}

function refreshConflict(worktree: string, base: string): void {
	if (conflictInflight.has(worktree)) return
	conflictInflight.add(worktree)
	computeConflicts(worktree, base)
		.then(conflicts => conflictCache.set(worktree, { at: Date.now(), conflicts }))
		.finally(() => conflictInflight.delete(worktree))
}

/**
 * Would merging this worktree into its base conflict? `git merge-tree
 * --write-tree` performs the merge in memory (never touches the worktree or
 * index) and exits 1 on conflict, 0 when clean. Any other failure → not a
 * conflict (fall back to mergeable rather than cry wolf).
 */
async function computeConflicts(worktree: string, base: string): Promise<boolean> {
	let ref = base
	for (const candidate of [`origin/${base}`, base]) {
		try {
			await exec('git', ['-C', worktree, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], {
				encoding: 'utf8'
			})
			ref = candidate
			break
		} catch {
			// try next
		}
	}
	try {
		await exec('git', ['-C', worktree, 'merge-tree', '--write-tree', ref, 'HEAD'], {
			encoding: 'utf8',
			timeout: 15_000
		})
		return false
	} catch (err) {
		return (err as { code?: number }).code === 1
	}
}

export type { PrStatus }
