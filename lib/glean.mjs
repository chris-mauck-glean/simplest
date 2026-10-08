// Pushes CMS content to a Glean custom datasource through the Indexing API.
// Glean is a search copy: only published, non-deleted items are indexed.

const OBJECT_TYPE = 'Document'

// Custom properties shown in Glean. uiOptions: SEARCH_RESULT (result card), DOC_HOVERCARD (preview card).
export const PROPERTY_DEFINITIONS = [
  { name: 'cmsContentType', displayLabel: 'Content type', displayLabelPlural: 'Content types', propertyType: 'PICKLIST', uiOptions: 'SEARCH_RESULT', hideUiFacet: false, uiFacetOrder: 1 },
  { name: 'cmsAuthor', displayLabel: 'Author', displayLabelPlural: 'Authors', propertyType: 'TEXT', uiOptions: 'SEARCH_RESULT', hideUiFacet: true },
  { name: 'cmsLastUpdated', displayLabel: 'Last updated', displayLabelPlural: 'Last updated', propertyType: 'DATE', uiOptions: 'SEARCH_RESULT', hideUiFacet: true },
  { name: 'cmsAudience', displayLabel: 'Audience', displayLabelPlural: 'Audiences', propertyType: 'PICKLIST', uiOptions: 'DOC_HOVERCARD', hideUiFacet: false, uiFacetOrder: 2 },
  { name: 'cmsOwner', displayLabel: 'Content owner', displayLabelPlural: 'Content owners', propertyType: 'PICKLIST', uiOptions: 'DOC_HOVERCARD', hideUiFacet: false, uiFacetOrder: 3 },
  { name: 'cmsSection', displayLabel: 'Section', displayLabelPlural: 'Sections', propertyType: 'PICKLIST', uiOptions: 'DOC_HOVERCARD', hideUiFacet: false, uiFacetOrder: 4 },
  { name: 'cmsReviewBy', displayLabel: 'Review by', displayLabelPlural: 'Review by', propertyType: 'DATE', uiOptions: 'DOC_HOVERCARD', hideUiFacet: true },
]

// Mirrors the Simplest sidebar sections.
function sectionFor(type) {
  if (type === 'Announcement') return 'Announcements'
  if (type === 'Newsletter') return 'Newsletters'
  return 'Pages & guidance'
}

// Glean hides result times that are in the future, so every time is capped at the current time.
function toEpochSeconds(value, { dateOnly = false } = {}) {
  if (!value) return undefined
  const ms = Date.parse(dateOnly ? `${value}T12:00:00Z` : value)
  return Number.isNaN(ms) ? undefined : Math.floor(Math.min(ms, Date.now()) / 1000)
}

function documentTimes(item) {
  const exact = toEpochSeconds(item.updatedAtTime)
  const day = toEpochSeconds(item.updatedAt, { dateOnly: true })
  // Seeded items carry a content date that differs from their write time; prefer the exact time only when they agree.
  const updatedAt = exact && (!day || Math.abs(exact - day) < 36 * 3600) ? exact : day ?? exact
  const createdAt = toEpochSeconds(item.createdAtTime)
  // Seeded items were stored after their content date; never report creation after the last update.
  return { updatedAt, createdAt: createdAt && updatedAt ? Math.min(createdAt, updatedAt) : createdAt ?? updatedAt }
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
  const authorName = env.GLEAN_AUTHOR_NAME?.trim() || 'Crypt Captain'

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
    const author = { email: authorEmail, name: authorName }
    // Body is the article text only; the summary and metadata travel in their own fields.
    const textContent = item.body || item.summary || item.title
    const { createdAt, updatedAt } = documentTimes(item)
    const customProperties = [
      { name: 'cmsContentType', value: item.type },
      { name: 'cmsAuthor', value: authorName },
      { name: 'cmsLastUpdated', value: item.updatedAt },
      { name: 'cmsAudience', value: item.audience },
      { name: 'cmsOwner', value: item.owner },
      { name: 'cmsSection', value: sectionFor(item.type) },
      { name: 'cmsReviewBy', value: item.reviewDate },
    ].filter(property => property.value)
    return {
      datasource,
      objectType: OBJECT_TYPE,
      id: item.id,
      title: item.title,
      viewURL: viewUrl(item.id),
      // PUBLISHED_CONTENT results show updated time, author, and container in the meta line.
      container: sectionFor(item.type),
      summary: item.summary ? { mimeType: 'text/plain', textContent: item.summary } : undefined,
      body: { mimeType: 'text/plain', textContent },
      author,
      owner: author,
      updatedBy: author,
      createdAt,
      updatedAt,
      tags: [item.type, item.audience].filter(Boolean),
      customProperties,
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
      // One upload session, sent in pages to keep each request small.
      const uploadId = `simplest-${Date.now()}`
      const PAGE_SIZE = 100
      const pages = Math.max(1, Math.ceil(documents.length / PAGE_SIZE))
      for (let page = 0; page < pages; page += 1) {
        await post('bulkindexdocuments', {
          uploadId,
          isFirstPage: page === 0,
          isLastPage: page === pages - 1,
          forceRestartUpload: page === 0,
          datasource,
          documents: documents.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
        })
      }
      return documents.length
    },

    processAll() {
      return post(`processalldocuments?datasource=${encodeURIComponent(datasource)}`, { datasource })
    },

    getConfig() {
      return post('getdatasourceconfig', { datasource })
    },

    updateConfig(config) {
      return post('adddatasource', config)
    },
  }
}
