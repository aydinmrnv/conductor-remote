export function TokenGate() {
	return (
		<div className="pt-safe pb-safe flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
			<img src="/icon.svg" alt="" className="size-20 rounded-3xl" />
			<div>
				<h1 className="text-xl font-semibold">Conductor Remote</h1>
				<p className="mt-1 text-sm text-muted">Phone control panel for your local agents</p>
			</div>
			<p className="max-w-xs text-sm leading-relaxed text-muted">
				Open the URL the relay printed on startup — it carries your access token in the address (
				<span className="font-mono text-faint">/#token=…</span>). Then use{' '}
				<b className="text-text">Add to Home Screen</b> to install it.
			</p>
		</div>
	)
}
