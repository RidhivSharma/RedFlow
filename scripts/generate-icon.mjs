/**
 * Generates Murmur's placeholder icon: a teal rounded square with a white
 * audio waveform. No image library is used; the PNG entries and the ICO
 * container are encoded by hand so the asset stays reproducible.
 *
 * Run with `npm run icon`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const ICON_SIZES = [16, 20, 24, 32, 48, 64, 128, 256]
const SUPERSAMPLE = 4
const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icons')
const ICO_PATH = join(OUTPUT_DIR, 'murmur.ico')
const PNG_PATH = join(OUTPUT_DIR, 'murmur.png')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let value = n
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[n] = value >>> 0
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(data.length, 0)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
}

function encodePng(rgba, size) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function insideRoundedRect(u, v, left, top, right, bottom, radius) {
  const nearestX = Math.min(Math.max(u, left + radius), right - radius)
  const nearestY = Math.min(Math.max(v, top + radius), bottom - radius)
  const dx = u - nearestX
  const dy = v - nearestY
  return dx * dx + dy * dy <= radius * radius
}

function insideCapsule(u, v, centerX, top, bottom, radius) {
  const nearestY = Math.min(Math.max(v, top), bottom)
  const dx = u - centerX
  const dy = v - nearestY
  return dx * dx + dy * dy <= radius * radius
}

function mix(start, end, amount) {
  return Math.round(start + (end - start) * amount)
}

function renderIcon(size) {
  const highSize = size * SUPERSAMPLE
  const highPixels = Buffer.alloc(highSize * highSize * 4)

  const barHeights = [0.24, 0.44, 0.64, 0.44, 0.24]
  const barWidth = 0.078
  const barGap = 0.055
  const totalBarWidth = barHeights.length * barWidth + (barHeights.length - 1) * barGap
  const firstBarX = 0.5 - totalBarWidth / 2 + barWidth / 2
  const bars = barHeights.map((height, index) => ({
    centerX: firstBarX + index * (barWidth + barGap),
    halfHeight: height / 2
  }))

  for (let y = 0; y < highSize; y += 1) {
    for (let x = 0; x < highSize; x += 1) {
      const u = (x + 0.5) / highSize
      const v = (y + 0.5) / highSize
      if (!insideRoundedRect(u, v, 0.04, 0.04, 0.96, 0.96, 0.23)) {
        continue
      }

      const gradient = Math.min(Math.max((v - 0.04) / 0.92, 0), 1)
      let red = mix(20, 15, gradient)
      let green = mix(184, 118, gradient)
      let blue = mix(166, 110, gradient)

      for (const bar of bars) {
        if (
          insideCapsule(u, v, bar.centerX, 0.5 - bar.halfHeight, 0.5 + bar.halfHeight, barWidth / 2)
        ) {
          red = 248
          green = 250
          blue = 252
          break
        }
      }

      const offset = (y * highSize + x) * 4
      highPixels[offset] = red
      highPixels[offset + 1] = green
      highPixels[offset + 2] = blue
      highPixels[offset + 3] = 255
    }
  }

  const pixels = Buffer.alloc(size * size * 4)
  const samplesPerPixel = SUPERSAMPLE * SUPERSAMPLE

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0

      for (let sampleY = 0; sampleY < SUPERSAMPLE; sampleY += 1) {
        for (let sampleX = 0; sampleX < SUPERSAMPLE; sampleX += 1) {
          const sourceX = x * SUPERSAMPLE + sampleX
          const sourceY = y * SUPERSAMPLE + sampleY
          const offset = (sourceY * highSize + sourceX) * 4
          const sampleAlpha = highPixels[offset + 3]
          red += highPixels[offset] * sampleAlpha
          green += highPixels[offset + 1] * sampleAlpha
          blue += highPixels[offset + 2] * sampleAlpha
          alpha += sampleAlpha
        }
      }

      const targetOffset = (y * size + x) * 4
      const averageAlpha = alpha / samplesPerPixel
      if (alpha > 0) {
        pixels[targetOffset] = Math.round(red / alpha)
        pixels[targetOffset + 1] = Math.round(green / alpha)
        pixels[targetOffset + 2] = Math.round(blue / alpha)
      }
      pixels[targetOffset + 3] = Math.round(averageAlpha)
    }
  }

  return pixels
}

function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let offset = header.length
  images.forEach((image, index) => {
    const entry = 6 + index * 16
    header[entry] = image.size === 256 ? 0 : image.size
    header[entry + 1] = image.size === 256 ? 0 : image.size
    header[entry + 2] = 0
    header[entry + 3] = 0
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(image.png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += image.png.length
  })

  return Buffer.concat([header, ...images.map((image) => image.png)])
}

mkdirSync(OUTPUT_DIR, { recursive: true })

const images = ICON_SIZES.map((size) => ({
  size,
  png: encodePng(renderIcon(size), size)
}))

writeFileSync(ICO_PATH, encodeIco(images))
writeFileSync(PNG_PATH, images[images.length - 1].png)

console.log(`[murmur] wrote ${ICO_PATH} (${ICON_SIZES.join(', ')} px)`)
console.log(`[murmur] wrote ${PNG_PATH}`)
