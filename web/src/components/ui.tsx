import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import type { UiStatus } from '../lib/format.ts'
import { useApp } from '../store.ts'

export function StatusDot({ status, className }: { status: UiStatus; className?: string }) {
	return <span className={cn('dot', `dot-${status}`, className)} />
}

export function ConnDot() {
	const online = useApp(s => s.online)
	return (
		<span
			title={online ? 'connected' : 'offline'}
			className="dot"
			style={{ background: online ? 'var(--color-idle)' : 'var(--color-del)' }}
		/>
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
