# 发布指南（Publish）

把 `dsh-at-sider` 发布到 npm registry，以及常见问题排错。

## 前置

- 已注册 npm 账号：<https://www.npmjs.com/>
- 包名未被占用：`npm view dsh-at-sider` 返回 404 = 可用
- **建议在 WSL / Linux / 普通终端执行 npm 命令**——DSH 的 pwsh 沙箱会拦截网络访问与完整权限升级，发布/校验会失败

## 发布步骤

```bash
# 1. 登录（输入用户名/密码/一次性验证码）
npm login --registry=https://registry.npmjs.org

# 2. 发布
cd <dsh-at-sider 仓库目录>
npm publish --registry=https://registry.npmjs.org

# 3. 验证
npm view dsh-at-sider
```

> ⚠️ 本机默认 registry 可能是镜像（如 `mirrors.cloud.tencent.com`），发布**必须显式**带
> `--registry=https://registry.npmjs.org`。

本包**没有构建步骤**：`client.js` 就是浏览器模块加载器格式的最终产物，`index.js` 就是
Host 端入口，`dependencies` 为空。因此发布前只需跑测试：

```bash
npm test          # node --test test/host.test.mjs test/client.test.mjs
```

## 版本管理

**所有 npm/git 命令都要在 `dsh-at-sider` 目录内执行**（在仓库根目录跑 `npm version` 会报
`ENOENT package.json`）：

```bash
cd <dsh-at-sider 仓库目录>

# 1. 内容改动先提交
git add -A && git commit -m "feat: 本次改动"

# 2. 升版本（自动：改 version + 提交 + 打 annotated 标签）
npm version patch   # 0.0.1 → 0.0.2
npm version minor   # → 0.1.0
npm version major   # → 1.0.0

# 3. 推代码 + 标签
git push --follow-tags

# 4. 发布
npm publish --registry=https://registry.npmjs.org
# 预发布：npm publish --tag next
```

> 升版本时请同步 `dsh.compatibility`：新版本若只在某个 DSH 版本上验证过，把该版本加进
> `dshReleases`，不要悄悄放宽旧的声明。

## 常见错误

| 错误 | 原因 | 解决 |
|---|---|---|
| `403 ... Two-factor authentication ... required` | 账号开了 2FA，发布需要验证码 | 在**真实交互终端**运行并输入验证器的 6 位码；或使用开启「Bypass 2FA」的 token |
| `404 Not Found - PUT .../dsh-at-sider` | `.npmrc` 里的 token 无效/没权限 → 被当成匿名 | 先删掉坏 token：`npm config delete //registry.npmjs.org/:_authToken`，再交互式发布；或重新生成 token（见下） |
| `403 Forbidden - GET .../-/whoami` | 包级 granular token 不支持 whoami（或 token 无效） | 属预期（若 token 只锁单个包）；能否发布以 `npm publish` 结果为准 |
| Windows `CreateFileMapping ... Win32 error 5`（ssh/网络） | Windows 沙箱拦截 | 在 WSL / 普通终端执行 |

## 自动化发布（可选）

生成 **Granular Access Token**（范围选 **All packages**，权限 **Read and write**，开启 **Bypass 2FA**）：

```bash
npm config set //registry.npmjs.org/:_authToken=<token>
npm publish --registry=https://registry.npmjs.org   # 不再需要验证码
```

推送 `v*.*.*` 标签时 [`.github/workflows/release.yml`](.github/workflows/release.yml) 会跑测试、
打 tarball、建 GitHub Release；仓库 secret 里配好 `NPM_TOKEN` 就顺带 `npm publish`，并调用
`scripts/sync-mirror.mjs` 让 npmmirror 尽快同步。

> 🔒 token 等同密码：只存本地/仓库 secret，勿提交 git、勿外泄。

## 发布后安装

```bash
# DSH 一键安装
dsh plugin --profile web add dsh-at-sider@latest
# 或普通 pnpm
pnpm add dsh-at-sider
```

本地目录调试则用 `link:`：

```bash
dsh plugin --profile web add link:C:/path/to/dsh-at-sider
```

详见 [`README.md`](README.md)（简体中文）/ [`README_EN.md`](README_EN.md) 与 [`docs/INSTALL.md`](docs/INSTALL.md)。
