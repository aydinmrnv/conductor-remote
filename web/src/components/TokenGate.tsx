import { type FormEvent, useState } from 'react'
import { parseTokenInput } from '../lib/api.ts'
import { useApp } from '../store.ts'

export function TokenGate() {
	const setToken = useApp(s => s.setToken)
	const [value, setValue] = useState('')
	const [error, setError] = useState(false)

	const submit = (e: FormEvent) => {
		e.preventDefault()
		const token = parseTokenInput(value)
		// setToken persists it; a wrong token just 401s and bounces back here.
		if (token) setToken(token)
		else setError(true)
	}

	return (
		<div className="pt-safe pb-safe flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
			<img src="/icon.svg" alt="" className="size-20 rounded-3xl" />
			<div>
				<h1 className="text-xl font-semibold">Conductor Remote</h1>
				<p className="mt-1 text-sm text-muted">Phone control panel for your local agents</p>
			</div>
			<p className="max-w-xs text-sm leading-relaxed text-muted">
				Open the URL the relay printed on startup — it carries your access token (
				<span className="font-mono text-faint">/#token=…</span>). Then use{' '}
				<b className="text-text">Add to Home Screen</b> to install it.
			</p>
			<form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-2">
				<input
					type="text"
					inputMode="text"
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					value={value}
					onChange={e => {
						setValue(e.target.value)
						setError(false)
					}}
					placeholder="Paste token or URL"
					aria-label="Access token or URL"
					className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-center font-mono text-sm text-text placeholder:font-sans placeholder:text-faint"
				/>
				<button type="submit" className="pill pill-active justify-center py-2.5">
					Connect
				</button>
				{error ? (
					<p className="text-xs" style={{ color: 'var(--color-del)' }}>
						Couldn’t find a token in that — paste the token or the full URL.
					</p>
				) : null}
			</form>
			<p className="max-w-xs text-xs leading-relaxed text-faint">
				Lost it? Run <span className="font-mono">yarn service status</span> on your Mac to reprint the URL and QR.
			</p>
		</div>
	)
}
