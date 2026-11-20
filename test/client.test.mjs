// Shape and behaviour tests for the browser half.
//
// The bundle is a classic script that only registers a factory, so it loads here
// against a stub module table, a stub document, and a recording plugin context:
// that proves the three Settings rows and the document writes the UI depends on.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundle = path.join(here, '..', 'client.js')

/** Minimal `document.documentElement` that records attributes and custom properties. */
function createDocument() {
  const styles = []
  const root = {
    attributes: {},
    style: {
      props: {},
      setProperty(name, value) { this.props[name] = value },
      removeProperty(name) { delete this.props[name] },
      getPropertyValue(name) { return this.props[name] ?? '' },
    },
    setAttribute(name, value) { this.attributes[name] = value },
    removeAttribute(name) { delete this.attributes[name] },
    getAttribute(name) { return this.attributes[name] ?? null },
  }
  const document = {
    documentElement: root,
    head: { appendChild(element) { styles.push(element) } },
    getElementById() { return null },
    createElement() { return { id: '', textContent: '', dataset: {}, remove() {} } },
    querySelector() { return {} },
  }
  return { document, root, styles }
}

/** Load the bundle and return the factory it registered. */
async function loadBundle() {
  const source = await fs.readFile(bundle, 'utf8')
  let entry
  const window = { __ModuleLoader__: { load: (captured) => { entry = captured } } }
  const { document, root, styles } = createDocument()
  const run = new Function('window', 'document', `${source}\nreturn window.__ModuleLoader__;`)
  run(window, document)
  assert.ok(entry, 'the bundle must register itself')
  return { entry, document, root, styles }
}

/** Module table stub: only the platform `react` baseline is required. */
function stubRequire() {
  const createElement = (type, props, ...children) => ({ type, props, children })
  return (id) => {
    if (id === 'react') {
      return {
        createElement,
        useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
        useEffect: () => {},
      }
    }
    throw new Error(`unexpected require: ${id}`)
  }
}

/** Recording plugin context plus a controllable settings-mirror snapshot. */
function createContext(snapshot) {
  const slots = []
  const effects = []
  const locales = []
  const writes = []
  const listeners = new Set()
  let current = snapshot
  const form = {
    getSnapshot: () => current,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(field, value) { writes.push([field, value]); return Promise.resolve(true) },
  }
  const ctx = {
    effect(run, label) {
      const dispose = run()
      effects.push({ label, dispose })
      return () => {}
    },
    locale: {
      register(namespace, dicts) { locales.push({ namespace, dicts }); return () => {} },
      bind: () => (key) => key,
    },
    slots: {
      inject(name, callback) { callback(); return () => {} },
      register(options, component) { slots.push({ options, component }); return () => {} },
    },
    configForms: { get: () => form },
  }
  return {
    ctx, slots, effects, locales, writes,
    setSnapshot(next) { current = next; for (const listener of [...listeners]) listener() },
  }
}

/** Ready mirror snapshot with the given preferences. */
function ready(enabled, blur, opacity) {
  return { status: 'ready', value: { enabled, blur, opacity }, revision: 1 }
}

/** Materialize the factory and run `apply`. */
async function mount(snapshot, seed) {
  const { entry, root, styles } = await loadBundle()
  if (seed !== undefined) seed(root)
  const exports_ = entry.factory(stubRequire())
  const context = createContext(snapshot)
  exports_.apply(context.ctx)
  return { exports_, root, styles, ...context }
}

test('the factory registers one id, the required services, and apply', async () => {
  const { entry } = await loadBundle()
  const exports_ = entry.factory(stubRequire())
  assert.equal(entry.id, 'dsh-glass-sidebar')
  assert.deepEqual(exports_.inject, ['slots', 'locale', 'remote', 'configForms'])
  assert.equal(typeof exports_.apply, 'function')
})

test('apply registers three General rows in order with localized copy', async () => {
  const { slots, locales } = await mount(ready(true, 18, 62))
  assert.equal(locales.length, 1)
  assert.equal(locales[0].namespace, 'glassSidebar')
  assert.ok(locales[0].dicts.zh['enabled.title'])
  assert.ok(locales[0].dicts.en['enabled.title'])
  assert.equal(slots.length, 3)
  assert.deepEqual(slots.map(slot => slot.options.id), [
    'glass-sidebar-enabled', 'glass-sidebar-blur', 'glass-sidebar-opacity',
  ])
  assert.deepEqual(slots.map(slot => slot.options.order), [21, 22, 23])
  for (const slot of slots) {
    assert.equal(slot.options.name, 'settings.general.item')
    assert.equal(slot.options.locale, 'glassSidebar')
    const injected = slot.options.inject()
    assert.equal(typeof injected.glass.getSnapshot, 'function')
    assert.equal(typeof injected.actions.setEnabled, 'function')
  }
})

