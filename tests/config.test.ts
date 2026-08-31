import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { serviceEnvironmentWithSetting } from '../src/config.ts'

const cli = path.join(import.meta.dirname, '..', 'bin', 'cli.js')

function run(...args: string[]): { code: number; output: string } {
	const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
	return { code: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('config CLI', () => {
	test('documents config set in help', () => {
		const result = run('--help')
		expect(result.code).toBe(0)
		expect(result.output).toContain('config set <setting> <value>')
	})

	test('requires both a setting and a value', () => {
		const result = run('config', 'set')
		expect(result.code).toBe(1)
		expect(result.output).toContain('usage:')
	})

	test('validates values and setting names', () => {
		const invalidValue = run('config', 'set', 'prevent-screen-lock', 'maybe')
		expect(invalidValue.code).toBe(1)
		expect(invalidValue.output).toContain('must be on or off')

		const unknown = run('config', 'set', 'made-up', 'value')
		expect(unknown.code).toBe(1)
		expect(unknown.output).toContain('unknown setting')
	})
})

describe('service environment config', () => {
	test('merges one setting without losing installed or ordinary values', () => {
		const environment = serviceEnvironmentWithSetting(
			{ PATH: '/bin', RELAY_PORT: '9999', WRITE_STRATEGY: 'ambient' },
			{ RELAY_PORT: '8787', WRITE_STRATEGY: 'applescript' },
			['RELAY_PORT', 'WRITE_STRATEGY', 'PREVENT_SCREEN_LOCK'],
			'PREVENT_SCREEN_LOCK',
			'off'
		)

		expect(environment).toMatchObject({
			PATH: '/bin',
			RELAY_PORT: '8787',
			WRITE_STRATEGY: 'applescript',
			PREVENT_SCREEN_LOCK: 'off'
		})
	})
})
