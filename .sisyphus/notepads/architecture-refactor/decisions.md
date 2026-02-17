# Architectural Decisions - Message Type Refactor

- **Centralized Message Types**: Extracted hardcoded message strings into `scripts/core/message-types.js` to ensure consistency and prevent typos across the background worker and UI scripts.
- **Naming Convention**: Used the `MSG` object with `UPPER_SNAKE_CASE` keys (e.g., `FETCH_ICON`) and lowercase string values matching the original implementation to maintain backward compatibility with existing message handlers and tests.
- **StorageRepo Full Funnel (Wave 1 Task 1)**: 将 `background-worker.js`、`scripts/features/quicklinks/store.js`、`scripts/backgrounds/index.js`、`scripts/core/backup-manager.js` 中的 direct `chrome.storage.(sync|local).(get|set)` 统一替换为 `storageRepo.(sync|local).*`，并保持原有 key 与数据结构不变。
- **Background Settings Safe-Load Rule**: `loadSettings()` 采用 “`getAll()` + 单 key probe” 双阶段判定：仅在 key 真缺失时持久化默认值；若出现全量读取异常但 key 实际存在，则仅回落运行时默认，不覆盖存储。
- **SW Storage Change Registration Rule**: `background-worker.js` 的存储变更监听统一改为 `onStorageChange('service-worker.auto-refresh', handler)`，与页面端相同注册入口，避免 direct API。
- **Backup Smart-Restore Rule**: `_smartRestoreStorage(areaName, ...)` 不再持有 `chrome.storage` area 对象，改为 `storageRepo.sync/local` 命名空间并使用 `getAll()` + `removeMultiple()`，保持恢复语义不变。

- **Task 2 CSS Scope Decision**: Kept `styles/bundle.css` as the single integrated stylesheet and only touched `styles/photos.css` as a source-aligned component stylesheet, without introducing any file split.
- **Token Consistency Decision**: Replaced hardcoded `rgba(255, 255, 255, 0.08|0.15)`, `rgba(0, 0, 0, 0.08)`, `rgba(255, 255, 255, 0.1)`, and `#0a84ff` in non-token-definition contexts with existing design tokens.
- **Media Query Consolidation Decision**: Merged duplicate `@media (max-width: 480px)` quicklink rules into a single block in `styles/bundle.css` to reduce redundancy without behavior changes.
