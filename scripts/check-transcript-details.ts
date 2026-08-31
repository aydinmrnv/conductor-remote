/**
 * Tool rows are compact until opened, but opening one must reveal the actual
 * primary input rather than the old 160-character, single-line preview.
 */
import assert from 'node:assert/strict'

import { parseMessage } from '../src/transcript.ts'

const worktree = '/Users/example/conductor/workspaces/project/krakow'
const tail = `printf '%s\\n' '${'detail-'.repeat(32)}'`
const command = `cd ${worktree} && rg -n "first" src\n${tail}`
const content = JSON.stringify({
	type: 'assistant',
	message: {
		content: [
			{
				type: 'tool_use',
				name: 'Bash',
				input: { command }
			}
		]
	}
})

const [entry] = parseMessage(
	{
		rowid: 1,
		id: 'message-1',
		role: 'assistant',
		content,
		full_message: null,
		created_at: '2026-08-31T00:00:00.000Z',
		sent_at: '2026-08-31T00:00:00.000Z',
		queue_order: null
	},
	worktree
)

assert.ok(entry, 'tool entry is parsed')
assert.equal(entry.role, 'tool')
assert.equal(entry.text, 'Bash')
assert.equal(entry.detail, `rg -n "first" src\n${tail}`, 'worktree prefix is stripped without flattening the command')
assert.ok((entry.detail?.length ?? 0) > 160, 'tool detail is not clipped to the collapsed preview width')

console.info('transcript details: full command preserved for expansion')
