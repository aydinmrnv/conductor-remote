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

/**
 * Where the target chat sits in Conductor's tab strip. `index` is 1-based in
 * `reads.listSessions` order (created_at ASC) — verified to match the strip's
 * left-to-right order — and `title` is the tab label used as a sanity check.
 */
export interface ChatTab {
	index: number
	count: number
	title: string
}

/** Who to deliver a prompt to. `sessionId` is the precise target; `workspace` carries the worktree + focus context. */
export interface SendTarget {
	workspace: Workspace
	sessionId: string | null
	/** Which chat tab to select once the workspace is focused. Omitted → whichever tab is already active. */
	tab?: ChatTab
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

/**
 * AppleScript handlers that pick a *chat tab* inside the focused workspace.
 *
 * The palette (Cmd+K) only gets us to the right workspace — a workspace holds
 * several chats, and Conductor keeps typing in whichever tab is already active.
 * So a send addressed to a non-active chat would land in the wrong agent.
 *
 * Conductor's webview exposes the strip through macOS Accessibility: an
 * AXTabGroup whose AXRadioButtons are the tabs (`AXValue` marks the selected
 * one, `AXPress` switches to it — it does *not* close the chat). The strip's
 * order matches `reads.listSessions` (created_at ASC), so the caller addresses
 * a tab by 1-based index and we cross-check the label before pressing.
 *
 * Target is read from RELAY_TAB_{INDEX,COUNT,TITLE}; index 0 disables the step.
 * Every failure path errors out so the caller aborts *before* pasting — landing
 * in the wrong chat is worse than not sending.
 */
const SELECT_CHAT_TAB_HANDLERS = `
on findTabGroup()
	tell application "System Events" to tell process "Conductor"
		set queue to {window 1}
		set visited to 0
		repeat while (count of queue) > 0 and visited < 120
			set node to item 1 of queue
			if (count of queue) > 1 then
				set queue to items 2 thru -1 of queue
			else
				set queue to {}
			end if
			set visited to visited + 1
			try
				set hits to (UI elements of node whose role is "AXTabGroup")
				if (count of hits) > 0 then return item 1 of hits
				set queue to queue & (UI elements of node)
			end try
		end repeat
	end tell
	return missing value
end findTabGroup

on chatTabs(tg)
	tell application "System Events" to tell process "Conductor"
		set direct to (UI elements of tg whose role is "AXRadioButton")
		if (count of direct) > 0 then return direct
		set nested to {}
		repeat with g in (UI elements of tg)
			repeat with r in (UI elements of g whose role is "AXRadioButton")
				set end of nested to contents of r
			end repeat
		end repeat
		return nested
	end tell
end chatTabs

on selectChatTab()
	set wantIndex to (system attribute "RELAY_TAB_INDEX") as integer
	if wantIndex is 0 then return
	set wantCount to (system attribute "RELAY_TAB_COUNT") as integer
	set wantTitle to system attribute "RELAY_TAB_TITLE"
	set tg to my findTabGroup()
	if tg is missing value then
		-- A lone chat has no ambiguity to resolve; more than one and we must not guess.
		if wantCount <= 1 then return
		error "couldn't find the chat tab strip"
	end if
	set tabs to my chatTabs(tg)
	tell application "System Events" to tell process "Conductor"
		set target to missing value
		if wantIndex <= (count of tabs) then
			set candidate to contents of (item wantIndex of tabs)
			if wantTitle is "" or (name of candidate) contains wantTitle then set target to candidate
		end if
		if target is missing value and wantTitle is not "" then
			repeat with t in tabs
				if (name of t) contains wantTitle then
					if target is not missing value then error "several chat tabs match " & wantTitle
					set target to contents of t
				end if
			end repeat
		end if
		if target is missing value then error "chat tab " & wantIndex & " not found"
		if (value of target) is not true then
			perform action "AXPress" of target
			delay 0.5
		end if
		if (value of target) is not true then error "couldn't switch to the target chat tab"
	end tell
end selectChatTab`

/** Conductor's command palette matches workspaces by branch — its unique key. A
 * looser query (directory name) can match a command like unarchive, so prefer
 * branch and only fall back when it's absent. */
function focusQuery(ws: Workspace): string {
	return ws.branch || ws.workspace_name || ws.directory_name || ''
}

/** The tab target rides in on the environment, like RELAY_WS_QUERY, to dodge AppleScript escaping. */
function tabEnv(tab: ChatTab | undefined): Record<string, string> {
	return {
		RELAY_TAB_INDEX: String(tab?.index ?? 0),
		RELAY_TAB_COUNT: String(tab?.count ?? 0),
		RELAY_TAB_TITLE: tab?.title ?? ''
	}
}

/** osascript echoes the whole failing script back; keep just the reason for the phone. */
function osaError(err: unknown): string {
	const raw = err instanceof Error ? err.message : String(err)
	return raw.match(/execution error: (.+?) \(-?\d+\)/)?.[1] ?? raw.split('\n')[0]
}

/**
 * Drives Conductor's real send path via macOS Accessibility (AppleScript): focus
 * the target workspace, paste the prompt, press Enter. Uses whatever model /
 * permission mode the session already has (zero risk of altering the agent),
 * which is why it's the default.
 *
 * Precise targeting comes from focusing the intended workspace first through
 * Conductor's command palette (Cmd+K → branch → Enter) and then selecting the
 * target chat's tab (Accessibility, see SELECT_CHAT_TAB_HANDLERS), so the prompt
 * lands in the right session regardless of what was focused — no private IPC and
 * nothing to rebreak on a Conductor update (unlike the sidecar).
 */
export class AppleScriptActuator implements Actuator {
	readonly name = 'applescript'
	readonly caveat = 'Focuses the target workspace (Cmd+K) and its chat tab before sending.'
	readonly precise = true

	async send(target: SendTarget, text: string): Promise<SendResult> {
		const navQuery = focusQuery(target.workspace)
		const navigate = navQuery ? FOCUS_WORKSPACE_STEPS : ''
		// Paste beats keystroke for long/multibyte prompts. Stash the clipboard,
		// focus the target workspace and chat tab, paste, send, and restore.
		// After the palette navigates to the workspace, focus lands on a button, not
		// the composer — so Cmd+L (Conductor's "focus the composer" shortcut) is the
		// load-bearing step that puts the caret in the prompt box before we paste.
		const script = `
${SELECT_CHAT_TAB_HANDLERS}

set savedClipboard to the clipboard
tell application "Conductor" to activate
delay 0.4
tell application "System Events"${navigate}
end tell
my selectChatTab()
tell application "System Events"
	set the clipboard to (do shell script "cat" & " " & quoted form of (system attribute "RELAY_PROMPT_FILE"))
	keystroke "l" using {command down}
	delay 0.3
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
				env: { ...process.env, RELAY_PROMPT_FILE: tmp, RELAY_WS_QUERY: navQuery, ...tabEnv(target.tab) },
				timeout: 20000
			})
			return { ok: true, strategy: this.name }
		} catch (err) {
			return { ok: false, strategy: this.name, error: osaError(err) }
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
		return { ok: false, strategy: 'applescript', error: osaError(err) }
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
