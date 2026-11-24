# Release candidate — manifiesto del artefacto (2026-11-23)

**Artefacto:** `designerbyron-lifecode-rag-1.4.0.tgz`
**Ubicación (fuera del árbol auditado):** `%LOCALAPPDATA%\hermes\profiles\byron-saas-corporativo\cache\scratch\rc\`
**Construido con:** `node tools/pack.mjs --out <carpeta>` desde `plugins-dhs-release/lifecode-rag` (rama `feat/ux22-tracking`, HEAD `7d7e839` + 27 ficheros de 1.4.0 sin commitear + UX-2.2).

| Dato | Valor |
|---|---|
| Versión npm (manifiesto) | **`1.4.0`** |
| Versión del contrato PA | **`pa/1.5.0`** (distinta a propósito: la API evoluciona dentro de la misma versión npm) |
| Ficheros | **77** |
| Tamaño | **344 894 B** |
| SHA-256 | `b0667353254c449fd6d5636dfd2d9d22227851bf2966603223e66cd6ef34925e` |
| SHA-512 | `81a48cd7f660fde47023673a627e95b3fd1d9a86679c3421fead7718f7ada586b5cba73205a38a02bc2cdb3b61959b52c2f10e3d3f6208631cdcb65a02df8285` |
| `contract` del empaquetador | `true` |
| Manifiesto empaquetado | sin `scripts` y sin `devDependencies`; `dependencies: {}`, `peerDependencies: {}` |

## Procedencia y correspondencia con el código auditado

- El TAR se construye **desde el árbol de trabajo**, no desde otra copia: los 77 ficheros se compararon uno a uno con `sha256sum` contra `plugins-dhs-release/lifecode-rag`.
- **76 idénticos · 1 distinto · 0 sin fuente.** El único distinto es `package.json`, y la diferencia está verificada: al empaquetado **sólo** le falta la clave `scripts` (comportamiento declarado de `tools/pack.mjs`, que evita publicar seis comandos que no existen en el paquete). Ninguna otra clave cambia.
- **Conclusión:** el TAR corresponde al código revisado y auditado, con el único delta documentado del manifiesto.

## Inventario (77)

`bin/lifecode-rag.mjs` · `client.js` · `cordis.patch.yml` · `icon.svg` · `index.js` · `LICENSE` · `package.json` · `README.md` · 16 documentos de `docs/` (incluye los cuatro contratos con los cambios de UX-2.2) · **65 módulos de `lib/`**, entre ellos los nuevos `lib/tracking.mjs` y `lib/tracking-store.mjs`.

**No contiene:** `tests/`, `tools/`, `demo/`, `eval/`, `plans/`, `_audit/`, `node_modules/` — verificado por el patrón de exclusión del empaquetador y por el listado del TAR.

## Puertas ejecutadas sobre el árbol empaquetado

| Puerta | Resultado |
|---|---|
| Suite completa | **642/642 PASS**, 0 fail, 60 836 ms |
| `test:hermetic` | `✓ el almacén real no cambió (6 ficheros)` — huella `f12e5ac62baa187e…` idéntica antes y después |
| `tools/check.mjs` | verde: 7 herramientas, sin dependencias del host, manifiesto y slots correctos |

## Lo que un instalador debe saber

1. **Provoca una migración de registro: v2 → v3** (tabla `workspace_tracking`). Aditiva e idempotente, pero **irreversible sin intervención**: un binario 1.4.0 no abre un registro v3 (`registry.mjs:181-186`). Requiere respaldo previo del `registry.sqlite3` y procedimiento de vuelta atrás escrito.
2. **Las mutaciones `POST` heredadas exigen ahora CSRF** (`x-lifecode-rag: 1` + JSON); sin ellas responden `403` (`D-IMPL-05-R1`).
3. Sin dependencias de runtime: no toca `node_modules` del perfil más que su propio directorio.

## Pendiente para cerrar el expediente

Instalación en un perfil DSH **aislado** (no el `desktop` del propietario) con respaldo y reversión documentados · validación del panel y de la API contra el Host real · reinicio de la aplicación con el seguimiento activo (criterio 1) · T6 con las siete herramientas en una sesión autenticada · auditoría independiente del artefacto (en curso).
