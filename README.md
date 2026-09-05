# DeepSeek Harness 桌面版（DeepSeek Harness Desktop）

> **这是社区（非官方）构建**。上游 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 采用 MIT 协议开源，本仓库是 Electron 桌面外壳 + 自动打包脚本 + 自研预置插件集合。DeepSeek 的名称和鲸鱼 Logo 为 DeepSeek 的商标，此处仅用于标识所打包的上游软件。

---

## 🎯 什么是 DeepSeek Harness 桌面版？

把官方 DeepSeek Harness（`@deepseek-ai/dsh`）封装成可直接下载安装的桌面程序，**无需在系统中安装 Node.js、npm、或终端**。打开 App，填入你的 DeepSeek API Key，即可让 AI 在本机执行任务（读写文件、运行命令、写代码、自动化操作等）。

## ✨ 本版本与众不同的特性

- **从 GitHub 直接拉取更新**：托盘/菜单新增「从 GitHub 拉取更新…」—— 查询实际发布仓库的最新 release（不依赖 electron-updater 的签名与 latest.yml），发现新版本列出变更说明，下载对应平台安装包（Windows `setup.exe` / macOS `.dmg`）并打开；`electron-builder.yml` 的 `publish.owner` 已修正为实际发布仓库 `lxfebd/dsh-desktop-unified`，修复了此前每 4 小时自动更新请求打到旧仓库而 404 的问题。
- **6 款内置预置插件**（开箱即用，无需额外安装）：
  - `dshmarket` — 官方插件市场
  - `dsh-plugin-version-manager` — 插件版本管理
  - `dsh-shell-control` — 终端 & 命令面板
  - `dsh-desktop-preset-transfer` — 预置插件传输（实现跨机器一致预置）
  - `dsh-terminal` — 系统终端（Shell）
  - `dsh-market-tools` — **自研 AI 工具插件**（市场列表/安装/卸载/更新 4 个 `market_*` 工具，100% 转调官方 `/dsh-market/*` 路由）
- **AI 可自行安装/更新/卸载插件**：修复了 dshmarket running-agent 守卫会拦截发起者自身的问题（发起安装的 agent 在请求瞬间必处于 running），现在 agent 发起的插件变更不再被自身的 running 状态 409 挡回，同时仍阻止其他正在运行的 agent 的变更。
- **插件保护机制**：内置插件 (`link:/file:` 类型) 被硬阻止卸载/更新，防止意外破坏预置链。  
- **多 profile 支持**：在同一套实例里可管理多套独立配置（如 `web`、`web-desktop` 等），互不干扰。  
- **安全模式与自愈**：插件崩溃时进入安全模式摘除故障插件；重启后自动尝试恢复被摘除的预置插件（依赖仍在时挂回），日志可见 `preset bundle re-attached after safe-mode drop`。  
- **单实例托盘驻留**：关闭窗口只最小化到系统托盘，后台任务继续运行；托盘图标提供「Show」、「Quit」、打开日志/数据目录等入口。  
- **完整的本地开发链路**：基于 TypeScript ESM + pnpm 11.22 + Vitest，`just` 命令一键安装/开发/打包。  

## 🗒️ 本次版本更新（v0.1.2-rc.1.202609041312）

- **新增「从 GitHub 拉取更新…」**（托盘 + 应用菜单）：GitHub API 查最新 release → semver 比较（支持 `-rc.x` prerelease）→ 按平台选安装包 → 流式下载（进度通知）→ 打开/定位安装包；网络失败一键跳发布页。
- **修复**：dshmarket running-agent 守卫自拦截（AI 无法自行装插件）；会话完成通知对启动时的陈旧会话误报；启动预热误删 profile 下真实包目录；快捷方式图标更新脚本从无效 PowerShell（解析错误）重写为按目标程序过滤的正确实现；`preset-deps` 将 `~0.1.2` 波打号 semver 误判为本地路径导致市场安装 404；shell-control 重启定时器未清理（退出窗口内可能二次 relaunch）等 8 处缺陷。
- **修复自动更新 404**：`publish.owner` 与实际发布仓库不一致，导致 electron-updater 每 4 小时请求不存在的仓库 release；已修正（需随新安装包发布生效）。
- **质量门禁**：Vitest 9 文件 62 用例 + 插件 node:test 5 用例全绿；`tsc --noEmit` 0 错误。

## 📦 安装方式

