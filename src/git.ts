import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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
}

const MAX_PATCH_BYTES = 400_000

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

	return { base: ref, mergeBase, files, patch, truncated }
}
