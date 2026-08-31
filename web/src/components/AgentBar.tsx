import { Map as MapIcon, Zap } from 'lucide-react'
import { useState } from 'react'
import { useModelCatalog, useModels } from '../hooks.ts'
import { cn } from '../lib/cn.ts'
import { shortModel } from '../lib/format.ts'
import type { AgentPatch, Session } from '../lib/types.ts'
import { useApp } from '../store.ts'
import { EffortBars, ProviderMark } from './AgentIcons.tsx'
import { ModelPicker } from './ModelPicker.tsx'

/**
 * Conductor's own composer controls, mirrored for the phone — and rendered
 * *inside* the composer card (Composer.tsx) so the whole thing has one left edge
 * and one border, like the desktop app.
 *
 * Values are read from the DB (durable, like every other read). Changes are
 * **staged, not sent**: pushing one costs a slow, focus-stealing AppleScript trip
 * and only decides what the *next* prompt runs on, so a tap is instant and local,
 * and the send applies it (hooks.ts ▸ `useSendPrompt`) before the prompt goes.
 * A staged control uses the accent colour, and flipping a value back to what
 * Conductor already has drops the staged one rather than queuing a no-op trip.
 */
const EFFORT_LABELS: Record<string, string> = {
	low: 'Low',
	medium: 'Medium',
	high: 'High',
	xhigh: 'Extra high',
	max: 'Max',
	ultracode: 'Ultracode'
}
const EFFORT_ORDER = Object.keys(EFFORT_LABELS)
/** Keep the relay cache useful without leaving a Conductor menu stale all day. */
const MODEL_CATALOG_STALE_MS = 10 * 60 * 1000

/** Nothing staged — a stable identity so the selector can't loop. */
const NOTHING: AgentPatch = {}

/** A staged value only exists while it differs from Conductor's; flipping back clears it. */
function change<T>(next: T, current: T): T | undefined {
	return next === current ? undefined : next
}

/**
 * Compact the stable built-in ids (`gpt-5.6-sol`, `opus-5-1m`) into the labels
 * Conductor shows. Unknown/provider-specific ids stay untouched rather than risk
 * displaying a misleading name.
 */
function modelPill(session: Session): string {
	const raw = shortModel(session.model)
	if (!raw) return 'Model'
	const pathTail = raw.split('/').pop() ?? raw
	const id = pathTail.split(':').pop() ?? pathTail
	const parts = id.split('-')
	const title = (part: string) => {
		if (!part) return ''
		return part.toLowerCase() === '1m' ? '1M' : part[0].toUpperCase() + part.slice(1)
	}
	if (parts[0] === 'gpt' && parts[1]) return [parts[1], ...parts.slice(2).map(title)].join(' ')
	if (/^(opus|sonnet|haiku|fable)$/.test(parts[0] ?? '')) return parts.map(title).join(' ')
	return id
}

export function AgentBar({ session, workspaceId }: { session: Session; workspaceId: string }) {
	const [picking, setPicking] = useState(false)
	const staged = useApp(s => s.agentDrafts[session.id]) ?? NOTHING
	const stageAgent = useApp(s => s.stageAgent)
	// A send in flight is what pushes the staged settings. The controls stay live
	// through it — anything changed mid-send simply stages for the next one, which
	// the store's key-wise `clearAgentDraft` is what makes safe.
	const sending = useApp(s => s.pending.some(p => p.sessionId === session.id && p.status === 'sending'))
	const modelCatalog = useModelCatalog()
	const cachedGroup = modelCatalog.data?.groups.find(group => group.agentType === (session.agent_type ?? 'unknown'))
	const cacheFresh = !!cachedGroup && Date.now() - cachedGroup.updatedAt < MODEL_CATALOG_STALE_MS
	const liveModels = useModels(session, workspaceId, picking && !cacheFresh)
	const models = liveModels.data ?? cachedGroup?.models ?? []

	const stage = (patch: AgentPatch) => stageAgent(session.id, patch)

	const dbEffort = session.claude_effort_level ?? undefined
	const dbPlan = session.permission_mode === 'plan'
	const dbFast = Boolean(session.fast_mode)
	const effort = staged.effort ?? dbEffort
	const planOn = staged.plan ?? dbPlan
	const fastOn = staged.fast ?? dbFast
	const anyStaged = Object.keys(staged).length > 0
	const displayedModel = staged.model ?? modelPill(session)
	const providerModel = staged.model ?? session.model

	// Tapping effort steps to the next level, matching the desktop button's own behaviour.
	const nextEffort = () => EFFORT_ORDER[(EFFORT_ORDER.indexOf(effort ?? '') + 1) % EFFORT_ORDER.length]

	return (
		<div className="min-w-0 flex-1">
			<div className="flex min-w-0 items-center gap-0.5">
				{/* Only the model control opens a menu; the other settings stay one-tap ghost controls. */}
				<div className="min-w-0">
					<ModelPicker
						value={displayedModel}
						models={models}
						open={picking}
						onOpenChange={setPicking}
						isFetching={liveModels.isFetching || modelCatalog.isFetching}
						isError={liveModels.isError}
						onSelect={model => stage({ model: change(model, staged.model) })}
						renderTrigger={({ picking, toggle }) => (
							<button
								type="button"
								onClick={toggle}
								aria-label={`Change model, currently ${displayedModel}`}
								aria-haspopup="menu"
								aria-expanded={picking}
								className={cn(
									'flex h-8 max-w-full min-w-0 items-center gap-1 rounded-md px-1 text-[13px] font-medium text-muted transition active:bg-surface-2 active:text-text',
									staged.model !== undefined && 'text-accent'
								)}
							>
								<ProviderMark agentType={session.agent_type} model={providerModel} className="size-[15px]" />
								<span className="truncate">{displayedModel}</span>
							</button>
						)}
					/>
				</div>
				<button
					type="button"
					onClick={() => stage({ fast: change(!fastOn, dbFast) })}
					aria-label={`Fast mode ${fastOn ? 'on' : 'off'}`}
					aria-pressed={fastOn}
					className={cn(
						'flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition active:bg-surface-2 active:text-text',
						fastOn && 'text-text',
						staged.fast !== undefined && 'text-accent'
					)}
				>
					<Zap size={17} />
				</button>
				{effort ? (
					<button
						type="button"
						onClick={() => stage({ effort: change(nextEffort(), dbEffort) })}
						aria-label={`Reasoning effort: ${EFFORT_LABELS[effort]}`}
						className={cn(
							'flex h-8 shrink-0 items-center gap-1 rounded-md px-1 text-[13px] font-medium text-muted transition active:bg-surface-2 active:text-text',
							staged.effort && 'text-accent'
						)}
					>
						<EffortBars effort={effort} />
						<span className="max-[340px]:hidden">{EFFORT_LABELS[effort]}</span>
					</button>
				) : null}
				<button
					type="button"
					onClick={() => stage({ plan: change(!planOn, dbPlan) })}
					aria-label={`Plan mode ${planOn ? 'on' : 'off'}`}
					aria-pressed={planOn}
					className={cn(
						'flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition active:bg-surface-2 active:text-text',
						planOn && 'text-text',
						staged.plan !== undefined && 'text-accent'
					)}
				>
					<MapIcon size={17} />
				</button>
			</div>
			{anyStaged ? (
				<div className="px-2 pt-0.5 text-[11px] text-faint">{sending ? 'Applying…' : 'Applies when you send'}</div>
			) : null}
		</div>
	)
}
