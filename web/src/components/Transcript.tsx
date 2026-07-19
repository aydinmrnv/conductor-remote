import { useEffect, useLayoutEffect, useRef } from 'react'
import { useTranscript } from '../hooks.ts'
import { cn } from '../lib/cn.ts'
import type { TranscriptEntry } from '../lib/types.ts'
import { Empty, Spinner } from './ui.tsx'

export function Transcript({ sessionId }: { sessionId: string | null }) {
	const { entries, loading, error } = useTranscript(sessionId)
	const scroller = useRef<HTMLDivElement>(null)
	const atBottom = useRef(true)

	// Track whether the user is pinned to the bottom before new content lands.
	const onScroll = () => {
		const el = scroller.current
		if (!el) return
		atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: fire on new entries to keep the view pinned
	useLayoutEffect(() => {
		const el = scroller.current
		if (el && atBottom.current) el.scrollTop = el.scrollHeight
	}, [entries])

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset scroll intent when switching sessions
	useEffect(() => {
		atBottom.current = true
	}, [sessionId])

	if (!sessionId) return <Empty>No active session in this workspace.</Empty>

	return (
		<div ref={scroller} onScroll={onScroll} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
			{loading && entries.length === 0 ? (
				<Spinner label="Loading transcript…" />
			) : error && entries.length === 0 ? (
				<Empty>{error}</Empty>
			) : entries.length === 0 ? (
				<Empty>No messages yet.</Empty>
			) : (
				<div className="flex min-w-0 flex-col gap-2.5">
					{entries.map(e => (
						<Entry key={`${e.rowid}-${e.id}`} e={e} />
					))}
				</div>
			)}
		</div>
	)
}

function Entry({ e }: { e: TranscriptEntry }) {
	if (e.role === 'user') {
		return (
			<div className="flex justify-end">
				<Bubble className={cn('max-w-[85%] bg-accent-soft text-text', e.queued && 'opacity-60')}>
					{e.queued ? <Label>queued</Label> : null}
					{e.text}
				</Bubble>
			</div>
		)
	}
	if (e.role === 'tool') {
		return (
			<div className="overflow-hidden rounded-xl border border-border-soft bg-surface/60 px-3 py-2">
				{/* biome-ignore format: keep {e.text} inline so <pre> doesn't render JSX indentation */}
				<pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-muted [overflow-wrap:anywhere]">{e.text}</pre>
			</div>
		)
	}
	if (e.role === 'system') {
		return <div className="px-2 text-center text-[11px] text-faint">{e.text}</div>
	}
	// assistant / thinking
	return (
		<div className="flex justify-start">
			<Bubble className={cn('max-w-[92%] bg-surface', e.role === 'thinking' && 'italic text-muted')}>{e.text}</Bubble>
		</div>
	)
}

function Bubble({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div
			className={cn(
				'whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed [overflow-wrap:anywhere]',
				className
			)}
		>
			{children}
		</div>
	)
}

function Label({ children }: { children: string }) {
	return <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{children}</div>
}
