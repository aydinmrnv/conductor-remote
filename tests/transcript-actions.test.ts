import { describe, expect, test } from 'vitest'
import { latestAssistantForActions } from '../web/src/lib/transcript-actions.ts'
import type { TranscriptEntry } from '../web/src/lib/types.ts'

function entry(role: TranscriptEntry['role'], id: string, rowid: number): TranscriptEntry {
	return { id, rowid, role, text: id, ts: '2026-08-31T00:00:00.000Z', queued: false }
}

describe('latest assistant action target', () => {
	const previous = entry('assistant', 'previous', 1)
	const user = entry('user', 'question', 2)
	const answer = entry('assistant', 'answer', 3)

	test('keeps actions after trailing tools and a capacity notice', () => {
		expect(
			latestAssistantForActions([
				previous,
				user,
				answer,
				entry('thinking', 'reasoning', 4),
				entry('tool', 'bash', 5),
				entry('system', 'Selected model is at capacity', 6)
			])
		).toBe(answer)
	})

	test('does not reuse the previous turn after a new user prompt', () => {
		expect(
			latestAssistantForActions([previous, user, entry('tool', 'work without a response', 3), entry('system', 'aborted', 4)])
		).toBeNull()
	})

	test('finds a direct latest response', () => {
		expect(latestAssistantForActions([user, answer])).toBe(answer)
	})

	test('returns no target without an assistant response', () => {
		expect(latestAssistantForActions([entry('system', 'notice', 1)])).toBeNull()
	})
})
