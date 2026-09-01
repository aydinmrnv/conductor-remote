import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { lockBlocked, retryWontHelp, sendNeverStarted } from '../src/writes.ts'

/**
 * The three predicates that decide what `deliverPrompt` does with a failed run.
 * Each is a substring match against a sentence this repo writes itself, and each
 * fails silently in the direction that costs the most:
 *
 *  - `sendNeverStarted` too wide skips the confirm window after a run that *did*
 *    send, so the retry types the same prompt into the chat a second time — the
 *    duplicate the window exists to prevent.
 *  - `lockBlocked` too narrow burns a phone's whole budget against a locked Mac
 *    instead of parking the prompt for the queue that waits hours.
 *  - `retryWontHelp` too wide stops retrying a send a second attempt would land.
 */
const ERRORS = {
	locked:
		"The Mac is locked - the lock screen hides Conductor from the relay, so a send can't reach it. Unlock the Mac and send again.",
	lockedNoWindow:
		"The Mac is locked and Conductor has no window. Relaunching behind the lock screen is what leaves it wedged, so the relay won't - unlock the Mac and send again.",
	notTrusted: 'Conductor is not trusted for Accessibility',
	automationRefused: 'macOS blocked the relay from controlling the UI',
	noSession: 'no session id to target',
	noBranch: 'workspace has no branch to focus',
	paletteMiss: "the palette didn't land on sacramento-v1",
	noStrip: "couldn't identify the chat tab strip",
	tabMissing: 'chat tab 1 not found',
	timeout: 'Conductor took too long to respond',
	noWindow: "Can't get window 1 of process Conductor. Invalid index."
}

/** The sentence the send script itself errors with, read out of the script. */
const composerHeld = (() => {
	const source = readFileSync(path.join(import.meta.dirname, '..', 'src', 'writes.ts'), 'utf8')
	const found = source.match(/error "([^"]*still sitting in its composer[^"]*)"/)
	if (!found) throw new Error('the send script no longer errors with a composer-held sentence')
	return found[1]
})()

describe('send failure predicates', () => {
	test('only a composer-held run counts as having sent nothing', () => {
		expect(sendNeverStarted(composerHeld)).toBe(true)
		for (const [name, error] of Object.entries(ERRORS)) expect(sendNeverStarted(error), name).toBe(false)
	})

	test('a run that reported no error keeps its confirm window', () => {
		expect(sendNeverStarted(undefined)).toBe(false)
		expect(sendNeverStarted('')).toBe(false)
	})

	test('both lock refusals park, nothing else does', () => {
		expect(lockBlocked(ERRORS.locked)).toBe(true)
		expect(lockBlocked(ERRORS.lockedNoWindow)).toBe(true)
		for (const [name, error] of Object.entries(ERRORS)) {
			if (name.startsWith('locked')) continue
			expect(lockBlocked(error), name).toBe(false)
		}
		expect(lockBlocked(composerHeld)).toBe(false)
		expect(lockBlocked(undefined)).toBe(false)
	})

	test('only refusals a retry cannot fix stop the loop', () => {
		expect(retryWontHelp(ERRORS.notTrusted)).toBe(true)
		expect(retryWontHelp(ERRORS.automationRefused)).toBe(true)
		expect(retryWontHelp(ERRORS.noSession)).toBe(true)
		expect(retryWontHelp(ERRORS.noBranch)).toBe(true)
		for (const name of ['paletteMiss', 'noStrip', 'tabMissing', 'timeout', 'noWindow'] as const) {
			expect(retryWontHelp(ERRORS[name]), name).toBe(false)
		}
		expect(retryWontHelp(composerHeld)).toBe(false)
		expect(retryWontHelp(undefined)).toBe(false)
	})
})
