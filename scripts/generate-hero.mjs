/**
 * Generates the README hero: a pixel-art scene where a signal falls from an F9
 * keycap, through three floating layers, and splashes into a pool. The whole
 * asset is hand-built SVG (no image library) so it stays crisp at any size and
 * can be regenerated with `npm run hero`.
 *
 * Animation notes:
 * - Everything is aligned to a 1-unit pixel grid and rendered with
 *   `shape-rendering="crispEdges"`.
 * - Droplets repeat every 6 units and translate exactly 6 units per loop with
 *   `steps()`, so the loop is seamless and deliberately frame-y.
 * - `prefers-reduced-motion` disables every animation and leaves a readable
 *   still frame.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WIDTH = 300
const HEIGHT = 120
const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'assets')
const OUTPUT_PATH = join(OUTPUT_DIR, 'hero.svg')

const C = {
  skyTop: '#060b14',
  skyMid: '#08111d',
  skyLow: '#0a1621',
  skyBottom: '#0b1925',
  star: '#14313d',
  starBright: '#2a5a66',
  spark: '#2dd4bf',
  rockFar: '#143540',
  rockFarLight: '#1a4652',
  rockFarEdge: '#2c6b76',
  rockFarDeep: '#0c232c',
  rockMid: '#102b35',
  rockMidLight: '#163843',
  rockMidEdge: '#20545f',
  rockMidDeep: '#091c24',
  rockNear: '#0b202a',
  rockNearLight: '#0f2a35',
  rockNearEdge: '#1a4c59',
  rockNearDeep: '#07141c',
  waterDeep: '#0b4f4a',
  water: '#0f766e',
  waterMid: '#14b8a6',
  waterBright: '#2dd4bf',
  waterLight: '#5eead4',
  waterFoam: '#99f6e4',
  keyBody: '#0b4f4a',
  keyTop: '#0f766e',
  keyEdge: '#2dd4bf',
  keyFace: '#071019',
  keyLabel: '#99f6e4',
  record: '#f87171',
  moss: '#1d6b63',
  mossBright: '#2dd4bf',
  label: '#5fb4ad',
  labelMuted: '#357c79'
}

let seed = 0x6d75726d
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}
function between(min, max) {
  return min + Math.floor(random() * (max - min + 1))
}
function chance(probability) {
  return random() < probability
}

const elements = []

/** Builds the markup only. Use this when collecting rects into a group. */
function rectMarkup(x, y, width, height, fill, extra = '') {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"${extra}/>`
}

/** Draws straight into the scene. Skips degenerate rects. */
function rect(x, y, width, height, fill, extra = '') {
  if (width <= 0 || height <= 0) {
    return
  }
  elements.push(rectMarkup(x, y, width, height, fill, extra))
}
function pixel(x, y, fill, extra = '') {
  rect(x, y, 1, 1, fill, extra)
}

// 5x7 pixel font, only the glyphs the scene needs.
const FONT_5X7 = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110']
}

function glyphRects(character, x, y, fill) {
  const glyph = FONT_5X7[character]
  if (glyph === undefined) {
    return []
  }
  const result = []
  glyph.forEach((row, rowIndex) => {
    ;[...row].forEach((cell, columnIndex) => {
      if (cell === '1') {
        result.push(
          `<rect x="${x + columnIndex}" y="${y + rowIndex}" width="1" height="1" fill="${fill}"/>`
        )
      }
    })
  })
  return result
}

function textWidth(text) {
  return text.length === 0 ? 0 : text.length * 6 - 1
}

function pixelText(text, x, y, fill) {
  let cursor = x
  for (const character of text) {
    elements.push(...glyphRects(character, cursor, y, fill))
    cursor += 6
  }
}

// ---------------------------------------------------------------- background

rect(0, 0, WIDTH, 26, C.skyTop)
rect(0, 26, WIDTH, 24, C.skyMid)
rect(0, 50, WIDTH, 26, C.skyLow)
rect(0, 76, WIDTH, HEIGHT - 76, C.skyBottom)

// Dither the band boundaries one pixel at a time instead of a hard stripe.
for (let x = 0; x < WIDTH; x += 1) {
  if (chance(0.5)) {
    pixel(x, 26, C.skyMid)
    pixel(x, 50, C.skyLow)
    pixel(x, 76, C.skyBottom)
  }
}

