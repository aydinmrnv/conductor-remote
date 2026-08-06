import { useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { client } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { SETTABLE_STATUSES, STATUS_COLORS, workspaceStatus, workspaceStatusLabel } from '../lib/format.ts'
import type { Workspace } from '../lib/types.ts'
import { useApp } from '../store.ts'

/**
 * Move a workspace between the sidebar's status groups from the phone.
 *
 * Worth the header space because Conductor's own status is *derived from a PR it
 * sometimes never links*: a PR that opens and merges inside its polling window is
 * invisible to it afterwards, so finished work sits in "In progress" forever and
 * the only fix — the sidebar row's right-click menu — needs a Mac.
 *
 * No optimism here, deliberately: the relay drives Conductor's real menu and only
 * answers once the DB agrees, so the pill stays busy for the ~15s that takes
 * rather than showing a status the desktop hasn't accepted.
 */
export function StatusPicker({ workspace }: { workspace: Workspace }) {
	const [open, setOpen] = useState(false)
	const [busy, setBusy] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const online = useApp(s => s.online)
	const queryClient = useQueryClient()

	const current = workspaceStatus(workspace)

	const apply = async (status: string) => {
		if (busy) return
		setOpen(false)
		if (status === current) return
		setBusy(status)
		setError(null)
		try {
			const r = await client.setStatus(workspace.id, status)
			if (!r.ok) setError(r.error ?? 'status change failed')
			await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
		} catch (e) {
			setError(e instanceof Error ? e.message : 'status change failed')
		} finally {
			setBusy(null)
		}
	}

	const pending = busy ?? null
	const shown = pending ?? current

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(o => !o)}
				disabled={!online || busy !== null}
				aria-label={`Workspace status: ${workspaceStatusLabel(current)}`}
				aria-expanded={open}
				className={cn(
					'flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition active:bg-surface-2 disabled:opacity-40',
					open && 'bg-surface-2 text-text'
				)}
			>
				{busy ? (
					<span className="dot-spinner size-4" style={{ '--spin-color': dotColor(shown) } as React.CSSProperties} />
				) : (
					<StatusGlyph status={shown} />
				)}
			</button>
			{open ? (
				<>
					{/* Tapping anywhere else closes it — the sheet has no chrome of its own. */}
					<button
						type="button"
						aria-label="Close status menu"
						className="fixed inset-0 z-20 cursor-default"
						onClick={() => setOpen(false)}
					/>
					<div className="fade-in absolute right-2 top-full z-30 w-44 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
						{SETTABLE_STATUSES.map(s => (
							<button
								type="button"
								key={s}
								onClick={() => apply(s)}
								className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm active:bg-surface-2"
							>
								<StatusGlyph status={s} />
								<span className="flex-1">{workspaceStatusLabel(s)}</span>
								{s === current ? <Check size={15} className="text-accent" /> : null}
							</button>
						))}
					</div>
				</>
			) : null}
			{error ? (
				<button
					type="button"
					onClick={() => setError(null)}
					className="absolute right-2 top-full z-30 max-w-64 rounded-lg border border-del/40 bg-surface px-3 py-2 text-left text-xs text-del shadow-xl"
				>
					{error}
				</button>
			) : null}
		</>
	)
}

/** Unknown statuses (Conductor may add one) read as a hollow ring, never a wrong colour. */
function dotColor(status: string): string {
	return STATUS_COLORS[status] ?? 'var(--color-faint)'
}

function StatusGlyph({ status }: { status: string }) {
	const color = STATUS_COLORS[status]
	if (!color) return <span className="dot size-2.5 border border-faint bg-transparent" />
	return <span className="dot size-2.5" style={{ background: color }} />
}
