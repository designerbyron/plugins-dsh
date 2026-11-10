# Release 1.0.1 — Plan de commits (final)

**Snapshot:** HEAD `3b295106e5263858c32bd4db4c110068a4bad687` · rama `feature/visual-operation-feedback` · `git status -uall` **2145** entradas · **230 rutas ejecutables** + **16 ya versionadas (no candidatas)** en 7 grupos · medido 2026-11-10 07:14:05 UTC.

Nada de este plan se ejecuta aquí: son comandos propuestos para una persona. **Nunca `git add -A`**: cada commit enumera sus rutas con `git add --`.

## 0. Comprobaciones previas

```sh
git -C . rev-parse HEAD
git -C . status --porcelain -uall | wc -l
git -C . diff --check
```

Se espera HEAD `3b295106e5263858c32bd4db4c110068a4bad687` y 2145 entradas. Los comandos siguientes asumen esa base.

## 1. Commits propuestos

### Commit 1 — chore(release): metadatos, licencia y autoría del plugin 1.0.1

```sh
git add -- \
  "lifecode-skill-center/package.json" \
  "lifecode-skill-center/icon.svg" \
  "lifecode-skill-center/LICENSE" \
  "lifecode-skill-center/docs/LEGAL.md"
git commit -m "chore(release): metadatos, licencia y autoría del plugin 1.0.1"
```

### Commit 2 — feat(core): módulos puros, adaptador y API del centro

```sh
git add -- \
  "lifecode-skill-center/index.js" \
  "lifecode-skill-center/lib/activity.mjs" \
  "lifecode-skill-center/lib/analytics.mjs" \
  "lifecode-skill-center/lib/api.mjs" \
  "lifecode-skill-center/lib/collisions.mjs" \
  "lifecode-skill-center/lib/decisions.mjs" \
  "lifecode-skill-center/lib/distribute.mjs" \
  "lifecode-skill-center/lib/export.mjs" \
  "lifecode-skill-center/lib/identity.mjs" \
  "lifecode-skill-center/lib/insights.mjs" \
  "lifecode-skill-center/lib/inventory.mjs" \
  "lifecode-skill-center/lib/knowledge.mjs" \
  "lifecode-skill-center/lib/manifest-ops.mjs" \
  "lifecode-skill-center/lib/operations.mjs" \
  "lifecode-skill-center/lib/paths.mjs" \
  "lifecode-skill-center/lib/preflight.mjs" \
  "lifecode-skill-center/lib/projects.mjs" \
  "lifecode-skill-center/lib/requests.mjs" \
  "lifecode-skill-center/lib/similarity.mjs" \
  "lifecode-skill-center/lib/sources.mjs" \
  "lifecode-skill-center/lib/state.mjs" \
  "lifecode-skill-center/lib/tools.mjs"
git commit -m "feat(core): módulos puros, adaptador y API del centro"
```

### Commit 3 — feat(ui): biblioteca, proyectos, actividad y portabilidad

```sh
git add -- \
  "lifecode-skill-center/client.js"
git commit -m "feat(ui): biblioteca, proyectos, actividad y portabilidad"
```

### Commit 4 — test: pruebas base del centro

