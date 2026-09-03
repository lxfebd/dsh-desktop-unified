# 安装

DSH Desktop 是开箱即用的安装包——你的电脑上无需 Node.js、npm 或终端。

> 本仓库目前**未对外发布**（无 Releases、无 Homebrew tap）。唯一运行方式是本地开发。若你拥有源码（例如维护者直接分享），下面的步骤就够了。

## 前置条件

Node.js `^22.19 || >=24`、[pnpm](https://pnpm.io)（11.22.0）、[just](https://just.systems)。

## 从源码运行

```sh
just install    # 安装依赖（pnpm install）
just dev        # tsc 编译后从源码启动 Electron 应用
```

### macOS（Apple Silicon / M 系列）

同样执行 `just install` / `just dev`。构建分发包：

```sh
just dist-mac   # 生成 dmg + zip 到 dist-installer/
```

产出的 `.app` **未签名**，首次打开时：

- 如果提示"无法验证开发者"：**右键点应用 → 打开**。
- 如果提示 **"DSH Desktop 已损坏，无法打开"**：在**终端**执行一次 `xattr -cr "/Applications/DSH Desktop.app"`。

### Windows（64 位）

本地开发执行 `just dev`，或构建分发包：

```sh
just dist-win   # 生成 nsis 安装包到 dist-installer/
```

未签名构建会被 SmartScreen 提示风险——点 **更多信息 → 仍要运行**。

## 发布之后

一旦有 Releases，安装包会挂在 Releases 页，macOS 可能经由 Homebrew tap 提供。下载件会附带 `SHA256SUMS` 清单用于校验完整性。在那之前，一切以本地开发为准。

## 更新

应用启动后每 4 小时自动检查新版本：

- **Windows**：后台自动下载，弹窗点「Restart and update」重启完成更新；不点也会在下次退出应用时自动安装。
- **macOS**（未签名，无法自我更新）：弹窗提示新版本。用 Homebrew 安装的点「Update via Homebrew」，自动执行 `brew upgrade --cask dsh-desktop` + `xattr -cr` 并重启完成更新；否则点按钮跳转到 Releases 页手动下载。

::: tip
桌面版跟随上游 `@deepseek-ai/dsh` npm 包。版本号如 `0.1.0-rc.6.8` 表示"基于上游 `0.1.0-rc.6` 的第 8 个桌面构建"。
:::