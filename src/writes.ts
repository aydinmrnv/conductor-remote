import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Workspace } from './reads.ts'

const exec = promisify(execFile)

export interface SendResult {
	ok: boolean
	strategy: string
	warning?: string
	error?: string
}

export interface Actuator {
	readonly name: string
	/** Human-readable note about this strategy's limits, surfaced in the UI. */
	readonly caveat: string
	send: (workspace: Workspace, text: string) => Promise<SendResult>
}

/**
 * Writes are the ONLY Conductor-coupled surface (reads ride SQLite + git).
 *
 * On this build the webview-injection path from the original plan is closed:
 * the app is hardened/notarized without `get-task-allow`, its frontend is
 * baked into the binary (no index.html to patch, no devtools), and the only
 * exposed IPC commands are stock Tauri plugins — there is no custom
 * `send_message` to invoke. See FINDINGS.md.
 *
 * So the default actuator drives Conductor's real send path via macOS
 * Accessibility (AppleScript). It types into whichever session Conductor has
 * focused — reliable per-workspace targeting needs an AX-tree map of the
 * sidebar and is the next recon step.
 */
export class AppleScriptActuator implements Actuator {
	readonly name = 'applescript'
	readonly caveat =
		'Sends to the session currently focused in the Conductor window. Bring the target workspace to front first; per-workspace targeting is not yet wired.'

	async send(_workspace: Workspace, text: string): Promise<SendResult> {
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

/**
 * Experimental, opt-in (UNSAFE_DB_WRITE=1). Inserts a queued user message
 * straight into conductor.db, mirroring the columns a real prompt writes.
 * UNVERIFIED: it is not yet confirmed that Conductor's backend drains the
 * queue from a DB watcher rather than only on its own in-process IPC — so this
 * may produce a message that shows in the UI but never dispatches. Never runs
 * unless explicitly enabled. See FINDINGS.md.
 */
export class DbQueueActuator implements Actuator {
	readonly name = 'db-queue'
	readonly caveat = 'EXPERIMENTAL raw DB insert — may not dispatch. Enabled via UNSAFE_DB_WRITE=1.'

	async send(_workspace: Workspace, _text: string): Promise<SendResult> {
		return {
			ok: false,
			strategy: this.name,
			error: 'db-queue actuator is a documented stub — implement only after confirming the queue is DB-drained (FINDINGS.md).'
		}
	}
}

export function pickActuator(unsafeDbWrite: boolean): Actuator {
	return unsafeDbWrite ? new DbQueueActuator() : new AppleScriptActuator()
}
