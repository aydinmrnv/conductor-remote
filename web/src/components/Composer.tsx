import { ArrowUp, Info } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { client } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import type { ActuatorInfo } from '../lib/types.ts'

interface Feedback {
	kind: 'ok' | 'warn' | 'err'
	msg: string
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
	const [text, setText] = useState('')
	const [sending, setSending] = useState(false)
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

	const send = async () => {
		const value = text.trim()
		if (!value || !sessionId || sending) return
		setSending(true)
		try {
			const r = await client.sendPrompt(sessionId, value, workspaceId)
			if (r.ok) {
				setText('')
				requestAnimationFrame(autosize)
				setFeedback({ kind: r.warning ? 'warn' : 'ok', msg: r.warning || 'Sent' })
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
			{feedback ? (
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
				<div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-faint">
					<Info size={12} />
					{precise
						? 'Precise send — targets this session directly'
						: actuator?.caveat || 'Sends to the focused session'}
				</div>
			)}
			<div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-2.5 py-1.5 focus-within:border-accent/60">
				<textarea
					ref={ref}
					rows={1}
					value={text}
					disabled={disabled}
					placeholder={disabled ? 'No active session' : 'Send a prompt…'}
					className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-faint disabled:opacity-50"
					onChange={e => {
						setText(e.target.value)
						autosize()
					}}
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
					disabled={disabled || sending || !text.trim()}
					aria-label="Send"
					className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition active:scale-90 disabled:bg-surface-2 disabled:text-faint"
				>
					<ArrowUp size={19} />
				</button>
			</div>
		</div>
	)
}
