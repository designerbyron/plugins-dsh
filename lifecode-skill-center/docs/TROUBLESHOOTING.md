# Troubleshooting

Start with the diagnostic order: **install state → route/admission → contract → store → the specific view**.
Most failures are lifecycle problems (a running Harness still serving the previous server module), not data
loss.

## 1. The plugin does not appear in the sidebar

1. **Plugins page**: is the bundle installed and enabled? An installed but disabled bundle has no panel.
2. **Restart**: the HTTP route and the panel mount when the plugin mounts. Toggling the layer is not a
   restart. Close the Harness completely and start it again.
3. **Reload the page**: the client bundle is loaded by the browser; a stale page can keep the old panel.
4. **Check the route**:

   ```sh
   curl -i http://127.0.0.1:<port>/lifecode-skill-center/api/health
   ```

   - `200` → the backend is mounted; the problem is client-side (reload, console errors, slot conflict).
   - `401` → the route exists but admission rejected the request. Try from the panel; the browser peer is
     the admitted client. Before a restart, an older backend may also answer `401` here because its
     admission gate runs before the plugin's own routing.
   - `404` → the prefix is not served, or the running backend module predates the route (the response body
     names the API prefix). Restart after installing.
   - Connection refused → wrong port, or the Host web server is not running.

5. **Slot conflict**: another client plugin may occupy the same slot. The panel is bounded by an error
   boundary; a blank panel usually has a console error. Disable the other plugin temporarily to confirm.

## 2. The panel loads but every request fails

Open the browser developer tools → Network. Look for the request path and the HTTP status.

| Status | Likely cause | Action |
|---|---|---|
| `401` | Host admission rejected the request; the session has no admitted peer. | Reload from the DSH page; check the Host's authentication configuration. |
| `403` | Cross-origin request, or the `api` peer channel tried a mutation. | Use the panel; do not call mutating actions from a restricted channel. |
| `404` | Backend does not know the route (old server module, plugin not mounted). | Restart the Harness; reinstall if the path is still absent. |
| `409` | A preflight or store condition blocked the operation. | Read the `code` and the findings in the response; see §6. |
| `503` | A required Host service is unavailable (workspace registry, Skill catalog, authentication). | Read the message; the source is named. |
| `500` | Unexpected error. | Capture the request id and the Host log. |

The compatibility banner is not an error by itself. It reports which contract state the client detected.

## 3. Compatibility banner states

| Banner | Meaning | What to do |
|---|---|---|
| **Compatible** (no banner) | Client and backend share contract 2 and the required capabilities. | Nothing. |
| **Legacy-compatible** (amber) | The backend answered `/workspaces` without the new markers; the client keeps safe read-only behavior and disables new actions. | Restart the Harness so the new backend module loads. |
| **Backend incompatible** (red) | A backend answers but its contract is older/newer than the client supports. | Update both halves; do not force writes. |
| **Unavailable** (red) | The backend did not answer. | Check the route, the port, and the Host log. |
| **Authentication error** (red) | `401`/`403` from the Host admission. | Reload from the DSH page; check the Host authentication setup. |

The banner shows the client contract, the backend version/contract when known, and an HTTP status. Use
**Copy diagnostic** before restarting so the evidence is preserved.

## 4. `capabilities` returns 401 before the UI works

This is a normal stage, not necessarily a defect:

- The backend loaded in the running Harness predates the capability route (`404`) or sits behind an
  admission gate (`401`).
- Restart the Harness after installing or updating the plugin.
- The browser panel may be the only admitted peer; a shell `curl` can be rejected while the panel works.

After the restart, `capabilities` should return `200` and `contractVersion: 2`.

## 5. Activity is empty or looks disconnected

- **Empty is a valid state**: no operation has been recorded since the journals were created. The feed does
  not invent retrospective history.
- The Activity drawer queries once when opened. Use **Refresh** to query again; closing and reopening the
  drawer reuses the current feed.
- **"Center available" / "Center available with warnings" / "No connection" / "State unavailable"** come
  from the actual response (`sources.center`, `sources.knowledge`), not from the compatibility banner. A
  warning names the sources that could not be read.
- Unread marks are stored per browser (`localStorage`). Another browser shows its own marks.
- There is no push and no OS notification. If the Harness UI is closed, nothing is displayed.

## 6. Writes return 409

