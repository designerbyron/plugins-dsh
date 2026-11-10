# Architecture

LifeCode Skill Center is a DeepSeek Harness plugin with a pure core, a thin Host adapter, and a browser
panel. This document describes the implemented architecture at version 1.0.1. The detailed Spanish
engineering record is in [ARQUITECTURA.md](ARQUITECTURA.md); this page is the public, English overview.

## 1. Shape of the plugin

```text
+--------------------------- Browser (DSH Web UI) ---------------------------+
|  client.js                                                                 |
|    sidebar entry + full-page panel (slots: sidebar.panellist, main)         |
|    Library · Projects · Improvements · Analytics · Activity drawer          |
|    in-app toasts · compatibility banner · i18n ES/EN                       |
+------------------------------------+--------------------------------------+
                                     | fetch, same origin
                                     v
+--------------------------- Host (index.js) --------------------------------+
|  webServer prefix /lifecode-skill-center/api                               |
|  skill provider (rank 160) · 5 agent tools · HTTP JSON API                 |
+------------------------------------+--------------------------------------+
                                     | pure functions
                                     v
+------------------------------ Core (lib/) ---------------------------------+
|  state · operations · evaluate · knowledge · activity · projects           |
|  inventory · collisions · preflight · distribute · materialize             |
+------------------------------------+--------------------------------------+
                                     |
                                     v
        <DSH_HOME>/lifecode-skill-center/  (center.json, knowledge.json,
        materialized/, projects/<id>/manifest.json, exports/, backups)
```

The rule is **pure core, thin adapter**: decisions live in `lib/` and are tested with `node --test` without
the Harness; `index.js` only binds them to Host services.

## 2. Host adapter

`index.js` is the only file that depends on the Harness runtime. When it mounts it registers:

- **A skill provider** at rank 160. It serves the Skills assigned to the observed project, from the derived
  materialized view. It does not serve the whole library.
- **Five agent tools**: `lifecode_skill_search`, `lifecode_skill_create`, `lifecode_skill_improve`,
  `lifecode_skill_status`, `lifecode_skill_insight`. None of them approves, publishes, assigns, or enables.
- **The HTTP API** under the single prefix `/lifecode-skill-center/api`, using the Host's web server and
  its admission checks. The plugin does not create a second listener.
- **The client bundle** through the profile composition (`cordis.patch.yml`), which registers the sidebar
  entry and the full-page panel.

The panel uses the `main` slot for the page and `sidebar.panellist` for the launcher. Error boundaries wrap
the panel so a render failure cannot blank the whole slot.

## 3. Core modules

| Module | Responsibility |
|---|---|
| `lib/state.mjs` | Store document, schema normalization, atomic writes, backups, lock, event journal. |
| `lib/operations.mjs` | Create, evaluate, publish, assign, toggle, rollback, improve, fork, requests. |
| `lib/evaluate.mjs` | Deterministic quality gate: checks and blocking findings. |
| `lib/knowledge.mjs` | Insights, decisions, policies; separate journal and projections. |
| `lib/activity.mjs` | Event normalization and the activity feed: category, severity, actor, evidence. |
| `lib/projects.mjs` | Project observation and the seven-state classification; allowed operations. |
| `lib/inventory.mjs` | Skills found in the loader and on disk, with provenance and confidence. |
| `lib/collisions.mjs` | Six collision types over inventory, projects, assignments, and state. |
| `lib/preflight.mjs` | Fail-closed gate that decides allow/warn/block before a write. |
| `lib/distribute.mjs` | Skill bundles: export, read, preview, import, durable origin. |
| `lib/materialize.mjs` | Derived `SKILL.md` view for the provider; never read to decide. |
| `lib/tools.mjs` | The five agent tools; thin wrappers over the core. |

## 4. Store

The center keeps one authoritative document:

