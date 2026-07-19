import { useNavigate } from 'react-router'
import { useWorkspaces } from '../hooks.ts'
import { relativeTime, shortModel, statusLabel, uiStatus, workspaceLabel } from '../lib/format.ts'
import type { Workspace } from '../lib/types.ts'
import { Header } from './Header.tsx'
import { Badge, Chip, Empty, Spinner, StatusDot } from './ui.tsx'

export function WorkspaceList() {
	const navigate = useNavigate()
	const { data, isLoading, isError, error } = useWorkspaces()
	const workspaces = data?.workspaces ?? []

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<Header title="Workspaces" subtitle={workspaces.length ? `${workspaces.length} active` : undefined} />
			<main className="pb-safe min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
				{isLoading && !data ? (
					<Spinner label="Loading workspaces…" />
				) : isError ? (
					<Empty>
						{(error as Error)?.message}
						<br />
						<br />
						Check the relay is running and the token is correct.
					</Empty>
				) : workspaces.length === 0 ? (
					<Empty>No active workspaces. Start one in Conductor and it’ll appear here.</Empty>
				) : (
					<ul className="flex flex-col gap-2">
						{workspaces.map(w => (
							<li key={w.id} className="fade-in">
								<button type="button" className="card w-full" onClick={() => navigate(`/w/${w.id}`)}>
									<WorkspaceCard w={w} />
								</button>
							</li>
						))}
					</ul>
				)}
			</main>
		</div>
	)
}

function WorkspaceCard({ w }: { w: Workspace }) {
	const status = uiStatus(w)
	const model = shortModel(w.model)
	const ctx = w.context_used_percent
	return (
		<>
			<StatusDot status={status} className="mt-1.5 self-start" />
			<div className="min-w-0 flex-1 overflow-hidden">
				<div className="flex items-center gap-2">
					<span className="min-w-0 flex-1 truncate font-medium">{workspaceLabel(w)}</span>
					{w.pinned_at ? <span className="shrink-0 text-xs text-faint">📌</span> : null}
					{w.unread ? <Badge>{w.unread}</Badge> : null}
					<span className="shrink-0 text-xs capitalize text-muted">{statusLabel(w)}</span>
				</div>
				{/* Row 1: repo + branch (branch flexes to fill and truncates). Row 2: model · ctx · time. */}
				<div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted">
					{w.repo_name ? <span className="shrink-0 font-mono text-faint">{w.repo_name}</span> : null}
					{w.branch ? <Chip className="min-w-0 flex-1 truncate">{w.branch}</Chip> : null}
				</div>
				<div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted">
					{model ? <Chip>{model}</Chip> : null}
					{typeof ctx === 'number' && ctx > 0 ? (
						<span className="shrink-0 text-faint">{Math.round(ctx)}% ctx</span>
					) : null}
					<span className="ml-auto shrink-0 pl-2 text-[11px] text-faint">{relativeTime(w.updated_at)}</span>
				</div>
			</div>
		</>
	)
}
