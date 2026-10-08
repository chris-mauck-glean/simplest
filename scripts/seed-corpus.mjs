// Generates the demo content corpus (policies, guides, FAQs, checklists, announcements, newsletters)
// and creates it in Firestore. Existing documents are never overwritten. Generated items carry
// `generated: 'corpus-v1'` so they can be found or removed later.
// Usage (from the simplest folder, with Application Default Credentials):
//   FIRESTORE_DATABASE=simplest GOOGLE_CLOUD_PROJECT=salessavvy-test node scripts/seed-corpus.mjs [--dry-run]
import { topics as workplaceTopics } from './corpus/topics.mjs'
import { regulatoryTopics } from './corpus/regulatory-topics.mjs'
import { announcements } from './corpus/announcements.mjs'
import { validateEdit } from '../lib/content-model.mjs'

const BATCH = 'corpus-v1'
const topics = [...workplaceTopics, ...regulatoryTopics]
const LATEST_DATE = '2026-09-28'

// Deterministic randomness so reruns produce the same corpus.
let seed = 20261007
function random() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = list => list[Math.floor(random() * list.length)]

const DAY = 86400000
const toDate = value => new Date(`${value}T16:00:00Z`) // noon US Eastern
const iso = date => date.toISOString().slice(0, 10)
const addDays = (value, days) => iso(new Date(toDate(value).getTime() + days * DAY))
const randomDate = (from, to) => iso(new Date(toDate(from).getTime() + random() * (toDate(to) - toDate(from))))
const lowerFirst = text => (/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text)
const slugify = text => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/, '')
const bullets = lines => lines.map(line => `• ${line}`).join('\n')

const AUDIENCE_TEXT = {
  'All employees': 'all employees and contractors',
  'New employees': 'employees in their first 90 days',
  'People managers': 'people managers and the employees they support',
  'Office employees': 'employees who work from a company office',
  'Frequent travelers': 'employees who travel for business',
  'Department leaders': 'department leaders and budget owners',
}

const guideTitle = (topic, i) => [`${topic.name}: a practical guide`, `A guide to ${lowerFirst(topic.name)}`, `${topic.name}: how it works`][i % 3]
const faqTitle = (topic, i) => [`${topic.name}: frequently asked questions`, `${topic.name} FAQ`, `Questions about ${lowerFirst(topic.name)}`][i % 3]
const checklistTitle = (topic, i) => [`${topic.name} checklist`, `${topic.name}: quick checklist`][i % 2]
const policyTitle = topic => (/conduct|guidelines|protection/i.test(topic.name) ? topic.name : `${topic.name} policy`)

function policyDoc(topic) {
  return {
    id: `${topic.slug}-policy`, type: 'Policy', title: policyTitle(topic),
    summary: `Company policy on ${topic.about}.`,
    body: [
      `PURPOSE\nThis policy sets the rules for ${topic.about}. It helps everyone act consistently and fairly.`,
      `SCOPE\nThis policy applies to ${AUDIENCE_TEXT[topic.audience]}.`,
      `POLICY\n${bullets(topic.rules)}`,
      `RESPONSIBILITIES\n${bullets(['Employees follow this policy and ask questions when something is unclear.', 'Managers explain the policy to their teams and apply it consistently.', `${topic.owner} maintains this policy and reviews it at least once a year.`])}`,
      `EXCEPTIONS\nExceptions require written approval from ${topic.owner} before you act.`,
      `RELATED RESOURCES\nSee the ${lowerFirst(topic.name)} guide, FAQ, and checklist for practical help.`,
      `QUESTIONS\nContact ${topic.owner} through the help channel.`,
    ].join('\n\n'),
  }
}

