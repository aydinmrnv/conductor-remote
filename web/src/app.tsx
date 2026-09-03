import { Command, PanelLeftOpen, Plus, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useMatch } from 'react-router'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ReloadPrompt } from './components/ReloadPrompt.tsx'
import { SessionView } from './components/SessionView.tsx'
import { TokenGate } from './components/TokenGate.tsx'
import { WorkspaceList } from './components/WorkspaceList.tsx'
import {
	useEdgeSwipeDrawer,
	usePrefsSync,
	usePushRouting,
	usePushSync,
	useVisualViewportHeight,
	useWorkspaces
} from './hooks.ts'
import { cn } from './lib/cn.ts'
import { DESKTOP, modKey, useMediaQuery } from './lib/media.ts'
import { useShortcuts } from './lib/shortcuts.ts'
import { useApp } from './store.ts'

export function App() {
	useVisualViewportHeight()
	const token = useApp(s => s.token)
	// ReloadPrompt sits above the token gate so SW updates apply on every screen.
	return (
		<TooltipProvider delayDuration={400}>
			<ReloadPrompt />
			{!token ? (
				<TokenGate />
			) : (
				<Routes>
					<Route element={<Shell />}>
						<Route index element={<HomePane />} />
						<Route path="/w/:workspaceId" element={<SessionView />} />
					</Route>
					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
			)}
		</TooltipProvider>
	)
}

const RAIL_KEY = 'conductor-remote-rail'
const RAIL_WIDTH = 320

/**
 * The shell, in two shapes.
 *
 * On a phone the workspace list is the whole screen at `/` and a drawer over a chat
 * (toggled from the header, edge-swiped, closed by picking a workspace or the scrim).
 *
 * On a desktop it is a rail beside the chat: resizable in spirit — collapsible with
 * ⌘B into a slim column of the three things you reach for (expand, search, new), and
 * remembered across launches — so a wide screen reads as an app, not a phone page.
 */
function Shell() {
	const match = useMatch('/w/:workspaceId')
	const atHome = !match
	const desktop = useMediaQuery(DESKTOP)
	const sidebarOpen = useApp(s => s.sidebarOpen)
	const setSidebarOpen = useApp(s => s.setSidebarOpen)
	const drawerRef = useRef<HTMLElement>(null)
	useEdgeSwipeDrawer(drawerRef, !atHome && !desktop)
	usePushRouting()
	usePushSync()
	usePrefsSync()

	const [railOpen, setRailOpen] = useState(() => {
		try {
			return localStorage.getItem(RAIL_KEY) !== 'closed'
		} catch {
			return true
		}
	})
	const toggleRail = useCallback(() => {
		setRailOpen(o => {
			try {
				localStorage.setItem(RAIL_KEY, o ? 'closed' : 'open')
			} catch {}
			return !o
		})
	}, [])
	// The list mounts its own ⌘K / ⌘N; the shell owns the rail.
	const shortcuts = useMemo(() => ({ 'mod+b': (e: KeyboardEvent) => (e.preventDefault(), toggleRail()) }), [toggleRail])
	useShortcuts(shortcuts, desktop)

	// The list is the home screen on a phone; on a desktop it never covers anything.
	const showRail = desktop ? railOpen || atHome : true

	return (
		<div className="relative isolate flex h-full overflow-hidden bg-background text-foreground">
			<Ambient />
			{!desktop && sidebarOpen && !atHome ? (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-40 bg-black/50"
					onClick={() => setSidebarOpen(false)}
					aria-hidden
				/>
			) : null}
			{desktop ? (
				<motion.div
					initial={false}
					animate={{ width: showRail ? RAIL_WIDTH : 56 }}
					transition={{ type: 'spring', stiffness: 380, damping: 38 }}
					className="relative z-10 flex h-full shrink-0 overflow-hidden border-r border-border/60 bg-card/40 backdrop-blur-xl"
				>
					<AnimatePresence initial={false} mode="popLayout">
						{showRail ? (
							<motion.aside
								key="rail"
								initial={{ opacity: 0, x: -12 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: -12 }}
								transition={{ duration: 0.18 }}
								style={{ width: RAIL_WIDTH }}
								className="flex h-full shrink-0 flex-col"
							>
								<WorkspaceList selectedId={match?.params.workspaceId} onCollapse={atHome ? undefined : toggleRail} />
							</motion.aside>
						) : (
							<motion.div
								key="slim"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								className="flex h-full w-14 flex-col items-center gap-1 pt-3"
							>
								<SlimRail onExpand={toggleRail} />
							</motion.div>
						)}
					</AnimatePresence>
				</motion.div>
			) : (
				<aside
					ref={drawerRef}
					className={cn(
						'fixed inset-y-0 left-0 z-50 flex flex-col bg-background',
						atHome
							? 'w-full max-w-none translate-x-0'
							: cn(
									'w-[85%] max-w-80 border-r border-border/60 transition-transform duration-200 ease-out',
									sidebarOpen ? 'translate-x-0' : '-translate-x-full'
								)
					)}
				>
					<WorkspaceList selectedId={match?.params.workspaceId} />
				</aside>
			)}
			<main className="relative z-0 flex min-w-0 flex-1 flex-col">
				<Outlet />
			</main>
		</div>
	)
}

