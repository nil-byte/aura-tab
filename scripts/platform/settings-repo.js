function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeOneLevel(current, patch, nestedKeys = []) {
    const base = isPlainObject(current) ? current : {};
    const next = isPlainObject(patch) ? { ...base, ...patch } : { ...base };
    for (const key of nestedKeys) {
        next[key] = {
            ...(isPlainObject(base[key]) ? base[key] : {}),
            ...(isPlainObject(patch?.[key]) ? patch[key] : {})
        };
    }
    return next;
}

export async function patchBackgroundSettings(patch) {
    const { backgroundSettings = {} } = await chrome.storage.sync.get({ backgroundSettings: {} });
    const current = mergeOneLevel(backgroundSettings, null, ['texture', 'apiKeys']);
    if (!isPlainObject(patch)) {
        return current;
    }

    const next = mergeOneLevel(current, patch, ['texture', 'apiKeys']);
    await chrome.storage.sync.set({ backgroundSettings: next });
    return next;
}

export async function patchSyncSettings(patch) {
    if (!isPlainObject(patch) || Object.keys(patch).length === 0) {
        return { ok: true, updates: {} };
    }

    const keys = Object.keys(patch);
    const defaults = Object.fromEntries(keys.map((key) => [key, undefined]));
    const current = await chrome.storage.sync.get(defaults);
    const updates = {};

    for (const key of keys) {
        updates[key] = isPlainObject(patch[key])
            ? mergeOneLevel(current?.[key], patch[key])
            : patch[key];
    }

    await chrome.storage.sync.set(updates);
    return { ok: true, updates };
}
