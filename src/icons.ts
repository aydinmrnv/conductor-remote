import fs from 'node:fs'
import path from 'node:path'

/**
 * Repo-icon resolution, mirroring Conductor's own logic so the phone sidebar shows
 * the same avatar as the desktop app. Conductor looks for a known icon filename in
 * the repository root and uses the first match — see
 * https://www.conductor.build/docs/faq#where-does-conductor-get-the-repo-icon
 *
 * This reads from the repo's root checkout (the shared, canonical tree), not a
 * per-workspace worktree, so every workspace of a repo resolves to one icon.
 */
const ICON_CANDIDATES = [
	'public/apple-touch-icon.png',
	'apple-touch-icon.png',
	'public/favicon.svg',
	'favicon.svg',
	'public/favicon.png',
	'public/icon.png',
	'public/logo.png',
	'favicon.png',
	'app/icon.png',
	'src/app/icon.png',
	'public/favicon.ico',
	'favicon.ico',
	'app/favicon.ico',
	'static/favicon.ico',
	'src-tauri/icons/icon.png',
	'assets/icon.png',
	'src/assets/icon.png'
]

const CONTENT_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon'
}

export interface ResolvedIcon {
	/** Absolute path to the icon file on disk. */
	path: string
	contentType: string
}

// Icons rarely change; a short TTL keeps the 2.5s state poll from stat-storming the
// disk while still picking up a freshly-added icon within a tick or two.
const TTL_MS = 30_000
const cache = new Map<string, { at: number; icon: ResolvedIcon | null }>()

/** First matching icon under `repoRoot`, or null if the repo has none. Cached per root. */
export function resolveRepoIcon(repoRoot: string): ResolvedIcon | null {
	const now = Date.now()
	const hit = cache.get(repoRoot)
	if (hit && now - hit.at < TTL_MS) return hit.icon

	let icon: ResolvedIcon | null = null
	for (const rel of ICON_CANDIDATES) {
		const abs = path.join(repoRoot, rel)
		if (fs.existsSync(abs)) {
			icon = { path: abs, contentType: CONTENT_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' }
			break
		}
	}
	cache.set(repoRoot, { at: now, icon })
	return icon
}
