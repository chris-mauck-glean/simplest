// Operator tool: full reconcile of Firestore content into the Glean datasource.
// - Updates the datasource URL pattern to match SIMPLEST_BASE_URL (other settings are preserved).
// - Replaces the datasource document set with every published, non-deleted item.
// Usage (from the simplest folder, with Application Default Credentials):
//   FIRESTORE_DATABASE=simplest GOOGLE_CLOUD_PROJECT=salessavvy-test node scripts/sync-glean.mjs [--dry-run]
// Glean settings come from ../.env; environment variables override them.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createGleanSync } from '../lib/glean.mjs'
import { createStore } from '../lib/store.mjs'

const envPath = fileURLToPath(new URL('../../.env', import.meta.url))
const fileConfig = {}
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (match) fileConfig[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
}
const config = { ...fileConfig, ...process.env }
if (!config.FIRESTORE_DATABASE) throw new Error('Set FIRESTORE_DATABASE (for example, simplest).')

const glean = createGleanSync(config)
if (!glean) throw new Error('GLEAN_INDEXING_API_TOKEN is not set.')
const store = createStore(config)
const items = await store.list()
const published = items.filter(glean.isIndexable)
const byType = {}
for (const item of published) byType[item.type] = (byType[item.type] || 0) + 1
const urlRegex = `^${glean.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.*`

console.log(`Firestore ${store.kind}: ${items.length} items, ${published.length} published.`)
console.log(`Published by type: ${JSON.stringify(byType)}`)
console.log(`Target datasource: ${glean.datasource}; URL pattern: ${urlRegex}`)

if (process.argv.includes('--dry-run')) {
  const sample = published[0] && glean.toDocument(published[0])
  if (sample) console.log(`Sample document: ${JSON.stringify({ id: sample.id, title: sample.title, viewURL: sample.viewURL, author: sample.author, tags: sample.tags, updatedAt: sample.updatedAt })}`)
  if (sample && !new RegExp(urlRegex).test(sample.viewURL)) throw new Error('Sample viewURL does not match the URL pattern.')
  console.log('Dry run only; nothing was sent.')
  process.exit(0)
}

const current = await glean.getConfig()
if (current.urlRegex !== urlRegex) {
  await glean.updateConfig({ ...current, name: glean.datasource, urlRegex })
  console.log(`Updated datasource URL pattern (was ${current.urlRegex}).`)
}
const after = await glean.getConfig()
console.log(`Datasource check: urlRegex=${after.urlRegex}; test=${after.isTestDatasource}; visibility=${after.datasourceVisibility ?? 'n/a'}`)

const sent = await glean.replaceAll(published)
for (const item of published) await store.setSyncStatus(item.id, 'synced').catch(() => {})
console.log(`Sent ${sent} published documents to Glean. Indexing is asynchronous (typically 5–30 minutes).`)
