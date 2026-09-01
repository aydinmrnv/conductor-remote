import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import { matchQuery } from '../src/search.ts'

/**
 * The match grammar (src/search.ts ▸ matchQuery), which decides whether a search
 * finds the sentence someone remembers. Both of its failure modes are silent and
 * look like "no results": an expression FTS5 refuses to parse surfaces as an error
 * the pane reads as an empty index, and an OR-of-common-words query buries the one
 * chunk holding the exact phrase under every chunk that merely uses the words a lot
 * — the live bug this file pins ("may i run the" matched nothing anyone wanted).
 * The ranking half runs against a real in-memory FTS5 table rather than string
 * asserts alone, because the string can be right and the semantics still wrong.
 */

describe('matchQuery', () => {
	test('nothing searchable is null, not an FTS5 error', () => {
		expect(matchQuery('')).toBeNull()
		expect(matchQuery('   ')).toBeNull()
		expect(matchQuery('""')).toBeNull()
		expect(matchQuery('“”')).toBeNull()
		expect(matchQuery('- * : ( )')).toBeNull()
	})

	test('a single word keeps the old shape: quoted, prefix from three characters', () => {
		expect(matchQuery('lamp')).toBe('"lamp"*')
		expect(matchQuery('la')).toBe('"la"')
		expect(matchQuery('lamp ')).toBe('"lamp"')
	})

	test('several words add one phrase term beside the OR tokens', () => {
		expect(matchQuery('manual lamp ')).toBe('("manual lamp" OR "manual" OR "lamp")')
		expect(matchQuery('may i run the')).toBe('("may i run the"* OR "may" OR "i" OR "run" OR "the"*)')
	})

	test('a quoted phrase is required, loose words stay OR', () => {
		expect(matchQuery('"race condition"')).toBe('"race condition"')
		expect(matchQuery('"race condition" parked')).toBe('"race condition" AND "parked"*')
		expect(matchQuery('fix "race condition" parked queue')).toBe(
			'"race condition" AND ("fix" OR "parked queue"* OR "parked" OR "queue"*)'
		)
	})

	test('curly quotes count — iOS smart punctuation sends “” for the quote key', () => {
		expect(matchQuery('“race condition” parked')).toBe('"race condition" AND "parked"*')
	})

	test('an unclosed quote is the phrase still being typed, prefix and all', () => {
		expect(matchQuery('"may i run')).toBe('"may i run"*')
		expect(matchQuery('"may i ru')).toBe('"may i ru"')
	})

	test('a leading closed empty quote does not flip which segments count as quoted', () => {
		// The report that started this: `""may i run the` — two quotes, then the phrase.
		expect(matchQuery('""may i run the')).toBe('("may i run the"* OR "may" OR "i" OR "run" OR "the"*)')
	})
})

describe('matchQuery against real FTS5', () => {
	const db = new DatabaseSync(':memory:')
	db.exec("CREATE VIRTUAL TABLE chunks USING fts5(body, tokenize='porter unicode61')")
	const insert = db.prepare('INSERT INTO chunks(body) VALUES (?)')
	// One chunk holds the exact sentence; the others use the same words more often.
	insert.run('The controls are the correct local path. May I run the separate stop check?')
	insert.run('Running the headless artifact render. The first run may do a full import, and the run may repeat.')
	insert.run('The build is still running. The CI run may not have triggered, and the retry may run the same way.')
	insert.run('A parked prompt survives a race condition in the queue.')
	const search = (raw: string): string[] => {
		const match = matchQuery(raw)
		if (!match) return []
		return (
			db.prepare('SELECT body FROM chunks WHERE chunks MATCH ? ORDER BY bm25(chunks)').all(match) as {
				body: string
			}[]
		).map(r => r.body)
	}

	test('every expression parses, hostile input included', () => {
		const inputs = [
			'may i run the',
			'"may i run the',
			'""may i run the',
			'“may i run the”',
			"can't fix the drawer",
			'NEAR AND OR NOT',
			'foo* -bar :baz (qux',
			'a "b" c "d e" f',
			'🙂 "🙂 ok"'
		]
		for (const raw of inputs) expect(() => search(raw), raw).not.toThrow()
	})

	test('the exact sentence outranks the chunks that merely use its words', () => {
		expect(search('may i run the')[0]).toContain('May I run the separate stop check')
	})

	test('a quoted phrase drops every chunk that lacks it', () => {
		expect(search('"may i run the" ')).toHaveLength(1)
		expect(search('"race condition" parked')).toHaveLength(1)
	})

	test('stemming still applies inside quotes', () => {
		expect(search('"running the headless" ')).toHaveLength(1)
	})
})
