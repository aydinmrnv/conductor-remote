import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { ConnDot } from './ui.tsx'

export function Header({
	title,
	subtitle,
	onBack,
	right
}: {
	title: ReactNode
	subtitle?: ReactNode
	onBack?: () => void
	right?: ReactNode
}) {
	return (
		<header className="pt-safe sticky top-0 z-10 flex items-center gap-2 border-b border-border-soft bg-bg/80 px-3 pb-2.5 backdrop-blur-xl">
			{onBack ? (
				<button
					type="button"
					onClick={onBack}
					aria-label="Back"
					className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2"
				>
					<ChevronLeft size={22} />
				</button>
			) : (
				<span className="w-1" />
			)}
			<div className="min-w-0 flex-1">
				<div className="truncate text-[15px] font-semibold leading-tight">{title}</div>
				{subtitle ? <div className="truncate text-xs leading-tight text-muted">{subtitle}</div> : null}
			</div>
			{right}
			<ConnDot />
		</header>
	)
}
