window.__ModuleLoader__.load({
	id: "dsh-plugin-market",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var { useState, useEffect, useRef } = React;
		var __ui = require("@deepseek-ai/dsh-client-ui-primitives");
		var Modal = __ui.Modal, Button = __ui.Button, Input = __ui.Input,
			IconCheckOutline16 = __ui.IconCheckOutline16, IconRefreshOutline14 = __ui.IconRefreshOutline14,
			IconSearchOutline16 = __ui.IconSearchOutline16, IconPersonalizationOutline16 = __ui.IconPersonalizationOutline16,
			IconDownloadOutline16 = __ui.IconDownloadOutline16, IconLoadingOutline16 = __ui.IconLoadingOutline16;

		var NS = "plugin-market";
		var zh = {
			fabLabel: "插件市场",
			title: "插件市场",
			subtitle: "浏览 · 搜索 · 管理 DeepSeek 框架插件",
			close: "关闭",
			loading: "加载中…",
			search: "搜索插件…",
			all: "全部",
			core: "核心",
			tools: "工具",
			communityCat: "社区",
			official: "官方",
			community: "社区",
			installed: "已安装",
			sources: "源",
			custom: "自定义",
			refresh: "刷新目录",
			refreshCommunity: "刷新社区",
			install: "安装",
			uninstall: "卸载",
			update: "更新",
			disable: "禁用",
			enable: "启用",
			installedCore: "已装核心",
			installedPill: "已装",
			disabledPill: "已禁用",
			processing: "处理中",
			busyInstall: "安装中",
			busyUpdate: "更新中",
			busyUninstall: "卸载中",
			busyDisable: "禁用中",
			busyEnable: "启用中",
			detail: "详情",
			collapse: "收起",
			retry: "重试",
			noMatch: "暂无匹配的插件",
			emptyFilter: "换一个分类或清空筛选看看",
			emptyCommunity: "社区目录为空",
			emptyCommunitySub: "首次拉取需联网，点击「刷新社区」重试",
			qualityAll: "全部",
			qualityStarred: "有星标",
			qualityCurated: "精选",
			qualityHint: "按 GitHub 星标过滤低质量插件",
			emptyInstalled: "还没有安装自定义插件",
			emptyInstalledSub: "仓库里的插件会显示在这里",
			noSources: "暂无自定义源",
			noSourcesSub: "在下面添加一个源（源地址 / 目录名）",
			opQueue: "操作队列",
			opCount: "{active} 项进行中 · 共 {total} 项",
			minimize: "收起",
			showLog: "查看日志",
			hideLog: "收起日志",
			expand: "展开",
			kill: "终止",
			clear: "清除",
			clearAll: "清空全部",
			version: "版本",
			category: "分类",
			sourceLabel: "包",
			repository: "仓库",
			confirmInstall: "确认安装",
			confirmUpdate: "确认更新",
			confirmUninstall: "确认卸载",
			confirmDisable: "确认禁用",
			confirmEnable: "确认启用",
			execute: "执行",
			cancel: "取消",
			skipCheck: "跳过安全检查（风险自负）",
		safetyHint: "默认由服务端做来源与安全校验；勾选后强制安装，可能装坏 web 启动。",
		decoWarn: "警告：这是装饰性插件，安装后会向界面注入常驻元素（吉祥物/壁纸/播放器等），可能导致界面观感变化。若不需要可随时卸载。",
			uninstallWarn: "将移除依赖并卸载该插件，此操作不可撤销。",
			disableWarn: "停用后保留依赖与文件，插件不再加载，可随时重新启用。",
			opQueued: "已加入操作队列",
			opFailed: "操作失败",
			opSubmitErr: "提交操作失败",
			opUnsupported: "服务器尚不支持该操作",
			catalogErr: "加载目录失败，请确认 dsh-plugin-market 已挂载",
			fetchCommunityErr: "拉取社区目录失败（需联网）",
			mirror: "镜像加速",
			addSource: "添加",
			sourceName: "名称",
			sourceAddr: "来源（源地址 / 目录名）",
			sourceDelete: "删除",
			sourceAddErr: "添加源失败",
			sourceDelErr: "删除源失败",
			sourceLoadErr: "读取源列表失败",
			statusRunning: "执行中",
			statusQueued: "排队中",
			statusDone: "完成",
			statusFailed: "失败",
			statusKilled: "已终止",
			statusUnknown: "未知",
			tabBadge: "Tab",
			tabHintInstalled: "支持注册为侧边栏 Tab 页面（需 dsh-better-sidebar 已安装）",
			tabHintCore: "内置于 dsh-better-sidebar，无需安装",
			goRepo: "仓库主页 ↗",
			noDesc: "暂无描述",
			notInstalled: "未安装",
			themes: "主题",
			themeTabDesc: "一键换肤 · 切换后重启 dsh 生效 · 同一时间仅一个主题生效",
			themeActive: "使用中",
			themeNotInstalled: "未安装，先去社区安装",
			themeSwitch: "启用主题",
			themeSwitching: "切换中…",
			themeHint: "切换主题后将自动重启 dsh 使其生效，请稍候片刻。",
			themeCredit: "版权注记：内置主题包 dsh-theme 采用 Apache-2.0 许可（随桌面壳打包分发）；社区主题版权归原作者所有，请以各插件仓库许可证为准。",
			themeInstallFirst: "先在社区页搜索并安装主题插件，再回来启用",
			refreshThemes: "刷新主题",
			themeRules: "切换规则",
			themeRule1: "同一时间仅一个主题生效（互斥）",
			themeRule2: "切换会禁用当前主题并启用目标主题",
			themeRule3: "选择在重启后依然保留",
			backToList: "返回列表",
			tabOverview: "概览",
			tabVersions: "版本",
			tabSecurity: "安全",
			tabReviews: "评价",
			noReadme: "暂无 README",
			loadingReadme: "正在加载 README…",
			copyCommand: "复制命令",
			copied: "已复制",
			whitelistOk: "白名单内，安全",
			whitelistUnknown: "白名单外，需确认",
			skipCheckLabel: "跳过安全检查",
			mirrorLabel: "镜像加速",
			installCommand: "dsh plugin --profile web add {source}",
			noVersions: "暂无版本历史",
			noReviews: "暂无评价，欢迎通过 GitHub Issues 反馈",
			stars: "星标",
			npmDownloads: "npm 下载",
			author: "作者",
			communityPrefix: "社区·",
			communityOnly: "社区",
			latestVersion: "最新",
			protectedUninstall: "核心/自身包不可卸载",
		};
		var en = Object.assign({}, zh, {
			fabLabel: "Market",
			title: "Plugin Market",
			subtitle: "Browse · search · manage DeepSeek harness plugins",
			close: "Close",
			loading: "Loading…",
			search: "Search plugins…",
			themeNotInstalled: "Not installed",
			themeCredit: "Attribution: built-in theme pack dsh-theme is Apache-2.0 licensed (bundled with the desktop shell); community themes belong to their authors — check each plugin repo's license.",
			all: "All",
			core: "Core",
			tools: "Tools",
			communityCat: "Community",
			official: "Official",
			community: "Community",
			installed: "Installed",
			sources: "Sources",
			custom: "Custom",
			refresh: "Refresh",
			refreshCommunity: "Refresh community",
			install: "Install",
			uninstall: "Uninstall",
			update: "Update",
			disable: "Disable",
			enable: "Enable",
			installedCore: "Core installed",
			installedPill: "Installed",
			disabledPill: "Disabled",
			processing: "Processing",
			busyInstall: "Installing",
			busyUpdate: "Updating",
			busyUninstall: "Uninstalling",
			busyDisable: "Disabling",
			busyEnable: "Enabling",
			detail: "Details",
			collapse: "Collapse",
			retry: "Retry",
			noMatch: "No matching plugins",
			emptyFilter: "Try another category or clear the filter",
			emptyCommunity: "Community catalog is empty",
			emptyCommunitySub: "First fetch needs network. Click \"Refresh community\" to retry.",
			qualityAll: "All",
			qualityStarred: "Starred",
			qualityCurated: "Curated",
			qualityHint: "Filter by GitHub stars to exclude low-quality plugins",
			emptyInstalled: "No custom plugins installed yet",
			emptyInstalledSub: "Plugins from the catalog will show up here",
			noSources: "No custom sources",
			noSourcesSub: "Add a source (address / directory name) below",
			opQueue: "Task queue",
			opCount: "{active} active · {total} total",
			minimize: "Minimize",
			showLog: "View log",
			hideLog: "Hide log",
			expand: "Expand",
			kill: "Kill",
			clear: "Clear",
			clearAll: "Clear all",
			version: "Version",
			category: "Category",
			sourceLabel: "Package",
			repository: "Repository",
			confirmInstall: "Confirm install",
			confirmUpdate: "Confirm update",
			confirmUninstall: "Confirm uninstall",
			confirmDisable: "Confirm disable",
			confirmEnable: "Confirm enable",
			execute: "Run",
			cancel: "Cancel",
			skipCheck: "Skip safety checks (at your own risk)",
		safetyHint: "The server validates source and safety by default; checking this forces the install and may break web boot.",
		decoWarn: "Warning: this is a decorative plugin. After install it injects persistent elements into the UI (mascots / wallpapers / music players), which may change how the interface looks. You can uninstall it anytime.",
			uninstallWarn: "This removes the dependency and uninstalls the plugin. This cannot be undone.",
			disableWarn: "Disabling keeps the dependency and files but the plugin will not load. You can re-enable it later.",
			opQueued: "Queued",
			opFailed: "Operation failed",
			opSubmitErr: "Failed to submit operation",
			opUnsupported: "The server does not support this operation yet",
			catalogErr: "Failed to load catalog. Make sure dsh-plugin-market is mounted.",
			fetchCommunityErr: "Failed to fetch community catalog (network required)",
			mirror: "Mirror",
			addSource: "Add",
			sourceName: "Name",
			sourceAddr: "Source (address / directory name)",
			sourceDelete: "Delete",
			sourceAddErr: "Failed to add source",
			sourceDelErr: "Failed to delete source",
			sourceLoadErr: "Failed to load sources",
			statusRunning: "Running",
			statusQueued: "Queued",
			statusDone: "Done",
			statusFailed: "Failed",
			statusKilled: "Killed",
			statusUnknown: "Unknown",
			tabBadge: "Tab",
			tabHintInstalled: "Can be registered as a sidebar Tab (requires dsh-better-sidebar)",
			tabHintCore: "Built into dsh-better-sidebar",
			goRepo: "Repository ↗",
			noDesc: "No description",
			notInstalled: "Not installed",
			stars: "Stars",
			npmDownloads: "npm downloads",
			author: "Author",
			communityPrefix: "Community·",
			communityOnly: "Community",
			latestVersion: "Latest",
			protectedUninstall: "Core/self packages cannot be uninstalled",
		});

		var T = {
			p: "var(--dsw-alias-label-primary)",
			s: "var(--dsw-alias-label-secondary)",
			t: "var(--dsw-alias-label-tertiary)",
			d: "var(--dsw-alias-label-dimmed)",
			b1: "var(--dsw-alias-bg-layer-1)",
			b2: "var(--dsw-alias-bg-layer-2)",
			b3: "var(--dsw-alias-bg-layer-3)",
			bm: "var(--dsw-alias-bg-module-platform)",
			ln1: "var(--dsw-alias-border-l1)",
			ln2: "var(--dsw-alias-border-l2)",
			ln3: "var(--dsw-alias-border-l3)",
			brand: "var(--dsw-alias-brand-primary)",
			brandT: "var(--dsw-alias-brand-text)",
			ok: "var(--dsw-alias-state-success-primary)",
			warn: "var(--dsw-alias-state-warn-primary)",
			err: "var(--dsw-alias-state-error-primary)",
			fill: "var(--dsw-alias-button-primary-fill, #1f2328)",
			ft: "var(--dsw-alias-label-primary-foreground, #fff)",
			hov: "var(--dsw-alias-interactive-bg-hover)",
			hovD: "var(--dsw-alias-interactive-bg-hover-danger)",
			ghost: "var(--dsw-alias-button-ghost-active-fill, rgba(38,49,72,.1))",
			font: "var(--dsw-font-family, inherit)",
			mono: "ui-monospace, SF Mono, Cascadia Code, Menlo, monospace",
		};

		function IconStar(props) {
			return React.createElement("span", { style: { fontSize: (props.size || 11) + "px", lineHeight: 1, color: "inherit" } }, "★");
		}
		function IconCheck(props) {
			return React.createElement(IconCheckOutline16, { size: props.size || 14 });
		}
		function IconPalette(props) {
			return React.createElement(IconPersonalizationOutline16, { size: props.size || 14 });
		}
		function IconBox(props) {
			return React.createElement(IconDownloadOutline16, { size: props.size || 12 });
		}
		function IconRefresh(props) {
			return React.createElement(IconRefreshOutline14, { size: props.size || 12 });
		}

		var PROTECTED = { "@deepseek-ai/dsh-base": 1, "@deepseek-ai/dsh-web-app": 1, "@deepseek-ai/dsh-headless": 1 };

		function esc(s) {
			return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
		}
		function letter(name) {
			var n = String(name || "");
			var m = n.replace(/^(@[^/]+\/)?/, "").replace(/[-_.]/g, " ");
			var ch = m.trim().charAt(0).toUpperCase();
			return ch || "#";
		}
		function formatBytes(n) {
			if (!n) return "0 B";
			if (n < 1024) return n + " B";
			if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
			return (n / 1048576).toFixed(2) + " MB";
		}
		function formatNum(n) {
			if (!n) return "0";
			if (n < 1000) return String(n);
			if (n < 1e6) return (n / 1000).toFixed(1) + "k";
			return (n / 1e6).toFixed(1) + "M";
		}
		function fmtSpeed(bps) {
			if (bps <= 0) return "";
			return formatBytes(bps) + "/s";
		}

		function apiFetch(path, opts) {
			var ctrl = new AbortController();
			var timeout = (opts && opts.timeout) || 60000;
			var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, timeout);
			opts = opts || {};
			var o = Object.assign({}, opts, { signal: ctrl.signal });
			return fetch("/api/market/" + path, o).then(function (r) {
				clearTimeout(timer);
				return r.json().then(function (d) {
					if (!r.ok && !d) return { error: "HTTP " + r.status };
					return d;
				});
			}).catch(function (e) {
				clearTimeout(timer);
				if (e && e.name === "AbortError") return { error: "请求超时（" + Math.round(timeout / 1000) + "s）" };
				return { error: String((e && e.message) || e) };
			});
		}

		var OP_DONE = { done: 1, success: 1, completed: 1, succeeded: 1 };
		var OP_FAIL = { failed: 1, error: 1, err: 1, killed: 1, cancelled: 1, canceled: 1, timeout: 1, refused: 1, aborted: 1 };
		var OP_RUN = { running: 1, active: 1, installing: 1, removing: 1, updating: 1, downloading: 1, executing: 1, building: 1 };
		var OP_WAIT = { queued: 1, pending: 1, waiting: 1, queue: 1, enqueued: 1 };
		function opKey(o) { return String(o && o.status || "").toLowerCase(); }
		function opTerminal(o) { var k = opKey(o); return !!(OP_DONE[k] || OP_FAIL[k]); }
		function opFailed(o) { return !!OP_FAIL[opKey(o)]; }
		function opActive(o) { var k = opKey(o); return !!(OP_RUN[k] || OP_WAIT[k]); }
		function percentOf(o) {
			var pr = o && o.progress;
			if (pr && pr.percent != null) return pr.percent;
			if (o && o.percent != null) return o.percent;
			if (opFailed(o)) return 100;
			if (o && OP_DONE[opKey(o)]) return 100;
			return 0;
		}
		function statusText(s, t) {
			var k = String(s || "").toLowerCase();
			if (OP_WAIT[k]) return t("statusQueued");
			if (OP_RUN[k]) return t("statusRunning");
			if (OP_DONE[k]) return t("statusDone");
			if (OP_FAIL[k]) return (k.indexOf("kill") > -1 || k.indexOf("cancel") > -1 || k.indexOf("abort") > -1) ? t("statusKilled") : t("statusFailed");
			return t("statusUnknown");
		}
		function busyText(method, t) {
			if (method === "uninstall") return t("busyUninstall");
			if (method === "update") return t("busyUpdate");
			if (method === "disable") return t("busyDisable");
			if (method === "enable") return t("busyEnable");
			return t("busyInstall");
		}
		function catOf(item) {
			if (item.tab === "community" || item.community) return item.category || "社区";
			return item.core ? "核心" : "工具";
		}
		function seatOf(installed, source) {
			if (!installed || !source) return "";
			var v = installed[source];
			if (!v) return "";
			return v === true ? "installed" : String(v);
		}

		var inputStyle = {
			flex: "1 1 150px", minWidth: 150, height: 32, padding: "0 10px", boxSizing: "border-box",
			border: "1px solid " + T.ln2, borderRadius: 8, outline: "none", background: T.b1,
			color: T.p, fontSize: 13, fontFamily: T.font,
		};

		function Spinner(props) {
			return React.createElement(IconLoadingOutline16, {
				size: props.size || 12,
				style: { animation: "dsh-market-spin .8s linear infinite", verticalAlign: "-2px", flex: "none" },
			});
		}

		function Pill(props) {
			return React.createElement("span", {
				style: {
					display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 6px",
					border: "1px solid " + (props.border || T.ln3), borderRadius: 4, fontSize: 11, fontWeight: 500,
					lineHeight: "20px", whiteSpace: "nowrap",
					color: props.color || T.s, background: props.bg || "transparent",
				},
			}, props.children);
		}

		function Chip(props) {
			var on = props.on;
			return React.createElement("button", {
				type: "button",
				onClick: props.onClick,
				style: {
					display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 10px",
					border: "none", borderRadius: 12, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
					color: on ? T.p : T.s, fontWeight: on ? 500 : 400,
					background: on ? T.ghost : "transparent",
				},
				title: props.title,
			},
				props.children,
				props.count != null ? React.createElement("span", { style: { color: T.t, fontSize: 11 } }, props.count) : null
			);
		}

		function OpBar(props) {
			var ops = props.ops;
			var t = props.t;
			var total = ops.length;
			var active = ops.filter(opActive).length;
			var failed = ops.filter(opFailed).length;
			var [expandedErrId, setExpandedErrId] = useState(null);
			if (total === 0) return null;
			var chipBtn = {
				flex: "none", display: "inline-flex", alignItems: "center", gap: 8,
				height: 28, padding: "0 12px", border: "1px solid " + T.ln2, borderRadius: 14,
				background: T.b3, color: T.p, fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
			};
			if (!props.expanded) {
				return React.createElement("button", {
					type: "button", onClick: props.onToggle, style: chipBtn, title: t("opQueue") + " · " + active + "/" + total,
				},
					React.createElement("span", {
						style: {
							width: 8, height: 8, borderRadius: "50%", flex: "none",
							background: active > 0 ? T.brand : (failed > 0 ? T.err : T.ok),
						},
					}),
					React.createElement("span", null, t("opQueue") + " · " + active + "/" + total),
					React.createElement("span", null, "▸")
				);
			}
			return React.createElement("div", {
				style: {
					flex: "none", border: "1px solid " + T.ln2, borderRadius: 12, background: T.b2,
					padding: "8px 10px", marginBottom: 10,
				},
			},
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, paddingBottom: 6 } },
					React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: T.p } }, t("opQueue")),
					React.createElement("span", { style: { fontSize: 11, color: T.t } },
						String(t("opCount")).replace("{active}", String(active)).replace("{total}", String(total))),
					React.createElement("span", { style: { marginLeft: "auto", display: "flex", gap: 6 } },
						React.createElement(Button, {
							size: "sm", disabled: active > 0 || total === 0,
							onClick: props.onClearAll, title: active > 0 ? t("clearAllDisabled") : t("clearAll"),
						}, t("clearAll")),
						React.createElement(Button, { size: "sm", onClick: props.onToggle }, t("minimize"))
					)
				),
				ops.map(function (o) {
					var terminal = opTerminal(o);
					var active_ = opActive(o);
					var failed_ = opFailed(o);
					var pct = percentOf(o);
					var name = o.name || o.target || o.source || o.opId || (o.method || o.kind) || "";
					var method = o.method || o.kind || "";
					var dotColor = active_ ? T.brand : (failed_ ? T.err : T.ok);
					var stColor = failed_ ? T.err : (active_ ? T.brand : T.ok);
					var errText = o.error || o.output || o.stderr || "";
					return React.createElement("div", { key: o.id || o.opId || name + method + o.createdAt, style: { padding: "6px 0", borderTop: "1px solid " + T.ln1 } },
						React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } },
							React.createElement("span", { style: { width: 8, height: 8, borderRadius: "50%", flex: "none", background: dotColor } }),
							React.createElement(Pill, { color: stColor, bg: T.bm }, statusText(o.status, t)),
							React.createElement("span", {
							title: name,
							style: {
								flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, color: T.p,
								overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
							},
						}, String(method).toLowerCase().indexOf("install") > -1 ? t("install") + " " : (String(method).toLowerCase().indexOf("uninstall") > -1 ? t("uninstall") + " " : (String(method).toLowerCase().indexOf("update") > -1 ? t("update") + " " : "")), name),
							React.createElement("span", { style: { display: "flex", gap: 4, flex: "none" } },
								active_ ? React.createElement(Button, { size: "sm", onClick: function () { props.onKill(o.id || o.opId); } }, t("kill")) : null,
								terminal ? React.createElement(Button, { size: "sm", onClick: function () { props.onClear(o.id || o.opId); } }, t("clear")) : null
							)
						),
						active_ ? React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 } },
						React.createElement("div", {
							style: { flex: 1, height: 6, borderRadius: 3, background: T.hov, overflow: "hidden", position: "relative" },
						},
							React.createElement("div", {
								style: pct > 0
									? { height: "100%", borderRadius: 3, background: T.brand, width: pct + "%", transition: "width .3s ease" }
									: { height: "100%", borderRadius: 3, background: T.brand, width: "30%", animation: "dsh-market-slide 1.2s ease-in-out infinite" },
							})
						),
						React.createElement("span", { style: { fontSize: 11, color: T.t } }, pct > 0 ? pct + "%" : ""),
						React.createElement("span", { style: { fontSize: 11, color: T.t } },
							(o.progress && o.progress.stage) || o.stage || "")
					) : null,
						failed_ && errText ? (
						expandedErrId === (o.id || o.opId) ? React.createElement("div", { style: { marginTop: 6 } },
							React.createElement("div", {
								style: {
									padding: "6px 10px", borderRadius: 8,
									background: "color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)",
									color: T.err, fontSize: 11, lineHeight: 16,
									whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 140, overflow: "auto",
									maxWidth: 580, fontFamily: T.mono,
								},
							}, String(errText)),
							React.createElement("button", {
								type: "button", onClick: function () { setExpandedErrId(null); },
								style: { marginTop: 4, fontSize: 11, color: T.t, background: "transparent", border: "none", cursor: "pointer", padding: 0 },
							}, t("hideLog") + " ▴")
						) : React.createElement("button", {
							type: "button", onClick: function () { setExpandedErrId(o.id || o.opId); },
							style: { marginTop: 6, fontSize: 11, color: T.t, background: "transparent", border: "1px solid " + T.ln2, borderRadius: 6, padding: "2px 8px", cursor: "pointer" },
						}, t("showLog") + " ▾")
					) : null
				);
			})
		);
	}

		function ConfirmDialog(props) {
			var t = props.t;
			var kind = props.kind;
			var item = props.item;
			var isInstall = kind === "install";
			var isUninstall = kind === "uninstall";
			var isDisable = kind === "disable";
			var title = isInstall ? t("confirmInstall") : isUninstall ? t("confirmUninstall")
				: kind === "update" ? t("confirmUpdate") : isDisable ? t("confirmDisable") : t("confirmEnable");
			var [skip, setSkip] = useState(false);
			useEffect(function () { setSkip(false); }, [kind, item && item.source]);
			useEffect(function () {
				function handleKeyDown(e) {
					if (e.key === "Escape") { e.preventDefault(); onSafeCancel(); }
				}
				if (item) { document.addEventListener("keydown", handleKeyDown); }
				return function () { document.removeEventListener("keydown", handleKeyDown); };
			}, [item]);
			if (!item) return null;
			var meta = [];
			if (item.name || item.source) meta.push([t("sourceLabel"), item.source || item.name]);
			if (item.version) meta.push([t("version"), item.version]);
			if (item.category) meta.push([t("category"), item.category]);
			if (item.repository) meta.push([t("repository"), item.repository]);
			var decoText = String((item.name || "") + " " + (item.desc || "") + " " + (item.source || "") + " " + (item.category || "")).toLowerCase();
			var isDecorative = isInstall && /ikun|mascot|吉祥物|音乐盒|壁纸轮播|全屏壁纸|应援|跳舞|wallpaper|player|mascot/i.test(decoText);
			var resolveUrl = item.url || (item.type === "npm" ? "https://www.npmjs.com/package/" + encodeURIComponent(item.name || item.source) : "") || item.repository || "";
			return React.createElement("div", {
				style: {
					position: "fixed", inset: 0, zIndex: 1200,
					background: "color-mix(in srgb, var(--dsw-alias-bg-base) 88%, transparent)",
					display: "flex", alignItems: "flex-start", justifyContent: "center",
					padding: "10vh 16px 24px", overflow: "auto",
				},
				onClick: function () { onSafeCancel(); },
			},
				React.createElement("div", {
					style: {
						width: "min(520px,100%)", maxHeight: "80vh", background: T.b2, border: "1px solid " + T.ln2, borderRadius: 14,
						padding: "16px 18px", boxSizing: "border-box",
						boxShadow: "0 16px 48px rgba(0,0,0,.28)",
						display: "flex", flexDirection: "column",
					},
					onClick: function (e) { e.stopPropagation(); },
				},
					React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: T.p, marginBottom: 10, flex: "none" } }, title),
					React.createElement("div", {
						style: {
							display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
							borderRadius: 12, background: T.b3, marginBottom: 8, flex: "none",
						},
					},
					React.createElement(ItemIcon, { item: item, size: 36 }),
						React.createElement("div", { style: { minWidth: 0 } },
							React.createElement("div", {
								style: { fontSize: 13, fontWeight: 600, color: T.p, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
							}, item.name || item.source),
							React.createElement("div", { style: { fontSize: 11, color: T.t, fontFamily: T.mono, wordBreak: "break-all" } }, item.source || item.name)
						)
					),
				isDecorative ? React.createElement("div", {
					style: {
						display: "flex", gap: 6, alignItems: "flex-start", padding: "8px 10px",
						borderRadius: 8, background: "color-mix(in srgb, " + T.warn + " 10%, transparent)",
						border: "1px solid color-mix(in srgb, " + T.warn + " 35%, transparent)",
						color: T.warn, fontSize: 12, lineHeight: "17px", marginBottom: 8, flex: "none",
					},
				},
					React.createElement("span", { style: { flex: "none" } }, "⚠"),
					React.createElement("span", { style: { flex: 1, minWidth: 0 } }, t("decoWarn"))
				) : null,
				meta.length ? React.createElement("div", {
						style: {
							display: "flex", flexDirection: "column", gap: 4, padding: "8px 12px",
							borderRadius: 10, background: T.hov, fontSize: 12, color: T.s, marginBottom: 8, wordBreak: "break-all",
						},
					}, meta.map(function (m) {
						return React.createElement("div", { key: m[0] },
							React.createElement("span", { style: { color: T.t, marginRight: 6 } }, m[0]),
							m[0] === t("repository") && /^https?:\/\//.test(String(m[1]))
								? React.createElement("a", { href: m[1], target: "_blank", rel: "noopener noreferrer", style: { color: T.brand } }, m[1])
								: React.createElement("span", { style: { fontFamily: T.mono, color: T.p } }, m[1])
						);
					})) : null,
					item.desc ? React.createElement("div", {
						style: { fontSize: 12, lineHeight: 20, color: T.s, whiteSpace: "pre-wrap", marginBottom: 8 },
					}, item.desc) : null,
					resolveUrl && (item.url || item.repository) ? React.createElement("a", {
						href: resolveUrl, target: "_blank", rel: "noopener noreferrer",
						style: { fontSize: 12, fontWeight: 500, color: T.brandT, textDecoration: "none", display: "inline-block", marginBottom: 8 },
					}, t("goRepo")) : null,
					isUninstall ? React.createElement("div", { style: { fontSize: 12, color: T.err, marginBottom: 8 } }, t("uninstallWarn")) : null,
					isDisable ? React.createElement("div", { style: { fontSize: 12, color: T.s, marginBottom: 8 } }, t("disableWarn")) : null,
					isInstall ? React.createElement("label", {
					style: {
						display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.err,
						marginBottom: 4, cursor: "pointer",
						padding: "6px 10px", borderRadius: 8, background: "color-mix(in srgb, " + T.err + " 8%, transparent)",
						border: "1px solid color-mix(in srgb, " + T.err + " 35%, transparent)",
					},
				},
						React.createElement("input", {
							type: "checkbox", checked: skip,
							onChange: function (e) { setSkip(e.target.checked); },
							style: { accentColor: T.brand },
						}),
						React.createElement("span", null, t("skipCheck"))
					) : null,
					isInstall ? React.createElement("div", { style: { fontSize: 11, color: T.t, marginBottom: 10, lineHeight: 17 } }, t("safetyHint")) : null,
					React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 } },
						React.createElement(Button, { variant: "ghost", onClick: function () { onSafeCancel(); } }, t("cancel")),
						React.createElement(Button, {
							variant: isInstall ? "primary" : "ghost",
							style: isUninstall ? { color: T.err } : (isInstall ? undefined : undefined),
							onClick: function () { props.onConfirm(skip); },
						}, t("execute"))
					)
				)
			);

			function onSafeCancel() {
				if (typeof props.onCancel === "function") props.onCancel();
			}
		}

		function AlertBar(props) {
		var kind = props.kind || "error";
		var colors = { success: T.ok, warning: T.warn, error: T.err };
		var color = colors[kind] || T.err;
		var bg = "color-mix(in srgb, " + color + " 10%, transparent)";
		return React.createElement("div", {
			style: {
				flex: "none", display: "flex", alignItems: "flex-start", gap: 6,
				padding: "8px 12px", borderRadius: 6, fontSize: 12, lineHeight: "17px",
				color: color, background: bg, maxWidth: "100%", alignSelf: "stretch",
				overflow: "hidden",
			},
		},
			React.createElement("span", { style: { flex: 1, minWidth: 0, wordBreak: "break-word" } }, (kind === "success" ? "✓" : kind === "warning" ? "⚠" : "✕") + " " + props.text),
			props.onDismiss ? React.createElement("button", {
				type: "button",
				onClick: props.onDismiss,
				style: { background: "transparent", border: "none", cursor: "pointer", color: color, fontSize: 13, padding: "0 2px", flex: "none" },
			}, "×") : null
		);
	}

		function DetailView(props) {
			var it = props.item;
			var tt = props.t;
			var [tab, setTab] = useState("overview");
			var [readme, setReadme] = useState("");
			var [versions, setVersions] = useState(null);
			var [readmeLoading, setReadmeLoading] = useState(false);
			var [versionsLoading, setVersionsLoading] = useState(false);
			var [copied, setCopied] = useState(false);

			function loadReadme() {
				if (!it.source) return;
			 setReadmeLoading(true);
			 fetch("/api/market/plugin/readme?source=" + encodeURIComponent(it.source))
					.then(function (r) { return r.json(); })
					.then(function (d) { setReadme((d && d.markdown) || ""); setReadmeLoading(false); })
					.catch(function () { setReadmeLoading(false); });
			}

			function loadVersions() {
				if (!it.source) return;
			 setVersionsLoading(true);
			 fetch("/api/market/plugin/versions?source=" + encodeURIComponent(it.source))
					.then(function (r) { return r.json(); })
					.then(function (d) { setVersions((d && d.versions) || []); setVersionsLoading(false); })
					.catch(function () { setVersionsLoading(false); });
			}

			useEffect(function () {
				if (tab === "overview") loadReadme();
				else if (tab === "versions") loadVersions();
			}, [tab]);

			function renderMarkdown(md) {
				if (!md) return null;
				var html = md
					.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
					.replace(/^### (.*$)/gm, "<h4>$1</h4>")
					.replace(/^## (.*$)/gm, "<h3>$1</h3>")
					.replace(/^# (.*$)/gm, "<h2>$1</h2>")
					.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
					.replace(/\*(.+?)\*/g, "<em>$1</em>")
					.replace(/`([^`]+)`/g, "<code>$1</code>")
					.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
					.replace(/```([\s\S]*?)```/g, function (m, code) { return "<pre><code>" + code.trim() + "</code></pre>"; })
					.replace(/\n\n/g, "</p><p>")
					.replace(/\n/g, "<br/>");
				return "<p>" + html + "</p>";
			}

			var installCmd = (tt("installCommand") || "dsh plugin --profile web add {source}").replace("{source}", it.source || it.name || "");

			var safeBadge = it.safe !== false
				? React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, background: "color-mix(in srgb, " + T.ok + " 12%, transparent)", color: T.ok, fontSize: 11 } }, "✓ " + tt("whitelistOk"))
				: React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, background: "color-mix(in srgb, " + T.warn + " 12%, transparent)", color: T.warn, fontSize: 11 } }, "⚠ " + tt("whitelistUnknown"));

			var header = React.createElement("div", { style: { display: "flex", gap: 12, padding: "12px 0", flex: "none" } },
				React.createElement("div", { style: { flex: "none", width: 64, height: 64, borderRadius: 8, background: T.brand, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 24, fontWeight: 700 } },
					String((it.name || it.source || "?")[0] || "?").toUpperCase()
				),
				React.createElement("div", { style: { flex: 1, minWidth: 0 } },
					React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
						React.createElement("span", { style: { fontSize: 18, fontWeight: 700, color: T.p } }, it.name),
						it.owner ? React.createElement("span", { style: { fontSize: 12, color: T.t } }, "@" + it.owner) : null,
						safeBadge
					),
					React.createElement("div", { style: { fontSize: 12, color: T.t, marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" } },
						it.category ? React.createElement("span", null, tt("category") + ": " + it.category) : null,
						it.version ? React.createElement("span", null, tt("version") + ": " + it.version) : null,
						it.stars ? React.createElement("span", null, "★ " + it.stars) : null,
						it.downloads ? React.createElement("span", null, "↓ " + it.downloads) : null
					),
					React.createElement("div", { style: { fontSize: 13, lineHeight: "19px", color: T.s, marginTop: 6, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 4, overflow: "hidden" } }, it.desc || "")
				)
			);

			var breadcrumb = React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "8px 0", fontSize: 12, color: T.t, flex: "none" } },
				React.createElement("button", { type: "button", onClick: props.onBack, style: { background: "transparent", border: "none", cursor: "pointer", color: T.brand, fontSize: 12, padding: 0 } }, "‹ " + tt("backToList")),
				React.createElement("span", null, "  ·  " + (it.category || tt("community")) + " › " + it.name)
			);

			var tabBar = React.createElement("div", { style: { display: "flex", gap: 0, borderBottom: "1px solid " + T.ln1, flex: "none" } },
				[["overview", tt("tabOverview")], ["versions", tt("tabVersions")], ["security", tt("tabSecurity")], ["reviews", tt("tabReviews")]].map(function (p) {
					var active = tab === p[0];
					return React.createElement("button", {
						key: p[0],
						type: "button",
						onClick: function () { setTab(p[0]); },
						style: {
							padding: "8px 14px", fontSize: 13, cursor: "pointer",
							background: "transparent", border: "none",
							color: active ? T.brand : T.t, fontWeight: active ? 600 : 400,
							borderBottom: "2px solid " + (active ? T.brand : "transparent"),
							marginBottom: "-1px",
						},
					}, p[1]);
				})
			);

			var content = null;
			if (tab === "overview") {
				content = readmeLoading
					? React.createElement("div", { style: { padding: 12, color: T.t, fontSize: 12 } }, tt("loadingReadme"))
					: readme
						? React.createElement("div", {
							className: "dsh-market-readme",
							style: { padding: 12, fontSize: 13, lineHeight: "20px", color: T.p, wordBreak: "break-word" },
							dangerouslySetInnerHTML: { __html: renderMarkdown(readme) },
						})
						: React.createElement("div", { style: { padding: 12, color: T.t, fontSize: 12 } }, tt("noReadme"));
			} else if (tab === "versions") {
				content = versionsLoading
					? React.createElement("div", { style: { padding: 12, color: T.t, fontSize: 12 } }, tt("loading"))
					: versions && versions.length
						? React.createElement("div", { style: { padding: 12, display: "flex", flexDirection: "column", gap: 4 } },
							versions.map(function (v) {
								return React.createElement("div", {
									key: v.sha || v.version,
									style: { padding: "6px 10px", borderRadius: 6, background: T.b2, fontSize: 12, fontFamily: T.mono, color: T.p },
								}, v.version + (v.sha ? "  " + v.sha.substring(0, 7) : ""));
							})
						)
						: React.createElement("div", { style: { padding: 12, color: T.t, fontSize: 12 } }, tt("noVersions"));
			} else if (tab === "security") {
				content = React.createElement("div", { style: { padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 } },
					React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
						React.createElement("span", { style: { color: T.t, fontSize: 12 } }, tt("sourceLabel") + ":"),
						React.createElement("code", { style: { fontFamily: T.mono, fontSize: 12, padding: "2px 6px", borderRadius: 4, background: T.b2, color: T.p } }, it.source || it.name || "—")
					),
					React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
						React.createElement("span", { style: { color: T.t, fontSize: 12 } }, tt("category") + ":"),
						React.createElement("span", { style: { fontSize: 12 } }, it.category || "—")
					),
					React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, safeBadge),
					React.createElement("div", { style: { marginTop: 4 } },
						React.createElement("div", { style: { color: T.t, fontSize: 12, marginBottom: 4 } }, installCmd),
						React.createElement(Button, {
							size: "sm",
							onClick: function () {
								try { navigator.clipboard.writeText(installCmd); setCopied(true); setTimeout(function () { setCopied(false); }, 2000); } catch (e) {}
							},
						}, copied ? tt("copied") : tt("copyCommand"))
					)
				);
			} else {
				content = React.createElement("div", { style: { padding: 12, color: T.t, fontSize: 12 } }, tt("noReviews"));
			}

			return React.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100%", flex: "1 1 0", minHeight: 0 } },
				breadcrumb,
				header,
				tabBar,
				React.createElement("div", { style: { flex: "1 1 0", minHeight: 0, overflowY: "auto" } }, content)
			);
		}

		function ItemIcon(props) {
			var item = props.item;
			var size = props.size || 40;
			var _ie = useState(false);
			var imgErr = _ie[0], setImgErr = _ie[1];
			var owner = "";
			if (item.url && item.url.indexOf("github.com") !== -1) {
				var m = item.url.match(/github\.com\/([^\/]+)/);
				if (m) owner = m[1];
			}
			if (!owner && item.owner) owner = item.owner;
			if (!owner && item.source && item.source.indexOf("#") !== -1) owner = item.source.split("#")[0];
			var imgUrl = owner ? "https://github.com/" + encodeURIComponent(owner) + ".png?size=" + (size * 2) : "";
			var letter = String((item.name || item.source || "?")[0] || "?").toUpperCase();
			if (imgUrl && !imgErr) {
				return React.createElement("div", { style: { flex: "none", width: size, height: size, borderRadius: 6, overflow: "hidden", flexShrink: 0, position: "relative", background: T.b3 } },
					React.createElement("img", {
						src: imgUrl,
						alt: letter,
						onError: function () { setImgErr(true); },
						style: {
							width: "100%", height: "100%", objectFit: "cover",
							position: "absolute", inset: 0,
						},
					}),
					React.createElement("div", {
						style: {
							position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
							fontSize: size * 0.4, fontWeight: 700, color: T.p, opacity: 0.15, pointerEvents: "none",
						},
					}, letter)
				);
			}
			return React.createElement("div", {
				style: {
					flex: "none", width: size, height: size, borderRadius: 6,
					background: T.b3, border: "1px solid " + T.ln2,
					display: "flex", alignItems: "center", justifyContent: "center",
					color: T.s, fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
				},
			}, letter);
		}

		function ItemCard(props) {
			var item = props.item;
			var t = props.t;
			var st = props.state;
			var busy = props.busy;
			var op = props.op;
			var detail = props.detail;
			var tabs = props.tabs;
			var isTab = false;
			for (var i = 0; i < (tabs || []).length; i += 1) {
				var tp = tabs[i];
				if (tp.source === item.source || tp.id === item.source || (item.id && tp.id === item.id)) { isTab = true; break; }
			}
			var name = item.name || item.source || "";
			var repoUrl = item.url || item.repository || (item.type === "npm" && item.name ? "https://www.npmjs.com/package/" + encodeURIComponent(item.name) : "");
			var nameEl = repoUrl
				? React.createElement("a", { href: repoUrl, target: "_blank", rel: "noopener noreferrer", style: { color: "inherit", textDecoration: "none", display: "block" }, title: name }, name)
				: React.createElement("span", { style: { display: "block" } }, name);

			var pills = [];
			if (item.version) pills.push(React.createElement(Pill, { key: "v" }, "v" + item.version));
			if (item.core) pills.push(React.createElement(Pill, { key: "c", color: T.err, border: T.err }, "core"));
			if (item.community) pills.push(React.createElement(Pill, { key: "cm", color: T.s }, item.category ? t("communityPrefix") + item.category : t("communityOnly")));
			if (isTab) pills.push(React.createElement(Pill, { key: "tab", color: T.brand, border: T.brand }, t("tabBadge")));
			if (st === "installed") pills.push(React.createElement(Pill, { key: "ok", color: T.ok, border: T.ok }, t("installedPill")));
			else if (st === "disabled") pills.push(React.createElement(Pill, { key: "off", color: T.t }, t("disabledPill")));
			if (item.outdated) pills.push(React.createElement(Pill, { key: "up", color: T.brand, border: T.brand },
				React.createElement(IconRefresh, { size: 10 }), " " + t("update") + " " + (item.currentVersion || "") + "→" + (item.latestVersion || "")));

			var action = null;
			if (busy && op) {
				action = React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: T.s, whiteSpace: "nowrap" } },
					React.createElement(Spinner, { size: 12 }), busyText(op.method || op.kind, t));
			} else if (st === "" || st === "available") {
				action = React.createElement(Button, { variant: "primary", size: "sm", onClick: function(e) { e.stopPropagation(); props.onInstall(); } }, t("install"));
			} else if (st === "core-bundle") {
				action = React.createElement("span", { style: { fontSize: 12, fontWeight: 600, color: T.ok, whiteSpace: "nowrap" } }, t("installedCore"));
			} else if (st === "installed") {
				action = React.createElement("span", { style: { fontSize: 12, fontWeight: 600, color: T.ok, whiteSpace: "nowrap" } }, t("installedPill"));
			} else if (st === "disabled") {
				action = React.createElement("span", { style: { fontSize: 12, fontWeight: 600, color: T.t, whiteSpace: "nowrap" } }, t("disabledPill"));
			}

			var footActions = null;
			if ((st === "installed" || st === "disabled") && !busy) {
				var toggle = st === "disabled"
					? React.createElement(Button, { size: "sm", onClick: function(e) { e.stopPropagation(); props.onEnable(); } }, t("enable"))
					: React.createElement(Button, { size: "sm", onClick: function(e) { e.stopPropagation(); props.onDisable(); } }, t("disable"));
				var removed = PROTECTED[item.source];
				footActions = React.createElement(React.Fragment, null,
					React.createElement(Button, { size: "sm", onClick: function(e) { e.stopPropagation(); props.onUpdate(); } }, t("update")),
					toggle,
					React.createElement(Button, {
						size: "sm", style: { color: removed ? T.t : T.err },
						disabled: !!removed, title: removed ? t("protectedUninstall") : undefined,
						onClick: removed ? undefined : function(e) { e.stopPropagation(); props.onUninstall(); },
					}, t("uninstall"))
				);
			}

			var meta = [];
			if (item.name || item.source) meta.push([t("sourceLabel"), item.source || item.name]);
			if (item.installedAs || item.installAs) meta.push([t("sourceLabel"), item.installedAs || item.installAs]);
			if (item.currentVersion) meta.push([t("version"), t("installed") + " " + item.currentVersion + (item.latestVersion ? " · " + t("latestVersion") + " " + item.latestVersion : "")]);
			else if (item.version) meta.push([t("version"), item.version]);
			if (item.repository) meta.push([t("repository"), item.repository]);
			if (item.category) meta.push([t("category"), item.category]);
			if (item.url) meta.push(["GitHub", item.url]);
			if (item.stars) meta.push([t("stars"), String(item.stars)]);
			if (item.downloads) meta.push([t("npmDownloads"), formatNum(item.downloads)]);
			if (item.owner) meta.push([t("author"), item.owner]);
			if (item.npm) meta.push(["npm", item.npm]);

			return React.createElement("div", {
				style: {
				display: "flex", flexDirection: "row", gap: 10, padding: "8px 12px", alignSelf: "stretch",
				background: T.b1, border: "1px solid " + T.ln2, borderRadius: 8, minWidth: 0, height: "fit-content",
				cursor: props.onSelect ? "pointer" : "default", transition: "background .15s",
				},
				onClick: props.onSelect,
			},
				React.createElement(ItemIcon, { item: item, size: 40 }),
				React.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } },
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "none" } },
					React.createElement("div", { style: { minWidth: 0, flex: 1 } },
						React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
							React.createElement("span", { style: { fontSize: 14, fontWeight: 600, lineHeight: "20px", color: T.p, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, nameEl),
							item.owner ? React.createElement("span", { style: { fontSize: 11, color: T.t, flex: "none" } }, "@" + item.owner) : null,
							item.stars ? React.createElement("span", { style: { fontSize: 11, color: T.s, flex: "none", display: "inline-flex", alignItems: "center", gap: 2 } }, "★", formatNum(item.stars)) : null,
							item.downloads ? React.createElement("span", { style: { fontSize: 11, color: T.t, flex: "none", display: "inline-flex", alignItems: "center", gap: 2 } }, "↓", formatNum(item.downloads)) : null
						)
					),
					action ? React.createElement("div", { style: { flex: "none", display: "inline-flex", alignItems: "center" } }, action) : null
				),
				item.desc ? React.createElement("div", {
					style: {
						fontSize: 12, lineHeight: "17px", color: T.t, flex: "none",
						display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden",
					},
				}, item.desc) : null,
				!detail && !item.desc ? React.createElement("div", {
					style: { fontSize: 12, lineHeight: "17px", color: T.t, flex: "none" },
				}, t("noDesc")) : null,
				detail ? React.createElement("div", {
					style: {
						display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px", borderRadius: 8,
						background: T.b2, fontSize: 11, color: T.s, wordBreak: "break-all", flex: "none",
					},
				},
					meta && meta.length ? meta.map(function (m) {
						return React.createElement("div", { key: m[0] },
							React.createElement("span", { style: { color: T.t, marginRight: 5 } }, m[0] + "："),
							React.createElement("span", { style: { fontFamily: T.mono } }, m[1])
						);
					}) : null,
					isTab ? React.createElement("div", { style: { color: T.t, lineHeight: 16 } },
						React.createElement("span", { style: { display: "inline-block", padding: "0 6px", borderRadius: 3, background: T.brand, color: "#fff", fontSize: 10, fontWeight: 600, marginRight: 6 } }, t("tabBadge")),
						st === "core-bundle" ? t("tabHintCore") : t("tabHintInstalled")) : null,
					React.createElement("button", {
						type: "button", onClick: props.onToggleDetail,
						style: { border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: T.t, alignSelf: "flex-start", padding: 0 },
					}, t("collapse"))
				) : null,
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", rowGap: 4, flex: "none", marginTop: 2 } },
					(item.category ? React.createElement(Pill, { key: "cat" }, item.category) : null),
					pills,
					React.createElement("span", { style: { flex: 1 } }),
					footActions,
					!detail ? React.createElement("button", {
						type: "button", onClick: props.onToggleDetail,
						style: { border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: T.t, whiteSpace: "nowrap", padding: 0 },
					}, t("detail")) : null
				)
				)
			);
		}

		function SkeletonCards(props) {
			var rows = [0, 1, 2, 3, 4, 5];
			return React.createElement("div", {
				style: {
					display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10, alignContent: "start", alignItems: "start", paddingTop: 12,
				},
			}, rows.map(function (i) {
				return React.createElement("div", {
					key: i,
					className: "dsh-market-skeleton-pulse",
					style: {
						display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", height: "fit-content",
						borderRadius: 10, border: "1px solid " + T.ln2, background: T.b1,
					},
				},
					React.createElement("div", { style: { height: 18, width: "55%", borderRadius: 4, background: T.hov } }),
					React.createElement("div", { style: { height: 10, width: "80%", borderRadius: 4, background: T.hov } }),
					React.createElement("div", { style: { height: 10, width: "50%", borderRadius: 4, background: T.hov } }),
					React.createElement("div", { style: { height: 24, width: 60, borderRadius: 8, background: T.hov, marginTop: 2 } })
				);
			}));
		}

		function SourcesPanel(props) {
			var t = props.t;
			var list = props.list || [];
			var [name, setName] = useState("");
			var [addr, setAddr] = useState("");
			return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } },
				React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
					React.createElement("input", {
						style: inputStyle, placeholder: t("sourceName"), value: name,
						onChange: function (e) { setName(e.target.value); },
					}),
					React.createElement("input", {
						style: inputStyle, placeholder: t("sourceAddr"), value: addr,
						onChange: function (e) { setAddr(e.target.value); },
					}),
					React.createElement(Button, {
						variant: "primary", size: "sm",
						disabled: !name.trim() || !addr.trim(),
						onClick: function () {
							if (!name.trim() || !addr.trim()) return;
							props.onAdd(name.trim(), addr.trim()).then(function () { setName(""); setAddr(""); });
						},
					}, t("addSource"))
				),
				React.createElement("div", { style: { display: "flex", gap: 8 } },
					React.createElement(Button, { size: "sm", onClick: props.onRefreshCommunity }, t("refreshCommunity"))
				),
				React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: T.t } },
					String(t("sources")).replace(/s$/, "") + " (" + list.length + ")"),
				list.length === 0
					? React.createElement("div", { style: { textAlign: "center", padding: "20px 16px", color: T.t, fontSize: 13 } },
					React.createElement("div", null, t("noSources")),
						React.createElement("div", { style: { fontSize: 12, color: T.t } }, t("noSourcesSub")))
					: list.map(function (s) {
						return React.createElement("div", {
							key: s.id || s.source, style: {
								display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
								border: "1px solid " + T.ln1, borderRadius: 10, background: T.b2,
							},
						},
							React.createElement("div", { style: { minWidth: 0, flex: 1 } },
								React.createElement("div", { style: { fontSize: 13, fontWeight: 500, color: T.p } }, s.name),
								React.createElement("div", { style: { fontSize: 11, color: T.t, fontFamily: T.mono, wordBreak: "break-all" } }, s.source)
							),
							React.createElement(Button, { size: "sm", style: { color: T.err }, onClick: function () { props.onRemove(s.id); } }, t("sourceDelete"))
						);
					})
			);
		}

		function ThemesPanel(props) {
			var t = props.t;
			var themes = props.themes || [];
			var statuses = props.statuses || {};
			var activeTheme = props.activeTheme;
			var installed = themes.filter(function (it) { return it.installed; });
			var notInstalled = themes.filter(function (it) { return !it.installed; });
			var themeGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, alignContent: "start", alignItems: "start" };
			function themeCard(it, opts) {
				var isActive = opts && opts.active;
				var isPending = statuses[it.name] === 'installing';
				var action;
				if (isPending) {
					action = React.createElement(Button, { size: "sm", disabled: true }, React.createElement(Spinner, { size: 12 }), " " + t("themeSwitching"));
				} else if (opts && opts.isInstalled) {
				action = isActive
					? React.createElement(Button, { variant: "primary", size: "sm", onClick: function () { props.onSwitch(it.name); } }, t("disable"))
					: React.createElement(Button, { size: "sm", style: { border: "1px solid " + T.ln2, background: "transparent" }, onClick: function () { props.onSwitch(it.name); } }, t("themeSwitch"));
			} else {
					action = React.createElement(Button, { variant: "primary", size: "sm", onClick: function () { props.onInstall(it); } }, t("install"));
				}
				var ownerStr = it.owner ? ("@" + it.owner) : "";
				return React.createElement("div", {
					key: it.name,
					style: {
						display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", alignSelf: "start",
						background: T.b1, border: "1px solid " + (isActive ? T.brand : T.ln2),
						borderRadius: 10, minWidth: 0, height: "fit-content",
						transition: "border-color .15s, box-shadow .15s",
						cursor: "default",
					},
					onMouseEnter: function (e) { e.currentTarget.style.borderColor = isActive ? T.brand : T.hov; },
					onMouseLeave: function (e) { e.currentTarget.style.borderColor = isActive ? T.brand : T.ln2; },
				},
					React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, flex: "none" } },
						React.createElement("span", { style: { fontSize: 13, fontWeight: 600, lineHeight: "18px", color: T.p, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 } }, it.name),
						isActive ? React.createElement("span", { style: { fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: T.brand, color: "#fff", flex: "none", letterSpacing: 0.3 } }, t("themeActive")) : null,
						ownerStr ? React.createElement("span", { style: { fontSize: 11, color: T.t, flex: "none" } }, ownerStr) : null,
					),
					it.desc ? React.createElement("div", {
						style: { fontSize: 12, lineHeight: "17px", color: T.t, flex: "none", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" },
					}, it.desc) : null,
					React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4, flex: "none", marginTop: 2 } },
						action
					)
				);
			}
			return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12, paddingBottom: 12 } },
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flex: "none", padding: "4px 0 0" } },
					React.createElement("div", { style: { fontSize: 12, lineHeight: 18, color: T.t, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t("themeTabDesc")),
					React.createElement(Button, { size: "sm", onClick: props.onRefresh }, t("refreshThemes"))
				),
				installed.length > 0 ? React.createElement("div", null,
					React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: T.s, marginBottom: 8, letterSpacing: 0.3 } }, String(t("installed")) + " (" + installed.length + ")"),
					React.createElement("div", { style: themeGridStyle },
						installed.map(function (it) { return themeCard(it, { isInstalled: true, active: it.name === activeTheme }); })
					)
				) : null,
				notInstalled.length > 0 ? React.createElement("div", null,
					React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: T.t, marginTop: 4, marginBottom: 8, letterSpacing: 0.3 } }, String(t("notInstalled")) + " (" + notInstalled.length + ")"),
					React.createElement("div", { style: themeGridStyle },
						notInstalled.map(function (it) { return themeCard(it, { isInstalled: false }); })
					)
				) : null,
				React.createElement("div", {
					style: { fontSize: 11, color: T.t, lineHeight: 16, flex: "none", opacity: 0.5, textAlign: "right", maxWidth: 760, alignSelf: "flex-end" }, dangerouslySetInnerHTML: { __html: t("themeHint") },
				}),
				React.createElement("div", {
					style: { fontSize: 11, color: T.t, lineHeight: 16, flex: "none", opacity: 0.45, textAlign: "right", maxWidth: 760, alignSelf: "flex-end" },
				}, t("themeCredit"))
			);
		}

		function FabButton(props) {
			var t = props.t;
			return React.createElement("button", {
				type: "button",
				title: t("fabLabel"),
				onClick: props.onOpen,
				style: {
					width: "100%", display: "flex", alignItems: "center", gap: 8,
					height: 36, padding: "0 12px", boxSizing: "border-box",
					border: "none", borderRadius: 12, background: "transparent",
					color: T.s, font: "500 14px/22px " + T.font, cursor: "pointer",
				},
			},
				React.createElement("span", { style: { flex: "none", color: T.s } },
					React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" },
						React.createElement("path", { d: "M1.5 4.5L8 2l6.5 2.5M1.5 4.5L8 7l6.5-2.5M1.5 4.5v7L8 14V7M8 14l6.5-2.5v-7", stroke: "currentColor", strokeWidth: 1.4, strokeLinejoin: "round" })
					)
				),
				React.createElement("span", null, t("fabLabel"))
			);
		}

		function ensureWideStyle() {
			if (document.getElementById("dsh-market-wide-style")) return;
			var s = document.createElement("style");
			s.id = "dsh-market-wide-style";
			s.textContent =
				".dsh-market-dialog { width: min(920px, 100%) !important; max-height: 90vh; }"
				+ " .dsh-market-inner { display: flex; flex-direction: column; height: min(78vh, 700px); position: relative; overflow: hidden; }"
				+ " .dsh-market-content { padding-bottom: 8px; }"
				+ " .dsh-market-inner ::-webkit-scrollbar { width: 8px; height: 8px; }"
				+ " .dsh-market-inner ::-webkit-scrollbar-track { background: transparent; }"
				+ " .dsh-market-inner ::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--dsw-alias-fg-base) 25%, transparent); border-radius: 4px; }"
				+ " .dsh-market-inner ::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--dsw-alias-fg-base) 40%, transparent); }"
				+ " .dsh-market-skeleton-pulse { animation: dsh-market-pulse 1.4s ease-in-out infinite; }"
				+ " @keyframes dsh-market-spin { to { transform: rotate(360deg); } }"
				+ " @keyframes dsh-market-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(340%); } }"
				+ " @keyframes dsh-market-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }";
			document.head.appendChild(s);
		}

		function MarketPanel(props) {
			var STATUS = {
				NOT_INSTALLED: 'not-installed',
				INSTALLED: 'installed',
				INSTALLED_UPDATE: 'installed-update',
				INSTALLING: 'installing',
				ERROR: 'error',
			};
			var t = props.t;
			var open = props.open;
			ensureWideStyle();

			var [data, setData] = useState({ phase: "loading", officialItems: [], communityItems: [], customItems: [], installed: {}, tabCatalog: [] });
			var dataRef = useRef(null);
			if (!dataRef.current) dataRef.current = data;
			var [ops, setOps] = useState([]);
			var opsRef = useRef([]);
			var [query, setQuery] = useState("");
			var [tab, setTab] = useState("official");
			var [cat, setCat] = useState("all");
			var [qualityFilter, setQualityFilter] = useState("starred");
			var [visibleCount, setVisibleCount] = useState(50);
			var [mirror, setMirror] = useState(function () {
				try { return localStorage.getItem("dsh-market-mirror") === "1"; } catch (e) { return false; }
			});
			var [err, setErr] = useState("");
			var [okMsg, setOkMsg] = useState("");
			var [opsExpanded, setOpsExpanded] = useState(false);
			useEffect(function () {
				if (ops.some(opActive)) setOpsExpanded(true);
			}, [ops]);
			var [confirm, setConfirm] = useState(null);
			var [expandedSource, setExpandedSource] = useState("");
			var [sources, setSources] = useState([]);
			var [sourcesLoaded, setSourcesLoaded] = useState(false);
			var [themes, setThemes] = useState([]);
			var [activeTheme, setActiveTheme] = useState(null);
			var [statuses, setStatuses] = useState({});
			var [detailItem, setDetailItem] = useState(null);
			var [updates, setUpdates] = useState({});
			var updatesRef = useRef({});
			var mountedRef = useRef(true);
			useEffect(function () { return function () { mountedRef.current = false; }; }, []);

			function safeSet(fn, value) {
				if (mountedRef.current) fn(value);
			}

			function updateItemStatus(name, status) {
				safeSet(setStatuses, function (prev) {
					var next = Object.assign({}, prev);
					next[name] = status;
					return next;
				});
			}

			function getStatus(name) {
				return statuses[name] || STATUS.NOT_INSTALLED;
			}

			function loadCatalog() {
				apiFetch("catalog?profile=web").then(function (d) {
					if (!d || d.error) {
						safeSet(setData, { phase: "error", officialItems: [], communityItems: [], customItems: [], installed: {}, tabCatalog: [] });
						safeSet(setErr, t("catalogErr"));
						return;
					}
					var base = dataRef.current || {};
					var next = {
						phase: "ready",
						officialItems: d.official || [],
						communityItems: d.community || [],
						customItems: d.custom || [],
						installed: d.installed || {},
						tabCatalog: base.tabCatalog || [],
					};
					dataRef.current = next;
					safeSet(setData, next);
				});
				apiFetch("tab-catalog").then(function (d) {
					if (d && !d.error) {
						var base = dataRef.current || {};
						var next = Object.assign({}, base, { tabCatalog: d || [] });
						dataRef.current = next;
						safeSet(setData, next);
					}
				});
				loadThemes();
				apiFetch("updates").then(function (d) {
					if (d && !d.error && d.updates) {
						updatesRef.current = d.updates;
						safeSet(setUpdates, d.updates);
					}
				});
			}

			function loadThemes() {
			apiFetch("themes").then(function (d) {
				if (d && d.themes) safeSet(setThemes, d.themes);
				if (d && d.active) safeSet(setActiveTheme, d.active);
			});
		}

			function refreshThemes() {
				apiFetch("themes?force=1").then(function (d) {
					if (d && d.themes) safeSet(setThemes, d.themes);
				if (d && d.active) safeSet(setActiveTheme, d.active);
				});
			}

			function switchTheme(target) {
			updateItemStatus(target, 'installing');
			var safety = setTimeout(function () { updateItemStatus(target, 'not-installed'); }, 15000);
			apiFetch("themes", {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ target: target }),
			}).then(function (d) {
				clearTimeout(safety);
				updateItemStatus(target, d && d.ok ? 'installed' : 'not-installed');
			if (d && d.ok) {
				loadThemes();
				safeSet(setErr, "");
				safeSet(setOkMsg, "主题已切换，正在自动重启 dsh…");
				fetch("/api/market/restart-dsh", { method: "POST" }).catch(function () {});
				setTimeout(function () {
					safeSet(setOkMsg, "dsh 正在重启，请稍后刷新页面…");
				}, 2000);
			} else {
				safeSet(setErr, (d && d.error) || "切换主题失败");
			}
			}).catch(function () {
				clearTimeout(safety);
				updateItemStatus(target, 'not-installed');
				safeSet(setErr, "切换主题失败");
			});
		}

			function mergeOps(list) {
				var wasActive = opsRef.current.some(opActive);
				var map = {};
				var arr = [];
				list.forEach(function (o) {
					if (!o) return;
					var id = o.id || o.opId;
					if (!id) return;
					if (!map[id]) { arr.push(o); map[id] = o; }
				});
				opsRef.current.forEach(function (o) {
					if (!o) return;
					var id = o.id || o.opId;
					if (id && !map[id]) { arr.push(o); map[id] = o; }
				});
				var nowActive = arr.some(opActive);
				if (wasActive && !nowActive) loadCatalog();
				opsRef.current = arr;
				safeSet(setOps, arr);
			}

			function snapshotOps() {
				apiFetch("op/snapshot").then(function (d) {
					if (mountedRef.current === false) return;
					if (!d || d.error) return;
					var list = [];
					if (Array.isArray(d)) list = d;
					else if (d.ops && Array.isArray(d.ops)) list = d.ops;
					else if (d.queue && Array.isArray(d.queue)) list = d.queue;
					else if (d.op) list = [d.op];
					if (!list.length) return;
					mergeOps(list);
				});
			}

			function enrichOps() {
				var firstActive = null;
				for (var i = 0; i < opsRef.current.length; i += 1) {
					if (opActive(opsRef.current[i])) { firstActive = opsRef.current[i]; break; }
				}
				if (!firstActive) return;
				apiFetch("op/status?opId=" + encodeURIComponent(firstActive.id || firstActive.opId)).then(function (d) {
					if (mountedRef.current === false) return;
					if (!d || d.error) return;
					mergeOps([d.op || d]);
				});
			}

			useEffect(function () {
				if (!open) return;
				loadCatalog();
				snapshotOps();
				if (sourcesLoaded === false) {
					apiFetch("sources").then(function (d) {
						if (d && !d.error) { safeSet(setSources, d); safeSet(setSourcesLoaded, true); }
					});
				}
				var timer = setInterval(function () {
					if (opsRef.current.some(opActive)) { snapshotOps(); enrichOps(); }
				}, 2000);
				return function () { clearInterval(timer); };
			}, [open]);

			function submitOp(kind, item, skipCheck) {
				var source = item.source || item.name;
				if (!source) return;
				var payload = { method: kind, name: item.name, source: source, mirror: mirror };
				if (kind === "install") payload.skipCheck = !!skipCheck;
				if (item.gitInstall) payload.gitInstall = item.gitInstall;
				safeSet(setErr, "");
				apiFetch("op", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				}).then(function (r) {
				if (!r || r.error || r.ok === false) {
					var msg = (r && (r.error || r.message)) || t("opSubmitErr");
					if (kind === "disable" || kind === "enable") {
						safeSet(setErr, t("opUnsupported"));
						return;
					}
					safeSet(setErr, t("opSubmitErr") + "：" + String(msg));
					fallbackSubmit(kind, item);
					return;
				}
				if (kind === "disable" || kind === "enable") {
					safeSet(setErr, r.hint || "");
					loadCatalog();
					return;
				}
				var opId = r.opId || (r.op && (r.op.id || r.op.opId));
				if (opId) {
					var o = {
						id: opId, opId: opId, method: kind, kind: kind, name: item.name,
						source: source, target: source, status: "queued",
					};
					opsRef.current = opsRef.current.concat([o]);
					safeSet(setOps, opsRef.current);
				}
				snapshotOps();
			});
			}

			function fallbackSubmit(kind, item) {
				if (kind !== "install" && kind !== "uninstall" && kind !== "update") return;
				var url = kind === "install" ? "install" : (kind === "uninstall" ? "uninstall" : "update");
				var payload = { profile: "web", source: item.source, mirror: mirror };
				apiFetch(url, {
					method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
				}).then(function (r) {
					if (r && r.ok) { safeSet(setErr, ""); loadCatalog(); }
					else safeSet(setErr, String((r && (r.error || r.stderr)) || t("opFailed")));
				});
			}

			function killOp(opId) {
				apiFetch("op", {
					method: "POST", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ method: "kill", opId: opId }),
				}).then(function () { snapshotOps(); });
			}
			function clearOp(opId) {
				apiFetch("op", {
					method: "POST", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ method: "clear", opId: opId }),
				}).then(function () { snapshotOps(); });
			}
			function clearAllOps() {
				apiFetch("op", {
					method: "POST", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ method: "clear" }),
				}).then(function () { snapshotOps(); });
			}

			function toggleMirror() {
				var next = !mirror;
				setMirror(next);
				try { localStorage.setItem("dsh-market-mirror", next ? "1" : "0"); } catch (e) {}
			}

			function refreshCommunity() {
				safeSet(setErr, "");
				apiFetch("community?force=1", { timeout: 30000 }).then(function (d) {
					if (d && !d.error) loadCatalog();
					else safeSet(setErr, t("fetchCommunityErr"));
				});
			}

			function addSource(name, addr) {
				return apiFetch("sources", {
					method: "POST", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: name, source: addr }),
				}).then(function (r) {
					if (r && !r.error) {
						apiFetch("sources").then(function (d) { if (d && !d.error) safeSet(setSources, d); });
						loadCatalog();
						return { ok: true };
					}
					safeSet(setErr, t("sourceAddErr") + (r && r.error ? "：" + r.error : ""));
					return { ok: false };
				});
			}
			function removeSource(id) {
				apiFetch("sources?id=" + encodeURIComponent(id), { method: "DELETE" }).then(function (r) {
					if (r && !r.error) {
						apiFetch("sources").then(function (d) { if (d && !d.error) safeSet(setSources, d); });
						loadCatalog();
					} else safeSet(setErr, t("sourceDelErr"));
				});
			}

			function findOp(source) {
				if (!source) return null;
				for (var i = 0; i < opsRef.current.length; i += 1) {
					var o = opsRef.current[i];
					if (!o || opTerminal(o)) continue;
					if (String(o.source || o.target || "") === String(source)) return o;
				}
				return null;
			}

			function renderList(shown) {
				var list = [];
				var max = Math.min(shown.length, visibleCount);
				for (var i = 0; i < max; i++) {
					var it = shown[i];
					var item = Object.assign({}, it);
					var state = item.installedState || seatOf(dataRef.current.installed, item.source);
					item.tab = tab;
					var op = findOp(item.source);
					var busy = !!op;
					list.push(React.createElement(ItemCard, {
						key: item.source || item.id || (item.name) + i,
						item: item,
						state: state,
						busy: busy,
						op: op,
						t: t,
						tabs: dataRef.current.tabCatalog || [],
						detail: expandedSource === (item.source || item.name),
						onSelect: function () { setDetailItem(item); },
						onToggleDetail: function () {
							var key = item.source || item.name;
							setExpandedSource(expandedSource === key ? "" : key);
						},
						onInstall: function () { setConfirm({ kind: "install", item: item }); },
						onUninstall: function () { setConfirm({ kind: "uninstall", item: item }); },
						onUpdate: function () { setConfirm({ kind: "update", item: item }); },
						onDisable: function () { setConfirm({ kind: "disable", item: item }); },
						onEnable: function () { setConfirm({ kind: "enable", item: item }); },
					}));
				}
				if (visibleCount < shown.length) {
					list.push(React.createElement("div", { key: "load-more", style: { textAlign: "center", padding: "12px 0" } },
						React.createElement(Button, { size: "sm", onClick: function () { setVisibleCount(visibleCount + 50); } }, "加载更多 (" + (shown.length - visibleCount) + ")")));
				}
				return list;
			}

			function passesQualityFilter(it) {
			if (tab !== "community" || qualityFilter === "all") return true;
			var st = (it.stars || 0);
			if (qualityFilter === "starred") return st >= 1;
			if (qualityFilter === "curated") return st >= 5;
			return true;
		}

		function filteredItems() {
				var base = dataRef.current || {};
				var q = query.trim().toLowerCase();
				var out = [];
				if (tab === "installed") {
					for (var k in base.installed) {
						if (!Object.prototype.hasOwnProperty.call(base.installed, k)) continue;
						var isCore = base.installed[k] === "core-bundle";
						var up = updatesRef.current[k] || {};
						out.push({ source: k, name: k, desc: "", installedState: String(base.installed[k]) === "core-bundle" ? "core-bundle" : (base.installed[k] === "disabled" ? "disabled" : "installed"), core: isCore, currentVersion: up.current, latestVersion: up.latest, outdated: !!up.outdated });
					}
					out.sort(function (a, b) { return a.name.localeCompare(b.name); });
					return q ? out.filter(function (x) { return x.name.toLowerCase().indexOf(q) > -1; }) : out;
				}
				var arr = base.officialItems;
			if (tab === "community") arr = base.communityItems;
			else if (tab === "custom") arr = base.customItems;
			(arr || []).forEach(function (raw) {
				var it = Object.assign({ tab: tab }, raw);
				if (cat !== "all" && catOf(it) !== cat) return;
				if (q) {
					var hay = (it.name || "") + " " + (it.desc || "") + " " + (it.source || "");
					if (hay.toLowerCase().indexOf(q) === -1) return;
				}
				if (tab === "community" && qualityFilter !== "all") {
				if (!passesQualityFilter(it)) return;
			}
			out.push(it);
			});
			if (tab === "community") {
				out.sort(function (a, b) {
					var sa = (a.stars || 0), sb = (b.stars || 0);
					if (sb !== sa) return sb - sa;
					var da = (a.downloads || 0), db = (b.downloads || 0);
					if (db !== da) return db - da;
					return (a.name || "").localeCompare(b.name || "");
				});
			}
			return out;
			}

			function chips() {
			var base = dataRef.current || {};
			var counts = {};
			var arr = tab === "community" ? base.communityItems : base.officialItems;
			(arr || []).forEach(function (raw) {
				var it = Object.assign({ tab: tab }, raw);
				if (tab === "community" && !passesQualityFilter(it)) return;
				var c = catOf(it);
				counts[c] = (counts[c] || 0) + 1;
			});
				var keys = Object.keys(counts).sort(function (a, b) { return (counts[b] - counts[a]) || String(a).localeCompare(String(b)); });
				var out = [React.createElement(Chip, { key: "all", on: cat === "all", onClick: function () { setCat("all"); setVisibleCount(50); } }, t("all"))];
				keys.forEach(function (k) {
					out.push(React.createElement(Chip, {
						key: k, on: cat === k, count: counts[k],
						onClick: function () { setCat(cat === k ? "all" : k); setVisibleCount(50); },
					}, k === "核心" ? t("core") : (k === "工具" ? t("tools") : k)));
				});
				return out;
			}

			var counts = { official: 0, community: 0, themes: 0, installed: 0, custom: 0, sources: 0 };
		var base = dataRef.current || {};
		counts.official = (base.officialItems || []).length;
		counts.community = (base.communityItems || []).filter(function (raw) { return passesQualityFilter(Object.assign({ tab: "community" }, raw)); }).length;
		counts.themes = (themes || []).length;
			counts.custom = (base.customItems || []).length;
			counts.installed = Object.keys(base.installed || {}).length;
			counts.sources = (sources || []).length;

			var tabDefs = [
				["official", t("official")],
				["community", t("community")],
				["themes", t("themes")],
				["installed", t("installed")],
				["custom", t("custom")],
				["sources", t("sources")],
			];

			var shown = filteredItems();
			var active = ops.filter(opActive).length;

			return React.createElement(Modal, {
				open: open,
				onClose: function () { if (confirm) return; props.onClose(); },
				title: t("title"),
				description: t("subtitle"),
				closeLabel: t("close"),
				className: "dsh-market-dialog",
				contentClassName: "dsh-market-content",
			},
				React.createElement("div", { className: "dsh-market-inner" },
					React.createElement(OpBar, {
						ops: ops,
						expanded: opsExpanded,
						t: t,
						onToggle: function () { setOpsExpanded(!opsExpanded); },
						onKill: killOp,
						onClear: clearOp,
						onClearAll: clearAllOps,
					}),
					okMsg ? React.createElement(AlertBar, {
					kind: "success", text: okMsg,
					onDismiss: function () { safeSet(setOkMsg, ""); },
				}) : null,
					err ? React.createElement(AlertBar, {
					kind: "error", text: err,
					onDismiss: function () { safeSet(setErr, ""); },
				}) : null,
					React.createElement("div", {
						style: {
							flex: "none", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
							padding: "8px 0", borderBottom: "1px solid " + T.ln1,
						},
					}, tabDefs.map(function (td) {
						return React.createElement(Chip, {
							key: td[0], on: tab === td[0],
							count: counts[td[0]] || 0,
							onClick: function () {
								setTab(td[0]);
								setCat("all");
								setVisibleCount(50);
								if (td[0] === "sources" && !sourcesLoaded) {
									apiFetch("sources").then(function (d) {
										if (d && !d.error) { safeSet(setSources, d); safeSet(setSourcesLoaded, true); }
									});
								}
							},
						}, td[1]);
					})),
					React.createElement("div", { style: { flex: "1 1 0", minHeight: 0, overflowY: "auto", paddingBottom: 16 } },
						tab === "sources" ? React.createElement(SourcesPanel, {
							t: t,
							list: sources,
							onAdd: addSource,
							onRemove: removeSource,
							onRefreshCommunity: refreshCommunity,
						}) : tab === "themes" ? React.createElement(ThemesPanel, {
						t: t,
						themes: themes,
						statuses: statuses,
						activeTheme: activeTheme,
						onSwitch: switchTheme,
						onRefresh: refreshThemes,
						onInstall: function (it) { submitOp("install", it, false); },
					}) : (
							React.createElement("div", { style: { display: "flex", flexDirection: "column", minHeight: "100%" } },
								React.createElement("div", { style: { flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "12px 0 0" } },
									React.createElement("label", {
										style: {
											flex: 1, display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px",
											boxSizing: "border-box", border: "1px solid " + T.ln2, borderRadius: 8, background: T.b1,
										},
									},
										React.createElement(IconSearchOutline16, { size: 14, style: { flex: "none", color: T.t } }),
										React.createElement("input", {
											style: {
												flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent",
												font: "13px/22px " + T.font, color: T.p, caretColor: T.brand,
											},
											placeholder: t("search"),
											value: query,
											onChange: function (e) { setQuery(e.target.value); setVisibleCount(50); },
										})
									),
									React.createElement("button", {
										type: "button", onClick: toggleMirror,
										title: t("mirror"),
										style: {
											display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px",
											border: "1px solid " + T.ln2, borderRadius: 16, background: "transparent",
											color: mirror ? T.p : T.s, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
										},
									},
										React.createElement("span", {
											style: {
												width: 8, height: 8, borderRadius: "50%", background: mirror ? T.brand : T.t,
											},
										}),
										t("mirror")
									),
									React.createElement("button", {
										type: "button", onClick: function () { setErr(""); loadCatalog(); }, title: t("refresh"),
										style: {
											flex: "none", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
											border: "1px solid " + T.ln2, borderRadius: 8, background: "transparent", color: T.s, cursor: "pointer", fontSize: 14,
										},
									}, React.createElement(IconRefreshOutline14, { size: 14 }))
								),
								tab === "official" || tab === "community" ? React.createElement("div", { style: { flex: "none", display: "flex", gap: 6, flexWrap: "wrap", padding: "10px 0 4px" } },
								chips(),
								React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: T.t, alignSelf: "center" } },
									shown.length + " / " + (tab === "community" ? (base.communityItems || []).length : (base.officialItems || []).length))
							) : null,
							tab === "community" ? React.createElement("div", { style: { flex: "none", display: "flex", gap: 6, alignItems: "center", padding: "2px 0 0" } },
								React.createElement("span", { style: { fontSize: 11, color: T.t, flex: "none" } }, t("qualityHint") + ":"),
								[["all", t("qualityAll")], ["starred", t("qualityStarred")], ["curated", t("qualityCurated")]].map(function (opt) {
									return React.createElement(Chip, {
										key: opt[0], on: qualityFilter === opt[0],
										onClick: function () { setQualityFilter(opt[0]); setVisibleCount(50); },
										size: "sm",
									}, opt[1]);
								})
							) : null,
								data.phase === "loading" ? React.createElement("div", { style: { paddingTop: 12 } }, React.createElement(SkeletonCards, null)) : null,
							data.phase === "error" ? React.createElement("div", { style: { padding: "20px 16px", textAlign: "center", color: T.t, fontSize: 13, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" } },
								React.createElement("div", null, t("catalogErr")),
								React.createElement(Button, { variant: "primary", size: "sm", onClick: function () { safeSet(setData, { phase: "loading" }); loadCatalog(); } }, t("retry"))
							) : null,
							// 详情视图与列表互斥：打开详情时只渲染详情，不再渲染列表（避免并列挤压/空白塌陷）
							detailItem && tab !== "themes" && tab !== "sources" ? React.createElement(DetailView, {
								t: t,
								item: detailItem,
								onBack: function () { setDetailItem(null); },
							}) :
							data.phase === "ready" && shown.length === 0 ? React.createElement("div", { style: { padding: "24px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 6, alignItems: "center", color: T.t, fontSize: 13 } },
								React.createElement("div", null, tab === "community" ? t("emptyCommunity") : (tab === "installed" ? t("emptyInstalled") : t("noMatch"))),
								React.createElement("div", { style: { fontSize: 12, color: T.t } },
									tab === "community" ? t("emptyCommunitySub") : (tab === "installed" ? t("emptyInstalledSub") : t("emptyFilter"))),
								tab === "community" ? React.createElement(Button, { size: "sm", onClick: refreshCommunity, style: { marginTop: 8 } }, t("refreshCommunity")) : null
							) : null,
							// 仅在无详情视图时渲染列表，避免二者并列造成空白塌陷
							!(detailItem && tab !== "themes" && tab !== "sources") && data.phase === "ready" && shown.length > 0 ? React.createElement("div", {
								style: {
									flex: "1 1 0", minHeight: 0, overflowY: "auto", paddingTop: 12,
									display: "flex", flexDirection: "column", gap: 6, alignContent: "start", alignItems: "stretch",
								},
							}, renderList(shown)) : null
							)
						)
					)
				),
				confirm ? React.createElement(ConfirmDialog, {
					t: t,
					kind: confirm.kind,
					item: confirm.item,
					onCancel: function () { setConfirm(null); },
					onConfirm: function (skip) {
						var c = confirm;
						setConfirm(null);
						submitOp(c.kind, c.item, skip);
						safeSet(setErr, "");
					},
				})
					: null
			);
		}

		function MarketRoot(props) {
			var t = props.t;
			var _useState = useState(false);
			var open = _useState[0];
			var setOpen = _useState[1];
			return React.createElement(React.Fragment, null,
				React.createElement(FabButton, { t: t, onOpen: function () { setOpen(true); } }),
				React.createElement(MarketPanel, { t: t, open: open, onClose: function () { setOpen(false); } })
			);
		}

		var inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(function () {
				return ctx.locale.register(NS, { zh: zh, en: en });
			}, "plugin-market: dictionaries");
			ctx.slots.inject("sidebar.footer.action", function () {
				return ctx.slots.register({
					name: "sidebar.footer.action",
					id: "plugin-market",
					locale: NS,
				}, MarketRoot);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});