# 05 — K1 · Matriz de pruebas y aceptación

**Clase:** `TESTING` · **Aplica a:** K1-A, K1-B y, sólo como criterios, K1-C
**Regla:** ningún criterio se declara cumplido sin evidencia ejecutada y archivada. Un criterio no
ejecutado se reporta como **NO PROBADO**, nunca como PASS.
**En K1 no se ejecutó ninguna prueba** (autorización documental; árbol en uso). Todo lo de este documento
es la especificación de lo que habrá que ejecutar.

---

## 1. Capas de prueba

| Capa | Qué prueba | Dónde corre | Quién la puede cerrar |
|---|---|---|---|
| L0 estática | manifiesto, loader, forma de los slots, locales, ausencia de imports del host | `tests/client.test.mjs`, `tools/check.mjs` | K1-A |
| L1 unitaria | modelo puro de presentación (paginación, recorte, mapeo de errores) | `node --test` en `lifecode-rag/` | K1-B |
| L2 con fixtures | vistas, estados, navegación, procedencia | cliente en modo fixture | K1-B |
| L3 en el anfitrión | montaje, desmontaje, reinicio, visibilidad de panel | DSH 0.2.2-rc.5 real | K1-A |
| L4 seguridad | identidad, auditoría, aislamiento | API real | **K1-C** |

L4 no se puede adelantar: sin API no hay nada que atacar; con fixtures, atacar sería teatro.

---

## 2. K1-A · criterios de cliente (L0 + L3)

| Id | Criterio | Comprobación | Evidencia | Estado en K1 |
|---|---|---|---|---|
| CL-01 | `id` del loader = `package.json.name` | lectura comparada en `client.test.mjs` | salida del test | NO PROBADO |
| CL-02 | cero imports de `@deepseek-ai/*` | regex en cliente y en `lib/` | salida | NO PROBADO |
| CL-03 | slots con `inject(key, cb)` y `register` dentro | aserto de forma + aserto negativo de la forma antigua | salida | NO PROBADO |
| CL-04 | paridad de claves ES/EN, sin valores vacíos | comparación de diccionarios | salida | NO PROBADO |
| CL-05 | modo fixture no llama a `fetch` | contador/espía inyectado | salida | NO PROBADO |
| CL-06 | sin `setInterval` ni `document.body` en K1-A | regex | salida | NO PROBADO |
| CL-07 | `main.key === sidebar.id === PANEL_ID` | aserto | salida | NO PROBADO |
| CL-08 | `exports` correcto | `tools/check.mjs` | salida | NO PROBADO |
| CL-09 | el bundle se compone y se sirve | `__DSH_BOOT__.entries` con la fila | JSON + hora | NO PROBADO |
| CL-10 | la fila aparece en `sidebar.panellist` (barra desplegada) | captura + conteo DOM | PNG | NO PROBADO |
| CL-11 | la vista monta en `main` y desmonta | `.lcr-root` 1 → 0; `#lcr-styles` 1 | conteo antes/después | NO PROBADO |
| CL-12 | consola sin `TypeError` ni `slot entry crashed` | captura de consola | texto | NO PROBADO |
| CL-13 | tras reiniciar, la fila y la vista siguen | misma evidencia con hora posterior | JSON + PNG | NO PROBADO |
| CL-14 | las siete herramientas siguen registradas | `tools/check.mjs` + listado del host | salida | NO PROBADO |

Prueba negativa obligatoria: retirar `exports['./client']` en una copia desechable debe reproducir el
error del compositor. Demuestra que la causa diagnosticada es la real.

---

## 3. K1-B · criterios de interfaz (L1 + L2)

| Id | Criterio | Comprobación | Estado |
|---|---|---|---|
| UI-01 | Navegación entre las diez vistas | clic por pestaña; `.lcr-view-<n>` presente | NO PROBADO |
| UI-02 | Estado de carga | esqueleto con forma; sin spinner global | NO PROBADO |
| UI-03 | Estado vacío | texto de qué falta + acción; sin `0` inventado | NO PROBADO |
| UI-04 | Estado de error | código + mensaje seguro + reintentar; último dato bueno conservado | NO PROBADO |
| UI-05 | Estado degradado / datos parciales | banda con instante de última lectura | NO PROBADO |
| UI-06 | Paginación de fuentes | `total` 121, `offset` 100 → 21 filas | NO PROBADO |
| UI-07 | Procedencia | dos ámbitos con la misma `uri` → dos filas distinguibles | NO PROBADO |
| UI-08 | Selección con `409` | conflicto mostrado, sin reintento automático | NO PROBADO |
| UI-09 | Contexto | `text`, `tokens` (estimación), `truncated`, citas `[n]`, fail-closed si almacén roto | NO PROBADO |
| UI-10 | Limitaciones visibles | GAP-05/06/07/09/10 con frase propia en su vista | NO PROBADO |
| UI-11 | V10 no disponible | estado con causa, sin tabla vacía | NO PROBADO |
| UI-12 | Accesibilidad | teclado, `role="tablist"`, `aria-selected`, una sola `role="status"`, `aria-describedby` | NO PROBADO |
| UI-13 | Higiene de fixtures | escaneo contra patrones prohibidos | NO PROBADO |
| UI-14 | Responsive 390 px | sin desbordamiento horizontal; id largo se parte | NO PROBADO |
| UI-15 | Cero red en modo fixture | ninguna petición; `request()` lanza antes de `fetch` | NO PROBADO |

### Higiene de fixtures (UI-13) — patrones que hacen fallar

