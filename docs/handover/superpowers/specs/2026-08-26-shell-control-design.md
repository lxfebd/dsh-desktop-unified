# Electron 外壳 AI 控制设计

> 日期：2026-08-26
> 范围：只做 Electron 外壳（dsh-desktop-shell）的可 AI 控制；dsh 内部 UI 框架已就绪，不动。
> 目标：让 dsh 内置 AI 能"随时"修改桌面外壳——窗口图标、标题栏样式、窗口行为。

## 1. 背景与约束

- dsh 是独立 Node 进程（web server at 3080），Electron 壳是另一个进程，二者通过本地通道通信。
- 内置 UI 框架（主题、组件、token）已由 dsh-client-ui-theme 等提供，不重复建设。
- 约束：exe 文件图标运行时不可改（写入 PE 资源段，需重打包），本设计**不处理 exe 图标**。
- 可运行时改：窗口/任务栏图标（`win.setIcon`）、快捷方式图标（改 `.lnk` 的 `IconLocation`）。

## 2. 整体架构

```
┌─ dsh 内置 AI ────────────────────────────────────────┐
│  用户："把图标换成这张" / "改成无边框"                 │
│        ↓                                              │
│  [dsh-shell-control 插件]  AI 工具                     │
│   shell_set_icon / shell_set_titlebar / shell_window  │
└──────────┬───────────────────────────────────────────┘
           │ HTTP（只监听 127.0.0.1:3177）
           ▼
┌─ Electron 外壳 ──────────────────────────────────────┐
│  [shell-control 服务]  （随应用启动的本地 HTTP 服务）   │
│   /api/shell/icon        换图标                        │
│   /api/shell/titlebar    标题栏样式/模式               │
│   /api/shell/window      最小化/最大化/关闭/置顶       │
│   /api/shell/status      当前状态                      │
│        ↓                                               │
│  win.setIcon / 改快捷方式 .lnk / BrowserWindow 操作    │
└───────────────────────────────────────────────────────┘
```

核心：Electron 壳内置一个只监听回环地址的本地控制服务；dsh 插件注册 AI 工具，工具内部 HTTP 调用该服务。AI 与手动面板共用同一套 `/api/shell/*`。

## 3. 无边框窗口 + 自绘标题栏

### 3.1 窗口配置
```js
new BrowserWindow({ frame: false, titleBarStyle: 'hidden', backgroundColor: '#0d0f14', ... })
```

### 3.2 布局
- 顶部 titlebar 高 36px：左侧应用图标+应用名；右侧最小化/最大化/关闭按钮。
- webview 占剩余区域。
- 双击 titlebar 空白 = 最大化/还原（Windows 惯例）。

### 3.3 拖拽与按钮
```css
.titlebar { -webkit-app-region: drag; user-select: none; }
.titlebar .btn { -webkit-app-region: no-drag; }
```
preload 暴露：
```js
window.shell = {
  minimize: () => ipc.send('shell:window', { action: 'minimize' }),
  toggleMaximize: () => ipc.send('shell:window', { action: 'toggle-maximize' }),
  close: () => ipc.send('shell:window', { action: 'close' }),
  onMaximizedChange: (cb) => ipc.on('shell:maximized', (_, v) => cb(v)),
}
```

### 3.4 最大化边界修正
`frame:false` 在 Windows 最大化会盖住任务栏。监听 `maximize`/`unmaximize`，用 `screen.getPrimaryDisplay().workArea` 修正窗口边界；同时通过 `shell:maximized` 事件驱动"最大化↔还原"按钮图标切换。

## 4. 图标系统

### 4.1 存储（持久化，重启保留）
```
dsh-home/shell/icon/
  ├── current.png      # 原始图，窗口+任务栏用（Electron 直接支持 PNG）
  ├── current.ico      # 多尺寸 ICO，快捷方式 .lnk 用
  └── meta.json        # { source: 'upload'|'generate'|'default', fileName, appliedAt }
```

### 4.2 换图标数据流
1. dsh 插件 AI 工具拿到图片字节（用户发图 / AI 文生图 / 文件路径或 URL）。
2. `POST /api/shell/icon`，body：`{ image: base64 | imageUrl, source }`。
3. 壳：校验 → 存 `current.png` → nativeImage 缩放各尺寸组装 `current.ico`（纯 node，不依赖 PowerShell）→ 写 `meta.json` → `win.setIcon(current.png)` → 找 `.lnk` 改 `IconLocation` 指向 `current.ico`。
4. 返回 `{ ok, applied: [...], warning? }`。

### 4.3 快捷方式修改
PowerShell 一行（壳内 spawn）：
```powershell
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("<桌面/开始菜单 .lnk>")
$lnk.IconLocation = "<dsh-home>\shell\icon\current.ico,0"
$lnk.Save()
```
扫描位置：桌面、开始菜单（当前用户）、开始菜单（程序）。找不到时降级 warning，不阻断。

### 4.4 启动恢复
壳启动 `ensureShellIcon()`：读 `meta.json` → 有自定义图标则 `win.setIcon` 恢复 + 同步快捷方式。默认图标为 DeepSeek 官方蓝鲸。

