import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Workspace } from './reads.ts'

const exec = promisify(execFile)

/**
 * Merging a workspace is a plain `git` operation on the checkout — the same
 * durable, Conductor-uncoupled category as reads (`git.ts`), *not* the fragile
 * prompt-write nerve (`writes.ts`). It faithfully mirrors Conductor's own merge
 * button, which recon shows is a **local** merge into the base branch checked out
 * in the repo's primary worktree (`repos.root_path`) — a real merge commit
 * ("Merge made by the 'ort' strategy" in the reflog), no squash, and no push
 * (`archive_on_merge` defaults false). We do exactly that, and never anything
 * more destructive: preconditions are enforced (refuse rather than force), a
 * conflicting merge is aborted so the checkout is left clean.
 */

/** Why a merge is blocked (or `ok`). Machine-readable so the PWA can explain it. */
export type MergeReason =
	| 'ok'
	| 'no-branch'
	| 'no-repo'
	| 'not-on-base'
	| 'dirty-base'
	| 'nothing-to-merge'
	| 'conflicts'
	| 'error'

export interface MergePrecheck {
	/** Local base branch the merge targets (workspace's intended target / repo default). */
	base: string
	branch: string
	canMerge: boolean
	reason: MergeReason
	/** Human-readable elaboration when blocked. */
	detail?: string
	/** Commits on `branch` not yet in `base`. */
	ahead: number
	/** Uncommitted changes in the workspace worktree — a merge of committed history won't include them (advisory). */
	uncommitted: number
	/** Branch currently checked out in the primary repo, when it isn't `base` (drives the `not-on-base` message). */
	headBranch?: string
}

export interface MergeResult {
	ok: boolean
	base: string
	branch: string
	/** git's summary on success (e.g. "Merge made by the 'ort' strategy." or "Fast-forward"). */
	summary?: string
	error?: string
	reason?: MergeReason
}

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await exec('git', ['-C', cwd, ...args], {
		encoding: 'utf8',
		maxBuffer: 8 * 1024 * 1024,
		timeout: 20_000
	})
	return stdout
}

/** Count of uncommitted (tracked + untracked) entries in a checkout. */
async function countDirty(cwd: string): Promise<number> {
	const out = await git(cwd, ['status', '--porcelain']).catch(() => '')
	return out.split('\n').filter(Boolean).length
}

/** Commits on `branch` not reachable from `base`. */
async function countAhead(root: string, base: string, branch: string): Promise<number> {
	const out = await git(root, ['rev-list', '--count', `${base}..${branch}`]).catch(() => '0')
	const n = Number(out.trim())
	return Number.isFinite(n) ? n : 0
}

/**
 * Would `git merge <branch>` into `base` conflict? `merge-tree --write-tree`
 * merges in memory (touches nothing) and exits 1 on conflict, 0 when clean. Any
 * other failure → treat as non-conflicting (the real merge will surface it).
 */
async function wouldConflict(root: string, base: string, branch: string): Promise<boolean> {
	try {
		await git(root, ['merge-tree', '--write-tree', base, branch])
		return false
	} catch (err) {
		return (err as { code?: number }).code === 1
	}
}

/**
 * Everything the POST needs to know before merging — also served to the PWA so
 * the confirm sheet can show the target, commit count, and any blocker up front.
 */
export async function mergePrecheck(ws: Workspace): Promise<MergePrecheck> {
	const branch = ws.branch ?? ''
	const base = ws.baseBranch
	const root = ws.repo_root
	const block = (reason: MergeReason, detail: string, extra: Partial<MergePrecheck> = {}): MergePrecheck => ({
		base,
		branch,
		canMerge: false,
		reason,
		detail,
		ahead: 0,
		uncommitted: 0,
		...extra
	})
	if (!branch) return block('no-branch', 'workspace has no branch')
	if (!root) return block('no-repo', 'repo root unresolved')

	const uncommitted = ws.worktree ? await countDirty(ws.worktree) : 0
	// The primary checkout must be on the base branch — we never switch Conductor's
	// checkout out from under it; refuse and tell the user to check it out instead.
	const head = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim()
	if (head && head !== base)
		return block('not-on-base', `the ${ws.repo_name ?? 'repo'} checkout is on '${head}', not '${base}'`, {
			uncommitted,
			headBranch: head
		})
	if (await countDirty(root))
		return block('dirty-base', `the '${base}' checkout has uncommitted changes`, { uncommitted })

	const ahead = await countAhead(root, base, branch)
	if (ahead === 0) return block('nothing-to-merge', `nothing new to merge into '${base}'`, { uncommitted })
	if (await wouldConflict(root, base, branch))
		return {
			base,
			branch,
			canMerge: false,
			reason: 'conflicts',
			detail: `merging into '${base}' would conflict`,
			ahead,
			uncommitted
		}

	return { base, branch, canMerge: true, reason: 'ok', ahead, uncommitted }
}

/**
 * Perform the merge, faithful to Conductor: a local `git merge --no-edit <branch>`
 * into the base branch in the primary checkout. Re-runs the precheck as the
 * authoritative gate (the PWA's copy is advisory and may be stale), and aborts a
 * conflicting merge so the checkout is never left half-merged.
 */
export async function mergeWorkspace(ws: Workspace): Promise<MergeResult> {
	const pre = await mergePrecheck(ws)
	if (!pre.canMerge) return { ok: false, base: pre.base, branch: pre.branch, error: pre.detail, reason: pre.reason }
	const root = ws.repo_root as string
	try {
		const summary = await git(root, ['merge', '--no-edit', pre.branch])
		return { ok: true, base: pre.base, branch: pre.branch, summary: summary.trim() }
	} catch (err) {
		const stderr = (err as { stderr?: string }).stderr
		const message = (stderr || (err instanceof Error ? err.message : String(err))).trim()
		const conflicted = /conflict/i.test(message)
		// Leave the primary checkout clean rather than stuck mid-merge.
		if (conflicted) await git(root, ['merge', '--abort']).catch(() => undefined)
		return {
			ok: false,
			base: pre.base,
			branch: pre.branch,
			error: message,
			reason: conflicted ? 'conflicts' : 'error'
		}
	}
}