```sh
git add -- \
  "lifecode-skill-center/tests/advance.test.mjs" \
  "lifecode-skill-center/tests/adversarial.test.mjs" \
  "lifecode-skill-center/tests/analytics.test.mjs" \
  "lifecode-skill-center/tests/api.test.mjs" \
  "lifecode-skill-center/tests/application-evidence.test.mjs" \
  "lifecode-skill-center/tests/autonomy-attacks.test.mjs" \
  "lifecode-skill-center/tests/autonomy-binding.test.mjs" \
  "lifecode-skill-center/tests/autonomy.test.mjs" \
  "lifecode-skill-center/tests/backup-atomic.test.mjs" \
  "lifecode-skill-center/tests/backup.test.mjs" \
  "lifecode-skill-center/tests/choices.test.mjs" \
  "lifecode-skill-center/tests/client.test.mjs" \
  "lifecode-skill-center/tests/concurrency.test.mjs" \
  "lifecode-skill-center/tests/consistency.test.mjs" \
  "lifecode-skill-center/tests/create-idempotency.test.mjs" \
  "lifecode-skill-center/tests/discovery-contract.test.mjs" \
  "lifecode-skill-center/tests/distribute-security.test.mjs" \
  "lifecode-skill-center/tests/distribute-ui.test.mjs" \
  "lifecode-skill-center/tests/distribute.test.mjs" \
  "lifecode-skill-center/tests/doctor.test.mjs" \
  "lifecode-skill-center/tests/evaluate.test.mjs" \
  "lifecode-skill-center/tests/export-warning-toast.test.mjs" \
  "lifecode-skill-center/tests/export.test.mjs" \
  "lifecode-skill-center/tests/fixtures/writer.mjs" \
  "lifecode-skill-center/tests/fork-api.test.mjs" \
  "lifecode-skill-center/tests/fork-manifest.test.mjs" \
  "lifecode-skill-center/tests/helpers.mjs" \
  "lifecode-skill-center/tests/identity-move.test.mjs" \
  "lifecode-skill-center/tests/identity-ops.test.mjs" \
  "lifecode-skill-center/tests/identity-repair-guards.test.mjs" \
  "lifecode-skill-center/tests/identity-v3.test.mjs" \
  "lifecode-skill-center/tests/identity-view-projection.test.mjs" \
  "lifecode-skill-center/tests/identity-view.test.mjs" \
  "lifecode-skill-center/tests/identity.test.mjs" \
  "lifecode-skill-center/tests/index.test.mjs" \
  "lifecode-skill-center/tests/insight-lifecycle.test.mjs" \
  "lifecode-skill-center/tests/insights.test.mjs" \
  "lifecode-skill-center/tests/integrity.test.mjs" \
  "lifecode-skill-center/tests/knowledge-api.test.mjs" \
  "lifecode-skill-center/tests/manifest-ops.test.mjs" \
  "lifecode-skill-center/tests/migrate-control.test.mjs" \
  "lifecode-skill-center/tests/operations.test.mjs" \
  "lifecode-skill-center/tests/panel-contract.test.mjs" \
  "lifecode-skill-center/tests/paths.test.mjs" \
  "lifecode-skill-center/tests/policy-provenance.test.mjs" \
  "lifecode-skill-center/tests/policy.test.mjs" \
  "lifecode-skill-center/tests/portability.test.mjs" \
  "lifecode-skill-center/tests/publish-temp-cleanup.test.mjs" \
  "lifecode-skill-center/tests/redteam-fixed-contract.test.mjs" \
  "lifecode-skill-center/tests/render.test.mjs" \
  "lifecode-skill-center/tests/repair-api.test.mjs" \
  "lifecode-skill-center/tests/repair-interruptions.test.mjs" \
  "lifecode-skill-center/tests/requests.test.mjs" \
  "lifecode-skill-center/tests/settlement-recovery.test.mjs" \
  "lifecode-skill-center/tests/skill-detail.test.mjs" \
  "lifecode-skill-center/tests/skill-diff.test.mjs" \
  "lifecode-skill-center/tests/skillfile.test.mjs" \
  "lifecode-skill-center/tests/state-atomicity.test.mjs" \
  "lifecode-skill-center/tests/state-scan-contract.test.mjs" \
  "lifecode-skill-center/tests/state.test.mjs" \
  "lifecode-skill-center/tests/styles.test.mjs" \
  "lifecode-skill-center/tests/t13.test.mjs" \
  "lifecode-skill-center/tests/testquality-analyzer.test.mjs" \
  "lifecode-skill-center/tests/testquality-audit.test.mjs" \
  "lifecode-skill-center/tests/tools.test.mjs" \
  "lifecode-skill-center/tests/workspaces.test.mjs"
git commit -m "test: pruebas base del centro"
```

