/**
 * Chat actions belong to the latest assistant response in the current turn.
 *
 * Tool, reasoning, and system rows can all trail that response. In particular,
 * provider failures are rendered as system notices; they must not make Copy/Fork
 * disappear. A newer user prompt is different: until that turn has an assistant
 * response, actions must not be attached to the previous turn.
 */
import { latestAssistantForActions } from '../web/src/lib/transcript-actions.ts'
import type { TranscriptEntry } from '../web/src/lib/types.ts'

function entry(role: TranscriptEntry['role'], id: string, rowid: number): TranscriptEntry {
	return { id, rowid, role, text: id, ts: '2026-08-31T00:00:00.000Z', queued: false }
}

const previous = entry('assistant', 'previous', 1)
const user = entry('user', 'question', 2)
const answer = entry('assistant', 'answer', 3)

const cases: Array<{ label: string; entries: TranscriptEntry[]; expected: TranscriptEntry | null }> = [
	{
		label: 'keeps actions after trailing tools and a capacity notice',
		entries: [
			previous,
			user,
			answer,
			entry('thinking', 'reasoning', 4),
			entry('tool', 'bash', 5),
			entry('system', 'Selected model is at capacity', 6)
		],
		expected: answer
	},
	{
		label: 'does not attach actions to the previous turn after a newer user prompt',
		entries: [previous, user, entry('tool', 'work without a response', 3), entry('system', 'aborted', 4)],
		expected: null
	},
	{
		label: 'finds a direct latest assistant response',
		entries: [user, answer],
		expected: answer
	},
	{
		label: 'returns no action target for a transcript without an assistant response',
		entries: [entry('system', 'notice', 1)],
		expected: null
	}
]

let failures = 0
for (const test of cases) {
	const actual = latestAssistantForActions(test.entries)
	if (actual === test.expected) console.info(`  ok    ${test.label}`)
	else {
		console.error(`  FAIL  ${test.label}; got ${actual?.id ?? 'null'}, expected ${test.expected?.id ?? 'null'}`)
		failures++
	}
}

if (failures) process.exit(1)
console.info('transcript actions: latest response boundary ok')
