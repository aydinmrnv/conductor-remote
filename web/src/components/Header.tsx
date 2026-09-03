import { PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../store.ts'
import { OfflineBanner } from './ui.tsx'

export function Header({
	title,
	subtitle,
	menu,
	leading,
	right
}: {
	title: ReactNode
	subtitle?: ReactNode
	/** Show the workspace-drawer toggle (phones only — the rail is static on md+). */
	menu?: boolean
	/** Before the title: the desktop rail's collapse control. */
	leading?: ReactNode
	right?: ReactNode
}) {
	const setSidebarOpen = useApp(s => s.setSidebarOpen)
	return (
		<header className="pt-safe sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-xl">
			<div className="flex items-center gap-2 px-3 pb-2.5 md:px-4 md:pt-3 md:pb-3">
				{menu ? (
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						aria-label="Open workspaces"
						className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-surface-2 md:hidden"
					>
						<PanelLeft size={20} />
					</button>
				) : leading ? (
					leading
				) : (
					<span className="w-1" />
				)}
				<div className="min-w-0 flex-1">
					{/* A phone's header is narrow and its titles are sentences: two lines beats
					    "Rebuild the Map tip invita…". md+ has the room, so one line there. */}
					<div className="line-clamp-2 text-[15px] font-semibold leading-tight tracking-tight md:line-clamp-none md:truncate md:text-base">
						{title}
					</div>
					{subtitle ? <div className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</div> : null}
				</div>
				{right}
			</div>
			<OfflineBanner />
		</header>
	)
}
