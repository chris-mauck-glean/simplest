// Seeds the bundled resources into Firestore. Existing documents are never overwritten.
// Usage (from the simplest folder, with Application Default Credentials):
//   FIRESTORE_DATABASE=simplest GOOGLE_CLOUD_PROJECT=salessavvy-test node scripts/seed-firestore.mjs
import { contentItems } from '../content.mjs'
import { createStore } from '../lib/store.mjs'

if (!process.env.FIRESTORE_DATABASE) {
  console.error('Set FIRESTORE_DATABASE (for example, simplest) before seeding.')
  process.exit(1)
}

const store = createStore()
const result = await store.seed(contentItems)
console.log(`Seeded ${store.kind}: ${result.created} created, ${result.skipped} already present.`)
const items = await store.list()
console.log(`Documents now listed by the API: ${items.length}`)
