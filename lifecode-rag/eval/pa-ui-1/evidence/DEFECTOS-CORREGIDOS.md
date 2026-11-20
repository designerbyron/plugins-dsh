# Defectos corregidos y defectos que quedan

**Acto:** `HERMES-LCRAG-K1-END-TO-END-01` · **Fecha:** 2026-11-19

---

## 1. Corregidos en este acto

| # | Defecto (medido en K1 planning) | Causa | Corrección | Cómo se comprueba |
|---|---|---|---|---|
| D-1 | El bundle del cliente no se podía servir: `package.json` declaraba `dsh.client` sin `exports["./client"]` | manifiesto incompleto | mapa `exports` (`.`, `./client`, `./package.json`, `./lib/*`) | `check.mjs` (G3) + prueba de manifiesto |
| D-2 | El registro de slots usaba `ctx.slots.inject(SLOT)` + `.register`, API que ya no existe | código contra un contrato anterior | `ctx.slots.inject(SLOT, () => ctx.slots.register(...))` en los dos slots | pruebas estática y de `apply`; gate que prohíbe la forma vieja |
| D-3 | `TypeError` determinista al aplicar el cliente (`sidebar.register is not a function`) | consecuencia de D-2 | eliminado por construcción: ya no se llama `.register` sobre el retorno de `inject` | prueba de `apply` (el callback devuelve el disposer) |
| D-4 | Dos filas declaraban `locale: 'lifecode-rag'` sin diccionario registrado | faltaba el registro | 132 claves ES/EN inline + `locale.register` dentro de `ctx.effect` con disposer | paridad de claves + prueba de `apply` |
| D-5 | El panel sondeaba cada 30 s mirando sólo `document.visibilityState`, contra `WORKSPACE-UX` §5.1 | ciclo de vida heredado | el panel nuevo **no tiene temporizadores**; el heredado queda inalcanzable y su capa de red cerrada | espías: 0 `setInterval`/`setTimeout` en todo el recorrido |
| D-6 | La capa de red servía la API heredada v0.2 como si fuera la del panel | diseño anterior a Project-Aware | guarda `fixture-mode` antes de construir la petición | prueba de rechazo con `fetch` en 0 |
| D-7 | No había ninguna vista Project-Aware: sólo el workspace del almacén v0.2 | faltaba K1-B | 10 vistas sobre fixtures, con procedencia, estados y limitaciones visibles | 15 pruebas de panel/vistas/reducer |

## 2. Conservados a propósito (no son regresiones)

| Elemento | Por qué se conserva |
|---|---|
| Código del Workspace v0.2 en `client.js` | no se borra trabajo preexistente; queda inalcanzable y con la red cerrada. Q-05 (coexistencia) se implementará en modo `live`, que **no** está habilitado |
| Mensaje `panel-unavailable` para perfiles con almacén legado | sigue siendo útil cuando exista modo `live`; hoy no se ejecuta |
| `dsh.client.immediately: true` | precarga de la fila; no es un requisito de carga pero tampoco estorba |

## 3. Defectos conocidos que **no** se corrigen aquí

| # | Defecto | Por qué no |
|---|---|---|
| N-1 | El panel no se ha visto montado en el host | exige reiniciar (prohibido) |
| N-2 | `GAP-09`: la selección no protege contra dos pestañas | es backend (`lib/sessions.mjs`), fuera de alcance; la UI lo declara |
| N-3 | `GAP-05`: fragmentos sin paginar | requiere helper de lectura; la UI declara «se muestran N de M» |
| N-4 | `GAP-06`/`GAP-10`: diagnóstico multi-ámbito y por embedding | backend; la UI declara la limitación |
| N-5 | `GAP-07`: lecturas sin auditar | es `SECURITY` (G6b), no cliente |
| N-6 | Historial de operaciones sin ruta contractual | decisión Q-02: no se inventa ruta |
| N-7 | Sin estados de carga reales | los fixtures son síncronos; fingir latencia sería un adorno engañoso |
| N-8 | `PA-UI-0-GAPS.md` sigue citando «revisión 2» en su cabecera | el encargo no autoriza tocarlo; propuesta registrada en `G3-AMENDMENT.md` §6 |
