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

const groups = groupModelPickerLabels([
	'5.6 Terra',
	'Auto',
	'Composer 2.5',
	'Fable 5',
	'Grok 4.6',
	'Haiku 4.5',
	'Opus 5',
	'Sonnet 4.6',
	'opencode-go/grok-4.5',
	'openai/gpt-5.4',
	'unknown-model'
])
const anthropic = groups.find(group => group.label === 'Anthropic')?.models.join(',')
const cursor = groups.find(group => group.label === 'Cursor')?.models.join(',')
const openai = groups.find(group => group.label === 'OpenAI')?.models.join(',')
const opencode = groups.find(group => group.label === 'OpenCode')?.models.join(',')
const unknown = groups.find(group => group.label === 'Other')?.models.join(',')
if (
	anthropic === 'Fable 5,Haiku 4.5,Opus 5,Sonnet 4.6' &&
	cursor === 'Composer 2.5,Grok 4.6' &&
	openai === '5.6 Terra,Auto,openai/gpt-5.4' &&
	opencode === 'opencode-go/grok-4.5' &&
	unknown === 'unknown-model'
) {
	console.info('  ok    groups models by provider')
} else {
	console.error(`  FAIL  groups models by provider; got ${JSON.stringify(groups)}`)
	failures++
}

if (failures) process.exit(1)
console.info('model labels: stable names ok')
