import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const siteRoot = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.PORT || 8080)

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

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, {
      Allow: 'GET, HEAD',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end('Method not allowed\n')
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname)
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Bad request\n')
    return
  }

  if (pathname === '/') pathname = '/index.html'
  const contentType = publicFiles.get(pathname)
  if (!contentType) {
    response.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end('Not found\n')
    return
  }

  try {
    const filePath = resolve(siteRoot, `.${pathname}`)
    const body = await readFile(filePath)
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': body.byteLength,
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch (error) {
    if (error.code === 'ENOENT') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found\n')
      return
    }

    console.error('Could not serve site file.', error)
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Internal server error\n')
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Simplest listening on port ${port}`)
})
