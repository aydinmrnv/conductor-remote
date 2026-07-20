import { Check, Copy, X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../store.ts'
import { QRCode } from './QRCode.tsx'

/**
 * Connection sheet — shows a QR + copyable link for THIS device's token URL so you can re-scan it onto
 * another phone or re-add it to the home screen, and disconnect (clears the stored token → TokenGate).
 * The gate itself is tokenless and can't draw this, so the QR lives here. Reached from the sidebar header.
 */
export function ConnectSheet({ version, onClose }: { version?: string; onClose: () => void }) {
	const token = useApp(s => s.token)
	const setToken = useApp(s => s.setToken)
	const [copied, setCopied] = useState(false)
	const url = token ? `${location.origin}/#token=${token}` : location.origin
	// Relay is ahead of the build this app booted → a service-worker update is pending
	// (ReloadPrompt will surface it). Flag it here so the versions explain a stale UI.
	const stale = !!version && version !== __APP_VERSION__

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(url)
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		} catch {
			// clipboard blocked (insecure context / denied) — the link is on screen to copy by hand
		}
	}

	return (
		<>
			<div className="fixed inset-0 z-50 bg-black/60" onClick={onClose} aria-hidden />
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Connect a device"
				className="fade-in pb-safe fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-sm flex-col items-center gap-4 rounded-t-3xl border border-border-soft bg-surface p-5 shadow-xl md:inset-0 md:m-auto md:h-fit md:rounded-3xl"
			>
				<div className="flex w-full items-center justify-between">
					<h2 className="text-base font-semibold">Connect a device</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="flex size-8 items-center justify-center rounded-full text-muted active:bg-surface-2"
					>
						<X size={18} />
					</button>
				</div>
				<p className="text-center text-sm text-muted">
					Scan on another phone, or re-add this to your home screen. The link carries your access token.
				</p>
				<div className="rounded-2xl bg-white p-3">
					<QRCode text={url} size={216} />
				</div>
				<button
					type="button"
					onClick={copy}
					className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm active:bg-surface"
				>
					{copied ? <Check size={16} /> : <Copy size={16} />}
					{copied ? 'Copied' : 'Copy link'}
				</button>
				<div className="flex w-full items-center justify-between text-xs text-faint">
					<span className="font-mono">
						{version ? `relay v${version}` : 'relay v?'}
						{' · '}
						<span className={stale ? 'text-working' : undefined}>app v{__APP_VERSION__}</span>
						{stale ? ' · update pending' : ''}
					</span>
					<button
						type="button"
						onClick={() => setToken(null)}
						className="text-muted underline-offset-2 hover:underline"
					>
						Disconnect
					</button>
				</div>
			</div>
		</>
	)
}