// Sparse stars. Keep the keycap, stream, and label columns quiet.
const occupied = (x, y) =>
  (x > 174 && x < 238 && y > 2 && y < 100) || (x > 10 && x < 124 && y > 28 && y < 38)
for (let index = 0; index < 60; index += 1) {
  const x = between(3, WIDTH - 5)
  const y = between(3, 88)
  if (occupied(x, y)) {
    continue
  }
  const bright = chance(0.12)
  rect(x, y, bright && chance(0.35) ? 2 : 1, 1, bright ? C.starBright : C.star)
}

for (const twinkle of [
  { x: 38, y: 13, delay: '0s' },
  { x: 96, y: 33, delay: '-0.9s' },
  { x: 150, y: 9, delay: '-1.7s' },
  { x: 254, y: 20, delay: '-0.4s' },
  { x: 278, y: 56, delay: '-1.2s' },
  { x: 166, y: 61, delay: '-2.3s' }
]) {
  pixel(twinkle.x, twinkle.y, C.spark, ` class="twinkle" style="animation-delay:${twinkle.delay}"`)
}

// A few tiny floating rocks far away, for depth.
for (const [x, y, width] of [
  [64, 52, 7],
  [118, 22, 4],
  [258, 38, 5]
]) {
  rect(x, y, width, 1, C.rockFar)
  rect(x + 1, y + 1, width - 2, 1, C.rockFarDeep)
  pixel(x + 2, y - 1, C.rockFarEdge)
}

// ---------------------------------------------------------------- keycap (F9)

const keycap = []
keycap.push(rectMarkup(187, 20, 34, 6, C.keyBody))
keycap.push(rectMarkup(188, 19, 32, 1, C.water))
keycap.push(rectMarkup(190, 8, 28, 12, C.keyTop))
keycap.push(rectMarkup(190, 8, 28, 1, C.keyEdge))
keycap.push(rectMarkup(195, 10, 20, 8, C.keyFace))
keycap.push(...glyphRects('F', 200, 10, C.keyLabel))
keycap.push(...glyphRects('9', 207, 10, C.keyLabel))
keycap.push(rectMarkup(217, 9, 1, 1, C.record, ' class="record"'))
keycap.push(rectMarkup(190, 18, 28, 1, C.waterDeep))
keycap.push(rectMarkup(188, 26, 32, 1, C.rockFarDeep))
elements.push(`<g class="keycap">${keycap.join('')}</g>`)

// Signal arcs either side of the keycap.
const arcs = []
for (const [x, y] of [
  [181, 11],
  [178, 12],
  [181, 16],
  [227, 11],
  [230, 12],
  [227, 16]
]) {
  arcs.push(`<rect x="${x}" y="${y}" width="2" height="1" fill="${C.waterMid}"/>`)
}
elements.push(`<g class="signal">${arcs.join('')}</g>`)

// ---------------------------------------------------------------- layers

/**
 * Draws a floating rock shelf with a stepped, tapering underside, a bright top
 * lip, strata, speckles, hanging rock, and a hole for the waterfall.
 */
