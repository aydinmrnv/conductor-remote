import { Check, Copy, X } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../store.ts'

/**
 * Connection sheet — copy this device's access link (to open Conductor Remote on another device or re-add
 * it to the home screen) and disconnect (clears the stored token → TokenGate). Reached from the sidebar
 * header.
 *
 * No QR here on purpose: a phone can't scan its own screen, and the copy link covers device-to-device
 * hand-off. The scannable QR lives where a camera can actually reach it — the Mac's `yarn service status`
 * terminal output, which the phone scans via the TokenGate's in-app scanner.
 */
export function ConnectSheet({ version, onClose }: { version?: string; onClose: () => void }) {
	const token = useApp(s => s.token)
	const setToken = useApp(s => s.setToken)
	const [copied, setCopied] = useState(false)
	const url = token ? `${location.origin}/#token=${token}` : location.origin

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
				className="fade-in pb-safe fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-sm flex-col gap-4 rounded-t-3xl border border-border-soft bg-surface p-5 shadow-xl md:inset-0 md:m-auto md:h-fit md:rounded-3xl"
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
				<p className="text-sm text-muted">
					Copy this device’s access link to open Conductor Remote on another device, or to re-add it to your home
					screen. The link carries your access token.
				</p>
				<div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
					<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{url}</span>
					<button
						type="button"
						onClick={copy}
						aria-label="Copy link"
						className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text active:bg-surface"
					>
						{copied ? <Check size={16} /> : <Copy size={16} />}
						{copied ? 'Copied' : 'Copy'}
					</button>
				</div>
				<div className="flex w-full items-center justify-between text-xs text-faint">
					<span className="font-mono">{version ? `relay v${version}` : ''}</span>
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
