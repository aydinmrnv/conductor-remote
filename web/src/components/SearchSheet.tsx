import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Workspace } from '../lib/types.ts'
import { SearchPane } from './SearchPane.tsx'
import { Empty } from './ui.tsx'

/**
 * Search, as a modal over the whole screen rather than a field above the list.
 *
 * The field used to sit under the header permanently, which cost a row of the list
 * on every launch to serve the one control you reach for a few times a day — and on a
 * phone that row is most of a workspace card. As a modal it also gets the width the
 * results actually want: an excerpt is two lines of prose, and the 320px drawer was
 * clipping the part that says why the hit matched.
 *
 * Sized off `--app-height`, not `inset-0`, because this sheet owns a focused input:
 * `fixed` resolves against the layout viewport, so a full-height sheet puts its own
 * results behind the software keyboard. The app column already shrinks that way
 * (index.css ▸ --app-height), and `.app-height` is the same rule.
 */
export function SearchSheet({
	live,
	selectedId,
	onOpen,
	onClose
}: {
	live: Workspace[]
	selectedId?: string
	onOpen: (workspaceId: string, sessionId: string | null) => void
	onClose: () => void
}) {
	const [query, setQuery] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)

	// Focus on mount rather than with `autoFocus`: React applies that one before the
	// node is in the document on some WebKit builds, and the keyboard never comes up.
	useEffect(() => inputRef.current?.focus(), [])

	// Esc is the desktop way out — the phone has the Cancel button and the scrim.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [onClose])

	// Portalled to <body> for the same reason as the other sheets: the drawer <aside> it
	// opens from carries a `transform`, which would make `fixed` mean "the drawer".
	return createPortal(
		<>
			<div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} aria-hidden />
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Search workspaces and chats"
				className="app-height fade-in pt-safe fixed inset-x-0 top-0 z-50 flex flex-col bg-bg md:inset-x-auto md:left-1/2 md:top-16 md:max-h-[70vh] md:w-[36rem] md:max-w-[92vw] md:-translate-x-1/2 md:rounded-2xl md:border md:border-border md:shadow-2xl"
			>
				<div className="flex items-center gap-2 border-b border-border-soft px-3 py-2.5">
					<div className="relative min-w-0 flex-1">
						<Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
						{/* `type="text"`, not `type="search"` — WebKit's built-in clear affordance is a
						    different size and colour on every iOS version, so the X below is ours. Without
						    `enterKeyHint` the return key says "Go" and implies a submit this box has not got. */}
						<input
							ref={inputRef}
							type="text"
							inputMode="search"
							enterKeyHint="search"
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
							value={query}
							onChange={e => setQuery(e.target.value)}
							placeholder="Search workspaces and chats"
							aria-label="Search workspaces and chats"
							className="w-full rounded-xl border border-border bg-surface py-2 pl-8 pr-9 text-sm text-text placeholder:text-faint focus:border-accent/50 focus:outline-none"
						/>
						{query ? (
							<button
								type="button"
								onClick={() => {
									setQuery('')
									inputRef.current?.focus()
								}}
								aria-label="Clear search"
								className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted active:bg-surface-2"
							>
								<X size={15} />
							</button>
						) : null}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="shrink-0 rounded-full px-2 py-1.5 text-sm text-muted active:bg-surface-2"
					>
						Cancel
					</button>
				</div>
				<div className="pb-safe min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
					{query.trim() ? (
						<SearchPane query={query} live={live} selectedId={selectedId} onOpen={onOpen} />
					) : (
						<Empty>Every workspace on this Mac, archived included — by name, or by something said in the chat.</Empty>
					)}
				</div>
			</div>
		</>,
		document.body
	)
}
