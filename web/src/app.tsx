import { Navigate, Route, Routes } from 'react-router'
import { SessionView } from './components/SessionView.tsx'
import { TokenGate } from './components/TokenGate.tsx'
import { WorkspaceList } from './components/WorkspaceList.tsx'
import { useApp } from './store.ts'

export function App() {
	const token = useApp(s => s.token)
	if (!token) return <TokenGate />
	return (
		<Routes>
			<Route path="/" element={<WorkspaceList />} />
			<Route path="/w/:workspaceId" element={<SessionView />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	)
}
