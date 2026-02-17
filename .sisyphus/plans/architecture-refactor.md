# Aura-Tab 架构重构清算计划

## TL;DR

> **Quick Summary**: 对 Aura-Tab Chrome 扩展（MV3 新标签页, ~31,800行JS / ~8,000行CSS）执行「适中强度」架构重构，修复 5 个核心架构瓶颈：状态管理分散、上帝模块、设置面板重复、CSS Token 泄漏、StorageRepo 采用缺口。保留现有良好基础设施（runtime-bus、lifecycle、modal-layer），接口保持兼容，功能和 UI 不变。
> 
> **Deliverables**:
> - 全量收口 StorageRepo，消除所有直接 chrome.storage 调用
> - CSS Token 一致化 + 死代码清理（预计减少 ~1000 行 CSS）
> - 声明式 SettingsBuilder 消除 mac-settings 面板模板冗余（预计减少 ~800 行 JS）
> - 拆分 launchpad.js (2771行) 和 backgrounds/index.js (1336行) 上帝模块
> - 补充关键模块的 vitest 测试
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 (StorageRepo) → Task 4 (Settings Builder) → Task 6 (God Modules) → Task 8 (Tests)

---

## Context

### Original Request
用户以「首席架构审计师」「CSS 体系构建师」「逻辑清算执行官」三重专家视角，要求对 Aura-Tab 进行全局清算审计和模块化重构。目标是删除 30%+ 冗余逻辑而不影响任何功能。

### Interview Summary
**Key Discussions**:
- **重构强度**: 用户选择「适中」— 修复 5 个瓶颈，保留良好架构，接口兼容
- **CSS 策略**: 保持单文件 bundle.css — 只清理 token 泄漏和死代码
- **测试策略**: Tests-after — 先重构，后补测试，确保现有测试继续通过
- **状态管理**: 渐进式统一 — 强制走 StorageRepo + StorageListenerManager，消除绕过

**Research Findings (5 parallel explore agents)**:
- runtime-bus.js 已是优良中央路由，仅 3 种消息类型，几乎不需重构
- StorageRepo 提供完整 CRUD 但未被全面采用（background-worker.js 等仍直接调用）
- CSS 已有完善的 `:root` 设计令牌体系，但 60+ 处硬编码绕过
- 无循环依赖，初始化顺序清晰（idle 调度优化首屏性能）
- mac-settings 5 个面板 ~1200 行重复 HTML 模板 + 事件绑定

### Metis Review
**Identified Gaps (addressed)**:
- Launchpad 分解策略: 按功能模块拆分（搜索、网格渲染、拖拽、分页），因为现有文件结构已遵循此模式
- SettingsBuilder 范围: 全声明式（含事件绑定 + 状态同步），这是节省代码的关键
- 存储迁移竞态风险: 通过 Extract & Proxy 模式逐步过渡，不一次性删除旧代码
- CSS 验证方式: 使用 grep/ast-grep 脚本自动验证 token 一致性
- Service Worker 上下文丢失: background-worker.js 改动极小（仅替换为 StorageRepo 调用），风险可控

---

## Work Objectives

### Core Objective
在不改变任何功能和 UI 的前提下，通过标准化存储访问、消除代码重复、拆分上帝模块、统一 CSS Token 使用，减少约 20-25% 的代码量并大幅提升可维护性。

### Concrete Deliverables
- `scripts/core/storage-repo.js` 成为唯一存储入口（background-worker.js + 所有 feature 模块）
- `scripts/core/message-types.js` 消息类型常量文件
- `scripts/features/mac-settings/settings-builder.js` 声明式配置渲染器
- `scripts/features/quicklinks/launchpad-*.js` 拆分后的子模块
- `scripts/backgrounds/bg-*.js` 拆分后的子服务
- `styles/bundle.css` Token 统一 + 死代码清理后的版本
- 新增 vitest 测试文件覆盖修改过的核心模块

