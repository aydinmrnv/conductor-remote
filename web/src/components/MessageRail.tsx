import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn.ts'

/**
 * The jump rail: a scrollbar-thin map of *your own* prompts down the right edge of
 * the transcript, scrubbable with one thumb.
 *
 * Three decisions carry it:
 *
 * 1. **It is asleep by default and wakes on a gesture, not on scroll.** Waking on the
 *    `scroll` event would light it every time the agent streams a line, because the
 *    transcript auto-pins to the bottom — a rail that blinks through a whole turn is
 *    worse than no rail. So `touchmove`/`wheel` (a *person* moving the view) is what
 *    wakes it, and once lit its own scrolling keeps it lit, which is what covers iOS
 *    momentum running long after the finger left. Asleep it is `pointer-events:none`,
 *    so it can never eat a tap meant for a message.
 * 2. **The drag snaps to messages instead of scrubbing freely.** A phone rail is ~600px
 *    against a transcript tens of thousands of pixels tall, so one pixel of finger is
 *    ~50px of content and free scrubbing lands nowhere in particular. Snapping to the
 *    nearest prompt means every position under your thumb is somewhere you meant to go,
 *    and the label says which one before you commit.
 * 3. **Marks are measured from the DOM, not from the entry list.** A step group opening,
 *    an image loading, a markdown table reflowing — all move a message without changing
 *    the list, and the transcript is the one place where "how tall is it really" is the
 *    only honest answer. Hence `[data-user-msg]` + `getBoundingClientRect`, re-measured
 *    while awake (and never while asleep, so an idle chat costs nothing).
 */

/** How long the rail stays lit after the last scroll or scrub. */
const IDLE_MS = 2000
/** Breathing room above the message we land on, so it isn't flush against the tab strip. */
const HEADROOM = 12
/** Vertical inset of the track inside the rail (Tailwind `inset-y-2`), in px. */
const TRACK_INSET = 8
/** Below this there's nothing to navigate — one prompt is already on screen. */
const MIN_MARKS = 2

type Mark = { top: number; preview: string; node: HTMLElement }
type View = { top: number; height: number; total: number }

const EMPTY_VIEW: View = { top: 0, height: 0, total: 0 }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const sameMarks = (a: Mark[], b: Mark[]) =>
	a.length === b.length && a.every((m, i) => m.top === b[i].top && m.preview === b[i].preview)

