import { Zap } from 'lucide-react'
import { useState } from 'react'
import { useModelCatalog, useModels } from '../hooks.ts'
import { cn } from '../lib/cn.ts'
import { shortModel } from '../lib/format.ts'
import type { AgentPatch, Session } from '../lib/types.ts'
import { useApp } from '../store.ts'
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
 * A staged pill is coloured, and flipping a value back to what Conductor already
 * has drops the staged one rather than queuing a no-op round trip.
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
 * The pill shows the DB's model id (`opus-5-1m`) while the picker lists Conductor's
 * menu labels (`Opus 5 NEW`). There's no reliable mapping between the two, so the
 * list marks the *staged* entry only, rather than mark the wrong one as current.
 */
function modelPill(session: Session): string {
	const raw = shortModel(session.model)
	if (!raw) return 'Model'
	return raw.includes(':') ? (raw.split('/').pop() ?? raw) : raw
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

	// Tapping effort steps to the next level, matching the desktop button's own behaviour.
	const nextEffort = () => EFFORT_ORDER[(EFFORT_ORDER.indexOf(effort ?? '') + 1) % EFFORT_ORDER.length]

	return (
		<div className="min-w-0 flex-1">
			<div className="flex flex-wrap items-center gap-0.5">
				{/* Not gated on `online`: a cached choice can still stage locally and apply on send. */}
				<ModelPicker
					value={staged.model ?? modelPill(session)}
					models={models}
					open={picking}
					onOpenChange={setPicking}
					isFetching={liveModels.isFetching || modelCatalog.isFetching}
					isError={liveModels.isError}
					onSelect={model => stage({ model: change(model, staged.model) })}
				/>
				{effort ? (
					<button
						type="button"
						onClick={() => stage({ effort: change(nextEffort(), dbEffort) })}
						className={cn('ctl', staged.effort && 'ctl-staged')}
					>
						{EFFORT_LABELS[effort]}
					</button>
				) : null}
				<button
					type="button"
					onClick={() => stage({ plan: change(!planOn, dbPlan) })}
					className={cn('ctl', planOn && 'ctl-on', staged.plan !== undefined && 'ctl-staged')}
				>
					Plan
				</button>
				<button
					type="button"
					onClick={() => stage({ fast: change(!fastOn, dbFast) })}
					className={cn('ctl flex items-center gap-1', fastOn && 'ctl-on', staged.fast !== undefined && 'ctl-staged')}
				>
					<Zap size={13} />
					Fast
				</button>
			</div>
			{anyStaged ? (
				<div className="px-2 pt-0.5 text-[11px] text-faint">{sending ? 'Applying…' : 'Applies when you send'}</div>
			) : null}
		</div>
	)
}
