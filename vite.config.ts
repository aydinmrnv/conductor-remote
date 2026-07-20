import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The relay (src/server.ts) serves the built `dist/` in production and does its
// own SPA fallback. In dev, Vite serves `web/` with HMR and proxies /api to the
// relay so the phone can hit one origin.
//
// Ports are injected by `scripts/dev.ts` (WEB_PORT / RELAY_PORT) so Conductor
// workspaces can run concurrently on per-workspace ports; both default to the
// classic 5173 / 8787 pair. This `server` block is dev-only — `vite build`
// ignores it, so the prod bundle is unaffected.
const webPort = Number(process.env.WEB_PORT) || 5173
const relayPort = Number(process.env.RELAY_PORT) || 8787

export default defineConfig({
	root: 'web',
	publicDir: 'public',
	build: {
		outDir: '../dist',
		emptyOutDir: true
	},
	server: {
		host: true,
		port: webPort,
		strictPort: true,
		proxy: {
			'/api': { target: `http://127.0.0.1:${relayPort}`, changeOrigin: true }
		}
	},
	plugins: [
		react(),
		tailwindcss(),
		VitePWA({
			registerType: 'autoUpdate',
			includeAssets: ['icon.svg', 'apple-touch-icon.png'],
			manifest: {
				name: 'Conductor Remote',
				short_name: 'Conductor',
				description: 'Monitor and drive your local Conductor agents from your phone.',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				orientation: 'portrait',
				background_color: '#0a0b0e',
				theme_color: '#0a0b0e',
				icons: [
					{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
					{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
				]
			},
			workbox: {
				navigateFallback: '/index.html',
				// Never cache the token-gated API — it must always hit the live relay.
				navigateFallbackDenylist: [/^\/api\//],
				runtimeCaching: []
			}
		})
	]
})
