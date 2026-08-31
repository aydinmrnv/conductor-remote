import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { ModelCache } from '../src/model-cache.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('model cache', () => {
	test('normalizes labels, separates harnesses, and persists across restarts', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-model-cache-'))
		temporaryDirectories.push(directory)
		const file = path.join(directory, 'models.json')
		const cache = new ModelCache(file)

		cache.remember('claude', ['Opus 5 NEW', 'Sonnet 4.6'])
		cache.rememberModel('claude', 'Opus 5')
		cache.remember('codex', ['GPT-5.4'])

		const groups = cache.list()
		expect(groups.find(group => group.agentType === 'claude')?.models).toEqual(['Opus 5', 'Sonnet 4.6'])
		expect(groups.map(group => group.agentType)).toEqual(['claude', 'codex'])
		expect(new ModelCache(file).list()).toEqual(groups)
	})
})
