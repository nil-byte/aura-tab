import { normalizeLocaleForChangelog, loadChangelogData, pickChangelogItems } from './utils.js'
import { mount, isVisible, updateContent } from './view.js'
import { macSettingsWindow } from '../settings/window.js'

const LAST_SEEN_VERSION_KEY = 'changelog:lastSeenVersion'
const SHOW_CHANGELOG_MESSAGE = 'showChangelog'

async function shouldShowVersion(version) {
  const v = String(version || '')
  if (!v) return false
  const { [LAST_SEEN_VERSION_KEY]: lastSeen = '' } = await chrome.storage.local.get({ [LAST_SEEN_VERSION_KEY]: '' })
  return v !== lastSeen
}

let runtimeHandler = null
let languageBound = false

function getVersion() {
  const m = chrome.runtime.getManifest()
  return (m && m.version) || ''
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
  const shouldShow = await shouldShowVersion(version)
  if (shouldShow) {
    mount({
      version,
      items,
      moreUrl,
      onClose: async () => {
        await chrome.storage.local.set({ [LAST_SEEN_VERSION_KEY]: String(version || '') })
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

  if (runtimeHandler) {
    chrome.runtime.onMessage.removeListener(runtimeHandler)
  }
  runtimeHandler = (msg) => {
    if (!msg || msg.type !== SHOW_CHANGELOG_MESSAGE) return false
    void (async () => {
      const v = String(msg.version || version || '')
      const shouldShowNow = await shouldShowVersion(v)
      if (!shouldShowNow) return
      const sel = pickChangelogItems(data, v, getUiLang())
      mount({
        version: v,
        items: sel.items,
        moreUrl: sel.moreUrl,
        onClose: async () => {
          await chrome.storage.local.set({ [LAST_SEEN_VERSION_KEY]: String(v || '') })
        },
        onMore: () => openChangelogTab()
      })
    })()
    return false
  }
  chrome.runtime.onMessage.addListener(runtimeHandler)
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
