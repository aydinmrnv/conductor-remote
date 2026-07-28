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
 * AppleScript handlers that pin down *which chat* the prompt goes to.
 *
 * The palette (Cmd+K) only gets us to the right workspace — a workspace holds
 * several chats, and Conductor keeps typing in whichever tab is already active.
 * So a send addressed to a non-active chat would land in the wrong agent.
 *
 * Conductor's webview exposes the whole tree through macOS Accessibility. The
 * chat strip is an AXTabGroup whose AXRadioButtons are the tabs (`AXValue`
 * marks the selected one, `AXPress` switches to it — it does *not* close the
 * chat). The strip's order matches `reads.listSessions` (created_at ASC), so
 * the caller addresses a tab by 1-based index and we cross-check the label.
 *
 * Two traps this has to survive:
 *  - **The terminal panel is an AXTabGroup too** (radio buttons named Setup /
 *    Run / Terminal 1), a sibling of the chat strip in the same pane. Picking
 *    "the first tab group" would sometimes press a terminal tab, so we *score*
 *    the candidates on tab count + label and refuse to act on a tie.
 *  - **The palette can land on the wrong workspace** (a loose query matches a
 *    command; a deleted branch opens a modal). The pane header carries the
 *    branch and repo, so we read them back and bail if they disagree.
 *
 * Target is read from RELAY_TAB_{INDEX,COUNT,TITLE} + RELAY_WS_{BRANCH,REPO};
 * index 0 disables the step. Every failure path errors out so the caller aborts
 * *before* pasting — landing in the wrong chat is worse than not sending.
 */
