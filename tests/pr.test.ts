import { describe, expect, test } from 'vitest'
import { hasFailedChecks } from '../src/pr.ts'

describe('pull request check failures', () => {
	test('does not flag missing, successful, neutral, skipped, or pending checks', () => {
		expect(hasFailedChecks(null)).toBe(false)
		expect(hasFailedChecks([{ conclusion: 'SUCCESS' }, { conclusion: 'NEUTRAL' }, { conclusion: 'SKIPPED' }])).toBe(
			false
		)
		expect(hasFailedChecks([{ state: 'PENDING' }])).toBe(false)
	})

	test.each([
		{ conclusion: 'FAILURE' },
		{ conclusion: 'TIMED_OUT' },
		{ state: 'FAILURE' },
		{ state: 'ERROR' }
	])('flags a failed check result: %j', result => {
		expect(hasFailedChecks([result])).toBe(true)
	})
})
