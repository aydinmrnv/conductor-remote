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

// AppleScript steps that focus a workspace via Conductor's command palette
// (Esc → Cmd+K → branch → Enter). The branch is read from RELAY_WS_QUERY at run
// time to dodge AppleScript escaping; the timing delays are load-bearing.
const FOCUS_WORKSPACE_STEPS = `
	key code 53
	delay 0.25
	keystroke "k" using {command down}
	delay 0.7
	keystroke (system attribute "RELAY_WS_QUERY")
	delay 0.9
	key code 36
	delay 1.3`

/** Conductor's command palette matches workspaces by branch — its unique key. A
 * looser query (directory name) can match a command like unarchive, so prefer
 * branch and only fall back when it's absent. */
function focusQuery(ws: Workspace): string {
	return ws.branch || ws.workspace_name || ws.directory_name || ''
}

/**
 * Drives Conductor's real send path via macOS Accessibility (AppleScript): focus
 * the target workspace, paste the prompt, press Enter. Uses whatever model /
 * permission mode the session already has (zero risk of altering the agent),
 * which is why it's the default.
 *
 * Precise targeting comes from focusing the intended workspace first through
 * Conductor's command palette (Cmd+K → branch → Enter) before pasting, so the
 * prompt lands in the right session regardless of what was focused — no private
 * IPC and nothing to rebreak on a Conductor update (unlike the sidecar).
 */
export class AppleScriptActuator implements Actuator {
	readonly name = 'applescript'
	readonly caveat = 'Focuses the target workspace via the command palette (Cmd+K) before sending.'
	readonly precise = true

	async send(target: SendTarget, text: string): Promise<SendResult> {
		const navQuery = focusQuery(target.workspace)
		const navigate = navQuery ? FOCUS_WORKSPACE_STEPS : ''
		// Paste beats keystroke for long/multibyte prompts. Stash the clipboard,
		// focus the target workspace, paste, send, and restore.
		const script = `
set savedClipboard to the clipboard
tell application "Conductor" to activate
delay 0.4
tell application "System Events"${navigate}
	set the clipboard to (do shell script "cat" & " " & quoted form of (system attribute "RELAY_PROMPT_FILE"))
	keystroke "v" using {command down}
	delay 0.15
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
				env: { ...process.env, RELAY_PROMPT_FILE: tmp, RELAY_WS_QUERY: navQuery },
				timeout: 15000
			})
			return { ok: true, strategy: this.name }
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
 * Open a new chat in the target workspace — Conductor's "New chat, same files"
 * (Cmd+T). Focuses the workspace first (command palette → branch), then Cmd+T; the
 * caller detects the freshly-created session id from the DB.
 */
export async function newChat(workspace: Workspace): Promise<SendResult> {
	const navQuery = focusQuery(workspace)
	if (!navQuery) return { ok: false, strategy: 'applescript', error: 'workspace has no branch to focus' }
	const script = `
tell application "Conductor" to activate
delay 0.4
tell application "System Events"${FOCUS_WORKSPACE_STEPS}
	keystroke "t" using {command down}
end tell`.trim()
	try {
		await exec('osascript', ['-e', script], {
			env: { ...process.env, RELAY_WS_QUERY: navQuery },
			timeout: 15000
		})
		return { ok: true, strategy: 'applescript' }
	} catch (err) {
		return { ok: false, strategy: 'applescript', error: err instanceof Error ? err.message : String(err) }
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
