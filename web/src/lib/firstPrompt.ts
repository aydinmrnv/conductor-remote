/**
 * The first prompt of a workspace created from the phone, parked until its
 * worktree finishes setting up.
 *
 * Kept separate from the composer's draft on purpose: a draft is text the user
 * chose *not* to send yet and must never fire by itself, whereas this is a
 * prompt they already committed to by tapping "Create workspace". It survives a
 * reload (setup can outlast the app being open), and Conductor's own composer
 * holds the same text pre-filled, so nothing is lost if this never fires.
 */
const KEY = 'conductor-remote-first-prompt:'

export function seedFirstPrompt(workspaceId: string, text: string): void {
	try {
		localStorage.setItem(KEY + workspaceId, text)
	} catch {}
}

export function peekFirstPrompt(workspaceId: string): string | null {
	try {
		return localStorage.getItem(KEY + workspaceId)
	} catch {
		return null
	}
}

export function clearFirstPrompt(workspaceId: string): void {
	try {
		localStorage.removeItem(KEY + workspaceId)
	} catch {}
}
