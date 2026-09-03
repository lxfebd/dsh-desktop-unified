// dsh-terminal · client.js（纯 JS，无 JSX/TSX）
// 官方 banner/footer 包装：window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
// 工厂里 require('react') / require('@deepseek-ai/dsh-client-ui-primitives') 从 shell 的 static module table 拿
// UI 组合走官方 ctx.slots.inject('settings.section', () => ctx.slots.register(...)) 注入 React 组件
// CSS 只用 --dsw-alias-* token，i18n 走 ctx.locale.register + props.t
window.__ModuleLoader__.load({
	id: "dsh-terminal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var { useState, useEffect, useRef, useCallback } = React;
		var { Button, Modal } = require("@deepseek-ai/dsh-client-ui-primitives");

		var NS = "terminal";
		var zh = {
			fabLabel: "终端",
			title: "会话终端",
			subtitle: "持久 shell：在项目目录执行命令，输出实时流式",
			placeholder: "输入命令，Enter 执行（可在终端内 cd 切目录）",
			running: "运行中",
			exited: "已退出",
			kill: "结束",
			idle: "未启动（输入命令即启动）",
			close: "关闭",
		};
		var en = Object.assign({}, zh, {
			fabLabel: "Terminal",
			title: "Session Terminal",
			subtitle: "Persistent shell: run commands in the project directory, streamed live",
			placeholder: "Type a command, Enter to run (cd works in-terminal)",
			running: "running",
			exited: "exited",
			kill: "Kill",
			idle: "not started (type a command to boot)",
			close: "Close",
		});

		var MAX_LINES = 1500;

		// ---- host API ----
		function postJson(path, obj) {
			return fetch("/api/terminal/" + path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(obj),
			}).then(function (r) { return r.json(); });
		}

		// ---- 样式（全部 --dsw-alias-* token，自动跟随明暗）----
		var CSS = [
			".dterm-dialog { width: min(640px, 100%) !important; max-height: 88vh; }",
			".dterm-fab { width: 100%; display: flex; align-items: center; gap: 8px; height: 36px;",
			"  padding: 0 12px; box-sizing: border-box; border: none; border-radius: 12px;",
			"  background: transparent; color: var(--dsw-alias-label-secondary);",
			"  font: 500 14px/22px var(--dsw-font-family, inherit); cursor: pointer; }",
			".dterm-fab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06)); }",
			".dterm-out { height: 320px; overflow-y: auto; padding: 10px 12px; box-sizing: border-box;",
			"  background: var(--dsw-alias-bg-layer-2, #111); border-radius: 10px;",
			"  color: var(--dsw-alias-label-primary, #eee);",
			"  font: 12px/1.55 var(--dsw-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace);",
			"  white-space: pre-wrap; word-break: break-all; }",
			".dterm-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }",
			".dterm-input { flex: 1; height: 32px; padding: 0 10px; box-sizing: border-box;",
			"  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;",
			"  background: transparent; color: var(--dsw-alias-label-primary);",
			"  font: 12px/1 var(--dsw-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace); }",
			".dterm-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }",
			".dterm-status { display: flex; align-items: center; gap: 6px; margin-top: 8px;",
			"  font-size: 12px; color: var(--dsw-alias-label-tertiary); }",
			".dterm-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }",
			".dterm-dot.running { background: var(--dsw-alias-state-success-primary, #30a14e); }",
			".dterm-dot.exited { background: var(--dsw-alias-state-error-primary, #d03238); }",
			".dterm-dot.idle { background: var(--dsw-alias-label-tertiary, #999); }",
		].join("\n");

		function insertCss() {
			if (document.getElementById("dterm-style")) return;
			var el = document.createElement("style");
			el.id = "dterm-style";
			el.textContent = CSS;
			document.head.appendChild(el);
		}

		function FabButton(props) {
			var t = props.t;
			return React.createElement("button", {
				type: "button",
				className: "dterm-fab",
				title: t("fabLabel"),
				onClick: props.onOpen,
			},
				React.createElement("span", null, "❯_"),
				React.createElement("span", null, t("fabLabel"))
			);
		}

		function TerminalPanel(props) {
			var t = props.t;
			var linesRef = useRef([]);
			var outRef = useRef(null);
			var esRef = useRef(null);
			var [lines, setLines] = useState([]);
			var [input, setInput] = useState("");
			var [state, setState] = useState("idle");

			function append(text) {
				linesRef.current.push(text);
				if (linesRef.current.length > MAX_LINES) linesRef.current.splice(0, linesRef.current.length - MAX_LINES);
				setLines(linesRef.current.slice());
			}

			function openStream() {
				var es = new EventSource("/api/terminal/stream");
				es.addEventListener("state", function (e) { setState(e.data === "true" ? "running" : "idle") });
				es.addEventListener("out", function (e) {
					try { append(JSON.parse(e.data)) } catch { append(e.data) }
					setState("running");
				});
				es.addEventListener("err", function (e) {
					try { append(JSON.parse(e.data)) } catch { append(e.data) }
				});
				es.addEventListener("exit", function (e) { setState("exited"); });
				esRef.current = es;
				return function () { es.close(); esRef.current = null; };
			}

			useEffect(function () {
				return openStream();
			}, []);

			useEffect(function () {
				var el = outRef.current;
				if (el) el.scrollTop = el.scrollHeight;
			}, [lines]);

			var send = useCallback(function () {
				var text = input;
				if (!text.trim()) return;
				setInput("");
				setState("running");
				postJson("input", { text: text + "\n" });
			}, [input]);

			return React.createElement("div", { style: { padding: "0 0 8px" } },
				React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: "var(--dsw-alias-label-primary)", margin: "4px 0 2px" } }, t("title")),
				React.createElement("p", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", margin: "0 0 10px" } }, t("subtitle")),
				React.createElement("div", { ref: outRef, className: "dterm-out" }, lines.length ? lines.join("") : " "),
				React.createElement("div", { className: "dterm-row" },
					React.createElement("input", {
						ref: null,
						className: "dterm-input",
						value: input,
						placeholder: t("placeholder"),
						onChange: function (e) { setInput(e.target.value); },
						onKeyDown: function (e) { if (e.key === "Enter") send(); },
					}),
					React.createElement(Button, { variant: "primary", size: "sm", onClick: send }, "Run"),
					React.createElement(Button, { variant: "ghost", size: "sm", onClick: function () { postJson("kill", {}); } }, t("kill"))
				),
				React.createElement("div", { className: "dterm-status" },
					React.createElement("span", { className: "dterm-dot " + state }),
					t(state === "running" ? "running" : (state === "exited" ? "exited" : "idle"))
				)
			);
		}

		function TerminalRoot(props) {
			var t = props.t;
			insertCss();
			return React.createElement(TerminalPanel, { t: t });
		}

		// ---- apply：注册 i18n 字典 + 通过 ctx.slots.inject 注入 settings.section ----
		var inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(function () {
				return ctx.locale.register(NS, { zh: zh, en: en });
			}, "dsh-terminal: dictionaries");
			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register({
					name: "settings.section",
					id: "dsh-terminal",
					order: 43,
					label: function () { return ctx.locale.bind(NS)("fabLabel"); },
					locale: NS,
				}, TerminalRoot);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
