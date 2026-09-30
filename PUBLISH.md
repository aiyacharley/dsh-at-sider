# 发布指南（Publish）

把 `dsh-at-sider` 发布到 npm registry，以及常见问题排错。

## 前置

- 已注册 npm 账号：<https://www.npmjs.com/>
- 包名未被占用：`npm view dsh-at-sider` 返回 404 = 可用
- **沙箱受限时需要普通终端**——DSH 的 pwsh 只读/工作区写沙箱会拦截网络访问；本机已在
  `danger-full-access` 下直接发布成功（0.0.1–0.2.0 均如此），受限时才改用 WSL / Linux / 普通终端

## 发布步骤

```bash
# 1. 登录（输入用户名/密码/一次性验证码）
npm login --registry=https://registry.npmjs.org

# 2. 发布
cd <dsh-at-sider 仓库目录>
npm publish --registry=https://registry.npmjs.org

# 3. 验证（registry 元数据有 CDN 滞后，刚发布可能查不到；用 --prefer-online 并等几分钟再查）
npm view dsh-at-sider versions --json --registry=https://registry.npmjs.org --prefer-online
```

> ⚠️ 本机默认 registry 可能是镜像（如 `mirrors.cloud.tencent.com`），发布**必须显式**带
> `--registry=https://registry.npmjs.org`。

> ℹ️ 发布返回 `+ dsh-at-sider@x.y.z` 即为 registry 已接受；随后 `npm view` 仍可能因元数据
> 传播滞后而查不到（0.0.3 实测滞后约 10 分钟）。**不要在滞后期间重复 publish**，否则会以
> `EPUBLISHCONFLICT` 告终（该错误恰好证明第一次已成功）。

本包**没有构建步骤**：`client.js` 就是浏览器模块加载器格式的最终产物，`index.js` 就是
Host 端入口，`dependencies` 为空。因此发布前只需跑测试：

```bash
npm test          # node --test test/host.test.mjs test/client.test.mjs
```

推送 `main` 或提 PR 时 [`.github/workflows/test.yml`](.github/workflows/test.yml) 会跑同一套
测试；tag 推送时 [`.github/workflows/release.yml`](.github/workflows/release.yml) 会打 tarball、
建 GitHub Release。

## 版本管理

**所有 npm/git 命令都要在 `dsh-at-sider` 目录内执行**（在仓库根目录跑 `npm version` 会报
`ENOENT package.json`）。本仓实际采用的流程（与工作区约定一致：发版提交用
`chore(release): X.Y.Z`）：

```bash
cd <dsh-at-sider 仓库目录>

# 1. 功能改动先提交（feat/fix，含测试与文档）
git add -A && git commit -m "feat: 本次改动"

# 2. 同步版本号与文档（一步到位）
#    - package.json 的 version 改成 X.Y.Z
#    - CHANGELOG 的 Unreleased 折叠成 ## X.Y.Z
#    - README.md / README_EN.md 版本历史加条目、用例数更新
#    - docs/ROADMAP.md 当前版本 / 已完成范围 / 里程碑状态更新
git add -A && git commit -m "chore(release): X.Y.Z"

# 3. 打 annotated 标签并推送
git tag -a vX.Y.Z -m "dsh-at-sider X.Y.Z: <一句话>"
git push origin main && git push origin vX.Y.Z

# 4. 发布（本机，见上文）
npm publish --registry=https://registry.npmjs.org
# 预发布：npm publish --tag next
```

> 也可以用 `npm version minor`（自动改 version + 提交 + 打标签），但它生成的提交信息不带
> `chore(release):` 前缀、也不会同步 CHANGELOG/README/ROADMAP——用 `npm version --no-git-tag-version`
> 改完再手工按上面第 2、3 步走更稳。

> 升版本时请同步 `dsh.compatibility`：新版本若只在某个 DSH 版本上验证过，把该版本加进
> `dshReleases`，不要悄悄放宽旧的声明。

> 供应链加分项 `npm publish --provenance`（Actions OIDC）**暂缓**：它只在 CI 承担 publish 时
> 才有意义，而本仓发版以本机为准（ROADMAP §2.5 T2）。

## 常见错误

| 错误 | 原因 | 解决 |
|---|---|---|
| `403 ... Two-factor authentication ... required` | 账号开了 2FA，发布需要验证码 | 在**真实交互终端**运行并输入验证器的 6 位码；或使用开启「Bypass 2FA」的 token |
| `404 Not Found - PUT .../dsh-at-sider` | `.npmrc` 里的 token 无效/没权限 → 被当成匿名 | 先删掉坏 token：`npm config delete //registry.npmjs.org/:_authToken`，再交互式发布；或重新生成 token（见下） |
| `403 Forbidden - GET .../-/whoami` | 包级 granular token 不支持 whoami（或 token 无效） | 属预期（若 token 只锁单个包）；能否发布以 `npm publish` 结果为准 |
| Windows `CreateFileMapping ... Win32 error 5`（ssh/网络） | Windows 沙箱拦截 | 给该次操作放开沙箱，或在 WSL / 普通终端执行 |
| `EPUBLISHCONFLICT` / `403 ... cannot publish over the previously published versions` | 该版本已在 registry 上（常见于元数据滞后期间重试发布） | 属预期：**证明此前的 publish 已成功**；用 `npm view dsh-at-sider versions --json --prefer-online` 确认，不要重复发同一版本 |

## 自动化发布（可选，当前未启用）

生成 **Granular Access Token**（范围选 **All packages**，权限 **Read and write**，开启 **Bypass 2FA**）：

```bash
npm config set //registry.npmjs.org/:_authToken=<token>
npm publish --registry=https://registry.npmjs.org   # 不再需要验证码
```

推送 `v*.*.*` 标签时 [`.github/workflows/release.yml`](.github/workflows/release.yml) 会跑测试、
打 tarball、建 GitHub Release；仓库 secret 里配好 `NPM_TOKEN` 时它还会顺带 `npm publish` 并调用
`scripts/sync-mirror.mjs` 让 npmmirror 尽快同步。

> ⚠️ **本仓当前不依赖这条路径**：`NPM_TOKEN` secret 的生效问题已由用户决策关闭（ROADMAP §2.5
> T4），0.0.1–0.2.0 全部由**本机 `npm publish`** 发布。release.yml 仍会建 GitHub Release，但
> 「是否已发布到 npm」以本机发布结果 + `npm view` 为准。

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
