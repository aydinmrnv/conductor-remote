/**
 * The server model cache supplies a new workspace before it has a chat to inspect.
 * Keep its normalisation and restart persistence covered without activating Conductor.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ModelCache } from '../src/model-cache.ts'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-model-cache-'))
const file = path.join(dir, 'models.json')
const cache = new ModelCache(file)
const failures: string[] = []

function check(label: string, pass: boolean): void {
	if (pass) console.info(`  ok    ${label}`)
	else {
		console.error(`  FAIL  ${label}`)
		failures.push(label)
	}
}

cache.remember('claude', ['Opus 5 NEW', 'Sonnet 4.6'])
cache.rememberModel('claude', 'Opus 5')
cache.remember('codex', ['GPT-5.4'])

const groups = cache.list()
check(
	'normalises temporary picker badges and de-duplicates labels',
	groups.find(group => group.agentType === 'claude')?.models.join(',') === 'Opus 5,Sonnet 4.6'
)
check('keeps picker labels separate by harness', groups.map(group => group.agentType).join(',') === 'claude,codex')

const restored = new ModelCache(file).list()
check('survives a relay restart', JSON.stringify(restored) === JSON.stringify(groups))

fs.rmSync(dir, { recursive: true, force: true })
if (failures.length) {
	console.error(`\nmodel cache: ${failures.length} check(s) failed`)
	process.exit(1)
}
console.info('model cache: labels persist ok')
