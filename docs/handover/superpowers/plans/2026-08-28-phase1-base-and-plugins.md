# Phase 1 实施计划：基底搭建 + 移植自研插件

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 foolgry/dsh-desktop 为基底搭建新项目，移植自研的插件市场和版本管理器，使外壳能跑起来且内置两个自研插件。

**Architecture:** Fork foolgry 的 TypeScript + electron-vite 架构作为外壳基底（含端口回退、安全模式、托盘、自动更新、asar 处理、内置 pnpm）。将自研的 dsh-plugin-market 和 dsh-plugin-version-manager 作为预置插件通过 symlink 注入 profile。dsh 核心始终从 npm 官方拉取，补丁走 patch-package，CI 每日自动同步上游。

**Tech Stack:** TypeScript, Electron 31, electron-vite, electron-builder, pnpm, @pnpm/exe, patch-package, just

**设计文档:** `docs/superpowers/specs/2026-08-28-unified-dsh-desktop-design.md`

---

## 文件结构

本次实施涉及的文件：

```
d:\deepseekhar\dsh-desktop-unified/          ← 新项目根目录
├── src/
│   ├── main.ts                              ← 主进程入口（从 foolgry 移植 + 调整）
│   ├── safe-mode.ts                         ← 安全模式（从 foolgry 移植）
│   └── preload.ts                           ← preload（从 foolgry 移植）
├── plugins/
│   ├── dsh-plugin-market/                   ← 从现有项目复制
│   │   ├── lib/
│   │   │   ├── index.js
│   │   │   ├── market.js
│   │   │   ├── client.js
│   │   │   ├── run-pnpm.cjs
│   │   │   └── restart.cjs
│   │   ├── cordis.patch.yml
│   │   ├── package.json
│   │   ├── sources.json
│   │   └── tab-plugins.json
│   └── dsh-plugin-version-manager/          ← 从现有项目复制
│       ├── lib/
│       │   ├── index.js
│       │   ├── core.js
│       │   └── client.js
│       ├── cordis.patch.yml
│       └── package.json
├── build/
│   └── icon.ico                             ← DeepSeek 鲸鱼图标（从现有项目复制）
├── patches/                                  ← patch-package 补丁
├── .github/workflows/
│   └── sync-and-release.yml                 ← CI 自动同步（从 foolgry 移植）
├── electron-builder.yml                      ← 打包配置（从 foolgry 移植 + 调整）
├── electron.vite.config.ts                  ← vite 配置（从 foolgry 移植）
├── package.json                             ← 依赖声明（从 foolgry 移植 + 加自研插件）
├── tsconfig.json                            ← TS 配置（从 foolgry 移植）
├── justfile                                 ← 构建命令（从 foolgry 移植）
├── pnpm-workspace.yaml                      ← workspace 配置
└── .gitignore
```

---

### Task 1: 克隆 foolgry 基底

**Files:**
- Create: `d:\deepseekhar\dsh-desktop-unified/` (整个目录)

- [ ] **Step 1: 克隆 foolgry 仓库**

```bash
cd d:\deepseekhar
git clone https://github.com/foolgry/dsh-desktop.git dsh-desktop-unified
```

- [ ] **Step 2: 进入新目录并查看结构**

```bash
cd dsh-desktop-unified
dir src
```

Expected: 看到 `main.ts` 和 `safe-mode.ts`

- [ ] **Step 3: 移除 foolgry 的 git 历史，初始化新仓库**

```bash
rm -rf .git
git init
git add -A
git commit -m "chore: initialize from foolgry/dsh-desktop base (MIT)"
```

- [ ] **Step 4: 验证依赖能安装**

```bash
pnpm install
```

Expected: 安装成功，无致命错误

- [ ] **Step 5: 验证开发模式能启动**

```bash
just dev
```