### Commit 5 — test(release): pruebas R16/R17 y arneses T42

```sh
git add -- \
  "lifecode-skill-center/tests/r16-api.test.mjs" \
  "lifecode-skill-center/tests/r16-bundle-contract.test.mjs" \
  "lifecode-skill-center/tests/r16-bundle.test.mjs" \
  "lifecode-skill-center/tests/r16-coherence.test.mjs" \
  "lifecode-skill-center/tests/r16-contract.test.mjs" \
  "lifecode-skill-center/tests/r16-domain.test.mjs" \
  "lifecode-skill-center/tests/r16-e2e-sim.test.mjs" \
  "lifecode-skill-center/tests/r16-routing.test.mjs" \
  "lifecode-skill-center/tests/r16-runtime.test.mjs" \
  "lifecode-skill-center/tests/r16-security.test.mjs" \
  "lifecode-skill-center/tests/r16-ui.test.mjs" \
  "lifecode-skill-center/tests/r17-activity.test.mjs" \
  "lifecode-skill-center/tests/r17-api-activity.test.mjs" \
  "lifecode-skill-center/tests/r17-contract.test.mjs" \
  "lifecode-skill-center/tests/r17-events.test.mjs" \
  "lifecode-skill-center/tests/r17-r171.test.mjs" \
  "lifecode-skill-center/tests/r17-ui-runtime.mjs" \
  "lifecode-skill-center/tests/r17-ui.test.mjs" \
  "lifecode-skill-center/tests/r17-ux.test.mjs" \
  "lifecode-skill-center/tests/t42-tools-activity.test.mjs" \
  "lifecode-skill-center/tests/t42-ui-runtime.mjs" \
  "lifecode-skill-center/tests/t42-ui.test.mjs"
git commit -m "test(release): pruebas R16/R17 y arneses T42"
```

### Commit 6 — chore(tools): verificación, e2e y presupuesto de rendimiento

```sh
git add -- \
  "_audit/r16.4-run-gates.mjs" \
  "_audit/r17-run-gates.mjs" \
  "_audit/r17.1-run-gates.mjs" \
  "_audit/release-run-gates.mjs" \
  "lifecode-skill-center/tools/adversarial.mjs" \
  "lifecode-skill-center/tools/check.mjs" \
  "lifecode-skill-center/tools/coverage.mjs" \
  "lifecode-skill-center/tools/e2e-autonomous.mjs" \
  "lifecode-skill-center/tools/e2e.mjs" \
  "lifecode-skill-center/tools/mutation.mjs" \
  "lifecode-skill-center/tools/perf.mjs" \
  "lifecode-skill-center/tools/r16-collision-matrix.mjs" \
  "lifecode-skill-center/tools/r16-e2e.mjs" \
  "lifecode-skill-center/tools/r16-portability.mjs" \
  "lifecode-skill-center/tools/r16-routing.mjs" \
  "lifecode-skill-center/tools/r17-perf.mjs" \
  "lifecode-skill-center/tools/redteam.mjs" \
  "lifecode-skill-center/tools/testquality.mjs"
git commit -m "chore(tools): verificación, e2e y presupuesto de rendimiento"
```

### Commit 7 — docs: documentación pública del producto

```sh
git add -- \
  "lifecode-skill-center/README.md" \
  "lifecode-skill-center/docs/ARCHITECTURE.md" \
  "lifecode-skill-center/docs/DESARROLLO.md" \
  "lifecode-skill-center/docs/INSTALLATION.md" \
  "lifecode-skill-center/docs/SECURITY.md" \
  "lifecode-skill-center/docs/TROUBLESHOOTING.md"
git commit -m "docs: documentación pública del producto"
```

