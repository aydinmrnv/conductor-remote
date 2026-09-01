import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isPreviewableSource } from './shared.ts'

const exec = promisify(execFile)

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
	/** Uncommitted changes in the worktree (drives the "Commit & push" action). */
	dirty: boolean
	/** Commits on HEAD not yet on the remote-tracking branch (also drives "Commit & push"). */
	unpushed: boolean
}

const MAX_PATCH_BYTES = 400_000
const MAX_LISTED_FILES = 20_000

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await exec('git', ['-C', cwd, ...args], {
		encoding: 'utf8',
		maxBuffer: 8 * 1024 * 1024,
		timeout: 15000
	})
	return stdout
}

/**
 * Patch for untracked files. `git diff` ignores them, but a reviewer wants to
 * see new files — so we synthesize a "new file" diff via `--no-index` against
 * /dev/null. This never touches the index (no `add -N`), so the live worktree
 * the agent is using is left untouched.
 */
async function untrackedDiff(cwd: string): Promise<{ files: DiffFile[]; patch: string }> {
	let listing = ''
	try {
		listing = await git(cwd, ['ls-files', '--others', '--exclude-standard'])
	} catch {
		return { files: [], patch: '' }
	}
	const paths = listing.split('\n').filter(Boolean)
	const files: DiffFile[] = []
	const patches: string[] = []
	for (const p of paths) {
		try {
			// --no-index exits 1 when files differ, so read stdout from the error.
			await exec('git', ['-C', cwd, 'diff', '--no-index', '--no-color', '--', '/dev/null', p], {
				encoding: 'utf8',
				maxBuffer: 4 * 1024 * 1024,
				timeout: 10000
			})
		} catch (err) {
			const out = (err as { stdout?: string }).stdout ?? ''
			if (!out) continue
			const added = out.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length
			files.push({ path: p, added, removed: 0 })
			patches.push(out)
		}
	}
	return { files, patch: patches.join('') }
}

/** Resolve the base ref, preferring the remote-tracking form if it exists. */
async function resolveBase(cwd: string, base: string): Promise<string> {
	for (const ref of [`origin/${base}`, base]) {
		try {
			await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
			return ref
		} catch {
			// try next
		}
	}
	return base
}

/**
 * Everything the workspace changed relative to its target branch — committed
 * plus uncommitted — which is what a reviewer wants to see. Computed straight
 * from the worktree, so it's independent of Conductor entirely.
 */
export async function workspaceDiff(worktree: string, base: string): Promise<WorkspaceDiff> {
	const ref = await resolveBase(worktree, base)
	let mergeBase: string | null = null
	try {
		mergeBase = (await git(worktree, ['merge-base', ref, 'HEAD'])).trim()
	} catch {
		mergeBase = null
	}
	const against = mergeBase ?? ref

	const numstat = await git(worktree, ['diff', '--numstat', against]).catch(() => '')
	const files: DiffFile[] = numstat
		.split('\n')
		.filter(Boolean)
		.map(line => {
			const [added, removed, ...rest] = line.split('\t')
			return {
				path: rest.join('\t'),
				added: added === '-' ? 0 : Number(added),
				removed: removed === '-' ? 0 : Number(removed)
			}
		})

	const trackedPatch = await git(worktree, ['diff', against]).catch(() => '')
	const untracked = await untrackedDiff(worktree)
	files.push(...untracked.files)

	let patch = trackedPatch + untracked.patch
	const truncated = patch.length > MAX_PATCH_BYTES
	if (truncated) patch = `${patch.slice(0, MAX_PATCH_BYTES)}\n\n… diff truncated (${patch.length} bytes) …`

	const { dirty, unpushed } = await localState(worktree)

	return { base: ref, mergeBase, files, patch, truncated, dirty, unpushed }
}

/**
 * Local publish state of the worktree: does it have uncommitted changes, and are
 * there commits not yet on its remote-tracking branch? Together these drive the
 * bar's "Commit & push" action (you must land local work before a PR reflects it).
 */
async function localState(worktree: string): Promise<{ dirty: boolean; unpushed: boolean }> {
	const status = await git(worktree, ['status', '--porcelain']).catch(() => '')
	const dirty = status.trim() !== ''
	let unpushed = false
	try {
		// `@{upstream}` throws when no upstream is configured — then there's nothing to compare against.
		const count = (await git(worktree, ['rev-list', '--count', '@{upstream}..HEAD'])).trim()
		unpushed = Number(count) > 0
	} catch {
		unpushed = false
	}
	return { dirty, unpushed }
}

/**
 * Every file in the worktree the phone may turn a chat mention into a link for.
 *
 * Agents name files in prose all day — "updated `tests/foo.ts`" — and the phone
 * links a mention only when it matches a real file, so this is the list it matches
 * against. Tracked plus untracked-not-ignored: an agent that just wrote a file
 * names it in the same message, long before anything commits it.
 *
 * Two things keep the payload small. Only previewable extensions ship, because
 * `/api/files` refuses everything else anyway, and 20,000 paths is the ceiling — a
 * repo whose build output isn't ignored would otherwise send its whole `node_modules`
 * to a phone. `-z`, because a path may legally contain a newline.
 */
export async function listSourceFiles(worktree: string): Promise<{ files: string[]; truncated: boolean }> {
	let listing = ''
	try {
		listing = await git(worktree, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
	} catch {
		return { files: [], truncated: false }
	}
	const files = listing.split('\0').filter(p => p !== '' && isPreviewableSource(p))
	return { files: files.slice(0, MAX_LISTED_FILES), truncated: files.length > MAX_LISTED_FILES }
}
