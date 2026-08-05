import { ArrowUp, Info, WifiOff } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSendPrompt } from '../hooks.ts'
import type { ActuatorInfo, Session } from '../lib/types.ts'
import { useApp } from '../store.ts'
import { AgentBar } from './AgentBar.tsx'

/**
 * The draft lives in the store (persisted per workspace — see lib/draft.ts), not
 * in local state: a first prompt that couldn't be delivered is stashed straight
 * into it, and the box has to show that the moment it lands rather than on the
 * next remount.
 *
 * The agent controls live *inside* the card, under the text and sharing the send
 * button's row — one border, one left edge (card padding 8px + control padding
 * 8px = the textarea's own text inset, so labels and prompt line up on the same
 * rule). They used to be a separate strip above it, which read as a second
 * toolbar and lined up with nothing.
 */
export function Composer({
	session,
	sessionId,
	workspaceId,
	actuator
}: {
	/** The chat the controls act on; absent while the workspace has no session yet. */
	session?: Session
	sessionId: string | null
	workspaceId: string
	actuator?: ActuatorInfo
}) {
	const text = useApp(s => s.drafts[workspaceId] ?? '')
	const setDraft = useApp(s => s.setDraft)
	const online = useApp(s => s.online)
	const sendPrompt = useSendPrompt()
	const ref = useRef<HTMLTextAreaElement>(null)

	const autosize = () => {
		const el = ref.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`
	}

	// Fit a restored — or externally stashed — draft, not just what's being typed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes, however it changed
	useEffect(autosize, [text])

	// Fire-and-forget: the optimistic bubble (and its inline error on failure) is the
	// feedback now, so we clear the box immediately instead of awaiting the send.
	const send = () => {
		const value = text.trim()
		if (!value || !sessionId || !online) return
		void sendPrompt({ sessionId, workspaceId, text: value })
		setDraft(workspaceId, '')
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
			) : (
				!precise && (
					<div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-faint">
						<Info size={12} />
						{actuator?.caveat || 'Sends to the focused session'}
					</div>
				)
			)}
			{/* `has-[textarea:focus]`, not `focus-within`: the controls inside the card take
			    focus too, and lighting the whole card up on a Plan tap reads as a typo. */}
			<div className="rounded-2xl border border-border bg-surface p-2 has-[textarea:focus]:border-accent/60">
				<textarea
					ref={ref}
					rows={1}
					value={text}
					disabled={disabled}
					placeholder={disabled ? 'No active session' : 'Send a prompt…'}
					// text-base is load-bearing: iOS auto-zooms the page when a field under 16px
					// takes focus, and never zooms back out on blur.
					className="block max-h-40 w-full resize-none bg-transparent px-2 py-1 text-base outline-none placeholder:text-faint disabled:opacity-50"
					onChange={e => setDraft(workspaceId, e.target.value)}
					onKeyDown={e => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
							e.preventDefault()
							send()
						}
					}}
				/>
				<div className="mt-1 flex items-end gap-2">
					{session ? <AgentBar session={session} workspaceId={workspaceId} /> : <span className="flex-1" />}
					<button
						type="button"
						onClick={send}
						disabled={disabled || !text.trim() || !online}
						aria-label="Send"
						className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition active:scale-90 disabled:bg-surface-2 disabled:text-faint"
					>
						<ArrowUp size={19} />
					</button>
				</div>
			</div>
		</div>
	)
}
