/**
 * Cursor handoff and bounded nearby reads are one MCP conversation split across two
 * tools. Typechecking each half cannot catch a cursor dropped from `search_chats`, a
 * neighborhood that only expands one direction, or a formatter that exceeds the
 * advertised context budget, so exercise that handoff as an agent sees it.
 *
 * Portable, stdlib-only, strip-clean — see CLAUDE.md.
 */
import assert from 'node:assert/strict'

import { chatCursor, parseChatCursor } from '../src/chat-cursor.ts'
import { createTools, type RelayCall } from '../src/mcp-tools.ts'
import { foldHits, type SearchHit } from '../src/search.ts'
import type { TranscriptEntry } from '../src/transcript.ts'

function tool(name: string, call: RelayCall) {
	const found = createTools(call).find(candidate => candidate.name === name)
	assert.ok(found, `${name} exists`)
	return found
}

function entry(rowid: number, role: TranscriptEntry['role'], text: string): TranscriptEntry {
	return { id: `entry-${rowid}-${role}`, rowid, role, text, ts: '2026-08-31T00:00:00Z', queued: false }
}

const hits: SearchHit[] = [
	{
		sessionId: 'chat-a',
		srcRowid: 20,
		role: 'assistant',
		at: '2026-08-31T00:00:00Z',
		score: 10,
		snippet: 'first hit'
	},
	{
		sessionId: 'chat-b',
		srcRowid: 40,
		role: 'user',
		at: '2026-08-30T00:00:00Z',
		score: 9,
		snippet: 'second hit'
	}
]
const folded = foldHits(hits, () => ({ id: 'workspace-1' }))
assert.deepEqual(
	folded[0]?.snippets.map(snippet => [snippet.sessionId, snippet.cursor]),
	[
		['chat-a', chatCursor(20)],
		['chat-b', chatCursor(40)]
	],
	'each grouped search excerpt keeps its own chat and source cursor'
)
assert.equal(parseChatCursor(chatCursor(987_654)), 987_654, 'cursor round-trips')
assert.equal(parseChatCursor('987654'), null, 'raw row ids are not accepted as cursors')

const searchResponse = {
	query: 'hit',
	index: { chunks: 2, ready: true, progress: 1 },
	results: [
		{
			...folded[0],
			workspace: {
				id: 'workspace-1',
				workspace_name: 'Cursor workspace',
				pr_title: null,
				branch: 'feat/cursors',
				directory_name: 'cursor-v1',
				repo_name: 'conductor-remote',
				state: 'ready',
				archived: false
			},
			sessionTitle: 'Cursor chat'
		}
	]
}
const search = tool('search_chats', async <T>() => searchResponse as T)
const searchText = await search.run({ query: 'hit' })
assert.match(searchText, new RegExp(`session_id: chat-a  cursor: ${chatCursor(20)}`))
assert.match(searchText, new RegExp(`session_id: chat-b  cursor: ${chatCursor(40)}`))

const transcript = [
	entry(10, 'user', 'ten'),
	entry(20, 'assistant', 'twenty'),
	entry(30, 'assistant', 'thirty'),
	entry(40, 'user', 'forty'),
	entry(50, 'assistant', 'fifty')
]
const read = tool('read_chat', async <T>() => ({ entries: transcript, cursor: 50 }) as T)

const nearby = await read.run({ session_id: 'chat-a', near: chatCursor(30), before: 1, after: 1 })
assert.doesNotMatch(nearby, /ten|fifty/, 'nearby read excludes entries outside the requested window')
assert.match(nearby, /twenty[\s\S]*thirty[\s\S]*forty/, 'nearby read includes both directions in order')
assert.match(nearby, new RegExp(`older_cursor: ${chatCursor(20)}`))
assert.match(nearby, new RegExp(`newer_cursor: ${chatCursor(40)}`))

const olderOnly = await read.run({ session_id: 'chat-a', near: chatCursor(30), before: 2, after: 0 })
assert.match(olderOnly, /ten[\s\S]*twenty[\s\S]*thirty/, 'before can expand independently')
assert.doesNotMatch(olderOnly, /forty|fifty/)

const newerOnly = await read.run({ session_id: 'chat-a', near: chatCursor(30), before: 0, after: 2 })
assert.doesNotMatch(newerOnly, /ten|twenty/)
assert.match(newerOnly, /thirty[\s\S]*forty[\s\S]*fifty/, 'after can expand independently')

const longTranscript = [
	entry(10, 'user', 'a'.repeat(10_000)),
	entry(20, 'assistant', 'b'.repeat(10_000)),
	entry(30, 'user', 'c'.repeat(10_000))
]
const boundedRead = tool('read_chat', async <T>() => ({ entries: longTranscript, cursor: 30 }) as T)
const bounded = await boundedRead.run({
	session_id: 'chat-a',
	near: chatCursor(20),
	before: 1,
	after: 1,
	max_chars: 1_000
})
assert.ok(bounded.length <= 1_000, `bounded output is ${bounded.length} chars`)
assert.match(bounded, /\[user\] a+/)
assert.match(bounded, /\[assistant\] b+/)
assert.match(bounded, /\[user\] c+/)

await assert.rejects(
	read.run({ session_id: 'chat-a', near: chatCursor(999) }),
	/near cursor is not in that session/,
	'a cursor cannot be used against a different chat'
)

console.info('mcp chat read: cursors, two-sided expansion and output budget ok')
