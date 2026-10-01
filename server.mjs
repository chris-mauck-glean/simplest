import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ValidationError, isValidId, validateEdit } from './lib/content-model.mjs'
import { NotFoundError, createStore } from './lib/store.mjs'
import { createGleanSync } from './lib/glean.mjs'

const siteRoot = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.PORT || 8080)
const store = createStore()
const publicBaseUrl = (process.env.SIMPLEST_BASE_URL || 'https://simplest.cloud.run').replace(/\/+$/, '')

let glean = null
try {
  glean = createGleanSync()
} catch (error) {
  console.error(`Glean sync disabled: ${error.message}`)
}

// Sync runs before the response so Cloud Run does not throttle it. A failure never blocks the CMS write;
// it is recorded on the item and retried on the next change or server start.
async function syncToGlean(item) {
  if (!glean) return 'disabled'
  try {
    await glean.sync(item)
    await store.setSyncStatus(item.id, 'synced').catch(error => console.error('Could not record sync status.', error))
    return 'synced'
  } catch (error) {
    console.error(`Glean sync failed for ${item.id}: ${error.message}`)
    await store.setSyncStatus(item.id, 'error', error.message).catch(() => {})
    return 'error'
  }
}

async function retryFailedSyncs() {
  if (!glean) return
  try {
    const failed = await store.listSyncErrors()
    for (const item of failed) await syncToGlean(item)
    if (failed.length) console.log(`Retried Glean sync for ${failed.length} item(s).`)
  } catch (error) {
    console.error('Could not retry failed Glean syncs.', error)
  }
}

const MAX_BODY_BYTES = 64 * 1024
const WRITE_LIMIT = 30 // writes per client IP per window (best effort, per instance)
const WRITE_WINDOW_MS = 60 * 1000

const publicFiles = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/content.mjs', 'text/javascript; charset=utf-8'],
  ['/assets/simplest-mark.png', 'image/png'],
  ['/assets/simplest-mark.svg', 'image/svg+xml; charset=utf-8'],
])

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.')
  process.exit(1)
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const writeCounts = new Map()
function checkWriteRate(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const client = forwarded || request.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const entry = writeCounts.get(client)
  if (!entry || now - entry.start > WRITE_WINDOW_MS) {
    writeCounts.set(client, { start: now, count: 1 })
  } else if (++entry.count > WRITE_LIMIT) {
    throw new HttpError(429, 'Too many changes. Wait a minute and try again.')
  }
  if (writeCounts.size > 10000) {
    for (const [key, value] of writeCounts) if (now - value.start > WRITE_WINDOW_MS) writeCounts.delete(key)
  }
}

async function readJson(request) {
  const type = String(request.headers['content-type'] || '')
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON with Content-Type: application/json.')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.')
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

