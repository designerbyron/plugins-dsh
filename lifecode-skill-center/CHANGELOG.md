# Changelog

All notable changes to LifeCode Skill Center are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows semantic versioning for
its public plugin contract. Test counts and coverage figures are measurements of a specific run, not a
promise; the promise is that the suite is green for the release being declared.

## [1.1.0-rc.2] — 2026-11-26

**Estado: RC no publicado, listo para aprobación humana.** Publica la identidad `dsh-lifecode-skill-center`
y reconcilia el árbol de trabajo con la línea vendor completa, sin redistribuir contenido de terceros.

### Added

- **Adaptador Host sin bytes embebidos**: el manifiesto y las huellas del candidato viajan en el paquete;
  los seis ficheros de Context7 y el script adaptado viven fuera de `files` y el resolvedor los obtiene
  del tag/commit fijados sólo bajo solicitud humana, con firma verificada y SHA-256 por fichero.
- **Comprobación del tarball publicable**: allowlist explícita y auditoría de nombre, versión, licencia,
  entrypoints, exportaciones, parche Cordis, rango `engines.dsh`, secretos y contenido restringido.

### Changed

- La identidad pública pasa a `dsh-lifecode-skill-center@1.1.0-rc.2`; el id del bundle sigue siendo
  `lifecode-skill-center` para no mover la configuración del perfil.
- `engines.dsh` se fija en `>=0.2.0-0 <0.3.0`, rango compatible con el `dsh-tools 0.2.0-rc.2` medido
  en el árbol y con el contrato v2 verificado por las pruebas.

## [1.1.0] — 2026-11-26

**Estado: candidato local en el worktree, no promocionado.** El plugin instalado sigue siendo el de la
fase anterior; este paquete se entrega para que una persona lo instale con backup y DSH cerrado.

### Added

- **Fase I — vínculo histórico de solicitudes**: nueva colección `state.requestLinks`, escrita sólo por una
  persona con rol *LifeCode Library Maintainer* desde el canal `browser`, que correlaciona
  `req-562393e0835f` con la importación vendor fijada sin modificar la solicitud, sin activar la skill
  y sin crear asignaciones. Dos acciones nuevas (`vendor-link-request`, `vendor-unlink-request`) con
  `operationId` generado en backend, idempotencia, conflicto explícito y corrección auditada.
- **Fase I — sección «Solicitud de origen»** en el panel del importador: muestra ID, texto histórico,
  skill/versión, commit, operación original y manifest antes de la confirmación; después muestra la
  relación sin presentar la petición como una importación pendiente. El cliente envía un cuerpo vacío.

### Notas

- La vinculación real sobre el almacén productivo **no se ejecutó**: queda como acción humana posterior.
- Fase G (selector de ámbito) y Fase H (auditoría post-importación) viajan en el mismo árbol; sus
  decisiones están registradas en `plans/LSC-UX-IA-VENDOR-001/`.

## [1.0.1] — 2026-11-09

First stable release with the R16–R17.1 line. The plugin stops being a library panel with a project switch
and becomes a discovery, registration, administration, provenance, portability, and activity system.

### Added

- **Projects as administered entities**: discovery of Host workspaces, explicit registration, a six-section
  project detail, identity derived from the canonical path (slug + SHA-1 prefix), and seven observations
  (`discovered`, `external-managed`, `managed`, `healthy`, `unavailable`, `identity-conflict`,
  `partially-inspected`).
- **Project registration without touching the project**: an administrative record plus a manifest
  (`schema`, `schemaVersion`, `projectId`, `registeredAt`, UUID v4) under the center's own store.
- **Global Skill inventory** with separate axes for owner, origin, location, scope, association, and
  execution; provenance labels and a confidence scale (`verified` > `manifest` > `plugin-contract` >
  `local-registry` > `content-hash` > `name-only` > `unknown`); ambiguous groups reported explicitly.
- **Collision engine and fail-closed preflight**: `identity-duplicate`, `name-collision`, `path-collision`,
  `content-collision`, `assignment-shadowed`, and `legacy-collision`; required sources per action; `409`
  responses with findings, reasons, and evidence.
- **Package portability**: export a Skill to a single JSON bundle, inspect it read-only with a preview,
  import it only after explicit confirmation, with conflict handling, a durable origin
  (`bundleChecksum`, `originalSkillId`, `originalVersion`, `importedAt`), and a `skill-imported` event.
  Same-id conflicts can create an isolated copy (`onConflict: "copy"`).
- **Activity Center**: an in-app drawer with categories, severities, actor and evidence, cursor pagination,
  filters, grouping, and browser-local unread marks. Operational events are normalized at read time.
