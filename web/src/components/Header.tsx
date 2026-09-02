import { PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../store.ts'
import { OfflineBanner } from './ui.tsx'

export function Header({
	title,
	subtitle,
	menu,
	right
}: {
	title: ReactNode
	subtitle?: ReactNode
	/** Show the workspace-drawer toggle (phones only — the rail is static on md+). */
	menu?: boolean
	right?: ReactNode
}) {
	const setSidebarOpen = useApp(s => s.setSidebarOpen)
	return (
		<header className="pt-safe sticky top-0 z-10 border-b border-border-soft bg-bg/80 backdrop-blur-xl">
			<div className="flex items-center gap-2 px-3 pb-2.5">
				{menu ? (
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						aria-label="Open workspaces"
						className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2 md:hidden"
					>
						<PanelLeft size={20} />
					</button>
				) : (
					<span className="w-1" />
				)}
				<div className="min-w-0 flex-1">
					{/* A phone's header is narrow and its titles are sentences: two lines beats
					    "Rebuild the Map tip invita…". md+ has the room, so one line there. */}
					<div className="line-clamp-2 text-[15px] font-semibold leading-tight md:line-clamp-none md:truncate">
						{title}
					</div>
					{subtitle ? <div className="truncate text-xs leading-tight text-muted">{subtitle}</div> : null}
				</div>
				{right}
			</div>
			<OfflineBanner />
		</header>
	)
}
