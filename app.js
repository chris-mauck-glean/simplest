import { contentItems } from './content.mjs'

(() => {
  'use strict'

  const LEGACY_STORAGE_KEY = 'simplest-demo-content-v1'
  const STORAGE_KEY = 'simplest-employee-content-v2'
  const demoDate = '2026-09-30'
  const app = document.getElementById('app')
  const previewDialog = document.getElementById('preview-dialog')
  const previewContent = document.getElementById('preview-content')
  const editorDialog = document.getElementById('editor-dialog')
  const editorForm = document.getElementById('editor-form')
  const searchInput = document.getElementById('global-search')
  const state = { view: 'home', status: 'all', search: '', selectedId: null, toastTimer: null }

  function safeStorageGet() {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) return parsed
      }
    } catch (error) {
      console.warn('Simplest could not read local storage; using bundled content.', error)
    }
    return contentItems.map(item => ({ ...item }))
  }

  let items = safeStorageGet()

  function saveItems() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch (error) {
      showToast('This browser could not save changes. The page will still work for this session.')
      console.warn('Simplest could not save local data.', error)
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character])
  }

  function humanDate(value) {
    if (!value) return 'Not set'
    const date = new Date(`${value}T12:00:00`)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
  }

  function statusLabel(status) {
    return ({ published: 'Published', draft: 'Draft', 'in-review': 'In review' })[status] || 'Draft'
  }

  function statusClass(status) {
    return ({ published: 'status-published', draft: 'status-draft', 'in-review': 'status-in-review' })[status] || 'status-draft'
  }

  function typeIcon(type) {
    return ({ Policy: '▤', Guide: '↗', Checklist: '✓', FAQ: '?', Announcement: '↗', Newsletter: '✉', 'Community update': '◎' })[type] || '▤'
  }

  function isOverdue(item) {
    return item.status !== 'published' && item.reviewDate && item.reviewDate < demoDate
  }

  function routeItems() {
    let results = [...items]
    if (state.view === 'newsletters') results = results.filter(item => ['Newsletter', 'Announcement'].includes(item.type))
    if (state.view === 'communities') results = results.filter(item => item.type === 'Community update')
    if (state.view === 'content') results = results.filter(item => !['Newsletter', 'Announcement', 'Community update'].includes(item.type))
    if (state.status !== 'all') results = results.filter(item => item.status === state.status)
    if (state.search.trim()) {
      const query = state.search.trim().toLowerCase()
      results = results.filter(item => [item.title, item.type, item.summary, item.owner, item.audience, item.body].join(' ').toLowerCase().includes(query))
    }
    return results.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  }

  function itemRow(item, compact = false) {
    const detail = `${escapeHtml(item.type)} · ${escapeHtml(item.owner || 'Unassigned')} · ${escapeHtml(item.audience || 'All employees')}`
    if (compact) {
      return `<div class="content-row" role="button" tabindex="0" data-open="${escapeHtml(item.id)}"><span class="doc-icon" aria-hidden="true">${typeIcon(item.type)}</span><span class="doc-copy"><strong>${escapeHtml(item.title)}</strong><small>${detail}</small></span><span class="row-end"><span class="status-pill ${statusClass(item.status)}">${statusLabel(item.status)}</span></span></div>`
    }
    return `<tr data-open="${escapeHtml(item.id)}" tabindex="0"><td><span class="table-title"><span class="doc-icon" aria-hidden="true">${typeIcon(item.type)}</span><strong>${escapeHtml(item.title)}</strong></span></td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.audience || 'All employees')}</td><td>${escapeHtml(item.owner || 'Unassigned')}</td><td><span class="status-pill ${statusClass(item.status)}">${statusLabel(item.status)}</span></td><td>${humanDate(item.updatedAt)}</td></tr>`
  }

  function header(eyebrow, title, description, createLabel = 'Create content') {
    return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subheading">${description}</p></div><button class="button button-primary" type="button" data-action="create"><span class="plus">＋</span>${createLabel}</button></div>`
  }

  function statCard(label, value, helper, icon) {
    return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon" aria-hidden="true">${icon}</span></div><div class="stat-value">${value}</div><span class="stat-helper">${helper}</span></article>`
  }

  function renderHome() {
    const published = items.filter(item => item.status === 'published').length
    const inReview = items.filter(item => item.status === 'in-review').length
    const drafts = items.filter(item => item.status === 'draft').length
    const attention = items.filter(item => item.status === 'in-review' || isOverdue(item)).sort((a, b) => (a.reviewDate || '').localeCompare(b.reviewDate || '')).slice(0, 3)
    const recent = [...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 4)
    const attentionMarkup = attention.length ? attention.map(item => `<div class="attention-item"><i class="attention-marker ${isOverdue(item) ? 'overdue' : ''}"></i><div><strong>${escapeHtml(item.title)}</strong><small>${isOverdue(item) ? `Review date passed · ${humanDate(item.reviewDate)}` : `Waiting for review · ${humanDate(item.updatedAt)}`}</small></div></div>`).join('') : '<div class="empty-message">Nothing needs attention right now.</div>'
    app.innerHTML = `${header('CONTENT OPERATIONS', 'Content overview', 'Create clear, trusted information—and keep it current.')}<section class="stats-grid">${statCard('Published pages', published, 'Available to employees', '▤')}${statCard('In review', inReview, 'Waiting for an owner', '◷')}${statCard('Drafts', drafts, 'Work in progress', '✎')}${statCard('Needs attention', attention.length, 'Review or publish next', '↗')}</section><div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Recently updated</h2><p>Latest changes across your content</p></div><button class="text-link" type="button" data-view="content">View all content <span aria-hidden="true">→</span></button></div><div class="content-list">${recent.map(item => itemRow(item, true)).join('')}</div></section><div class="side-stack"><section class="panel attention-panel"><div class="panel-heading"><div><h2>Review queue</h2><p>Keep useful content up to date</p></div><span class="status-pill status-in-review">${attention.length} items</span></div>${attentionMarkup}</section><section class="panel integration-card"><span class="integration-label">GLEAN SANDBOX INDEX</span><h3>Published resources are indexed</h3><p>The employee resource library is searchable in the sandbox. New local edits require a manual index refresh.</p><span class="integration-state"><i></i> All sandbox users · manual refresh</span></section></div></div><section class="panel library-panel"><div class="panel-heading"><div><h2>Content library</h2><p>A quick view of pages, newsletters, and community updates</p></div><button class="text-link" type="button" data-view="content">Open library <span aria-hidden="true">→</span></button></div>${renderTable(recent)}</section>`
  }

  function statusTabs(current) {
    const tabs = [['all', 'All'], ['draft', 'Drafts'], ['in-review', 'In review'], ['published', 'Published']]
    return tabs.map(([key, label]) => `<button type="button" class="filter-tab ${current === key ? 'active' : ''}" data-status="${key}">${label}</button>`).join('')
  }

  function renderTable(rows) {
    if (!rows.length) return '<div class="table-empty">No content matches these filters. Try another search or create a page.</div>'
    return `<div class="table-wrap"><table><thead><tr><th>CONTENT</th><th>TYPE</th><th>AUDIENCE</th><th>OWNER</th><th>STATUS</th><th>UPDATED</th></tr></thead><tbody>${rows.map(item => itemRow(item)).join('')}</tbody></table></div>`
  }

  function renderLibrary() {
    const names = {
      content: ['PAGES & GUIDES', 'Pages & guidance', 'Find current policies, how-to guides, and employee resources.', 'Create page'],
      newsletters: ['EMPLOYEE COMMUNICATIONS', 'Newsletters', 'Prepare employee updates from clear, current source content.', 'Create newsletter'],
      communities: ['COMMUNITY CONTENT', 'Communities', 'Keep community updates and ideas organized for review.', 'Create update'],
    }
    const [eyebrow, title, description, createLabel] = names[state.view]
    const rows = routeItems()
    app.innerHTML = `${header(eyebrow, title, description, createLabel)}<section class="panel"><div class="panel-heading"><div><h2>${rows.length} ${rows.length === 1 ? 'item' : 'items'}</h2><p>Choose an item to view its details or edit it.</p></div></div><div class="library-toolbar">${statusTabs(state.status)}<div class="status-filter-bar"><span class="filter-tab">${state.search ? `Search: “${escapeHtml(state.search)}”` : 'Employee experience'}</span></div></div>${renderTable(rows)}</section>`
  }

  function renderInsights() {
    const published = items.filter(item => item.status === 'published').length
    const inReview = items.filter(item => item.status === 'in-review').length
    app.innerHTML = `${header('CONTENT PERFORMANCE', 'Insights', 'Track publishing activity, content freshness, and employee engagement.', 'Create content')}<div class="insights-grid"><article class="insight-stat"><span>Page views this month</span><strong>2,418</strong><small>↗ 12% vs. last month</small></article><article class="insight-stat"><span>Newsletter opens</span><strong>68%</strong><small>↗ 4 pts vs. last month</small></article><article class="insight-stat"><span>Published content</span><strong>${published}</strong><small>${inReview} awaiting review</small></article></div><section class="panel chart-panel"><div class="panel-heading"><div><h2>Content engagement</h2><p>Monthly page engagement</p></div><span class="integration-state"><i></i> Illustrative data</span></div><div class="chart-area" role="img" aria-label="Illustrative bar chart showing content engagement from April to September"><div class="chart-column"><div class="chart-bar" style="height:35%"></div><small>Apr</small></div><div class="chart-column"><div class="chart-bar" style="height:52%"></div><small>May</small></div><div class="chart-column"><div class="chart-bar" style="height:44%"></div><small>Jun</small></div><div class="chart-column"><div class="chart-bar" style="height:69%"></div><small>Jul</small></div><div class="chart-column"><div class="chart-bar" style="height:61%"></div><small>Aug</small></div><div class="chart-column"><div class="chart-bar emphasis" style="height:84%"></div><small>Sep</small></div></div><p class="chart-caption">Engagement figures are illustrative and do not update from live page views, newsletter opens, or clicks.</p></section><p class="insight-note"><strong>Product boundary:</strong> This page represents CMS-side engagement reporting. Glean Insights would show Glean usage and search/AI activity separately.</p>`
  }

  function render() {
    document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === state.view))
    const labels = { home: 'Overview', content: 'Pages & guidance', newsletters: 'Newsletters', communities: 'Communities', insights: 'Insights' }
    document.getElementById('breadcrumb-current').textContent = labels[state.view] || 'Overview'
    document.getElementById('nav-content-count').textContent = items.length
    if (state.view === 'home') renderHome()
    else if (state.view === 'insights') renderInsights()
    else renderLibrary()
  }

  function openPreview(id, updateUrl = true) {
    const item = items.find(entry => entry.id === id)
    if (!item) return
    state.selectedId = id
    if (updateUrl) {
      const url = new URL(window.location.href)
      url.searchParams.set('doc', item.id)
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
    previewContent.innerHTML = `<div class="preview-header"><div><p class="eyebrow">${escapeHtml(item.type.toUpperCase())} · ${escapeHtml(item.owner || 'UNASSIGNED')}</p><h2 id="preview-title">${escapeHtml(item.title)}</h2><p class="preview-summary">${escapeHtml(item.summary || 'No summary added yet.')}</p></div><button type="button" class="close-button" data-action="close-preview" aria-label="Close">×</button></div><div class="preview-metadata"><div><span>Status</span><strong><i class="status-pill ${statusClass(item.status)}">${statusLabel(item.status)}</i></strong></div><div><span>Audience</span><strong>${escapeHtml(item.audience || 'All employees')}</strong></div><div><span>Updated</span><strong>${humanDate(item.updatedAt)}</strong></div><div><span>Review by</span><strong>${humanDate(item.reviewDate)}</strong></div></div><div class="preview-body">${escapeHtml(item.body || 'No content added yet.')}</div><div class="preview-footer"><button type="button" class="button button-quiet" data-action="close-preview">Close</button><span class="action-spacer"></span>${item.status !== 'published' ? '<button type="button" class="button button-outline" data-action="publish" data-id="' + escapeHtml(item.id) + '">Publish page</button>' : ''}<button type="button" class="button button-primary" data-action="edit" data-id="${escapeHtml(item.id)}">Edit content</button></div><p class="preview-disclaimer">Local preview. Changes stay in this browser and do not update the Glean index automatically.</p>`
    if (!previewDialog.open) previewDialog.showModal()
  }

  function clearPreviewUrl() {
    const url = new URL(window.location.href)
    url.searchParams.delete('doc')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function closePreview() {
    if (previewDialog.open) previewDialog.close()
    clearPreviewUrl()
  }

  previewDialog.addEventListener('cancel', clearPreviewUrl)

  function openEditor(id = null) {
    const item = id ? items.find(entry => entry.id === id) : null
    editorForm.reset()
    editorForm.elements.id.value = item ? item.id : ''
    editorForm.elements.title.value = item ? item.title : ''
    editorForm.elements.type.value = item ? item.type : (state.view === 'newsletters' ? 'Newsletter' : state.view === 'communities' ? 'Community update' : 'Policy')
    editorForm.elements.audience.value = item ? item.audience : 'All employees'
    editorForm.elements.summary.value = item ? item.summary : ''
    editorForm.elements.body.value = item ? item.body : ''
    editorForm.elements.owner.value = item ? item.owner : ''
    editorForm.elements.reviewDate.value = item ? item.reviewDate : ''
    document.getElementById('editor-title').textContent = item ? 'Edit content' : 'Create content'
    if (previewDialog.open) closePreview()
    editorDialog.showModal()
    editorForm.elements.title.focus()
  }

  function showToast(message) {
    document.querySelector('.toast')?.remove()
    const toast = document.createElement('div')
    toast.className = 'toast'
    toast.setAttribute('role', 'status')
    toast.innerHTML = `<i>✓</i><span>${escapeHtml(message)}</span>`
    document.body.appendChild(toast)
    window.clearTimeout(state.toastTimer)
    state.toastTimer = window.setTimeout(() => toast.remove(), 3400)
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-view]')
    if (nav) {
      state.view = nav.dataset.view
      state.status = 'all'
      render()
      return
    }
    const statusButton = event.target.closest('[data-status]')
    if (statusButton) {
      state.status = statusButton.dataset.status
      render()
      return
    }
    const row = event.target.closest('[data-open]')
    if (row && !event.target.closest('button')) {
      openPreview(row.dataset.open)
      return
    }
    const action = event.target.closest('[data-action]')
    if (!action) return
    if (action.dataset.action === 'create') openEditor()
    if (action.dataset.action === 'edit') openEditor(action.dataset.id)
    if (action.dataset.action === 'close-editor') editorDialog.close()
    if (action.dataset.action === 'close-preview') closePreview()
    if (action.dataset.action === 'publish') {
      const item = items.find(entry => entry.id === action.dataset.id)
      if (!item) return
      item.status = 'published'
      item.updatedAt = new Date().toISOString().slice(0, 10)
      saveItems()
      render()
      showToast('Published in Simplest. Browser changes are not included in the Glean index automatically.')
      openPreview(item.id)
    }
  })

  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-open]')) {
      event.preventDefault()
      openPreview(event.target.dataset.open)
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      searchInput.focus()
    }
  })

  searchInput.addEventListener('input', event => {
    state.search = event.target.value
    render()
  })

  document.querySelector('.banner-close').addEventListener('click', event => {
    event.currentTarget.closest('.demo-banner').remove()
  })

  editorForm.addEventListener('submit', event => {
    event.preventDefault()
    if (!editorForm.reportValidity()) return
    const formData = new FormData(editorForm)
    const id = String(formData.get('id') || '')
    const existing = items.find(item => item.id === id)
    const status = event.submitter?.value === 'in-review' ? 'in-review' : 'draft'
    const updated = {
      id: existing ? existing.id : `content-${Date.now()}`,
      title: String(formData.get('title') || '').trim(),
      type: String(formData.get('type') || 'Policy'),
      summary: String(formData.get('summary') || '').trim(),
      body: String(formData.get('body') || '').trim(),
      audience: String(formData.get('audience') || 'All employees'),
      owner: String(formData.get('owner') || 'Unassigned').trim() || 'Unassigned',
      status,
      updatedAt: new Date().toISOString().slice(0, 10),
      reviewDate: String(formData.get('reviewDate') || ''),
    }
    if (existing) Object.assign(existing, updated)
    else items.unshift(updated)
    saveItems()
    editorDialog.close()
    render()
    showToast(status === 'in-review' ? 'Submitted for review in Simplest.' : 'Draft saved in Simplest.')
  })

  render()
  const initialDocId = new URLSearchParams(window.location.search).get('doc')
  if (initialDocId) openPreview(initialDocId, false)
})()