function guideDoc(topic, i) {
  const steps = topic.steps.map((step, n) => `${n + 1}. ${step}`).join('\n')
  return {
    id: `${topic.slug}-guide`, type: 'Guide', title: guideTitle(topic, i),
    summary: `Step-by-step help with ${topic.about}.`,
    body: [
      `OVERVIEW\nThis guide explains ${topic.about}, and what to do at each step.`,
      `KEY POINTS\n${bullets(topic.rules.slice(0, 3))}`,
      `STEP BY STEP\n${steps}`,
      `GOOD TO KNOW\n${bullets(topic.rules.slice(3))}`,
      `COMMON QUESTIONS\n${topic.faqs.slice(0, 2).map(([q, a]) => `${q}\n${a}`).join('\n\n')}`,
      `GET HELP\nContact ${topic.owner} if your situation is not covered here.`,
    ].join('\n\n'),
  }
}

function faqDoc(topic, i) {
  const extra = [
    [`Who owns the ${lowerFirst(topic.name)} policy?`, `${topic.owner} owns the policy and keeps it current.`],
    ['What is the most important rule to remember?', topic.rules[0]],
  ]
  return {
    id: `${topic.slug}-faq`, type: 'FAQ', title: faqTitle(topic, i),
    summary: `Answers to common questions about ${topic.about}.`,
    body: [
      `ABOUT THIS FAQ\nThese answers cover the questions employees ask most often about ${topic.about}.`,
      ...[...topic.faqs, ...extra].map(([q, a]) => `${q}\n${a}`),
      `STILL HAVE QUESTIONS?\nContact ${topic.owner}. For full details, read the ${lowerFirst(topic.name)} policy.`,
    ].join('\n\n'),
  }
}

function checklistDoc(topic, i) {
  return {
    id: `${topic.slug}-checklist`, type: 'Checklist', title: checklistTitle(topic, i),
    summary: `A short checklist for ${topic.about}.`,
    body: [
      `USE THIS CHECKLIST\nWork through these items in order. Each one links to the ${lowerFirst(topic.name)} guide for details.`,
      `CHECKLIST\n${bullets(topic.checks)}`,
      `REMEMBER\n${bullets(topic.rules.slice(0, 2))}`,
      `NEED HELP?\nContact ${topic.owner}.`,
    ].join('\n\n'),
  }
}

const REVIEW_DAYS = { Policy: 365, Guide: 270, FAQ: 180, Checklist: 180, Announcement: 90, Newsletter: 60 }
const items = []

topics.forEach((topic, i) => {
  // Policies are older and more stable; how-to content changes more often.
  const policyDate = randomDate('2025-01-10', '2026-06-30')
  for (const [doc, date] of [
    [policyDoc(topic), policyDate],
    [guideDoc(topic, i), randomDate(policyDate, LATEST_DATE)],
    [faqDoc(topic, i), randomDate(policyDate, LATEST_DATE)],
    [checklistDoc(topic, i), randomDate(policyDate, LATEST_DATE)],
  ]) items.push({ ...doc, owner: topic.owner, audience: topic.audience, updatedAt: date, topic: topic.slug })
})

const topicBySlug = new Map(topics.map(topic => [topic.slug, topic]))
for (const [date, title, owner, audience, summary, paragraphs, related] of [...announcements].sort((a, b) => a[0].localeCompare(b[0]))) {
  const topic = topicBySlug.get(related)
  const body = [...paragraphs, topic ? `RELATED\nSee the ${lowerFirst(topic.name)} guide and FAQ on Simplest for details.` : ''].filter(Boolean).join('\n\n')
  items.push({ id: slugify(title), type: 'Announcement', title, summary, body, owner, audience, updatedAt: date })
}