async function handleApi(request, response, pathname) {
  const parts = pathname.split('/').filter(Boolean) // ['api', 'content', id?, action?]
  if (parts[1] !== 'content' || parts.length > 4) throw new HttpError(404, 'Not found.')
  const id = parts[2]
  const action = parts[3]

  if (!id) {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.')
    return sendJson(response, 200, { items: await store.list() })
  }
  if (!isValidId(id)) throw new HttpError(400, 'Invalid content id.')

  if (!action && request.method === 'PUT') {
    checkWriteRate(request)
    const fields = validateEdit(await readJson(request))
    const item = await store.save(id, fields)
    await syncToGlean(item)
    return sendJson(response, 200, { item })
  }
  if (!action && request.method === 'DELETE') {
    checkWriteRate(request)
    await store.remove(id)
    await syncToGlean({ id, deleted: true })
    return sendJson(response, 200, { deleted: id })
  }
  if (action === 'publish' && request.method === 'POST') {
    checkWriteRate(request)
    const item = await store.publish(id)
    await syncToGlean(item)
    return sendJson(response, 200, { item })
  }
  throw new HttpError(405, 'Method not allowed.')
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

// Renders a published item into the page HTML so that clients without JavaScript
// (link previews, document readers, crawlers) receive the article, not only the app shell.
function renderDocumentHtml(html, item, canonicalUrl) {
  const blocks = String(item.body || '').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean)
  const bodyHtml = blocks.map(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
    const bullets = lines.filter(line => /^[•\-*]\s+/.test(line))
    const text = lines.filter(line => !/^[•\-*]\s+/.test(line))
    const heading = text.length && /^[^a-z]+$/.test(text[0]) && text[0].length <= 80 ? text.shift() : ''
    return [
      heading ? `<h2>${escapeHtml(heading)}</h2>` : '',
      text.length ? `<p>${text.map(escapeHtml).join('<br>')}</p>` : '',
      bullets.length ? `<ul>${bullets.map(line => `<li>${escapeHtml(line.replace(/^[•\-*]\s+/, ''))}</li>`).join('')}</ul>` : '',
    ].join('')
  }).join('\n')
  const meta = [item.type, item.audience && `Audience: ${item.audience}`, item.owner && `Owner: ${item.owner}`, item.updatedAt && `Updated: ${item.updatedAt}`]
    .filter(Boolean).map(escapeHtml).join(' · ')
  const article = `<article id="server-document" class="server-document">
<h1>${escapeHtml(item.title)}</h1>
<p class="server-document-meta">${meta}</p>
${item.summary ? `<p class="server-document-summary">${escapeHtml(item.summary)}</p>` : ''}
${bodyHtml}
</article>`
  const head = `<title>${escapeHtml(item.title)} — Simplest</title>
  <meta name="description" content="${escapeHtml(item.summary || item.title)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">`
  return html
    .replace(/<title>[^<]*<\/title>/, () => head)
    .replace(/<body>/, () => `<body>\n${article}`)
}

async function findPublished(id) {
  if (!isValidId(id)) return null
  const items = await store.list()
  return items.find(item => item.id === id && item.status === 'published') || null
}

async function serveFile(request, response, pathname, searchParams) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
    response.end('Method not allowed\n')
    return
  }
  if (pathname === '/') pathname = '/index.html'
  const contentType = publicFiles.get(pathname)
  if (!contentType) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
    response.end('Not found\n')
    return
  }
  let body = await readFile(resolve(siteRoot, `.${pathname}`))
  const docId = pathname === '/index.html' ? searchParams?.get('doc') : null
  if (docId) {
    const item = await findPublished(docId).catch(error => {
      console.error('Could not load document for page render.', error)
      return null
    })
    if (item) {
      const canonicalUrl = `${publicBaseUrl}/?doc=${encodeURIComponent(item.id)}`
      body = Buffer.from(renderDocumentHtml(body.toString('utf8'), item, canonicalUrl))
    }
  }
  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Length': body.byteLength,
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(request.method === 'HEAD' ? undefined : body)
}

const server = createServer(async (request, response) => {
  let pathname
  let searchParams
  try {
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    pathname = decodeURIComponent(requestUrl.pathname)
    searchParams = requestUrl.searchParams
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Bad request\n')
    return
  }

  const isApi = pathname === '/api' || pathname.startsWith('/api/')
  try {
    if (isApi) await handleApi(request, response, pathname)
    else await serveFile(request, response, pathname, searchParams)
  } catch (error) {
    if (!isApi) {
      const status = error.code === 'ENOENT' ? 404 : 500
      if (status === 500) console.error('Could not serve site file.', error)
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(status === 404 ? 'Not found\n' : 'Internal server error\n')
      return
    }
    if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message })
    if (error instanceof ValidationError) return sendJson(response, 400, { error: error.message })
    if (error instanceof NotFoundError) return sendJson(response, 404, { error: error.message })
    console.error('Content API error.', error)
    sendJson(response, 503, { error: 'Content storage is unavailable. Try again shortly.' })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Simplest listening on port ${port} (content store: ${store.kind}; Glean sync: ${glean ? glean.datasource : 'off'})`)
  retryFailedSyncs()
})
