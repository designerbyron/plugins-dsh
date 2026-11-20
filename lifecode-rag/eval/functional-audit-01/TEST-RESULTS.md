# Resultados de pruebas y cobertura

**Acto:** `HERMES-LCRAG-FUNCTIONAL-AUDIT-01` · **Fase:** E · **Fecha:** 2026-11-19
**Regla:** no se modificó ninguna prueba para esta auditoría; se ejecutaron las existentes y se leyó su
cobertura. No se tocaron suites ajenas ni `_audit`.

---

## 1. Comandos ejecutados en este acto

| # | Comando (cwd `lifecode-rag/`) | Resultado | Duración | Artefacto |
|---|---|---|---|---|
| 1 | `node --test tests/client.test.mjs` | **31/31 pass** | 0,13 s | — |
| 2 | `node --test` | **305/305 pass**, 0 fail, 0 skipped | 26 s | `logs/node-test.txt` |
| 3 | `node tools/check.mjs` | ok (7 herramientas + gates G3) | <1 s | `logs/check.txt` |
| 4 | `node tools/hermetic.mjs` | **305/305 pass** + almacén real sin cambios | 24 s | `logs/hermetic.txt` |

Salida literal de (4):

```
huella previa: 5 fichero(s) 0879533f007ccbf9…
ℹ tests 305
ℹ pass 305
ℹ fail 0
✓ hermético: el almacén real no cambió (5 fichero(s))
```

## 2. Qué cubre la suite (cobertura por clase)

| Clase | Nº aproximado | Qué fija |
|---|---|---|
| Manifiesto / loader | 4 | `exports`, `platform`, id = nombre, sin imports del anfitrión |
| Slots y ciclo de vida | 3 | `inject(slot, cb)`, disposers, locale ausente, estilo único |
| Textos | 3 | 132 claves, paridad ES/EN, interpolación, lectura de idioma |
| Panel y vistas | 7 | aviso, región viva, 10 vistas, navegación, paginación, detalle, búsqueda, contexto, vacío, operaciones (éxito y error), historial, teclado |
| Reducer | 4 | selección, idempotencia, paginación, ingesta, reset |
| Aislamiento | 3 | 0 red/temporizadores, guarda heredada, higiene de fixtures |
| Determinismo | 1 | mismo fixture → mismo texto |

Cifras exactas de la suite completa por fichero: `logs/node-test.txt` (305 pruebas, 38 ficheros de prueba).

## 3. Huecos de cobertura detectados por la auditoría

| # | Hueco | Consecuencia | Defecto relacionado |
|---|---|---|---|
| G-1 | Ninguna prueba comprueba que **todas** las claves usadas existan en el diccionario | `common.yes` y `common.detail` llegan a la UI sin traducir | FA-01, FA-02 |
| G-2 | Ninguna prueba de **validación de consulta vacía** | el botón borra resultados sin avisar | FA-05 |
| G-3 | Ninguna prueba de **URI duplicada** en la ingesta | se añaden duplicados sin aviso | FA-06 |
| G-4 | Ninguna prueba de **maquetación** (sólo atributos) | el formulario de búsqueda roto pasa desapercibido | FA-03 |
| G-5 | Ninguna prueba de **frontera de error** por vista | un throw dejaría el panel en blanco | FA-10 |
| G-6 | Ninguna prueba de la columna `verified` con valor traducido | ídem G-1 | FA-01 |

Estos huecos son la razón por la que los defectos llegaron al host: la suite prueba contrato y estado, no
textos renderizados ni cascada CSS.

## 4. Clasificación de fallos

No hubo fallos en esta ejecución. Los defectos del registro **no** son fallos de la suite: son
comportamientos no cubiertos (ver §3).

## 5. Limitaciones

- No se ejecutó la suite raíz del repositorio (prohibido por el contrato de la casa).
- No hay pruebas contra el host ni contra un navegador real.
- Las 305 pruebas corren con raíces temporales; el hermético demuestra que el almacén real no cambió.