### Commit 8 — docs(root): README de la familia LifeCode

```sh
git add -- \
  "README.md"
git commit -m "docs(root): README de la familia LifeCode"
```

### Commit 9 — docs(changelog): notas de 1.0.1

```sh
git add -- \
  "lifecode-skill-center/CHANGELOG.md"
git commit -m "docs(changelog): notas de 1.0.1"
```

### Commit 10 — chore(assets): iconos y social preview

```sh
git add -- \
  "assets/lifecode-skill-center/app-icon-512.png" \
  "assets/lifecode-skill-center/app-icon-transparent.png" \
  "assets/lifecode-skill-center/app-icon.svg" \
  "assets/lifecode-skill-center/github-social-preview.png"
git commit -m "chore(assets): iconos y social preview"
```

### Commit 11 — docs(images): capturas públicas neutrales

```sh
git add -- \
  "_audit/t44-assets/generated/activity-center.png" \
  "_audit/t44-assets/generated/activity-chat.png" \
  "_audit/t44-assets/generated/activity-toast.png" \
  "_audit/t44-assets/generated/collisions.png" \
  "_audit/t44-assets/generated/portability.png" \
  "_audit/t44-assets/generated/project-detail.png" \
  "_audit/t44-assets/generated/projects-discovered.png" \
  "_audit/t44-assets/generated/skill-detail.png" \
  "lifecode-skill-center/docs/images/activity-center.png" \
  "lifecode-skill-center/docs/images/activity-chat.png" \
  "lifecode-skill-center/docs/images/activity-toast.png" \
  "lifecode-skill-center/docs/images/collisions.png" \
  "lifecode-skill-center/docs/images/portability.png" \
  "lifecode-skill-center/docs/images/project-detail.png" \
  "lifecode-skill-center/docs/images/projects-discovered.png" \
  "lifecode-skill-center/docs/images/skill-detail.png"
git commit -m "docs(images): capturas públicas neutrales"
```

### Commit 12 — docs(audit): informes, gates y evidencia reproducible

