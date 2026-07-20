import { useEffect, useLayoutEffect, useRef } from 'react'
import { useTranscript } from '../hooks.ts'
import { cn } from '../lib/cn.ts'
import type { TranscriptEntry } from '../lib/types.ts'
import { Markdown } from './Markdown.tsx'
import { Empty, Spinner } from './ui.tsx'

export function Transcript({ sessionId, working }: { sessionId: string | null; working?: boolean }) {
	const { entries, loading, error } = useTranscript(sessionId)
	const scroller = useRef<HTMLDivElement>(null)
	const atBottom = useRef(true)

	// Track whether the user is pinned to the bottom before new content lands.
	const onScroll = () => {
		const el = scroller.current
		if (!el) return
		atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: fire on new entries (and the working indicator toggling) to keep the view pinned
	useLayoutEffect(() => {
		const el = scroller.current
		if (el && atBottom.current) el.scrollTop = el.scrollHeight
	}, [entries, working])

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
			) : entries.length === 0 && !working ? (
				<Empty>No messages yet.</Empty>
			) : (
				<div className="flex min-w-0 flex-col gap-2.5">
					{entries.map(e => (
						<Entry key={`${e.rowid}-${e.id}`} e={e} />
					))}
					{working ? <WorkingIndicator /> : null}
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
					<Markdown>{e.text}</Markdown>
				</Bubble>
			</div>
		)
	}
	if (e.role === 'tool') {
		if (e.error) {
			return (
				<div className="overflow-hidden rounded-xl border border-del/30 bg-del/5 px-3 py-2">
					{/* biome-ignore format: keep {e.text} inline so <pre> doesn't render JSX indentation */}
					<pre className="line-clamp-4 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-del/80 [overflow-wrap:anywhere]">{e.text}</pre>
				</div>
			)
		}
		return (
			<div className="flex min-w-0 items-baseline gap-2 overflow-hidden whitespace-nowrap rounded-xl border border-border-soft bg-surface/60 px-3 py-1.5">
				<span className="shrink-0 font-mono text-[11px] text-faint">▸</span>
				<span className="max-w-full truncate text-[12.5px] text-muted">{e.text}</span>
				{e.detail ? <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{e.detail}</span> : null}
			</div>
		)
	}
	if (e.role === 'thinking') {
		return (
			<details className="group px-1">
				<summary className="cursor-pointer select-none list-none text-[11px] font-semibold uppercase tracking-wide text-faint [&::-webkit-details-marker]:hidden">
					<span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
					Thinking
				</summary>
				<div className="mt-1 border-l-2 border-border-soft pl-3 text-[13px] italic leading-relaxed text-muted">
					<Markdown>{e.text}</Markdown>
				</div>
			</details>
		)
	}
	if (e.role === 'system') {
		return <div className="px-2 text-center text-[11px] text-faint">{e.text}</div>
	}
	// assistant
	return (
		<div className="flex justify-start">
			<Bubble className="max-w-[92%] bg-surface">
				<Markdown>{e.text}</Markdown>
			</Bubble>
		</div>
	)
}

/** The classic three-dot "typing" bubble, shown under the last message while the agent works. */
function WorkingIndicator() {
	return (
		<div className="fade-in flex justify-start">
			<div className="flex items-center gap-1 rounded-2xl bg-surface px-3.5 py-3">
				<span className="typing-dot" />
				<span className="typing-dot" />
				<span className="typing-dot" />
			</div>
		</div>
	)
}

function Bubble({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div
			className={cn(
				'min-w-0 rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed [overflow-wrap:anywhere]',
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