- **In-app notifications**: at most three stacked toasts, success/info 6 s, warning 8 s, persistent errors,
  correlation grouping, a contextual action, keyboard dismissal, reduced-motion support, and
  `aria-live`/alert semantics. No operating-system notification and no push with the Harness closed.
- **Compatibility handshake**: `GET /api/capabilities` with `contractVersion: 2`, and five client states
  (compatible, legacy-compatible, incompatible, unavailable, authentication error). Legacy mode disables new
  actions with a reason and never calls routes the backend did not advertise.
- **Public documentation**: English installation, architecture, security, troubleshooting, product README,
  root README (English and Spanish), changelog, and sanitized screenshots. The existing Spanish engineering
  notes remain as the detailed record.
- **Product license and authorship notice**: a standard MIT `LICENSE` for the plugin
  (`Copyright (c) 2026 Byron Vanegas`, with the original-creator notice), `author` set to Byron Vanegas, and
  `docs/LEGAL.md` covering copyright, license obligations, product name and logo, and recommended fork
  attribution. The repository's own `LICENSE` is unchanged.

### Changed

- The Product README now describes the implemented system instead of a phase plan; counts and claims were
  rewritten as measurements with their limits.
- Activity attribution distinguishes human, agent, system, external, and unknown, with the recording channel
  as evidence. Unknown authorship is not guessed.
- Activity drawer connection labels come from the real response sources (`center`, `knowledge`), not from the
  contract compatibility state.
- The event taxonomy derives the title from the event type; historical rows are corrected on read because a
  stored title is not authoritative.
- `skill.loaded` remains an offer/load signal, explicitly not proof that the model applied the Skill.
- Portability bundles are versioned by the package schema and checksum; settings, assignments, evaluations,
  history, and evaluation state are intentionally not portable.

### Fixed

- `skill-imported` events no longer render as "Skill created"; assigned/unassigned/advanced, requests,
  insights, decisions, and policy events have their own semantic titles instead of broad fallbacks.
- The Activity drawer no longer says "No connection to the center" when `/api/activity` answered and both
  sources were readable.
- The "Create a copy with another id" action is offered only when the plan really is a copy; already-imported
  and blocked states show Cancel only.
- Import no longer duplicates the rename notice in both the inline result and a toast.
- Project counters no longer say "1 entregas"; singular/plural labels are selected by count.
- A same Skill materialized in two projects is no longer reported as a name collision; cross-project
  shadowing is not attributed to an unrelated project.
- Preflight no longer allows a content-collision-only decision to pass silently when the collision is relevant
  to the operation; the action matrix and tests pin the behavior.

### Security

- Writes are fail-closed when required evidence is unavailable; the plugin never treats a missing source as
  "no conflicts".
- Bundle reader limits: 512 KiB, JSON shape, schema, numeric schema version, non-empty id/body, recomputed
  checksum; import is read-only until `confirmed: true`; the quality gate runs on import.
- Bundle checksums are documented as transport integrity, not signatures, and private references are reported
  rather than silently exported.
- The API stays on the Host web server with admission, cross-origin checks, and the `api-peer-restricted`
  mutation rule; AI-originated approval/publish/assign/enable calls are rejected.
- The installer slot conflict with `dsh-plugins-update` was resolved through the composition patch rather than
  by patching another package in place.

### Documentation

- Added `docs/INSTALLATION.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/TROUBLESHOOTING.md`, and this
  changelog.
- Added `docs/images/` with synthetic renders of the real client (projects, project detail, collisions, Skill
  detail, activity toast, activity center, portability preview). The chat-overlay screenshot remains pending.
- GitHub installation is documented as **not verified**; the verified route is clone + install from a local
  path. The candidate syntax and the pending temporary-profile test are stated explicitly.

### Verification

- Full gates and final numbers: see `_audit/FINAL-RELEASE-READINESS.md` §E.
- End-to-end, autonomous, routing, portability, performance, mutation, and quality gates in green; the
  pre-existing test-quality report keeps its known finding and is not presented as green.
- Hermetic run: the real store was measured before and after; it did not change.

## [1.0.0] — initial stable release

- Visual library with persistent storage, immutable versions, rollback, and a per-project on/off switch.
- Deterministic quality gate before publication.
- Four agent tools at the time (search, create, improve, status); approval and activation reserved for people.
- Project-scoped Skill provider, a derived materialized view, and a panel with Overview, Library, Projects,
  Improvements, and Analytics.
- Automatic backups, atomic writes, and a hermetic test gate.
- The original test suite was green for that release.

## Earlier development

Before 1.0.0 the plugin was developed as a visual center over the previous compiler: phases 0–7 covered
discovery, creation, evaluation, versions, project assignment, analytics, and improvement proposals. Their
detailed history lives in the Spanish engineering notes and in the repository's commit history.
