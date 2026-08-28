/**
 * 右键菜单模板构建。把 Electron 的 ContextMenuParams 翻译成本地化菜单项，
 * 由 context-menu.ts 实际 popup。handler 注入使本模块不直接依赖副作用，
 * 便于测试。
 * @module dsh-desktop/context-menu-template
 */

import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

/** 菜单项触发的副作用，由调用方（context-menu.ts）注入。 */
export interface ContextMenuHandlers {
  openLink: (url: string) => void
  copyLink: (url: string) => void
  copyImage: () => void
}

/**
 * 按右键落点构建菜单模板：链接场景给「打开/复制链接」，图片场景给
 * 「复制图片」，可编辑区给完整的剪切/复制/粘贴/全选，纯选区只给「复制」。
 * 复制粘贴类项保留 Electron role，macOS 的 Cmd+C/V 等行为与加速键依赖它。
 * @param params - Electron 右键事件参数
 * @param locale - 菜单语言（本项目由 isZhLocale() 决定）
 * @param handlers - 非 role 能表达的副作用（外链、复制链接、复制图片）
 * @returns 菜单项数组；无可用项时为空数组，调用方据此不 popup
 */
export function buildContextMenuTemplate(
  params: ContextMenuParams,
  locale: 'en' | 'zh',
  handlers: ContextMenuHandlers,
): MenuItemConstructorOptions[] {
  const t =
    locale === 'zh'
      ? { copy: '复制', cut: '剪切', paste: '粘贴', selectAll: '全选', copyLink: '复制链接', openLink: '打开链接', copyImage: '复制图片' }
      : { copy: 'Copy', cut: 'Cut', paste: 'Paste', selectAll: 'Select All', copyLink: 'Copy Link', openLink: 'Open Link', copyImage: 'Copy Image' }
  const items: MenuItemConstructorOptions[] = []
  if (params.linkURL) {
    items.push(
      { label: t.openLink, click: () => handlers.openLink(params.linkURL) },
      { label: t.copyLink, click: () => handlers.copyLink(params.linkURL) },
      { type: 'separator' },
    )
  }
  // Electron ≥30 用 hasImageContents 取代了旧的 hasImage 布尔位。
  if (params.hasImageContents) {
    items.push({ label: t.copyImage, click: () => handlers.copyImage() }, { type: 'separator' })
  }
  if (params.isEditable) {
    items.push(
      { role: 'cut', label: t.cut, enabled: params.editFlags.canCut },
      { role: 'copy', label: t.copy, enabled: params.editFlags.canCopy },
      { role: 'paste', label: t.paste, enabled: params.editFlags.canPaste },
    )
    // 选区判定改用 selectionText：Electron ≥30 已移除 hasSelection 布尔位。
  } else if (params.selectionText !== '') {
    items.push({ role: 'copy', label: t.copy, enabled: params.editFlags.canCopy })
  }
  if (params.isEditable) {
    items.push({ role: 'selectAll', label: t.selectAll })
  }
  return items
}
