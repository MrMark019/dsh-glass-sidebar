// Shape and behaviour tests for the Host half.
//
// `index.js` imports `@deepseek-ai/schemastery`, which only resolves from the DSH
// installation, so this file checks the authored source instead of evaluating it:
// syntax is covered by `node --check`, the schema shape and the single index
// injection row are covered here, and the live schema is confirmed after
// installation through `Config.listConfigs`.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const source = await fs.readFile(path.join(root, 'index.js'), 'utf8')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const patch = await fs.readFile(path.join(root, 'cordis.patch.yml'), 'utf8')

test('manifest declares the bundle patch and the browser half', () => {
  assert.equal(manifest.name, 'dsh-glass-sidebar')
  assert.equal(manifest.type, 'module')
  assert.deepEqual(manifest.dsh.bundle, { patch: './cordis.patch.yml' })
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.client.immediately, true)
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
  for (const entry of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg']) {
    assert.ok(manifest.files.includes(entry) || manifest.files.some(file => file.endsWith('*')), `${entry} must ship`)
  }
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./icon'], './icon.svg')
})

test('patch inserts exactly one row whose id is the settings namespace', () => {
  assert.match(patch, /- insert:/)
  assert.match(patch, /id: glass-sidebar/)
  assert.match(patch, /name: 'dsh-glass-sidebar'/)
  assert.equal(patch.match(/- id:/g)?.length, 1)
})

test('every preference is a volatile field so writes never restart the row', () => {
  const fields = [...source.matchAll(/^\s{2}(\w+): z\.[^\n]*$/gm)].map(match => match[1])
  assert.deepEqual(fields, ['enabled', 'blur', 'opacity'])
  for (const field of fields) {
    const line = source.split('\n').find(candidate => candidate.trim().startsWith(`${field}:`))
    assert.match(line, /\.volatile\(\)/, `${field} must be volatile`)
  }
  assert.match(source, /z\.boolean\(\)\.default\(true\)\.volatile\(\)/)
  assert.match(source, /min\(BLUR_RANGE\.min\)\.max\(BLUR_RANGE\.max\)\.default\(BLUR_RANGE\.default\)\.volatile\(\)/)
  assert.match(source, /min\(OPACITY_RANGE\.min\)\.max\(OPACITY_RANGE\.max\)\.default\(OPACITY_RANGE\.default\)\.volatile\(\)/)
})

test('the automatic settings page is suppressed and the pre-paint row is registered', () => {
  assert.match(source, /settings\.configure\(\{ auto: false \}, ctx\.fiber\)/)
  assert.match(source, /ctx\.on\('webserver\/index-inject'/)
  assert.match(source, /kind: 'script'/)
  assert.match(source, /placement: 'head'/)
  assert.match(source, /prepend: true/)
})

test('the boot script only writes document state and never styles', () => {
  assert.match(source, /setAttribute\(\$\{JSON\.stringify\(GLASS_ATTRIBUTE\)\}/)
  assert.match(source, /--dsh-glass-blur/)
  assert.match(source, /--dsh-glass-alpha/)
  assert.doesNotMatch(source, /<style/)
  assert.doesNotMatch(source, /backdrop-filter/)
})

test('the wallpaper is republished as a package asset the browser can load', () => {
  assert.match(source, /TranscodedWallpaper/)
  assert.match(source, /os\.homedir\(\)/)
  assert.match(source, /ASSET_DIR = path\.join\(PACKAGE_DIR, 'lib', 'assets'\)/)
  assert.match(source, /`wallpaper\.\$\{format\}`/)
  assert.match(source, /plugins\/\$\{PACKAGE_NAME\}\/assets\/wallpaper\.\$\{format\}\?v=/)
  assert.match(source, /setInterval\(sync, WALLPAPER_SYNC_MS\)/)
  assert.equal(manifest.exports['./assets/*'], './lib/assets/*')
  assert.ok(manifest.files.includes('lib/assets/*'), 'the runtime asset folder must ship')
  assert.match(source, /--dsh-glass-wallpaper:url\("\$\{url\}"\)/, 'the index carries the wallpaper URL')
  assert.match(source, /getOrigin/, 'the URL is absolute for a Desktop page on another origin')
})