import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

/** Hoisted so the plugin list is one stable prop rather than a new array on every render. */
const PLUGINS = [remarkGfm, remarkBreaks]

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
			<ReactMarkdown remarkPlugins={PLUGINS}>{children}</ReactMarkdown>
		</div>
	)
})