test('a ready mirror installs the state, and disabling it restores the page', async () => {
  const mounted = await mount(ready(true, 20, 55))
  assert.equal(mounted.root.attributes['data-glass-sidebar'], 'on')
  assert.equal(mounted.root.style.props['--dsh-glass-blur'], '20px')
  assert.equal(mounted.root.style.props['--dsh-glass-alpha'], '55%')

  mounted.setSnapshot({ status: 'ready', value: { enabled: false, blur: 20, opacity: 55 }, revision: 2 })
  assert.equal(mounted.root.attributes['data-glass-sidebar'], undefined)
  assert.equal(mounted.root.style.props['--dsh-glass-blur'], undefined)
  assert.equal(mounted.root.style.props['--dsh-glass-alpha'], undefined)
})

test('a page without pre-paint state paints the default surface at once', async () => {
  const mounted = await mount({ status: 'loading', value: undefined, revision: undefined })
  assert.equal(mounted.root.attributes['data-glass-sidebar'], 'on')
  assert.equal(mounted.root.style.props['--dsh-glass-blur'], '18px')
  assert.equal(mounted.root.style.props['--dsh-glass-alpha'], '62%')
  const { glass } = mounted.slots[0].options.inject()
  assert.equal(glass.getSnapshot().persist, 'pending')
})

test('the Host half pre-paint state seeds the surface instead of the defaults', async () => {
  const mounted = await mount(
    { status: 'loading', value: undefined, revision: undefined },
    (root) => {
      root.setAttribute('data-glass-sidebar', 'on')
      root.style.setProperty('--dsh-glass-blur', '30px')
      root.style.setProperty('--dsh-glass-alpha', '45%')
    },
  )
  assert.equal(mounted.root.style.props['--dsh-glass-blur'], '30px')
  assert.equal(mounted.root.style.props['--dsh-glass-alpha'], '45%')
  const { glass } = mounted.slots[0].options.inject()
  assert.equal(glass.getSnapshot().blur, 30)
  assert.equal(glass.getSnapshot().opacity, 45)
})

test('an unavailable settings store keeps the surface and flags the rows', async () => {
  const mounted = await mount({ status: 'unavailable', value: undefined, revision: undefined })
  assert.equal(mounted.root.attributes['data-glass-sidebar'], 'on')
  const { glass } = mounted.slots[0].options.inject()
  assert.equal(glass.getSnapshot().persist, 'unavailable')
})

test('out-of-range stored values are clamped to the accepted ranges', async () => {
  const mounted = await mount(ready(true, 999, 5))
  assert.equal(mounted.root.style.props['--dsh-glass-blur'], '40px')
  assert.equal(mounted.root.style.props['--dsh-glass-alpha'], '20%')
})

test('a fast drag commits one debounced write with the final value', async () => {
  const mounted = await mount(ready(true, 18, 62))
  const { actions } = mounted.slots[1].options.inject()
  actions.setBlur(20)
  actions.setBlur(28)
  actions.setBlur(33)
  assert.deepEqual(mounted.writes, [], 'nothing is written while the drag is live')
  await new Promise(resolve => setTimeout(resolve, 600))
  assert.deepEqual(mounted.writes, [['blur', 33]])
  assert.equal(mounted.root.style.props['--dsh-glass-blur'], '33px')
})

test('disposing the document effect removes every style this plugin wrote', async () => {
  const mounted = await mount(ready(true, 22, 70))
  const effect = mounted.effects.find(entry => entry.label === 'glass-sidebar: document state')
  assert.ok(effect, 'the document effect must be registered')
  effect.dispose()
  assert.equal(mounted.root.attributes['data-glass-sidebar'], undefined)
  assert.deepEqual(mounted.root.style.props, {})
})

