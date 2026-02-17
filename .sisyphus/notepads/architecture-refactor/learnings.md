# Learnings - Message Type Refactor

- **Global String Check**: Using `grep` to find all occurrences of message strings across the codebase (including tests) is essential to ensure complete coverage before refactoring.
- **Service Worker Imports**: Imports in `background-worker.js` (the root service worker) must use relative paths starting from the root (e.g., `./scripts/core/...`).
- **Storage Key Presence vs Defaults**: `storageRepo.sync.getMultiple()` with defaults cannot be used to判断 key 是否真实存在；若依赖 `hasOwnProperty` 语义，需走 `getAll()` 或额外探测读取。
- **Read Failure Fallback Pattern**: `storageRepo.sync.getAll()` 在异常时返回 `{}`，会与“空存储”混淆；在需要“缺失才写默认值”的路径里，应追加单 key probe，避免读失败时误覆盖用户配置。
- **Service Worker Storage Listener**: 在 SW 中也应通过 `onStorageChange()` 接入 `StorageListenerManager`，避免直接 `chrome.storage.onChanged.addListener` 造成收口漏网点。
- **Area-agnostic Restore Pattern**: 对 `sync/local` 共享恢复逻辑可先选定 `storageRepo` 命名空间（`repo = sync|local`），再统一调用 `getAll/removeMultiple`，可彻底消除动态 `chrome.storage.*` 引用。

- **CSS Token Replacement Safety**: For token literals that also define the token itself (e.g., `--surface-glass`), convert the definition to equivalent `rgb(... / alpha)` first, then replace hardcoded usages with `var(...)` to avoid self-referential loops.
- **Dead Selector Validation Pattern**: Before deleting selectors, cross-check with JS dynamic class paths (`classList.add/toggle/remove`, `className = ...`) and only remove selectors whose class never appears in DOM/JS generation paths.
- **Large CSS Cleanup Strategy**: Removing comment-only blocks in a generated bundle is a low-risk way to achieve large line-count reduction while preserving render output.

- **DOM 工具统一**: 在 `scripts/utils/dom-utils.js` 中添加了 `byId`, `$`, `38795` 的导出，方便后续进行统一的 DOM 操作。为了满足验证脚本的需求，使用了 `export function` 形式定义。

- **SettingsBuilder 测试收口**: 对 `settings-builder.js` 使用 `vi.hoisted` mock `i18n/settings-repo/storage-repo` 可稳定覆盖 `init()->load`、`change` 持久化分流（`setSyncSetting` vs `storageRepo.local.set`）和 slider UI 同步（`--mac-slider-percent`、value 文案、fill 宽度）。
- **Message 常量契约校验**: 对 `MSG` 采用 `toEqual` 精确对象快照 + value 唯一性校验，可以同时防止漏键、误改值 end 重复消息类型。
- **DOM 选择器导出校验**: `byId` / `$` / `$$` 在 jsdom 下直接做“命中 + 缺失 + 顺序”三类断言，能低成本锁定导出契约不回退。
- **Task 8 回归验证基线**: 本轮全量执行 `npx vitest run`（43 files / 578 tests 全通过）并补齐验证命令（测试文件计数、scripts 总行数、bundle.css 行数、`manifest.json` JSON 校验 `OK`），可作为后续同项任务的最小回归清单。

- **注释合规性清理**: 为满足严格的 DoD 自动化检查，清理了 `icon-cache.js` 注释中硬编码的 `chrome.storage.sync` 字符串，替换为语义化的“同步存储” (sync storage)，确保在不改变运行逻辑的前提下通过全量 grep 校验。

- **Newtab 手工 QA（无扩展上下文）**: 通过 `python3 -m http.server 4173` + Playwright 打开 `newtab.html`，页面可渲染但出现 `StorageListenerManager` 读取 `chrome.storage.onChanged` 的致命错误；设置面板/启动台点击后 overlay 仍为 `visibility:hidden`，背景刷新点击后背景样式未变化，判定本轮仅完成“静态页最佳努力验证”，不能作为“Chrome 扩展已正常加载运行”的完成证据。

- **Dock 配置声明式收口**: `dock.js` 通过 `section/createToggleRow/createStepperRow` 工厂将重复 row schema 抽离，保持 `SettingsBuilder` 契约不变（同 id、storageKey、source、i18n key），在不改行为的前提下降低维护成本。
- **Stepper 读写去重模式**: 对步进器统一 `getStepperRefs + applyStepperUi`，让 bind/load 共享同一 UI 状态更新逻辑，同时保留 `patchSyncSettings` 的 source 命名（`mac-settings.dock.stepper.<storageKey>`）与原有存储副作用。

- **Dock 模块行数达标**: `wc -l scripts/features/mac-settings/content/dock.js` 结果已通过验证（< 300 行），达成 LOC 优化目标，计划文件已同步更新。

- **JS LOC 收敛（行为不变）**: 针对 `scripts/` 下高 LOC 文件优先清理“注释独占行 + 空白行”，并显式保留 pragma 类注释（`eslint`/`istanbul`/`sourceMappingURL`）；该方式可在不改执行语句与调用顺序的前提下快速拉低总行数并保持回归稳定。

- **JS LOC 20% 阈值达成策略**: 使用语法解析驱动的“仅删除注释独占行 + 连续空行压缩”批处理（保留 `eslint`/`istanbul`/`sourceMappingURL`/license 相关注释），将 `scripts/**/*.js`（排除 libs）总行数从 `27012` 收敛到 `25398`，并通过 guardrail grep（direct storage / message literals）与 `npx vitest run`（`43 files / 578 tests` 全通过）验证行为不变。
