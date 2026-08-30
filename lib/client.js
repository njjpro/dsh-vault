// dsh-vault browser half: 设置 -> 凭据 板块。
// 一个列表，每条是一个凭据条目（Token / 服务器 / 网站 / GitHub …）。
// 非机密字段（如服务器 IP）写 settings 命名空间 dsh-vault；
// 机密字段（API token、密码）写 DSH 凭据库（ref 如 VAULT_GITHUB_TOKEN）。
//
// Self-contained by hand (no bundler): the client module system wraps it in a
// CJS factory and the kernel adopts { apply, inject } as a client plugin.
window.__ModuleLoader__.load({
  id: "dsh-vault",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { useState, useEffect, useMemo, useRef } = React;

    const NS = "dsh-vault";

    // 每种 kind 展示哪些字段。token: 一个 secret 字段 token；
    // server: 非 secret 的 ip / user / port / publicHost / sshAlias / note + secret 的 password。
    // web: 网站类凭据（网址 + 账号 + 密码）。后续加 kind 就在这里扩展。
    const KINDS = {
      token: { label: "Token", fields: [{ key: "token", label: "API Token", secret: true }] },
      server: {
        label: "服务器",
        fields: [
          { key: "ip", label: "IP / 主机", secret: false },
          { key: "user", label: "用户", secret: false },
          { key: "port", label: "端口", secret: false },
          { key: "publicHost", label: "公网主机", secret: false },
          { key: "sshAlias", label: "SSH 别名", secret: false },
          { key: "note", label: "连接说明", secret: false },
          { key: "password", label: "密码", secret: true },
        ],
      },
      web: {
        label: "网站",
        fields: [
          { key: "url", label: "网址", secret: false },
          { key: "user", label: "账号 / 邮箱", secret: false },
          { key: "password", label: "密码", secret: true },
        ],
      },
      github: {
        label: "GitHub",
        fields: [
          { key: "user", label: "用户名", secret: false },
          { key: "token", label: "Personal Access Token", secret: true },
        ],
      },
    };

    function secretRef(entryId, fieldKey) {
      const id = String(entryId).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      const fk = String(fieldKey).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      return `VAULT_${id}_${fk}`;
    }

    const CSS = [
      ".dv-root{display:flex;flex-direction:column;gap:14px;padding:2px 2px 12px;max-width:640px;color:#1a1a1a}",
      ".dv-desc{font-size:13px;color:#555;line-height:1.5;margin:0}",
      ".dv-entry{border:1px solid #e2e2e2;border-radius:8px;padding:14px 16px;background:#ffffff;display:flex;flex-direction:column;gap:12px;box-shadow:0 1px 2px rgba(0,0,0,.04)}",
      ".dv-entry-closed{padding:10px 16px;gap:0}",
      ".dv-entry-head{display:flex;align-items:center;gap:10px}",
      ".dv-toggle{width:24px;height:24px;padding:0;border:1px solid #d8d8d8;border-radius:6px;background:#fff;color:#555;cursor:pointer;font-size:12px;line-height:1;flex:none}",
      ".dv-toggle:hover{border-color:#3b82f6;color:#3b82f6}",
      ".dv-summary{font-size:11px;color:#888;margin-left:auto;white-space:nowrap}",
      ".dv-badge{font-size:11px;padding:2px 8px;border-radius:999px;margin-left:6px}",
      ".dv-badge.on{background:#e8f7ec;color:#1b7f32}",
      ".dv-badge.off{background:#fdecec;color:#c0353a}",
      ".dv-remove{font-size:12px;padding:4px 10px;border:1px solid #d8d8d8;border-radius:6px;background:#fff;color:#555;cursor:pointer}",
      ".dv-remove:hover{border-color:#c0353a;color:#c0353a}",
      ".dv-field{display:flex;flex-direction:column;gap:5px}",
      ".dv-field label{font-size:12px;color:#555}",
      ".dv-input,.dv-sel{width:100%;box-sizing:border-box;padding:7px 10px;font-size:13px;border:1px solid #d0d0d0;border-radius:6px;background:#ffffff;color:#1a1a1a}",
      ".dv-input:focus,.dv-sel:focus{outline:none;border-color:#3b82f6}",
      ".dv-head-input{width:200px;font-weight:600}",
      ".dv-sel{width:auto}",
      ".dv-add{font-size:13px;padding:8px 14px;border:1px dashed #c8c8c8;border-radius:8px;background:#fff;color:#555;cursor:pointer;align-self:flex-start}",
      ".dv-add:hover{border-color:#3b82f6;color:#3b82f6}",
      ".dv-empty{font-size:13px;color:#777;padding:8px 0}",
      ".dv-hint{font-size:11px;color:#777;margin:0}",
    ].join("\n");

    function insertCss() {
      if (typeof document === "undefined") return;
      if (document.querySelector("style[data-dv-css]")) return;
      const style = document.createElement("style");
      style.dataset.dvCss = "1";
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    // ── 单条凭据条目 ────────────────────────────────────────────────────────
    function EntryCard(props) {
      const { entry, scope, getApi, allEntries, onRemove } = props;
      const [configured, setConfigured] = useState(undefined);
      const [open, setOpen] = useState(Boolean(props.defaultOpen));
      const secretDraftRef = useRef({});
      const secretFieldKeysStr = props.secretFieldKeys;
      const fieldKeys = useMemo(
        () => (secretFieldKeysStr ? secretFieldKeysStr.split(",").filter(Boolean) : []),
        [secretFieldKeysStr]
      );

      // 查询本条目各机密字段是否已配置（describe 不回显值）
      useEffect(() => {
        let cancelled = false;
        const api = getApi();
        if (!api || fieldKeys.length === 0) {
          setConfigured(undefined);
          return;
        }
        const refs = fieldKeys.map((key) => secretRef(entry.id, key));
        api.credentials
          .describe({ refs })
          .then((resp) => {
            if (cancelled) return;
            const view = resp?.result?.ok ? resp.result.value?.credentials ?? {} : {};
            const next = {};
            for (const key of fieldKeys) {
              next[key] = Boolean(view[secretRef(entry.id, key)]?.configured);
            }
            setConfigured(next);
          })
          .catch(() => {
            if (!cancelled) setConfigured(undefined);
          });
        return () => {
          cancelled = true;
        };
      }, [entry.id, secretFieldKeysStr, getApi]);

      // 提交一条机密字段（失焦触发；空值不动已存密钥）
      const commitSecret = async (fieldKey) => {
        const value = String(secretDraftRef.current[fieldKey] ?? "").trim();
        if (!value) return;
        const api = getApi();
        if (!api) return;
        try {
          await api.credentials.set({ ref: secretRef(entry.id, fieldKey), value });
          secretDraftRef.current[fieldKey] = "";
          setConfigured((prev) => ({ ...(prev ?? {}), [fieldKey]: true }));
        } catch {
          /* 写入失败维持现状 */
        }
      };

      // 替换本条目（label / kind / 非机密 values）
      const replaceEntry = (next) => {
        scope.set("entries", [next].concat(allEntries.filter((e) => e.id !== entry.id)));
      };

      const kindDef = KINDS[entry.kind] ?? KINDS.token;
      const secretDefs = kindDef.fields.filter((f) => f.secret);
      const configuredCount = configured
        ? secretDefs.filter((f) => configured[f.key]).length
        : null;

      return React.createElement(
        "div",
        { className: open ? "dv-entry" : "dv-entry dv-entry-closed" },
        React.createElement(
          "div",
          { className: "dv-entry-head" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "dv-toggle",
              title: open ? "收起" : "展开",
              onClick: () => setOpen((o) => !o),
            },
            open ? "▾" : "▸"
          ),
          React.createElement("input", {
            className: "dv-input dv-head-input",
            defaultValue: entry.label,
            onBlur: (ev) => {
              const label = ev.target.value.trim();
              if (label && label !== entry.label) {
                replaceEntry({ ...entry, label });
              }
            },
          }),
          React.createElement(
            "select",
            {
              className: "dv-sel",
              value: entry.kind,
              onChange: (ev) => {
                replaceEntry({ id: entry.id, label: entry.label, kind: ev.target.value, fields: {} });
              },
            },
            Object.entries(KINDS).map(([key, def]) =>
              React.createElement("option", { key, value: key }, def.label)
            )
          ),
          !open && configuredCount !== null
            ? React.createElement(
                "span",
                { className: "dv-summary" },
                `已配置 ${configuredCount}/${secretDefs.length}`
              )
            : null,
          React.createElement(
            "button",
            {
              type: "button",
              className: "dv-remove",
              style: { marginLeft: open ? 0 : "auto" },
              onClick: onRemove,
            },
            "删除"
          )
        ),
        open
          ? kindDef.fields.map((field) => {
          const isSecret = field.secret;
          const isConfigured = configured?.[field.key];
          return React.createElement(
            "div",
            { key: field.key, className: "dv-field" },
            React.createElement(
              "label",
              null,
              field.label,
              isSecret
                ? React.createElement(
                    "span",
                    { className: `dv-badge ${isConfigured ? "on" : "off"}` },
                    isConfigured ? "已配置" : "未配置"
                  )
                : null
            ),
            React.createElement("input", {
              className: "dv-input",
              type: isSecret ? "password" : "text",
              placeholder: isSecret
                ? isConfigured
                  ? "已配置；输入新值可覆盖"
                  : "输入后点输入框外保存"
                : "输入后点输入框外保存",
              defaultValue: isSecret ? "" : entry.fields?.[field.key] ?? "",
              onChange: (ev) => {
                if (isSecret) {
                  secretDraftRef.current[field.key] = ev.target.value;
                } else {
                  ev.target.dataset.dvPending = ev.target.value;
                }
              },
              onBlur: (ev) => {
                if (isSecret) {
                  commitSecret(field.key);
                } else {
                  const value = ev.target.dataset.dvPending;
                  if (value !== undefined && value !== (entry.fields?.[field.key] ?? "")) {
                    replaceEntry({
                      ...entry,
                      fields: { ...(entry.fields || {}), [field.key]: value },
                    });
                  }
                }
              },
            }),
            isSecret && isConfigured
              ? React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dv-remove",
                    style: { alignSelf: "flex-start" },
                    onClick: async () => {
                      const api = getApi();
                      if (!api) return;
                      try {
                        await api.credentials.unset({ ref: secretRef(entry.id, field.key) });
                        setConfigured((prev) => ({ ...(prev ?? {}), [field.key]: false }));
                      } catch {}
                    },
                  },
                  "清除已存密钥"
                )
              : null
          );
        })
          : null
      );
    }

    // ── 板块主组件 ────────────────────────────────────────────────────────
    function VaultSection(props) {
      const { scope, getApi } = props;
      const subscribe = useMemo(() => scope.subscribe.bind(scope), [scope]);
      const getSnapshot = useMemo(() => scope.getSnapshot.bind(scope), [scope]);
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);
      const status = snapshot?.status;
      const entries = (snapshot?.value?.entries ?? []).map((e) => ({
        id: e.id,
        label: e.label,
        kind: e.kind,
        fields: { ...(e.fields || {}) },
      }));

      const [lastAdded, setLastAdded] = useState(null);
      const addEntry = () => {
        const base = `item${Date.now().toString(36)}`;
        setLastAdded(base);
        scope.set("entries", entries.concat([{ id: base, label: "新条目", kind: "token", fields: {} }]));
      };

      const removeEntry = (id) => {
        scope.set("entries", entries.filter((e) => e.id !== id));
      };

      return React.createElement(
        "div",
        { className: "dv-root" },
        React.createElement(
          "p",
          { className: "dv-desc" },
          "集中管理常用凭据，输入一次即可长期使用。机密（API Token、密码）存入 DSH 凭据库，界面不回显；模型通过 vault_status / vault_get 工具查看与取用。"
        ),
        status === "loading"
          ? React.createElement("div", { className: "dv-empty" }, "正在读取…")
          : null,
        status !== "ready" && status !== "loading"
          ? React.createElement(
              "div",
              { className: "dv-empty" },
              "设置暂不可用（", String(status ?? "unknown"), "）。"
            )
          : null,
        entries.length === 0 && status === "ready"
          ? React.createElement("div", { className: "dv-empty" }, "还没有凭据条目，点下方按钮添加。")
          : entries.map((entry) => {
              const kindDef = KINDS[entry.kind] ?? KINDS.token;
              const secretFieldKeys = kindDef.fields
                .filter((f) => f.secret)
                .map((f) => f.key)
                .join(",");
              return React.createElement(EntryCard, {
                key: entry.id,
                entry,
                scope,
                getApi,
                allEntries: entries,
                secretFieldKeys,
                defaultOpen: entry.id === lastAdded,
                onRemove: () => removeEntry(entry.id),
              });
            }),
        React.createElement(
          "button",
          { type: "button", className: "dv-add", onClick: addEntry },
          "+ 添加凭据"
        ),
        React.createElement(
          "p",
          { className: "dv-hint" },
          "说明：改动在失焦（点输入框外）后保存。Token 类填 API Token；服务器填 IP、用户、端口和密码；网站填网址、账号和密码；GitHub 填用户名和 Personal Access Token。"
        )
      );
    }

    function apply(ctx) {
      insertCss();
      const localScope = ctx.settingsScope.bind({ namespace: NS });
      const getApi = () => {
        try {
          const conn = ctx.get("connection");
          return conn && conn.api ? conn.api : undefined;
        } catch {
          return undefined;
        }
      };
      const sectionInject = Object.freeze({ scope: localScope, getApi });

      ctx.effect(
        () =>
          ctx.slots.inject("settings.section", function* () {
            yield ctx.slots.register(
              {
                name: "settings.section",
                id: "vault",
                order: 14,
                label: () => "凭据",
                inject: () => sectionInject,
              },
              VaultSection
            );
          }),
        "dsh-vault: settings section"
      );
    }

    exports.apply = apply;
    exports.inject = ["settingsScope", "slots"];
    return module.exports;
  },
});
