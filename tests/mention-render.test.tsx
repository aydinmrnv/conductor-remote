import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

/**
 * That a file an agent named in a message actually reaches the reader as a link.
 *
 * The matcher next door is pure and pinned; what this covers is the one step between it
 * and the screen, which is a fact about `react-markdown` rather than about our code:
 * inline code arrives at `ChatCode` with **no class**, which is how a mention is told
 * apart from a fenced block. An upgrade that starts labelling inline spans would leave
 * every other test passing and quietly stop linking anything, with nothing on screen to
 * say so.
 *
 * The three browser globals are stubbed rather than pulled in with a DOM package: the
 * chat imports the app's token store, which reads the URL on load, and that is the whole
 * of what this needs a browser for. Static markup, so nothing here needs a document.
 */
const WORKTREE = '/Users/someone/conductor/workspaces/project/berlin'

Object.defineProperty(globalThis, 'location', { configurable: true, value: { hash: '', pathname: '/', search: '' } })
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
})
Object.defineProperty(globalThis, 'history', { configurable: true, value: { replaceState: () => {} } })

const { Markdown } = await import('../web/src/components/Markdown.tsx')
const { buildResolver, MentionResolverProvider } = await import('../web/src/lib/fileMentions.ts')
const resolve = buildResolver(WORKTREE, ['src/git.ts'])

function render(markdown: string, mentions = true) {
	const chat = <Markdown>{markdown}</Markdown>
	return renderToStaticMarkup(
		mentions ? <MentionResolverProvider value={resolve}>{chat}</MentionResolverProvider> : chat
	)
}

describe('a file mention in a message', () => {
	it('renders as a button that opens the source, still drawn as code', () => {
		const html = render('we updated `src/git.ts` today')
		expect(html).toContain(`title="Open ${WORKTREE}/src/git.ts"`)
		expect(html).toContain('<code')
	})

	it('leaves a fenced block alone, even one whose only line is a path', () => {
		// A fence with no info string carries no class either, so its trailing newline is
		// the whole of what tells the two apart.
		expect(render('```\nsrc/git.ts\n```')).not.toContain('<button')
		expect(render('```ts\nsrc/git.ts\n```')).not.toContain('<button')
	})

	it('resolves only absolute paths where no workspace is on screen', () => {
		// An archived chat, whose worktree is deleted: `~/plan.md` is as readable as ever.
		expect(render('we updated `src/git.ts` today', false)).not.toContain('<button')
		expect(render('plan written to `~/plan.md`', false)).toContain('title="Open ~/plan.md"')
	})
})
