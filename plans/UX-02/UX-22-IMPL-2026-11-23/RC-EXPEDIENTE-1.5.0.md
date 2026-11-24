# Expediente de Release Candidate — LifeCode RAG 1.5.0 (UX-2.2)

**Fecha:** 2026-11-23 · **Rama:** `feat/ux22-tracking` (HEAD `7d7e839` + 27 ficheros de 1.4.0 del propietario, sin commitear) · **Estado:** artefacto **APTO**, instalación aislada pendiente

## 1. Artefacto

| Dato | Valor |
|---|---|
| Fichero | `designerbyron-lifecode-rag-1.5.0.tgz` |
| Versión npm | **1.5.0** (contrato PA **`pa/1.5.0`**, registro **v3**) |
| Tamaño · entradas | **345 090 B** · **77** |
| **SHA-256** | `d35aae9fcd08088dc7667d8c22dc4d4bf708613f02ca009e449acdffcb7a4686` |
| **SHA-512** | `fdc56e06b1665b3c832335f5a982cc2138d649a6fa0ac8e69ae8323b7e72b4b44cc439130017e06d6e8265aa6dfd24193fe2461d0c179ef54edd6558d63f51b3` |
| Procedencia | `node tools/pack.mjs` desde el árbol de trabajo auditado |
| Correspondencia | **76/77 byte a byte idénticos**; el 77.º es `package.json`, distinto sólo por la ausencia de `scripts` |
| Composición | 7 ficheros de raíz · 55 en `lib/` · 14 en `docs/` · 1 en `bin/` · sin `tests/`, `tools/`, `demo/`, `eval/`, `plans/`, `node_modules/` |

## 2. Dictamen del artefacto: **APTO** (cuarta iteración, sin bloqueantes)

| Ronda | Dictamen | Causa |
|---|---|---|
| 1 | NO APTO | El contenido se llamaba `1.4.0` cuando el 1.4.0 aprobado (`7bbecb09…`) es inmutable, y cambiaba contrato PA y registro |
| 2 | NO APTO | README pineaba `1.0.0` en el `package.json` del perfil |
| 3 | APTO | Corregido el pin; quedó una errata no bloqueante (coma del bloque JSON) |
| 4 | **APTO** | Coma repuesta; delta verificado v3→v4 = **sólo `README.md`, +1 byte** |

## 3. Puertas sobre el código empaquetado

Suite **642/642 PASS**, 0 fail · `test:hermetic` → `✓ el almacén real no cambió (6 ficheros)` · `tools/check.mjs` verde · 58 módulos con sintaxis válida y **292 especificadores, 0 sin resolver, 0 bare specifiers** · núcleo importable sin `node_modules` · `smoke` en sandbox: registro v3 con 13 tablas, `GET /pa/workspaces` → 200 `pa/1.5.0`, mutaciones cerradas con `503 authorization-unavailable` sin compuerta.

## 4. Procedimiento de instalación (perfil aislado)

**Nunca sobre `<DSH_HOME>\profiles\desktop`.**

1. **Respaldo previo**, con verificación de restauración: `registry.sqlite3` + `rag.sqlite3` de cada scope + `config.json` + `package.json` del perfil, copiados a `~\.dsh\backups\rc-1.5.0-<stamp>\`, y `sha256sum` de origen y copia comparados.
2. **Perfil aislado**: `DSH_HOME` propio (`<lab>/home`) con su `profiles\<nombre>\package.json` que declare `@designerbyron/lifecode-rag` → `file:<ruta>\designerbyron-lifecode-rag-1.5.0.tgz` y `dsh.profile.bundles: ["lifecode-rag"]`; `--user-data-dir` propio en Electron. **Sin reutilizar** roots ni grants del perfil real.
3. **Verificación de identidad antes de instalar**: `sha256sum` del TAR = `d35aae9f…`. Si no coincide, **detener**.
4. **Primer arranque**: el registro del perfil aislado sube v2 → v3 (aditivo, `IF NOT EXISTS`, sin `ALTER`/`DROP`, idempotente).
5. **Comprobación**: `node bin/lifecode-rag.mjs doctor` con `DSH_HOME` redirigido; `GET /pa/tracking` debe responder `{items, counts, asOf, version, truncated}`.

## 5. Actualización y reversión

- **Actualización**: sustituir el TAR y reinstalar; el registro v3 no se toca (`IF NOT EXISTS`).
- **Reversión** (registro ya en v3): restaurar el respaldo del paso 1, **o** fijar `user_version=2` y `meta.registry_version=2` y eliminar la tabla `workspace_tracking`. Sin ese paso, un binario anterior **no abre** el registro (`store-version-unsupported`).
- **Reversión de la instalación**: devolver el `package.json` del perfil a `1.4.0`/`1.3.0` y reinstalar; los almacenes de scope no cambian.

## 6. Limitaciones conocidas (L1-L9)

Eje B sólo escribe `ok` · el seguimiento es decisión permanente del humano · `paused` bloquea el `cwd` · dos seguidos del mismo proyecto → el primero · `realpath` dependiente del junction · `/pa/tracking` sin paginación (tope 200) · mutaciones sin `principal` · `forget` devuelve `chunks` (aditivo) · las 7 mutaciones `POST` heredadas exigen CSRF (`403` sin cabecera). Detalle en `ACEPTACION-UX22-R2.md`.

## 7. Pendiente (no se declara cumplido)

| # | Qué | Quién |
|---|---|---|
| 1 | Instalación en el perfil aislado con respaldo verificado | agente (con tu OK del acto) |
| 2 | Panel real: estados, filtros, mensajes de CAS | requiere Host + sesión |
| 3 | API real: 400/403/404/409/503 contra el Host | requiere Host + sesión |
| 4 | **Reinicio con el seguimiento activo** (criterio 1) | requiere tu sesión |
| 5 | **T6**: las siete herramientas RAG en sesión autenticada | requiere tu sesión |

Con 4 y 5 cerrados, UX-2.2 pasa de 14/17 con evidencia a 17/17, y T6 de `PARCIAL` a `CERRADO`.
