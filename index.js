// dsh-glass-sidebar — Host half.
//
// Owns the durable preferences, the pre-paint state row, and the wallpaper the
// frosted sidebar blurs. Three volatile fields make the values readable and
// writable through `ctx.configForms` on the Client, which persists them into
// this row's `config:` block through the profile's settings editor — the same
// seam `ui-theme` uses for the theme and font sizes. Volatile fields update in
// place, so changing a slider never restarts the plugin.
//
// Why a Host row at all: the Desktop app launches the Web server with `--port 0`,
// so the page origin changes between launches and `localStorage` cannot carry a
// preference across restarts. The same half is the only place that can read the
// Windows wallpaper, so it republishes it as a package asset for the browser.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

/** Loader entry id; also the settings namespace the Client reads and writes. */
export const ENTRY_ID = 'glass-sidebar'

/** Document attribute that gates every stylesheet rule. */
export const GLASS_ATTRIBUTE = 'data-glass-sidebar'

/** Accepted blur range in CSS pixels. */
export const BLUR_RANGE = Object.freeze({ min: 0, max: 40, default: 18 })

/** Accepted tint opacity range in percent. */
export const OPACITY_RANGE = Object.freeze({ min: 20, max: 100, default: 62 })

/** Plugin package root; the wallpaper is published relative to it. */
export const PACKAGE_DIR = fileURLToPath(new URL('.', import.meta.url))

/** Package name used by the client asset route. */
export const PACKAGE_NAME = 'dsh-glass-sidebar'

/** Folder the wallpaper is published into (served through `./assets/*`). */
export const ASSET_DIR = path.join(PACKAGE_DIR, 'lib', 'assets')

/** Wallpaper files above this size are skipped instead of copied. */
const MAX_WALLPAPER_BYTES = 24 * 1024 * 1024

/** How often the Host re-reads the wallpaper while it runs (ms). */
const WALLPAPER_SYNC_MS = 20000

/**
 * Live preferences for the frosted sidebar.
 *
 * Every field is `.volatile()`: the settings forms project volatile fields and
 * only those, and an edit re-reads the reference instead of restarting the row.
 */
export const Config = z.object({
  /** Whether the frosted surface is applied at all. */
  enabled: z.boolean().default(true).volatile(),
  /** Backdrop blur radius in px. */
  blur: z.number().step(1).min(BLUR_RANGE.min).max(BLUR_RANGE.max).default(BLUR_RANGE.default).volatile(),
  /** Sidebar tint opacity in percent: lower is more transparent. */
  opacity: z.number().step(1).min(OPACITY_RANGE.min).max(OPACITY_RANGE.max).default(OPACITY_RANGE.default).volatile(),
})

/**
 * Clamp one numeric preference into its accepted range.
 * @param value - raw configured value.
 * @param range - accepted `min`/`max`/`default` triple.
 * @returns an integer inside the range.
 */
function clampInt(value, range) {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return range.default
  return Math.min(range.max, Math.max(range.min, number))
}

/**
 * Build the inline head script that installs the state before first paint.
 *
 * The stylesheet ships with the browser bundle, so without this row the page
 * would paint the stock solid sidebar until the client half resolves its
 * settings mirror. The script only writes document state; all styling stays in
 * the browser bundle.
 * @param settings - current preferences.
 * @returns classic-script source safe to place inside a `<script>` element.
 */
export function bootScript(settings) {
  const blur = clampInt(settings.blur, BLUR_RANGE)
  const opacity = clampInt(settings.opacity, OPACITY_RANGE)
  const attribute = settings.enabled === true ? 'on' : 'off'
  return '(()=>{'
    + `const r=document.documentElement;r.setAttribute(${JSON.stringify(GLASS_ATTRIBUTE)},${JSON.stringify(attribute)});`
    + `r.style.setProperty('--dsh-glass-blur',${JSON.stringify(`${blur}px`)});`
    + `r.style.setProperty('--dsh-glass-alpha',${JSON.stringify(`${opacity}%`)});`
    + '})()'
}

/**
 * Candidate files holding the wallpaper Windows actually applied, most specific
 * first. `TranscodedWallpaper` is the session-applied image and follows display
 * changes and slideshow rotations.
 * @returns absolute candidate paths.
 */
