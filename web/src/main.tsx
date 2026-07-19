import { registerSW } from 'virtual:pwa-register'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './app.tsx'
import './index.css'

registerSW({ immediate: true })

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
