# Security

This document describes the security model of LifeCode Skill Center 1.0.1: what the plugin protects, what
it explicitly does not protect, and which limits are structural rather than temporary.

## 1. Security goals

1. **The model cannot approve itself.** Creating and improving are agent operations; approving, publishing,
   assigning, and enabling are human operations.
2. **A write never silently overwrites someone else's content.** Identity, path, content, and assignment
   conflicts are detected; the preflight can block the operation.
3. **Missing evidence is not success.** If a required source cannot be read, the write is blocked instead of
   being decided on partial data.
4. **Knowing where a Skill came from is part of the result.** Provenance and confidence travel with every
   inventory row and every imported bundle.
5. **The plugin is local-first.** It serves through the Host's web server, stores data under `DSH_HOME`, and
   declares no telemetry endpoint.

## 2. Trust model

| Actor | Can do | Cannot do |
|---|---|---|
| Person (panel) | Approve, publish, assign, enable, register/adopt projects, import bundles. | Bypass the preflight or the store's integrity checks. |
| Agent (tools) | Search, create a proposed Skill, propose an improvement, record a verified insight, inspect status. | Approve, publish, assign, enable, or call an approval-only HTTP action. |
| Host | Serve the routes, admit requests, provide the workspace registry and the Skill catalog. | Push events into the plugin; there is no public Host→plugin notification channel. |
| External bundle | Carry one Skill and its portable fields. | Assert identity, authorship, or a valid signature. |

The API returns `approval-required` when an AI-originated call targets an approval-only operation. This is a
server-side check, not a hidden button.

## 3. Authentication and admission

- The API is mounted on the Host's web server under `/lifecode-skill-center/api`; the plugin does not open a
  second listener.
- Requests pass the Host admission gate. The observed refusals are `401 unauthorized`, `403 forbidden`, and
  `503 auth-unavailable` when the Host exposes no usable authentication context.
- The `api` peer channel is restricted: it cannot POST mutations (`403 api-peer-restricted`).
- Cross-origin requests are rejected (`403`) before the body is read.
- `health` and `capabilities` are deliberately served before admission so that a client can distinguish
  "this route does not exist" from "the route exists but I am not admitted". They contain no secrets.

## 4. Human approval boundary

The following operations require a human-originated channel: publish, approve/reject, assign or unassign,
enable/disable, adopt a project, register a project, import a bundle, and identity operations. The agent
tools never expose them.

A project policy may declare `guarded-autonomous`, which allows bounded autonomous work inside declared
guardrails. It does not remove the approval boundary for publishing, assigning, or enabling, and it is not a
way for the model to grant itself permissions.

## 5. Fail-closed preflight

Before a write, the center builds evidence from required and optional sources. The decision is:

```text
any block finding        → block
required source missing  → block (evidence-incomplete)
optional source missing  → warn  (catalog-unverified; never "no collisions")
ambiguous identity       → block (ambiguous-identity)
otherwise, any warn      → warn
otherwise                → allow
```

A blocked request returns `409` with the finding codes, reasons, and the evidence summary. The operation is
not executed and the store is not modified. When a required source is unreadable the result is a block, not
a warning; this is intentional and tested.

## 6. Store integrity

- `center.json` is a single JSON document written atomically (temporary file + replace) with a lock and a
  last-good copy: `center.json.bak` and `center.json.bak.sha256`.
- `knowledge.json` is a second journal, also written atomically.
- The materialized view under `materialized/` is derived. It is never read to decide; deleting it is safe
  because it is regenerated.
- Corrupt or unreadable stores produce an explicit `store-unreadable` result. The plugin does not guess a
  repaired state silently.
- The store is OS-level user data under `DSH_HOME`. There is no encryption at rest and no multi-user access
  control beyond the filesystem.

Do not hand-edit the JSON documents. If a manual repair is unavoidable, back up first and keep the `.bak`
pair with the document.

## 7. Skill bundles

A bundle is untrusted input.

- Size is capped at 512 KiB before reading; larger input is rejected without parsing.
- The reader validates JSON shape, schema, numeric schema version 1, non-empty Skill id and body, and the
  checksum.
- The checksum covers only `{ body, description, whenToUse, tags }`. It proves **transport integrity**; it
  does not cover the id, the version, references, origin, or timestamps, and it is **not a signature**.
  Anyone can recompute it. Do not treat a matching checksum as proof of authorship.
- References that point outside the portable scope are reported (`invalid-references`, non-portable
  warnings). Absolute paths are not silently exported as portable content.
- Apparent secrets (PEM blocks, API-key-like strings, passwords) produce warnings. This is best-effort
  detection, not a guarantee: review the preview before confirming an import.
- Import is read-only until `confirmed: true`. Conflicts (same id, same name, already imported) do not
  write. A same-id conflict can proceed only with `onConflict: "copy"`, which creates a new id and records a
  durable origin (`bundleChecksum`, `originalSkillId`, `originalVersion`, `importedAt`).
- Import runs the same quality gate as a normal creation. A blocking evaluation returns
  `200 { ok: false, code: "evaluation-failed" }` without writing.

## 8. Inventory and provenance

Inventory separates owner, origin, location, scope, association, and execution. Confidence is declared per
row (`verified`, `manifest`, `plugin-contract`, `local-registry`, `content-hash`, `name-only`, `unknown`).
Ambiguous groups are reported instead of resolving a winner. The Host does not expose Skill UUIDs, provider
shadowing, or every loaded path; the inventory states "not determined" for those fields rather than guessing.

A name is not a global identity. The same name in two sources is a collision to inspect, not a merge.

## 9. Activity and attribution

Activity events carry an actor (`human`, `agent`, `system`, `external`, `unknown`) and the channel that
recorded them. Unknown authorship is not assigned to a person or to the model. `external` events that are
persisted through `center.json` may be collapsed to the recorded human channel by the store's whitelist; the
knowledge journal can preserve the distinction. The UI labels confidence and evidence per field.

`skill.loaded` means the catalog offered the Skill. It is not proof that the model applied it. The center
does not claim to know application unless a signal exists.

## 10. What this plugin does not protect against

- A person with write access to `DSH_HOME` can read or modify the store.
- A malicious bundle that the person explicitly confirms can create a Skill with misleading content; the
  quality gate reduces obvious problems but is not a malware scanner.
- A compromised Host, browser extension, or operating system is outside the plugin's boundary.
- The plugin does not sandbox the model, the agent loop, or the tools of other plugins.
- It does not offer OS notifications, background execution, or a network service.

## 11. Reporting a security issue

Report privately to the repository owner: **designerbyron** via
[GitHub Security Advisories](https://github.com/designerbyron/plugins-dsh/security/advisories) or the contact
listed in the repository profile. Do not open a public issue with exploit details before a fix is available.

Include the version, the affected route or action, whether the store was modified, and the smallest
reproduction you can share. This project is a local-first developer tool; there is no bug bounty.