export function wallpaperSources() {
  const roaming = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  const themes = path.join(roaming, 'Microsoft', 'Windows', 'Themes')
  return [
    path.join(themes, 'TranscodedWallpaper'),
    path.join(themes, 'TranscodedWallpaper.jpg'),
    path.join(themes, 'TranscodedWallpaper.png'),
  ]
}

/**
 * Detect the image format from magic bytes.
 * @param bytes - file contents.
 * @returns the asset-route extension, or undefined for an unsupported format.
 */
function detectFormat(bytes) {
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length > 11 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return undefined
}

/** Last published wallpaper identity and the URL it produced. */
let published = { key: '', url: undefined }

/**
 * Republish the current Windows wallpaper as a package asset.
 *
 * The browser half loads this asset through the client asset route and uses it
 * as the glass backdrop, so the sidebar follows the real wallpaper instead of a
 * fixed painted wash. The file is rewritten only when the source changed.
 * @returns the document-relative asset URL, or undefined when no wallpaper is readable.
 */
export function syncWallpaper() {
  for (const source of wallpaperSources()) {
    let stat
    try { stat = fs.statSync(source) } catch (_absent) { continue }
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_WALLPAPER_BYTES) continue
    const key = `${source}:${stat.mtimeMs}:${stat.size}`
    if (published.key === key) return published.url
    let bytes
    try { bytes = fs.readFileSync(source) } catch (_unreadable) { continue }
    const format = detectFormat(bytes)
    if (format === undefined) continue
    try {
      fs.mkdirSync(ASSET_DIR, { recursive: true })
      for (const name of fs.readdirSync(ASSET_DIR)) {
        if (name.startsWith('wallpaper.')) fs.rmSync(path.join(ASSET_DIR, name), { force: true })
      }
      fs.writeFileSync(path.join(ASSET_DIR, `wallpaper.${format}`), bytes)
    } catch (_unwritable) {
      // A read-only install keeps the previous asset; the browser wash covers it.
      return published.url
    }
    published = { key, url: `plugins/${PACKAGE_NAME}/assets/wallpaper.${format}?v=${Math.round(stat.mtimeMs)}` }
    return published.url
  }
  published = { key: '', url: undefined }
  return undefined
}

/**
 * Register the settings page policy, the pre-paint state row, and the wallpaper
 * publisher.
 * @param ctx - Host plugin context.
 * @param config - validated live preferences (`config.<field>.get()`).
 */
export function apply(ctx, config) {
  // This plugin ships its own rows in Settings › General, so the schema-derived
  // automatic page would only duplicate them. The policy keeps reads and writes.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'glass-sidebar: settings page policy')
  })

  // Keep the published asset in step with the wallpaper while the app runs, so a
  // wallpaper change reaches the open page on its next focus without a reload.
  ctx.effect(() => {
    const sync = () => {
      try { syncWallpaper() } catch (_wallpaperUnavailable) { /* keep the last asset */ }
    }
    sync()
    const timer = setInterval(sync, WALLPAPER_SYNC_MS)
    timer.unref?.()
    return () => { clearInterval(timer) }
  }, 'glass-sidebar: wallpaper asset')

  // Emitted on every index render: the pre-paint state and the wallpaper the
  // glass blurs. The design-time URL is absolute because a Desktop page can be
  // served from another origin than the Web server that answers `/plugins`.
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'script',
      placement: 'head',
      text: bootScript({
        enabled: config.enabled.get(),
        blur: config.blur.get(),
        opacity: config.opacity.get(),
      }),
    })
    const asset = (() => {
      try { return syncWallpaper() } catch (_wallpaperUnavailable) { return undefined }
    })()
    if (asset === undefined) return
    let origin = ''
    try { origin = ctx.get('webServer')?.getOrigin?.() ?? '' } catch (_noWebServer) { origin = '' }
    const url = origin === '' ? asset : `${origin.replace(/\/+$/u, '')}/${asset}`
    table.push({ kind: 'style', text: `html{--dsh-glass-wallpaper:url("${url}")}` })
  }, { prepend: true })
}