# Empaquetado local — LifeCode RAG 1.4.0-draft

**Mandato:** «HANDOFF T1 — Empaquetado local LifeCode RAG 1.4.0-draft» + auditoría independiente del artefacto
(2026-11-23) que detectó una inconsistencia de empaquetado.
**Alcance ejecutado:** metadatos + empaquetado local + corrección de la inconsistencia. **Sin** publicación, **sin**
instalación, **sin** tocar el Host.

| Artefacto | SHA-256 | Estado |
|---|---|---|
| `artifact/designerbyron-lifecode-rag-1.4.0.tgz` | **`7bbecb09482dcc36290956a7623b2247414c99fc42cc1b58caf22ce8dbca132b`** | **definitivo** |
| `artifact/superseded/…-manifiesto-v1.tgz` | `3fd6d2f93ef70969e7a9799834c07327aaee42c2bb659e7540f45a5629eb330d` | sustituido (conservado para auditoría) |

`UX-22-PACKAGE-1.4.0-2026-11-23.zip` (322 884 B, 11:47) es el paquete de auditoría preparado por el propietario:
contiene el artefacto **sustituido** v1 y **se conserva intacto**, sin tocar.

---

## 1. Estado Git

| | Antes del acto | Después |
|---|---|---|
| Rama / HEAD | `release/lifecode-rag-1.0.0` / `7d7e839d514cca27044d595218bf8c67ec5a1f7d` | **idénticos** |
| Índice | vacío | **vacío** |
| `git status` | 52 (27 M / 25 ??) | **54 (27 M / 27 ??)** |

Las dos entradas nuevas son **sólo** de este acto: `?? lifecode-rag/tools/pack.mjs` y
`?? lifecode-rag/docs/EMPAQUETADO.md`. Ningún `M` cambió de conjunto; `package.json` y `README.md` siguen siendo los
mismos dos ficheros ya modificados (UX-2.1 + este acto). Los cambios preexistentes no se tocaron: las ocho huellas
de código siguen siendo las revisadas (`1078b1ef…`, `f48aa9e1…`, `a1bc3537…`, `8922d85e…`, `339bf7bf…`,
`ad81a32d…`, `841e4556…`, `cc834453…`).

## 2. La inconsistencia detectada y su diagnóstico

`package.json` declaraba siete comandos cuyos destinos **no viajan en el paquete** (`files` excluye `tests/`,
`tools/` y `demo/`):

| Comando | Destino | En el paquete |
|---|---|---|
| `test` | `node --test --test-concurrency=1` (descubre `tests/`) | **no falla: miente** — medido en un directorio sin pruebas: `exit 0`, `tests 0` |
| `test:hermetic` | `tools/hermetic.mjs` | ausente |
| `check` | `tools/check.mjs` | ausente |
| `bench` | `tools/benchmark.mjs` | ausente |
| `bench:harness` | `tools/harness.mjs` | ausente |
| `demo` | `demo/server.mjs` | ausente |
| `screenshots` | `tools/screenshots.mjs` | ausente |

El caso peor es `test`: no rompe, **da por bueno un cero**.

## 3. Decisión

Se empaqueta un **manifiesto derivado**: el del repositorio **sin `scripts`** (y sin `devDependencies`, si algún día
existen). El repositorio conserva todos sus comandos; el paquete no anuncia ninguno que no pueda ejecutar.

| Alternativa | Por qué se descartó |
|---|---|
| Incluir `tools/` y `demo/` en `files` | Mete herramienta de desarrollo en producción y **no arregla el problema**: `tests/` sigue fuera, así que `test` seguiría verde sin probar nada |
| `prepack`/`postpack` que recortan y restauran el `package.json` del repositorio | Muta el árbol de trabajo en cada empaquetado; una muerte del proceso entre ambos pasos deja el manifiesto recortado. Inaceptable con 27 ficheros modificados sin commitear |
| Sacar los comandos de `package.json` | npm sólo lee `scripts` de ahí: se perdería `npm test` en el repositorio |

**Implementación:** `tools/pack.mjs` (herramienta de desarrollo, **no** se publica) y el comando
`npm run pack:dist -- --out <carpeta>`. El script empaca con `npm pack`, extrae, deriva el manifiesto y vuelve a
empacar — **nunca escribe en el árbol de trabajo** — y verifica el resultado antes de entregarlo. Documentado en
`docs/EMPAQUETADO.md` (tampoco se publica).

## 4. Comandos ejecutados

```sh
npm run check                                            # exit 0 (repositorio, comandos intactos)
npm test                                                 # 563/563 (repositorio, comandos intactos)
node tools/pack.mjs --out "<artifact>"                   # x2, determinismo
npm run pack:dist --silent -- --out "<temporal>"         # el comando documentado, x1
tar --force-local -tzf/-xzf ...                          # inventario y comparación byte a byte
node smoke.mjs <extracción>                              # importación del paquete real
npm pack --dry-run --json                                # referencia: el pack plano del repo (sin derivar)
```

Nada de `npm publish`, `npm install`, ni comandos sobre el perfil o el Host.