```text
center.json
  schema, schemaVersion
  skills{ id → { versions, currentVersion, status, origin, ... } }
  assignments{ projectId → { skillId → { version, enabled, ... } } }
  projects{ projectId → { id, name, cwd, uuid, manifestSha256, ... } }
  references to knowledge entries (by id)
  events[]  (latest 4000)
```

Policies, insights, and decisions live in `knowledge.json`, not in `center.json`. The two journals share the
activity feed but not their write path.

Writes are atomic; the previous good copy is kept as `center.json.bak` with `center.json.bak.sha256`.
`knowledge.json` is a second journal for insights, decisions, and policies. The derived view under
`materialized/<projectId>/<skillId>/SKILL.md` is regenerated from the store and can be deleted without loss.

The store root is `<DSH_HOME>/lifecode-skill-center`; `LIFECODE_SKILL_CENTER_ROOT` overrides it. Tests always
use a temporary root and a hermetic check measures that the real store did not change.

## 5. HTTP API

All routes share the prefix `/lifecode-skill-center/api` and the Host's admission. `apiVersion` is `1`; the
evolving contract is `contractVersion` (`2` in 1.0.1), advertised by the handshake.

| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness; includes API version and authentication mode. |
| `GET /capabilities` | Handshake: plugin id/version, contract version, capability ids, route map. |
| `GET /workspaces` | Legacy workspace list, still served for compatibility. |
| `GET /inventory` | Global inventory with provenance, confidence, and collisions. |
| `GET /projects` | Project summaries, discovered workspaces, current observations. |
| `GET /activity` | Activity feed, cursor-paginated, optional category filter. |
| `GET /insights`, `/knowledge`, `/doctor`, `/diff`, `/skill`, `/state` | Read-only projections used by the panel. |
| `POST /state` | Action envelope (`{ action, payload }`) for every write operation. |

Write actions run the preflight first. A blocked preflight returns `409` with `code: "preflight-blocked"` and
the findings, reasons, and evidence. Missing required evidence returns `409 evidence-incomplete`; it is never
downgraded to a warning. AI-originated calls to approval-only actions return `approval-required`.

## 6. Events and the activity feed

Operational writes append events to the journal. The activity layer normalizes them at read time:

- **Category**: create, update, improvement, references, alert.
- **Severity**: success, info, warning, error.
- **Actor**: human, agent, system, external, or unknown, with the channel that recorded it.
- **Evidence and confidence**: every field says whether it was stored or derived.
- **Correlation**: one operation id groups related events; replaying an operation does not duplicate the
  feed row.

Two sources are merged: `center.json.events` and `knowledge.json.events`, each labelled with its origin.
Events whose type is not in the taxonomy are excluded rather than mislabelled. A title key is derived from
the event type, not stored, so historical rows are corrected when the taxonomy improves.

The feed keeps the latest 4000 events per journal and paginates with a cursor `(at, eventId)`. The Host
snapshot used elsewhere keeps the latest 80. Unread marks are browser-local.

## 7. Notifications

In-app toasts are rendered by the client and live only while the DSH web UI is open:

- At most three visible toasts; additional ones are queued or merged by correlation.
- Success and info: 6 s. Warning: 8 s. Errors: persistent until dismissed.
- `aria-live="polite"` for the stack; errors use an alert role. Escape closes the newest toast.
- Reduced motion is respected; no animation is required to read the message.
- A toast is produced from the real result of an operation and only when the operation persisted.

There is **no operating-system notification**, no push channel when the Harness is closed, no scheduler, and
no worker. The R17 work adds no polling: the Activity drawer performs one query when opened, and a manual
refresh or "Load more" performs the next one. The only recurring client interval is the pre-existing
Overview refresh.

## 8. Compatibility

The client and backend negotiate through `GET /capabilities`:

