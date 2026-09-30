import { contentItems } from '../content.mjs'
import { toPublicItem, today } from './content-model.mjs'

const COLLECTION = 'content'
const MAX_ITEMS = 500

export class NotFoundError extends Error {}

// Every change stores the previous version under content/{id}/history so edits can be recovered.
class FirestoreStore {
  constructor(databaseId) {
    this.kind = `firestore:${databaseId}`
    this.ready = import('@google-cloud/firestore').then(({ Firestore, FieldValue }) => {
      const options = { databaseId, ignoreUndefinedProperties: true }
      if (process.env.GOOGLE_CLOUD_PROJECT) options.projectId = process.env.GOOGLE_CLOUD_PROJECT
      this.db = new Firestore(options)
      this.FieldValue = FieldValue
    })
  }

  async list() {
    await this.ready
    const snapshot = await this.db.collection(COLLECTION).where('deleted', '==', false).limit(MAX_ITEMS).get()
    return snapshot.docs.map(doc => toPublicItem(doc.id, doc.data()))
  }

  async #write(id, change, { mustExist }) {
    await this.ready
    const ref = this.db.collection(COLLECTION).doc(id)
    return this.db.runTransaction(async transaction => {
      const current = await transaction.get(ref)
      if (mustExist && (!current.exists || current.data().deleted)) throw new NotFoundError('Content not found.')
      const previous = current.exists ? current.data() : null
      const revision = (previous?.revision || 0) + 1
      const next = {
        ...(previous || { deleted: false, createdAt: this.FieldValue.serverTimestamp() }),
        ...change(previous),
        revision,
        updatedAt: today(),
        updatedAtTime: this.FieldValue.serverTimestamp(),
      }
      if (previous) {
        transaction.set(ref.collection('history').doc(String(previous.revision || 0).padStart(6, '0')), {
          ...previous,
          archivedAt: this.FieldValue.serverTimestamp(),
        })
      }
      transaction.set(ref, next)
      return toPublicItem(id, { ...previous, ...next })
    })
  }

  save(id, fields) {
    return this.#write(id, () => fields, { mustExist: false })
  }

  publish(id) {
    return this.#write(id, () => ({ status: 'published' }), { mustExist: true })
  }

  // Seeds bundled content without overwriting documents that already exist.
  async seed(items) {
    await this.ready
    let created = 0
    for (const item of items) {
      const { id, ...data } = item
      try {
        await this.db.collection(COLLECTION).doc(id).create({
          ...data,
          deleted: false,
          revision: 1,
          createdAt: this.FieldValue.serverTimestamp(),
          updatedAtTime: this.FieldValue.serverTimestamp(),
        })
        created += 1
      } catch (error) {
        if (error.code !== 6) throw error // 6 = ALREADY_EXISTS
      }
    }
    return { created, skipped: items.length - created }
  }
}

// Local development only: changes are kept in memory and lost on restart.
class MemoryStore {
  constructor() {
    this.kind = 'memory'
    this.items = new Map(contentItems.map(item => [item.id, { ...item, deleted: false, revision: 1 }]))
  }

  async list() {
    return [...this.items].filter(([, data]) => !data.deleted).map(([id, data]) => toPublicItem(id, data))
  }

  async save(id, fields) {
    const previous = this.items.get(id)
    const next = { ...(previous || { deleted: false }), ...fields, revision: (previous?.revision || 0) + 1, updatedAt: today() }
    this.items.set(id, next)
    return toPublicItem(id, next)
  }

  async publish(id) {
    const previous = this.items.get(id)
    if (!previous || previous.deleted) throw new NotFoundError('Content not found.')
    return this.save(id, { status: 'published' })
  }
}

export function createStore(env = process.env) {
  const databaseId = env.FIRESTORE_DATABASE?.trim()
  return databaseId ? new FirestoreStore(databaseId) : new MemoryStore()
}
