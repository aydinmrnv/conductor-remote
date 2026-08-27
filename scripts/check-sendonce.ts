/**
 * The send memo (`src/sendonce.ts`), which decides whether a prompt is typed into
 * Conductor a second time.
 *
 * It earns a test the way the UI lock and the first-prompt budgets do: both of its
 * failure modes are pure control flow, both typecheck perfectly, and neither is
 * visible until it has already happened to someone. Remember too little and Retry
 * doubles the prompt, which is the bug this was written for. Remember too much — a
 * *failure*, say — and Retry silently does nothing for ten minutes, and the prompt is
 * lost rather than doubled, which is the worse of the two and the easier mistake to
 * make while editing `keep`.
 *
 * No relay, no Conductor, no Mac: the module takes a function and a key.
 */
import assert from 'node:assert'
import { SendOnce } from '../src/sendonce.ts'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

let failures = 0
function check(what: string, ok: boolean): void {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`)
	if (!ok) failures++
}

interface Answer {
	status: number
	tag: string
}

const memo = () => new SendOnce<Answer>({ keep: a => a.status === 200 || a.status === 202, ttlMs: 400 })

// A second tap of the same bubble must not reach Conductor again.
{
	const once = memo()
	let runs = 0
	const send = async (): Promise<Answer> => {
		runs++
		return { status: 200, tag: `run-${runs}` }
	}
	const first = await once.run('tap-1', send)
	const second = await once.run('tap-1', send)
	check('a delivered send runs once', runs === 1)
	check('and the repeat is answered with the first outcome', second.tag === first.tag)
}

// Two things the user actually meant are two prompts, however alike they read.
{
	const once = memo()
	let runs = 0
	const send = async (): Promise<Answer> => ({ status: 200, tag: `run-${++runs}` })
	await once.run('tap-1', send)
	await once.run('tap-2', send)
	check('a different tap of the same words still sends', runs === 2)
}

// The one that matters most: a real failure has to stay retryable.
{
	const once = memo()
	let runs = 0
	const send = async (): Promise<Answer> => {
		runs++
		return runs === 1 ? { status: 502, tag: 'failed' } : { status: 200, tag: 'landed' }
	}
	const first = await once.run('tap-1', send)
	const second = await once.run('tap-1', send)
	check('a failed send is not remembered', first.status === 502 && runs === 2)
	check('so Retry gets a real attempt and can land', second.tag === 'landed')
}

// A parked send is final from the phone's side, so parking twice would queue twice.
{
	const once = memo()
	let runs = 0
	const send = async (): Promise<Answer> => ({ status: 202, tag: `park-${++runs}` })
	await once.run('tap-1', send)
	await once.run('tap-1', send)
	check('a parked send is remembered like a delivered one', runs === 1)
}

// The phone gives up at 75s and the relay's own budget is 55s, so Retry can arrive
// while the first run still holds the UI lock. A second run would type it again.
{
	const once = memo()
	let runs = 0
	const send = async (): Promise<Answer> => {
		runs++
		await sleep(150)
		return { status: 200, tag: `run-${runs}` }
	}
	const [a, b] = await Promise.all([once.run('tap-1', send), once.run('tap-1', send)])
	check('a repeat arriving mid-send joins it rather than starting another', runs === 1)
	check('and both callers get the same answer', a.tag === b.tag && a.tag === 'run-1')
}

// A throw is an outcome too, and it must not wedge the key.
{
	const once = memo()
	let runs = 0
	const send = async (): Promise<Answer> => {
		runs++
		if (runs === 1) throw new Error('conductor went away')
		return { status: 200, tag: 'landed' }
	}
	await assert.rejects(() => once.run('tap-1', send))
	const after = await once.run('tap-1', send)
	check('a throw leaves nothing behind and the key is usable again', after.tag === 'landed' && runs === 2)
}

// Entries expire, or the map is a leak with a long fuse.
{
	const once = memo()
	let runs = 0
	const send = async (): Promise<Answer> => ({ status: 200, tag: `run-${++runs}` })
	await once.run('tap-1', send)
	check('a fresh outcome is recalled', once.recall('tap-1') !== null)
	await sleep(500)
	check('an expired one is not', once.recall('tap-1') === null)
	await once.run('tap-1', send)
	check('and the key runs again once it has expired', runs === 2)
}

// No key is the MCP caller and the older cached PWA: unchanged behaviour, not a guess.
{
	const once = memo()
	let runs = 0
	const send = async (): Promise<Answer> => ({ status: 200, tag: `run-${++runs}` })
	await once.run(undefined, send)
	await once.run(undefined, send)
	check('an unkeyed caller is never deduped', runs === 2)
}

console.log(failures ? `sendonce: ${failures} failure(s)` : 'sendonce: send memo ok')
process.exit(failures ? 1 : 0)
