/**
 * Self-update for the globally-installed relay daemon.
 *
 * The relay ships as a global npm package driven by a KeepAlive LaunchAgent. Without this, staying
 * current means the user manually re-running `npm i -g conductor-remote && conductor-remote service
 * install`. Here the running daemon periodically asks the npm registry for the latest published
 * version and, when it's newer, runs `npm i -g conductor-remote@latest` and exits — launchd's
 * KeepAlive restarts it into the freshly-installed code (the plist's baked `bin/cli.js` path is stable
 * across a global reinstall, so no re-`service install` is needed).
 *
 * Beyond that 6h registry poll, a cheap local check reconciles a disk↔process version skew: if the
 * installed package.json on disk no longer matches the version this process booted as — an out-of-band
 * `npm i -g`/deploy swapped the global install underneath us — it exit()→restarts to load it. Without
 * this, a stale backend keeps serving the newer frontend from disk (the API contract drifts, e.g. the
 * `icon` field vanishes and every repo avatar falls to a monogram) until the next npm poll happens to
 * find a version newer than the *running* one — which it never will if disk was bumped out-of-band.
 *
 * Two hard gates keep this from firing where it shouldn't:
 *   - CONDUCTOR_REMOTE_MANAGED=1 — set only by `service install` in the plist, so it proves we are the
 *     launchd-managed daemon and that exit()→KeepAlive-restart is a safe way to reload.
 *   - projectDir has no `.git` — proves we're the published tarball, not a dev worktree. A worktree's
 *     LaunchAgent runs from the worktree path, so `npm i -g` wouldn't even swap its code; never touch it.
 *
 * `AUTO_UPDATE` overrides the default: `off` disables entirely; `check` polls and reports availability
 * (via /api/state and the log) but never installs; `on` forces auto when the gates allow it.
 *
 * Stdlib + global fetch only — no runtime deps, no transform-requiring syntax (keeps the relay strip-clean).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { packageRoot } from './pkg-root.ts'

const execFileP = promisify(execFile)

const NAME = 'conductor-remote'
const projectDir = packageRoot(import.meta.dirname)
const REGISTRY = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org'
// Registry poll cadence. The poll is a single cheap GET off npm's CDN, so a tight loop costs nothing;
// a coarse interval, by contrast, left the phone serving a stale build for hours when several versions
// ship in quick succession (the poll only fires ~90s after boot, then on this interval). 2 min keeps the
// phone within a couple minutes of `latest`. `AUTO_UPDATE_INTERVAL_MINUTES` retunes it with no code change;
// values are floored at 1 min (below that you're just racing the 60s disk-skew heal and the CDN's tag TTL).
function resolveIntervalMs(): number {
	const raw = Number(process.env.AUTO_UPDATE_INTERVAL_MINUTES)
	const minutes = Number.isFinite(raw) && raw > 0 ? raw : 2
	return Math.max(minutes, 1) * 60 * 1000
}
const CHECK_INTERVAL_MS = resolveIntervalMs()
const FIRST_DELAY_MS = 90 * 1000
// A local package.json read is free next to a network poll, so reconcile disk↔process skew often —
// this heals an out-of-band upgrade in ~a minute instead of waiting for the next registry poll.
const DISK_CHECK_INTERVAL_MS = 60 * 1000

export type UpdateMode = 'off' | 'check' | 'auto'

export interface UpdateStatus {
	/** Version this process is running (from the package's own package.json). */
	current: string
	/** Latest version seen on the registry, or null before the first successful check. */
	latest: string | null
	/** True when `latest` is a strictly higher release than `current`. */
	available: boolean
	/** Epoch ms of the last successful registry check, or null. */
	checkedAt: number | null
	/** Effective mode after the gates are applied. */
	mode: UpdateMode
	/** Last check/install error message, or null. */
	lastError: string | null
}

function readVersion(): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')) as { version?: string }
		return pkg.version ?? '0.0.0'
	} catch {
		return '0.0.0'
	}
}

const CURRENT = readVersion()

/**
 * Fresh read of the installed package.json version — what's on disk *now*, which diverges from the
 * frozen `CURRENT` once an out-of-band install swaps the global package. Null if unreadable or
 * unparseable, so a transient read failure can never be mistaken for a skew (and loop-restart us).
 */
function diskVersion(): string | null {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')) as { version?: string }
		return pkg.version && parseVersion(pkg.version) ? pkg.version : null
	} catch {
		return null
	}
}

const status: UpdateStatus = {
	current: CURRENT,
	latest: null,
	available: false,
	checkedAt: null,
	mode: 'off',
	lastError: null
}

/** Snapshot of the updater state, surfaced on /api/state so the phone can show the version and any update. */
export function updateStatus(): UpdateStatus {
	return { ...status }
}

