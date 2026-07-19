import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Workspace } from './reads.ts'
import { sidecarAvailable, sidecarSendUserMessage } from './sidecar.ts'

const exec = promisify(execFile)

export interface SendResult {
	ok: boolean
	strategy: string
	warning?: string
	error?: string
}

/** Who to deliver a prompt to. `sessionId` is the precise target; `workspace` carries the worktree + focus context. */
export interface SendTarget {
	workspace: Workspace
	sessionId: string | null
}

export interface Actuator {
	readonly name: string
	/** Human-readable note about this strategy's limits, surfaced in the UI. */
	readonly caveat: string
	/** True when delivery is addressed to a specific session (no window-focus dependency). */
	readonly precise: boolean
	send: (target: SendTarget, text: string) => Promise<SendResult>
	/** Runtime availability check (e.g. the sidecar socket must be reachable). */
	available?: () => Promise<boolean>
}

/**
 * The sidecar IPC path — the precise, per-session write. Delivers straight to
 * `sessionId` over Conductor's own dispatch socket (see sidecar.ts), so it needs
 * no window focus and the app UI reflects the turn correctly.
 *
 * Opt-in (WRITE_STRATEGY=sidecar) because it speaks a private, versioned IPC and
 * hasn't been validated by an automated live send (that would inject a prompt
 * into a running agent). It is the intended default once you've confirmed it on
 * your setup.
 */
export class SidecarActuator implements Actuator {
	readonly name = 'sidecar'
	readonly caveat =
		'Delivered straight to the target session over Conductor’s dispatch socket — precise per-workspace targeting.'
	readonly precise = true

	available(): Promise<boolean> {
		return sidecarAvailable()
	}

	async send(target: SendTarget, text: string): Promise<SendResult> {
		const sessionId = target.sessionId ?? target.workspace.active_session_id
		if (!sessionId) return { ok: false, strategy: this.name, error: 'no session id to target' }
		try {
			await sidecarSendUserMessage(sessionId, text)
			return { ok: true, strategy: this.name }
		} catch (err) {
			return { ok: false, strategy: this.name, error: err instanceof Error ? err.message : String(err) }
		}
	}
}

/**
 * Drives Conductor's real send path via macOS Accessibility (AppleScript):
 * activate the app, paste the prompt, press Enter. Uses whatever model /
 * permission mode the session already has (zero risk of altering the agent),
 * which is why it's the default. Its one limit is that it lands in the session
 * Conductor currently has focused — bring the target workspace to front first.
 */
export class AppleScriptActuator implements Actuator {
	readonly name = 'applescript'
	readonly caveat =
		'Lands in the session Conductor currently has focused. Bring the target workspace to front first; for precise targeting run with WRITE_STRATEGY=sidecar.'
	readonly precise = false

	async send(_target: SendTarget, text: string): Promise<SendResult> {
		// Paste beats keystroke for long/multibyte prompts. We stash the clipboard,
		// paste, send, and restore.
		const script = `
set savedClipboard to the clipboard
set the clipboard to (do shell script "cat" & " " & quoted form of (system attribute "RELAY_PROMPT_FILE"))
tell application "Conductor" to activate
delay 0.35
tell application "System Events"
	keystroke "v" using {command down}
	delay 0.1
	key code 36
end tell
delay 0.1
set the clipboard to savedClipboard
`.trim()
		// Pass the prompt via a temp file + env to avoid AppleScript string escaping.
		const os = await import('node:os')
		const fs = await import('node:fs/promises')
		const path = await import('node:path')
		const tmp = path.join(os.tmpdir(), `relay-prompt-${process.pid}-${Date.now()}.txt`)
		await fs.writeFile(tmp, text, 'utf8')
		try {
			await exec('osascript', ['-e', script], {
				env: { ...process.env, RELAY_PROMPT_FILE: tmp },
				timeout: 10000
			})
			return {
				ok: true,
				strategy: this.name,
				warning: 'Delivered to the focused Conductor session — confirm it landed in the intended workspace.'
			}
		} catch (err) {
			return {
				ok: false,
				strategy: this.name,
				error: err instanceof Error ? err.message : String(err)
			}
		} finally {
			await fs.rm(tmp, { force: true }).catch(() => undefined)
		}
	}
}

export type WriteStrategy = 'applescript' | 'sidecar'

export function pickActuator(strategy: WriteStrategy): Actuator {
	return strategy === 'sidecar' ? new SidecarActuator() : new AppleScriptActuator()
}

/** Effective actuator description for the UI, factoring in runtime availability. */
export async function describeActuator(
	actuator: Actuator
): Promise<{ name: string; caveat: string; precise: boolean; available: boolean }> {
	const available = actuator.available ? await actuator.available().catch(() => false) : true
	return { name: actuator.name, caveat: actuator.caveat, precise: actuator.precise, available }
}
