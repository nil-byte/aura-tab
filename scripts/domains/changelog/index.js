import * as storageRepo from '../../platform/storage-repo.js'
import { normalizeLocaleForChangelog, loadChangelogData, pickChangelogItems } from './utils.js'
import { mount, isVisible, updateContent } from './view.js'
import { macSettingsWindow } from '../settings/index.js'
import { runtimeBus } from '../../platform/runtime-bus.js'
import { MSG } from '../../platform/runtime-bus.js'

const KEYS = {
  lastSeenVersion: 'changelog:lastSeenVersion',
  ignoredVersions: 'changelog:ignoredVersions'
}

async function getLocal(key, defaultValue) {
  return storageRepo.local.get(key, defaultValue)
}

async function setLocal(key, value) {
  await storageRepo.local.setMultiple({ [key]: value })
}

export async function getLastSeenVersion() {
  return getLocal(KEYS.lastSeenVersion, '')
}

export async function setLastSeenVersion(version) {
  await setLocal(KEYS.lastSeenVersion, String(version || ''))
}

export async function getIgnoredVersions() {
  const list = await getLocal(KEYS.ignoredVersions, [])
  return Array.isArray(list) ? list : []
}

export async function addIgnoreVersion(version) {
  const v = String(version || '')
  const list = await getIgnoredVersions()
  if (!list.includes(v)) {
    list.push(v)
    await setLocal(KEYS.ignoredVersions, list)
  }
}

export async function isIgnored(version) {
  const v = String(version || '')
  const list = await getIgnoredVersions()
  return list.includes(v)
}

const CHANGELOG_OWNER = 'feature.changelog'
let runtimeUnsubscribe = null
let languageBound = false

function getVersion() {
  try {
    const m = chrome.runtime.getManifest()
    return (m && m.version) || ''
  } catch {
    return ''
  }
}

function getUiLang() {
  return normalizeLocaleForChangelog(
    document.documentElement.lang || (chrome.i18n.getUILanguage && chrome.i18n.getUILanguage())
  )
}

export async function initChangelog() {
  const version = getVersion()
  const uiLang = getUiLang()
  const data = await loadChangelogData()
  const { items, moreUrl } = pickChangelogItems(data, version, uiLang)
  const lastSeen = await getLastSeenVersion()
  const ignored = await isIgnored(version)
  if (!ignored && version && version !== lastSeen) {
    mount({
      title: chrome.i18n.getMessage('changelog_title') || "What's new",
      version,
      items,
      moreUrl,
      onClose: async () => {
        // Close: don't persist ignore; optionally mark as viewed
        // Keep empty so same version can still be prompted later
      },
      onIgnore: async v => {
        await addIgnoreVersion(v)
        await setLastSeenVersion(version)
      },
      onMore: () => openChangelogTab()
    })
  }

  // Listen for language changes to refresh open changelog in real-time
  if (!languageBound) {
    languageBound = true
    window.addEventListener('languageChanged', (e) => {
      if (isVisible()) {
        const newLocale = normalizeLocaleForChangelog(e.detail.locale || document.documentElement.lang)
        // Use currently displayed version (may be historical), fallback to current version if unavailable
        const currentV = document.querySelector('.changelog-version')?.textContent?.split(' ').pop() || version
        const sel = pickChangelogItems(data, currentV, newLocale)
        updateContent({
          items: sel.items,
          version: currentV
        })
      }
    })
  }

  runtimeUnsubscribe?.()
  runtimeUnsubscribe = runtimeBus.register(MSG.SHOW_CHANGELOG, async (msg) => {
    if (!msg || msg.type !== MSG.SHOW_CHANGELOG) return
    const v = String(msg.version || version || '')
    const ignoredNow = await isIgnored(v)
    if (ignoredNow || !v) return
    const sel = pickChangelogItems(data, v, getUiLang())
    mount({
      title: chrome.i18n.getMessage('changelog_title') || "What's new",
      version: v,
      items: sel.items,
      moreUrl: sel.moreUrl,
      onClose: async () => {
        // Close: don't persist ignore
      },
      onIgnore: async vv => {
        await addIgnoreVersion(vv)
        await setLastSeenVersion(v)
      },
      onMore: () => openChangelogTab()
    })
  }, CHANGELOG_OWNER)
}

function openChangelogTab() {
  try {
    macSettingsWindow.open()
    // Prefer menu click selection to avoid calling private methods directly
    const clickSelect = () => {
      const btn = document.querySelector('#macSettingsMenu .mac-menu-item[data-menu="changelog"]')
      if (btn) btn.click()
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(clickSelect)
    } else {
      setTimeout(clickSelect, 0)
    }
  } catch {
    // ignore
  }
}
