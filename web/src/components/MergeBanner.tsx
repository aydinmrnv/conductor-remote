import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpRight, Check, GitMerge, Loader2, UploadCloud } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { client } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import type { Workspace } from '../lib/types.ts'

/** Local publish state from the diff endpoint — decides "Commit & push". */
interface LocalState {
	dirty: boolean
	unpushed: boolean
}

/**
 * What the bar offers, chosen by state (matches Conductor's top-of-diff bar):
 *  - push    → uncommitted/unpushed work; button asks the agent to commit & push
 *  - resolve → PR has merge conflicts; button asks the agent to resolve them
 *  - merge   → PR is mergeable; button merges it (gh pr merge)
 *  - draft   → PR isn't ready; shown, no action
 * `push`/`resolve` just send a chat message (like Conductor); `merge` acts.
 */
type Action = 'push' | 'resolve' | 'merge' | 'draft'

function pickAction(ws: Workspace, local?: LocalState): Action | null {
	if (local && (local.dirty || local.unpushed)) return 'push'
	switch (ws.pr_status) {
		case 'conflicts':
			return 'resolve'
		case 'mergeable':
			return 'merge'
		case 'draft':
			return 'draft'
		default:
			return null // no PR and nothing to push → no bar
	}
}

const STATUS: Record<Action, { label: string; tone: string; icon?: ReactNode }> = {
	push: { label: 'Uncommitted changes', tone: 'text-working', icon: <UploadCloud size={14} /> },
	resolve: { label: 'Merge conflicts', tone: 'text-muted', icon: <AlertTriangle size={14} /> },
	merge: { label: 'Ready to merge', tone: 'text-add' },
	draft: { label: 'Draft', tone: 'text-muted' }
}

/** The message each delegating action sends into the chat. */
const PROMPT: Record<'push' | 'resolve', string> = {
	push: 'Commit all outstanding changes with a clear message and push the branch to the remote.',
	resolve:
		'This branch has merge conflicts with its base branch. Merge the base branch in, resolve the conflicts, then commit and push.'
}

/**
 * Conductor's merge/resolve/commit bar, on the phone. Renders above the diff and
 * swaps its action by state. Nothing to do (no PR, clean, nothing to push) → no bar.
 */
export function MergeBanner({ ws, local }: { ws: Workspace; local?: LocalState }) {
	const queryClient = useQueryClient()
	const [confirming, setConfirming] = useState(false)
	const [busy, setBusy] = useState(false)
	const [done, setDone] = useState<{ ok: boolean; msg: string } | null>(null)

	if (done?.ok)
		return (
			<Bar>
				<Check size={15} className="shrink-0 text-add" />
				<span className="truncate font-medium text-add">{done.msg}</span>
			</Bar>
		)

	if (ws.pr_status === 'merged') return null
	const action = pickAction(ws, local)
	if (!action) return null
	const { label, tone, icon } = STATUS[action]

	// merge acts on GitHub; push/resolve just message the agent.
	const runMerge = async () => {
		setBusy(true)
		setDone(null)
		try {
			const r = await client.merge(ws.id)
			if (r.ok) {
				setDone({ ok: true, msg: `Merged${r.method ? ` (${r.method})` : ''}` })
				queryClient.invalidateQueries({ queryKey: ['state'] })
				queryClient.invalidateQueries({ queryKey: ['diff', ws.id] })
			} else {
				setDone({ ok: false, msg: r.error || 'Merge failed' })
				setConfirming(false)
			}
		} catch (err) {
			setDone({ ok: false, msg: err instanceof Error ? err.message : String(err) })
			setConfirming(false)
		} finally {
			setBusy(false)
		}
	}

	const sendMessage = async (kind: 'push' | 'resolve') => {
		if (!ws.active_session_id) return setDone({ ok: false, msg: 'No active session to message' })
		setBusy(true)
		setDone(null)
		try {
			const r = await client.sendPrompt(ws.active_session_id, PROMPT[kind], ws.id)
			setDone(r.ok ? { ok: true, msg: 'Asked the agent' } : { ok: false, msg: r.error || 'Send failed' })
		} catch (err) {
			setDone({ ok: false, msg: err instanceof Error ? err.message : String(err) })
		} finally {
			setBusy(false)
		}
	}

	return (
		<Bar tint={action === 'merge'}>
			{ws.pr_number ? (
				<a
					href={ws.pr_url ?? undefined}
					target="_blank"
					rel="noreferrer"
					className="flex shrink-0 items-center gap-0.5 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted active:bg-surface"
				>
					#{ws.pr_number}
					<ArrowUpRight size={12} />
				</a>
			) : null}
			<span className={cn('flex items-center gap-1 truncate font-medium', tone)}>
				{icon}
				{label}
			</span>

			<div className="ml-auto flex shrink-0 items-center gap-2">
				{done && !done.ok ? <span className="max-w-36 truncate text-[11px] text-del">{done.msg}</span> : null}
				{action === 'draft' ? null : action === 'merge' ? (
					confirming ? (
						<>
							<CancelBtn onClick={() => setConfirming(false)} />
							<Cta onClick={runMerge} busy={busy} className="bg-add text-black">
								Confirm
							</Cta>
						</>
					) : (
						<Cta onClick={() => setConfirming(true)} className="bg-add text-black">
							<GitMerge size={13} />
							Merge
						</Cta>
					)
				) : action === 'push' ? (
					<Cta onClick={() => sendMessage('push')} busy={busy} className="bg-working text-black">
						Commit &amp; push
					</Cta>
				) : (
					<Cta
						onClick={() => sendMessage('resolve')}
						busy={busy}
						className="border border-border bg-surface-2 text-text"
					>
						Resolve
					</Cta>
				)}
			</div>
		</Bar>
	)
}

function Cta({
	onClick,
	busy,
	className,
	children
}: {
	onClick: () => void
	busy?: boolean
	className?: string
	children: ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy}
			className={cn(
				'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition active:scale-95 disabled:opacity-60',
				className
			)}
		>
			{busy ? <Loader2 size={13} className="animate-spin" /> : null}
			{children}
		</button>
	)
}

function CancelBtn({ onClick }: { onClick: () => void }) {
	return (
		<button type="button" onClick={onClick} className="rounded-lg px-2 py-1 text-xs text-muted active:bg-surface-2">
			Cancel
		</button>
	)
}

function Bar({ tint, children }: { tint?: boolean; children: ReactNode }) {
	return (
		<div
			className={cn(
				'sticky top-0 z-10 flex items-center gap-2 border-b border-border-soft px-3 py-2 backdrop-blur',
				tint ? 'bg-add/10' : 'bg-surface/95'
			)}
		>
			{children}
		</div>
	)
}
