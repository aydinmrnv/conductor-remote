import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Info, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { client } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import type { ActuatorInfo } from '../lib/types.ts'
import { useApp } from '../store.ts'

interface Feedback {
	kind: 'ok' | 'warn' | 'err'
	msg: string
}

// Persist an unsent prompt per workspace so a force-quit (or reload) never loses
// typing. Keyed by workspace id; cleared on a successful send.
const DRAFT_PREFIX = 'conductor-remote-draft:'

function loadDraft(workspaceId: string): string {
	try {
		return localStorage.getItem(DRAFT_PREFIX + workspaceId) ?? ''
	} catch {
		return ''
	}
}

function saveDraft(workspaceId: string, value: string) {
	try {
		if (value) localStorage.setItem(DRAFT_PREFIX + workspaceId, value)
		else localStorage.removeItem(DRAFT_PREFIX + workspaceId)
	} catch {}
}

export function Composer({
	sessionId,
	workspaceId,
	actuator
}: {
	sessionId: string | null
	workspaceId: string
	actuator?: ActuatorInfo
}) {
	const [text, setText] = useState(() => loadDraft(workspaceId))
	const [sending, setSending] = useState(false)
	const online = useApp(s => s.online)
	const markWorking = useApp(s => s.markWorking)
	const queryClient = useQueryClient()
	const [feedback, setFeedback] = useState<Feedback | null>(null)
	const ref = useRef<HTMLTextAreaElement>(null)

	useEffect(() => {
		if (!feedback) return
		const t = setTimeout(() => setFeedback(null), feedback.kind === 'err' ? 5000 : 2800)
		return () => clearTimeout(t)
	}, [feedback])

	const autosize = () => {
		const el = ref.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`
	}

	// Grow the box to fit a restored draft on mount (SessionView keys us per workspace).
	useEffect(autosize, [])

	const edit = (value: string) => {
		setText(value)
		saveDraft(workspaceId, value)
		autosize()
	}

	const send = async () => {
		const value = text.trim()
		if (!value || !sessionId || sending || !online) return
		setSending(true)
		try {
			const r = await client.sendPrompt(sessionId, value, workspaceId)
			if (r.ok) {
				setText('')
				saveDraft(workspaceId, '')
				requestAnimationFrame(autosize)
				setFeedback({ kind: r.warning ? 'warn' : 'ok', msg: r.warning || 'Sent' })
				// Show the working indicator immediately; the status poll takes over.
				markWorking(sessionId)
				queryClient.invalidateQueries({ queryKey: ['sessions', workspaceId] })
			} else {
				setFeedback({ kind: 'err', msg: r.error || 'Send failed' })
			}
		} catch (err) {
			setFeedback({ kind: 'err', msg: err instanceof Error ? err.message : String(err) })
		} finally {
			setSending(false)
		}
	}

	const disabled = !sessionId
	const precise = actuator?.precise && actuator.available

	return (
		<div className="pb-safe border-t border-border-soft bg-bg px-3 pt-2">
			{!online ? (
				<div className="mb-2 flex items-center gap-1.5 rounded-lg bg-del/10 px-3 py-1.5 text-xs text-del">
					<WifiOff size={12} />
					Offline — drafts are saved, sending resumes when the relay is back
				</div>
			) : feedback ? (
				<div
					className={cn(
						'mb-2 rounded-lg px-3 py-1.5 text-xs',
						feedback.kind === 'ok' && 'bg-idle/10 text-idle',
						feedback.kind === 'warn' && 'bg-working/10 text-working',
						feedback.kind === 'err' && 'bg-del/10 text-del'
					)}
				>
					{feedback.msg}
				</div>
			) : (
				!precise && (
					<div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-faint">
						<Info size={12} />
						{actuator?.caveat || 'Sends to the focused session'}
					</div>
				)
			)}
			<div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-2.5 py-1.5 focus-within:border-accent/60">
				<textarea
					ref={ref}
					rows={1}
					value={text}
					disabled={disabled}
					placeholder={disabled ? 'No active session' : 'Send a prompt…'}
					className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-faint disabled:opacity-50"
					onChange={e => edit(e.target.value)}
					onKeyDown={e => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
							e.preventDefault()
							send()
						}
					}}
				/>
				<button
					type="button"
					onClick={send}
					disabled={disabled || sending || !text.trim() || !online}
					aria-label="Send"
					className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition active:scale-90 disabled:bg-surface-2 disabled:text-faint"
				>
					<ArrowUp size={19} />
				</button>
			</div>
		</div>
	)
}
