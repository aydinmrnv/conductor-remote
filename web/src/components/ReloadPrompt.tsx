import { useRegisterSW } from 'virtual:pwa-register/react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { client } from '../lib/api.ts'
import type { StateResponse } from '../lib/types.ts'
import { useApp } from '../store.ts'

const POLL_INTERVAL = 60_000
// If the banner reappears within this window of tapping Update, the update didn't take
// (activation failed, or a waiting worker is re-detected immediately). Suppress it once
// so a bad update can't tight-loop update → reload → banner → update. sessionStorage,
// not localStorage, so a genuine update in a later session still prompts normally.
const UPDATE_RETRY_WINDOW = 10_000
const UPDATE_ATTEMPT_KEY = 'pwa-update-attempted-at'

/**
 * Keeps the installed PWA off a stale build. iOS standalone apps rarely re-fetch `sw.js`
 * on their own, so a newer relay build can sit unseen for hours. Three nudges:
 *  1. a 60s `registration.update()` poll — forces the browser to look for a new SW;
 *  2. an *immediate* update check the moment `/api/state` reports a relay version newer
 *     than this bundle (`__APP_VERSION__`) — recovery in one state-poll, not up to 60s;
 *  3. a one-tap banner to apply the waiting worker (skipWaiting + reload).
 * `public/self-heal.js` is the deeper fallback for when the bundle can't even boot.
 */
export function ReloadPrompt() {
	const token = useApp(s => s.token)
	const registration = useRef<ServiceWorkerRegistration | null>(null)
	const {
		needRefresh: [needRefresh, setNeedRefresh],
		updateServiceWorker
	} = useRegisterSW({
		onRegisteredSW(_url, reg) {
			if (!reg) return
			registration.current = reg
			setInterval(() => void reg.update().catch(() => {}), POLL_INTERVAL)
		}
	})

	// Shares react-query's ['state'] cache with useWorkspaces — no extra fetch; just reads
	// the relay version the list already polls. Gated on token so it stays quiet on the gate.
	const { data } = useQuery<StateResponse>({
		queryKey: ['state'],
		queryFn: () => client.state(),
		enabled: !!token,
		refetchInterval: false
	})
	const relayVersion = data?.version
	const acted = useRef<string | null>(null)
	useEffect(() => {
		if (!relayVersion || relayVersion === __APP_VERSION__ || acted.current === relayVersion) return
		acted.current = relayVersion // once per newly-seen relay version, don't re-check every poll
		void registration.current?.update().catch(() => {})
	}, [relayVersion])

	useEffect(() => {
		if (!needRefresh) return
		const attemptedAt = Number(sessionStorage.getItem(UPDATE_ATTEMPT_KEY))
		sessionStorage.removeItem(UPDATE_ATTEMPT_KEY)
		if (attemptedAt && Date.now() - attemptedAt < UPDATE_RETRY_WINDOW) setNeedRefresh(false)
	}, [needRefresh, setNeedRefresh])

	if (!needRefresh) return null

	const apply = () => {
		sessionStorage.setItem(UPDATE_ATTEMPT_KEY, String(Date.now()))
		void updateServiceWorker(true)
	}

	return (
		<div className="pb-safe fade-in fixed inset-x-0 bottom-0 z-[60] mx-auto flex max-w-sm items-center gap-3 rounded-t-2xl border border-border-soft bg-surface px-4 py-3 shadow-xl">
			<RefreshCw size={15} className="shrink-0 text-accent" />
			<span className="flex-1 text-sm">New version ready</span>
			<button
				type="button"
				onClick={() => setNeedRefresh(false)}
				className="rounded-lg px-2 py-1 text-xs text-muted active:bg-surface-2"
			>
				Later
			</button>
			<button
				type="button"
				onClick={apply}
				className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-black transition active:scale-95"
			>
				Update
			</button>
		</div>
	)
}
