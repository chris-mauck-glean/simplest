// Pushes CMS content to a Glean custom datasource through the Indexing API.
// Glean is a search copy: only published, non-deleted items are indexed.

const OBJECT_TYPE = 'Document'

function dateToEpochSeconds(value) {
  if (!value) return undefined
  const ms = Date.parse(`${value}T12:00:00Z`)
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000)
}

export function createGleanSync(env = process.env) {
  const token = env.GLEAN_INDEXING_API_TOKEN?.trim()
  if (!token) return null
  const required = key => {
    const value = env[key]?.trim()
    if (!value) throw new Error(`${key} is required when GLEAN_INDEXING_API_TOKEN is set.`)
    return value
  }
  const apiUrl = new URL(required('GLEAN_API_URL'))
  const isLocal = ['localhost', '127.0.0.1'].includes(apiUrl.hostname)
  if (apiUrl.protocol !== 'https:' && !isLocal) throw new Error('GLEAN_API_URL must use HTTPS.')
  const apiBase = apiUrl.href.replace(/\/+$/, '')
  const datasource = required('GLEAN_DATASOURCE_NAME')
  const baseUrl = required('SIMPLEST_BASE_URL').replace(/\/+$/, '')
  const authorEmail = required('GLEAN_AUTHOR_EMAIL')

  // Calls run one at a time to stay well inside Indexing API rate limits.
  let queue = Promise.resolve()
  function post(endpoint, body) {
    const run = async () => {
      const response = await fetch(`${apiBase}/api/index/v1/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      })
      const text = await response.text()
      if (!response.ok) {
        const detail = text.replaceAll(token, '[redacted]').slice(0, 500)
        throw new Error(`${endpoint} failed (HTTP ${response.status}): ${detail}`)
      }
      try { return text ? JSON.parse(text) : null } catch { return null }
    }
    const result = queue.then(run, run)
    queue = result.catch(() => {})
    return result
  }

  function viewUrl(id) {
    const url = new URL(`${baseUrl}/`)
    url.searchParams.set('doc', id)
    return url.href
  }

  function toDocument(item) {
    const author = { email: authorEmail }
    const textContent = [
      item.summary,
      `Content type: ${item.type}`,
      `Content owner: ${item.owner}`,
      `Audience: ${item.audience}`,
      item.reviewDate ? `Review date: ${item.reviewDate}` : '',
      item.body,
    ].filter(Boolean).join('\n\n')
    const updatedAt = dateToEpochSeconds(item.updatedAt)
    return {
      datasource,
      objectType: OBJECT_TYPE,
      id: item.id,
      title: item.title,
      viewURL: viewUrl(item.id),
      summary: item.summary ? { mimeType: 'text/plain', textContent: item.summary } : undefined,
      body: { mimeType: 'text/plain', textContent },
      author,
      owner: author,
      updatedBy: author,
      createdAt: updatedAt,
      updatedAt,
      tags: [item.type, item.audience].filter(Boolean),
      // The sandbox datasource is enabled for all users; anonymous access is intentional.
      permissions: { allowAnonymousAccess: true },
    }
  }

  const isIndexable = item => item && !item.deleted && item.status === 'published'

  return {
    datasource,
    baseUrl,
    toDocument,
    isIndexable,

    // Index a published item, or remove it from Glean if it is a draft or deleted.
    async sync(item) {
      if (isIndexable(item)) await post('indexdocument', { document: toDocument(item) })
      else await post('deletedocument', { datasource, objectType: OBJECT_TYPE, id: item.id })
    },

    remove(id) {
      return post('deletedocument', { datasource, objectType: OBJECT_TYPE, id })
    },

    // Replaces the whole datasource document set with the given items (removes anything else).
    async replaceAll(items) {
      const documents = items.filter(isIndexable).map(toDocument)
      await post('bulkindexdocuments', {
        uploadId: `simplest-${Date.now()}`,
        isFirstPage: true,
        isLastPage: true,
        forceRestartUpload: true,
        datasource,
        documents,
      })
      return documents.length
    },

    getConfig() {
      return post('getdatasourceconfig', { datasource })
    },

    updateConfig(config) {
      return post('adddatasource', config)
    },
  }
}
