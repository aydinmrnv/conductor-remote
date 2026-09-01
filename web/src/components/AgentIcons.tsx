import claudeMark from '@lobehub/icons-static-svg/icons/claude.svg'
import cursorMark from '@lobehub/icons-static-svg/icons/cursor.svg'
import openAiMark from '@lobehub/icons-static-svg/icons/openai.svg'
import openCodeMark from '@lobehub/icons-static-svg/icons/opencode.svg'
import { Bot } from 'lucide-react'
import { cn } from '../lib/cn.ts'

const PROVIDER_MARKS = {
	claude: claudeMark,
	cursor: cursorMark,
	openai: openAiMark,
	opencode: openCodeMark
} as const

type Provider = keyof typeof PROVIDER_MARKS

/**
 * Claude's is the package's own `claude-color.svg` rather than a colour picked by eye.
 * The other three ship no `-color.svg` at all — every path in them is
 * `fill="currentColor"` — so OpenAI's white is a choice, not a brand value, and it holds
 * only because this app has no light theme. `cursor` and `opencode` stay whatever the
 * surface around them is.
 */
const PROVIDER_COLORS: Partial<Record<Provider, string>> = {
	claude: '#D97757',
	openai: '#FFF'
}

function providerFor(agentType: string | null, model: string | null): Provider | undefined {
	const label = model?.toLowerCase() ?? ''
	if (/^(?:anthropic\/|claude|fable|haiku|opus|sonnet)/.test(label)) return 'claude'
	if (/^(?:openai\/|gpt|o[1-9]|\d)/.test(label)) return 'openai'
	if (/^(?:cursor\/|composer|grok)/.test(label)) return 'cursor'
	if (/^opencode(?:-go)?\//.test(label)) return 'opencode'

	const agent = agentType?.toLowerCase()
	if (agent === 'claude' || agent === 'anthropic') return 'claude'
	if (agent === 'codex' || agent === 'openai') return 'openai'
	if (agent === 'cursor') return 'cursor'
	if (agent === 'acp' || agent === 'opencode') return 'opencode'
	return undefined
}

/** The active agent's recognizable brand mark; unknown harnesses retain a neutral fallback. */
export function ProviderMark({
	agentType,
	model,
	className
}: {
	agentType: string | null
	model: string | null
	className?: string
}) {
	const provider = providerFor(agentType, model)
	if (!provider) return <Bot aria-hidden="true" className={className} />

	const source = PROVIDER_MARKS[provider]
	return (
		<span
			aria-hidden="true"
			className={cn('inline-block shrink-0 bg-current', className)}
			style={{
				// `bg-current` paints the mask, so the tint is a `color` on the same element.
				color: PROVIDER_COLORS[provider],
				WebkitMaskImage: `url("${source}")`,
				maskImage: `url("${source}")`,
				WebkitMaskPosition: 'center',
				maskPosition: 'center',
				WebkitMaskRepeat: 'no-repeat',
				maskRepeat: 'no-repeat',
				WebkitMaskSize: 'contain',
				maskSize: 'contain'
			}}
		/>
	)
}

const EFFORT_BARS = [5, 7, 9, 11, 13, 15] as const
const ACTIVE_BARS: Record<string, number> = {
	low: 1,
	medium: 2,
	high: 3,
	xhigh: 4,
	max: 5,
	ultracode: 6
}

/** A six-step meter, matching the six effort levels and Conductor's ascending-bar treatment. */
export function EffortBars({ effort, className }: { effort: string; className?: string }) {
	const active = ACTIVE_BARS[effort] ?? 0
	return (
		<span aria-hidden="true" className={cn('flex h-[15px] shrink-0 items-end gap-[1.5px]', className)}>
			{EFFORT_BARS.map((height, index) => (
				<span
					key={height}
					className={cn(
						'w-0.5 rounded-full bg-current transition-opacity',
						index < active ? 'opacity-100' : 'opacity-20'
					)}
					style={{ height }}
				/>
			))}
		</span>
	)
}