export function MessageRail({ scroller }: { scroller: RefObject<HTMLDivElement | null> }) {
	const rail = useRef<HTMLDivElement>(null)
	const track = useRef<HTMLDivElement>(null)
	const [marks, setMarks] = useState<Mark[]>([])
	const [view, setView] = useState<View>(EMPTY_VIEW)
	const [awake, setAwake] = useState(false)
	/** Index under the thumb while scrubbing; null when not. */
	const [drag, setDrag] = useState<number | null>(null)

	// Refs shadow the state the pointer handlers read, so a jump acts on what was just
	// measured rather than on last render's closure.
	const marksRef = useRef<Mark[]>([])
	const viewRef = useRef<View>(EMPTY_VIEW)
	const awakeRef = useRef(false)
	const dragRef = useRef(false)
	const landed = useRef<number | null>(null)
	const sleepTimer = useRef(0)
	const frame = useRef(0)

	const wake = useCallback(() => {
		awakeRef.current = true
		setAwake(true)
		clearTimeout(sleepTimer.current)
		sleepTimer.current = window.setTimeout(() => {
			// A scrub in progress outlives the timer; releasing it re-arms this.
			if (dragRef.current) return
			awakeRef.current = false
			setAwake(false)
		}, IDLE_MS)
	}, [])

	const measure = useCallback(() => {
		const el = scroller.current
		if (!el) return
		// Content-space offsets: rect-relative, so no positioned-ancestor assumptions.
		const base = el.getBoundingClientRect().top - el.scrollTop
		const next = Array.from(el.querySelectorAll<HTMLElement>('[data-user-msg]'), node => ({
			top: node.getBoundingClientRect().top - base,
			preview: node.dataset.userMsg ?? '',
			node
		}))
		marksRef.current = sameMarks(marksRef.current, next) ? marksRef.current : next
		setMarks(marksRef.current)
		const v = { top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight }
		viewRef.current = v
		setView(v)
	}, [scroller])

	const schedule = useCallback(() => {
		if (frame.current) return
		frame.current = requestAnimationFrame(() => {
			frame.current = 0
			measure()
		})
	}, [measure])

	useEffect(() => {
		const el = scroller.current
		if (!el) return
		// A person moving the view is what reveals the rail — never the transcript
		// scrolling itself, or it would blink through every streamed message.
		const onGesture = () => {
			wake()
			schedule()
		}
		// Once lit, any scrolling keeps it lit: momentum, and the jump we just made.
		const onScroll = () => {
			if (!awakeRef.current) return
			wake()
			schedule()
		}
		el.addEventListener('touchmove', onGesture, { passive: true })
		el.addEventListener('wheel', onGesture, { passive: true })
		el.addEventListener('scroll', onScroll, { passive: true })
		// Both observers only cost anything while the rail is on screen. The mutation one
		// is what catches a step group being opened under a lit rail.
		const whileAwake = () => {
			if (awakeRef.current) schedule()
		}
		const ro = new ResizeObserver(whileAwake)
		ro.observe(el)
		const mo = new MutationObserver(whileAwake)
		mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
		return () => {
			el.removeEventListener('touchmove', onGesture)
			el.removeEventListener('wheel', onGesture)
			el.removeEventListener('scroll', onScroll)
			ro.disconnect()
			mo.disconnect()
			if (frame.current) cancelAnimationFrame(frame.current)
			clearTimeout(sleepTimer.current)
		}
	}, [scroller, wake, schedule])

	/** Where a mark sits on the rail: its share of the scrollable content. */
	const ratioOf = (top: number, total: number) => (total > 0 ? clamp(top / total, 0, 1) : 0)

	/** Snap to the prompt nearest the finger and put it at the top of the view. */
	const jumpTo = (clientY: number) => {
		const list = marksRef.current
		const box = track.current?.getBoundingClientRect()
		const el = scroller.current
		if (!(list.length && box && el)) return
		const y = clamp((clientY - box.top) / Math.max(1, box.height), 0, 1)
		const total = viewRef.current.total
		let best = 0
		for (let i = 1; i < list.length; i++) {
			if (Math.abs(ratioOf(list[i].top, total) - y) < Math.abs(ratioOf(list[best].top, total) - y)) best = i
		}
		landed.current = best
		setDrag(best)
		el.scrollTop = Math.max(0, list[best].top - HEADROOM)
	}

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		e.preventDefault()
		// Capture keeps the scrub alive when the thumb wanders off the 28px strip. It throws
		// if the pointer is already gone; that only costs us tracking, so don't lose the jump.
		try {
			rail.current?.setPointerCapture(e.pointerId)
		} catch {}
		dragRef.current = true
		wake()
		measure()
		jumpTo(e.clientY)
	}

	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (dragRef.current) jumpTo(e.clientY)
	}

	const endDrag = () => {
		if (!dragRef.current) return
		dragRef.current = false
		// Flash the bubble we landed on: an instant jump is disorienting without a "here".
		// Off the ref, not the state, so a release in the same tick as the last move still
		// marks the message we actually went to.
		const bubble = landed.current !== null ? marksRef.current[landed.current]?.node.firstElementChild : null
		bubble?.animate([{ boxShadow: '0 0 0 2px var(--color-accent)' }, { boxShadow: '0 0 0 2px transparent' }], {
			duration: 650,
			easing: 'ease-out'
		})
		setDrag(null)
		wake()
	}

	if (marks.length < MIN_MARKS) return null

	const trackH = Math.max(1, view.height - TRACK_INSET * 2)
	const at = (top: number) => ratioOf(top, view.total) * trackH
	// Which prompt you're reading: the last one at or above the top of the view.
	let current = -1
	for (let i = 0; i < marks.length; i++) if (marks[i].top <= view.top + HEADROOM + 8) current = i
	const active = drag ?? current
	const scrubbed = drag !== null ? marks[drag] : null

	return (
		<div
			ref={rail}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onPointerEnter={wake}
			aria-hidden="true"
			className={cn(
				'absolute inset-y-0 right-0 z-10 w-7 touch-none select-none transition-opacity duration-200',
				awake || drag !== null ? 'opacity-100' : 'pointer-events-none opacity-0'
			)}
		>
			<div ref={track} className="absolute inset-y-2 right-0 w-full">
				{/* The hairline is the transcript; the thumb on it is the part you're looking at. */}
				<div className="absolute inset-y-0 right-[7px] w-px bg-border-soft" />
				<div
					className="absolute right-1.5 w-[3px] rounded-full bg-border"
					style={{
						top: `${at(view.top)}px`,
						height: `${Math.max(10, (view.height / Math.max(1, view.total)) * trackH)}px`
					}}
				/>
				{marks.map((m, i) => (
					<span
						key={m.top}
						style={{ top: `${at(m.top)}px` }}
						className={cn(
							'absolute right-2.5 h-[3px] -translate-y-1/2 rounded-full bg-accent/55 transition-[width,background-color] duration-150',
							// Scrubbing fattens every mark, so the row of targets reads as grabbable.
							i === active ? 'w-5 bg-accent' : drag !== null ? 'w-3.5' : 'w-2.5'
						)}
					/>
				))}
				{scrubbed ? (
					<div
						style={{ top: `${clamp(at(scrubbed.top), 14, trackH - 14)}px` }}
						className="fade-in pointer-events-none absolute right-7 flex max-w-[60vw] -translate-y-1/2 items-center gap-2 rounded-full border border-border bg-surface-2/95 py-1 pr-3 pl-2.5 text-[12px] shadow-lg shadow-black/40"
					>
						<span className="shrink-0 font-mono text-[10px] text-faint tabular-nums">
							{(drag ?? 0) + 1}/{marks.length}
						</span>
						<span className="truncate">{scrubbed.preview || 'Your message'}</span>
					</div>
				) : null}
			</div>
		</div>
	)
}
