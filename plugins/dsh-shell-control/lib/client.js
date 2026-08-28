// dsh-shell-control · 插件入口（client 面）
// 侧边栏 footer 注入「外壳控制」按钮，弹出 Modal 面板，提供边框/透明度/置顶/
// 尺寸/图标等控件，点击调用 /api/shell/*（同源代理，转发到 Electron 壳）。
// 范式镜像 dsh-plugin-market/lib/client.js 的 __ModuleLoader__.load + React +
// ui-primitives + ctx.slots.register。
window.__ModuleLoader__.load({
  id: "dsh-shell-control",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var { useState, useEffect } = React;
    var __ui = require("@deepseek-ai/dsh-client-ui-primitives");
    var Modal = __ui.Modal, Button = __ui.Button, Input = __ui.Input;

    var NS = "shell-control";
    var zh = {
      fabLabel: "外壳控制", title: "外壳控制", subtitle: "AI 能改的外壳：边框 · 透明度 · 置顶 · 尺寸 · 图标",
      close: "关闭", loading: "加载中…", refresh: "刷新状态",
      frameless: "无边框模式", framelessHint: "切换会重建窗口（保留位置/大小/图标）",
      opacity: "透明度", alwaysOnTop: "窗口置顶", apply: "应用", minimize: "最小化", maximize: "最大化/还原",
      sizeW: "宽", sizeH: "高", setSize: "设置尺寸",
      iconPath: "图标路径（build/ 内）", applyIcon: "应用图标", resetIcon: "恢复默认图标",
      state: "当前状态", bounds: "位置/大小", maximized: "已最大化", minimized: "已最小化",
      fullscreen: "全屏", onTop: "置顶", framelessState: "无边框", opacityLabel: "透明度",
      errReach: "外壳控制服务未启动，请确认桌面应用已运行", applied: "已应用", iconWarn: "图标路径必须在 build/ 目录内",
    };
    var en = Object.assign({}, zh, {
      fabLabel: "Shell Control", title: "Shell Control", subtitle: "The shell AI can change: frame · opacity · on-top · size · icon",
      close: "Close", loading: "Loading…", refresh: "Refresh",
      frameless: "Frameless", framelessHint: "Rebuilds the window (keeps position/size/icon)",
      opacity: "Opacity", alwaysOnTop: "Always on top", apply: "Apply", minimize: "Minimize", maximize: "Maximize/Restore",
      sizeW: "W", sizeH: "H", setSize: "Set size",
      iconPath: "Icon path (inside build/)", applyIcon: "Apply icon", resetIcon: "Reset to default",
      state: "Current state", bounds: "Bounds", maximized: "Maximized", minimized: "Minimized",
      fullscreen: "Fullscreen", onTop: "On top", framelessState: "Frameless", opacityLabel: "Opacity",
      errReach: "Shell control service is not running. Make sure the desktop app is open.", applied: "Applied", iconWarn: "Icon path must be inside build/",
    });

    var T = {
      p: "var(--dsw-alias-label-primary)", s: "var(--dsw-alias-label-secondary)", t: "var(--dsw-alias-label-tertiary)",
      b2: "var(--dsw-alias-bg-layer-2)", b3: "var(--dsw-alias-bg-layer-3)",
      ln2: "var(--dsw-alias-border-l2)", brand: "var(--dsw-alias-brand-primary)",
      ok: "var(--dsw-alias-state-success-primary)", err: "var(--dsw-alias-state-error-primary)",
      font: "var(--dsw-font-family, inherit)", mono: "ui-monospace, SF Mono, Menlo, monospace",
    };

    function api(path, opts) {
      opts = opts || {};
      var ctrl = new AbortController();
      var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 10000);
      var o = Object.assign({}, opts, { signal: ctrl.signal });
      return fetch("/api/shell/" + path, o).then(function (r) {
        clearTimeout(timer);
        return r.json().then(function (d) { return r.ok ? d : Object.assign({ ok: false }, d); });
      }).catch(function (e) {
        clearTimeout(timer);
        return { ok: false, error: e && e.name === "AbortError" ? "请求超时" : String((e && e.message) || e) };
      });
    }
    function post(path, body) {
      return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }

    function Row(props) {
      return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid " + T.ln2 } }, props.children);
    }
    function Label(props) {
      return React.createElement("span", { style: { flex: "none", width: 96, fontSize: 12, color: T.s } }, props.children);
    }

    function ShellPanel(props) {
      var t = props.t;
      var open = props.open;
      var [state, setState] = useState(null);
      var [err, setErr] = useState("");
      var [okMsg, setOkMsg] = useState("");
      var [opacity, setOpacity] = useState(1);
      var [w, setW] = useState("");
      var [h, setH] = useState("");
      var [iconPath, setIconPath] = useState("build/icon.png");

      function refresh() {
        api("state").then(function (d) {
          if (d && d.error && !d.bounds) { setErr(t("errReach")); setState(null); return; }
          setState(d); setErr(""); if (typeof d.opacity === "number") setOpacity(d.opacity);
          if (d.bounds) { setW(String(d.bounds.width)); setH(String(d.bounds.height)); }
        });
      }
      useEffect(function () { if (open) refresh(); }, [open]);

      function flash(msg) { setOkMsg(msg); setErr(""); setTimeout(function () { setOkMsg(""); }, 2000); }
      function fail(msg) { setErr(msg); setOkMsg(""); }

      function toggleFrameless() {
        var next = !(state && state.frameless);
        post("frameless", { frame: !next }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); setTimeout(refresh, 500); });
      }
      function applyOpacity() { post("opacity", { opacity: opacity }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); refresh(); }); }
      function toggleOnTop() { var next = !(state && state.alwaysOnTop); post("always-on-top", { on: next }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); refresh(); }); }
      function doMinimize() { post("window", { action: "minimize" }).then(refresh); }
      function doMaximize() { post("window", { action: "maximize" }).then(refresh); }
      function applySize() { post("window", { action: "set_size", w: Number(w), h: Number(h) }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); refresh(); }); }
      function applyIcon() { post("icon", { path: iconPath }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || t("iconWarn")); refresh(); }); }
      function resetIcon() { post("icon/reset", {}).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); refresh(); }); }

      var inputStyle = { flex: "1 1 80px", minWidth: 60, height: 30, padding: "0 8px", boxSizing: "border-box", border: "1px solid " + T.ln2, borderRadius: 6, outline: "none", background: T.b3, color: T.p, fontSize: 13, fontFamily: T.font };

      return React.createElement(Modal, { open: open, onClose: props.onClose, title: t("title"), description: t("subtitle"), closeLabel: t("close") },
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4, minWidth: 360, fontFamily: T.font } },
          okMsg ? React.createElement("div", { style: { color: T.ok, fontSize: 12, marginBottom: 4 } }, "✓ " + okMsg) : null,
          err ? React.createElement("div", { style: { color: T.err, fontSize: 12, marginBottom: 4 } }, "✕ " + err) : null,
          React.createElement(Row, null, React.createElement(Label, null, t("frameless")),
            React.createElement(Button, { size: "sm", variant: state && state.frameless ? "primary" : "ghost", onClick: toggleFrameless }, state && state.frameless ? "✓ " + t("frameless") : t("frameless")),
            React.createElement("span", { style: { fontSize: 11, color: T.t, flex: 1 } }, t("framelessHint"))
          ),
          React.createElement(Row, null, React.createElement(Label, null, t("opacity")),
            React.createElement("input", { type: "range", min: 0.2, max: 1, step: 0.05, value: opacity, onChange: function (e) { setOpacity(Number(e.target.value)); }, style: { flex: 1 } }),
            React.createElement("span", { style: { width: 36, textAlign: "right", fontSize: 12, color: T.p, fontFamily: T.mono } }, opacity.toFixed(2)),
            React.createElement(Button, { size: "sm", onClick: applyOpacity }, t("apply"))
          ),
          React.createElement(Row, null, React.createElement(Label, null, t("alwaysOnTop")),
            React.createElement(Button, { size: "sm", variant: state && state.alwaysOnTop ? "primary" : "ghost", onClick: toggleOnTop }, state && state.alwaysOnTop ? "✓ " + t("alwaysOnTop") : t("alwaysOnTop"))
          ),
          React.createElement(Row, null, React.createElement(Label, null, t("setSize")),
            React.createElement(Input, { style: inputStyle, type: "number", placeholder: t("sizeW"), value: w, onChange: function (e) { setW(e.target.value); } }),
            React.createElement(Input, { style: inputStyle, type: "number", placeholder: t("sizeH"), value: h, onChange: function (e) { setH(e.target.value); } }),
            React.createElement(Button, { size: "sm", onClick: applySize }, t("apply"))
          ),
          React.createElement(Row, null, React.createElement(Label, null, t("minimize") + "/" + t("maximize")),
            React.createElement(Button, { size: "sm", onClick: doMinimize }, t("minimize")),
            React.createElement(Button, { size: "sm", onClick: doMaximize }, t("maximize"))
          ),
          React.createElement(Row, null, React.createElement(Label, null, t("iconPath")),
            React.createElement(Input, { style: inputStyle, value: iconPath, onChange: function (e) { setIconPath(e.target.value); } }),
            React.createElement(Button, { size: "sm", onClick: applyIcon }, t("applyIcon")),
            React.createElement(Button, { size: "sm", variant: "ghost", onClick: resetIcon }, t("resetIcon"))
          ),
          React.createElement(Row, null, React.createElement(Label, null, t("state")),
            React.createElement("span", { style: { fontSize: 11, color: T.t, fontFamily: T.mono, flex: 1, wordBreak: "break-all" } },
              state && state.bounds ? (t("bounds") + ": " + state.bounds.x + "," + state.bounds.y + " " + state.bounds.width + "x" + state.bounds.height) : t("loading"),
              state ? (" | " + (state.maximized ? t("maximized") : "") + " " + (state.minimized ? t("minimized") : "") + " " + (state.fullscreen ? t("fullscreen") : "") + " " + (state.alwaysOnTop ? t("onTop") : "") + " " + (state.frameless ? t("framelessState") : "") + " " + t("opacityLabel") + "=" + (state.opacity != null ? state.opacity.toFixed(2) : "?")) : ""
            ),
            React.createElement(Button, { size: "sm", variant: "ghost", onClick: refresh }, t("refresh"))
          )
        )
      );
    }

    function ShellRoot(props) {
      var t = props.t;
      var _s = useState(false);
      var open = _s[0], setOpen = _s[1];
      return React.createElement(React.Fragment, null,
        React.createElement("button", {
          type: "button", title: t("fabLabel"), onClick: function () { setOpen(true); },
          style: { width: "100%", display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 12px", boxSizing: "border-box", border: "none", borderRadius: 12, background: "transparent", color: T.s, font: "500 14px/22px " + T.font, cursor: "pointer" }
        },
          React.createElement("span", { style: { flex: "none", color: T.s } },
            React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" },
              React.createElement("rect", { x: "2", y: "2.5", width: "12", height: "11", rx: "1.5", stroke: "currentColor", strokeWidth: 1.4 }),
              React.createElement("rect", { x: "2", y: "2.5", width: "12", height: "3", fill: "currentColor" })
            )
          ),
          React.createElement("span", null, t("fabLabel"))
        ),
        React.createElement(ShellPanel, { t: t, open: open, onClose: function () { setOpen(false); } })
      );
    }

    var inject = ["slots", "locale"];
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "shell-control: dictionaries");
      ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register({ name: "sidebar.footer.action", id: "shell-control", locale: NS }, ShellRoot);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
