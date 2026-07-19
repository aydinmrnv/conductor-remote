import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useWorkspaces } from '../hooks.ts'
import { cn } from '../lib/cn.ts'
import { shortModel, workspaceLabel } from '../lib/format.ts'
import { Composer } from './Composer.tsx'
import { DiffView } from './DiffView.tsx'
import { Header } from './Header.tsx'
import { Transcript } from './Transcript.tsx'
import { Spinner } from './ui.tsx'

type Tab = 'chat' | 'diff'

export function SessionView() {
	const { workspaceId } = useParams<{ workspaceId: string }>()
	const navigate = useNavigate()
	const [tab, setTab] = useState<Tab>('chat')
	const { data, isLoading } = useWorkspaces()

	const ws = data?.workspaces.find(w => w.id === workspaceId)
	const actuator = data?.actuator

	if (!ws) {
		return (
			<div className="flex h-full flex-col overflow-hidden">
				<Header title="Session" onBack={() => navigate('/')} />
				{isLoading ? <Spinner /> : <div className="p-6 text-center text-sm text-muted">Workspace not found.</div>}
			</div>
		)
	}

	const subtitle = [ws.repo_name, ws.branch, shortModel(ws.model)].filter(Boolean).join(' · ')
	const sessionId = ws.active_session_id

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<Header title={workspaceLabel(ws)} subtitle={subtitle} onBack={() => navigate('/')} />
			<nav className="flex gap-1 border-b border-border-soft bg-bg px-3 py-2">
				<TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
					Chat
				</TabButton>
				<TabButton active={tab === 'diff'} onClick={() => setTab('diff')}>
					Diff
				</TabButton>
			</nav>

			{tab === 'chat' ? (
				<>
					<Transcript sessionId={sessionId} />
					<Composer sessionId={sessionId} workspaceId={ws.id} actuator={actuator} />
				</>
			) : (
				<DiffView workspaceId={ws.id} />
			)}
		</div>
	)
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
	return (
		<button type="button" onClick={onClick} className={cn('pill', active && 'pill-active')}>
			{children}
		</button>
	)
}
