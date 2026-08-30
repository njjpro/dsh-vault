/**
 * dsh-vault — persistent credential vault plugin (host half).
 *
 * One settings panel (设置 → 凭据) holds a list of entries, each with a kind
 * and a set of fields. Non-secret fields (e.g. a server IP) live in the
 * `dsh-vault` settings namespace; secret fields (Cloudflare API token, server
 * password) live in the DSH credentials store keyed by a derived reference
 * such as `VAULT_CLOUDFLARE_TOKEN` or `VAULT_SERVER_PASSWORD`.
 *
 * Model-facing tools let the agent actually USE what was stored:
 *   - vault_status  — what entries exist and which secrets are configured
 *                     (never the values themselves);
 *   - vault_get     — resolve one secret value for a task that needs it
 *                     (the value goes to the model for that one call).
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-vault";
export const inject = ["tools"];

const NS = "dsh-vault";

/**
 * Known entry kinds → the fields they expose.
 * - token:  one secret `token` (Cloudflare, OpenAI, …)
 * - server: non-secret `ip` / `user` / `port` / `publicHost` + secret `password`
 * - web:    non-secret `url` / `user` + secret `password`
 * - github: non-secret `user` + secret `token`
 */
const KINDS = {
  token: { secretFields: ["token"] },
  server: { secretFields: ["password"] },
  web: { secretFields: ["password"] },
  github: { secretFields: ["token"] },
};

const FieldSchema = z.dict(z.string()).default({});

const EntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  fields: FieldSchema,
});

const VaultSchema = z.object({
  entries: z.array(EntrySchema).default([]),
});

/** Derive the credentials reference for one secret field of one entry. */
function secretRef(entryId, fieldKey) {
  const id = String(entryId).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const fk = String(fieldKey).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return `VAULT_${id}_${fk}`;
}

export function apply(ctx) {
  let current = () => ({ entries: [] });

  // Register the settings namespace while the settings service exists.
  ctx.inject(["settings"], (sctx) => {
    const scope = sctx.settings.register(NS, VaultSchema);
    current = () => scope.get() ?? { entries: [] };
    sctx.effect(
      () => () => {
        current = () => ({ entries: [] });
      },
      "dsh-vault: settings fallback"
    );
  });

  ctx.tools.register(
    defineTool({
      name: "vault_status",
      description:
        "List the credential vault entries (设置 → 凭据) with their kinds, non-secret fields, and whether each secret field is configured. " +
        "Returns labels and configured booleans only — never secret values.",
      parameters: {},
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [
          {
            type: "text",
            text: value?.ok
              ? JSON.stringify(value.entries ?? [], null, 2)
              : `vault_status failed: ${value?.error ?? "unknown"}`,
          },
        ],
      },
      execute: async () => {
        const creds = ctx.get("credentials");
        const entries = current().entries ?? [];
        const rows = [];
        for (const entry of entries) {
          const secretFields = KINDS[entry.kind]?.secretFields ?? [];
          const secretState = {};
          for (const field of secretFields) {
            let configured = false;
            if (creds) {
              try {
                const info = await creds.describe(credentialRef(secretRef(entry.id, field)));
                configured = Boolean(info?.configured);
              } catch {
                configured = false;
              }
            }
            secretState[field] = configured;
          }
          rows.push({
            id: entry.id,
            label: entry.label,
            kind: entry.kind,
            fields: entry.fields ?? {},
            secretState,
          });
        }
        return { ok: true, entries: rows };
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "vault_get",
      description:
        "Resolve one stored secret value from the credential vault by entry id and secret field key " +
        "(e.g. id=cloudflare field=token → the Cloudflare API token). Use the value for the operation at hand " +
        "(call the Cloudflare API, ssh into the server, …) and do not echo it back in your reply.",
      parameters: {
        id: { type: "string", description: "The vault entry id, e.g. cloudflare or server." },
        field: { type: "string", description: "The secret field key, e.g. token or password." },
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [
          {
            type: "text",
            text: value?.ok
              ? `Resolved ${value.field} for ${value.id}.`
              : `vault_get failed: ${value?.error ?? "unknown"}`,
          },
        ],
      },
      execute: async (args) => {
        const id = String(args.id ?? "");
        const field = String(args.field ?? "");
        const entry = (current().entries ?? []).find((e) => e.id === id);
        if (!entry) return { ok: false, error: `no vault entry "${id}"` };
        const secretFields = KINDS[entry.kind]?.secretFields ?? [];
        if (!secretFields.includes(field)) {
          return { ok: false, error: `"${field}" is not a secret field of ${entry.kind}` };
        }
        const creds = ctx.get("credentials");
        if (!creds) return { ok: false, error: "credentials service unavailable" };
        const ref = credentialRef(secretRef(id, field));
        const hit = await creds.resolve(ref);
        if (!hit) return { ok: false, error: `secret ${secretRef(id, field)} is not configured` };
        return { ok: true, id, field, value: hit.value };
      },
    })
  );
}
