import { create } from 'zustand'
import { bootstrapToken } from './lib/api.ts'

interface AppState {
	token: string | null
	/** Whether the last relay call succeeded — drives the header connection dot. */
	online: boolean
	/** Mobile workspace drawer. On md+ the sidebar is static and this is ignored. */
	sidebarOpen: boolean
	setToken: (token: string | null) => void
	setOnline: (online: boolean) => void
	setSidebarOpen: (open: boolean) => void
}

export const useApp = create<AppState>(set => ({
	token: bootstrapToken(),
	online: true,
	// Landing without a workspace in the URL → open the drawer so phones see the list first.
	sidebarOpen: !location.pathname.startsWith('/w/'),
	setToken: token => set({ token }),
	setOnline: online => set({ online }),
	setSidebarOpen: sidebarOpen => set({ sidebarOpen })
}))
