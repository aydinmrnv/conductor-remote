import { create } from 'zustand'
import { bootstrapToken } from './lib/api.ts'

interface AppState {
	token: string | null
	/** Whether the last relay call succeeded — drives the header connection dot. */
	online: boolean
	setToken: (token: string | null) => void
	setOnline: (online: boolean) => void
}

export const useApp = create<AppState>(set => ({
	token: bootstrapToken(),
	online: true,
	setToken: token => set({ token }),
	setOnline: online => set({ online })
}))