最新安装包从 **GitHub Releases** 下载：<https://github.com/lxfebd/dsh-desktop-unified/releases>（Windows `*-setup.exe` / macOS `*.dmg`）。  
应用内自动更新：Windows 每 4 小时后台检查 + 托盘「检查更新…」手动触发；macOS 未签名构建请用托盘「从 GitHub 拉取更新…」或直接前往 Releases 页下载。  
拥有源码（例如经维护者直接共享）时，也可直接执行下面的本地开发步骤。

## 🖥️ 使用方法

1. 解压/克隆源码到本地  
2. 按「本地开发」步骤安装依赖并启动  
3. 应用启动后，在托盘图标或设置页中填入你的 [DeepSeek API Key](https://platform.deepseek.com/)  
4. 开始对话：让 AI 帮你完成读写文件、执行命令、写代码等任务  

### 数据与日志存放位置

- **应用数据目录**（对话、配置、会话、插件状态等）：系统标准位置，不会污染你的用户家目录  
  - Windows：`%APPDATA%\DeepSeek Harness`  
  - macOS：`~/Library/Application Support/DeepSeek Harness`  
- **诊断日志**：应用数据目录下的 `logs/dsh.log`（首要排查入口）  
- **托盘菜单**：可直接打开「Open log」与「Open data directory」  

## ⚙️ 它是如何工作的

1. **内置 Node 运行时**：使用 Electron 自带的 Node.js，以及官方发布的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) 包，**不对系统安装任何东西**；插件市场联网安装由内置独立版 pnpm 完成，同样无需系统 Node / npm。  
2. **本地 `dsh web` 服务**：启动时在 `127.0.0.1` 上启动 `dsh web`（默认端口 3080，被占用则自动尝试 3081、3082...），仅监听本地回环地址，不对外暴露。  
3. **原生窗口加载**：一个 Electron `BrowserWindow` 渲染该本地 UI，获得桌面软件体验，并通过单实例锁确保只有一个窗口（第二次启动会聚焦已有窗口）。  
4. **系统托盘**：窗口最小化到托盘后，后台 `dsh web` 进程和所有任务继续运行；点托盘图标选择「Show」可恢复窗口，「Quit」才是真正退出（会同步关闭子进程）。  

## 🧱 技术栈与工具链

| 维度 | 选择 | 说明 |
|------|------|------|
| 运行时 | Electron 43（内嵌 Node 22/24） | 不依赖系统 Node |
| 语言 | TypeScript，ESM（`"type": "module"`） | `target: ES2022`，`moduleResolution: NodeNext`，`strict` |
| 包管理 | **pnpm 11.22.0**（hoisted 模式） | 见下方关键约束，**禁止使用 npm**；版本须与 `@pnpm/exe` 对齐 |
| 任务运行 | **just**（`justfile`） | 所有命令优先走 just |
| 打包 | electron-builder 26 | 生成 macOS（dmg+zip）和 Windows（nsis）安装包 |
| 自动更新 | electron-updater + GitHub Releases 拉取 | 打包后每 4 小时后台检查 + 菜单/托盘「检查更新…」手动触发；Windows 后台下载后弹「重启更新」，macOS 未签名走 Homebrew（若 brew 安装）或托盘「从 GitHub 拉取更新…」 |
| 上游同步 | `scripts/sync-upstream.mjs` + GitHub Actions | 每天北京时间 09/13/17 点轮询 npm（读全部 dist-tags 取最大 semver，上游 rc 先发 `next` 后挪 `latest`）；上游或本仓库任一有更新都会出包 |

### 常用 just 命令

```bash
just install    # 安装依赖（pnpm install）
just dev        # tsc 编译后从源码启动应用
just build      # 仅类型检查并编译主进程到 dist/
just sync       # 检查 npm 是否有新版 @deepseek-ai/dsh，有则升版本（不提交）
just dist-mac   # 构建 macOS 安装包到 dist-installer/（dmg + zip）
just dist-win   # 构建 Windows 安装包（nsis，需在 Windows / CI 上运行）
```

底层等价命令见 `package.json` 的 `scripts`：`build` / `dev` / `pack` / `dist:mac` / `dist:win`。

## 🔐 关键约束（改动前必读）