/** The collapsed rail: expand, search, new — the three things a chat screen still wants nearby. */
function SlimRail({ onExpand }: { onExpand: () => void }) {
	const fire = (combo: string) => {
		const [, key] = combo.split('+')
		window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true }))
	}
	return (
		<>
			<RailButton label="Expand sidebar" kbd="B" onClick={onExpand}>
				<PanelLeftOpen size={18} />
			</RailButton>
			<RailButton label="Search" kbd="K" onClick={() => fire('mod+k')}>
				<Search size={18} />
			</RailButton>
			<RailButton label="New workspace" kbd="N" onClick={() => fire('mod+n')}>
				<Plus size={18} />
			</RailButton>
		</>
	)
}

function RailButton({
	label,
	kbd,
	onClick,
	children
}: {
	label: string
	kbd: string
	onClick: () => void
	children: React.ReactNode
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<motion.button
					type="button"
					whileHover={{ scale: 1.06 }}
					whileTap={{ scale: 0.94 }}
					onClick={onClick}
					aria-label={label}
					className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
				>
					{children}
				</motion.button>
			</TooltipTrigger>
			<TooltipContent side="right">
				<span className="flex items-center gap-2">
					{label}
					<KbdGroup>
						<Kbd>{modKey}</Kbd>
						<Kbd>{kbd}</Kbd>
					</KbdGroup>
				</span>
			</TooltipContent>
		</Tooltip>
	)
}

/** Soft colour behind everything — the one flourish, kept far from the text. */
function Ambient() {
	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70rem_45rem_at_-15%_-25%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_60%),radial-gradient(50rem_35rem_at_115%_120%,color-mix(in_oklab,var(--color-idle)_7%,transparent),transparent_60%)]"
		/>
	)
}

/** `/` on a desktop: what is running, and how to get around — instead of a bare "Select a workspace". */
function HomePane() {
	const desktop = useMediaQuery(DESKTOP)
	const { data } = useWorkspaces()
	const workspaces = data?.workspaces ?? []
	const working = workspaces.filter(w => w.session_status === 'working').length
	const unread = workspaces.reduce((n, w) => n + (w.unread_sessions?.length ?? 0), 0)
	const [time, setTime] = useState(() => new Date())
	useEffect(() => {
		const t = setInterval(() => setTime(new Date()), 30_000)
		return () => clearInterval(t)
	}, [])
	if (!desktop) return null
	const hour = time.getHours()
	const greeting = hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
	return (
		<div className="flex h-full items-center justify-center p-10">
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
				className="w-full max-w-xl"
			>
				<div className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
					Conductor Remote
				</div>
				<h1 className="text-balance text-4xl font-semibold tracking-tight">{greeting}.</h1>
				<p className="mt-3 text-pretty text-base text-muted-foreground">
					{working > 0 ? `${working} agent${working === 1 ? ' is' : 's are'} working right now` : 'Nothing is running'}
					{unread > 0 ? `, ${unread} chat${unread === 1 ? '' : 's'} unread` : ''}. Pick a workspace on the left, or
					search everything you have ever asked.
				</p>
				<div className="mt-8 grid grid-cols-3 gap-3">
					<Stat label="Active workspaces" value={workspaces.length} />
					<Stat label="Working now" value={working} tone={working > 0 ? 'working' : undefined} />
					<Stat label="Unread chats" value={unread} tone={unread > 0 ? 'accent' : undefined} />
				</div>
				<div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
					<Hint keys={['K']} label="Search" />
					<Hint keys={['N']} label="New workspace" />
					<Hint keys={['B']} label="Toggle sidebar" />
					<span className="flex items-center gap-2">
						<Command size={13} className="text-faint" /> Enter to send, Shift+Enter for a new line
					</span>
				</div>
			</motion.div>
		</div>
	)
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'working' | 'accent' }) {
	return (
		<motion.div whileHover={{ y: -2 }} className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-xl">
			<div
				className={cn(
					'text-3xl font-semibold tabular-nums tracking-tight',
					tone === 'working' && 'text-working',
					tone === 'accent' && 'text-primary'
				)}
			>
				{value}
			</div>
			<div className="mt-1 text-xs text-muted-foreground">{label}</div>
		</motion.div>
	)
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
	return (
		<span className="flex items-center gap-2">
			<KbdGroup>
				<Kbd>{modKey}</Kbd>
				{keys.map(k => (
					<Kbd key={k}>{k}</Kbd>
				))}
			</KbdGroup>
			{label}
		</span>
	)
}
