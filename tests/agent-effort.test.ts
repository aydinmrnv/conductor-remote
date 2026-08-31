import { describe, expect, test } from 'vitest'
import type { ConductorDb } from '../src/db.ts'
import { Reads } from '../src/reads.ts'

const rawSessions = [
	{
		id: 'codex-chat',
		agent_type: 'codex',
		claude_effort_level: 'high',
		codex_thinking_level: 'max'
	},
	{
		id: 'claude-chat',
		agent_type: 'claude',
		claude_effort_level: 'xhigh',
		codex_thinking_level: 'high'
	}
]

let sql = ''
const db = {
	query(statement: string) {
		sql = statement
		return rawSessions
	}
} as unknown as ConductorDb

const sessions = new Reads(db, '/unused').listSessions('workspace')

describe('session effort reads', () => {
	test('selects the provider-specific fields', () => {
		expect(sql).toMatch(/codex_thinking_level/)
	})

	test('uses the Codex effort instead of the stale Claude column', () => {
		expect(sessions.find(session => session.id === 'codex-chat')?.claude_effort_level).toBe('max')
	})

	test('keeps Claude effort and the stable wire shape', () => {
		expect(sessions.find(session => session.id === 'claude-chat')?.claude_effort_level).toBe('xhigh')
		expect(sessions.every(session => !('codex_thinking_level' in session))).toBe(true)
	})
})
