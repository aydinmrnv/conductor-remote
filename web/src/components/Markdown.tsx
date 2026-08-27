import { X } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { client } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import type { FilePreviewResponse } from '../lib/types.ts'
import { Spinner } from './ui.tsx'

/** Hoisted so the plugin list is one stable prop rather than a new array on every render. */
const PLUGINS = [remarkGfm, remarkBreaks]
const TEMP_IMAGE_PREFIX = '/tmp/'

/** Fetch temporary agent output through the relay, where the browser can attach its auth header. */
function ChatImage({ src, alt, ...props }: React.ComponentProps<'img'>) {
	const temporaryPath = typeof src === 'string' && src.startsWith(TEMP_IMAGE_PREFIX) ? src : null
	const [objectUrl, setObjectUrl] = useState<string | null>(null)

	useEffect(() => {
		if (!temporaryPath) return
		let disposed = false
		void client.localImage(temporaryPath).then(url => {
			if (!disposed) setObjectUrl(url)
		})
		return () => {
			disposed = true
		}
	}, [temporaryPath])

	if (temporaryPath) return objectUrl ? <img src={objectUrl} alt={alt ?? ''} {...props} /> : null
	return <img src={src} alt={alt ?? ''} {...props} />
}

/** Agent file links are absolute source locations, unlike the PWA's own `/w/:id` routes. */
function sourceReference(href: string | undefined): string | null {
	return href?.startsWith('/') && /:[1-9]\d*(?::\d+)?$/.test(href) ? href : null
}

/**
 * Source links must stay inside the running PWA. A browser follows `/Users/...`
 * back to this app and the router quite reasonably turns it into the home screen.
 * Intercept coding-agent locations and show a relay-backed source preview instead.
 */
function ChatLink({ href, children, onClick, ...props }: React.ComponentProps<'a'>) {
	const reference = sourceReference(href)
	const [previewing, setPreviewing] = useState(false)
	return (
		<>
			<a
				href={href}
				{...props}
				onClick={event => {
					onClick?.(event)
					if (
						!reference ||
						event.defaultPrevented ||
						event.button !== 0 ||
						event.metaKey ||
						event.ctrlKey ||
						event.shiftKey ||
						event.altKey
					)
						return
					event.preventDefault()
					setPreviewing(true)
				}}
			>
				{children}
			</a>
			{reference && previewing ? <FilePreviewSheet reference={reference} onClose={() => setPreviewing(false)} /> : null}
		</>
	)
}

function FilePreviewSheet({ reference, onClose }: { reference: string; onClose: () => void }) {
	const [preview, setPreview] = useState<FilePreviewResponse | null>(null)
	const [error, setError] = useState<string | null>(null)
	const highlightedLine = useRef<HTMLDivElement>(null)

	useEffect(() => {
		let disposed = false
		setPreview(null)
		setError(null)
		void client.filePreview(reference).then(
			result => {
				if (!disposed) setPreview(result)
			},
			err => {
				if (!disposed) setError(err instanceof Error ? err.message : 'Could not read source file')
			}
		)
		return () => {
			disposed = true
		}
	}, [reference])

	useEffect(() => {
		if (!preview?.line) return
		highlightedLine.current?.scrollIntoView({ block: 'center' })
	}, [preview?.line])

	useEffect(() => {
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', closeOnEscape)
		return () => window.removeEventListener('keydown', closeOnEscape)
	}, [onClose])

	return createPortal(
		<>
			<div className="fixed inset-0 z-[60] bg-black/60" onClick={onClose} aria-hidden />
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Source file"
				className="fade-in pt-safe pb-safe fixed inset-0 z-[60] mx-auto flex flex-col bg-bg md:inset-6 md:rounded-3xl md:border md:border-border-soft"
			>
				<header className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
					<div className="min-w-0 flex-1">
						<h2 className="text-base font-semibold">Source</h2>
						<p className="truncate font-mono text-xs text-muted">{preview?.path ?? reference}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close source preview"
						className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2"
					>
						<X size={18} />
					</button>
				</header>
				<div className="min-h-0 flex-1 overflow-auto">
					{!preview && !error ? <Spinner label="Reading source…" /> : null}
					{error ? <p className="mx-auto max-w-xs px-6 py-16 text-center text-sm text-muted">{error}</p> : null}
					{preview ? <SourceLines preview={preview} lineRef={highlightedLine} /> : null}
				</div>
			</div>
		</>,
		document.body
	)
}

function SourceLines({
	preview,
	lineRef
}: {
	preview: FilePreviewResponse
	lineRef: React.RefObject<HTMLDivElement | null>
}) {
	const lines = preview.content.split('\n')
	return (
		<>
			<pre className="min-w-max p-3 font-mono text-[11.5px] leading-[1.5] text-muted">
				{lines.map((text, index) => {
					const number = preview.lineStart + index
					const selected = number === preview.line
					return (
						<div
							key={number}
							ref={selected ? lineRef : undefined}
							className={cn(
								'grid grid-cols-[auto_1fr] gap-3 whitespace-pre',
								selected && 'rounded bg-accent-soft text-text'
							)}
						>
							<span className="select-none text-right text-faint">{number}</span>
							<code>{text || ' '}</code>
						</div>
					)
				})}
			</pre>
			{preview.truncated ? (
				<p className="border-t border-border-soft px-4 py-2 text-xs text-faint">
					Showing lines {preview.lineStart}–{preview.lineEnd} of {preview.totalLines}.
				</p>
			) : null}
		</>
	)
}

const COMPONENTS = { a: ChatLink, img: ChatImage }

/**
 * Chat markdown. GFM for tables/strikethrough/task lists, breaks so single
 * newlines behave like chat line breaks. Raw HTML is not rendered (react-markdown
 * escapes it by default), so transcript content can't inject markup.
 *
 * `memo` is load-bearing, not a micro-optimisation: rendering this parses the text
 * through remark and rehype, and the transcript holds one per message. The polls
 * above it re-render the whole chat every couple of seconds, so without the bail-out
 * a long session re-parses every message it has ever shown — measured at ~300ms of
 * blocked main thread per poll on a phone-class CPU, which is what makes the
 * spinners stutter. The prop is a plain string, so the default compare is exact.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
	return (
		<div className="md">
			<ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
				{children}
			</ReactMarkdown>
		</div>
	)
})