// Monthly newsletters, October 2024 through September 2026, built from that month's announcements and updates.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
for (let index = 0; index < 24; index += 1) {
  const year = 2024 + Math.floor((9 + index) / 12)
  const month = (9 + index) % 12
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const date = `${prefix}-${month === 8 && year === 2026 ? '28' : '27'}`
  const news = announcements.filter(([d]) => d.startsWith(prefix))
  const updated = items.filter(item => item.topic && item.updatedAt.startsWith(prefix)).slice(0, 4)
  const spotlight = pick(topics)
  const label = `${MONTHS[month]} ${year}`
  items.push({
    id: `newsletter-${prefix}`, type: 'Newsletter', title: `${label} employee newsletter`,
    summary: `News, updated resources, and a spotlight on ${lowerFirst(spotlight.name)} for ${label}.`,
    owner: 'Communications', audience: 'All employees', updatedAt: date,
    body: [
      `THIS MONTH\nHere is what happened across the company in ${label}, and what to know for next month.`,
      `HEADLINES\n${bullets(news.map(([, t, , , s]) => `${t}: ${s}`))}`,
      updated.length ? `UPDATED RESOURCES\n${bullets(updated.map(item => `${item.title} (${item.owner})`))}` : '',
      `SPOTLIGHT: ${spotlight.name.toUpperCase()}\nThis month we look at ${spotlight.about}. ${spotlight.rules[0]} ${spotlight.rules[1]} Read the ${lowerFirst(spotlight.name)} guide on Simplest to learn more.`,
      `SHARE YOUR NEWS\nHave an update for next month? Send it to Communications by the 20th.`,
    ].filter(Boolean).join('\n\n'),
  })
}

// A handful of drafts make the editorial queue realistic; drafts are never sent to search.
const draftIds = new Set()
while (draftIds.size < 8) draftIds.add(pick(items.filter(item => item.topic)).id)

for (const item of items) {
  item.status = draftIds.has(item.id) ? 'draft' : 'published'
  item.reviewDate = addDays(item.updatedAt, REVIEW_DAYS[item.type])
}

// Validate every item with the same rules as the API, and check ids are unique.
const ids = new Set()
for (const item of items) {
  if (ids.has(item.id)) throw new Error(`Duplicate id: ${item.id}`)
  ids.add(item.id)
  validateEdit(item)
}

const byType = {}
for (const item of items) byType[item.type] = (byType[item.type] || 0) + 1
console.log(`Generated ${items.length} items (${items.length - draftIds.size} published, ${draftIds.size} drafts): ${JSON.stringify(byType)}`)
const lengths = items.map(item => item.body.length).sort((a, b) => a - b)
console.log(`Body length: min ${lengths[0]}, median ${lengths[Math.floor(lengths.length / 2)]}, max ${lengths.at(-1)}`)

if (process.argv.includes('--dry-run')) {
  const sample = items.find(item => item.type === process.argv[process.argv.indexOf('--dry-run') + 1]) || items[1]
  console.log(`\nSample (${sample.type}): ${sample.title}\n${sample.summary}\n\n${sample.body}`)
  process.exit(0)
}

if (!process.env.FIRESTORE_DATABASE) throw new Error('Set FIRESTORE_DATABASE (for example, simplest).')
const { Firestore } = await import('@google-cloud/firestore')
const db = new Firestore({ databaseId: process.env.FIRESTORE_DATABASE, projectId: process.env.GOOGLE_CLOUD_PROJECT, ignoreUndefinedProperties: true })
const collection = db.collection('content')
const existing = new Set((await collection.select().get()).docs.map(doc => doc.id))

let created = 0
let skipped = 0
const writer = db.bulkWriter()
for (const { topic, ...item } of items) {
  if (existing.has(item.id)) { skipped += 1; continue }
  const { id, ...fields } = item
  const updatedAtTime = toDate(item.updatedAt)
  const createdAt = new Date(updatedAtTime.getTime() - Math.floor(random() * 45) * DAY)
  writer.create(collection.doc(id), { ...fields, deleted: false, revision: 1, generated: BATCH, createdAt, updatedAtTime })
  created += 1
}
await writer.close()
console.log(`Firestore ${process.env.FIRESTORE_DATABASE}: ${created} created, ${skipped} skipped (already present).`)