```sh
git add -- \
  "_audit/COBERTURA.md" \
  "_audit/E2E-AUTONOMO.md" \
  "_audit/FINAL-RELEASE-READINESS.md" \
  "_audit/INCIDENTE-2026-11-09-web-boot.md" \
  "_audit/R16-ACCEPTANCE.md" \
  "_audit/R16-COLLISION-MATRIX.md" \
  "_audit/R16-CONTRACT.md" \
  "_audit/R16-GATES.md" \
  "_audit/R16-PROJECT-LIFECYCLE.md" \
  "_audit/R16-SKILL-INVENTORY.md" \
  "_audit/R16-UX-UI.md" \
  "_audit/R16.1-GATES.md" \
  "_audit/R16.1-PLUGIN-CONFLICT.md" \
  "_audit/R16.2-ACCEPTANCE.md" \
  "_audit/R16.2-GATES.md" \
  "_audit/R16.2-LIFECYCLE.md" \
  "_audit/R16.2-ROUTING-CONTRACT.md" \
  "_audit/R16.2-RUNTIME-DIAGNOSTIC.md" \
  "_audit/R16.3-COLLISION-AUDIT.md" \
  "_audit/R16.3-GATES.md" \
  "_audit/R16.3-METRICS-UX.md" \
  "_audit/R16.4-ACCEPTANCE.md" \
  "_audit/R16.4-GATES.md" \
  "_audit/R16.4-PACKAGE-PORTABILITY.md" \
  "_audit/R16.4-PORTABILITY-UX.md" \
  "_audit/R16.4-POST-IMPORT-VERIFICATION.md" \
  "_audit/R17-ACTIVITY-ACCEPTANCE.md" \
  "_audit/R17-ACTIVITY-ARCHITECTURE.md" \
  "_audit/R17-EVENT-CONTRACT.md" \
  "_audit/R17-GATES.md" \
  "_audit/R17-LIGHTWEIGHT-ARCHITECTURE-REPORT.md" \
  "_audit/R17-NOTIFICATIONS-UX.md" \
  "_audit/R17.1-GATES.md" \
  "_audit/T42-CHAT-NOTIFICATIONS.md" \
  "_audit/T43-DISTRIBUTION-AUDIT.md" \
  "_audit/T43-PUBLISH-PLAN.md" \
  "_audit/T44-MARKETING-AND-GITHUB-EXPERIENCE.md" \
  "_audit/TEST-QUALITY-DEFECTOS.md" \
  "_audit/UX-UI-R15.md" \
  "_audit/r16-sources/50-catalog.json" \
  "_audit/r16-sources/60-provenance.json" \
  "_audit/r16-sources/analyze.mjs" \
  "_audit/r16-sources/probe-exposure.mjs" \
  "_audit/r16-sources/scan2.mjs" \
  "_audit/r16-verify-r161.md" \
  "_audit/r16-verify-r162.md" \
  "_audit/r16-verify-r163.md" \
  "_audit/r16-verify-r164.md" \
  "_audit/r16-write-matrix.md" \
  "_audit/r16.3-recon/README.md" \
  "_audit/r16.3-recon/analyze-live.mjs" \
  "_audit/r16.3-recon/case-selfshadow.json" \
  "_audit/r16.3-recon/extract-case.mjs" \
  "_audit/r16.3-recon/sanitize-r163.mjs" \
  "_audit/r17-link-annex.mjs" \
  "_audit/r17-notifier.txt" \
  "_audit/r17-perf-after.json" \
  "_audit/r17-perf-baseline.json" \
  "_audit/r17-render.mjs" \
  "_audit/r17-verify-r17.md" \
  "_audit/r17-verify-r171.md" \
  "_audit/r17.1-recon/history-evidence.json" \
  "_audit/r17.1-recon/render-check.mjs" \
  "_audit/r17.1-recon/render-evidence.json" \
  "_audit/r17.1-recon/verify-history.mjs" \
  "_audit/release-verify.md" \
  "_audit/t44-assets/fixtures-public.mjs" \
  "_audit/t44-assets/manifest-public.mjs" \
  "_audit/t44-assets/render-public.mjs"
git commit -m "docs(audit): informes, gates y evidencia reproducible"
```

## 2. Comprobaciones después de cada commit

```sh
git diff --cached --check
git status --porcelain -uall
```

Al final:

```sh
cd lifecode-skill-center && npm pack --dry-run
```

El `npm pack` debe listar el bundle (`cordis.patch.yml`), `index.js`, `client.js`, `lib/`, `icon.svg`, `docs/` y no debe incluir `node_modules/` ni `_audit/`.

## 3. Dependencias

- Los commits de producto van antes que los de pruebas/verificación.
- Las capturas no dependen de código para commitearse, pero su contenido se generó con el árbol final.
- La evidencia de auditoría es independiente y va al final.

## 4. Commit final de los manifiestos

Cuando los 12 commits anteriores estén revisados y aplicados, se añaden los dos artefactos de este plan (no están entre las 230 rutas candidatas para evitar autorreferencia inestable):

```sh
git add -- "_audit/COMMIT-CANDIDATES-R17.md" "_audit/COMMIT-PLAN-R17.md"
git commit -m "docs(release): manifiesto y plan de commits 1.0.1"
```

## 5. Rutas ya versionadas sin cambios (no candidatas)

Estas 16 rutas ya están en HEAD y no aparecen en `git status`; **no se incluyen en ningún `git add`** porque no hay cambio que stagear. Se listan para que el conjunto ejecutable real (230 candidatas) sea verificable:

