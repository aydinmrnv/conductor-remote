/**
 * Conductor adds `NEW` to a picker item during a rollout. It is a badge, while
 * the composer and the phone use the stable model name. Guard the shared
 * conversion so the relay cannot show a badge as part of a model choice again.
 */
import { modelPickerLabel } from '../src/shared.ts'

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

if (failures) process.exit(1)
console.info('model labels: stable names ok')
