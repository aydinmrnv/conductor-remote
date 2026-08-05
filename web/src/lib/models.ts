/**
 * Conductor's model menu, cached across app loads.
 *
 * Reading the list is not a cheap query: `GET /api/sessions/:id/models` drives
 * AppleScript that activates Conductor, focuses the workspace, selects the chat
 * tab and opens the real picker — seconds of stolen focus on the Mac. So the
 * picker paints from this cache and revalidates behind it (see hooks.ts ▸
 * `useModels`) instead of making every open wait on the desktop.
 *
 * Keyed by `agent_type` (claude | codex | cursor | acp), which is what decides
 * the menu's contents — not by session, or every new chat would start cold. The
 * timestamp seeds React Query's `initialDataUpdatedAt`, so a list older than the
 * stale window refetches on open and a fresh one doesn't.
 */
const KEY = 'conductor-remote-models'

export interface CachedModels {
	models: string[]
	/** Epoch ms the list was last read off Conductor. */
	at: number
}

function readAll(): Record<string, CachedModels> {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, CachedModels>
	} catch {
		return {}
	}
}

export function readModelCache(agentType: string): CachedModels | undefined {
	const hit = readAll()[agentType]
	return hit?.models?.length ? hit : undefined
}

export function writeModelCache(agentType: string, models: string[], at: number): void {
	try {
		localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [agentType]: { models, at } }))
	} catch {}
}
