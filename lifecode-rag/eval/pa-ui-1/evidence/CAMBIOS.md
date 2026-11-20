# Registro de cambios

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fecha:** 2026-11-19

---

## 1. Archivos modificados

| Archivo | Antes (SHA-256) | Después (SHA-256) | Líneas de diff |
|---|---|---|---|
| `docs/PA-UI-0-ACCEPTANCE.md` | `d32a4912…47f9` | `aa7fe635…8de30` | 48 |
| `package.json` | `a6447cae…cf9a` | `e43ff1a7…5804f` | 22 |
| `client.js` | `80c27a54…d5b5` | `b9f37f02…ceab9ef` | 1221 |
| `tests/client.test.mjs` | `bdee5c71…66e2a` | `5d200cc6…9c2302c` | 583 |
| `tools/check.mjs` | `73b0bd1f…79f8` | `9ef00251…dccf4206` | 42 |

Los hashes completos y los diffs unificados están en `HASHES.txt` y `diffs/`.

## 2. Cambio por cambio

### 2.1 `docs/PA-UI-0-ACCEPTANCE.md` (fase 1)

1. Cabecera: `revisión 2` → `revisión 3` (X-R-01; justificación en `G3-AMENDMENT.md` §3).
2. Cabecera: revisiones listadas → `PA-UI-0.1, PA-UI-0.2 y K1 (enmienda de G3)`.
3. Nueva línea de revisión K1: qué cambia y qué **no** cambia (G5/G6/G6b/PA01/D-UI-03 intactos).
4. §L G3: reescrito. `exports["./client"]` es requisito de carga; `dsh.client.inject` es orden de
   activación y sólo se exige si hay dependencia real de slot.
5. §L: nueva subsección «G3 — precisión de la enmienda K1» con la tabla de cinco conceptos (bundle,
   exports, declaración, orden, activación) y la nota de que G3 no acredita el montaje (eso es G4).

Ningún otro criterio, gate ni estado se modificó.

### 2.2 `package.json` (K1-A · G3)

Se añade el mapa `exports` espejo del Skill Center:

```json
"exports": {
  ".": "./index.js",
  "./client": "./client.js",
  "./package.json": "./package.json",
  "./lib/*": "./lib/*.mjs"
}
```

Sin tocar: `files`, `engines`, `dsh.bundle.patch`, `dsh.client.platform`, `dsh.client.immediately`. **No** se
añade `dsh.client.inject` (orden, no requisito de carga).

### 2.3 `client.js` (K1-A + K1-B)

**K1-A:**

- `DATA_MODE = 'fixture'` como constante; la capa heredada `request()` falla cerrada con código
  `fixture-mode` antes de tocar la red.
- Registro de slots con la API vigente: `ctx.slots.inject(SLOT, () => ctx.slots.register(...))` para
  `sidebar.panellist` y `main`. La forma antigua `inject(SLOT)` + `.register` desaparece.
- Locales: diccionarios ES/EN inline (132 claves por idioma) registrados con
  `ctx.effect(() => locale.register('lifecode-rag', PA_DICT))`; la etiqueta de la fila se traduce.
- Estilo: un solo `<style id="lcr-styles">` dentro de `ctx.effect`, con disposer.
- El código heredado del Workspace v0.2 se conserva (no se borró trabajo), pero es inalcanzable: nada lo
  monta y su capa de red está cerrada.

**K1-B:**

- Panel `PaPanel` con 9 pestañas + detalle de fuente (10 vistas): proyecto, bibliotecas, fuentes, detalle,
  búsqueda, contexto, operaciones, diagnóstico, conexión, historial.
- Fixtures deterministas: 121 fuentes sintéticas (ids `src_k1fx_…`), 2 proyectos, 2 bibliotecas, sesión y
  diagnóstico con la forma del contrato `pa-ui/0.1.0-draft`.
- Aviso permanente `SYNTHETIC DATA MODE — NO REAL RAG DATA ACCESS` en una única región `role="status"`.
- Búsqueda con procedencia por ámbito (`prj`/`lib`), contexto con las 9 campos de cita de v0.1.
- Operaciones **simuladas** (ingesta y reindexación) con registro en memoria; no escriben nada.
- Historial: estado «no disponible» con la causa contractual; no se inventa ruta.
- Cero polling y cero temporizadores; navegación por teclado con `role="tablist"` y flechas; CSS responsive
  (720 px), `prefers-reduced-motion` y `forced-colors`.
- Superficie `__test` en el módulo (el anfitrión la ignora) para ejercitar contrato, reducer y vistas sin
  React ni host.

### 2.4 `tests/client.test.mjs`

De 5 pruebas estáticas a **29**: manifiesto, loader, imports, slots, modo fijo, CSS, `apply` con
disposers, locale ausente, paridad de diccionarios, interpolación, lectura de idioma, aviso y región viva,
10 vistas, navegación/paginación/detalle, búsqueda/contexto, estado vacío, operaciones, historial, teclado,
reducer (selección, idempotencia, paginación, ingesta, reset), cero red/temporizadores, guarda heredada y
determinismo.

### 2.5 `tools/check.mjs` (gate G3)

Añade: `exports["./client"]` (cadena o `{default}`), `exports["."]`, `dsh.client.platform === "web"`,
prohibición de `dsh.client.inject`, existencia del bundle, coincidencia del id del loader con el nombre del
paquete y ausencia de la forma obsoleta de slots.

## 3. Archivos creados

- `eval/pa-ui-1/evidence/**` (esta carpeta).
- Nada más. No se creó ningún fichero fuera del alcance.
