import { create } from 'zustand'
import { bootstrapToken } from './lib/api.ts'

/** Sidebar view preferences — mirrors the desktop app's Group by / Repo / Sort by popover. */
export type GroupBy = 'status' | 'repo' | 'none'
export type SortBy = 'updated' | 'created' | 'name'
export interface ViewPrefs {
	groupBy: GroupBy
	/** Repo name to filter to, or null for all repos. */
	repo: string | null
	sortBy: SortBy
	/** Collapsed group keys (e.g. 'status:done', 'repo:auk-store'). */
	collapsed: string[]
}

const VIEW_KEY = 'conductor-remote-view'
const defaultView: ViewPrefs = { groupBy: 'status', repo: null, sortBy: 'updated', collapsed: [] }

function loadView(): ViewPrefs {
	try {
		return { ...defaultView, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') }
	} catch {
		return defaultView
	}
}

interface AppState {
	token: string | null
	/** Whether the last relay call succeeded — drives the header connection dot. */
	online: boolean
	/** Mobile workspace drawer. On md+ the sidebar is static and this is ignored. */
	sidebarOpen: boolean
	view: ViewPrefs
	setToken: (token: string | null) => void
	setOnline: (online: boolean) => void
	setSidebarOpen: (open: boolean) => void
	setView: (patch: Partial<ViewPrefs>) => void
	toggleGroup: (key: string) => void
}

export const useApp = create<AppState>((set, get) => {
	const saveView = (view: ViewPrefs) => {
		localStorage.setItem(VIEW_KEY, JSON.stringify(view))
		set({ view })
	}
	return {
		token: bootstrapToken(),
		online: true,
		// Landing without a workspace in the URL → open the drawer so phones see the list first.
		sidebarOpen: !location.pathname.startsWith('/w/'),
		view: loadView(),
		setToken: token => set({ token }),
		setOnline: online => set({ online }),
		setSidebarOpen: sidebarOpen => set({ sidebarOpen }),
		setView: patch => saveView({ ...get().view, ...patch }),
		toggleGroup: key => {
			const { collapsed } = get().view
			saveView({
				...get().view,
				collapsed: collapsed.includes(key) ? collapsed.filter(k => k !== key) : [...collapsed, key]
			})
		}
	}
})