function island({
  x0,
  x1,
  top,
  thickness,
  insets,
  gapStart,
  gapEnd,
  body,
  light,
  edge,
  deep,
  crystals
}) {
  for (let row = 0; row < thickness; row += 1) {
    const inset = insets[Math.min(row, insets.length - 1)]
    const start = x0 + inset
    const end = x1 - inset
    if (end <= start) {
      continue
    }
    const fill = row === 0 ? edge : row === 1 ? light : row >= thickness - 2 ? deep : body

    for (const [segmentStart, segmentEnd] of [
      [start, Math.min(gapStart, end)],
      [Math.max(gapEnd, start), end]
    ]) {
      if (segmentEnd > segmentStart) {
        rect(segmentStart, top + row, segmentEnd - segmentStart, 1, fill)
      }
    }

    // Rough pixel edge on top of the shelf.
    if (row === 0) {
      for (let x = start; x < end; x += 1) {
        if (chance(0.1)) {
          pixel(x, top - 1, edge)
        }
      }
    }
  }

  // Darker strata and mineral speckles.
  for (let index = 0; index < Math.round((x1 - x0) / 4); index += 1) {
    const row = between(2, thickness - 3)
    const inset = insets[Math.min(row, insets.length - 1)]
    const start = x0 + inset
    const end = x1 - inset
    const x = between(start + 1, end - 2)
    if (x >= gapStart - 1 && x <= gapEnd) {
      continue
    }
    rect(x, top + row, between(1, 3), 1, deep)
  }

  for (let row = 3; row < thickness - 2; row += 3) {
    const inset = insets[Math.min(row, insets.length - 1)]
    const start = x0 + inset + 2
    const end = x1 - inset - 2
    let x = start
    while (x < end) {
      const length = between(2, 6)
      rect(x, top + row, Math.min(length, end - x), 1, deep, ' opacity="0.7"')
      x += length + between(5, 11)
    }
  }

  // Hanging rock and roots below the final row.
  const bottomInset = insets[Math.min(thickness - 1, insets.length - 1)]
  for (let x = x0 + bottomInset; x < x1 - bottomInset; x += 1) {
    if (chance(0.1)) {
      rect(x, top + thickness, 1, between(1, 3), deep)
    }
    if (chance(0.035)) {
      rect(x, top + thickness + 1, 1, between(3, 6), C.moss)
    }
  }

  // Wet edges around the hole.
  for (let row = 0; row < thickness; row += 1) {
    const inset = insets[Math.min(row, insets.length - 1)]
    if (gapStart - 1 >= x0 + inset) {
      rect(gapStart - 1, top + row, 1, 1, edge)
    }
    if (gapEnd < x1 - inset) {
      rect(gapEnd, top + row, 1, 1, edge)
    }
  }
  rect(gapStart, top, 1, 1, C.waterBright)
  rect(gapEnd - 1, top, 1, 1, C.waterBright)
  pixel(gapStart, top + thickness - 1, C.water)
  pixel(gapEnd - 1, top + thickness - 1, C.water)

  for (const [x, height] of crystals) {
    rect(x, top - height, 1, height, C.waterDeep)
    rect(x + 1, top - height + 1, 1, height - 1, C.water)
    pixel(x, top - height, C.waterFoam)
    pixel(x + 1, top - 1, C.waterLight)
    pixel(x - 1, top - 1, C.moss)
    pixel(x + 2, top - 1, C.moss)
  }

  // A couple of glowing veins inside the rock.
  for (let index = 0; index < 4; index += 1) {
    const row = between(4, thickness - 4)
    const inset = insets[Math.min(row, insets.length - 1)]
    const x = between(x0 + inset + 2, x1 - inset - 3)
    if (x >= gapStart - 1 && x <= gapEnd) {
      continue
    }
    rect(x, top + row, 1, 1, C.water, ' opacity="0.55"')
  }
}

island({
  x0: 14,
  x1: 286,
  top: 42,
  thickness: 14,
  insets: [0, 0, 0, 2, 4, 6, 10, 14, 18, 24, 30, 38, 46, 54],
  gapStart: 202,
  gapEnd: 210,
  body: C.rockFar,
  light: C.rockFarLight,
  edge: C.rockFarEdge,
  deep: C.rockFarDeep,
  crystals: [
    [44, 5],
    [108, 4],
    [148, 5],
    [266, 4]
  ]
})

island({
  x0: 28,
  x1: 272,
  top: 66,
  thickness: 14,
  insets: [0, 0, 0, 2, 4, 8, 12, 16, 22, 28, 34, 40, 46, 52],
  gapStart: 203,
  gapEnd: 211,
  body: C.rockMid,
  light: C.rockMidLight,
  edge: C.rockMidEdge,
  deep: C.rockMidDeep,
  crystals: [
    [62, 4],
    [124, 5],
    [168, 4],
    [242, 4]
  ]
})

