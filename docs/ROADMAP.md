# dsh-at-sider 路线图（主计划书）

> 本文是本插件的**唯一总览**：已完成 / 计划中 / 机制出处。文档分工：
> `ROADMAP.md`（本文，主计划书——总览与状态追踪）；
> [`DESIGN.md`](DESIGN.md)（设计分册——每个取舍的依据、被否决的替代方案、升级脆弱点清单）；
> [`INSTALL.md`](INSTALL.md)（安装/排错）。
> 更新规则：新想法先入本文 §2 再视需要细化；落地一项就在 §1 打勾注明版本，并同步
> `CHANGELOG.md`、`README.md`/`README_EN.md` 版本历史、根手册（`../README.md`）§0/§7。
> 发版前最后一步：grep 全仓 `开发中` 应为 0 处。

| | |
|---|---|
| 当前版本 | v0.1.0（npm latest）· 65 离线用例 |
| 下一版本 | v0.2.0：§2.2 设置页 + §2.3 状态与性能（另有 T2 provenance 缓议、上游化三项） |
| 维护原则 | **只读不改写**（agent 是写者，侧栏是读者）；零依赖纯 JS 免构建；图标/入口/打开方式与原生一致；离线测试全覆盖；发布全自动 |

---

## 1. 已完成（v0.0.1 → v0.1.0）

### 1.1 功能主线

| 项 | 内容 | 版本 | 状态 |
|---|---|---|---|
| R0 | **接管 builtin `files` kind**：`extension` 优先级注册同 kind 的 tab 类型，body/title 按定义自身 `id` 分派（零 key 冲突，卸载即恢复原生） | v0.0.1 | ✅ |
| R1 | **行内 `@文件`/`@文件夹` 引用按钮**：`conversation.input.for(scope).addFiles` 插入原子引用（与内置 `@` 补全、拖入文件同款 chip）；Alt/⌥ 单击复制；composer 不可达自动降级复制 | v0.0.1 | ✅ |
| R2 | **行尾修改时间列**：Host 半 `POST /api/dsh-at-sider/list`（工作区受限、每层 2000 上限、stat 并发 32、只读）返回 `mtimeMs`；`YYYY-MM-DD HH:mm` + 完整时间 tooltip | v0.0.1 | ✅ |
| R3 | **自动刷新 + 页头**：复用原生 `workspaceFiles.changes` 目录监听（不轮询）、重新读取按钮、自动刷新开关、根路径标签 | v0.0.1 | ✅ |
| R4 | **入口保留**：引导页胶囊（order 10 + `workspace.files` 快捷键）、标签 chip 标题 | v0.0.1 | ✅ |
| F1 | **修复时间列被裁切**：行原为 `content-box`，`width:100%` + 自身 padding 溢出 20px；改回 `border-box` | v0.0.2 | ✅ |
| F2 | **图标恢复宿主原生**：`FileTypeIcon` + `classifyFileType`（按类型着色）、`IconFolder*Regular`、`GuideArtworkFiles`，运行时读取、`try`/`catch` + 导出形状校验，自带字形仅兜底（DESIGN §9"有界破例"） | v0.0.2 | ✅ |
| D1 | **README 结构对齐 dsh-pubmed**：中文主文档 + `README_EN.md` + npm/dsh-plugin.org badges + 完整安装步骤 | v0.0.2 | ✅ |

### 1.2 验证手段