Expected: Electron 窗口弹出，显示 dsh 启动等待界面

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: verify base project boots successfully"
```

---

### Task 2: 复制自研插件到新项目

**Files:**
- Create: `dsh-desktop-unified/plugins/dsh-plugin-market/` (整个目录)
- Create: `dsh-desktop-unified/plugins/dsh-plugin-version-manager/` (整个目录)

- [ ] **Step 1: 创建 plugins 目录**

```bash
cd d:\deepseekhar\dsh-desktop-unified
mkdir plugins
```

- [ ] **Step 2: 复制插件市场**

```bash
xcopy /E /I /Y ..\plugins\dsh-plugin-market plugins\dsh-plugin-market
```

- [ ] **Step 3: 复制版本管理器**

```bash
xcopy /E /I /Y ..\plugins\dsh-plugin-version-manager plugins\dsh-plugin-version-manager
```

- [ ] **Step 4: 验证两个插件的 package.json 存在**

```bash
type plugins\dsh-plugin-market\package.json
type plugins\dsh-plugin-version-manager\package.json
```

Expected: 两个文件都能输出 JSON 内容

- [ ] **Step 5: 验证插件入口文件存在**

```bash
dir plugins\dsh-plugin-market\lib\index.js
dir plugins\dsh-plugin-version-manager\lib\index.js
```

Expected: 两个文件都存在

- [ ] **Step 6: Commit**

```bash
git add plugins/
git commit -m "feat: add self-developed plugins (market + version-manager)"
```

---

### Task 3: 复制 DeepSeek 图标

**Files:**
- Copy: `dsh-desktop-shell/build/icon.ico` → `dsh-desktop-unified/build/icon.ico`
- Copy: `dsh-desktop-shell/build/icon-256.png` → `dsh-desktop-unified/build/icon-256.png`

- [ ] **Step 1: 复制图标文件**

```bash
copy ..\dsh-desktop-shell\build\icon.ico build\icon.ico
copy ..\dsh-desktop-shell\build\icon-256.png build\icon-256.png
```

- [ ] **Step 2: 验证图标文件存在**

```bash
dir build\icon.ico
```

Expected: 文件存在，大小 > 0

- [ ] **Step 3: Commit**

```bash
git add build/
git commit -m "feat: use DeepSeek official whale icon"
```

---

### Task 4: 调整 electron-builder.yml

**Files:**
- Modify: `dsh-desktop-unified/electron-builder.yml`

- [ ] **Step 1: 读取当前配置**

```bash
type electron-builder.yml
```

- [ ] **Step 2: 调整 appId、productName 和图标路径**

将 `electron-builder.yml` 修改为：

```yaml
appId: com.deepseek.dshdesktop
productName: DeepSeek Harness
copyright: MIT
directories:
  output: dist-installer
