import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		coverage: {
			exclude: ['dist/**', 'dist-node/**', 'scripts/**', 'tests/**'],
			include: ['src/**/*.ts', 'web/src/**/*.{ts,tsx}'],
			provider: 'v8',
			reporter: ['text', 'html']
		},
		testTimeout: 20_000
	}
})