- **离线测试 65 用例（2 文件，零网络零浏览器）**：工作区包含性（`..`、同名前缀兄弟目录、NUL、缺根）；每层列表与 `mtimeMs`、截断、错误码映射、有界并发；路由请求/响应契约与 `apply()` 注册（缺 `connection`/`sessions` 保持惰性）；接管定义（kind/priority/guide）；mention 文法与 `dsh-resource://` 地址；composer 插入与剪贴板降级；按钮标签与闪现态；宿主图标路径与兜底路径双覆盖；行盒模型；整树渲染冒烟（行/日期/`@` 按钮/目录点击/失败行/无工作区态/两种点击路径）；大小格式化、宽度分层、排序比较器、页头排序循环与偏好持久化（v0.0.3）；冷会话兜底（live 优先/持久化回退/各残缺态）、整条路由冷会话可用、`no-workspace` 自愈重试与 2 次封顶（v0.0.4）；**菜单可见性、运行时开关、搜索路由（跳过清单/上限/深度）、过滤 UI、reveal 展开、树语义、键盘导航、预览页签 `@文件` 与地址解析（v0.1.0 新增）**。
- **发布物端到端**：从 npm registry 装到临时目录 → `import('dsh-at-sider')` 校验 `apply`/`ROUTE_PATH`，并核对 `dsh.client`/`dsh.bundle.patch` 声明（v0.0.1/v0.0.2 均执行）。
- **真机**：重启 `dsh web` 后目视确认（用户反馈驱动 §3.3 式 F 循环）。
- **镜像**：`scripts/sync-mirror.mjs` 确认 npmmirror 可取。

### 1.3 列、排序与自适应（v0.0.3 已发布）

| 项 | 内容 | 版本 | 状态 |
|---|---|---|---|
| R11 | **大小列**：常规文件人性化字节（`870 B`/`1.5 KB`/`1.2 MB`），时间 tooltip 合并大小，大小 tooltip 给精确字节数 | v0.0.3 | ✅ |
| R12 | **宽度自适应列**：ResizeObserver 实测树体宽度 → 三档（≥380 全列 / 300–379 隐大小 / <300 收起 `@` + `MM-DD HH:mm`）；两种时间形态常驻 DOM，CSS 决定显隐，改宽不重渲染 | v0.0.3 | ✅ |
| R13 | **排序**：页头按钮循环 名称→修改时间→大小→类型；目录恒在前、缺字段沉底、同名自然序决胜；偏好记忆（localStorage 尽力而为，缺失即回退 name） | v0.0.3 | ✅ |

### 1.4 冷会话自愈与布局细化（v0.0.4 已发布）

| 项 | 内容 | 版本 | 状态 |
|---|---|---|---|
| F3 | **冷会话自愈**：重启后恢复的文件 tab 曾显示"没有工作区目录"需手动重读——Host 路由补 sessionPersistence 兜底解析根目录（与原生 workspaceFileScope 同法），层级 `no-workspace` 失败再加最多 2 次、间隔 1.2s 的自动重试 | v0.0.4 | ✅ |
| P1 | **大小列布局细化**：大小 + 日期合入右钉组 `ats-right`（`margin-left: auto` 移到组上）；大小右对齐定宽 `7ch`，与日期 `gap: 2ch` 空两格 | v0.0.4 | ✅ |

### 1.5 运行时切换、定位与 a11y（R10/R15/R16/R17 —— v0.1.0 已发布）

| 项 | 内容 | 版本 | 状态 |
|---|---|---|---|
| R10 | **运行时回退原生**：Files tab 动作菜单提供「回退原生文件树 / 启用增强版文件树」，dispose/re-register definition——extension 注销后 builtin 立即恢复 | v0.1.0 | ✅ |
| R15 | **快速过滤/定位**：Host 新增递归搜索路由（`/api/dsh-at-sider/search`，跳过 node_modules/.git、深度 12、上限 200）；页头输入框防抖搜索，结果列表带 `@` chip，点文件打开、点目录回树展开 | v0.1.0 | ✅ |
| R16 | **在文件树中定位**：文件预览类 tab 动作菜单「在文件树中定位」→ `openTab('files', { params: { reveal } })`，body 展开祖先链并高亮该行；同一菜单另加「@文件」一键把预览文件引用插入输入框（与树内 `@` chip 同效） | v0.1.0 | ✅ |
| R17 | **键盘导航与 a11y**：roving tabindex、方向键移动/展开折叠、Home/End、焦点行 `@` 插引用；`role="tree"/"treeitem"/"group"` + `aria-level` + polite live region | v0.1.0 | ✅ |

