import { describe, expect, test } from 'vitest'
import { assistantTurnEnds, latestAssistantForActions } from '../web/src/lib/transcript-actions.ts'
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
			latestAssistantForActions([
				previous,
				user,
				entry('tool', 'work without a response', 3),
				entry('system', 'aborted', 4)
			])
		).toBeNull()
	})

	test('finds a direct latest response', () => {
		expect(latestAssistantForActions([user, answer])).toBe(answer)
	})

	test('returns no target without an assistant response', () => {
		expect(latestAssistantForActions([entry('system', 'notice', 1)])).toBeNull()
	})
})

describe('per-turn action targets', () => {
	test('offers one cut per turn, at the answer that closed it', () => {
		const first = entry('assistant', 'first answer', 3)
		const second = entry('assistant', 'second answer', 8)
		expect(
			assistantTurnEnds([
				entry('user', 'ask', 1),
				entry('thinking', 'reasoning', 2),
				first,
				entry('user', 'ask again', 4),
				entry('tool', 'bash', 5),
				entry('assistant', 'an update mid-turn', 6),
				entry('tool', 'more work', 7),
				second
			])
		).toEqual([first, second])
	})

	// The turn is unanswered, so its own cut does not exist yet — the previous answer
	// keeps the one it already offered rather than the control vanishing under it.
	test('keeps the last closed turn when a new prompt is waiting', () => {
		const answer = entry('assistant', 'answer', 2)
		expect(assistantTurnEnds([entry('user', 'ask', 1), answer, entry('user', 'ask again', 3)])).toEqual([answer])
	})

	test('has no target in a chat the agent has not answered', () => {
		expect(assistantTurnEnds([entry('user', 'ask', 1), entry('tool', 'bash', 2)])).toEqual([])
	})
})
