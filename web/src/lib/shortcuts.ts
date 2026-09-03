import { useEffect } from 'react'

/**
 * App-wide keyboard shortcuts for the desktop: one listener, one place. Handlers get
 * the modifier already checked (⌘ on a Mac, Ctrl elsewhere) and never fire while a
 * text field owns the keyboard, except the ones that make sense there (Escape).
 */
export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>

function typing(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null
	if (!el) return false
	const tag = el.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

/** Keys as `mod+k`, `mod+shift+n`, `escape`, `?`. */
export function useShortcuts(map: ShortcutMap, enabled = true): void {
	useEffect(() => {
		if (!enabled) return
		const onKey = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey
			const parts = [mod ? 'mod' : '', e.shiftKey ? 'shift' : '', e.altKey ? 'alt' : '', e.key.toLowerCase()].filter(
				Boolean
			)
			const combo = parts.join('+')
			const handler = map[combo]
			if (!handler) return
			// Plain keys stay out of text fields; chords with a modifier are fine anywhere.
			if (!mod && combo !== 'escape' && typing(e.target)) return
			handler(e)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [map, enabled])
}
