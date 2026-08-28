// dsh-plugin-version-manager · client.js（纯 JS，无 JSX/TSX）
// 官方 banner/footer 包装：window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
// 工厂里 require('react') / require('@deepseek-ai/dsh-client-ui-primitives') 从 shell 的 static module table 拿
// UI 组合走官方 ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(...)) 注入 React 组件
// CSS 只用 --dsw-alias-* token，i18n 走 ctx.locale.register + props.t
window.__ModuleLoader__.load({
	id: "dsh-plugin-version-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var { useState, useEffect, useCallback } = React;
		var { Button, Pill, Modal, StateDot } = require("@deepseek-ai/dsh-client-ui-primitives");

		// ---- i18n 字典（zh/en 双语，对齐官方范式）----
		var NS = "version-manager";
		var zh = {
			title: "版本管理",
			subtitle: "跟随官方稳定版 / 探索版双通道升级 dsh 内核",
			installed: "已装版本",
			installRoot: "安装位置",
			stable: "稳定版",
			explorer: "探索版",
			latest: "经测试",
			next: "最新功能",
			remote: "远程最新",
			current: "当前使用",
			upgrade: "升级到该版本",
			upgrading: "升级中",
			already: "已是该版本",
			patches: "补丁状态",
			patchesHint: "升级后自动重打；也可手动重打",
			repatch: "重打补丁",
			patchOk: "已生效",
			patchNeed: "需要重打",
			upgradeOk: "升级完成，需要重启 dsh 生效",
			upgradeFail: "升级失败",
			refresh: "刷新",
			fabLabel: "版本管理",
			open: "打开面板",
			close: "关闭",
			version: "版本",
			note: "提示：升级会调用 npm install -g 替换系统 dsh，需重启 dsh 进程生效",
		};
		var en = Object.assign({}, zh, {
			title: "Version Manager",
			subtitle: "Follow official stable / explorer channels to upgrade the dsh core",
			installed: "Installed",
			installRoot: "Install root",
			stable: "Stable",
			explorer: "Explorer",
			latest: "tested",
			next: "latest features",
			remote: "Remote latest",
			current: "current",
			upgrade: "Upgrade to this",
			upgrading: "Upgrading",
			already: "Already this version",
			patches: "Patches",
			patchesHint: "Auto-reapplied after upgrade; or re-apply manually",
			repatch: "Re-apply patches",
			patchOk: "applied",
			patchNeed: "needs re-apply",
			upgradeOk: "Upgrade done, restart dsh to take effect",
			upgradeFail: "Upgrade failed",
			refresh: "Refresh",
			fabLabel: "Version",
			open: "Open panel",
			close: "Close",
			version: "version",
			note: "Note: upgrade runs npm install -g to replace the system dsh; restart dsh to take effect",
		});

		// ---- host API 客户端 ----
		function fetchJson(path, opts) {
			return fetch("/api/version/" + path, opts || {}).then(function (r) { return r.json(); });
		}

		// ---- 样式（全部 --dsw-alias-* token，自动跟随明暗）----
		var CSS = [
			".vm-dialog { width: min(520px, 100%) !important; max-height: 88vh; }",
			".vm-fab { width: 100%; display: flex; align-items: center; gap: 8px; height: 36px;",
			"  padding: 0 12px; box-sizing: border-box; border: none; border-radius: 12px;",
			"  background: transparent; color: var(--dsw-alias-label-secondary);",
			"  font: 500 14px/22px var(--dsw-font-family, inherit); cursor: pointer; }",
			".vm-fab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06)); }",
			".vm-fab .vm-fab-icon { flex: none; color: var(--dsw-alias-label-secondary); }",
			".vm-row { display: flex; align-items: center; justify-content: space-between; gap: 12px;",
			"  padding: 12px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }",
			".vm-row:last-child { border-bottom: none; }",
			".vm-label { color: var(--dsw-alias-label-secondary); font-size: 13px; }",
			".vm-value { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); word-break: break-all; }",
			".vm-badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }",
			".vm-badge.stable { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary)); }",
			".vm-badge.explorer { background: var(--dsw-alias-state-warning-primary, #d29922); color: var(--dsw-alias-bg-layer-2, #fff); }",
			".vm-meta { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-top: 2px; }",
			".vm-status { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 8px; line-height: 1.6; }",
			".vm-note { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-top: 12px; line-height: 1.6; }",
		].join("\n");

		function insertCss() {
			if (document.getElementById("vm-style")) return;
			var el = document.createElement("style");
			el.id = "vm-style";
			el.textContent = CSS;
			document.head.appendChild(el);
		}

		// ---- 入口按钮（注入到 sidebar.footer.action）----
		function FabButton(props) {
			var t = props.t;
			var icon = React.createElement("span", { className: "vm-fab-icon" },
				React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" },
					React.createElement("path", { d: "M8 1.5L1.5 5L8 8.5L14.5 5L8 1.5Z", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" }),
					React.createElement("path", { d: "M1.5 8L8 11.5L14.5 8", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" }),
					React.createElement("path", { d: "M1.5 11L8 14.5L14.5 11", stroke: "currentColor", strokeWidth: 1.3, strokeLinejoin: "round" })
				)
			);
			return React.createElement("button", {
				type: "button",
				className: "vm-fab",
				title: t("fabLabel"),
				onClick: props.onOpen,
			}, icon, React.createElement("span", null, t("fabLabel")));
		}

		// ---- 面板（官方 Modal）----
		function Panel(props) {
			var t = props.t;
			var _useState = useState(null);
			var info = _useState[0];
			var setInfo = _useState[1];
			var _useState2 = useState("");
			var status = _useState2[0];
			var setStatus = _useState2[1];
			var _useState3 = useState(false);
			var upgrading = _useState3[0];
			var setUpgrading = _useState3[1];
			var _useState4 = useState(null);
			var upgradingChannel = _useState4[0];
			var setUpgradingChannel = _useState4[1];

			var refresh = useCallback(function () {
				setStatus("");
				return fetchJson("info").then(function (d) {
					setInfo(d);
				}).catch(function (e) {
					setStatus("加载失败: " + (e.message || String(e)));
				});
			}, []);

			useEffect(function () { refresh(); }, [refresh]);

			function upgrade(channel) {
				setUpgrading(true);
				setUpgradingChannel(channel);
				setStatus((channel === "stable" ? t("stable") : t("explorer")) + ": " + t("upgrading") + "...");
				fetchJson("upgrade", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ channel: channel }),
				}).then(function (r) {
					setUpgrading(false);
					setUpgradingChannel(null);
					if (r.ok) {
						setStatus("✅ " + t("upgradeOk") + " (" + (r.version || "?") + ")");
						setTimeout(refresh, 800);
					} else {
						setStatus("❌ " + t("upgradeFail") + ": " + (r.error || ""));
					}
				}).catch(function (e) {
					setUpgrading(false);
					setUpgradingChannel(null);
					setStatus("❌ " + (e.message || String(e)));
				});
			}

			if (!info) {
				return React.createElement(Modal, { open: props.open, onClose: props.onClose, title: t("title") },
					React.createElement("div", { className: "vm-status" }, t("refresh") + "...")
				);
			}

			var stable = info.channels && info.channels.stable || {};
			var explorer = info.channels && info.channels.explorer || {};
			var patches = info.patches || [];
			var patchedCount = patches.filter(function (p) { return p.patched; }).length;
			var isStableActive = info.installed && info.installed === stable.version;
			var isExplorerActive = info.installed && info.installed === explorer.version;

			return React.createElement(Modal, {
				open: props.open,
				onClose: props.onClose,
				title: t("title"),
				closeLabel: t("close"),
				className: "vm-dialog",
			},
				React.createElement("div", { style: { padding: "0 0 8px" } },
					React.createElement("p", { className: "vm-meta" }, t("subtitle")),
					// 已装版本
					React.createElement("div", { className: "vm-row" },
						React.createElement("span", { className: "vm-label" }, t("installed")),
						React.createElement("span", { className: "vm-value" }, info.installed || "—")
					),
					// 安装位置
					React.createElement("div", { className: "vm-row" },
						React.createElement("span", { className: "vm-label" }, t("installRoot")),
						React.createElement("span", { className: "vm-value", style: { fontSize: "11px" } }, info.installRoot || "—")
					),
					// 稳定版
					React.createElement("div", { className: "vm-row" },
						React.createElement("div", null,
							React.createElement("span", { className: "vm-badge stable" }, t("stable") + " (latest)"),
							React.createElement("div", { className: "vm-meta" }, t("remote") + ": " + (stable.version || "—")),
							isStableActive ? React.createElement("div", { className: "vm-meta", style: { color: "var(--dsw-alias-state-success-primary)" } }, "✓ " + t("current")) : null
						),
						React.createElement(Button, {
							variant: "primary",
							size: "sm",
							disabled: upgrading,
							onClick: function () { upgrade("stable"); },
						}, (upgrading && upgradingChannel === "stable") ? t("upgrading") : (isStableActive ? t("already") : t("upgrade")))
					),
					// 探索版
					React.createElement("div", { className: "vm-row" },
						React.createElement("div", null,
							React.createElement("span", { className: "vm-badge explorer" }, t("explorer") + " (next)"),
							React.createElement("div", { className: "vm-meta" }, t("remote") + ": " + (explorer.version || "—")),
							isExplorerActive ? React.createElement("div", { className: "vm-meta", style: { color: "var(--dsw-alias-state-success-primary)" } }, "✓ " + t("current")) : null
						),
						React.createElement(Button, {
							variant: "primary",
							size: "sm",
							disabled: upgrading,
							onClick: function () { upgrade("explorer"); },
						}, (upgrading && upgradingChannel === "explorer") ? t("upgrading") : (isExplorerActive ? t("already") : t("upgrade")))
					),
					// 补丁
					React.createElement("div", { className: "vm-row" },
						React.createElement("div", null,
							React.createElement("span", { className: "vm-label" }, t("patches")),
							React.createElement("div", { className: "vm-meta" }, patchedCount + "/" + patches.length + " " + t("patchOk")),
							patches.map(function (p) {
								return React.createElement("div", { key: p.id, className: "vm-meta" },
									(p.patched ? "✅ " : "❌ ") + p.label
								);
							})
						),
						React.createElement(Button, {
							variant: "ghost",
							size: "sm",
							disabled: upgrading,
							onClick: function () {
								setStatus(t("repatch") + "...");
								fetchJson("patches/apply", { method: "POST" }).then(function (r) {
									setStatus((r.applied || []).map(function (a) {
										return (a.ok ? "✅ " : "❌ ") + a.label;
									}).join(" | "));
									setTimeout(refresh, 800);
								});
							},
						}, t("repatch"))
					),
					status ? React.createElement("div", { className: "vm-status" }, status) : null,
					React.createElement("div", { className: "vm-note" }, t("note"))
				)
			);
		}

		// ---- 组合容器（state 持有 modal open）----
		function VersionManagerRoot(props) {
			var t = props.t;
			var _useState5 = useState(false);
			var open = _useState5[0];
			var setOpen = _useState5[1];
			insertCss();
			return React.createElement(React.Fragment, null,
				React.createElement(FabButton, { t: t, onOpen: function () { setOpen(true); } }),
				React.createElement(Panel, { t: t, open: open, onClose: function () { setOpen(false); } })
			);
		}

		// ---- apply：注册 i18n 字典 + 通过 ctx.slots.inject 注入 sidebar.footer.action ----
		var inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(function () {
				return ctx.locale.register(NS, { zh: zh, en: en });
			}, "version-manager: dictionaries");
			ctx.slots.inject("sidebar.footer.action", function () {
				return ctx.slots.register({
					name: "sidebar.footer.action",
					id: "version-manager",
					locale: NS,
				}, VersionManagerRoot);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});