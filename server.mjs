import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ValidationError, isValidId, validateEdit } from './lib/content-model.mjs'
import { NotFoundError, createStore } from './lib/store.mjs'

const siteRoot = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.PORT || 8080)
const store = createStore()

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
    return sendJson(response, 200, { item: await store.save(id, fields) })
  }
  if (action === 'publish' && request.method === 'POST') {
    checkWriteRate(request)
    return sendJson(response, 200, { item: await store.publish(id) })
  }
  throw new HttpError(405, 'Method not allowed.')
}

async function serveFile(request, response, pathname) {
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
  const body = await readFile(resolve(siteRoot, `.${pathname}`))
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
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname)
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Bad request\n')
    return
  }

  const isApi = pathname === '/api' || pathname.startsWith('/api/')
  try {
    if (isApi) await handleApi(request, response, pathname)
    else await serveFile(request, response, pathname)
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
  console.log(`Simplest listening on port ${port} (content store: ${store.kind})`)
})