---

## 2. 计划中

### 2.1 v0.1.0 候选（⭐ 已立项，2026-09 会话讨论）

> 更新：R11–R13 已随 v0.0.3 发布（见 §1.3）；R10/R15/R16/R17 已随 v0.1.0 发布（见 §1.5）；R14 经用户决策移入 §5。**§2.1 已全部落地**。

| 项 | 内容 | 机制落点 | 规模 | 验收 |
|---|---|---|---|---|
| **R10 运行时回退原生** | tab 菜单/设置加"回退原生 / 启用增强"开关：切换 = dispose/re-register 我们的 definition——extension 注销后 **builtin 立即恢复**（官方语义），不再需要卸载插件 | 保存 `sidebarRightTabs.register()` 的 disposer | 0.5d | 假 ctx 断言注销后无残留注册；真机切换后原生树立现、再切回增强版状态保留 |
| **R11 大小列** | Host 已返回 `size`（未显示）：人性化字节列或并入 tooltip（`11:04 · 1.2 MB`） | 纯客户端 | 0.25d | ✅ 已实现（v0.0.3，见 §1.3） |
| **R12 宽度自适应列** | `useTabInfo().sidebar.expanded/fullscreen`：窄侧栏时 `@文件`→`@`、时间列降级为悬停 tooltip——从机制上杜绝"被裁切"复发 | client CSS/组件 | 0.5d | ✅ 已实现（v0.0.3，见 §1.3；实测改为 ResizeObserver 三档） |
| **R13 排序** | 名称 / 修改时间 / 类型 / 大小，页头循环切换并记住偏好 | client（比较器已有，补状态） | 0.5d | ✅ 已实现（v0.0.3，见 §1.3） |
| **R15 快速过滤/定位** | Host 路由加递归 `search` 动作（忽略 `node_modules`/`.git`、深度受限、结果上限 200）+ 页头输入框 + 结果列表（点击打开、`@` 插入） | Host `index.js` + client | 1d | Host：忽略清单/上限/深度单测；client：渲染断言 |
| **R16 在文件树中定位** | 给文档预览类 tab 的动作菜单加"在文件树中定位"→ `openTab('files', { params: { reveal: path } })`；body 监听 `navigation.revision/params`（每次导航 revision 自增，文档化机制）展开祖先链并高亮 | `sidebar.right.tab.menu.item`（按 kind 过滤）+ 导航参数 | 0.5–1d | 菜单注册断言 + reveal 展开逻辑单测 + 真机 |
| **R17 键盘导航与 a11y** | 方向键行间移动、Enter 打开、Space 展开、焦点行按 `@` 插引用；`role="tree"/"treeitem"` + `aria-live` 载入态 | client | 1d | shim 渲染断言 + 手测清单 |

### 2.2 设置页（v0.1.x–v0.2.0）

> 机制先例：dsh-context 的 `SETTINGS_NAMESPACE` 注册 + 设置 UI（本机已装，源码可查）。

| 项 | 内容 | 状态 |
|---|---|---|
| R20 客户端偏好 | 日期格式（绝对/相对/混合）、默认排序、显示隐藏文件、自动刷新默认值、`@` 行为（插入/复制）、mention 风格（相对/绝对）、时间列开关 | 计划中 |
| R21 Host Config | `maxEntries`、search 忽略清单、`statConcurrency`（UNC/网络盘上调） | 计划中 |

验收：改动即时生效并持久化；无设置服务的 profile 上降级为内置默认值（插件保持可用）。

### 2.3 状态与性能

