export function normalizeLocaleForChangelog(code) {
    const s = String(code || 'en').toLowerCase().replace('-', '_')
    if (s.startsWith('zh')) {
        if (s.includes('tw')) return 'zh_TW'
        return 'zh_CN'
    }
    return s.split('_')[0] || 'en'
}

let changelogCache = null

export async function loadChangelogData() {
    if (changelogCache) return changelogCache
    try {
        const url = chrome.runtime.getURL('assets/changelog.json')
        const r = await fetch(url)
        if (!r.ok) return {}
        changelogCache = await r.json()
        return changelogCache
    } catch {
        return {}
    }
}

export function pickChangelogItems(data, version, locale) {
    const entry = (data && data[version]) || null
    if (!entry) return { items: [], moreUrl: '' }
    const items = entry[locale] || entry.en || []
    const moreUrl = entry.moreUrl || ''
    return { items, moreUrl }
}
