/**
 * Verify the public config-set grammar and the one-setting merge that protects
 * unrelated LaunchAgent values. This check leaves service state unchanged.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { serviceEnvironmentWithSetting } from '../src/config.ts'

const cli = path.join(import.meta.dirname, '..', 'bin', 'cli.js')
const failures: string[] = []

function check(name: string, ok: boolean, detail: string): void {
	if (ok) {
		console.info(`  ok    ${name}`)
		return
	}
	console.error(`  FAIL  ${name}: ${detail}`)
	failures.push(name)
}

function run(...args: string[]): { code: number; output: string } {
	const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
	return { code: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

{
	const result = run('--help')
	check(
		'help documents config set',
		result.code === 0 && result.output.includes('config set <setting> <value>'),
		result.output
	)
}

{
	const result = run('config', 'set')
	check('config set requires a name and value', result.code === 1 && result.output.includes('usage:'), result.output)
}

{
	const result = run('config', 'set', 'prevent-screen-lock', 'maybe')
	check(
		'screen-lock config accepts only on or off',
		result.code === 1 && result.output.includes('must be on or off'),
		result.output
	)
}

{
	const result = run('config', 'set', 'made-up', 'value')
	check(
		'unknown config names are rejected',
		result.code === 1 && result.output.includes('unknown setting'),
		result.output
	)
}

{
	const next = serviceEnvironmentWithSetting(
		{ PATH: '/bin', RELAY_PORT: '9999', WRITE_STRATEGY: 'ambient' },
		{ RELAY_PORT: '8787', WRITE_STRATEGY: 'applescript' },
		['RELAY_PORT', 'WRITE_STRATEGY', 'PREVENT_SCREEN_LOCK'],
		'PREVENT_SCREEN_LOCK',
		'off'
	)
	check('config set keeps ordinary process environment', next.PATH === '/bin', JSON.stringify(next))
	check('config set preserves installed values', next.RELAY_PORT === '8787', JSON.stringify(next))
	check('installed config wins over ambient shell values', next.WRITE_STRATEGY === 'applescript', JSON.stringify(next))
	check('config set applies the requested value', next.PREVENT_SCREEN_LOCK === 'off', JSON.stringify(next))
}

if (failures.length > 0) {
	console.error(`config: ${failures.length} check(s) failed`)
	process.exit(1)
}
console.info('config: CLI and merge ok')
