import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Zap } from 'lucide-react'
import { useState } from 'react'
import { client } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { shortModel } from '../lib/format.ts'
import type { AgentPatch, Session } from '../lib/types.ts'
import { useApp } from '../store.ts'

/**
 * Conductor's own composer controls, mirrored for the phone. Values are read from
 * the DB (durable, like every other read); changes are driven through the desktop
 * UI by the relay, so this is deliberately optimistic-free — a control stays busy
 * until Conductor confirms the new value, because a half-applied agent setting is
 * worse than a slow one.
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

/**
 * The pill shows the DB's model id (`opus-5-1m`) while the picker lists Conductor's
 * menu labels (`Opus 5 NEW`). There's no reliable mapping between the two, so the
 * list deliberately doesn't mark a "current" entry rather than mark the wrong one.
 */
function modelPill(session: Session): string {
	const raw = shortModel(session.model)
	if (!raw) return 'Model'
	return raw.includes(':') ? (raw.split('/').pop() ?? raw) : raw
}

export function AgentBar({ session, workspaceId }: { session: Session; workspaceId: string }) {
	const [busy, setBusy] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [models, setModels] = useState<string[] | null>(null)
	const [picking, setPicking] = useState(false)
	const online = useApp(s => s.online)
	const queryClient = useQueryClient()

	const apply = async (what: string, patch: AgentPatch) => {
		if (busy || !online) return
		setBusy(what)
		setError(null)
		try {
			const r = await client.setAgent(session.id, patch, workspaceId)
			if (!r.ok) setError(r.error ?? 'change failed')
			await queryClient.invalidateQueries({ queryKey: ['sessions', workspaceId] })
		} catch (e) {
			setError(e instanceof Error ? e.message : 'change failed')
		} finally {
			setBusy(null)
		}
	}

	const openModels = async () => {
		setPicking(p => !p)
		if (models || busy) return
		setBusy('model')
		try {
			const r = await client.models(session.id, workspaceId)
			if (r.ok && r.models) setModels(r.models)
			else setError(r.error ?? 'could not read the model list')
		} catch (e) {
			setError(e instanceof Error ? e.message : 'could not read the model list')
		} finally {
			setBusy(null)
		}
	}

	// Tapping effort steps to the next level, matching the desktop button's own behaviour.
	const nextEffort = () => {
		const i = EFFORT_ORDER.indexOf(session.claude_effort_level ?? '')
		return EFFORT_ORDER[(i + 1) % EFFORT_ORDER.length]
	}

	const planOn = session.permission_mode === 'plan'
	const fastOn = Boolean(session.fast_mode)

	return (
		<div className="shrink-0 border-t border-border-soft bg-bg px-3 pt-2">
			<div className="flex flex-wrap items-center gap-1.5">
				<button
					type="button"
					onClick={openModels}
					disabled={!online || busy !== null}
					className="pill flex items-center gap-1 disabled:opacity-40"
				>
					{modelPill(session)}
					<ChevronDown size={13} />
				</button>
				{session.claude_effort_level ? (
					<button
						type="button"
						onClick={() => apply('effort', { effort: nextEffort() })}
						disabled={!online || busy !== null}
						className="pill disabled:opacity-40"
					>
						{busy === 'effort' ? '…' : EFFORT_LABELS[session.claude_effort_level]}
					</button>
				) : null}
				<button
					type="button"
					onClick={() => apply('plan', { plan: !planOn })}
					disabled={!online || busy !== null}
					className={cn('pill disabled:opacity-40', planOn && 'pill-active')}
				>
					{busy === 'plan' ? '…' : 'Plan'}
				</button>
				<button
					type="button"
					onClick={() => apply('fast', { fast: !fastOn })}
					disabled={!online || busy !== null}
					className={cn('pill flex items-center gap-1 disabled:opacity-40', fastOn && 'pill-active')}
				>
					<Zap size={13} />
					{busy === 'fast' ? '…' : 'Fast'}
				</button>
			</div>
			{picking ? (
				<div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-border-soft">
					{models === null ? (
						<div className="px-3 py-2 text-sm text-muted">Reading Conductor’s model list…</div>
					) : (
						models.map(m => (
							<button
								type="button"
								key={m}
								onClick={() => {
									setPicking(false)
									apply('model', { model: m })
								}}
								className="block w-full px-3 py-2 text-left text-sm active:bg-surface-2"
							>
								{m}
							</button>
						))
					)}
				</div>
			) : null}
			{error ? <div className="mt-1.5 text-xs text-del">{error}</div> : null}
		</div>
	)
}
