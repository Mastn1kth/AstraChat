// Generates the store icon and splash sources (assets/icon.png, assets/splash.png)
// from an inline SVG of the Onda wave mark, then they are consumed by
// `npx capacitor-assets generate`.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

mkdirSync('assets', { recursive: true })

function waveSvg(size, { background = true } = {}) {
  const s = size / 1024
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${background ? `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#bf6050"/>
      <stop offset="1" stop-color="#8B4035"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>` : ''}
  <g stroke="#FAF6F1" stroke-width="56" stroke-linecap="round" fill="none">
    <path d="M232 392 q70 -56 140 0 t140 0 140 0 140 0"/>
    <path d="M232 512 q70 -56 140 0 t140 0 140 0 140 0" opacity="0.85"/>
    <path d="M232 632 q70 -56 140 0 t140 0 140 0 140 0" opacity="0.65"/>
  </g>
</svg>`)
}

await sharp(waveSvg(1024)).png().toFile('assets/icon.png')
console.log('assets/icon.png (1024x1024)')

// Splash: warm background with the mark centered.
const splashSize = 2732
const logo = await sharp(waveSvg(640)).png().toBuffer()
await sharp({
  create: { width: splashSize, height: splashSize, channels: 4, background: '#F0E9E1' },
})
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toFile('assets/splash.png')
console.log('assets/splash.png (2732x2732)')

await sharp({
  create: { width: splashSize, height: splashSize, channels: 4, background: '#241511' },
})
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toFile('assets/splash-dark.png')
console.log('assets/splash-dark.png (2732x2732)')
