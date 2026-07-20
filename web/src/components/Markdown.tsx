import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

/**
 * Chat markdown. GFM for tables/strikethrough/task lists, breaks so single
 * newlines behave like chat line breaks. Raw HTML is not rendered (react-markdown
 * escapes it by default), so transcript content can't inject markup.
 */
export function Markdown({ children }: { children: string }) {
	return (
		<div className="md">
			<ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{children}</ReactMarkdown>
		</div>
	)
}
