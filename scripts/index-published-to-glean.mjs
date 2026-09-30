import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contentItems } from '../content.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '../..')
const envPath = resolve(projectDirectory, '.env')

function parseEnv(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function required(config, key) {
  const value = config[key]?.trim()
  if (!value) throw new Error(`Missing ${key} in ${envPath}`)
  return value
}

async function main() {
  let fileConfig
  try {
    fileConfig = parseEnv(readFileSync(envPath, 'utf8'))
  } catch {
    throw new Error(`Could not read local config at ${envPath}`)
  }
  const config = { ...fileConfig, ...process.env }
  const apiUrl = new URL(required(config, 'GLEAN_API_URL'))
  if (apiUrl.protocol !== 'https:') throw new Error('GLEAN_API_URL must use HTTPS.')
  const apiBase = apiUrl.href.replace(/\/+$/, '')
  const token = required(config, 'GLEAN_INDEXING_API_TOKEN')
  const datasourceName = required(config, 'GLEAN_DATASOURCE_NAME')
  const displayName = required(config, 'GLEAN_DATASOURCE_DISPLAY_NAME')
  const category = required(config, 'GLEAN_DATASOURCE_CATEGORY')
  const urlRegex = required(config, 'GLEAN_DOCUMENT_URL_REGEX')
  const baseUrl = required(config, 'SIMPLEST_BASE_URL').replace(/\/+$/, '')
  const emails = required(config, 'GLEAN_ALLOWED_USERS').split(',').map(value => value.trim()).filter(Boolean)
  const isTestDatasource = config.GLEAN_IS_TEST_DATASOURCE?.trim().toLowerCase() === 'true'

  if (!isTestDatasource) throw new Error('Set GLEAN_IS_TEST_DATASOURCE=true before using the sandbox datasource.')
  if (!emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('GLEAN_ALLOWED_USERS must contain one or more valid email addresses.')
  }
  const urlPattern = new RegExp(urlRegex)
  const publishedItems = contentItems.filter(item => item.status === 'published')
  if (!publishedItems.length) throw new Error('No published content was found.')

  async function post(endpoint, body) {
    const response = await fetch(`${apiBase}/api/index/v1/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const responseText = await response.text()
    let responseBody = null
    try { responseBody = responseText ? JSON.parse(responseText) : null } catch { responseBody = null }
    if (!response.ok) {
      const details = responseBody?.detail || responseBody?.message || responseBody?.title || responseBody?.error || responseText || `HTTP ${response.status}`
      const safeDetails = String(typeof details === 'object' ? JSON.stringify(details) : details).replaceAll(token, '[redacted]').slice(0, 1200)
      throw new Error(`${endpoint} failed (HTTP ${response.status}): ${safeDetails}`)
    }
    return responseBody
  }

  if (process.argv.includes('--inspect-config')) {
    const current = await post('getdatasourceconfig', { datasource: datasourceName })
    const searchVisibilityFields = Object.fromEntries(Object.entries(current).filter(([key, value]) =>
      /search|enabled|visibility/i.test(key) && (value === null || ['string', 'boolean', 'number'].includes(typeof value))))
    console.log(JSON.stringify({
      name: current.name,
      displayName: current.displayName,
      urlRegex: current.urlRegex,
      datasourceCategory: current.datasourceCategory,
      isTestDatasource: current.isTestDatasource,
      searchVisibilityFields,
      objectDefinitions: current.objectDefinitions,
    }, null, 2))
    return
  }

  if (process.argv.includes('--process-now')) {
    await post(`processalldocuments?datasource=${encodeURIComponent(datasourceName)}`)
    console.log(`Immediate processing requested for datasource ${datasourceName}. Check status again after processing begins.`)
    return
  }

  const debugDocArg = process.argv.find(argument => argument.startsWith('--debug-document='))
  if (debugDocArg) {
    const docId = debugDocArg.slice('--debug-document='.length)
    if (!publishedItems.some(item => item.id === docId)) throw new Error(`Unknown published content ID: ${docId}`)
    const response = await post(`debug/${datasourceName}/document`, { objectType: 'Document', docId })
    const documentStatus = response.documentStatus || response.debugInfo?.status || response.status || null
    console.log(JSON.stringify({ docId, responseFields: Object.keys(response), documentStatus }, null, 2))
    return
  }

  const eventArg = process.argv.find(argument => argument.startsWith('--check-events='))
  if (eventArg) {
    const docId = eventArg.slice('--check-events='.length)
    if (!publishedItems.some(item => item.id === docId)) throw new Error(`Unknown published content ID: ${docId}`)
    const events = await post(`debug/${datasourceName}/document/events`, { objectType: 'Document', docId })
    console.log(JSON.stringify({ docId, events }, null, 2))
    return
  }

  if (process.argv.includes('--check-status')) {
    const datasourceStatusPromise = post(`debug/${datasourceName}/status`)
    const documentDetails = []
    for (let index = 0; index < publishedItems.length; index += 1) {
      if (index > 0) await new Promise(resolve => setTimeout(resolve, 1100))
      const item = publishedItems[index]
      documentDetails.push(await post(`debug/${datasourceName}/document`, {
        objectType: 'Document',
        docId: item.id,
      }))
    }
    const datasourceDebug = await datasourceStatusPromise
    const documentStatuses = documentDetails.map((response, index) => {
      const state = response.status || response.documentStatus || response.debugInfo?.status || {}
      return {
        docId: publishedItems[index].id,
        objectType: 'Document',
        uploadStatus: state.uploadStatus || 'UNKNOWN',
        indexingStatus: state.indexingStatus || state.indexStatus || 'UNKNOWN',
        debugState: state,
        lastUploadedAt: state.lastUploadedAt || state.uploadTime || null,
        lastIndexedAt: state.lastIndexedAt || state.indexTime || null,
      }
    })
    const searchVisibilityFields = Object.fromEntries(Object.entries(datasourceDebug).filter(([key, value]) =>
      /search|enabled|visibility/i.test(key) && (value === null || ['string', 'boolean', 'number'].includes(typeof value))))
    console.log(JSON.stringify({
      searchVisibilityFields,
      datasourceStatusFields: Object.keys(datasourceDebug).sort(),
      documentStatuses,
      bulkUploadHistory: datasourceDebug.documents?.bulkUploadHistory || [],
      documentProcessingHistory: datasourceDebug.documents?.processingHistory || [],
      documentCounts: datasourceDebug.documents?.counts || null,
    }, null, 2))
    return
  }

  // Removes every bundled Simplest document from the Glean index. CMS/Firestore content is not touched.
  if (process.argv.includes('--delete-all')) {
    const ids = [...new Set(contentItems.map(item => item.id))]
    const failed = []
    for (let index = 0; index < ids.length; index += 1) {
      if (index > 0) await new Promise(resolve => setTimeout(resolve, 1100))
      try {
        await post('deletedocument', { datasource: datasourceName, objectType: 'Document', id: ids[index] })
      } catch (error) {
        failed.push(`${ids[index]}: ${error.message}`)
      }
    }
    console.log(`Delete requested for ${ids.length - failed.length} of ${ids.length} documents in ${datasourceName}. Removal from search is asynchronous.`)
    if (failed.length) {
      console.log(`Failed:\n${failed.join('\n')}`)
      process.exitCode = 1
    }
    return
  }

  if (process.argv.includes('--dry-run')) {
    for (const item of publishedItems) {
      const viewUrl = new URL(`${baseUrl}/`)
      viewUrl.searchParams.set('doc', item.id)
      if (!urlPattern.test(viewUrl.href)) throw new Error(`The URL pattern does not match a page URL for ${item.id}.`)
    }
    console.log(`Dry run OK. Glean host: ${apiUrl.host}; datasource: ${datasourceName}; test datasource: yes.`)
    console.log(`Allowed user count: ${emails.length}; published resources to index: ${publishedItems.length}.`)
    return
  }

  await post('adddatasource', {
    name: datasourceName,
    displayName,
    datasourceCategory: category,
    urlRegex,
    objectDefinitions: [{ name: 'Document', docCategory: category }],
    isUserReferencedByEmail: true,
    isTestDatasource: true,
  })
  console.log('Datasource created or updated as a test datasource.')

  await post('betausers', { datasource: datasourceName, emails })
  console.log(`Registered ${emails.length} beta user(s) for the test datasource.`)

  const documents = publishedItems.map(item => {
    const viewUrl = new URL(`${baseUrl}/`)
    viewUrl.searchParams.set('doc', item.id)
    if (!urlPattern.test(viewUrl.href)) throw new Error(`The URL pattern does not match a page URL for ${item.id}.`)
    const textContent = [
      item.summary,
      `Content type: ${item.type}`,
      `Content owner: ${item.owner}`,
      `Audience: ${item.audience}`,
      `Review date: ${item.reviewDate}`,
      item.body,
    ].filter(Boolean).join('\n\n')
    return {
      datasource: datasourceName,
      objectType: 'Document',
      id: item.id,
      title: item.title,
      body: { mimeType: 'text/plain', textContent },
      viewURL: viewUrl.href,
      // The sandbox datasource is enabled for all users; anonymous access is intentional.
      permissions: { allowAnonymousAccess: true },
    }
  })

  await post('bulkindexdocuments', {
    uploadId: `simplest-${Date.now()}`,
    isFirstPage: true,
    isLastPage: true,
    forceRestartUpload: true,
    datasource: datasourceName,
    documents,
  })
  console.log(`Done. Submitted ${documents.length} published employee resources in a test-datasource refresh. Indexing is asynchronous.`)
}

main().catch(error => {
  console.error(`Simplest indexing stopped: ${error.message}`)
  process.exitCode = 1
})