### Definition of Done
- [x] `vitest run` 全部通过（现有 + 新增）
- [x] `grep -rn "chrome\.storage\.\(local\|sync\)" scripts/ background-worker.js --include="*.js" | grep -v "storage-repo.js" | grep -v "lifecycle.js" | grep -v "storage-helpers.js" | wc -l` 输出 0
- [x] `grep -rn "rgba(255, 255, 255, 0\.08)" styles/bundle.css | wc -l` 输出 0（改用 token）
- [x] 扩展在 Chrome 中正常加载并运行（新标签页、设置、启动台、背景切换全部功能正常）

### Must Have
- 所有现有功能 100% 保留
- 所有现有测试 100% 通过
- `DisposableComponent` 生命周期协议不变
- `runtime-bus` 消息总线机制不变
- 模块初始化顺序不变（idle 调度优化不受影响）

### Must NOT Have (Guardrails)
- ❌ 引入 TypeScript 或任何编译步骤
- ❌ 引入 CSS 预处理器（Sass/Less/PostCSS）
- ❌ 引入任何外部状态管理库
- ❌ 改变 UI 外观（哪怕 1px 偏移）
- ❌ 改变任何用户可感知的功能行为
- ❌ 一次性删除旧代码（必须采用 Extract & Proxy 逐步过渡）
- ❌ 在 CSS 中使用 `!important`（现有的除外）
- ❌ 修改 `manifest.json` 的 permissions
- ❌ 创建新的全局变量或顶级副作用

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after
- **Framework**: vitest

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

**Verification Tool by Deliverable Type:**

| Type | Tool | How Agent Verifies |
|------|------|-------------------|
| **JS 重构** | Bash (vitest) | `npx vitest run` — 全部通过 |
| **存储收口** | Bash (grep) | `grep -rn "chrome\.storage\." scripts/ --include="*.js"` — 仅出现在 storage-repo.js/lifecycle.js/storage-helpers.js |
| **CSS Token** | Bash (grep) | 搜索已知的硬编码值确认已替换为 token |
| **功能完整性** | Bash (扩展加载检查) | 验证 manifest.json 结构完整、所有引用文件存在 |
| **代码量统计** | Bash (wc -l) | 对比重构前后行数，确认减少 |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 安全基础层):
├── Task 1: StorageRepo 全量收口
├── Task 2: CSS Token 一致化 + 死代码清理
└── Task 3: 消息类型常量提取

Wave 2 (After Wave 1 — 解耦核心):
├── Task 4: SettingsBuilder 声明式面板
└── Task 5: DOM 工具统一

Wave 3 (After Wave 2 — 拆分巨物):
├── Task 6: 拆分上帝模块 (launchpad.js)
└── Task 7: 拆分上帝模块 (backgrounds/index.js)

Wave 4 (After Wave 3 — 质量保障):
└── Task 8: 补充 vitest 测试 + 全量回归验证
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 4, 6, 7 | 2, 3 |
| 2 | None | 8 | 1, 3 |
| 3 | None | 6, 7 | 1, 2 |
| 4 | 1 | 8 | 5 |
| 5 | None (logically Wave 2) | 6 | 4 |
| 6 | 1, 3, 5 | 8 | 7 |
| 7 | 1, 3 | 8 | 6 |
| 8 | ALL | None | None (final) |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|--------------------|
| 1 | 1, 2, 3 | 3 parallel tasks: category="unspecified-high" / "quick" |
| 2 | 4, 5 | 2 parallel tasks: category="unspecified-high" / "quick" |
| 3 | 6, 7 | 2 parallel tasks: category="deep" |
| 4 | 8 | 1 sequential task: category="unspecified-high" |

---

## TODOs

