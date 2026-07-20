import { RefreshCw, WifiOff } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { cn } from '../lib/cn.ts'
import { statusDot } from '../lib/format.ts'
import type { Workspace } from '../lib/types.ts'
import { useApp } from '../store.ts'

/** Workspace dot: coloured by PR state (src/pr.ts), pulsing while the agent works. */
export function StatusDot({ w, className }: { w: Workspace; className?: string }) {
	const { color, pulse } = statusDot(w)
	return (
		<span
			className={cn('dot', pulse && 'dot-pulse', className)}
			style={{ background: color, '--pulse-color': color } as CSSProperties}
		/>
	)
}

function syncedAgo(ms: number): string {
	const secs = Math.max(0, Math.round(ms / 1000))
	if (secs < 90) return `${secs}s`
	const mins = Math.round(secs / 60)
	if (mins < 60) return `${mins}m`
	return `${Math.round(mins / 60)}h`
}

/**
 * Silent while connected. When the relay is auto-updating it restarts to apply, briefly dropping every
 * client — show a calm "Updating…" through that window (the last snapshot reads `mode:auto,
 * available:true` from before the restart until a fresh poll clears it) rather than the alarming red
 * "Offline". A genuine drop (no update in flight) still shows the red strip. `check` mode leaves
 * `available` set with no restart, so it keeps the normal offline behaviour.
 */
export function OfflineBanner() {
	const online = useApp(s => s.online)
	const lastSyncAt = useApp(s => s.lastSyncAt)
	const update = useApp(s => s.update)
	const updating = update?.mode === 'auto' && update.available
	// Re-render each second while offline so "last synced" counts up.
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		if (online) return
		const t = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(t)
	}, [online])
	if (updating)
		return (
			<div className="fade-in flex items-center gap-1.5 bg-accent/10 px-3 py-1.5 text-xs text-accent">
				<RefreshCw size={13} className="animate-spin" />
				<span>Updating relay to {update?.latest ?? 'latest'}… reconnecting</span>
			</div>
		)
	if (online) return null
	return (
		<div className="fade-in flex items-center gap-1.5 bg-del/10 px-3 py-1.5 text-xs text-del">
			<WifiOff size={13} />
			<span>Offline — retrying…{lastSyncAt ? ` last synced ${syncedAgo(now - lastSyncAt)} ago` : ''}</span>
		</div>
	)
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span className={cn('rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted', className)}>
			{children}
		</span>
	)
}

export function Badge({ children }: { children: ReactNode }) {
	return (
		<span className="grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">
			{children}
		</span>
	)
}

export function Empty({ children }: { children: ReactNode }) {
	return <div className="mx-auto max-w-xs px-6 py-16 text-center text-sm text-muted">{children}</div>
}

export function Spinner({ label }: { label?: string }) {
	return (
		<div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
			<span className="size-4 animate-spin rounded-full border-2 border-border border-t-accent" />
			{label}
		</div>
	)
}
