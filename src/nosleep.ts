/**
 * Arming lid-closed wakefulness from the phone.
 *
 * This is the one relay capability that needs root, and it only exists at all because
 * `nosleep setup` installed a scoped NOPASSWD rule: the LaunchAgent has no TTY, so
 * without that rule there is no prompt to answer and nothing here can work. Every
 * function below degrades to "not available" rather than failing loudly when the rule
 * isn't installed, because that is the normal state for anyone who hasn't opted in.
 *
 * Two properties matter and neither is obvious:
 *
 *  - **The armed window must outlive this process.** `autoupdate` deliberately
 *    `exit()`s to reload and launchd restarts us; if the helper were an ordinary child
 *    it would die with us and silently restore sleep, which is exactly the moment the
 *    phone is relying on it. So it is spawned detached (its own session), and the
 *    relay finds it again after a restart by reading the pidfile rather than by
 *    holding a handle.
 *  - **Liveness can't be checked the usual way.** The armed process runs as root, so
 *    `kill(pid, 0)` from this process raises EPERM rather than succeeding. EPERM means
 *    it is alive and not ours; ESRCH means it is gone. Treating EPERM as dead would
 *    report every armed window as idle.
 *
 * Stdlib only, strip-clean — see CLAUDE.md.
 */
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'
import { HELPER_PATH, helperReady, PIDFILE_PATH } from './nosleep-helper.ts'

const execFileP = promisify(execFile)

/** Longest window the API will arm. A phone tap should never be able to disable sleep forever. */
export const MAX_SECONDS = 12 * 3600

export interface NoSleepState {
	/** False when `nosleep setup` hasn't been run — every action here is unavailable. */
	available: boolean
	armed: boolean
	/** Epoch ms the window expires, or null for "until stopped" / not armed. */
	until: number | null
	pid: number | null
}

/**
 * Whether `pid` exists. EPERM is the interesting case: the armed helper runs as root, so
 * signalling it from here is refused, and that refusal is itself proof it is alive.
 */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM'
	}
}

/** Parse `<pid> <expiry-epoch-seconds>`; expiry 0 means "until stopped". */
function readPidfile(): { pid: number; until: number | null } | null {
	let raw: string
	try {
		raw = fs.readFileSync(PIDFILE_PATH, 'utf8')
	} catch {
		return null
	}
	const [pidRaw, untilRaw] = raw.trim().split(/\s+/)
	const pid = Number(pidRaw)
	if (!Number.isInteger(pid) || pid <= 0) return null
	const untilSec = Number(untilRaw)
	return { pid, until: Number.isFinite(untilSec) && untilSec > 0 ? untilSec * 1000 : null }
}

/**
 * Armed-ness on its own: a local file read plus a signal probe, no subprocess at all.
 *
 * Split out from `nosleepState()` because the wait loops below poll it several times a
 * second. `nosleepState()` falls through to `helperReady()` whenever nothing is armed,
 * which is exactly the state a loop *waiting* for an arm sits in, so polling it would fire
 * a synchronous sudo on every pass — fifty per arm, each one blocking the relay's single
 * thread. The loops already know the grant works; they checked before spawning.
 */
function armedRecord(): { pid: number; until: number | null } | null {
	const rec = readPidfile()
	return rec && alive(rec.pid) ? rec : null
}

function armedState(rec: { pid: number; until: number | null }): NoSleepState {
	return { available: true, armed: true, until: rec.until, pid: rec.pid }
}

/**
 * Current state. `helperReady()` shells out to sudo, so it is only consulted when nothing
 * is armed — an armed window is itself proof the grant works.
 */
export async function nosleepState(): Promise<NoSleepState> {
	const rec = armedRecord()
	if (rec) return armedState(rec)
	return { available: await helperReady(), armed: false, until: null, pid: null }
}

export interface NoSleepResult {
	ok: boolean
	error?: string
	state: NoSleepState
}

function unavailable(): NoSleepResult {
	return {
		ok: false,
		error: 'Passwordless nosleep isn’t installed. Run `conductor-remote nosleep setup` on the Mac.',
		state: { available: false, armed: false, until: null, pid: null }
	}
}

/**
 * Arm for `seconds` (0 = until stopped). Arming while already armed replaces the window
 * rather than stacking — the helper enforces that, and it has to, since two owners would
 * restore each other's flipped values and leave sleep disabled for good.
 */
export async function armNoSleep(seconds: number): Promise<NoSleepResult> {
	if (!(await helperReady())) return unavailable()
	// Floor of 1, not 0. The helper reads 0 as "until killed", so anything under a second
	// truncates straight past MAX_SECONDS into a window nothing ever closes — which is the
	// one thing the cap exists to prevent.
	const secs = Math.min(MAX_SECONDS, Math.max(1, Math.trunc(seconds)))
	// Detached, own session, no stdio: it has to survive this relay's own restarts,
	// which autoupdate performs routinely and without warning.
	const child = spawn('sudo', ['-n', HELPER_PATH, String(secs), ''], {
		detached: true,
		stdio: 'ignore'
	})
	child.unref()

	// The helper writes its pidfile only after pmset actually applied, so waiting for the
	// file is what turns "we launched something" into "sleep is genuinely blocked". A
	// takeover adds its own wait for the incumbent to restore, hence the generous ceiling.
	const deadline = Date.now() + 10_000
	while (Date.now() < deadline) {
		const rec = armedRecord()
		if (rec) return { ok: true, state: armedState(rec) }
		await new Promise(r => setTimeout(r, 200))
	}
	return { ok: false, error: 'nosleep did not report itself armed within 10s', state: await nosleepState() }
}

/** Disarm. Goes through the helper because the armed process is root and we can't signal it. */
export async function disarmNoSleep(): Promise<NoSleepResult> {
	if (!(await helperReady())) return unavailable()
	try {
		await execFileP('sudo', ['-n', HELPER_PATH, '--stop'], { timeout: 10_000 })
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err), state: await nosleepState() }
	}
	const deadline = Date.now() + 8000
	while (Date.now() < deadline) {
		if (!armedRecord()) return { ok: true, state: { available: true, armed: false, until: null, pid: null } }
		await new Promise(r => setTimeout(r, 200))
	}
	return { ok: false, error: 'nosleep is still armed after --stop', state: await nosleepState() }
}
