import { useEffect, useState } from 'react'

/** A media query as state — `md` and up is where the layout becomes a desktop shell. */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() =>
		typeof window === 'undefined' ? false : window.matchMedia(query).matches
	)
	useEffect(() => {
		const mq = window.matchMedia(query)
		const onChange = () => setMatches(mq.matches)
		onChange()
		mq.addEventListener('change', onChange)
		return () => mq.removeEventListener('change', onChange)
	}, [query])
	return matches
}

export const DESKTOP = '(min-width: 768px)'
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'