- `lifecode-skill-center/lib/detect.mjs` — 5146 B — `44c735b6122413234ed5e517eed62e0177b2bc2e2763df8622eeb572f66d8f79`
- `lifecode-skill-center/lib/evaluate.mjs` — 9205 B — `4efaedebded68bfcbae57b161810ca878c8dac4c9432405c44fe020f22a89e8c`
- `lifecode-skill-center/lib/format.mjs` — 6450 B — `9b721889647d21cdc8bd6c1aa8e40d21467b906f773dbd65a7ff123a0e987465`
- `lifecode-skill-center/lib/materialize.mjs` — 5280 B — `26cfc0fefe354ec27665acf7ea6e7b194cc5264641ebc581213f08c710b3f633`
- `lifecode-skill-center/lib/provider.mjs` — 7259 B — `108522bbd1a613b9de776cb28003a37529a33e2986c2f20a38e4a779b2dac64c`
- `lifecode-skill-center/lib/skillfile.mjs` — 6017 B — `f94705ba32e6c084b216eccf5809606abc58ddb42e7780a12caad0de439a8aee`
- `lifecode-skill-center/lib/watch.mjs` — 3402 B — `93e2de5b2330f43da21d97c575394412da0a03d7b4ac15873d849a2426ce25fa`
- `lifecode-skill-center/lib/workspaces.mjs` — 10 464 B — `d260ed6602f712faa109fa53bfe06d7668902159ed853826d4f2474898bfd105`
- `lifecode-skill-center/tests/check-hermetic.mjs` — 4097 B — `a065c144f92f053d8f3b31fa328f078df19ff8a20ee8f746338cec10a3d34c23`
- `lifecode-skill-center/tests/detect.test.mjs` — 3394 B — `d3aa6de69137cd4167c88667d76975e0aa569619117d6079c04fa5bb9e3e8b9c`
- `lifecode-skill-center/tests/fixtures/creator.mjs` — 1120 B — `4f14eb00f560d46eac430bb3d3d4d81c73c08dcd1f16e60c83520d6155bfcc2f`
- `lifecode-skill-center/tests/fixtures/loader.mjs` — 801 B — `180ac2761fc64ba7d1ae339769d638d46f46a2ba658eaa9c120da8b8a605848a`
- `lifecode-skill-center/tests/format.test.mjs` — 4504 B — `aa937a42b9111b8d9f8b415eddf20bf8cbecb89b3fd2236495932457892c82d5`
- `lifecode-skill-center/docs/ARQUITECTURA.md` — 6543 B — `6eedb621c136ef2e003112880e5e2a16fe320aaae5c9e74a78fd2355b8888681`
- `lifecode-skill-center/docs/OPERACION.md` — 4089 B — `7e7e2e286effc3529e321d89f76d21290854bbdf4bda0814366c5c275d390681`
- `lifecode-skill-center/docs/README.md` — 693 B — `190ff52d9a8d412cc2e15ab6c3cb22352fe298a1a710e372c6d32411c5047899`

## 6. Lo que NO se commitea

- `*.log`, `node_modules/`, `exports/`, perfiles de navegador/cookies, `_audit/r16-arch/`, `_audit/t43-arch/`, `_audit/asar-index.json`, `_audit/E2E-REPORT.md`, fixtures locales y capturas crudas con rutas personales.
- `skill-compiler/` (otro proyecto del repositorio).
- Los propios `COMMIT-*` no se autoincluyen: se añaden en el commit final de la sección 4.
- Las 16 rutas ya versionadas de la sección 5.

## 7. Verificación final del plan

- Rutas únicas en los `git add --`: 230 de 230 candidatas (sin duplicados, sin rutas no-op).
- 16 rutas ya versionadas quedan fuera del plan (sección 5).
- Muestra de 10 SHA-256: OK.
- Control: 230 candidatas + 1901 excluidas + 14 preexistentes = 2145 (status 2145).
- Estado esperado tras ejecutar todos los commits: árbol limpio salvo artefactos excluidos, que permanecen sin seguimiento.
