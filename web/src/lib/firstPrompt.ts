/**
 * The first prompt of a workspace created from the phone, parked until its
 * worktree finishes setting up.
 *
 * Kept separate from the composer's draft on purpose: a draft is text the user
 * chose *not* to send yet and must never fire by itself, whereas this is a
 * prompt they already committed to by tapping "Create workspace". It survives a
 * reload (setup can outlast the app being open), and Conductor's own composer
 * holds the same text pre-filled, so nothing is lost if this never fires.
 *
 * Delivery is app-wide (hooks.ts ▸ `useFirstPromptDelivery`), so the record
 * carries its own attempt count and age: whoever picks it up next has to know
 * how many sends have already been spent on it, and a prompt whose workspace
 * never turns ready must eventually stop being retried rather than sit here
 * forever.
 */
const KEY = 'conductor-remote-first-prompt:'

export interface ParkedPrompt {
	workspaceId: string
	text: string
	/** Sends already spent on it — the cap is enforced by the caller. */
	attempts: number
	createdAt: number
}

function read(workspaceId: string): ParkedPrompt | null {
	let raw: string | null
	try {
		raw = localStorage.getItem(KEY + workspaceId)
	} catch {
		return null
	}
	if (!raw) return null
	// Records written before this was a JSON blob are bare prompt text.
	try {
		const parsed = JSON.parse(raw) as Partial<ParkedPrompt>
		if (typeof parsed?.text !== 'string') throw new Error('not a record')
		return {
			workspaceId,
			text: parsed.text,
			attempts: typeof parsed.attempts === 'number' ? parsed.attempts : 0,
			createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now()
		}
	} catch {
		return { workspaceId, text: raw, attempts: 0, createdAt: Date.now() }
	}
}

function write(entry: ParkedPrompt): void {
	try {
		const { text, attempts, createdAt } = entry
		localStorage.setItem(KEY + entry.workspaceId, JSON.stringify({ text, attempts, createdAt }))
	} catch {}
}

export function seedFirstPrompt(workspaceId: string, text: string): void {
	write({ workspaceId, text, attempts: 0, createdAt: Date.now() })
}

/** Everything still parked, oldest first — delivery works through them one at a time. */
export function listFirstPrompts(): ParkedPrompt[] {
	const parked: ParkedPrompt[] = []
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (!key?.startsWith(KEY)) continue
			const entry = read(key.slice(KEY.length))
			if (entry) parked.push(entry)
		}
	} catch {}
	return parked.sort((a, b) => a.createdAt - b.createdAt)
}

/** Record that a send is being spent on this prompt; returns the new attempt count. */
export function noteFirstPromptAttempt(workspaceId: string): number {
	const entry = read(workspaceId)
	if (!entry) return 0
	const attempts = entry.attempts + 1
	write({ ...entry, attempts })
	return attempts
}

export function clearFirstPrompt(workspaceId: string): void {
	try {
		localStorage.removeItem(KEY + workspaceId)
	} catch {}
}
