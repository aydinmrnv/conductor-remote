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