// Layer 3 - the ground. It has no hole: the waterfall collects in a pool.
rect(0, 91, WIDTH, HEIGHT - 91, C.rockNear)
rect(0, 91, WIDTH, 1, C.rockNearLight)
for (let x = 0; x < WIDTH; x += 1) {
  rect(x, 90, 1, 1, C.rockNearEdge)
  if (chance(0.1)) {
    rect(x, 89, 1, 1, C.rockNearEdge)
  }
  rect(x, 92, 1, 1, chance(0.25) ? C.rockNearDeep : C.rockNear)
}
for (let y = 95; y < HEIGHT; y += 4) {
  let x = 2
  while (x < WIDTH - 2) {
    const length = between(3, 9)
    rect(x, y, length, 1, C.rockNearDeep)
    x += length + between(7, 15)
  }
}
for (let index = 0; index < 100; index += 1) {
  rect(between(1, WIDTH - 2), between(93, HEIGHT - 2), 1, 1, C.rockNearDeep)
}

// Moss and tiny pixel flowers along the ground lip, away from the pool.
for (let index = 0; index < 18; index += 1) {
  const x = between(3, WIDTH - 4)
  if (x > 186 && x < 230) {
    continue
  }
  const height = between(1, 2)
  rect(x, 90 - height, 1, height, C.moss)
  if (chance(0.3)) {
    pixel(x, 90 - height, C.mossBright)
  }
}
for (const x of [34, 78, 142, 170, 252, 278]) {
  rect(x, 87, 1, 3, C.moss)
  pixel(x, 86, C.mossBright)
  pixel(x - 1, 88, C.moss)
  pixel(x + 1, 88, C.moss)
}

// Ground crystals catch the same teal light as the waterfall.
for (const [x, height] of [
  [84, 4],
  [166, 5],
  [248, 3]
]) {
  rect(x, 90 - height, 1, height, C.waterDeep)
  rect(x + 1, 90 - height + 1, 1, height - 1, C.water)
  pixel(x, 90 - height, C.waterLight)
  pixel(x - 1, 90 - 1, C.moss)
  pixel(x + 2, 90 - 1, C.moss)
}

// Small rocks on the ground.
for (const [x, width, height] of [
  [56, 5, 3],
  [154, 4, 4],
  [238, 7, 2],
  [280, 4, 2]
]) {
  rect(x, 90 - height, width, height, C.rockNearLight)
  rect(x, 90 - height, width, 1, C.rockNearEdge)
  pixel(x + 1, 90 - height + 1, C.rockNearDeep)
}

// ---------------------------------------------------------------- layer labels

for (const label of [
  { number: '1', text: 'CAPTURE', top: 42 },
  { number: '2', text: 'TRANSCRIBE', top: 66 },
  { number: '3', text: 'INSERT', top: 90 }
]) {
  const labelY = label.top - 9
  rect(18, labelY + 2, 2, 2, C.waterBright)
  pixel(18, labelY + 2, C.waterLight)
  pixelText(label.number, 24, labelY, C.labelMuted)
  pixelText(label.text, 36, labelY, C.label)
  rect(36, labelY + 8, textWidth(label.text), 1, C.labelMuted, ' opacity="0.55"')
}

// ---------------------------------------------------------------- waterfall

/**
 * One falling segment: a dark water column plus a repeating two-column droplet
 * pattern. The pattern repeats every 6 units and the group moves 6 units, so
 * the loop has no visible seam.
 */
function waterfall(x, y0, y1, duration) {
  const height = y1 - y0
  const clipId = `flow-${x}-${y0}`
  const blocks = []

  rect(x, y0, 7, height, C.water, ' opacity="0.06"')
  rect(x + 1, y0, 3, height, C.water, ' opacity="0.55"')
  rect(x + 2, y0, 1, height, C.waterMid, ' opacity="0.35"')

  for (let y = y0 - 6; y < y1 + 6; y += 6) {
    blocks.push(rectMarkup(x, y, 2, 4, C.waterBright))
    blocks.push(rectMarkup(x + 3, y + 3, 2, 4, C.waterMid))
    blocks.push(rectMarkup(x, y, 1, 1, C.waterFoam))
    blocks.push(rectMarkup(x + 3, y + 3, 1, 1, C.waterLight))
    blocks.push(rectMarkup(x + 1, y + 2, 1, 1, C.waterLight, ' opacity="0.7"'))
  }

  elements.push(
    `<clipPath id="${clipId}"><rect x="${x}" y="${y0}" width="5" height="${height}"/></clipPath>`
  )
  elements.push(
    `<g clip-path="url(#${clipId})"><g class="fall" style="animation-duration:${duration}">${blocks.join('')}</g></g>`
  )
}