| 项 | 内容 | 状态 |
|---|---|---|
| R30 状态迁入 slot store | `levels`/`expansion` 用 `defineStore`（与原生同寿命、跨标签页保留），module 级 `scrollMemory` Map 一并收编；重开目录不再重读 | 计划中 |
| R31 大列表渲染 | `Entry` memo；虚拟化或分块渲染（一层 2000 条 × 多层展开的 DOM 压力） | 计划中 |
| R32 网络盘 | `statConcurrency` 可配；超时策略（UNC 上 32 并发 stat 可能慢） | 缓议 |

### 2.4 集成（⏸️ 先调查数据源，再立项）

| 项 | 内容 | 前置调查 | 状态 |
|---|---|---|---|
| R40 **Git 状态着色** | 修改/未跟踪文件名变色或加点（视觉价值最高） | ① in-box `dsh-workspace-changes`（形状 `{path, added, deleted,…}`）与 deliverables 的 `/api/changes.summary` 是否可复用；② 否则 Host 半 `git status --porcelain` 子进程（缓存、子模块、性能） | ⏸️ 调查中 |
| R41 会话级记忆 | 展开状态/滚动位置按工作区持久化，重启恢复（原生没有，差异化） | 插件自有存储服务选型 | 缓议 |
| R42 在此打开终端 | 目录行菜单"在此打开终端" | `dsh-api-terminal-controller` 的 openTab 参数 | 缓议 |
| R43 拖拽行插引用 | 行拖入 composer 生成引用 | composer 对自定义 MIME 的处理（内置 drop 走 OS 文件，可能不可行；不可行即放弃） | 缓议 |

### 2.5 工程卫生

| 项 | 内容 | 状态 |
|---|---|---|
| T1 | `.github/workflows/test.yml`：push/PR 跑 `npm test`（此前只有 tag 触发的 release.yml） | ✅ v0.1.0 |
| T2 | `npm publish --provenance`（Actions OIDC）——仅在 CI 承担 publish 后才有意义 | 缓议 |
| T3 | dsh-plugin.org 收录提交（badge 目标链接现 404；dsh-pubmed 已收录） | 待用户 |
| T4 | ~~`NPM_TOKEN` 仓库 secret 生效核验~~ 已关闭（用户决策 2026-09）：不再跟踪 CI 自动发布，发版以本机 `npm publish --registry=https://registry.npmjs.org` 为准 | 已关闭 |

---

## 3. 参考出处汇总（每个计划项的机制依据）

| 依据 | 位置（DSH 0.1.7-rc.2 实机核验） | 支撑哪一项 |
|---|---|---|
| extension 注销后 builtin 恢复 | `dsh-client-ui-sidebar-right/lib/types/client/tab-registry.d.ts`（"A kind may carry one builtin and one extension… the builtin resumes when the extension unregisters"）；`register()` 返回 disposer | R10 |
| body/title 按定义自身 `id` 分派 | 同包 `contract/slots.d.ts`（keyed seat `sidebar.right.pane.tab` + 渲染侧 `entryKey: definition.id`） | R0（既成事实）、R10 |
| 导航 `params` + `revision` 自增 | 同包 `contract/slots.d.ts`（`SidebarRightTabNavigation`） | R16 |
| tab 动作菜单 list slot | 同包 `contract/slots.d.ts`（`sidebar.right.tab.menu.item`，"entries decide their own visibility from the tab they are given"） | R10、R16 |
| 左栏 per-row slot 先例 | `dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts`（`sidebar.workspaces.session.row.action`） | 上游化论据（§4） |
| 原生图标组件 | `@deepseek-ai/dsh-client-ui-primitives`（`FileTypeIcon`/`classifyFileType`/`IconFolder*Regular`/`GuideArtworkFiles`，浏览器模块表种子词） | F2（已落地）、"不自绘图标"红线 |
| Host→Client 数据通道 | `dsh-client-connection` `fetch.register`（`/api` 鉴权栅栏）；社区先例 dsh-context 三条路由 | R2（已落地）、R15、R40 |
| 设置页模式 | dsh-context（SETTINGS_NAMESPACE + 设置 UI，本机已装） | R20/R21 |
| git 状态数据 | `dsh-workspace-changes`（`WorkspaceChangedFile`）；deliverables 的 `/api/changes.summary`、`/api/changes.diff` | R40 |
| `workspaceFiles` 无 mtime、`FsVersion` 内含 mtimeNs 但契约禁解析 | `dsh-api-workspace-files` types；`dsh-fs-local`（`versionOf`） | R2 的由来、上游化论据（§4） |
| 原生树无 per-row slot、行组件模块私有 | `dsh-client-ui-sidebar-files`（bundle 仅导出 `apply`/`inject`；零 slot 声明） | 接管路线的由来、上游化论据 |