### 4.5 图标 API
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/shell/icon` | 当前图标信息 |
| POST | `/api/shell/icon` | 应用新图标（base64 或 URL） |
| POST | `/api/shell/icon/reset` | 恢复默认蓝鲸 |

## 5. dsh 插件 + AI 工具

### 5.1 插件结构（`plugins/dsh-shell-control/`）
```
dsh-shell-control/
├── package.json        # dsh.client.inject + exports './client'
├── cordis.patch.yml    # host 行：inject: [webServer, tools]
└── lib/
    ├── index.js        # host：注册 AI 工具 + HTTP 桥接
    └── client.js       # client：注入侧边栏"外壳"面板（可选）
```
host 声明 `inject: ['webServer', 'tools']`（同 market），可同时注册 AI 工具与 HTTP 路由。

### 5.2 AI 工具清单
| 工具 | 用途 | 关键参数 |
|------|------|---------|
| `shell_set_icon` | 换应用图标 | `image`(base64)/`imageUrl`/`prompt`(文生图)，`source` |
| `shell_set_titlebar` | 调标题栏样式 | `mode`(default/hidden/compact)、`theme`(dark/light/system)、`color` |
| `shell_window` | 窗口操作 | `action`(minimize/maximize/restore/close/always-on-top)、`value` |
| `shell_status` | 查外壳当前状态 | 无 |

### 5.3 工具语义示例
```js
ctx.tools.register(defineTool({
  name: 'shell_set_icon',
  description: '更换 DeepSeek Harness 桌面外壳的应用图标（窗口/任务栏/快捷方式）。'
    + '用户给图→传 image(base64)；用户要"生成 X 风格图标"→写进 prompt。',
  parameters: {
    image: { type: 'string', description: '图片 base64（可选）' },
    imageUrl: { type: 'string', description: '图片 URL（可选）' },
    prompt: { type: 'string', description: '无图片时描述要生成的图标（可选）' },
  },
  async execute(args) {
    // prompt → 文生图拿 PNG；imageUrl → 下载；image → 直接用
    // POST 127.0.0.1:3177/api/shell/icon
    // 返回 { ok, applied, warning? }
  },
}))
```

### 5.4 桥接逻辑
```js
const SHELL_PORT = 3177  // 壳控制服务端口（冲突时读 control-port.json 取实际端口）
async function callShell(path, body) { /* fetch http://127.0.0.1:SHELL_PORT${path} */ }
```
- `shell_set_icon` 带 `prompt` 时先调文生图（系统图片 API）生成 PNG → 转 base64 → 传壳。
- 壳不可达时给 AI 明确反馈："外壳控制服务未启动"。

### 5.5 client 面（可选）
注入侧边栏 footer 一个"外壳"按钮，面板可手动传图换图标、选标题栏模式、恢复默认。与 AI 工具共用同一套 `/api/shell/*`。

## 6. 错误处理
| 层 | 处理 |
|----|------|
| 壳控制服务 | 每路由 `safe()` 包装，错误→500 JSON，`headersSent` 时 destroy |
| AI 工具 | execute 失败返回可操作文本；图标类 timeout 60s，窗口类 10s |
| 图标格式 | 非图片→400；>2MB→413；ICO 转换失败→回退 PNG（窗口仍生效） |
| 快捷方式 | 找不到 `.lnk`→降级 warning，不阻断 |
| 壳不可达 | 工具先探测 3177→未监听则报"外壳控制服务未启动" |
| 端口冲突 | 3177 被占→探测 3178/3179…→写 `dsh-home/shell/control-port.json`，插件读它取实际端口 |

## 7. 测试
- **壳 HTTP 路由单测**（内置 node 跑）：status / icon(apply/reset) / titlebar / window 各路由正常 + 错误码。
- **集成测试**：启动壳→换图标→检查 `meta.json` + `win` 图标→重启→`ensureShellIcon` 恢复。
- **人工验证**：无边框拖拽、三按钮、双击最大化、最大化不盖任务栏、AI 对话"换图标"实际换图。

## 8. 交付物清单
1. **Electron 壳改造**（`dsh-desktop-shell/`）
   - `src/main.js`：`frame:false` + shell-control HTTP 服务 + 图标/窗口/快捷方式管理 + 启动恢复
   - `src/preload.js`：暴露 `window.shell`
   - `src/renderer.html`：自绘标题栏 + 控制按钮 + 拖拽
   - `src/shell-control.js`（新）：本地 HTTP 服务 + 路由处理
   - `src/shell-icon.js`（新）：PNG→多尺寸 ICO（nativeImage，纯 node）
2. **dsh 插件 `dsh-shell-control`**（新建 `plugins/`）
   - `package.json` + `cordis.patch.yml`
   - `lib/index.js`：4 个 AI 工具 + HTTP 桥接 + 文生图调用
   - `lib/client.js`：侧边栏"外壳"面板（可选）
3. **打包集成**
   - `scripts/prepare-home.cjs`：把 `dsh-shell-control` 加入初始 home 模板 bundles + 复制插件代码
4. **本文档**

## 9. 不做（YAGNI）
- exe 文件图标修改（运行时不可改，需重打包）。
- dsh 内部 UI 主题/组件库重建（已由 dsh-client-ui-theme 等提供）。
- macOS/Linux 标题栏原生按钮（当前只面向 Windows）。