files:
  - dist/**
  - node_modules/**
  - package.json
asarUnpack:
  - node_modules/**
mac:
  category: public.app-category.productivity
  icon: build/icon.icns
  target:
    - dmg
    - zip
  artifactName: DeepSeek-Harness-${version}-mac-arm64.${ext}
win:
  icon: build/icon.ico
  target:
    - nsis
  artifactName: DeepSeek-Harness-${version}-win-x64-setup.${ext}
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  shortcutName: DeepSeek Harness
publish:
  provider: github
  owner: deepseekhar
  repo: dsh-desktop-unified
```

- [ ] **Step 3: 验证 YAML 语法**

```bash
node -e "const yaml=require('js-yaml');const fs=require('fs');console.log(yaml.load(fs.readFileSync('electron-builder.yml','utf8')))"
```

Expected: 输出解析后的 JS 对象，无异常

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml
git commit -m "chore: adjust electron-builder config for unified project"
```

---

### Task 5: 调整 package.json — 加入自研插件为依赖

**Files:**
- Modify: `dsh-desktop-unified/package.json`

- [ ] **Step 1: 读取当前 package.json**

```bash
type package.json
```

- [ ] **Step 2: 在 dependencies 中加入两个自研插件**

在 `package.json` 的 `dependencies` 对象中加入：

```json
"dsh-plugin-market": "file:plugins/dsh-plugin-market",
"dsh-plugin-version-manager": "file:plugins/dsh-plugin-version-manager"
```

同时修改 `name` 为 `"dsh-desktop-unified"`，`version` 保持 `"0.1.0"`。

- [ ] **Step 3: 重新安装依赖**

```bash
pnpminstall
```

Expected: 两个自研插件被 link 到 `node_modules/` 中

- [ ] **Step 4: 验证插件被链接**

```bash
dir node_modules\dsh-plugin-market\lib\index.js
dir node_modules\dsh-plugin-version-manager\lib\index.js
```

Expected: 两个文件都存在（pnpm 的 file: 协议会创建符号链接）

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add self-developed plugins as file: dependencies"
```

---

### Task 6: 调整 main.ts — 在 PRESET_PLUGINS 中加入自研插件

**Files:**
- Modify: `dsh-desktop-unified/src/main.ts` (PRESET_PLUGINS 常量)

- [ ] **Step 1: 找到 PRESET_PLUGINS 常量**

```bash
findstr "PRESET_PLUGINS" src\main.ts
```

- [ ] **Step 2: 在数组中加入两个自研插件**

将：
```typescript
const PRESET_PLUGINS = ['dshmarket']
```
改为：
```typescript
const PRESET_PLUGINS = ['dshmarket', 'dsh-plugin-market', 'dsh-plugin-version-manager']
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: preset self-developed plugins alongside dshmarket"
```

---

### Task 7: 验证 dev 模式启动 + 插件市场可见

**Files:**
- 无文件修改，纯验证

- [ ] **Step 1: 启动开发模式**

```bash
just dev
```

Expected: Electron 窗口弹出，显示"正在启动 dsh…"等待界面

- [ ] **Step 2: 等待 dsh 就绪，界面加载**

等待约 10-30 秒，dsh web 界面应该加载出来。

- [ ] **Step 3: 验证插件市场入口可见**

在 dsh 界面的侧边栏底部，应该看到"插件市场"入口。点击应能看到插件市场 UI。

- [ ] **Step 4: 验证版本管理器入口可见**

在侧边栏底部，应该看到"版本管理"入口。点击应能看到当前 dsh 版本信息。

- [ ] **Step 5: 验证端口回退生效**

```bash
netstat -ano | findstr ":308"
```

Expected: dsh 监听在 3080 或 3081 等端口（如果 3080 被占则自动用下一个）

- [ ] **Step 6: Commit 验证记录**

```bash
git add -A
git commit -m "chore: verify dev mode with both self-developed plugins visible"
```

---

### Task 8: 配置 CI 自动同步上游

**Files:**
- Create: `dsh-desktop-unified/.github/workflows/sync-and-release.yml`

- [ ] **Step 1: 检查 foolgry 的 CI 配置是否已存在**

```bash
dir .github\workflows\
```

如果 `sync-and-release.yml` 已存在，跳到 Step 3。

- [ ] **Step 2: 如果不存在，从 foolgry 原仓库获取**

```bash
curl -sL https://raw.githubusercontent.com/foolgry/dsh-desktop/master/.github/workflows/sync-and-release.yml -o .github/workflows/sync-and-release.yml
```

- [ ] **Step 3: 调整 CI 中的仓库引用**

打开 `sync-and-release.yml`，将其中的 `foolgry/dsh-desktop` 替换为你的仓库地址（如 `deepseekhar/dsh-desktop-unified`）。

- [ ] **Step 4: 验证 YAML 语法**

```bash
node -e "const yaml=require('js-yaml');const fs=require('fs');console.log(yaml.load(fs.readFileSync('.github/workflows/sync-and-release.yml','utf8')))"
```

Expected: 输出解析后的对象，无异常

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/sync-and-release.yml
git commit -m "ci: add upstream sync workflow (checks npm 3x daily)"
```

---

### Task 9: 配置 patch-package 补丁

**Files:**
- Create: `dsh-desktop-unified/patches/` (目录)
- Modify: `dsh-desktop-unified/package.json` (加 postinstall 脚本)

- [ ] **Step 1: 创建 patches 目录**

```bash
mkdir patches
```

- [ ] **Step 2: 在 package.json 中加 postinstall 脚本**

在 `scripts` 中加入：
```json
"postinstall": "patch-package"
```

并加入 devDependency：
```json
"patch-package": "^8.0.0"
```

- [ ] **Step 3: 重新安装依赖**

```bash
pnpm install
```

Expected: patch-package 安装成功，postinstall 运行（patches 目录为空时不报错）

- [ ] **Step 4: 验证 patch-package 可执行**

```bash
npx patch-package --help
```

Expected: 输出帮助信息

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: configure patch-package for reproducible dsh patches"
```

---

### Task 10: 最终验证 + 打包测试

**Files:**
- 无文件修改，纯验证

- [ ] **Step 1: 验证 TypeScript 类型检查**

```bash
npx tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 2: 验证 dev 模式完整启动**

```bash
just dev
```

验证清单：
- [ ] Electron 窗口弹出
- [ ] 显示"正在启动 dsh…"等待界面
- [ ] 10-30 秒后 dsh web 界面加载
- [ ] 侧边栏有"插件市场"入口
- [ ] 侧边栏有"版本管理"入口
- [ ] 插件市场能浏览社区目录
- [ ] 版本管理器能显示当前版本

- [ ] **Step 3: 尝试 Windows 打包**

```bash
just dist-win
```

Expected: 在 `dist-installer/` 生成 `DeepSeek-Harness-0.1.0-win-x64-setup.exe`

- [ ] **Step 4: 验证安装包大小**

```bash
dir dist-installer\*.exe
```

Expected: 安装包存在，大小在 80-120MB 范围（Electron + dsh + pnpm SEA）

- [ ] **Step 5: Commit 最终状态**

```bash
git add -A
git commit -m "chore: Phase 1 complete — base + self-developed plugins verified"
```

---

## 自检

**Spec 覆盖率:**
- ✅ fork foolgry 作为基底 → Task 1
- ✅ 移植插件市场 → Task 2 + Task 5 + Task 6
- ✅ 移植版本管理器 → Task 2 + Task 5 + Task 6
- ✅ DeepSeek 图标 → Task 3
- ✅ electron-builder 配置 → Task 4
- ✅ 预置插件 symlink → Task 5 (pnpm file: 协议自动 symlink) + Task 6 (PRESET_PLUGINS)
- ✅ CI 自动同步上游 → Task 8
- ✅ patch-package 补丁机制 → Task 9
- ✅ dsh 走官方（不 fork）→ Task 1 只 fork 外壳，dsh 始终从 npm 安装
- ✅ 验证 dev 模式 → Task 7 + Task 10
- ✅ 验证打包 → Task 10

**Placeholder 扫描:** 无 TBD/TODO，所有步骤都有具体命令和预期输出。

**类型一致性:** PRESET_PLUGINS 数组中的插件名与 package.json 中的依赖名一致（`dsh-plugin-market`、`dsh-plugin-version-manager`）。
