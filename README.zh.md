# dsh-at-sider

中文 | [English](README.md)

给 **原生** DeepSeek Harness 右侧边栏文件树补上两项能力的 DSH 插件：

1. 每行紧跟文件名一个 **`@` 引用按钮** —— 单击即把规范的 `@路径` 引用插入输入框（⌥/Alt 单击改为复制该引用文本）；
2. 行尾固定显示该条目的 **修改时间**，悬停可见完整本地时间。

```
📁 src            @   2026-01-02 11:04
📄 README.md      @   2026-01-01 09:12
```

它不是"第二个侧边栏"，而是"文件+树"：原生 `files` 标签页保持原有身份（同一 tab kind、同一 `Mod+P` 快捷键、同一引导页入口、同一"工作区文件"名称），只是改由本插件绘制内容。

## 安装

```bash
# 安装到 web profile（路径按实际情况替换）
dsh plugin --profile web add link:C:/path/to/dsh-at-sider
```

再把 bundle id 加进 profile 的 `dsh.profile.bundles` 列表
（`~/.dsh/profiles/web/package.json`），然后重启 `dsh web`：

```json
"dsh": { "profile": { "bundles": [ "...", "dsh-at-sider" ] } }
```

若你的 Harness 提供 Plugin Hub 工具，用 `install_bundle` 指定本目录为 `target` 即可一次完成上面两步。Plugin Hub 方式、手动方式、卸载与排错见 [docs/INSTALL.md](docs/INSTALL.md)。

Host 半（列表路由）需要重启后生效；Client 半遵循插件 HMR 的常规规则。

## 功能

| 行内元素 | 行为 |
|---|---|
| `@` 按钮 | 把 `@路径`（含空格时 `@"路径"`，目录为 `@目录/`）作为原子文件引用插入当前会话输入框 —— 与内置 `@` 补全、内置拖入文件生成的引用完全一致。输入框不可达时自动降级为复制该引用文本。 |
| `@` + ⌥/Alt 单击 | 始终复制引用文本到剪贴板。 |
| 修改时间列 | 本地时间 `YYYY-MM-DD HH:mm`；悬停显示完整本地时间。stat 失败的条目该列留空。 |
| 页头 | 工作区根路径、自动刷新开关、重新读取按钮。 |
| 行序 | 目录优先，其后按名称自然序（大小写不敏感）—— 与原生树一致。 |

自动刷新复用 Harness 自带的 `workspaceFiles.changes` 目录监听：工作区内保存文件即刷新已展开层级，不做轮询。

## 实现要点

原生文件树没有 per-row 扩展点（行组件是模块私有的，该包也没有声明任何行内 slot），所以想要更丰富的行只能自己提供 body：以 `extension` 优先级注册一个**同 kind**（`files`）的 tab 类型即可接管 builtin，其 body/title 按定义自身的 `id` 查找。这就是本插件的 Client 半。

修改时间在任何 Client 侧数据源里都不存在：`workspaceFiles` 的目录条目只有 `{ name, type, size? }`，文件 `version` 令牌按契约不可解析。因此 Host 半自己提供一条受鉴权保护的 Fetch 路由：

```
POST /api/dsh-at-sider/list   { sessionId, path }
  -> { ok: true,  value: { path, root, entries: [{ name, type, mtimeMs, size? }], truncated } }
  -> { ok: false, error: { code, message } }
```

列表被限制在会话工作区根内（请求路径先对根解析，越界即拒绝），每层最多 2000 条，`stat` 并发上限 32。被评估并否决的其他方案记录在 `docs/DESIGN.md`。

## 环境要求

- DeepSeek Harness `0.1.7-rc.2`（`package.json` 中已声明兼容），web profile。
- Node.js 20+（Host 半使用 `node:fs/promises`）。

## 已知限制

- 内置 `files` body 是被**遮蔽**而非组合：本插件加载期间原生树不再渲染，卸载即完全恢复。
- Client 半镜像了原生树的少量私有细节（行序、`dsh-resource://file/...` 地址文法、输入框引用插入调用）。每处都有降级路径（输入框不可用则退化为复制；watch 不可用则退回手动刷新），但未来 Harness 版本仍可能改变行为；构建与测试所依据的版本已写入 `dsh.compatibility`。
- 修改时间来自 `node:fs`，位于 `ctx.fs` 策略缝之外；该路由因此自带工作区包含性校验，且只做只读列表，绝不读取文件内容。

## 开发

```bash
node --test test/host.test.mjs test/client.test.mjs
```

Client 产物是浏览器模块加载器格式的纯 JavaScript（无构建步骤）。测试按模块系统的实际加载方式载入它（在 `new Function` 中注入 `window`、`navigator`、`fetch`），并用一个极小的 React shim 驱动真实组件。

## 许可

MIT，见 [LICENSE](LICENSE)。
