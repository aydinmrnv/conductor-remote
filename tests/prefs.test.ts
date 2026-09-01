import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { PrefsStore } from '../src/prefs.ts'

const temporaryDirs: string[] = []

function testStore(): { store: PrefsStore; file: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-remote-prefs-'))
	temporaryDirs.push(dir)
	const file = path.join(dir, 'prefs.json')
	return { store: new PrefsStore(file), file }
}

afterEach(() => {
	for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('host preference store', () => {
	test('merges read marks monotonically', () => {
		const { store } = testStore()
		store.patch({ readMarks: { a: '2026-08-01', b: '2026-08-03' } })
		const prefs = store.patch({ readMarks: { a: '2026-07-01', b: '2026-08-04', c: '2026-08-02' } })
		expect(prefs.readMarks).toEqual({ a: '2026-08-01', b: '2026-08-04', c: '2026-08-02' })
	})

	test('keeps a deletion tombstone over a stale or tied live draft', () => {
		const { store } = testStore()
		store.patch({
			drafts: { chat: { text: 'already sent', agent: { model: 'Sonnet' }, updatedAt: 20, deleted: false } }
		})
		store.patch({ drafts: { chat: { text: '', agent: {}, updatedAt: 30, deleted: true } } })
		store.patch({ drafts: { chat: { text: 'stale', agent: {}, updatedAt: 29, deleted: false } } })
		store.patch({ drafts: { chat: { text: 'tie', agent: {}, updatedAt: 30, deleted: false } } })
		expect(store.read().drafts.chat).toEqual({ text: '', agent: {}, updatedAt: 30, deleted: true })
	})

	test('accepts a newer edit and stores text with staged agent settings as one revision', () => {
		const { store } = testStore()
		store.patch({ drafts: { chat: { text: '', agent: {}, updatedAt: 10, deleted: true } } })
		const prefs = store.patch({
			drafts: {
				chat: {
					text: 'try another approach',
					agent: { model: 'Codex', effort: 'high', plan: true },
					updatedAt: 11,
					deleted: false
				}
			}
		})
		expect(prefs.drafts.chat).toMatchObject({
			text: 'try another approach',
			agent: { model: 'Codex', effort: 'high', plan: true },
			updatedAt: 11,
			deleted: false
		})
	})

	test('sanitizes hand-edited data and writes the file privately', () => {
		const { store, file } = testStore()
		const prefs = store.patch({
			readMarks: { good: '2026-08-01', empty: '', bad: 42 as unknown as string },
			drafts: {
				good: { text: 'hello', agent: { model: 'Codex', plan: true }, updatedAt: 1, deleted: false },
				bad: { text: 'ignored', agent: {}, updatedAt: -1, deleted: false }
			}
		})
		expect(prefs.readMarks).toEqual({ good: '2026-08-01' })
		expect(Object.keys(prefs.drafts)).toEqual(['good'])
		expect(fs.statSync(file).mode & 0o777).toBe(0o600)
		expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(prefs)
	})
})