const SELECT_CHAT_TAB_HANDLERS = `
on tabGroups()
	-- Level-order search, returning every tab group at the shallowest depth that
	-- has one (the chat strip and the terminal strip are siblings). Bounded: the
	-- pane sits ~5 levels down, and we must never descend into the transcript.
	tell application "System Events" to tell process "Conductor"
		set level to {window 1}
		set depth to 0
		repeat while (count of level) > 0 and depth < 8
			set found to {}
			set nextLevel to {}
			repeat with entry in level
				set node to contents of entry
				try
					repeat with h in (UI elements of node whose role is "AXTabGroup")
						set end of found to contents of h
					end repeat
					set nextLevel to nextLevel & (UI elements of node)
				end try
			end repeat
			if (count of found) > 0 then return found
			set level to nextLevel
			set depth to depth + 1
		end repeat
	end tell
	return {}
end tabGroups

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

on tabLabel(t)
	tell application "System Events" to tell process "Conductor"
		return (name of t) as text
	end tell
end tabLabel

on pickChatStrip(strips, wantCount, wantTitle)
	-- Score each candidate strip: a label match outweighs a tab-count match, and
	-- a tie means we cannot tell the chat strip from the terminal strip.
	set best to missing value
	set bestTabs to {}
	set bestScore to 0
	set tied to false
	repeat with entry in strips
		set tg to contents of entry
		set strip to my chatTabs(tg)
		set score to 0
		if wantCount > 0 and (count of strip) is wantCount then set score to score + 1
		if wantTitle is not "" then
			repeat with t in strip
				if (my tabLabel(t)) contains wantTitle then
					set score to score + 2
					exit repeat
				end if
			end repeat
		end if
		if score > bestScore then
			set bestScore to score
			set best to tg
			set bestTabs to strip
			set tied to false
		else if score is bestScore and score > 0 then
			set tied to true
		end if
	end repeat
	if bestScore is 0 then error "couldn't identify the chat tab strip"
	if tied then error "can't tell which tab strip holds the target chat"
	return {best, bestTabs}
end pickChatStrip

on lastPathSegment(s)
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "/"
	set parts to text items of s
	set AppleScript's text item delimiters to saved
	return item -1 of parts
end lastPathSegment

on paneLabels(tg, wantRole)
	-- Kept out of the caller's scope on purpose: inside a System Events tell,
	-- ordinary-looking names (tabs, count) resolve as app terms instead of vars.
	tell application "System Events" to tell process "Conductor"
		set pane to value of attribute "AXParent" of tg
		return (name of (UI elements of pane whose role is wantRole))
	end tell
end paneLabels

on anyContains(haystack, needle)
	repeat with entry in haystack
		try
			if (entry as text) contains needle then return true
		end try
	end repeat
	return false
end anyContains

on assertWorkspace(tg)
	-- The pane holding the chat strip also labels the open workspace: an
	-- AXStaticText with the branch (sans owner prefix) and a repo popup button.
	set wantBranch to system attribute "RELAY_WS_BRANCH"
	if wantBranch is "" then return
	set tail to my lastPathSegment(wantBranch)
	if not (my anyContains(my paneLabels(tg, "AXStaticText"), tail)) then
		error "the palette didn't land on " & tail
	end if
	set wantRepo to system attribute "RELAY_WS_REPO"
	if wantRepo is not "" then
		if not (my anyContains(my paneLabels(tg, "AXPopUpButton"), wantRepo)) then
			error "the palette didn't land in " & wantRepo
		end if
	end if
end assertWorkspace

on normalizeNewlines(s)
	-- "do shell script" hands back CR-delimited text; the composer reads back LF.
	-- Without this the verification below never matches a multi-line prompt.
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to return
	set parts to text items of s
	set AppleScript's text item delimiters to linefeed
	set joined to parts as text
	set AppleScript's text item delimiters to saved
	return joined
end normalizeNewlines

on fillComposer(promptText)
	-- Write the prompt straight into the composer's AXTextArea instead of
	-- stashing the clipboard, pressing Cmd+L and pasting. AXFocused and AXValue
	-- are both settable, so this needs no keystrokes and no clipboard hijack.
	-- Returns false (→ caller falls back to pasting) if anything looks off, but
	-- *clears whatever it wrote first*: leaving half a prompt behind would make
	-- the fallback paste append to it and send a garbled prompt.
	if promptText is "" then return false
	set strips to my tabGroups()
	if (count of strips) is 0 then return false
	try
		tell application "System Events" to tell process "Conductor"
			set pane to value of attribute "AXParent" of (item 1 of strips)
			set composerBox to item 1 of (UI elements of pane whose name is "composer")
			set textBox to item 1 of (UI elements of composerBox whose role is "AXTextArea")
			set value of attribute "AXFocused" of textBox to true
			set value of textBox to promptText
			delay 0.25
			if ((value of textBox) as text) does not contain promptText then
				set value of textBox to ""
				return false
			end if
		end tell
	on error
		try
			my clearComposer()
		end try
		return false
	end try
	return true
end fillComposer

on clearComposer()
	set strips to my tabGroups()
	if (count of strips) is 0 then return
	tell application "System Events" to tell process "Conductor"
		set pane to value of attribute "AXParent" of (item 1 of strips)
		set composerBox to item 1 of (UI elements of pane whose name is "composer")
		set value of (item 1 of (UI elements of composerBox whose role is "AXTextArea")) to ""
	end tell
end clearComposer

on pasteComposer()
	-- Fallback for when the composer isn't reachable: Cmd+L focuses it (after the
	-- palette, focus sits on a button, not the text box), then paste.
	tell application "System Events"
		set the clipboard to (do shell script "cat" & " " & quoted form of (system attribute "RELAY_PROMPT_FILE"))
		keystroke "l" using {command down}
		delay 0.3
		keystroke "v" using {command down}
		delay 0.15
	end tell
end pasteComposer

on selectChatTab()
	set wantIndex to (system attribute "RELAY_TAB_INDEX") as integer
	if wantIndex is 0 then return
	set wantCount to (system attribute "RELAY_TAB_COUNT") as integer
	set wantTitle to system attribute "RELAY_TAB_TITLE"
	set strips to my tabGroups()
	if (count of strips) is 0 then
		-- A lone chat has no ambiguity to resolve; more than one and we must not guess.
		if wantCount <= 1 then return
		error "couldn't find the chat tab strip"
	end if
	-- Assert the workspace first: every strip lives in the same pane, so this
	-- reports "wrong workspace" rather than a confusing "no chat strip".
	my assertWorkspace(item 1 of strips)
	set picked to my pickChatStrip(strips, wantCount, wantTitle)
	set tabs to item 2 of picked
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

/** The target rides in on the environment, like RELAY_WS_QUERY, to dodge AppleScript escaping. */
function targetEnv(target: SendTarget): Record<string, string> {
	return {
		RELAY_TAB_INDEX: String(target.tab?.index ?? 0),
		RELAY_TAB_COUNT: String(target.tab?.count ?? 0),
		RELAY_TAB_TITLE: target.tab?.title ?? '',
		RELAY_WS_BRANCH: target.workspace.branch ?? '',
		RELAY_WS_REPO: target.workspace.repo_name ?? ''
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
		// Focus the target workspace, select its chat tab, fill the composer, send.
		// Filling is an Accessibility write (no keystrokes, no clipboard); the
		// clipboard paste is kept only as a fallback, and stashes/restores around it.
		const script = `
${SELECT_CHAT_TAB_HANDLERS}

tell application "Conductor" to activate
delay 0.4
tell application "System Events"${navigate}
end tell
my selectChatTab()
set promptText to my normalizeNewlines(do shell script "cat" & " " & quoted form of (system attribute "RELAY_PROMPT_FILE"))
if not (my fillComposer(promptText)) then
	set savedClipboard to the clipboard
	my pasteComposer()
	delay 0.1
	set the clipboard to savedClipboard
end if
tell application "System Events"
	key code 36
end tell
`.trim()
		// Pass the prompt via a temp file + env to avoid AppleScript string escaping.
		const os = await import('node:os')
		const fs = await import('node:fs/promises')
		const path = await import('node:path')
		const tmp = path.join(os.tmpdir(), `relay-prompt-${process.pid}-${Date.now()}.txt`)
		await fs.writeFile(tmp, text, 'utf8')
		try {
			await exec('osascript', ['-e', script], {
				env: { ...process.env, RELAY_PROMPT_FILE: tmp, RELAY_WS_QUERY: navQuery, ...targetEnv(target) },
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
