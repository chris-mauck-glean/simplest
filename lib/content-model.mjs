export const CONTENT_TYPES = ['Policy', 'Guide', 'Checklist', 'FAQ', 'Announcement', 'Newsletter']
export const AUDIENCES = [
  'All employees', 'New employees', 'People managers', 'Office employees',
  'Frequent travelers', 'Department leaders',
]
export const STATUSES = ['draft', 'published']

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const LIMITS = { title: 120, summary: 240, body: 20000, owner: 80 }

export class ValidationError extends Error {}

export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

function text(value, field, { required = false } = {}) {
  if (value === undefined || value === null) value = ''
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text.`)
  const trimmed = value.trim()
  if (required && !trimmed) throw new ValidationError(`${field} is required.`)
  if (trimmed.length > LIMITS[field]) throw new ValidationError(`${field} must be ${LIMITS[field]} characters or fewer.`)
  return trimmed
}

function isRealDate(value) {
  if (!DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// Validates an editor save. The server, not the browser, sets status timestamps.
export function validateEdit(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Request body must be a JSON object.')
  const type = input.type ?? 'Policy'
  const audience = input.audience ?? 'All employees'
  const status = input.status ?? 'draft'
  const reviewDate = input.reviewDate ?? ''
  if (!CONTENT_TYPES.includes(type)) throw new ValidationError('type is not supported.')
  if (!AUDIENCES.includes(audience)) throw new ValidationError('audience is not supported.')
  if (!STATUSES.includes(status)) throw new ValidationError('status must be draft or published.')
  if (typeof reviewDate !== 'string' || (reviewDate && !isRealDate(reviewDate))) throw new ValidationError('reviewDate must be YYYY-MM-DD.')
  return {
    title: text(input.title, 'title', { required: true }),
    type,
    summary: text(input.summary, 'summary'),
    body: text(input.body, 'body'),
    audience,
    owner: text(input.owner, 'owner') || 'Unassigned',
    status,
    reviewDate,
  }
}

// Only the fields the UI needs; internal bookkeeping stays on the server.
export function toPublicItem(id, data) {
  return {
    id,
    title: data.title,
    type: data.type,
    summary: data.summary || '',
    body: data.body || '',
    audience: data.audience,
    owner: data.owner || 'Unassigned',
    status: STATUSES.includes(data.status) ? data.status : 'draft', // legacy 'in-review' reads as draft
    updatedAt: data.updatedAt || '',
    reviewDate: data.reviewDate || '',
  }
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}