```json
{
  "ok": true,
  "kind": "capabilities",
  "plugin": { "id": "lifecode-skill-center", "version": "1.0.1" },
  "apiVersion": 1,
  "contractVersion": 2,
  "capabilities": ["capabilities", "projects", "inventory", "activity", "..."],
  "routes": { "GET /api/projects": "projects", "GET /api/activity": "activity", "..." }
}
```

The advertised capability list covers the R16 surface (`capabilities`, `projects`, `inventory`,
`inspect-project`, `register-project`, `adopt-project`, `materialize-project`, `preflight`,
`legacy-workspaces`) and includes `activity`, with `GET /api/activity` in the announced `routes`. This was an
additive change: `contractVersion` stays at `2`. The panel still degrades gracefully when talking to a
backend that predates the route.

The client resolves five states: **compatible** (contract 2 with the required capabilities), **legacy**
(a positive legacy signal from `/workspaces`, without the new markers), **incompatible** (a backend answers
but not this contract), **unavailable** (no answer), and **authentication error** (`401`/`403`). In legacy
mode the new write actions are disabled with a reason; it never calls routes the backend did not advertise.

## 9. Projects and identity

A project id is derived from the canonical working directory, never supplied by the client for registration:

```text
cwdKey    = normalizeCwd(cwd).toLowerCase()
projectId = slug(basename(cwdKey), 24) + "-" + sha1(cwdKey).hex.slice(0, 8)
```

Registration writes a manifest into the center's store and an administrative record; it does not write
inside the project. The seven observations and their precedence are documented in the product README and in
[ARQUITECTURA.md](ARQUITECTURA.md). Classification is a pure projection over measured evidence; no state is
persisted as "current status".

## 10. Inventory and collisions

Inventory sources include the Harness loader, the user library, previous compiler roots, materialized
copies, and the center registry. Each row separates owner, origin, location, scope, association, and
execution. Confidence is the highest level whose requirements are met, never an average:

```text
verified > manifest > plugin-contract > local-registry > content-hash > name-only > unknown
```

Ambiguous groups are reported, not resolved by guessing. Six collision types are evaluated with a
deterministic order (severity, code, key); assignment shadowing and path/identity conflicts are the ones that
can block a write. Preflight maps required sources to actions: if a required source is unavailable, the
decision is `block`, not `allow with a warning`.

## 11. Portability

A bundle is a JSON document with schema `lifecode-skill-center/skill-bundle`, schema version 1, one Skill,
and a checksum over `{ body, description, whenToUse, tags }`. Read limits: 512 KiB, JSON object, schema,
numeric schema version 1, non-empty id and body, checksum recomputed. Export writes
`exports/<id>-<version>.json`; import is read-only until `confirmed: true`.

The checksum is transport integrity. It does **not** cover id, version, references, origin, or timestamps,
and it is not a signature. Conflicts (same id, same name, already imported) are reported; a same-id conflict
can only proceed with an explicit `onConflict: "copy"`, producing a new id and a durable origin.

## 12. Trust boundaries and limits

- **Human approval is a boundary, not a UI preference.** The API rejects AI-originated approval/publish/
  assignment operations with `approval-required`.
- **The Host does not expose** Skill UUIDs, provider shadowing, or a public Host→plugin notification
  channel. The center says "not determined" instead of inventing values.
- **The store is local user data**, not a multi-user service. There is no encryption at rest and no remote
  telemetry declared by the plugin.
- **Opening a workspace is a client capability.** The panel may ask the browser UI to open a workspace; the
  API cannot open one on the Host side.
- **Loading is not applying.** `skill.loaded` proves the catalog offered the Skill, not that the model used
  it. Analytics labels the difference.

## 13. Testing and verification

The core is tested with `node --test`; Host integration tests run against temporary stores; the hermetic
check measures the real store before and after the suite. Full gates and final numbers: see
`_audit/FINAL-RELEASE-READINESS.md` §E. Test counts are measurements of a specific run, not a promise; the
promise is that the suite is green for the release being declared.