/** Parse `x.y.z` (ignoring any prerelease/build suffix) into a comparable tuple; null if unparseable. */
function parseVersion(v: string): [number, number, number] | null {
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True when `candidate` is a strictly higher release than `base` (prereleases collapse to their x.y.z). */
function isNewer(candidate: string, base: string): boolean {
	const a = parseVersion(candidate)
	const b = parseVersion(base)
	if (!a || !b) return false
	for (let i = 0; i < 3; i++) {
		if (a[i] > b[i]) return true
		if (a[i] < b[i]) return false
	}
	return false
}

async function fetchLatest(): Promise<string | null> {
	// The `/latest` sub-endpoint serves the full manifest as application/json; the abbreviated
	// `vnd.npm.install-v1+json` media type is only valid on the packument root and 406s here.
	const res = await fetch(`${REGISTRY}/${NAME}/latest`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(10_000)
	})
	if (!res.ok) throw new Error(`registry ${res.status}`)
	const body = (await res.json()) as { version?: string }
	return body.version ?? null
}

/** Resolve npm next to the running node (Homebrew/nvm keep them in one bin dir); fall back to PATH. */
function npmBin(): string {
	const adjacent = path.join(path.dirname(process.execPath), 'npm')
	return fs.existsSync(adjacent) ? adjacent : 'npm'
}

async function installLatest(): Promise<void> {
	await execFileP(npmBin(), ['install', '-g', `${NAME}@latest`], {
		timeout: 300_000,
		env: { ...process.env, npm_config_yes: 'true' }
	})
}

function log(msg: string): void {
	console.info(`[auto-update] ${msg}`)
}

/**
 * Effective mode. Precedence: explicit AUTO_UPDATE > gated default.
 *   off — disabled.  check — poll + report, never install.  auto — poll + install + self-restart.
 * `auto` (default when unset, or when AUTO_UPDATE=on) requires BOTH gates; without them, an explicit
 * `on` degrades to `check` (visibility without an unsafe install) and an unset default degrades to `off`
 * (a dev `yarn start` or worktree daemon stays silent).
 */
function resolveMode(): UpdateMode {
	const raw = process.env.AUTO_UPDATE?.trim().toLowerCase()
	if (raw === 'off' || raw === 'false' || raw === '0') return 'off'
	if (raw === 'check' || raw === 'notify') return 'check'
	const managed = process.env.CONDUCTOR_REMOTE_MANAGED === '1'
	const published = !fs.existsSync(path.join(projectDir, '.git'))
	const canAuto = managed && published
	if (raw === 'on' || raw === 'auto' || raw === '1' || raw === 'true') return canAuto ? 'auto' : 'check'
	return canAuto ? 'auto' : 'off'
}

let restarting = false

/** Schedule an exit so launchd's KeepAlive respawns us into the on-disk code. Idempotent per process. */
function scheduleRestart(reason: string): void {
	if (restarting) return
	restarting = true
	log(`${reason}; restarting to apply (launchd KeepAlive brings the relay back).`)
	// Let the log line flush, then exit; KeepAlive respawns us into the new code.
	setTimeout(() => process.exit(0), 500).unref()
}

/**
 * Reload if the on-disk install no longer matches this running process — an out-of-band upgrade
 * (manual `npm i -g`, `yarn deploy`, or CI) that the registry poll won't catch, since it compares
 * npm's latest against our *running* version, not against disk. Any mismatch converges process→disk;
 * a null read (unreadable/unparseable) is ignored so we never restart-loop on a transient failure.
 */
function restartIfDiskSkewed(): void {
	const onDisk = diskVersion()
	if (!onDisk || onDisk === CURRENT) return
	scheduleRestart(`on-disk ${onDisk} ≠ running ${CURRENT} (out-of-band install)`)
}

let inFlight = false

async function runCheck(mode: 'check' | 'auto'): Promise<void> {
	if (inFlight) return
	inFlight = true
	try {
		const latest = await fetchLatest()
		status.latest = latest
		status.checkedAt = Date.now()
		status.available = latest != null && isNewer(latest, CURRENT)
		status.lastError = null
		if (!status.available || latest == null) return
		if (mode === 'check') {
			log(`update available: ${CURRENT} → ${latest} (AUTO_UPDATE=check — not installing)`)
			return
		}
		log(`updating ${CURRENT} → ${latest} via \`npm i -g ${NAME}@latest\`…`)
		await installLatest()
		scheduleRestart(`installed ${latest}`)
	} catch (err) {
		status.lastError = err instanceof Error ? err.message : String(err)
		log(`check/update failed: ${status.lastError}`)
	} finally {
		inFlight = false
	}
}

/** Start the periodic self-updater. Safe to call unconditionally — it no-ops unless the gates pass. */
export function startAutoUpdate(): void {
	const mode = resolveMode()
	status.mode = mode
	if (mode === 'off') return
	const everyMin = Math.round(CHECK_INTERVAL_MS / 60_000)
	log(`enabled (mode=${mode}, current=${CURRENT}); first check in ${FIRST_DELAY_MS / 1000}s, then every ${everyMin}m.`)
	setTimeout(() => void runCheck(mode), FIRST_DELAY_MS).unref()
	setInterval(() => void runCheck(mode), CHECK_INTERVAL_MS).unref()
	// Only `auto` may exit()→restart (KeepAlive is guaranteed there); `check` reports but never acts,
	// so the disk-skew heal — which reloads by exiting — is gated to `auto` alongside the npm install.
	if (mode === 'auto') setInterval(restartIfDiskSkewed, DISK_CHECK_INTERVAL_MS).unref()
}
