import { hasFailedChecks } from '../src/pr.ts'

let failures = 0

function check(label: string, actual: boolean, expected: boolean): void {
	if (actual === expected) return
	failures += 1
	console.error(`${label}: expected ${expected}, got ${actual}`)
}

check('missing checks stay clear', hasFailedChecks(null), false)
check(
	'success, neutral, and skipped checks stay clear',
	hasFailedChecks([{ conclusion: 'SUCCESS' }, { conclusion: 'NEUTRAL' }, { conclusion: 'SKIPPED' }]),
	false
)
check('pending checks stay clear', hasFailedChecks([{ state: 'PENDING' }]), false)
check('a failed check run is flagged', hasFailedChecks([{ conclusion: 'FAILURE' }]), true)
check('a timed-out check run is flagged', hasFailedChecks([{ conclusion: 'TIMED_OUT' }]), true)
check('a failed status context is flagged', hasFailedChecks([{ state: 'FAILURE' }]), true)
check('an errored status context is flagged', hasFailedChecks([{ state: 'ERROR' }]), true)

if (failures) {
	console.error(`pr: ${failures} check(s) failed`)
	process.exit(1)
}

console.info('pr: check failure detection ok')
