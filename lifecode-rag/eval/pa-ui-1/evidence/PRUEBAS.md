# Resultados de pruebas

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fecha:** 2026-11-19
**Entorno:** Windows 11 · Node `v24.21.0` (según `node --version` del shell) · plugin `lifecode-rag/` en
`C:\xampp\htdocs\plugins-dhs` · host **no reiniciado**.

---

## 1. Comandos ejecutados y resultado

| # | Comando (cwd `lifecode-rag/`) | Resultado | Duración | Artefacto |
|---|---|---|---|---|
| 1 | `node --test tests/client.test.mjs` (antes de los cambios) | **5/5 pass** (línea base del fichero) | ~0,1 s | — |
| 2 | `node tools/check.mjs` (antes) | ok, 7 herramientas | <1 s | — |
| 3 | `node --test tests/client.test.mjs` (después) | **31/31 pass** | ~0,16 s | — |
| 4 | `node --test` (suite completa) | **305/305 pass**, 0 fail, 0 skipped | 26 s | `node-test.txt` |
| 5 | `node tools/check.mjs` | ok (incluye gates G3) | <1 s | `check.txt` |
| 6 | `node tools/hermetic.mjs` | **305/305 pass** + almacén real sin cambios | 30 s | `hermetic.txt` |

## 2. Salida literal (extracto)

```
ℹ tests 305
ℹ pass 305
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

```
✓ 7 herramientas, sin dependencias de @deepseek-ai/*, manifiesto y parche correctos (G3: exports["./client"] resoluble, cliente con la API de slots vigente)
```

```
almacén vivo: C:\Users\<USER>\.dsh\lifecode-rag
huella previa: 5 fichero(s) 0879533f007ccbf9…
✓ hermético: el almacén real no cambió (5 fichero(s))
```

## 3. Qué cubre la suite del cliente (31 pruebas)

- **Manifiesto y loader:** `exports`, `platform`, `bundle.patch`, ausencia de `inject`, id = nombre.
- **Contrato del módulo:** sin imports del anfitrión, slots con `inject(slot, cb)`, sin la forma obsoleta,
  `apply` con locales y disposers, `apply` sin servicio de locale.
- **Textos:** 132 claves por idioma, paridad, interpolación, lectura de idioma con snapshot/`getLocale`.
- **Panel:** aviso sintético, una sola región viva, 9 pestañas, `tabpanel`, `aria-selected` único.
- **Vistas:** las 10 renderizan; navegación, paginación, detalle y vuelta; búsqueda/procedencia/contexto;
  estado vacío; operaciones simuladas (éxito y error); historial no disponible; teclado.
- **Reducer:** selección con revisión, idempotencia, paginación acotada, ingesta, reset.
- **Seguridad sintética:** 0 `fetch` y 0 temporizadores en todo el recorrido; guarda `fixture-mode`;
  higiene de fixtures; determinismo.

## 4. Límites declarados

1. **No se ejecutó la suite completa antes de los cambios.** Se ejecutó después (305/305). Los otros 37
   ficheros de prueba no se modificaron; su verde es el estado actual, no una comparación contra una línea
   base que no se tomó. La única línea base medida es la del fichero tocado (5/5 antes, 31/31 después).
2. **No hay `VERIFIED HOST`:** el host no se reinició. La composición del bundle y el montaje de la fila
   siguen sin probar en el anfitrión.
3. **`node --test` desde la raíz del repositorio no se ejecutó** (dispara suites ajenas, prohibido por el
   contrato de la casa). Todo se ejecutó dentro de `lifecode-rag/`.
4. **Sin navegador real:** el CSS responsive y los estados visuales están asegurados por aserción
   estructural, no por medición de layout.
5. **Sin lector de pantalla:** la accesibilidad es estructural (roles/aria/teclado), no auditada con AT.

## 5. Reproducibilidad

```sh
cd C:/xampp/htdocs/plugins-dhs/lifecode-rag
node --test tests/client.test.mjs   # 31/31
node --test                          # 305/305
node tools/check.mjs                 # ok
node tools/hermetic.mjs              # 305/305 + huella intacta
```

Los artefactos `node-test.txt`, `check.txt` y `hermetic.txt` son la salida cruda de esas ejecuciones en
este acto.