waterfall(203, 26, 42, '0.62s')
waterfall(204, 56, 66, '0.54s')
waterfall(204, 80, 90, '0.48s')

// Water visible inside each hole, so the stream clearly passes through the
// shelf instead of vanishing behind it.
rect(203, 42, 5, 14, C.waterDeep, ' opacity="0.95"')
rect(204, 43, 3, 1, C.waterBright, ' opacity="0.8"')
rect(204, 46, 2, 2, C.waterBright, ' class="hole-drop"')
rect(204, 66, 5, 14, C.waterDeep, ' opacity="0.95"')
rect(205, 67, 3, 1, C.waterMid, ' opacity="0.8"')
rect(205, 70, 2, 2, C.waterMid, ' class="hole-drop alt"')
pixel(202, 51, C.waterLight)
pixel(210, 49, C.waterLight)
pixel(203, 76, C.waterLight)
pixel(211, 74, C.waterLight)

// ---------------------------------------------------------------- pool

// A dark basin, then pixel water with a bright surface.
rect(186, 87, 42, 13, C.rockNearDeep)
rect(187, 89, 2, 9, C.rockNearLight)
rect(189, 88, 1, 2, C.rockNearEdge)
rect(227, 89, 2, 9, C.rockNearLight)
rect(228, 88, 1, 2, C.rockNearEdge)
rect(190, 89, 34, 9, C.waterDeep)
rect(192, 90, 30, 7, C.water)
rect(193, 90, 28, 1, C.waterBright)
rect(196, 92, 22, 1, C.waterMid, ' opacity="0.8"')
rect(200, 94, 14, 1, C.waterDeep, ' opacity="0.85"')
rect(198, 90, 12, 1, C.waterFoam, ' class="pool-flash"')
rect(187, 98, 40, 1, C.rockNearDeep)
pixel(186, 90, C.rockNearEdge)
pixel(229, 90, C.rockNearEdge)
pixel(188, 97, C.rockNearEdge)
pixel(227, 97, C.rockNearEdge)
pixel(193, 96, C.waterLight)
pixel(225, 96, C.waterLight)
pixel(197, 91, C.waterLight)

// A thin rivulet leaves the pool and runs along the ground.
rect(228, 90, 22, 1, C.waterDeep)
rect(232, 90, 3, 1, C.waterMid, ' class="rivulet"')
rect(240, 90, 2, 1, C.waterMid, ' class="rivulet alt"')

// Animated ripples: three bars that widen and fade in discrete frames.
for (const ripple of [
  { x: 194, y: 90, width: 28, delay: '0s', duration: '2.4s' },
  { x: 197, y: 92, width: 22, delay: '-0.8s', duration: '2.4s' },
  { x: 201, y: 94, width: 14, delay: '-1.6s', duration: '2.4s' }
]) {
  rect(
    ripple.x,
    ripple.y,
    ripple.width,
    1,
    C.waterLight,
    ` class="ripple" style="animation-delay:${ripple.delay};animation-duration:${ripple.duration}"`
  )
}

// Splash droplets: four fixed frames each, thrown left and right.
for (const splash of [
  { x: 202, y: 90, delay: '0s', dx: -2, dy: -4, color: C.waterFoam },
  { x: 211, y: 90, delay: '-0.3s', dx: 2, dy: -5, color: C.waterLight },
  { x: 200, y: 90, delay: '-0.7s', dx: -4, dy: -3, color: C.waterBright },
  { x: 214, y: 90, delay: '-1s', dx: 4, dy: -3, color: C.waterFoam },
  { x: 207, y: 90, delay: '-0.5s', dx: 0, dy: -6, color: C.waterMid }
]) {
  elements.push(
    `<rect x="${splash.x}" y="${splash.y}" width="1" height="1" fill="${splash.color}" class="splash" style="--dx:${splash.dx}px;--dy:${splash.dy}px;animation-delay:${splash.delay}"/>`
  )
}

// ---------------------------------------------------------------- ambience