## 5. Identidad del artefacto definitivo

| Dato | Valor |
|---|---|
| Nombre | `@designerbyron/lifecode-rag` |
| Versión | **`1.4.0`** |
| Fichero | **`designerbyron-lifecode-rag-1.4.0.tgz`** |
| Tamaño | **317 530 B** (310,1 KiB) · descomprimido 1 097 503 B |
| SHA-256 | **`7bbecb09482dcc36290956a7623b2247414c99fc42cc1b58caf22ce8dbca132b`** |
| SHA-512 | `sha512-mojAqRJhh6Hy+MLKNTK9VT+Je3VPtdZl7/vxvahQmPoIo6mzJMO2Wuaaj0TqgvYzfFPN9loR5l8RBM/PTsloBQ==` |
| SHA-1 (`shasum`) | `9261d2f50a994b0fb2f4d896a5f58d5fcc54a401` |

Frente al artefacto sustituido: **174 B menos**, exactamente el bloque `scripts` retirado (npm declara 317 704 B para
el empaquetado plano del repositorio). El contenido fuera del manifiesto es idéntico.

## 6. Inventario (75 ficheros, igual que el artefacto auditado)

`7` en la raíz (`index.js`, `client.js`, `package.json`, `cordis.patch.yml`, `icon.svg`, `README.md`, `LICENSE`) ·
**`53` en `lib/`** · `1` en `bin/` · **`14` en `docs/`**, con **`docs/CONTRATO-EXTENSIONES-1.4.md`** dentro.
Excluidos: `tests/`, `tools/`, `demo/`, `bench/`, `eval/`, `plans/`, `_audit/`, `node_modules/`. Cero `.sqlite3`,
`.log`, `.tmp`, `.bak`, `.wal`, `.shm`, `.tgz`.

## 7. Verificaciones

| Comprobación | Resultado |
|---|---|
| Conjunto de ficheros vs artefacto auditado | **idéntico** (75/75, `diff` de inventarios ordenados sin diferencias) |
| Contenido vs árbol de trabajo | **74/74 byte a byte idénticos**; el único distinto es `package.json`, y lo es a propósito |
| Manifiesto publicado | falta **sólo** `scripts`; ninguna otra clave cambia (`name`, `version`, `type`, `main`, `exports`, `dsh`, `engines`, `files`, `icon`, `publishConfig` verificadas una a una) |
| `docs/CONTRATO-EXTENSIONES-1.4.md` | presente |
| Importación desde el `.tgz` extraído | `lib/tools.mjs` → 7 herramientas · `index.js` → importa sin dependencias externas · `bin/lifecode-rag.mjs` → sintaxis válida · `client.js` → **no importable en Node por diseño** (`window.__ModuleLoader__`) |
| Determinismo | **3 empaquetados** (2 directos + `npm run pack:dist`) → mismo SHA-256 |
| Autoverificación del script | falla si entra un artefacto de desarrollo, si un fichero difiere del árbol, si el manifiesto cambia una clave ajena o si falta el contrato |
| Repositorio intacto | `npm run check` exit 0 · `npm test` **563/563** con `pack:dist` añadido |
| Esquema / registro / API | sin cambios: v3, v2, `pa/1.4.0` |

## 8. Sin publicación ni instalación

`npm publish` **no ejecutado** · instalación global o en el perfil **no ejecutada** · `cordis.patch.yml`, roots,
grants y bases reales **intactos** · sin commit, merge, rebase, push, reset, clean ni stash.

## 9. Incidencia propia del acto anterior (declarada)

Un `mkdir -p ../../plans/…` desde `lifecode-rag/` resolvió a `C:\xampp\htdocs\plans` (fuera de los dos worktrees) y
ahí fue a parar el `baseline-test.log` citado por el informe de implementación. Detectado por el `ENOENT` del
`npm pack`: el log se **movió** a `plans/UX-02/UX-22-IMPL-OPTIMIZATION-2026-11-23/` y el árbol ajeno se **eliminó**
tras comprobar que no contenía nada más. El otro worktree (`plugins-dhs`, `655f037`, 1234 sucias) no se tocó.

**Discrepancia declarada:** la cabecera del mandato autoriza `@…@1.4.0-draft`; §2 ordena «actualiza la versión a
`1.4.0`». Se siguió §2: el paquete lleva `1.4.0` y «draft» describe el estado (local, sin publicar).

## 10. Dictamen

**Paquete generado y verificado.** El artefacto definitivo es íntegro, determinista, coherente con la implementación
aprobada, y su manifiesto **no anuncia ningún comando que no pueda ejecutarse dentro del paquete**. Los comandos de
desarrollo siguen funcionando en el repositorio y no viaja ninguna herramienta de desarrollo en producción.

**Ruta exacta:**
`C:\xampp\htdocs\plugins-dhs-release\plans\UX-02\UX-22-PACKAGE-1.4.0-2026-11-23\artifact\designerbyron-lifecode-rag-1.4.0.tgz`

No se avanza a instalación ni a preparación de cambios en el perfil DSH.