---

## 4. 里程碑

| 版本 | 内容 | 验收 |
|---|---|---|
| **v0.0.1** | R0–R4：接管 + `@` 引用按钮 + 修改时间列 + 自动刷新 + 入口保留 | 35 离线用例绿；registry 端到端安装验证；真机目视 |
| **v0.0.2** | F1（裁切）+ F2（原生图标）+ D1（README 对齐 dsh-pubmed） | 41 离线用例绿；registry 安装验证；npmmirror 同步确认 |
| **v0.0.3** | R11 大小列 + R12 宽度自适应列 + R13 排序（偏好记忆） | 46 离线用例绿（新增格式化/分层/比较器/排序循环与持久化断言）；registry 端到端安装验证 |
| **v0.0.4** | **冷会话自愈**（Host 路由经 sessionPersistence 兜底解析根目录 + 层级 `no-workspace` 自动重试）+ 大小列布局细化（右对齐定宽 + 两格间距 + 右钉组） | 52 离线用例绿（新增冷会话兜底/整条路由/自愈重试/封顶断言）；registry 端到端安装验证；真机验证恢复场景 |
| **v0.1.0** | §2.1 全部（R10 运行时回退原生 + R15 快速过滤/定位 + R16 在文件树中定位与预览页签 `@文件` + R17 键盘导航与 a11y，见 §1.5）+ T1（CI 测试门） | 65 离线用例绿（新增菜单可见性/运行时开关/搜索路由与跳过清单/过滤 UI/reveal 展开/树语义/键盘导航/预览 `@文件` 断言）；registry 端到端安装验证；真机目视（用户已验证 R15/R17） |
| **v0.2.0** | §2.2 设置页 + §2.3 状态/性能（store 迁移 + 大列表） | 设置持久化与降级断言；大目录手测；全量绿 |
| 上游化 | 向 deepseek-harness 提 issue/PR：① `workspaceFiles` 条目加 `mtimeMs`；② 文件树 per-row action slot（左栏已有先例）；③ **右栏宽度持久化**（首次打开默认约 25%、记住用户调整——布局层目前完全无持久化，插件边界外无法规范实现，已向用户说明）。采纳后本插件退化为**纯增量扩展**，`/api` 路由退化为旧版本兼容兜底 | 讨论中（§4 战略项） |

---

## 5. 明确不做

- **隐藏点文件开关**（原 R14）——点文件与原生一致地直接显示（用户决策，2026-09）。
- **写操作（重命名/删除/移动）**：原生服务明确"no mutation"，`ctx.fs` 词汇表亦无对应能力；绕过策略缝做写操作风险大于价值，且与"agent 是写者"的定位冲突。最多评估"新建文件"（`ctx.fs.writeText` 的 `createIfAbsent` 语义现成）。
- **内嵌编辑器/预览**：文档预览 tab 已存在，不重复造轮子。
- **自绘图标**：一律运行时读取宿主 artwork（DESIGN §9）；自带字形仅作宿主不可用时的兜底。
- **TypeScript / 构建管线迁移**：零依赖纯 JS 免构建是 GitHub 直装与可审计的优势。
- **非 web 平台专门适配**：`dsh.client.platform: "web"`；兜底字形保证其他 shell 不崩即可。
- **替代 DESIGN.md 的详细设计**——本文只做总览与状态追踪。
