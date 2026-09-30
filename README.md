# dsh-at-sider

**简体中文** | [English](README_EN.md)

[![npm version](https://img.shields.io/npm/v/dsh-at-sider)](https://www.npmjs.com/package/dsh-at-sider)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-at-sider)

> **给原生侧边栏文件树补上六件事：`@ 引用` · `文件大小` · `文件修改时间` · `排序` · `快速搜索定位` · `侧边栏底部 git commit 信息`**。
> 不换标签页、不改入口、不重绘图标——右侧栏的 **文件** 标签页还是原生那一个（同一 `Mod+P`、同一引导页胶囊、同一套图标与打开方式）：
>
> - 每一行：紧跟文件名的 **`@文件` 引用按钮** + 行尾的 **大小 / 修改时间** 两列（宽度自适应，永不裁切）；
> - 页头：**全工作区快速搜索**（递归整个工作区，结果可 `@`、可跳转）+ **排序**（名称/修改时间/大小/类型循环，偏好记忆）；
> - **底部 git 栏**：分支、领先/落后与最近提交摘要，**点击向上展开最近 20 条提交**；多仓库工作区可**切换仓库**，文件按状态着色（未跟踪/未暂存/已暂存）；
> - **文件预览页签右键**：一键 **`@文件`** 插引用、**在文件树中定位**（展开祖先并高亮该行）；
> - 需要对照原生时，右键「文件」页签即可**切回原生树**（无需卸载，随时切回）——全键盘可操作。

---

## 目录

- [🚀 安装（2 分钟上手）](#-安装2-分钟上手)
- [功能](#功能)
- [交互与效果](#交互与效果)
- [键盘与无障碍](#键盘与无障碍)
- [和原生一致的部分](#和原生一致的部分)
- [实现要点](#实现要点)
- [已知限制](#已知限制)
- [安装与卸载（完整）](#安装与卸载完整)
- [开发与测试](#开发与测试)
- [版本历史](#版本历史)
- [要求](#要求)
- [License](#license)

---

## 🚀 安装（2 分钟上手）

**前置**：先装 [Node.js ≥ 20](https://nodejs.org/)，再**全局安装 DSH CLI**（推荐，装完直接用 `dsh` 命令）：

```bash
npm install -g @deepseek-ai/dsh
dsh web        # 启动 DSH web 环境（未全局安装也可临时用 npx @deepseek-ai/dsh web）
```

启动后，一条命令安装本插件：

```bash
# 一条命令安装（官方 CLI，推荐）
dsh plugin --profile web add dsh-at-sider@latest
# 或从 GitHub：dsh plugin --profile web add github:aiyacharley/dsh-at-sider
# 或本机源码：dsh plugin --profile web add /path/to/dsh-at-sider
```

装完**重启 DSH**（`dsh web`），打开右侧栏的 **文件** 标签页（或按 `Mod+P`）。自检三步：

1. 鼠标移到任意一行上 → 文件名右侧出现 `@文件`（目录为 `@文件夹`）；
2. 每行最右侧显示 `2026-01-02 11:04` 这样的修改时间，悬停可见完整本地时间；
3. 点 `@文件` → 输入框里出现该文件的 `@引用`（按住 Alt/⌥ 点击则改为复制引用文本）。

> 零配置即可用；更多安装方式（Agent 代装、手动 patch、卸载）见文末[安装与卸载（完整）](#安装与卸载完整)。

---

## 功能

| 行内元素 | 行为 |
|---|---|
| `@文件` 按钮（目录为 `@文件夹`） | 把 `@路径`（含空格时 `@"路径"`，目录为 `@目录/`）作为原子文件引用插入当前会话输入框 —— 与内置 `@` 补全、内置拖入文件生成的引用完全一致。输入框不可达时自动降级为复制该引用文本。平时只在该行悬停/聚焦时出现。 |
| `@文件` + Alt/⌥ 单击 | 始终复制引用文本到剪贴板。 |
| 修改时间列 | 本地时间 `YYYY-MM-DD HH:mm`；悬停显示完整本地时间。stat 失败的条目该列留空。 |
| 大小列 | 常规文件显示人性化大小（`870 B`、`1.5 KB`、`1.2 MB`）；时间 tooltip 一并给出，大小列悬停显示精确字节数。 |
| 排序 | 页头按钮循环 **按名称 → 按修改时间 → 按大小 → 按类型**；目录始终在前，缺字段的条目沉底，偏好会记住（localStorage，尽力而为）。 |
| 自适应列 | 树体自测宽度分三档：≥380px 全列；300–379px 隐藏大小列；<300px 收起为 `@` + `MM-DD HH:mm`——窄侧栏不再出现内容被裁切。 |
| 运行时回退原生（R10） | **右键「文件」页签** → 「回退原生文件树」：立刻切回原生树（不需要卸载插件）；同一条目变为「启用增强版文件树」，点它切回增强版。注意：Harness 页签**没有 ⋯ 按钮，入口就是右键菜单**；回退期间增强树的展开状态不保留，重启后默认增强态。 |
| 在文件树中定位（R16） | **右键文件预览页签** → 「在文件树中定位」：自动聚焦文件树、逐层展开祖先目录、滚动到该行并**短暂高亮**（与键盘选中框同款描边）。 |
| 预览页签一键 `@文件`（R16） | **右键文件预览页签** → 「@文件」：把当前预览文件的引用直接插入输入框——与在文件区点行内 `@文件` 完全同效，不用回文件树找该行。 |
| 菜单出现位置 | 上述两个条目都只在**文件预览类页签**的右键菜单出现；「文件」页签与其他页签的右键菜单没有。Harness 页签没有 ⋯ 按钮，所以入口统一是**右键菜单**。 |
| Git 状态着色（R40a） | 文件行名字后有**状态色点**：未跟踪（绿）/ 有未暂存修改（琥珀）/ 已暂存（蓝），悬停说明；**侧栏底部**新增 git 状态栏：`⎇ 分支 ↑ahead ↓behind · 最近提交摘要（相对时间）`，**点击向上展开提交列表**（最近 20 条，最底下是最新提交并带 ● 标记）。**多仓库**：工作区本身无 git、而一级/二级子目录是独立仓库时，状态栏会出现**仓库下拉选择器**——选哪个仓库就显示哪个的分支/提交与文件色点。**无效仓库**（`.git` 损坏/不完整）在选择器中显示为禁用项，状态栏提示「不是有效的 Git 仓库」而不消失。不在 git 仓库（或没有 git 命令）时**零元素**；状态随列表读取并缓存 30 秒。 |
| 图标 | 沿用宿主原生图标，未做改动：`FileTypeIcon` + `classifyFileType`（按文件类型着色）、线性风文件夹图标、引导页胶囊的 `GuideArtworkFiles` —— 与原生树绘制所用组件完全一致。仅当这些导出不可用时，才回退到插件自带的简单字形。 |
| 页头 | 工作区根路径（悬停见全路径）、自动刷新开关、重新读取按钮。 |
| 行序 | 目录优先，其后按名称自然序（大小写不敏感）—— 与原生树一致。 |

自动刷新复用 Harness 自带的 `workspaceFiles.changes` 目录监听：工作区内保存文件即刷新已展开层级，不做轮询。

---

## 交互与效果

```
📁 src          @文件夹   2026-01-02 11:04
📄 README.md      @文件    2026-01-01 09:12
```

- `@文件` / `@文件夹` 平时隐藏，**悬停或键盘聚焦**时出现；单击插入引用，Alt/⌥ 单击复制；
  插入/复制后短暂显示 `已引用` / `已复制` / `失败`（1.4 s），随后回到名词标签。
- 修改时间用定宽 `YYYY-MM-DD HH:mm`（不随 locale 抖动），tooltip 给出完整本地时间。
- 目录可逐层展开；重新打开会重新读取该层；**展开状态与滚动位置按页签记忆**——打开文件预览再回来、或运行时切回原生再切回，都保持原样（页面重载后从头开始）。

---

## 键盘与无障碍

先鼠标点任意一行让焦点进入树，之后全程键盘操作：

| 按键 | 行为 |
|---|---|
| ↑ / ↓ | 焦点在可见行之间逐行移动（跨层级连续） |
| → | 目录未展开 → 展开；已展开 → 焦点进入第一个子行 |
| ← | 目录已展开 → 折叠；文件/子行 → 回到父目录行 |
| Home / End | 第一个 / 最后一个可见行 |
| Enter / Space | 目录 = 展开/折叠；文件 = 在侧栏打开 |
| `@` | 该行引用**插入输入框** |
| Tab | 一次即离开整棵树（roving tabindex，不会逐行走） |

无障碍语义：根列表 `role="tree"`、行 `role="treeitem"`（带 `aria-level` / `aria-expanded`）、嵌套层 `role="group"`；搜索结果数量经 `aria-live` 播报。在文件树中定位时的高亮与键盘焦点框同款。

---

## 和原生一致的部分

- **标签页身份不变**：仍是 `files` 类型 —— `Mod+P` 快捷键、引导页「工作区文件」胶囊、标签标题都来自同一处注册；
- **图标沿用原生**：文件按类型着色的 `FileTypeIcon`、目录的原生线性风文件夹图标、引导页胶囊的 `GuideArtworkFiles`，全部在运行时读取宿主自己的组件，没有自绘复制；
- **打开方式不变**：点行仍通过 `dsh-resource://file/session/...` 把文件开进侧栏；
- **行序不变**：目录优先，其后按名称自然序（大小写不敏感），与原生树同一套排序。

---

## 实现要点

原生文件树没有 per-row 扩展点（行组件是模块私有的，该包也没有声明任何行内 slot），想要更丰富的行只能自己提供 body：以 `extension` 优先级注册一个**同 kind**（`files`）的 tab 类型即可接管 builtin，其 body/title 按定义自身的 `id` 分派，因此不存在 key 冲突。

修改时间在任何 Client 侧数据源里都不存在：`workspaceFiles` 的目录条目只有 `{ name, type, size? }`，文件 `version` 令牌按契约不可解析。因此 Host 半自己提供两条受鉴权保护的路由：

```
POST /api/dsh-at-sider/list     { sessionId, path }
  -> { ok: true, value: { path, root, entries: [{ name, type, mtimeMs, size? }], truncated } }

POST /api/dsh-at-sider/search   { sessionId, query }
  -> { ok: true, value: { query, matches: [{ name, path, dir, type, mtimeMs, size? }], truncated } }
```

两条路由都被限制在会话工作区根内（请求路径先对根解析，越界即拒绝），只做只读访问（绝不读取文件内容）。列表每层最多 2000 条、`stat` 并发上限 32；搜索递归整个工作区，跳过 `node_modules`/`.git`、不进入符号链接目录、深度上限 12、结果上限 200，且只对命中项取 `mtimeMs`。

页面侧的另外三处机制：**动作菜单**（`sidebar.right.tab.menu.item` 列表 seat，条目拿到自己所在的 `tab` 与 `dismiss`）承载「回退原生」「在文件树中定位」「@文件」；**运行时回退**靠注销/重注册 tab 类型定义实现（注销后 builtin 立即恢复）；**定位**通过 `openTab('files', { params: { reveal } })` 把目标路径交给文件树，body 依 `tab.navigation.params` 展开祖先链并高亮该行。完整的取舍记录与被否决的替代方案见 [docs/DESIGN.md](docs/DESIGN.md)。

---

## 已知限制

- 内置 `files` body 是被**遮蔽**而非组合：本插件加载期间原生树不渲染；卸载后**原样恢复**，或随时右键「文件」页签用「回退原生文件树」即时切回（本插件不修改任何原生代码）。
- 展开状态与滚动位置按页签记忆（模块级），预览往返与运行时切换都不丢；但**层级数据不缓存**（回到已展开层会重新读取）且**页面重载后**两者从头开始——完整迁移到 slot store 见 ROADMAP R30。
- Git 状态来自 Host 半的 `git status`/`git log` 子进程（30 秒缓存、单次调用去重、超时与输出上限）；不在 git 仓库时零元素。工作区是仓库**子目录**时按 `--show-prefix` 前缀映射；重命名记录以新路径为准。`.git` 存在但**无效**（如缺 HEAD）的目录在选择器中显示为禁用项并提示，不会让状态栏消失。
- 修改时间与搜索都依赖 `node:fs`（`ctx.fs` 不暴露时间字段），位于其策略缝之外；两条路由因此都自带工作区包含性校验。
- Client 半镜像了原生树的少量私有细节（行序、`dsh-resource://` 地址文法、输入框引用插入调用、页签动作菜单 seat、`openTab` 的导航参数与 `TabRecord.contentId`）。每处都有降级路径（输入框不可达则退化为复制；watch 不可用则退回手动刷新；菜单 seat 缺失只是少两个菜单条目）；构建与测试所依据的版本写在 `package.json` 的 `dsh.compatibility`。
- 插件自带的简单字形只在宿主图标不可用时兜底，正常环境下不会出现。

---

## 安装与卸载（完整）

### 安装

**1. 一条命令（官方 CLI，推荐）**

```bash
dsh plugin --profile web add dsh-at-sider@latest
# 或从 GitHub：dsh plugin --profile web add github:aiyacharley/dsh-at-sider
# 或本机源码：dsh plugin --profile web add /path/to/dsh-at-sider
```

**2. 复制粘贴给 Agent 自动安装**：

````text
【请帮我持久化安装 dsh-at-sider（重启后所有会话可用）】
1) 确认 DSH profile 名称（如 web；不确定就先问）。
2) 运行 dsh plugin --profile <名称> add dsh-at-sider@latest。
3) 提示用户重启 DSH web（Host 半的列表与搜索路由需要重启才注册）。
4) 重启后自检：右侧栏「文件」标签页悬停任意行应出现 @文件、行尾应有大小与修改时间；页头应有搜索框；右键「文件」页签菜单里应有「回退原生文件树」；打开任一文件预览后右键该页签应有「在文件树中定位」与「@文件」。
````

**3. 手动（可选）**

- profile 的 bundle 层：在 `~/.dsh/profiles/<名称>/package.json` 的 `dependencies` 加
  `"dsh-at-sider": "link:/path/to/dsh-at-sider"`，并把 `"dsh-at-sider"` 加进 `dsh.profile.bundles`，再 `pnpm install` → 重启；
- 或直接把 [cordis.patch.yml](cordis.patch.yml) 的 insert 行并入自己的 patch 层 → 重启。

### 更新

```bash
dsh plugin --profile web update dsh-at-sider@latest     # 或 @0.2.0 指定版本
```

更新后**重启 DSH** 生效。

> 开发中改了 `client.js` 却"重启也没生效"？Client 产物按文件元数据（mtime/ctime/size）派生的
> `rev` 寻址，**旧 rev 的请求会被拒绝而不是返回新字节**。先浏览器硬刷新（Ctrl+Shift+R）；
> 仍不行就卸载重装（重装会触发实时重扫并发布新 rev，无需重启）——`link:` 安装指向工作树本身，
> 没有失效，是版本戳层级的问题。详见 [docs/INSTALL.md](docs/INSTALL.md) 排错表。

### 卸载

- 一条命令：`dsh plugin --profile web remove dsh-at-sider` → 重启；
- 本地 link 安装：从 profile 的 `package.json` 删掉依赖与 `dsh.profile.bundles` 里的条目，再 `pnpm install` → 重启；
- 卸载后原生文件树原样恢复；只是想在增强版与原生之间来回切，不需要卸载——右键「文件」页签用「回退原生文件树」即可。

> 排查（装了却没变化、时间列为空等）见 [docs/INSTALL.md](docs/INSTALL.md)。

---

## 开发与测试

```bash
npm test          # node --test，83 个用例，全离线（无网络、无浏览器；git 用例使用真实 git）
```

- 本插件**无依赖、无构建**：`client.js` 就是浏览器模块加载器格式的最终产物，`index.js` 就是 Host 端入口；
- 测试按模块系统的实际加载方式载入 `client.js`（在 `new Function` 中注入 `window`、`navigator`、`fetch`），并用极小的 React shim 驱动真实组件：包含性校验、每层列表与 `mtimeMs`、两条路由的契约（列表 + 搜索的跳过清单/上限/深度）、接管定义与运行时开关、菜单条目可见性、`@路径` 文法与资源地址解析、输入框插入与剪贴板降级、按钮标签、宿主图标路径与其兜底、行盒模型、树语义（`role`/`aria-level`）、键盘导航分支，以及整棵树的渲染冒烟与快速过滤/定位交互；
- 变更说明见 [CHANGELOG.md](CHANGELOG.md)，设计取舍见 [docs/DESIGN.md](docs/DESIGN.md)，发布流程见 [PUBLISH.md](PUBLISH.md)。

---

## 版本历史

- **v0.2.0** — **底部 git 信息栏**（文件行按未跟踪/未暂存/已暂存三态着色；底部常驻 `⎇ 分支 · 最近提交摘要`，点击向上展开最近 20 条提交；悬停完整 hash/作者/时间）；**多仓库工作区**（工作区无 git 而一/二级子目录是独立仓库时，底栏出现仓库选择器，切换后色点与提交信息随仓库重锚定；无效 `.git` 显示为禁用项并提示，不静默消失）；git 状态经有界子进程读取并缓存（跳过无效仓库）。基于真实多仓库工作区实测；83 个离线测试。
- **v0.1.1** — 修复：**展开目录 → 打开文件预览 → 回到文件页后，展开状态不再丢失**（与原生树行为一致：按页签记入模块级记忆；运行时切回原生再切回同样保留。层级数据仍会重读、页面重载后从头开始——完整迁移见 ROADMAP R30）；文档记录 client 产物 `rev` 缓存层的"重启未生效"排查阶梯（硬刷新 → 重装）；测试 shim 升级为按组件实例保存 hooks；66 个离线测试。
- **v0.1.0** — 首个功能版本：**运行时回退原生**（右键「文件」页签，在增强树与原生树之间切换，无需卸载）；**快速过滤/定位**（页头搜索框全工作区递归搜索——跳过 node_modules/.git、上限 200，结果带 `@` chip，点文件打开、点目录回树展开）；**在文件树中定位**（右键文件预览页签，自动展开祖先并高亮该行）；**预览页签一键 `@文件`**（右键文件预览页签直接插引用）；**键盘导航与 a11y**（↑↓/←→/Home/End/`@`、roving tabindex、`role=tree` 语义）；65 个离线测试。
- **v0.0.4** — 修复重启后恢复的文件 tab 显示"没有工作区目录"需手动重读（Host 冷会话经 sessionPersistence 兜底解析根目录；失败层级自动重试自愈，最多 2 次）；大小列布局细化（右对齐定宽 + 与日期两格间距，整组右钉）；52 个离线测试。
- **v0.0.3** — 新增大小列（人性化字节 + 精确 tooltip）、排序（名称/修改时间/大小/类型循环，目录恒在前，偏好记忆）、宽度自适应列（≥380px 全列 / 300–379px 隐大小 / <300px 收起为 `@` + 短时间）；46 个离线测试。
- **v0.0.2** — 修复修改时间列被裁切（行改回 `border-box`）；文件/目录图标恢复为宿主原生图标（`FileTypeIcon` + `classifyFileType`、`IconFolder*Regular`、`GuideArtworkFiles`），自带字形仅作兜底；README 结构对齐 dsh-pubmed（中文主文档 + `README_EN.md` + npm/listing badge）。
- **v0.0.1** — 首个版本：以 `extension` 接管 `files` tab，行内 `@文件`/`@文件夹` 引用按钮 + 行尾修改时间列；Host 半 `/api/dsh-at-sider/list` 列表路由（工作区受限、2000 条上限、32 并发）；41 个离线测试。

> 逐版提交细节见 [git tags](https://github.com/aiyacharley/dsh-at-sider/tags)；设计文档见 [docs/DESIGN.md](docs/DESIGN.md)；路线图（已完成/计划/里程碑）见 [docs/ROADMAP.md](docs/ROADMAP.md)。

---

## 要求

- DSH `0.1.7-rc.2`（web profile），已在 version 上实测（`package.json` 的 `dsh.compatibility` 声明）
- Node.js ≥ 20（Host 半使用 `node:fs/promises`）

---

## License

MIT，见 [LICENSE](LICENSE)。

- 文件类型判定与图标（`FileTypeIcon`、`classifyFileType`、`IconFolder*Regular`、`GuideArtworkFiles`）来自 DSH 自带的
  `@deepseek-ai/dsh-client-ui-primitives`，**运行时读取、不做复制**；插件自带的简单字形仅在其不可用时兜底。
- tab 接管与运行时回退、`@路径` 引用、修改时间/大小列、排序与自适应、快速过滤与搜索路由、定位与页签菜单条目、键盘导航与树语义，均为本插件原创实现。
