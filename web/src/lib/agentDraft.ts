import type { AgentPatch } from './types.ts'

/**
 * Staged agent settings — a model / effort / plan / fast change picked on the
 * phone that Conductor hasn't been told about yet; it rides along with the next
 * prompt (hooks.ts ▸ `useSendPrompt`).
 *
 * Persisted per session id for the same reason composer drafts are (lib/draft.ts):
 * the text and the settings are one intent ("send this, on that model"), so an
 * iOS PWA relaunch that restores the draft but forgets the model would quietly
 * send it on the old one.
 */
const PREFIX = 'conductor-remote-agent:'

/** Every persisted staged patch, keyed by session id — read once at boot to seed the store. */
export function loadAgentDrafts(): Record<string, AgentPatch> {
	const staged: Record<string, AgentPatch> = {}
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (!key?.startsWith(PREFIX)) continue
			const value = localStorage.getItem(key)
			if (value) staged[key.slice(PREFIX.length)] = JSON.parse(value) as AgentPatch
		}
	} catch {}
	return staged
}

export function writeAgentDraft(sessionId: string, patch: AgentPatch): void {
	try {
		if (Object.keys(patch).length) localStorage.setItem(PREFIX + sessionId, JSON.stringify(patch))
		else localStorage.removeItem(PREFIX + sessionId)
	} catch {}
}
