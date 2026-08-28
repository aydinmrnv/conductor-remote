/**
 * Conductor adds `NEW` to a picker item during a rollout. It is a badge, while
 * the composer and the phone use the stable model name. Guard the shared
 * conversion so the relay cannot show a badge as part of a model choice again.
 */
import { groupModelPickerLabels, modelPickerLabel } from '../src/shared.ts'

const cases = [
	['Opus 5 NEW', 'Opus 5'],
	['Sonnet 4.6', 'Sonnet 4.6'],
	['Sonnet 4.6 1M', 'Sonnet 4.6 1M'],
	['NEW Model', 'NEW Model']
] as const

let failures = 0
for (const [input, expected] of cases) {
	const actual = modelPickerLabel(input)
	if (actual === expected) {
		console.info(`  ok    ${input} → ${actual}`)
	} else {
		console.error(`  FAIL  ${input} → ${actual}; expected ${expected}`)
		failures++
	}
}

const groups = groupModelPickerLabels(['Opus 5', 'Opus 5 1M', 'Sonnet 4.6', 'openai/gpt-5.4'])
const opus = groups.find(group => group.label === 'Opus')?.models.join(',')
const sonnet = groups.find(group => group.label === 'Sonnet')?.models.join(',')
const openai = groups.find(group => group.label === 'openai')?.models.join(',')
if (opus === 'Opus 5,Opus 5 1M' && sonnet === 'Sonnet 4.6' && openai === 'openai/gpt-5.4') {
	console.info('  ok    groups model families')
} else {
	console.error(`  FAIL  groups model families; got ${JSON.stringify(groups)}`)
	failures++
}

if (failures) process.exit(1)
console.info('model labels: stable names ok')