```
[A-Za-z]:\\Users        /home/            \.dsh
\.credentials           AUTH_RECORD_KEY   eyJ            sk-
^prj_[0-9A-HJKMNP-TV-Z]{26}$              ^lib_[0-9A-HJKMNP-TV-Z]{26}$
^src_[0-9A-HJKMNP-TV-Z]{26}$
```

Los ids sintéticos usan `prj_k1fx_…`, `lib_k1fx_…`, `src_k1fx_…`: deliberadamente **no** ULID, para que un
id real pegado por error se detecte solo.

---

## 4. Correspondencia con `PA-UI-0-ACCEPTANCE.md`

La aceptación existente (A…N) se escribió para PA-UI-1, no para K1. Esta tabla dice qué es alcanzable y
qué no, sin cambiar el estado de nada.

| Bloque | Criterios | ¿Alcanzable en K1? | Motivo |
|---|---|---|---|
| A · Contrato | A-01, A-02, A-05, A-06 | **Parcial**: A-01/A-05 sí (manifiesto y herramientas), A-02 sí (hash del contrato), A-03/A-04 no (rutas) | A-03/A-04 requieren API |
| B · Identidad | B-01…B-08d | **No** | Requiere API y G5/G6 |
| C · Selección | C-01…C-14 | **No** | Requiere API; C-12 exige GAP-09 implementado |
| D · Bibliotecas | D-01…D-09 | **No** | Requiere registro real |
| E · Fuentes | E-01…E-07 | **No** | Requiere almacén |
| F · Búsqueda/contexto | F-01…F-10 | **No** | Requiere motor |
| G · Errores/diagnóstico | G-01…G-06 | **Parcial** (forma de los mensajes, con fixtures) | Sin API no hay códigos reales |
| H · Seguridad operativa | H-01…H-13 | **No** | H-09…H-13 son `SECURITY` y dependen de G6b |
| I · Aislamiento | I-01…I-08 | **No** | Requiere almacenes |
| J · Rendimiento | J-01…J-05 | **No** | Cifras `[PROPUESTA]`, no medidas |
| K · No regresión | K-01…K-06 | **Sí** (K-01, K-02, K-03, K-06; K-04 y K-05 existen en `eval/pa0` y `eval/pa1`) | Debe correr en cada etapa |
| L · Gates | G1…G8 | **K1-A cierra G3/G4**; el resto no | G5/G6/G6b/G7 son de K1-C |
| M · Evidencia | carpeta y formato | Se adopta; `eval/pa-ui-1/` **no existe** todavía | Se crea en el acto autorizado |
| N · No verificables | 5 filas | **No** | Siguen bloqueadas por diseño |

**Consecuencia honesta:** K1 puede dejar K1-A y K1-B en verde y, aun así, la aceptación PA-UI-1 seguirá
`BLOCKED` en B, C, D, E, F, H e I. Eso no es un defecto de K1: es la separación que la tarea pidió.

---

## 5. Evidencias y formato

| Artefacto | Contenido | Etapa |
|---|---|---|
| `hashes-before.txt` / `hashes-after.txt` | `sha256sum` de los ficheros tocados | A, B |
| `manifest-gate.txt` | salida de `node tools/check.mjs` | A |
| `boot-graph.json` | `window.__DSH_BOOT__.entries` (filtrado a la fila del plugin) | A |
| `mount-unmount.txt` | conteos DOM antes/después de cambiar de panel | A |
| `console.txt` | consola del renderer, sin `TypeError` | A |
| `restart.txt` | misma evidencia tras reinicio, con hora | A |
| `node-test.txt` | suite completa | A, B |
| `hermetic.txt` | huella del almacén real antes/después | A, B |
| `views-matrix.md` | una fila por vista: ruta, estado, limitación | B |
| `fixtures-scan.txt` | escaneo de higiene | B |
| `a11y.txt` | roles, foco, región viva | B |
| `screens/` | capturas por vista y 390 px | B |

Carpeta propuesta: `eval/pa-ui-1/evidence/` (hoy inexistente; su creación pertenece al acto autorizado).

## 6. Aserciones deterministas en el anfitrión

Contar tarjetas a ojo no es prueba. Para K1-A:

```js
// 1. el bundle está en el grafo y se sirvió
__DSH_BOOT__.entries.filter(e => e.id === '@local/lifecode-rag')
// 2. el panel está montado exactamente una vez
document.querySelectorAll('.lcr-root').length        // === 1
// 3. el estilo no se duplica
document.querySelectorAll('#lcr-styles').length      // === 1
// 4. tras cambiar de panel
document.querySelectorAll('.lcr-root').length        // === 0
```

Y la lectura de la sesión de pruebas debe cruzar DOM + consola + grafo, no una sola captura.

## 7. Lo que no se ejecutó en K1 (declarado)

- `node --test` (38 ficheros), `tools/check.mjs`, `tools/hermetic.mjs`: **no ejecutados**.
- Suite raíz del repositorio: **prohibida** (dispara `_audit/*-test.mjs`).
- Ninguna prueba sobre el perfil real, el registro (212 992 B) ni el almacén (3,8 MB).
- Ninguna prueba de red, de puertos o de topología.

## 8. Condiciones de parada

- Una prueba sólo pasa usando el almacén real o el legado.
- Un criterio exige cambiar el contrato para poder medirse.
- El árbol cambia durante la prueba (evidencia por hash antes y después).
- Se necesita reiniciar o instalar sin autorización.
- Alguien pide marcar PASS un criterio `NO PROBADO`.

---

**Estado final esperado:** matriz completa, con `NO PROBADO` donde no se ejecutó y sin promedios que
diluyan los bloqueos.