- [x] 1. StorageRepo 全量收口 — 消除所有直接 chrome.storage 调用
- [x] 2. CSS Token 一致化 + 死代码清理
- [x] 3. 消息类型常量提取

  **What to do**:
  - 创建 `scripts/core/message-types.js`，定义所有消息类型常量：
    ```javascript
    export const MSG = {
      FETCH_ICON: 'fetchIcon',
      REFRESH_BACKGROUND: 'refreshBackground',
      SHOW_CHANGELOG: 'showChangelog'
    };
    ```
  - 替换 `background-worker.js` 中的硬编码消息字符串
  - 替换 `scripts/core/icon-fetch-bridge.js` 中的硬编码消息字符串
  - 替换 `scripts/backgrounds/index.js` 中的硬编码消息字符串
  - 替换 `scripts/features/changelog/index.js` 中的硬编码消息字符串

  **Must NOT do**:
  - 不改变消息的实际字符串值
  - 不改变消息的处理逻辑
  - 不引入新的消息类型

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的提取和替换任务，涉及少量文件
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `background-worker.js:50` — `{ type: 'showChangelog', version }`
  - `background-worker.js:91` — `runtimeBus.register('fetchIcon', ...)`
  - `background-worker.js:219` — `{ type: 'refreshBackground' }`
  - `scripts/core/icon-fetch-bridge.js` — `{ type: 'fetchIcon', url }`
  - `scripts/backgrounds/index.js:1091` — 监听 `refreshBackground`
  - `scripts/features/changelog/index.js:69` — 监听 `showChangelog`

  **Acceptance Criteria**:

  - [x] `scripts/core/message-types.js` 文件存在
  - [x] `grep -rn "'fetchIcon'" scripts/ background-worker.js --include="*.js" | grep -v "message-types.js"` → 输出为空
  - [x] `grep -rn "'refreshBackground'" scripts/ background-worker.js --include="*.js" | grep -v "message-types.js"` → 输出为空
  - [x] `grep -rn "'showChangelog'" scripts/ background-worker.js --include="*.js" | grep -v "message-types.js"` → 输出为空
  - [x] `npx vitest run` → 全部通过

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: 验证消息常量文件存在且完整
    Tool: Bash
    Preconditions: 提取完成
    Steps:
      1. cat scripts/core/message-types.js
      2. Assert: 包含 FETCH_ICON, REFRESH_BACKGROUND, SHOW_CHANGELOG
      3. grep -rn "'fetchIcon'" scripts/ background-worker.js --include="*.js" | grep -v "message-types.js"
      4. Assert: 输出为空
    Expected Result: 所有消息类型集中定义
    Evidence: 文件内容和 grep 输出
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `refactor(core): extract message type constants to dedicated module`
  - Files: `scripts/core/message-types.js`, modified sender/receiver files
  - Pre-commit: `npx vitest run`

---

