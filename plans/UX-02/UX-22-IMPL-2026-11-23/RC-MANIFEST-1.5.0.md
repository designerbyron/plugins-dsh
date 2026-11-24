# Release candidate — manifiesto del artefacto `1.5.0` (2026-11-23)

> **Sustituye a `RC-MANIFEST.md`**, que describía un artefacto nombrado `1.4.0` y quedó **rechazado por la
> auditoría del artefacto**: el `1.4.0` aprobado (`7bbecb09…`, 75 ficheros) es inmutable y este contenido cambia
> el contrato PA (`pa/1.4.0 → pa/1.5.0`) y el registro (v2 → v3). Mismo nombre no puede significar dos cosas.

**Decisión que lo resuelve:** `D-IMPL-11` — el artefacto nuevo es **`1.5.0`**; el `1.4.0` aprobado no se toca.

| Dato | Valor |
|---|---|
| Paquete | `@designerbyron/lifecode-rag` |
| **Versión npm** | **`1.5.0`** |
| **Contrato PA** | **`pa/1.5.0`** |
| **Registro** | **v3** (migración aditiva v2 → v3) |
| Ficheros | **77** |
| Tamaño | **345 090 B** |
| **SHA-256** | `d35aae9fcd08088dc7667d8c22dc4d4bf708613f02ca009e449acdffcb7a4686` |
| **SHA-512** | `fdc56e06b1665b3c832335f5a982cc2138d649a6fa0ac8e69ae8323b7e72b4b44cc439130017e06d6e8265aa6dfd24193fe2461d0c179ef54edd6558d63f51b3` |
| Ubicación | `%LOCALAPPDATA%\hermes\profiles\byron-saas-corporativo\cache\scratch\rc150c\` (fuera del árbol auditado) |
| Construido con | `node tools/pack.mjs --out <carpeta>` desde la rama `feat/ux22-tracking` |

## Correcciones respecto al artefacto rechazado

| Hallazgo | Corrección |
|---|---|
| **B1** colisión de identidad con el 1.4.0 aprobado | Versión → **1.5.0** (`package.json`), coherente con `pa/1.5.0` y registro v3 |
| **M1** README anunciaba `pa/1.4.0` e instalaba `@1.0.0` | `README.md`: versión 1.5.0, `pa/1.5.0` y `npm install …@1.5.0` |
| **M3** ejemplo de `/workspaces` con `pa/1.4.0` | Actualizado a `pa/1.5.0` (es la versión que sirve el handler) |
| **M2** `CONTRATO-EXTENSIONES-1.4.md` parecía un borrador vigente | Nota de vigencia al inicio: describe las extensiones de 1.4, **sin retirar ni cambiar nada** en 1.5.0 |
| **M5** faltaba SHA-512 | Medido y publicado arriba |
| **B2** (2.ª re-auditoría) el README pineaba `1.0.0` en el `package.json` del perfil, 12 líneas después del `npm install @1.5.0` | Corregido a `1.5.0`; además la cifra de la suite (563 → **642**) y el aviso de que `npm test`/`npm run check` **no viajan** en el paquete |
| **M6** DATA-CONTRACT hablaba del «binario 1.4.0» | Ahora dice «un binario anterior (1.3.0 publicado, o el 1.4.0 aprobado)» |
| **E1** (3.ª auditoría, erratas no bloqueantes) al corregir el pin desapareció la coma del bloque JSON del README | Repuesta; el bloque **parsea** (`JSON.parse` medido) y el artefacto se reempaquetó. Artefacto definitivo |

## Puertas sobre el árbol que produjo este TAR

| Puerta | Resultado |
|---|---|
| Suite completa | **642/642 PASS**, 0 fail |
| `test:hermetic` | `✓ el almacén real no cambió (6 ficheros)` |
| `tools/check.mjs` | verde (7 herramientas, sin dependencias del host) |
| Inventario | 77 entradas; sin `tests/`, `tools/`, `demo/`, `eval/`, `plans/`, `node_modules/` |
| Manifiesto | sin `scripts` ni `devDependencies`; `dependencies`/`peerDependencies` ausentes |

## Lo que un instalador debe saber

1. **Migra el registro del perfil v2 → v3** al primer arranque (`workspace_tracking` + 2 índices, `IF NOT EXISTS`, sin `ALTER`/`DROP`). **Respaldo previo obligatorio**: un binario 1.4.0 no abre un registro v3.
2. **La API del panel pasa a `pa/1.5.0`**: panel y consumidores con el mismo build.
3. **Las mutaciones `POST` heredadas exigen CSRF** (`x-lifecode-rag: 1` + JSON); sin ello, `403`.
4. **Las siete herramientas `lifecode_rag_*` no cambian** (contrato v0.1 congelado).
5. Sin dependencias de runtime; Node ≥ 22.5.

## Pendiente para cerrar el expediente

Instalación en un perfil DSH aislado con respaldo y reversión · validación del panel y la API contra el Host real · reinicio con el seguimiento activo (criterio 1) · T6 en sesión autenticada · **re-auditoría del artefacto 1.5.0** (en curso).
