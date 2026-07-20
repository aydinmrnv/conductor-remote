import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './app.tsx'
import './index.css'

// The service worker is registered by ReloadPrompt via `useRegisterSW` (it needs the
// registration handle for its update poll), so there's no manual registerSW() here.

// Ask the browser to keep our storage (the access token) from being evicted — best-effort, no-op where unsupported.
if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {})

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { staleTime: 1000, retry: 1, refetchOnWindowFocus: true }
	}
})

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</QueryClientProvider>
	</StrictMode>
)
