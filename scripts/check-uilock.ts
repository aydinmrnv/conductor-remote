/**
 * Assert the UI lock serializes, prioritises, drains and refuses correctly.
 *
 * `uiTurn` (src/writes.ts) is the only thing standing between two writers and a
 * prompt landing in whatever workspace the other one focused. It used to be a
 * three-line promise chain, safe because the only two writers were a person tapping
 * a button and a delivery queue. `src/mcp.ts` changed that: any number of agents can
 * now drive it, so the lock grew a bounded queue and two priorities, and that is real
 * logic with a failure mode nothing else here would catch.
 *
 * It costs something specific. A run that fails to release the lock wedges *every*
 * future write with no error and no fix from the phone, and a priority bug puts a
 * human tap behind a minute of machine work. `tsc` reads this file happily either
 * way — it missed both bugs this script found while it was being written: the lock
 * being released a microtask after the caller resumed, and the cascade that followed.
 *
 * No macOS, no Conductor, no relay, no AppleScript: the operations are timers. That
 * is the point — the queue is plain control flow, and it is the control flow being
 * tested. Portable, so the ubuntu CI job runs it too.
 *
 * Strip-clean (plain-node type-stripping), stdlib-only — see CLAUDE.md.
 */
import { UiBusyError, uiQueueDepth, uiTurn, withUiPriority } from '../src/writes.ts'

const failures: string[] = []
function check(label: string, pass: boolean, detail = ''): void {
	if (pass) console.info(`  ok    ${label}`)
	else {
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
		failures.push(label)
	}
}

/** A stand-in for one AppleScript run: takes time, records the order it finished in. */
const order: string[] = []
const hold = (name: string, ms: number) => (): Promise<string> =>
	new Promise(resolve =>
		setTimeout(() => {
			order.push(name)
			resolve(name)
		}, ms)
	)

const idle = (): boolean => uiQueueDepth().waiting === 0 && !uiQueueDepth().busy

// One at a time, in the order asked.
{
	order.length = 0
	const runs = [uiTurn(hold('a', 40)), uiTurn(hold('b', 5)), uiTurn(hold('c', 5))]
	check('a run holds the lock while the rest wait', uiQueueDepth().waiting === 2 && uiQueueDepth().busy)
	await Promise.all(runs)
	check('they run in the order they arrived', order.join('') === 'abc', order.join(','))
	check('the queue drains to empty', idle())
}

// The person beats the machines, without interrupting work already under way.
{
	order.length = 0
	await Promise.all([
		withUiPriority('background', () => uiTurn(hold('bg-running', 30))),
		withUiPriority('background', () => uiTurn(hold('bg-1', 5))),
		withUiPriority('background', () => uiTurn(hold('bg-2', 5))),
		withUiPriority('interactive', () => uiTurn(hold('phone', 5)))
	])
	check('a running background op is never interrupted', order[0] === 'bg-running', order.join(','))
	check('the phone overtakes queued agent work', order[1] === 'phone', order.join(','))
	check('agent work keeps its own order behind it', order.slice(2).join(',') === 'bg-1,bg-2', order.join(','))
}

// A failed run must hand the lock on. This is the one that wedges everything.
{
	order.length = 0
	const rejected = uiTurn(hold('never', 1))
		.then(() => uiTurn(() => Promise.reject(new Error('nope'))))
		.catch(() => order.push('rejected'))
	await rejected
	await uiTurn(hold('after', 1))
	check('a rejected run still releases the lock', order.join(',').endsWith('rejected,after'), order.join(','))

	const threw = await uiTurn<string>(() => {
		throw new Error('sync throw')
	}).catch(() => 'caught')
	check('a synchronous throw is that run’s failure, not a crash', threw === 'caught')
	await uiTurn(hold('still-works', 1))
	check('the lock survives a synchronous throw', idle())
}

// Depth is bounded: past the cap a caller is refused rather than queued behind a
// minute of UI work it will time out waiting for anyway.
{
	const runs = [uiTurn(hold('holding', 25))]
	for (let i = 0; i < 4; i++) runs.push(uiTurn(hold(`queued-${i}`, 1)))
	check('the cap allows four waiters', uiQueueDepth().waiting === 4, String(uiQueueDepth().waiting))

	let refused: unknown
	await uiTurn(hold('over-the-cap', 1)).catch(err => {
		refused = err
	})
	check('the fifth waiter is refused, not queued', refused instanceof UiBusyError)
	check('the refusal reports the depth', (refused as UiBusyError)?.waiting === 4)

	await Promise.all(runs)
	check('a refusal leaves the queue intact', idle())
	await uiTurn(hold('recovered', 1))
	check('the lock still works after a refusal', idle())
}

if (failures.length) {
	console.error(`\nuilock: ${failures.length} check(s) failed — ${failures.join(', ')}`)
	process.exit(1)
}
console.info('uilock: queue ok')
