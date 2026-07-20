import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

// Rasterize public/icon.svg into the PNG sizes the PWA manifest + iOS need.
const pub = path.join(import.meta.dirname, '..', 'public')
const svg = await readFile(path.join(pub, 'icon.svg'))

const targets: { name: string; size: number; background?: string }[] = [
	{ name: 'icon-192.png', size: 192 },
	{ name: 'icon-512.png', size: 512 },
	{ name: 'icon-maskable-512.png', size: 512 },
	{ name: 'apple-touch-icon.png', size: 180, background: '#0a0b0e' }
]

for (const t of targets) {
	let pipe = sharp(svg, { density: 384 }).resize(t.size, t.size, { fit: 'contain' })
	if (t.background) pipe = pipe.flatten({ background: t.background })
	const out = await pipe.png().toBuffer()
	await writeFile(path.join(pub, t.name), out)
	console.info(`wrote ${t.name} (${t.size}px)`)
}