1. **依赖管理用 pnpm，不用 npm。** 仓库规定 **pnpm 11.22.0**，不得改用 npm。  
2. **`node_modules` 必须保持 hoisted 模式。** `pnpm-workspace.yaml` 里 `nodeLinker: hoisted`，是为了让 electron-builder 能走扁平依赖树。**不要改成 pnpm 默认的 virtual-store symlink 布局**，否则打包会漏文件。  
3. **peer-only 运行时依赖由脚本自动维护，不要手动删。** dsh 树里有些 `@deepseek-ai/*` 包只在 `peerDependencies` 中出现，而 electron-builder 的生产收集器**只读 `dependencies`/`optionalDependencies`**，会漏掉纯 peer 包。`sync-upstream.mjs` 的 `detectPeerOnlyRuntimeDeps()` 会在升版时把它们 pin 到 `dependencies`。设计上**只增不删**——即便某包后来变成真依赖，留着无害，删了反而可能因改名产生悬空引用。  
4. **`minimumReleaseAgeExclude` 必须保持 `'@deepseek-ai/*'` 通配，**不要改成逐包 pin 版本**。pnpm 默认 24 小时最小发布龄检查，而本仓库就是要小时内跟进上游，所以整个第一方 scope 豁免。rc.6 时代这里曾是 ~190 行 `name@version` 列表，sync 升 rc.7 后列表过期、CI 的 `pnpm install --frozen-lockfile` 全部失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）。sync 已推 tag 但 build 失败会留下无 release 的孤儿 tag——现在 CI 会检测「最新 tag 无对应 release」并自动 force 重建，不再需要手动 `gh run rerun --failed` 补救，但孤儿 tag 本身会留在 tag 列表里。  
5. **整个 `node_modules` 必须 `asarUnpack`。** `dsh web` 是子进程执行的入口路径，asar 归档内的路径无法被 spawn 执行，因此 `electron-builder.yml` 里 `asarUnpack: node_modules/**`。`dshBin()` 还会把 `app.asar` 路径重写为 `app.asar.unpacked`。  
6. **版本号不要手动改。** 桌面版本由 `nextVersion()` 计算：  
   - 上游预发布版（如 `0.1.0-rc.6`）→ 追加 UTC 构建时间戳：`0.1.0-rc.6.202508151030`。定宽 `YYYYMMDDHHMM`（12 位），保证 tag 的字母序 == 时间序——纯自增计数会在 9→10 进位处让 `rc.6.9` 字母序排在 `rc.6.11` 前面  
   - 上游稳定版（如 `0.1.0`）→ 独立 patch 线 `X.Y.(Z+1)`  
   - 保证严格递增且合法 semver（electron-updater 要求）  
7. **macOS 构建未签名 / 未公证。** CI 里 `CSC_IDENTITY_AUTO_DISCOVERY=false`。用户首次打开需右键 → 打开；若提示「已损坏」需 `xattr -cr "/Applications/DSH Desktop.app"`。Homebrew 渠道由独立仓库提供（cask `dsh-desktop`，仅 arm64），其产物文件名（`DSH-Desktop-<version>-mac-arm64.dmg`）变动时必须同步改 cask 的 `url`。产物文件名必须不含空格：`${productName}` 里的空格会让 electron-builder 往 latest.yml 写连字符化的 safeArtifactName，而 `gh release` 上传又把空格转成点号，二者不一致时更新下载必 404。  
8. **ESM 项目，导入用 NodeNext 风格。** 例如 `.mjs` 脚本里用 `import.meta.url` + `createRequire`。`@deepseek-ai/dsh` 无 `exports` map，`dshBin()` 直接 `require.resolve('@deepseek-ai/dsh/lib/bin.js')`。  
9. **`@pnpm/exe`（插件市场的内置 pnpm）有三个坑，改动前必读。** ① 其 npm tarball 的 SEA 二进制**不带执行位**，setup.js 的 hardlink 也不补，`toolingPathPrefix()` 里的运行时 `chmodSync` 是必需的，别删；② SEA 二进制要求同目录有 `dist/pnpm.mjs`，所以 PATH 必须指 `@pnpm/exe` 包目录，不能直接指 `@pnpm/macos-arm64` 等平台包；③ 它的 `bin` 会在 `node_modules/.bin/pnpm` 遮蔽 corepack，electron-builder 的依赖收集器 spawn pnpm 时命中的就是它——**`packageManager` 字段必须与 `@pnpm/exe` 版本保持一致**（当前 11.22.0），否则收集器报版本不一致直接挂。另外它让 dmg 从 ~153MB 涨到 ~237MB，升版时留意体积。  

## 📂 仓库结构