for (const mote of [
  { x: 60, y: 59, delay: '0s' },
  { x: 132, y: 78, delay: '-1.8s' },
  { x: 246, y: 58, delay: '-3.4s' },
  { x: 278, y: 78, delay: '-2.2s' },
  { x: 30, y: 80, delay: '-4.1s' }
]) {
  pixel(mote.x, mote.y, C.waterLight, ` class="mote" style="animation-delay:${mote.delay}"`)
}

// ---------------------------------------------------------------- document

const scene = elements.join('\n  ')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="480" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="hero-title hero-desc" shape-rendering="crispEdges">
  <title id="hero-title">Murmur — pixel-art waterfall flowing through three layers</title>
  <desc id="hero-desc">A pixel-art F9 keycap emits a stream of teal liquid that falls through three floating rock layers labelled Capture, Transcribe, and Insert, then splashes into a pool.</desc>
  <style>
    .keycap { animation: press 3.2s steps(1, end) infinite; }
    .record { animation: blink 1.2s steps(2, end) infinite; }
    .signal { animation: signal 2.4s steps(2, end) infinite; }
    .fall { animation: fall 0.56s steps(3, end) infinite; }
    .hole-drop { animation: hole-drop 1.3s steps(2, end) infinite; }
    .hole-drop.alt { animation-delay: -0.6s; }
    .splash { animation: splash 1.4s steps(1, end) infinite; }
    .ripple { animation: ripple 2.4s steps(4, end) infinite; transform-origin: 208px 91px; }
    .rivulet { animation: rivulet 2s steps(2, end) infinite; }
    .rivulet.alt { animation-delay: -0.7s; }
    .twinkle { animation: twinkle 3.4s steps(2, end) infinite; }
    .pool-flash { animation: pool-flash 1.6s steps(2, end) infinite; }
    .mote { animation: mote 7s steps(7, end) infinite; }
    @keyframes press {
      0%, 60% { transform: translateY(0); }
      62%, 76% { transform: translateY(1px); }
      78%, 100% { transform: translateY(0); }
    }
    @keyframes blink {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0.2; }
    }
    @keyframes signal {
      0%, 45% { opacity: 0.25; }
      50%, 100% { opacity: 0.8; }
    }
    @keyframes fall {
      from { transform: translateY(0); }
      to { transform: translateY(6px); }
    }
    @keyframes hole-drop {
      0% { transform: translateY(0); opacity: 0.35; }
      50% { transform: translateY(2px); opacity: 1; }
      100% { transform: translateY(4px); opacity: 0.2; }
    }
    @keyframes splash {
      0% { transform: translate(0, 0); opacity: 0; }
      15% { transform: translate(0, 0); opacity: 1; }
      45% { transform: translate(calc(var(--dx) * 0.6), var(--dy)); opacity: 1; }
      75% { transform: translate(var(--dx), 2px); opacity: 0.5; }
      100% { transform: translate(var(--dx), 3px); opacity: 0; }
    }
    @keyframes ripple {
      0% { transform: scaleX(0.65); opacity: 0.15; }
      35% { transform: scaleX(1); opacity: 0.65; }
      100% { transform: scaleX(1.18); opacity: 0; }
    }
    @keyframes rivulet {
      0%, 45% { opacity: 0.2; }
      50%, 100% { opacity: 0.9; }
    }
    @keyframes twinkle {
      0%, 45% { opacity: 0.9; }
      50%, 100% { opacity: 0.15; }
    }
    @keyframes pool-flash {
      0%, 45% { opacity: 0.45; }
      50%, 100% { opacity: 1; }
    }
    @keyframes mote {
      0% { transform: translateY(0); opacity: 0; }
      20% { opacity: 0.55; }
      80% { opacity: 0.25; }
      100% { transform: translateY(-7px); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .keycap, .record, .signal, .fall, .hole-drop, .splash, .ripple, .rivulet, .twinkle, .pool-flash, .mote {
        animation: none !important;
      }
    }
  </style>
  ${scene}
</svg>
`

mkdirSync(OUTPUT_DIR, { recursive: true })
writeFileSync(OUTPUT_PATH, svg, 'utf8')
console.log(`[murmur] wrote ${OUTPUT_PATH} (${svg.length} bytes)`)
