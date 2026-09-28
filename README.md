# dsh-at-sider

**简体中文** | [English](README_EN.md)

[![npm version](https://img.shields.io/npm/v/dsh-at-sider)](https://www.npmjs.com/package/dsh-at-sider)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-at-sider)

> **给原生侧边栏文件树补上「@ 引用 + 修改时间」**：不换标签页、不改入口、不重绘图标——
> 右侧栏的 **文件** 标签页还是原生那一个（同一 `Mod+P`、同一引导页胶囊、同一套图标与打开方式），
> 只是每一行多了一个紧跟文件名的 **`@文件` 引用按钮**，和行尾固定的 **修改时间**。

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
| 在文件树中定位（R16） | **右键文件预览页签** → 「在文件树中定位」：自动聚焦文件树、逐层展开祖先目录、滚动到该行并**短暂高亮**（与键盘选中框同款描边）。只在文件预览类页签的右键菜单出现，「文件」页签和其他页签没有。 |
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
- 目录可逐层展开；重新打开会重新读取该层，展开状态与滚动位置在切换标签页后保留。

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

修改时间在任何 Client 侧数据源里都不存在：`workspaceFiles` 的目录条目只有 `{ name, type, size? }`，文件 `version` 令牌按契约不可解析。因此 Host 半自己提供一条受鉴权保护的路由：

```
POST /api/dsh-at-sider/list   { sessionId, path }
  -> { ok: true, value: { path, root, entries: [{ name, type, mtimeMs, size? }], truncated } }
```

列表被限制在会话工作区根内（请求路径先对根解析，越界即拒绝），每层最多 2000 条，`stat` 并发上限 32，且只做只读列表（绝不读取文件内容）。完整的取舍记录与被否决的替代方案见 [docs/DESIGN.md](docs/DESIGN.md)。

---

## 已知限制

- 内置 `files` body 是被**遮蔽**而非组合：本插件加载期间原生树不渲染；卸载后**原样恢复**（本插件不修改任何原生代码）。
- 修改时间来自 `node:fs`（`ctx.fs` 不暴露时间字段），位于其策略缝之外；该路由因此自带工作区包含性校验。
- Client 半镜像了原生树的少量私有细节（行序、`dsh-resource://` 地址文法、输入框引用插入调用）。每处都有降级路径（输入框不可达则退化为复制；watch 不可用则退回手动刷新）；构建与测试所依据的版本写在 `package.json` 的 `dsh.compatibility`。
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
3) 提示用户重启 DSH web（Host 半的列表路由需要重启才注册）。
4) 重启后自检：右侧栏「文件」标签页悬停任意行应出现 @文件，行尾应显示修改时间。
````

**3. 手动（可选）**

- profile 的 bundle 层：在 `~/.dsh/profiles/<名称>/package.json` 的 `dependencies` 加
  `"dsh-at-sider": "link:/path/to/dsh-at-sider"`，并把 `"dsh-at-sider"` 加进 `dsh.profile.bundles`，再 `pnpm install` → 重启；
- 或直接把 [cordis.patch.yml](cordis.patch.yml) 的 insert 行并入自己的 patch 层 → 重启。

### 更新

```bash
dsh plugin --profile web update dsh-at-sider@latest     # 或 @0.0.2 指定版本
```

更新后**重启 DSH** 生效。

### 卸载

- 一条命令：`dsh plugin --profile web remove dsh-at-sider` → 重启；
- 本地 link 安装：从 profile 的 `package.json` 删掉依赖与 `dsh.profile.bundles` 里的条目，再 `pnpm install` → 重启；
- 卸载后原生文件树原样恢复。

> 排查（装了却没变化、时间列为空等）见 [docs/INSTALL.md](docs/INSTALL.md)。

---

## 开发与测试

```bash
npm test          # node --test，41 个用例，全离线（无网络、无浏览器）
```

- 本插件**无依赖、无构建**：`client.js` 就是浏览器模块加载器格式的最终产物，`index.js` 就是 Host 端入口；
- 测试按模块系统的实际加载方式载入 `client.js`（在 `new Function` 中注入 `window`、`navigator`、`fetch`），并用极小的 React shim 驱动真实组件：包含性校验、每层列表与 `mtimeMs`、路由契约、接管定义、`@路径` 文法与资源地址、输入框插入与剪贴板降级、按钮标签、宿主图标路径与其兜底、行盒模型，以及整棵树的渲染冒烟；
- 变更说明见 [CHANGELOG.md](CHANGELOG.md)，设计取舍见 [docs/DESIGN.md](docs/DESIGN.md)，发布流程见 [PUBLISH.md](PUBLISH.md)。

---

## 版本历史

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
- tab 接管、`@路径` 引用、修改时间列表与 `/api` 列表路由为本插件原创实现。
