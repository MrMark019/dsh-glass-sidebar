// dsh-glass-sidebar — browser half.
//
// Turns the left sidebar column into a translucent, frosted surface and adds the
// three preference rows to Settings › General. The Host half owns the durable
// values (volatile Config fields); this half mirrors them through
// `ctx.configForms`, applies them to the document, and queues debounced writes.
//
// Styling note: the shell paints the sidebar column with the theme token
// `--dsw-specific-sidebar-fill` and a CSS-module local class name (`…_sidebarCol`,
// `…_scrollFade`). No public slot exposes that surface, so the effect is one
// stylesheet gated on `html[data-glass-sidebar='on']` that targets the column by
// its module local name and the frame by `:has(> …)`. Nothing here reads another
// plugin's DOM or React tree: if a future release renames those local names the
// rules stop matching and the plugin degrades to no visual change.
//
// Only `react` is required as a module (the platform baseline); the switch and
// the sliders are this plugin's own controls styled with theme tokens.
window.__ModuleLoader__.load({
  id: 'dsh-glass-sidebar',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    //#region dsh-glass-sidebar: constants
    /** Locale namespace owned by this plugin. */
    const NS = 'glassSidebar'
    /** Loader entry id: the settings namespace the Host half serves. */
    const ENTRY = 'glass-sidebar'
    /** Document attribute every glass rule is gated on. */
    const ATTR = 'data-glass-sidebar'
    /** Injected stylesheet element id (also the dedupe key). */
    const STYLE_ID = 'dsh-glass-sidebar-style'
    /** Root variables carrying the two numeric preferences. */
    const VAR_BLUR = '--dsh-glass-blur'
    const VAR_ALPHA = '--dsh-glass-alpha'
    /** Root variable carrying the wallpaper the Host published as a package asset. */
    const VAR_WALLPAPER = '--dsh-glass-wallpaper'
    /** Document-relative asset path the Host republishes the wallpaper to. */
    const WALLPAPER_BASE = 'plugins/dsh-glass-sidebar/assets/wallpaper'
    /** Asset extensions the Host may publish, most likely first. */
    const WALLPAPER_EXTENSIONS = ['jpg', 'png', 'webp']
    /** Minimum gap between live wallpaper re-probes (ms). */
    const WALLPAPER_REFRESH_MS = 60000
    /** Accepted ranges, mirrored from the Host Config schema. */
    const BLUR = Object.freeze({ min: 0, max: 40, default: 18 })
    const OPACITY = Object.freeze({ min: 20, max: 100, default: 62 })
    /** Values before the settings mirror resolves; never written to the document. */
    const DEFAULTS = Object.freeze({ enabled: true, blur: BLUR.default, opacity: OPACITY.default })
    /** Quiet period after the last slider move before one durable write. */
    const WRITE_DELAY_MS = 400
    /** Settings rows, in panel order after the shipped preference rows. */
    const ROWS = Object.freeze([
      { id: 'glass-sidebar-enabled', order: 21 },
      { id: 'glass-sidebar-blur', order: 22 },
      { id: 'glass-sidebar-opacity', order: 23 },
    ])
    //#endregion

    //#region dsh-glass-sidebar: locale
    const zh = {
      'enabled.title': '侧栏毛玻璃',
      'enabled.description': '让左侧栏半透明，背后铺一层你当前的桌面壁纸并模糊它（模拟毛玻璃）。',
      'blur.title': '毛玻璃模糊度',
      'blur.description': '数值越大背后底色越柔和。',
      'opacity.title': '侧栏不透明度',
      'opacity.description': '越低越透，越高越接近原生侧栏。',
      'control.px': 'px',
      'control.percent': '%',
      'control.increase': '增大',
      'control.decrease': '减小',
      'state.unavailable': '当前环境没有可用的设置存储，改动无法保存。',
      'state.failed': '保存失败，改动只在本次页面有效；刚安装的插件需要重载一次页面。',
      'state.offHint': '打开上面的开关后可调整。',
      'state.columnMissing': '没找到侧栏容器，玻璃效果未生效（DSH 可能改了内部类名）。',
    }
    const en = {
      'enabled.title': 'Sidebar glass',
      'enabled.description': 'Makes the left sidebar translucent and blurs your current desktop wallpaper behind it (simulated; the window itself stays opaque).',
      'blur.title': 'Frost blur',
      'blur.description': 'Higher values melt the backdrop further.',
      'opacity.title': 'Sidebar opacity',
      'opacity.description': 'Lower is more transparent; 100% is the stock solid sidebar.',
      'control.px': 'px',
      'control.percent': '%',
      'control.increase': 'Increase',
      'control.decrease': 'Decrease',
      'state.unavailable': 'Settings storage is unavailable here, so changes cannot be saved.',
      'state.failed': 'Could not save; the change applies to this page only. Reload once after a fresh install.',
      'state.offHint': 'Turn the switch on to adjust this.',
      'state.columnMissing': 'The sidebar container was not found, so the glass effect stays off (DSH may have renamed an internal class).',
    }
    //#endregion

    //#region dsh-glass-sidebar: stylesheet
    /** One owned stylesheet: the glass surface plus this plugin's settings rows. */
    const CSS = `
/* ── state ─────────────────────────────────────────────────────────────── */
html[${ATTR}='on']{${VAR_BLUR}:18px;${VAR_ALPHA}:62%}

/* Window backdrop. The Host republishes the Windows wallpaper as a package asset
   and the browser half points this variable at it, so the glass follows the real
   wallpaper; without it the painted wash below is the fallback. Only the
   translucent sidebar and the caption band reveal the backdrop, because the
   centre and right columns paint their own opaque surfaces. */
html[${ATTR}='on'] body{
  background-image:
    var(--dsh-glass-wallpaper,none),
    radial-gradient(58% 40% at 6% 4%,color-mix(in srgb,var(--dsw-static-deepseek-500) 28%,transparent) 0%,transparent 70%),
    radial-gradient(30% 22% at 13% 27%,color-mix(in srgb,var(--dsw-static-blue-500) 24%,transparent) 0%,transparent 60%),
    radial-gradient(22% 18% at 26% 74%,color-mix(in srgb,var(--dsw-static-deepseek-500) 20%,transparent) 0%,transparent 58%),
    radial-gradient(46% 34% at 2% 92%,color-mix(in srgb,var(--dsw-static-blue-500) 18%,transparent) 0%,transparent 72%);
  background-size:cover,auto,auto,auto,auto;
  background-position:center,6% 4%,13% 27%,26% 74%,2% 92%;
  background-repeat:no-repeat;
}

/* The frost. The blur lives on this fixed layer, never on a shell element: a
   filter or backdrop-filter ancestor becomes a containing block for the
   sidebar's position:fixed caption controls (the collapse toggle and the New
   Session button on Windows), which then drop into the column and disappear
   when it collapses. The layer spans the window so the centre column's rounded
   corner and the caption band see the same blurred picture. */
html[${ATTR}='on'] body::before{
  content:'';
  position:fixed;
  inset:0;
  z-index:-1;
  pointer-events:none;
  -webkit-backdrop-filter:blur(${'var(' + VAR_BLUR + ')'}) saturate(1.15);
  backdrop-filter:blur(${'var(' + VAR_BLUR + ')'}) saturate(1.15);
}

/* The glass is the FRAME, not the column: one tint painted behind every column
   means the rounded corner of the centre column reveals glass rather than the
   raw wallpaper, and the caption band is the same surface as the sidebar.
   ':has(> …)' anchors on the column itself, never on a guessed class. */
html[${ATTR}='on'] :has(> [class*='_sidebarCol']){
  background:color-mix(in srgb,var(--dsw-specific-sidebar-fill) ${'var(' + VAR_ALPHA + ')'},transparent)!important;
}
/* The caption drag band adds no second tint; the frame already carries it. */
html[${ATTR}='on'] :has(> [class*='_sidebarCol'])::before{background:transparent!important}

/* The column adds nothing: the frame tint already shows through it. Anything
   structural here (filter, backdrop-filter, transform) would break the shell's
   fixed caption controls. */
html[${ATTR}='on'] [class*='_sidebarCol']{background:transparent!important}
/* The sidebar root paints the same token; let the frame tint be the only fill.
   Slot outlets render through a display:contents '[data-slot]' wrapper, so the
   occupant is the wrapper's child, not the column's. */
html[${ATTR}='on'] [class*='_sidebarCol'] [data-slot='sidebar'] > *{background:transparent!important}
/* The bottom scroll fade must follow the glass tone, not the solid fill. */
html[${ATTR}='on'] [class*='_scrollFade']{
  background:linear-gradient(to bottom,transparent,color-mix(in srgb,var(--dsw-specific-sidebar-fill) calc(${'var(' + VAR_ALPHA + ')'} + 18%),transparent))!important;
}

/* Drawer mode (narrow Web window): the column is an overlay over page content,
   where a translucent panel would smear the text underneath. */
html[${ATTR}='on'] :has(> [class*='_sidebarCol'])[data-sidebar-drawer] [class*='_sidebarCol']{
  background:var(--dsw-specific-sidebar-fill)!important;
}

/* The OS ask for less transparency wins over the preference. */
@media (prefers-reduced-transparency:reduce){
  html[${ATTR}='on'] body{background-image:none}
  html[${ATTR}='on'] body::before{-webkit-backdrop-filter:none;backdrop-filter:none}
  html[${ATTR}='on'] :has(> [class*='_sidebarCol']){
    background:color-mix(in srgb,var(--dsw-specific-sidebar-fill) 92%,transparent)!important;
  }
}

/* ── settings rows ─────────────────────────────────────────────────────── */
.dg-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dg-text{display:flex;flex-direction:column;gap:4px;min-width:0}
.dg-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dg-label{cursor:pointer}
.dg-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dg-alert{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.dg-note{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dg-control{display:inline-flex;align-items:center;gap:8px;flex:none}
.dg-value{min-width:34px;text-align:right;font-size:14px;line-height:22px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dg-unit{min-width:14px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}

.dg-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;
  background:var(--dsw-alias-border-l3);cursor:pointer}
.dg-switch[aria-checked='true']{background:var(--dsw-alias-brand-primary)}
.dg-switch:disabled{cursor:default;opacity:.5}
.dg-switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dg-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;
  background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.dg-switch[aria-checked='false'] .dg-switch-thumb{background:var(--dsw-alias-switch-thumb)}
.dg-switch[aria-checked='true'] .dg-switch-thumb{transform:translate(16px)}

.dg-range{width:160px;height:28px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dg-range:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dg-range:disabled{opacity:.5;cursor:default}

@media (max-width:767px){
  .dg-row{gap:12px}
  .dg-range{width:110px}
}
`

    /**
     * Insert this plugin's stylesheet, refreshing an element a previous
     * generation left behind so a live update never runs two copies.
     * @returns disposer removing the element this call created.
     */
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.getElementById(STYLE_ID)
      if (existing !== null) {
        existing.textContent = CSS
        return () => {}
      }
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.dataset.plugin = 'dsh-glass-sidebar'
      element.textContent = CSS
      document.head.appendChild(element)
      return () => { element.remove() }
    }
    //#endregion

    //#region dsh-glass-sidebar: backdrop
    /**
     * Build one cache-busted wallpaper asset URL.
     * @param extension - asset extension the Host published.
     * @param version - cache-busting token.
     * @returns the document-relative asset URL.
     */
    function wallpaperUrl(extension, version) {
      return WALLPAPER_BASE + '.' + extension + '?v=' + version
    }

    /**
     * Bump the cache token of an existing wallpaper URL so the browser asks the
     * Host for the file again.
     * @param value - current CSS value of the wallpaper variable.
     * @param version - new cache-busting token.
     * @returns the updated value, or undefined when the value holds no asset URL.
     */
    function bumpWallpaperUrl(value, version) {
      if (typeof value !== 'string' || !value.includes('assets/wallpaper.')) return undefined
      if (!value.includes('v=')) return undefined
      return value.replace(/v=\d+/u, 'v=' + version)
    }

    /**
     * Read the wallpaper variable from the document root, inline first.
     * @param root - document root.
     * @returns the current CSS value, or `''` when none is set.
     */
    function currentWallpaper(root) {
      const inline = root.style.getPropertyValue(VAR_WALLPAPER).trim()
      if (inline !== '') return inline
      try { return getComputedStyle(root).getPropertyValue(VAR_WALLPAPER).trim() } catch (_noStyles) { return '' }
    }

    /**
     * Point the backdrop at the published wallpaper.
     *
     * The Host bakes an absolute asset URL into the page and rewrites the file
     * when Windows changes the wallpaper, so bumping the cache token is enough to
     * follow the change without reloading. When no asset answers, the variable is
     * cleared and the painted wash stays as the backdrop.
     * @param root - document root carrying the variable.
     * @param version - cache-busting token for this probe.
     */
    function refreshWallpaper(root, version) {
      const bumped = bumpWallpaperUrl(currentWallpaper(root), version)
      if (bumped !== undefined) {
        root.style.setProperty(VAR_WALLPAPER, bumped)
        return
      }
      if (typeof Image !== 'function') return
      const attempt = (index) => {
        const extension = WALLPAPER_EXTENSIONS[index]
        if (extension === undefined) {
          root.style.removeProperty(VAR_WALLPAPER)
          return
        }
        const url = wallpaperUrl(extension, version)
        const image = new Image()
        image.onload = () => { root.style.setProperty(VAR_WALLPAPER, 'url("' + url + '")') }
        image.onerror = () => { attempt(index + 1) }
        image.src = url
      }
      attempt(0)
    }
    //#endregion

    //#region dsh-glass-sidebar: state
    /**
     * Round one preference into its accepted range.
     * @param value - raw value from a control or the settings mirror.
     * @param range - accepted `min`/`max`/`default` triple.
     * @returns an integer inside the range.
     */
    function clampInt(value, range) {
      const number = Math.round(Number(value))
      if (!Number.isFinite(number)) return range.default
      return Math.min(range.max, Math.max(range.min, number))
    }

    /**
     * Narrow one settings-mirror section into accepted preferences.
     * @param snapshot - `ctx.configForms` snapshot.
     * @returns accepted values, or undefined while loading or unavailable.
     */
    function readValue(snapshot) {
      if (snapshot === null || typeof snapshot !== 'object' || snapshot.status !== 'ready') return undefined
      const value = snapshot.value
      if (value === null || typeof value !== 'object') return undefined
      return {
        enabled: value.enabled !== false,
        blur: clampInt(value.blur, BLUR),
        opacity: clampInt(value.opacity, OPACITY),
      }
    }

    /**
     * Declare the tiny snapshot store the rows and the document effect share.
     * @param initial - initial state.
     * @returns store with `getSnapshot`, `subscribe`, and `update`.
     */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        update(patch) {
          let changed = false
          for (const key of Object.keys(patch)) if (!Object.is(state[key], patch[key])) changed = true
          if (!changed) return
          state = { ...state, ...patch }
          for (const listener of [...listeners]) listener()
        },
      }
    }

    /**
     * Read the state the Host half installed before first paint.
     * @returns seeded preferences, or undefined when the page carries no state.
     */
    function readBootState() {
      if (typeof document === 'undefined') return undefined
      const root = document.documentElement
      if (root === null) return undefined
      const attribute = root.getAttribute(ATTR)
      if (attribute === null) return undefined
      return {
        enabled: attribute === 'on',
        blur: clampInt(parseFloat(root.style.getPropertyValue(VAR_BLUR)), BLUR),
        opacity: clampInt(parseFloat(root.style.getPropertyValue(VAR_ALPHA)), OPACITY),
      }
    }

    /**
     * Write the preference state onto the document root.
     *
     * This never waits for the settings mirror: the state was seeded from the
     * Host half's pre-paint script (or the defaults when a page got the plugin
     * live), so the surface is correct before the first frame, and the mirror
     * only updates it afterwards.
     * @param state - current plugin state.
     */
    function applyDocument(state) {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (root === null) return
      if (state.enabled) {
        root.setAttribute(ATTR, 'on')
        root.style.setProperty(VAR_BLUR, state.blur + 'px')
        root.style.setProperty(VAR_ALPHA, state.opacity + '%')
      } else {
        root.removeAttribute(ATTR)
        root.style.removeProperty(VAR_BLUR)
        root.style.removeProperty(VAR_ALPHA)
      }
    }

    /** Whether the one-shot column probe already ran. */
    let columnProbed = false
    /**
     * Probe once for the styled column and publish the result for the rows, so a
     * renamed internal class shows up in Settings instead of failing silently.
     * @param store - shared store.
     * @param enabled - whether the surface is currently applied.
     */
    function probeColumn(store, enabled) {
      if (columnProbed || !enabled || typeof document === 'undefined' || typeof setTimeout !== 'function') return
      columnProbed = true
      setTimeout(() => {
        const found = document.querySelector('[class*="_sidebarCol"]') !== null
        if (!found) {
          console.warn('[dsh-glass-sidebar] sidebar column not found; the glass stylesheet stays inactive until the shell exposes it again.')
        }
        store.update({ column: found ? 'found' : 'missing' })
      }, 1000)
    }

    /**
     * Subscribe one component to the shared store.
     * @param store - shared store.
     * @returns current state.
     */
    function useGlass(store) {
      const [state, setState] = React.useState(() => store.getSnapshot())
      React.useEffect(() => store.subscribe(() => { setState(store.getSnapshot()) }), [store])
      return state
    }
    //#endregion

    //#region dsh-glass-sidebar: row components
    /**
     * Toggle row: title, description, and the switch this plugin draws itself.
     * @param props - slot props plus the injected `glass` store and `actions`.
     * @returns the row element tree.
     */
    function ToggleRow({ t, glass, actions }) {
      const state = useGlass(glass)
      const unavailable = state.persist === 'unavailable'
      const described = ['dg-enabled-desc']
      if (unavailable) described.push('dg-enabled-unavailable')
      if (state.failedField === 'enabled') described.push('dg-enabled-failed')
      if (state.column === 'missing') described.push('dg-enabled-column')
      return h('div', { className: 'dg-row' },
        h('div', { className: 'dg-text' },
          h('div', { className: 'dg-title', id: 'dg-enabled-title' }, t('enabled.title')),
          h('div', { className: 'dg-desc', id: 'dg-enabled-desc' }, t('enabled.description')),
          unavailable && h('div', { className: 'dg-alert', id: 'dg-enabled-unavailable', role: 'alert' }, t('state.unavailable')),
          state.failedField === 'enabled'
            && h('div', { className: 'dg-alert', id: 'dg-enabled-failed', role: 'alert' }, t('state.failed')),
          state.column === 'missing'
            && h('div', { className: 'dg-note', id: 'dg-enabled-column', role: 'status' }, t('state.columnMissing'))),
        h('button', {
          type: 'button',
          role: 'switch',
          className: 'dg-switch',
          'aria-checked': state.enabled ? 'true' : 'false',
          'aria-labelledby': 'dg-enabled-title',
          'aria-describedby': described.join(' '),
          disabled: unavailable,
          onClick: () => { actions.setEnabled(!state.enabled) },
        }, h('span', { className: 'dg-switch-thumb', 'aria-hidden': 'true' })))
    }

    /**
     * Range row: one slider, its numeric readout, and the unit.
     * @param props - slot props, injected store/actions, plus `field`, `min`,
     * `max`, `unit`, and the two locale keys.
     * @returns the row element tree.
     */
    function RangeRow({ t, glass, actions, field, min, max, unit, titleKey, descriptionKey }) {
      const state = useGlass(glass)
      const value = state[field]
      const inputId = 'dg-' + field + '-input'
      const descId = 'dg-' + field + '-desc'
      const offId = 'dg-' + field + '-off'
      const failedId = 'dg-' + field + '-failed'
      const off = !state.enabled
      const disabled = state.persist === 'unavailable' || off
      const described = [descId]
      if (off) described.push(offId)
      if (state.failedField === field) described.push(failedId)
      return h('div', { className: 'dg-row' },
        h('div', { className: 'dg-text' },
          h('label', { className: 'dg-title dg-label', htmlFor: inputId }, t(titleKey)),
          h('div', { className: 'dg-desc', id: descId }, t(descriptionKey)),
          off && h('div', { className: 'dg-note', id: offId }, t('state.offHint')),
          state.failedField === field
            && h('div', { className: 'dg-alert', id: failedId, role: 'alert' }, t('state.failed'))),
        h('div', { className: 'dg-control' },
          h('input', {
            id: inputId,
            type: 'range',
            className: 'dg-range',
            min,
            max,
            step: 1,
            value,
            disabled,
            'aria-describedby': described.join(' '),
            'aria-valuetext': value + unit,
            onChange: (event) => { actions[field === 'blur' ? 'setBlur' : 'setOpacity'](Number(event.target.value)) },
          }),
          h('span', { className: 'dg-value' }, String(value)),
          h('span', { className: 'dg-unit', 'aria-hidden': 'true' }, unit)))
    }

    /** Blur row bound to the blur preference. */
    function BlurRow(props) {
      return h(RangeRow, {
        ...props, field: 'blur', min: BLUR.min, max: BLUR.max, unit: props.t('control.px'),
        titleKey: 'blur.title', descriptionKey: 'blur.description',
      })
    }

    /** Opacity row bound to the opacity preference. */
    function OpacityRow(props) {
      return h(RangeRow, {
        ...props, field: 'opacity', min: OPACITY.min, max: OPACITY.max, unit: props.t('control.percent'),
        titleKey: 'opacity.title', descriptionKey: 'opacity.description',
      })
    }
    //#endregion

    //#region dsh-glass-sidebar: plugin
    /** Services this browser half requires: slots, copy, the settings Remote, and its mirror. */
    const inject = ['slots', 'locale', 'remote', 'configForms']

    /**
     * Mirror the Host preferences, apply them to the document, and register the
     * three Settings › General rows.
     * @param ctx - plugin-owned Client context.
     */
    function apply(ctx) {
      ctx.effect(() => installStyles(), 'glass-sidebar: stylesheet')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'glass-sidebar: dictionaries')

      const form = ctx.configForms.get(ENTRY)
      // Seed from the Host half's pre-paint state (or the defaults on a page that
      // received the plugin live), so the surface never waits for the mirror.
      const boot = readBootState()
      const store = createStore({
        ...(boot === undefined ? DEFAULTS : boot),
        persist: 'pending',
        failedField: null,
        column: 'unknown',
      })

      /** Fields with a queued or in-flight write; the mirror may not override them. */
      const dirty = { enabled: false, blur: false, opacity: false }
      /** One debounce timer per field, so a fast drag never writes stale values. */
      const timers = {}
      /**
       * Document revision already folded in. An echo that does not advance the
       * revision is an older view of the document: adopting it would flip the
       * surface back for a frame right after the user moved a control.
       */
      let lastRevision = -1

      /** Fold the current settings mirror into the store. */
      const adopt = () => {
        const snapshot = form.getSnapshot()
        if (snapshot.status === 'unavailable') {
          store.update({ persist: 'unavailable' })
          return
        }
        const value = readValue(snapshot)
        if (value === undefined) return
        if (typeof snapshot.revision === 'number') {
          if (snapshot.revision <= lastRevision) return
          lastRevision = snapshot.revision
        }
        const patch = { persist: 'ready' }
        for (const field of ['enabled', 'blur', 'opacity']) if (!dirty[field]) patch[field] = value[field]
        store.update(patch)
      }

      ctx.effect(() => {
        const off = form.subscribe(adopt)
        adopt()
        return off
      }, 'glass-sidebar: settings mirror')

      /**
       * Commit one field after the quiet period.
       * @param field - preference name.
       * @param value - accepted value.
       */
      const commit = (field, value) => {
        dirty[field] = true
        clearTimeout(timers[field])
        timers[field] = setTimeout(() => {
          timers[field] = undefined
          void (async () => {
            let accepted = false
            try { accepted = await form.set(field, value) } catch (_writeRejected) { accepted = false }
            dirty[field] = false
            store.update({ failedField: accepted ? null : field, persist: accepted ? 'ready' : store.getSnapshot().persist })
            adopt()
          })()
        }, WRITE_DELAY_MS)
      }

      const actions = {
        setEnabled(enabled) {
          const value = enabled === true
          store.update({ enabled: value, failedField: null })
          commit('enabled', value)
        },
        setBlur(px) {
          const value = clampInt(px, BLUR)
          store.update({ blur: value, failedField: null })
          commit('blur', value)
        },
        setOpacity(percent) {
          const value = clampInt(percent, OPACITY)
          store.update({ opacity: value, failedField: null })
          commit('opacity', value)
        },
      }

      // Document state follows the store; disposal leaves the page as it was found.
      ctx.effect(() => {
        const sync = () => {
          const state = store.getSnapshot()
          applyDocument(state)
          probeColumn(store, state.enabled)
        }
        const off = store.subscribe(sync)
        sync()
        return () => {
          off()
          if (typeof document === 'undefined') return
          for (const field of Object.keys(timers)) clearTimeout(timers[field])
          const root = document.documentElement
          root.removeAttribute(ATTR)
          root.style.removeProperty(VAR_BLUR)
          root.style.removeProperty(VAR_ALPHA)
        }
      }, 'glass-sidebar: document state')

      // Follow the wallpaper the Host publishes: probe once on apply, then again
      // when the window regains focus, so a wallpaper change lands without a
      // reload and the glass never keeps the previous wallpaper's colours.
      ctx.effect(() => {
        if (typeof document === 'undefined' || typeof window === 'undefined'
          || typeof window.addEventListener !== 'function'
          || typeof document.addEventListener !== 'function') return () => {}
        const root = document.documentElement
        let probedAt = 0
        const refresh = () => {
          const now = Date.now()
          if (now - probedAt < WALLPAPER_REFRESH_MS) return
          probedAt = now
          refreshWallpaper(root, now)
        }
        const onFocus = () => { refresh() }
        const onVisibility = () => { if (document.visibilityState !== 'hidden') refresh() }
        refresh()
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisibility)
          root.style.removeProperty(VAR_WALLPAPER)
        }
      }, 'glass-sidebar: wallpaper backdrop')

      const injected = () => ({ glass: store, actions })
      const register = (index, component) => {
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: ROWS[index].id,
          order: ROWS[index].order,
          locale: NS,
          inject: injected,
        }, component))
      }
      register(0, ToggleRow)
      register(1, BlurRow)
      register(2, OpacityRow)
    }
    //#endregion

    return {
      inject,
      apply,
      // Pure surface for the Node test harness; the plugin entry ignores it.
      __glass: { clampInt, readValue, readBootState, createStore, applyDocument, wallpaperUrl, bumpWallpaperUrl, bootKeys: { ATTR, VAR_BLUR, VAR_ALPHA, VAR_WALLPAPER, WALLPAPER_BASE, STYLE_ID, ROWS, BLUR, OPACITY, DEFAULTS, WRITE_DELAY_MS }, CSS },
    }
  },
})