- [x] 4. 声明式 SettingsBuilder — 消除 mac-settings 面板模板冗余

  **What to do**:
  - 创建 `scripts/features/mac-settings/settings-builder.js`，实现声明式配置驱动的设置面板渲染器
  - 支持的控件类型：`toggle` (开关), `select` (下拉), `slider` (滑块), `text` (文本输入), `color` (颜色选择器), `button-group` (按钮组), `section` (分组)
  - 每个控件声明包含：`type`, `labelKey` (i18n键), `storageKey`, `storageArea`, `defaultValue`, `onChange` (可选回调)
  - Builder 自动处理：HTML 渲染 → 从 storage 加载初始值 → 事件绑定 → storage 写入 → i18n 翻译
  - 用 SettingsBuilder 重写 `general.js` (265行), `dock.js` (479行), `about.js` (171行)
  - `appearance.js` (870行) 和 `data.js` (881行) 因含复杂自定义逻辑，仅提取可声明化的部分

  **Must NOT do**:
  - 不改变设置项的功能或行为
  - 不改变设置项的存储键名
  - 不引入框架或模板引擎
  - 不破坏现有的 `registerContentRenderer` API

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要设计新的抽象层并改写多个文件
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Task 8
  - **Blocked By**: Task 1 (StorageRepo 需先统一)

  **References**:

  **Pattern References**:
  - `scripts/features/mac-settings/content/general.js` — 典型的设置面板，大量 innerHTML + querySelector 绑定
  - `scripts/features/mac-settings/content/appearance.js:57-80` — registerContentRenderer 的使用模式
  - `scripts/features/mac-settings/content/dock.js` — 包含 toggle/slider/select 的混合面板
  - `scripts/features/mac-settings/mac-settings-window.js` — 窗口框架，理解 content renderer 注册机制

  **API/Type References**:
  - `scripts/core/settings-repo.js:151-195` — `patchSyncSettings` 和 `setSyncSetting` 写入接口
  - `scripts/core/i18n.js` — `t()` 翻译函数
  - `scripts/core/storage-repo.js:239-263` — `sync.get/set` API

  **Acceptance Criteria**:

  - [x] `scripts/features/mac-settings/settings-builder.js` 文件存在
  - [x] `wc -l scripts/features/mac-settings/content/general.js` → 行数减少 50%+（从 265 行降至 ~130 行）
  - [x] `wc -l scripts/features/mac-settings/content/dock.js` → 行数减少 40%+（从 479 行降至 ~290 行）
  - [x] `npx vitest run` → 全部通过

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: 验证 SettingsBuilder 文件存在且导出正确
    Tool: Bash
    Preconditions: SettingsBuilder 实现完成
    Steps:
      1. cat scripts/features/mac-settings/settings-builder.js | head -20
      2. Assert: 包含 export 声明
      3. grep -c "SettingsBuilder\|buildSection\|renderSettings" scripts/features/mac-settings/settings-builder.js
      4. Assert: 输出 >= 3
    Expected Result: Builder 模块结构正确
    Evidence: 文件内容捕获

  Scenario: 验证代码量显著减少
    Tool: Bash (wc)
    Preconditions: 面板重写完成
    Steps:
      1. wc -l scripts/features/mac-settings/content/general.js
      2. Assert: 行数 < 140
      3. wc -l scripts/features/mac-settings/content/dock.js
      4. Assert: 行数 < 300
    Expected Result: 模板冗余大幅减少
    Evidence: wc 输出捕获

  Scenario: 验证全量测试通过
    Tool: Bash (vitest)
    Steps:
      1. npx vitest run
      2. Assert: 0 failures
    Expected Result: 功能行为不变
    Evidence: vitest 输出
  ```

  **Commit**: YES
  - Message: `refactor(settings): introduce declarative SettingsBuilder, reduce template boilerplate`
  - Files: `scripts/features/mac-settings/settings-builder.js`, `scripts/features/mac-settings/content/*.js`
  - Pre-commit: `npx vitest run`

---

- [x] 5. DOM 工具统一 — 推广 dom-utils.js 使用

  **What to do**:
  - 在 `scripts/utils/dom-utils.js` 中新增 `$`（querySelector 别名）和 `$$`（querySelectorAll 别名）
  - 在 `scripts/utils/dom-utils.js` 中新增 `byId`（getElementById 别名）
  - 在使用频率最高的文件中替换直接 DOM 调用为统一工具函数（优先级：layout.js, dock.js, launchpad.js, search.js）
  - 不强制全项目替换——仅在本次重构触及的文件中应用

  **Must NOT do**:
  - 不在未被其他任务修改的文件中进行替换
  - 不改变 DOM 查询的逻辑或时序

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的工具函数添加和局部替换
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 6
  - **Blocked By**: None (logically Wave 2 to reduce merge conflicts)

  **References**:

  **Pattern References**:
  - `scripts/utils/dom-utils.js` — 现有的 `updateElement`, `readCssVarString`, `readCssVarMs`
  - `scripts/features/layout.js:28-48` — 典型的大量 getElementById 集中获取
  - `scripts/features/quicklinks/index.js` — 定义了局部 `byId` 函数

  **Acceptance Criteria**:

  - [x] `grep -c "export function byId\|export function \\$" scripts/utils/dom-utils.js` → 输出 >= 2
  - [x] `npx vitest run` → 全部通过

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: 验证新工具函数导出
    Tool: Bash (grep)
    Steps:
      1. grep "export function" scripts/utils/dom-utils.js
      2. Assert: 包含 byId, $, $$ 或类似导出
    Expected Result: 工具函数可被全项目使用
    Evidence: grep 输出
  ```

  **Commit**: YES (groups with Task 4)
  - Message: `refactor(utils): extend dom-utils with selector helpers`
  - Files: `scripts/utils/dom-utils.js`, 被修改的 feature 文件
  - Pre-commit: `npx vitest run`

---

- [x] 6. 拆分上帝模块 — quicklinks/launchpad.js (2771行)

  **What to do**:
  - 按功能域将 `launchpad.js` 拆分为以下子模块：
    - `launchpad-core.js` — 核心 Launchpad 类、初始化、状态管理
    - `launchpad-grid.js` — 网格渲染、分页计算、页面切换逻辑
    - `launchpad-search.js` — 搜索过滤、高亮、结果渲染
    - `launchpad-drag.js` — 拖拽排序、跨页拖拽、SortableJS 集成
  - 原 `launchpad.js` 保留为 barrel file（re-export），确保所有外部 import 路径不变
  - 保持 `launchpad` 单例导出不变
  - 使用 Extract & Proxy 模式：先抽离，用 re-export 兼容旧导入

  **Must NOT do**:
  - 不改变 `launchpad` 的公开 API
  - 不改变外部导入路径（`import { launchpad } from './quicklinks/launchpad.js'` 仍然工作）
  - 不改变初始化时序
  - 不重写拖拽算法

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 复杂的大文件拆分，需要深入理解内部逻辑边界
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 7)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 3, 5

  **References**:

  **Pattern References**:
  - `scripts/features/quicklinks/launchpad.js` — 完整的 2771 行源文件
  - `scripts/features/quicklinks/index.js` — barrel / coordinator 模式
  - `scripts/core/lifecycle.js:736-830` — `DisposableComponent` 基类，子模块应遵循

  **API/Type References**:
  - `scripts/features/quicklinks/store.js` — Store 单例，launchpad 的数据源
  - `scripts/libs/sortable-loader.js` — SortableJS 按需加载器
  - `scripts/core/modal-layer.js` — 模态层集成

  **Acceptance Criteria**:

  - [x] `ls scripts/features/quicklinks/launchpad-*.js | wc -l` → 输出 >= 3（至少 3 个子模块）
  - [x] `wc -l scripts/features/quicklinks/launchpad.js` → 行数 < 100（仅 re-export）
  - [x] `grep "import.*launchpad" scripts/features/layout.js scripts/features/quicklinks/index.js` → 导入路径未改变
  - [x] `npx vitest run` → 全部通过

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: 验证子模块文件存在
    Tool: Bash (ls)
    Steps:
      1. ls -la scripts/features/quicklinks/launchpad-*.js
      2. Assert: 至少 3 个文件存在
      3. wc -l scripts/features/quicklinks/launchpad.js
      4. Assert: 行数 < 100
    Expected Result: 上帝模块已拆分，原文件变为 barrel
    Evidence: ls 和 wc 输出

  Scenario: 验证外部导入兼容性
    Tool: Bash (grep)
    Steps:
      1. grep -rn "from.*launchpad" scripts/ --include="*.js" | grep -v "launchpad-" | grep -v "launchpad.js:"
      2. Assert: 所有导入仍指向 launchpad.js（不是子模块）
    Expected Result: 外部 API 无破坏
    Evidence: grep 输出

  Scenario: 全量测试回归
    Tool: Bash (vitest)
    Steps:
      1. npx vitest run
      2. Assert: 0 failures
    Expected Result: 拆分不影响功能
    Evidence: vitest 输出
  ```

  **Commit**: YES
  - Message: `refactor(quicklinks): decompose launchpad god module into focused sub-modules`
  - Files: `scripts/features/quicklinks/launchpad.js`, `scripts/features/quicklinks/launchpad-*.js`
  - Pre-commit: `npx vitest run`

---

- [x] 7. 拆分上帝模块 — backgrounds/index.js (1336行)

  **What to do**:
  - 按功能域将 `backgrounds/index.js` 拆分为以下子模块：
    - `bg-controller.js` — 核心控制逻辑、`initBackgroundSystem` 和 `backgroundSystem` 导出
    - `bg-metadata-cache.js` — `BackgroundMetadataCache` 类（提取 L95-158）
    - `bg-mutex.js` — `Mutex` 类（提取 L53-85）
    - `bg-apply.js` — 背景应用/切换/过渡动画逻辑
  - 原 `index.js` 保留为 barrel file，re-export `initBackgroundSystem` 和 `backgroundSystem`
  - 确保所有外部 import 路径不变

  **Must NOT do**:
  - 不改变 `backgroundSystem` 的公开 API
  - 不改变背景切换的动画或时序
  - 不修改提供商 API 调用逻辑

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 复杂的大文件拆分，含异步互斥锁和缓存逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 3

  **References**:

  **Pattern References**:
  - `scripts/backgrounds/index.js` — 完整的 1336 行源文件
  - `scripts/backgrounds/providers.js` — 已独立的提供商模块（示范拆分模式）
  - `scripts/backgrounds/crop-engine.js` — 已独立的裁切引擎（示范拆分模式）
  - `scripts/backgrounds/utils.js` — 已独立的工具函数

  **API/Type References**:
  - `scripts/backgrounds/types.js` — `DEFAULT_SETTINGS` 类型定义
  - `scripts/core/settings-repo.js` — `setBackgroundSettings` 接口

  **Acceptance Criteria**:

  - [x] `ls scripts/backgrounds/bg-*.js | wc -l` → 输出 >= 3
  - [x] `wc -l scripts/backgrounds/index.js` → 行数 < 150（仅 barrel + 协调逻辑）
  - [x] `grep "import.*backgrounds/index" scripts/ --include="*.js" -rn` → 所有导入路径不变
  - [x] `npx vitest run` → 全部通过

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: 验证子模块存在且原文件简化
    Tool: Bash (ls/wc)
    Steps:
      1. ls -la scripts/backgrounds/bg-*.js
      2. Assert: 至少 3 个文件
      3. wc -l scripts/backgrounds/index.js
      4. Assert: 行数 < 150
    Expected Result: 上帝模块已拆分
    Evidence: ls 和 wc 输出

  Scenario: 全量测试回归
    Tool: Bash (vitest)
    Steps:
      1. npx vitest run
      2. Assert: 0 failures
    Expected Result: 拆分不影响功能
    Evidence: vitest 输出
  ```

  **Commit**: YES
  - Message: `refactor(backgrounds): decompose background system into focused services`
  - Files: `scripts/backgrounds/index.js`, `scripts/backgrounds/bg-*.js`
  - Pre-commit: `npx vitest run`

---

- [x] 8. 补充 vitest 测试 + 全量回归验证

  **What to do**:
  - 为 `scripts/core/message-types.js` 编写常量完整性测试
  - 为 `scripts/features/mac-settings/settings-builder.js` 编写单元测试（渲染、事件绑定、存储同步）
  - 为 `scripts/utils/dom-utils.js` 的新增函数编写测试
  - 运行全量 vitest 测试套件，确保 0 failures
  - 统计重构前后的代码量对比（wc -l）
  - 验证扩展 manifest.json 的结构完整性
  - 验证所有 JS 文件的 import 路径都指向实际存在的文件

  **Must NOT do**:
  - 不修改现有测试的断言逻辑
  - 不跳过任何失败的测试

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要为多个新模块编写测试并进行全量验证
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (Sequential, final)
  - **Blocks**: None (final task)
  - **Blocked By**: ALL (Tasks 1-7)

  **References**:

  **Test References**:
  - `tests/runtime-bus.test.js` — 现有测试示范：消息总线测试模式
  - `tests/store.test.js` — 现有测试示范：Store 测试模式
  - `tests/settings-repo.test.js` — 现有测试示范：SettingsRepo 测试模式
  - `tests/setup.js` — 测试环境设置
  - `vitest.config.js` — 测试配置

  **Acceptance Criteria**:

  - [x] `npx vitest run` → 0 failures, 所有测试通过
  - [x] `ls tests/*settings-builder* tests/*message-types* tests/*dom-utils* | wc -l` → 输出 >= 2（新测试文件）
  - [x] 代码量统计：`find scripts -name "*.js" -not -path "*/libs/*" -exec wc -l {} + | tail -1` → 比原始 31,782 行减少至少 4,000 行

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: 全量测试通过
    Tool: Bash (vitest)
    Steps:
      1. npx vitest run
      2. Assert: exit code 0
      3. Assert: 0 failures 在输出中
    Expected Result: 所有测试（现有 + 新增）通过
    Evidence: vitest 完整输出

  Scenario: 代码量减少验证
    Tool: Bash (wc)
    Steps:
      1. find scripts -name "*.js" -not -path "*/libs/*" -exec wc -l {} + | tail -1
      2. Assert: 总行数 < 27800 (减少约 4000 行)
      3. wc -l styles/bundle.css
      4. Assert: 行数 < 6600 (减少约 500 行)
    Expected Result: 总代码量减少约 20-25%
    Evidence: wc 输出

  Scenario: import 路径完整性验证
    Tool: Bash (grep + stat)
    Steps:
      1. grep -rohn "from '\./[^']*'" scripts/ --include="*.js" | sed "s/.*from '//;s/'.*//" | sort -u > /tmp/imports.txt
      2. 逐一检查文件是否存在
      3. Assert: 所有 import 路径指向实际文件
    Expected Result: 无悬空导入
    Evidence: 验证脚本输出

  Scenario: Manifest 完整性验证
    Tool: Bash
    Steps:
      1. cat manifest.json | python3 -m json.tool
      2. Assert: exit code 0 (有效 JSON)
      3. Assert: service_worker 字段指向 background-worker.js
    Expected Result: Manifest 结构有效
    Evidence: JSON 解析输出
  ```

  **Commit**: YES
  - Message: `test: add tests for refactored modules and verify full regression`
  - Files: `tests/*.test.js`
  - Pre-commit: `npx vitest run`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `refactor(storage): unify all chrome.storage access through StorageRepo` | background-worker.js, store.js 等 | `npx vitest run` |
| 2 | `refactor(css): unify design tokens and remove dead selectors` | styles/*.css | `npx vitest run` |
| 3 | `refactor(core): extract message type constants` | message-types.js, 使用方文件 | `npx vitest run` |
| 4 | `refactor(settings): introduce declarative SettingsBuilder` | settings-builder.js, content/*.js | `npx vitest run` |
| 5 | `refactor(utils): extend dom-utils with selector helpers` | dom-utils.js | `npx vitest run` |
| 6 | `refactor(quicklinks): decompose launchpad god module` | launchpad*.js | `npx vitest run` |
| 7 | `refactor(backgrounds): decompose background system` | bg-*.js, index.js | `npx vitest run` |
| 8 | `test: add tests for refactored modules` | tests/*.test.js | `npx vitest run` |

---

## Success Criteria

### Verification Commands
```bash
# 1. 所有测试通过
npx vitest run
# Expected: 0 failures

# 2. 零直接存储调用
grep -rn "chrome\.storage\.\(local\|sync\)\.\(get\|set\|remove\)" scripts/ background-worker.js --include="*.js" | grep -v "storage-repo.js" | grep -v "lifecycle.js" | grep -v "storage-helpers.js" | wc -l
# Expected: 0

# 3. 零硬编码消息类型
grep -rn "'fetchIcon'\|'refreshBackground'\|'showChangelog'" scripts/ background-worker.js --include="*.js" | grep -v "message-types.js" | wc -l
# Expected: 0

# 4. CSS Token 泄漏消除
grep -c "rgba(255, 255, 255, 0\.08)" styles/bundle.css
# Expected: <= 1 (仅 :root 定义)

# 5. JS 代码量减少
find scripts -name "*.js" -not -path "*/libs/*" -exec wc -l {} + | tail -1
# Expected: < 27800 (原 31782, 减少 ~4000 行)

# 6. CSS 代码量减少
wc -l styles/bundle.css
# Expected: < 6600 (原 7101, 减少 ~500 行)
```

### Final Checklist
- [x] 所有 "Must Have" 功能保留
- [x] 所有 "Must NOT Have" 约束遵守
- [x] 所有现有 vitest 测试通过
- [x] 新增测试覆盖新模块
- [x] 扩展在 Chrome 中正常加载和运行
- [x] 代码量减少 20-25%
