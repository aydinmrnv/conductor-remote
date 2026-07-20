import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, GitMerge, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useMergePrecheck } from '../hooks.ts'
import { client } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import type { MergeReason } from '../lib/types.ts'

/** Friendly one-liners for a blocked precheck; `detail` from the relay fills the specifics. */
const BLOCKED_HINT: Partial<Record<MergeReason, string>> = {
	'not-on-base': 'Check that branch out in Conductor first, then merge.',
	'dirty-base': 'Commit or stash the base checkout, then merge.',
	'nothing-to-merge': 'This branch is already in the base.',
	conflicts: 'Resolve the conflict in Conductor, then merge.',
	'no-repo': 'Could not locate the repository on disk.',
	'no-branch': 'This workspace has no branch to merge.'
}

/**
 * Conductor's merge button, on the phone: a local `git merge <branch>` into the
 * workspace's base branch. Opens a confirm sheet that shows the target, commit
 * count, and any blocker (or the "uncommitted changes won't be included" caveat)
 * before it does anything — the merge itself is a deliberate second tap.
 */
export function MergeButton({ workspaceId }: { workspaceId: string }) {
	const [open, setOpen] = useState(false)
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label="Merge workspace"
				className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2"
			>
				<GitMerge size={18} />
			</button>
			{open ? <MergeSheet workspaceId={workspaceId} onClose={() => setOpen(false)} /> : null}
		</>
	)
}

function MergeSheet({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
	const queryClient = useQueryClient()
	const { data: pre, isLoading } = useMergePrecheck(workspaceId, true)
	const [merging, setMerging] = useState(false)
	const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

	const merge = async () => {
		if (merging) return
		setMerging(true)
		setResult(null)
		try {
			const r = await client.merge(workspaceId)
			if (r.ok) {
				setResult({ ok: true, msg: r.summary?.split('\n')[0] || `Merged into ${r.base}` })
				// Diff/state/precheck all change after a merge — refresh them.
				queryClient.invalidateQueries({ queryKey: ['state'] })
				queryClient.invalidateQueries({ queryKey: ['diff', workspaceId] })
				queryClient.invalidateQueries({ queryKey: ['merge-precheck', workspaceId] })
			} else {
				setResult({ ok: false, msg: r.error || 'Merge failed' })
			}
		} catch (err) {
			setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
		} finally {
			setMerging(false)
		}
	}

	const blocked = pre && !pre.canMerge
	const hint = pre ? BLOCKED_HINT[pre.reason] : undefined

	return (
		<>
			<div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} aria-hidden />
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Merge workspace"
				className="fade-in pb-safe fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-sm flex-col gap-4 rounded-t-3xl border border-border-soft bg-surface p-5 shadow-xl md:inset-0 md:m-auto md:h-fit md:rounded-3xl"
			>
				<div className="flex items-center justify-between">
					<h2 className="flex items-center gap-2 text-base font-semibold">
						<GitMerge size={17} className="text-muted" />
						Merge
					</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="flex size-8 items-center justify-center rounded-full text-muted active:bg-surface-2"
					>
						<X size={18} />
					</button>
				</div>

				{isLoading && !pre ? (
					<p className="py-4 text-center text-sm text-muted">Checking…</p>
				) : pre ? (
					<>
						<p className="text-sm text-muted">
							Merge <span className="font-mono text-text">{pre.branch}</span> into{' '}
							<span className="font-mono text-text">{pre.base}</span>
							{pre.ahead > 0 ? (
								<>
									{' '}
									· {pre.ahead} commit{pre.ahead === 1 ? '' : 's'}
								</>
							) : null}
							. Runs locally on the Mac — nothing is pushed.
						</p>

						{blocked ? (
							<Note kind="err">{[pre.detail, hint].filter(Boolean).join(' — ')}</Note>
						) : pre.uncommitted > 0 ? (
							<Note kind="warn">
								{pre.uncommitted} uncommitted change{pre.uncommitted === 1 ? '' : 's'} in the worktree won’t be included
								— only committed work merges.
							</Note>
						) : null}

						{result ? <Note kind={result.ok ? 'ok' : 'err'}>{result.msg}</Note> : null}

						<div className="flex gap-2">
							<button
								type="button"
								onClick={onClose}
								className="flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm active:bg-surface"
							>
								{result?.ok ? 'Done' : 'Cancel'}
							</button>
							{!result?.ok ? (
								<button
									type="button"
									onClick={merge}
									disabled={merging || blocked}
									className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-white transition active:scale-95 disabled:bg-surface-2 disabled:text-faint"
								>
									{merging ? 'Merging…' : 'Merge'}
								</button>
							) : null}
						</div>
					</>
				) : (
					<Note kind="err">Couldn’t check merge status.</Note>
				)}
			</div>
		</>
	)
}

function Note({ kind, children }: { kind: 'ok' | 'warn' | 'err'; children: ReactNode }) {
	return (
		<div
			className={cn(
				'flex items-start gap-2 rounded-xl px-3 py-2 text-xs',
				kind === 'ok' && 'bg-idle/10 text-idle',
				kind === 'warn' && 'bg-working/10 text-working',
				kind === 'err' && 'bg-del/10 text-del'
			)}
		>
			{kind === 'ok' ? (
				<Check size={14} className="mt-0.5 shrink-0" />
			) : (
				<AlertTriangle size={14} className="mt-0.5 shrink-0" />
			)}
			<span>{children}</span>
		</div>
	)
}
