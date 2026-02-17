import { t, initHtmlI18n } from '../../platform/i18n.js'

const cls = {
  root: 'changelog-popover',
  title: 'changelog-title',
  version: 'changelog-version',
  list: 'changelog-list',
  actions: 'changelog-actions',
  btnClose: 'changelog-btn-close',
  btnIgnore: 'changelog-btn-ignore',
  btnMore: 'changelog-btn-more',
  hidden: 'changelog-hidden',
  open: 'changelog-open'
}



function ensureStyle() {
  if (document.getElementById('changelog-style')) return
  const style = document.createElement('style')
  style.id = 'changelog-style'
  style.textContent = `
  .${cls.root}{position:fixed;top:16px;right:16px;max-width:380px;border-radius:14px;padding:14px 14px 10px;background:var(--panel-bg,rgba(28,28,30,0.6));color:var(--panel-fg,#fff);box-shadow:0 10px 40px rgba(0,0,0,0.25),0 1px 0 rgba(255,255,255,0.05) inset;z-index:9999;backdrop-filter:saturate(1.4) blur(20px);border:1px solid rgba(255,255,255,0.18);transform:translateY(-8px) scale(.98);opacity:0;transition:transform 240ms cubic-bezier(.2,.8,.2,1),opacity 240ms cubic-bezier(.2,.8,.2,1)}
  .${cls.root}.${cls.hidden}{display:none}
  .${cls.root}.${cls.open}{transform:none;opacity:1}
  .${cls.title}{font-size:14px;font-weight:600;margin:0 0 4px}
  .${cls.version}{font-size:12px;opacity:.8;margin:0 0 8px}
  .${cls.list}{margin:0 0 8px;padding-left:18px}
  .${cls.list} li{margin:4px 0;font-size:12px;line-height:1.4}
  .${cls.actions}{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:8px}
  .${cls.actions} button{font-size:12px;border:none;border-radius:10px;padding:6px 12px;cursor:pointer;transition:transform 160ms ease,box-shadow 160ms ease,background-color 160ms ease,color 160ms ease;white-space:nowrap}
  .${cls.actions} button:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(10,132,255,.6)}
  .${cls.btnMore}{background:var(--accent,#0A84FF);color:#fff}
  .${cls.btnMore}:hover{box-shadow:0 6px 18px rgba(10,132,255,.35);transform:translateY(-1px)}
  .${cls.btnIgnore}{background:transparent;color:inherit;border:1px solid rgba(255,255,255,.28)}
  .${cls.btnIgnore}:hover{background:rgba(255,255,255,.08)}
  .${cls.btnClose}{background:transparent;color:inherit;border:1px solid rgba(255,255,255,.18)}
  .${cls.btnClose}:hover{background:rgba(255,255,255,.06)}
  `
  document.head.appendChild(style)
}

function createRoot() {
  ensureStyle()
  let root = document.querySelector(`.${cls.root}`)
  if (!root) {
    root = document.createElement('div')
    root.className = `${cls.root} ${cls.hidden}`
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'false')
    root.tabIndex = -1
    const title = document.createElement('div')
    title.className = cls.title
    const ver = document.createElement('div')
    ver.className = cls.version
    const ul = document.createElement('ul')
    ul.className = cls.list
    const actions = document.createElement('div')
    actions.className = cls.actions
    const btnMore = document.createElement('button')
    btnMore.className = cls.btnMore
    btnMore.dataset.i18n = 'changelog_learn_more'
    const btnIgnore = document.createElement('button')
    btnIgnore.className = cls.btnIgnore
    btnIgnore.dataset.i18n = 'changelog_ignore_this_version'
    const btnClose = document.createElement('button')
    btnClose.className = cls.btnClose
    btnClose.dataset.i18n = 'changelog_close'
    actions.append(btnMore, btnIgnore, btnClose)
    root.append(title, ver, ul, actions)
    document.body.appendChild(root)
  }
  return root
}

export function mount({ title, version, items, moreUrl, onClose, onIgnore, onMore }) {
  const root = createRoot()
  root.classList.remove(cls.open)
  const titleEl = root.querySelector(`.${cls.title}`)
  titleEl.dataset.i18n = 'changelog_title'
  titleEl.textContent = title || t('changelog_title') || "What's new"

  const verEl = root.querySelector(`.${cls.version}`)
  verEl.innerHTML = `<span data-i18n="changelog_subtitle">${t('changelog_subtitle') || 'Version'}</span> ${version || ''}`

  const listEl = root.querySelector(`.${cls.list}`)
  listEl.innerHTML = ''
    ; (items || []).forEach(s => {
      const li = document.createElement('li')
      li.textContent = String(s || '')
      listEl.appendChild(li)
    })

  // Initialize i18n
  initHtmlI18n(root)

  const btnMore = root.querySelector(`.${cls.btnMore}`)
  const btnClose = root.querySelector(`.${cls.btnClose}`)
  const btnIgnore = root.querySelector(`.${cls.btnIgnore}`)

  btnMore.style.display = ''
  btnMore.onclick = () => {
    if (onMore) onMore(moreUrl)
  }
  btnIgnore.onclick = () => {
    if (onIgnore) onIgnore(version)
    hide()
  }
  btnClose.onclick = () => {
    if (onClose) onClose()
    hide()
  }
  show(() => btnMore.style.display !== 'none' ? btnMore.focus() : btnClose.focus())
}

export function isVisible() {
  const root = document.querySelector(`.${cls.root}`)
  return root && root.classList.contains(cls.open)
}

export function updateContent({ items, version }) {
  const root = createRoot()
  // Update list
  const listEl = root.querySelector(`.${cls.list}`)
  listEl.innerHTML = ''
    ; (items || []).forEach(s => {
      const li = document.createElement('li')
      li.textContent = String(s || '')
      listEl.appendChild(li)
    })

  // Update version if needed
  if (version) {
    const verEl = root.querySelector(`.${cls.version}`)
    verEl.innerHTML = `<span data-i18n="changelog_subtitle">${t('changelog_subtitle') || 'Version'}</span> ${version}`
  }

  // Re-run i18n
  initHtmlI18n(root)
}

export function show(focusCb) {
  const root = createRoot()
  root.classList.remove(cls.hidden)
  requestAnimationFrame(() => {
    root.classList.add(cls.open)
    if (typeof focusCb === 'function') focusCb()
  })
}

export function hide() {
  const root = document.querySelector(`.${cls.root}`)
  if (!root) return
  root.classList.remove(cls.open)
  root.classList.add(cls.hidden)
}
