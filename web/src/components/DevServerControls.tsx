import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Globe2, Loader2, Play, Square } from 'lucide-react'
import { useState } from 'react'
import { useDevServer } from '../hooks.ts'
import { client } from '../lib/api.ts'
import { useApp } from '../store.ts'

/**
 * Open the forward the tap just created. Safari drops a tap's activation after a
 * few seconds, so this lands for a server that was already running (about a
 * second) and is refused for a cold start that spent half a minute in Conductor's
 * UI. The Open control is on screen for that case, and a refusal changes nothing.
 * A backgrounded app is left alone: pulling someone into a browser tab minutes
 * later is not what they tapped for.
 */
function openForward(url: string) {
	if (document.visibilityState !== 'visible') return
	window.open(url, '_blank', 'noopener,noreferrer')
}

const controlClass =
	'flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition active:bg-surface-2 disabled:opacity-40'

/** Start, expose, open and stop the workspace's selected Conductor Run task. */
export function DevServerControls({ workspaceId }: { workspaceId: string }) {
	const query = useDevServer(workspaceId)
	const queryClient = useQueryClient()
	const online = useApp(s => s.online)
	const [busy, setBusy] = useState<'start' | 'stop' | null>(null)
	const [error, setError] = useState<string | null>(null)
	const state = query.data

	const apply = async (running: boolean) => {
		if (busy) return
		setBusy(running ? 'start' : 'stop')
		setError(null)
		try {
			const result = running ? await client.startDevServer(workspaceId) : await client.stopDevServer(workspaceId)
			queryClient.setQueryData(['dev-server', workspaceId], result)
			if (!result.ok) setError(result.error ?? `Could not ${running ? 'start' : 'stop'} the dev server`)
			else if (running && result.url) openForward(result.url)
		} catch (err) {
			setError(err instanceof Error ? err.message : `Could not ${running ? 'start' : 'stop'} the dev server`)
		} finally {
			setBusy(null)
			void queryClient.invalidateQueries({ queryKey: ['dev-server', workspaceId] })
		}
	}

	const startLabel = state?.running ? 'Forward dev server to tailnet' : 'Start and forward dev server'
	const unavailable = state && !state.available

	return (
		<>
			{state?.forwarded && state.url ? (
				<a
					href={state.url}
					target="_blank"
					rel="noreferrer"
					aria-label={`Open dev server${state.port ? ` on port ${state.port}` : ''}`}
					title={state.url}
					className={controlClass}
				>
					<ExternalLink size={18} />
				</a>
			) : (
				<button
					type="button"
					onClick={() => void apply(true)}
					disabled={!online || !!busy || !!unavailable || query.isLoading}
					aria-label={startLabel}
					title={unavailable ? state.error : startLabel}
					className={controlClass}
				>
					{busy === 'start' || query.isLoading ? (
						<Loader2 size={18} className="animate-spin" />
					) : state?.running ? (
						<Globe2 size={18} />
					) : (
						<Play size={18} fill="currentColor" />
					)}
				</button>
			)}
			{state?.running ? (
				<button
					type="button"
					onClick={() => void apply(false)}
					disabled={!online || !!busy}
					aria-label="Stop dev server"
					className={controlClass}
				>
					{busy === 'stop' ? <Loader2 size={18} className="animate-spin" /> : <Square size={15} fill="currentColor" />}
				</button>
			) : null}
			{error ? (
				<button
					type="button"
					onClick={() => setError(null)}
					className="absolute right-2 top-full z-30 max-w-72 rounded-lg border border-del/40 bg-surface px-3 py-2 text-left text-xs text-del shadow-xl"
				>
					{error}
				</button>
			) : null}
		</>
	)
}
