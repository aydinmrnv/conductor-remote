/**
 * Composer drafts — unsent prompt text, per workspace, mirrored to localStorage
 * so a force-quit (or an iOS PWA relaunch) never loses typing.
 *
 * The store owns the live copy (see store.ts) because a draft is no longer only
 * typed: a first prompt that couldn't be delivered is stashed here, and the
 * composer has to show it without waiting for a remount.
 */
const PREFIX = 'conductor-remote-draft:'

/** Every persisted draft, keyed by workspace id — read once at boot to seed the store. */
export function loadDrafts(): Record<string, string> {
	const drafts: Record<string, string> = {}
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (!key?.startsWith(PREFIX)) continue
			const value = localStorage.getItem(key)
			if (value) drafts[key.slice(PREFIX.length)] = value
		}
	} catch {}
	return drafts
}

export function writeDraft(workspaceId: string, value: string): void {
	try {
		if (value) localStorage.setItem(PREFIX + workspaceId, value)
		else localStorage.removeItem(PREFIX + workspaceId)
	} catch {}
}
