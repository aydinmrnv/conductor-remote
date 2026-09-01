import type { TranscriptEntry } from './types.ts'

/**
 * Find the response that owns Copy/Fork in the current turn.
 *
 * Reasoning, tools, and system notices are supporting rows around a response, so
 * they do not replace it. A user row starts a new turn and prevents actions from
 * reaching back to an older response while that turn is unanswered.
 */
export function latestAssistantForActions(entries: readonly TranscriptEntry[]): TranscriptEntry | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i]
		if (entry.role === 'assistant') return entry
		if (entry.role === 'user') return null
	}
	return null
}

/**
 * The response that closes each turn — the last thing the agent said before the next
 * prompt, and the only place in that turn a fork can be cut from.
 *
 * An agent speaks several times inside one turn (a short update, more work, then the
 * answer), so a control under every assistant row would offer four cuts of one exchange,
 * three of which end a copy mid-answer.
 */
export function assistantTurnEnds(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
	const ends: TranscriptEntry[] = []
	let latest: TranscriptEntry | null = null
	for (const entry of entries) {
		if (entry.role === 'assistant') latest = entry
		else if (entry.role === 'user') {
			if (latest) ends.push(latest)
			latest = null
		}
	}
	if (latest) ends.push(latest)
	return ends
}