test('the stylesheet is gated, token-driven, and owns only this plugin surface', async () => {
  const { exports_, styles } = await mount(ready(true, 18, 62))
  const css = exports_.__glass.CSS
  assert.equal(styles.length, 1)
  assert.equal(styles[0].dataset.plugin, 'dsh-glass-sidebar')
  assert.ok(css.includes("html[data-glass-sidebar='on']"))
  assert.ok(css.includes("_sidebarCol"))
  assert.ok(css.includes("_scrollFade"))
  assert.ok(css.includes("[data-slot='sidebar'] > *"), 'the slot wrapper must be traversed')
  assert.ok(css.includes('var(--dsw-specific-sidebar-fill)'))
  assert.ok(css.includes('prefers-reduced-transparency'))
  assert.ok(css.includes('[data-sidebar-drawer]'))
  assert.ok(!css.includes('</style'), 'the stylesheet text must not close its element')
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css.replace(/rgb\([^)]*\)/g, '')), 'no literal palette colors')
})

test('the blur never lands on a shell element (fixed caption controls stay put)', async () => {
  const { exports_ } = await mount(ready(true, 18, 62))
  const css = exports_.__glass.CSS
  const columnStart = css.indexOf("[class*='_sidebarCol']{")
  assert.ok(columnStart > 0, 'the column rule must exist')
  const columnRule = css.slice(columnStart, css.indexOf('}', columnStart))
  assert.ok(columnRule.includes('background:transparent'), 'the frame carries the tint, not the column')
  assert.ok(!columnRule.includes('backdrop-filter'), 'the column must not become a containing block')
  assert.ok(!columnRule.includes('filter:'), 'no filter on the column either')
  assert.ok(css.includes('body::before'), 'the blur lives on a fixed backdrop layer')
  assert.match(css, /body::before\{[^}]*inset:0/, 'the blur layer spans the window so the corner notch is glass too')
})

test('the tint sits on the frame so the rounded corner reveals glass', async () => {
  const { exports_ } = await mount(ready(true, 18, 62))
  const css = exports_.__glass.CSS
  const frameStart = css.indexOf(":has(> [class*='_sidebarCol']){\n  background:color-mix")
  assert.ok(frameStart > 0, 'the frame rule carries the tint')
  assert.ok(css.includes(":has(> [class*='_sidebarCol'])::before{background:transparent"), 'the caption band adds no second tint')
})

test('the backdrop follows the published wallpaper, with the wash as fallback', async () => {
  const { exports_, effects } = await mount(ready(true, 18, 62))
  const { CSS, wallpaperUrl, bootKeys } = exports_.__glass
  assert.ok(CSS.includes('var(--dsh-glass-wallpaper,none)'), 'the wallpaper is the first backdrop layer')
  assert.ok(CSS.includes('background-size:cover'), 'the wallpaper covers the window')
  assert.ok(bootKeys.WALLPAPER_BASE.endsWith('/assets/wallpaper'))
  assert.equal(wallpaperUrl('jpg', 42), 'plugins/dsh-glass-sidebar/assets/wallpaper.jpg?v=42')
  assert.equal(
    exports_.__glass.bumpWallpaperUrl('url("plugins/dsh-glass-sidebar/assets/wallpaper.png?v=1")', 9),
    'url("plugins/dsh-glass-sidebar/assets/wallpaper.png?v=9")',
  )
  assert.equal(exports_.__glass.bumpWallpaperUrl('none', 9), undefined)
  assert.ok(effects.some(entry => entry.label === 'glass-sidebar: wallpaper backdrop'), 'the refresh effect is registered')
})

test('helpers clamp and narrow as the rows expect', async () => {
  const { exports_ } = await mount(ready(true, 18, 62))
  const { clampInt, readValue } = exports_.__glass
  assert.equal(clampInt(-5, exports_.__glass.bootKeys.BLUR), 0)
  assert.equal(clampInt('abc', exports_.__glass.bootKeys.BLUR), 18)
  assert.equal(clampInt(41, exports_.__glass.bootKeys.BLUR), 40)
  assert.equal(readValue({ status: 'ready', value: { enabled: 'yes', blur: 10.4, opacity: 150 } }).blur, 10)
  assert.equal(readValue({ status: 'ready', value: { enabled: 'yes', blur: 10.4, opacity: 150 } }).opacity, 100)
  assert.equal(readValue({ status: 'ready', value: { enabled: 'yes', blur: 10.4, opacity: 150 } }).enabled, true)
  assert.equal(readValue({ status: 'loading' }), undefined)
  assert.equal(readValue({ status: 'unavailable' }), undefined)
})