Read `code` in the response; the panel shows findings, reasons, and sources.

| Code | Meaning | What to do |
|---|---|---|
| `preflight-blocked` | A blocking finding exists (collision, ambiguity, project unavailable, manifest mismatch). | Resolve the named finding; do not retry blindly. |
| `evidence-incomplete` | A required source could not be read. | Fix the source (store, filesystem, catalog, manifest) and retry. |
| `store-unreadable` | The store is unreadable or has an unsupported shape. | Use the backup pair; do not hand-edit blindly. |
| `identity-conflict` | Project path/manifest/id disagree. | Inspect the project detail; detach or repair deliberately. |
| `project-exists` | Registration already exists for that project. | Open the existing project instead of re-registering. |
| `not-adoptable` | The manifest is missing/invalid for adoption. | Repair the manifest or register normally. |
| `evaluation-failed` | The quality gate blocked publication/import (returned as `200 { ok:false }`). | Read the blocking checks; fix the Skill. |
| `confirmation-required` | Import was called without `confirmed: true`. | Validate first, then confirm in the panel. |

## 7. A project shows `unavailable`

The folder is missing, unreadable, or the Host reports `missing-dir`. The center does **not** delete the
registration or its assignments.

- If the project moved, use the project's repair/relink path; the identity must match.
- If you no longer want it, detach it explicitly.
- Do not recreate the folder just to silence the state; a different content tree is a different risk.

## 8. A project shows `identity-conflict` or `external-managed`

- **external-managed**: a valid manifest exists without an administrative record. Adopt it explicitly.
- **identity-conflict**: two records claim the same path/id, or the manifest id disagrees. Writes are
  blocked. Inspect the detail and resolve the duplication; do not edit the store by hand.
- Registration computes the id from the canonical path; a path that differs only by case or separator is
  the same project by design. A genuinely different path is a different project.

## 9. Collisions and the inventory

- The inventory is a global read-only view. A collision there is not automatically a project conflict; the
  project conflict count is separate.
- `legacy-collision` reports history under the previous compiler's root; it is informational.
- `name-collision` with different content in two sources is a warning until a write would overwrite one.
- `content-collision` means identical bytes under different names; it is advisory.
- `assignment-shadowed` means another provider/path wins for an assigned Skill; it blocks materialization
  until resolved.
- If the Host does not expose the Skill catalog, the inventory marks the source unavailable and the preflight
  blocks writes that need it; it does not claim "no collisions".

## 10. Portability: import or export fails

| Symptom | Cause | Action |
|---|---|---|
| `invalid-bundle`, `invalid-format` | Not JSON, not an object, or wrong schema. | Use a bundle produced by this plugin. |
| `unsupported-schema` | Schema version is not 1. | Update the producer/consumer; do not force it. |
| `checksum-mismatch`, `bad-integrity` | The portable fields changed after export. | Re-export from the source center. |
| `bundle-too-large` | More than 512 KiB. | Export a smaller Skill; the limit is a read limit, not a security scanner. |
| `invalid-references` | References escape the portable scope. | Remove or rewrite the references; absolute private paths are not portable. |
| `already-imported` | The same bundle was imported before. | Open the existing copy; do not duplicate. |
| `conflict` | Same id exists. | Validate again and choose "Create a copy with another id" if that is intended. |
| `bundle-exists` | The export file already exists. | Choose a different version/id or move the old file. |

Export writes under `<DSH_HOME>/lifecode-skill-center/exports/`. The checksum is not a signature; see
[SECURITY.md](SECURITY.md).

## 11. Store recovery

- Keep `center.json`, `center.json.bak`, and `center.json.bak.sha256` together.
- Verify the backup digest before replacing a document.
- `knowledge.json` is separate; restoring one journal does not restore the other.
- The materialized view can be removed safely; it is rebuilt from the store.
- A running Harness holds the store open; stop it before manual file surgery.

## 12. Diagnostics to attach to a report

- Plugin version (`1.0.1`) and the contract version from `capabilities`.
- The panel's compatibility state and **Copy diagnostic** output.
- The HTTP status, `code`, and `requestId` from the failing request.
- The project id (not the full path) and the operation name.
- Relevant Host log lines around the failure.
- Whether a restart happened between the change and the failure.

Never include the contents of `center.json`, `knowledge.json`, `.env` files, tokens, or personal paths in a
public issue.