```
src/main.ts                 # Electron 主进程（唯一运行时源码，约 230 行）
src/profiles.js             # Profile 管理（activeProfile、ensureProfileSeed、PROFILES 等）
src/safe-mode.ts            # 安全模式（插件崩溃摘除 & 自愈逻辑）
src/preset-deps.ts          # 预置插件依赖处理（presetDepSpec / migratePresetDepSpecs / repairPresetDepSpecs / adoptNewPresets / healDroppedPresetBundles）
src/github-releases.ts      # GitHub Releases 拉取更新（查 latest / semver 比较 / 选包 / 下载）
vendor/dshmarket/           # vendored dshmarket（running-agent 守卫自排除补丁，file: 引用）
scripts/sync-upstream.mjs   # 上游版本检测 + 桌面版本计算 + peer-only 依赖 pin
build/icon.{icns,ico,png}   # 应用图标
electron-builder.yml        # 打包配置（appId、target、asarUnpack、publish）
pnpm-workspace.yaml         # pnpm 配置（hoisted + allowBuilds 白名单）
.github/workflows/sync-and-release.yml  # 三阶段 CI：sync → build(mac/win) → release
dist/                       # tsc 输出（gitignore）
dist-installer/             # electron-builder 输出（gitignore）
plugins/                    # 自研/内置插件源码（如 dsh-market-tools、dsh-desktop-preset-transfer 等；dsh-plugin-market 为已退役的旧自研市场 fork，仅作归档参考，不进预置链）
tests/                      # Vitest 单元测试（dependency-safety、market-tools、preset-deps、github-releases 等）
```

## 🛡️ 插件市场与预置插件保护

- 插件市场由内置 `@deepseek-ai/dshmarket` 提供，访问路径为应用内置市场面板或 `http://127.0.0.1:<PORT>/dsh-market/*`（需带 cookie + Origin 鉴权）。  
- **预置插件通过 `link:/file:` 规范注入 profile**（例如 `link:J:/.../node_modules/dsh-market-tools`），这是官方机制：**卸载或更新它们会破坏预置链**（卸载导致每次启动都触发 self-heal 重新挂；更新则来源不明确）。故本地在 `market_uninstall` / `market_update` 工具里做硬拦截：  
  - 当目标插件的 `spec` 以 `link:` 或 `file:` 开头 → 立即返回 `{ok:false, blocked:true}`，**不发送任何卸载/更新请求**  
  - 工具描述中亦已明确标注：“预置插件（spec 以 link:/file: 开头）会被拒绝，不要尝试卸载或更新”  
- 此机制确保 6 款内置预置插件（市场、版本管理、终端控制、预置传输、终端、市场工具）在任何情况下均不可被卸载或更新，除非用户显式编辑 profile 并自行承担后果。

## 🧪 质量门禁

- **单元测试**：Vitest 9 文件 62 用例（含 `market-tools.*`、`github-releases`、`session-notifier` 等），全部通过  
- **插件自身测试**：node:test 5/5  
- **类型检查**：`tsc --noEmit` 0 错误  
- **架构校验**：deps=40 probed=38 failed=0  
- **构建**：`pnpm build` 成功  
- **烟雾测试**：ci-smoke authenticated ready  

## 📄 许可证

- 桌面外壳代码：MIT  
- 上游 DeepSeek Harness 本体：MIT © DeepSeek  
- 打包的第三方依赖：见上游 `THIRD_PARTY_NOTICES.md`  

## 🙋‍♂️ 本地开发指南

> 前置条件：Node.js `^22.19 || >=24`、[pnpm](https://pnpm.io)（11.22.0）、[just](https://just.systems)

```bash
# 1. 安装依赖（首次或锁文件变更后）
just install          # 等价于 pnpm install

# 2. 从源码运行（调试阶段推荐）
just dev              # tsc 编译后以源码方式启动 Electron 应用

# 3. 仅做类型检查（快速反馈）
just build            # tsc 编译，不启动

# 4. 检查上游新版本（不提交）
just sync             # 若有新版本会自动更新 package.json 中的 "@deepseek-ai/dsh" 版本

# 5. 构建分发包（需在对应平台上执行）
just dist-mac         # 在 macOS 上：生成 dmg + zip 到 dist-installer/
just dist-win         # 在 Windows 上或 CI：生成 nsis 安装包到 dist-installer/
```

### 常见调试技巧

- 应用日志默认写入系统应用数据目录下的 `logs/dsh.log`（**首要排查入口**）  
- 启动卡在白屏 → 检查日志尾部是否有 `dsh web started on port ...` 或子进程异常退出信息  
- 插件市场安装卡住 → 同上检查日志，或确认网络是否能访问 `https://awesome-dsh-plugin.com`（市场目录来源）  
- 单实例行为：第二次启动会聚焦已有窗口（即使窗口最小化到托盘），真正退出只能走托盘 → 「Quit」  

---

> 本 README 为当前仓库（dsh-desktop-unified）的权威说明。如需了解上游 DeepSeek Harness 本体，请访问 [https://github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。