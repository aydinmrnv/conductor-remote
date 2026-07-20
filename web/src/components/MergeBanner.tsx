import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Check, GitMerge, Loader2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { client } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import type { PrStatus, Workspace } from '../lib/types.ts'

/** Per-PR-state copy + colour, mirroring Conductor's green "Ready to merge" bar. */
const STATE: Record<Exclude<PrStatus, 'merged'>, { label: string; tone: string; canMerge: boolean }> = {
	mergeable: { label: 'Ready to merge', tone: 'text-add', canMerge: true },
	conflicts: { label: 'Merge conflicts', tone: 'text-del', canMerge: false },
	draft: { label: 'Draft', tone: 'text-muted', canMerge: false }
}

/**
 * Conductor's merge bar, on the phone: once an agent has opened a PR, a bar above
 * the diff shows `#N ↗ · Ready to merge` with a green Merge button that runs
 * `gh pr merge` (GitHub does the merge server-side). Renders nothing unless an
 * open PR exists — no PR, no button, exactly like the desktop.
 */
export function MergeBanner({ ws }: { ws: Workspace }) {
	const queryClient = useQueryClient()
	const [confirming, setConfirming] = useState(false)
	const [merging, setMerging] = useState(false)
	const [done, setDone] = useState<{ ok: boolean; msg: string } | null>(null)

	// Keep the success note visible even after `pr_status` flips to merged on the next poll.
	if (done?.ok)
		return (
			<Bar tone="text-add">
				<Check size={15} className="shrink-0 text-add" />
				<span className="truncate font-medium text-add">{done.msg}</span>
			</Bar>
		)

	const pr = ws.pr_status
	if (!pr || pr === 'merged') return null
	const { label, tone, canMerge } = STATE[pr]

	const merge = async () => {
		if (merging) return
		setMerging(true)
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
			setMerging(false)
		}
	}

	return (
		<Bar tone={tone}>
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
			<span className={cn('truncate font-medium', tone)}>{label}</span>

			<div className="ml-auto flex shrink-0 items-center gap-2">
				{done && !done.ok ? <span className="max-w-40 truncate text-[11px] text-del">{done.msg}</span> : null}
				{confirming ? (
					<>
						<button
							type="button"
							onClick={() => setConfirming(false)}
							className="rounded-lg px-2 py-1 text-xs text-muted active:bg-surface-2"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={merge}
							disabled={merging}
							className="flex items-center gap-1.5 rounded-lg bg-add px-2.5 py-1 text-xs font-semibold text-black transition active:scale-95 disabled:opacity-60"
						>
							{merging ? <Loader2 size={13} className="animate-spin" /> : null}
							Confirm
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={() => setConfirming(true)}
						disabled={!canMerge}
						className="flex items-center gap-1.5 rounded-lg bg-add px-2.5 py-1 text-xs font-semibold text-black transition active:scale-95 disabled:bg-surface-2 disabled:text-faint"
					>
						<GitMerge size={13} />
						Merge
					</button>
				)}
			</div>
		</Bar>
	)
}

function Bar({ tone, children }: { tone: string; children: ReactNode }) {
	return (
		<div
			className={cn(
				'sticky top-0 z-10 flex items-center gap-2 border-b border-border-soft bg-surface/95 px-3 py-2 backdrop-blur',
				tone
			)}
		>
			{children}
		</div>
	)
}
