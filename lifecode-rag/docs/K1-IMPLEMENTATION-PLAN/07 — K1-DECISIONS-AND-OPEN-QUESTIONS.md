# 07 — K1 · Decisiones existentes, decisiones pendientes y preguntas al propietario

**Clase:** `DOCUMENTATION`
**Regla:** este documento **no** otorga ninguna decisión reservada al propietario. Registra el estado,
propone con argumentos y separa lo que un agente puede decidir de lo que no.

---

## 1. Decisiones existentes (se conservan tal cual)

| Id | Decisión | Estado tras PA-UI-0.4 | Qué implica para K1 |
|---|---|---|---|
| D-UI-01 | Prefijo `/lifecode-rag/ui/api` | **CONFIRMADA** | K1-B no lo usa (fixtures); K1-C lo implementaría |
| D-UI-02 | Transporte por cabecera + `agents.get` + `requestRejection` | **BLOCKED** | no se presenta como autenticación |
| D-UI-03 | Riesgo residual de suplantación local | **PENDING HUMAN DECISION** | sin decisión, no hay datos reales |
| D-UI-04 | `expectedRevision` obligatoria en `POST /selection` | RESUELTA DOCUMENTALMENTE | falta implementar (GAP-09) |
| D-UI-05 | Candidatos = `cwd` ∪ proyecto actual | CONFIRMADA | V2 sólo lista candidatos |
| D-UI-06 | Sin paginación de búsqueda; offset en fuentes | CONFIRMADA | V4 pagina, V6 no |
| D-UI-07 | `ui.read` append-only y fail-closed | RESUELTA DOCUMENTALMENTE | implementar es K1-C/G6b |
| D-UI-08 | Diagnóstico con rutas redactadas | CONFIRMADA | V9 no muestra rutas |
| D-UI-09 | Límites provisionales clasificados | CONFIRMADA | no se citan como medidos |
| D-UI-10 | `409 session-unavailable` | CONFIRMADA | catálogo §7 |
| D-UI-11 | Mitigación por aislamiento topológico | **NOT DEMONSTRATED** | no es autenticación |

Ninguna se reabre en K1. Este plan no cambia estados.

---

## 2. Decisiones nuevas que K1 propone

### K1-D-01 · Añadir `exports` al manifiesto

- **Recomendación:** sí, con el mapa espejo del Skill Center (`.` → `index.js`, `./client` → `client.js`,
  `./package.json`, `./lib/*` → `./lib/*.mjs`).
- **Por qué:** medido, sin `exports['./client']` el compositor del anfitrión lanza
  `client-modules: @local/lifecode-rag declares dsh.client but exports no "./client" bundle` y no hay
  cliente posible.
- **Riesgo:** el paquete está instalado como `link:`; un `exports` mal formado puede romper la resolución
  de la entrada principal. Mitigación: mapa idéntico al de un paquete que ya carga en este host.
- **Decide:** propietario (cambio de manifiesto). **Bloquea:** K1-A-02.

### K1-D-02 · `dsh.client.inject`: no añadirlo

- **Recomendación:** **no** añadirlo mientras el panel no consuma un slot de conversación.
- **Por qué (medido):** en el anfitrión, `inject` son "package rows whose factories must arrive before this
  row materializes": un orden de activación, no un requisito de carga. Declarar como dependencia un
  paquete que no está montado deja el plugin en `pending (waiting for service: …)` —medido en la casa
  sobre 0.2.2-rc.1— y la aplicación no arranca.
- **Divergencia documental:** el gate G3 de `PA-UI-0-ACCEPTANCE.md` pide "`exports["./client"]` y
  `dsh.client.inject`". La primera mitad es requisito; la segunda no. Se registra como X-02 (§4).
- **Decide:** propietario (si quiere enmendar G3). **Bloquea:** nada; evita un fallo de arranque.

### K1-D-03 · Locales inline, no carpeta `locale/`

- **Recomendación:** diccionarios ES/EN **inline** en `client.js`, registrados con
  `ctx.effect(() => locale.register('lifecode-rag', DICTIONARIES))`, con paridad de claves.
- **Por qué:** es la forma medida en el paquete que ya carga (Skill Center); el `onInvalidate`/`t` del
  anfitrión resuelve por namespace. GAP-08 habla de "añadir `locale/`", pero eso describe una carpeta de
  build, no un requisito del anfitrión.
- **Decide:** agente (decisión de implementación, sin efecto de seguridad). **Bloquea:** K1-A-04.

### K1-D-04 · Modo fixtures cerrado por defecto

- **Recomendación:** `DATA_MODE = 'fixture'` como constante; `request()` lanza antes de `fetch`; banda
  visible «Datos sintéticos · sin acceso al almacén».
- **Por qué:** permite construir y probar K1-B sin API y sin tocar datos; y hace imposible que un panel
  "de demo" sirva datos reales por accidente.
- **Retirada:** cuando K1-C se cierre **y** el propietario autorice el modo `live`. No por calendario.
- **Decide:** agente para la forma; propietario para el paso a `live`. **Bloquea:** K1-B-02.

### K1-D-05 · `ui.read` no se escribe desde el panel

- **Recomendación:** la auditoría de lecturas es **del servidor**, una fila inmutable por petición, con
  `call_id` generado por el servidor. El cliente no la escribe ni la simula.
- **Por qué:** el contrato §7.1 lo fija así; escribirla desde el cliente produciría filas que prueban que
  un panel dijo algo, no que el servidor sirvió un dato.
- **Decide:** agente (regla derivada del contrato). **Bloquea:** cierre de K1-B (no puede "cumplir" GAP-07).

### K1-D-06 · Coexistencia con el panel legacy (decisión de producto)

- **Situación:** el `client.js` actual sirve el almacén v0.2 (`/lifecode-rag/api`) y explica
  `panel-unavailable` cuando ese almacén no existe. El panel Project-Aware necesita el mismo `id`
  (`lifecode-rag`) para que la fila y la vista se direccionen con una sola clave.
- **Opciones:**
  | Opción | Qué implica | Coste | Riesgo |
  |---|---|---|---|
  | (a) Un solo panel, detección en tiempo de ejecución | en modo live se sondea `/lifecode-rag/api/health`: 200 → workspace legacy; 404 → PA | medio | el sondeo no puede existir en modo fixture (rompería la regla de cero red) |
  | (b) Dos paneles con ids distintos | `lifecode-rag` (legacy) y `lifecode-rag-pa` | bajo | dos filas «LifeCode RAG» en la barra: confusión |
  | (c) Retirar el legacy | sólo PA | bajo | rompe perfiles con `rag.sqlite3`; el README promete que siguen servidos |
- **Recomendación:** **(a)**, con la precisión de que en K1-A/B el modo es fijo y **no** se sondea nada; el
  sondeo se añade junto con el modo `live`. Se conserva (c) como decisión futura si el propietario
  confirma que ningún perfil usa el almacén v0.2.
- **Decide:** propietario. **Bloquea:** K1-B-05/V10 y el diseño del panel.

### K1-D-07 · Carpeta de evidencia

- **Recomendación:** adoptar `eval/pa-ui-1/evidence/` (fijada por ACCEPTANCE §M) y crearla **en el acto de
  implementación autorizado**, no en K1. Registrar que `eval/` hoy no está versionado.
- **Decide:** propietario (si `eval/` debe entrar en git). **Bloquea:** la entrega de evidencias.

### K1-D-08 · Nombres de los entregables

- **Situación:** la tarea fija nombres con guion largo y espacios (`01 — K1-IMPLEMENTATION-PLAN.md`). La
  convención de la casa para identificadores es kebab-case ASCII.
- **Recomendación:** **mantener los nombres exactos autorizados** (preservación literal; el manifiesto `08`
  los cita tal cual). Si el propietario prefiere kebab-case, el renombrado exige regenerar `08`.
- **Decide:** propietario. **Bloquea:** nada.

---

## 3. Preguntas abiertas para el propietario

| Id | Pregunta | Opciones | Recomendación | Bloquea |
|---|---|---|---|---|
| Q-01 | ¿Se decide D-UI-03 (riesgo residual) en esta fase? | (i) no, sigue pendiente; (ii) sí, por escrito con controles | (i): sin G6 ni controles, aceptar no aporta nada | cualquier dato real |
| Q-02 | "Historial de operaciones" no tiene ruta contractual | (i) declararla no disponible; (ii) ampliar el contrato más adelante; (iii) dejar sólo `auditHead` | (i) en K1-B; (ii) fuera de K1 | V10 |
| Q-03 | "Selector de bibliotecas" es sólo lectura | (i) informativo; (ii) gestión de grants (requiere contrato + seguridad) | (i) | V3 |
| Q-04 | ¿El panel con fixtures puede ser visible en el perfil normal? | (i) sí, con banda; (ii) sólo en un perfil de laboratorio | (ii) si existe un perfil de pruebas; si no, (i) con la banda | K1-B |
| Q-05 | ¿Coexiste con el panel legacy? | (a)/(b)/(c) de K1-D-06 | (a) | diseño del panel |
| Q-06 | Si algún día se intenta Ruta B, ¿quién es el responsable de la verificación (TI-7)? | nombre y rol | una persona concreta, no "el equipo" | cualquier evaluación de B |
| Q-07 | ¿`eval/` debe versionarse? | (i) sí; (ii) no, evidencia local | (i) si la evidencia debe sobrevivir al disco | K1-D-07 |
| Q-08 | ¿Se enmienda G3 en `PA-UI-0-ACCEPTANCE.md` para quitar `dsh.client.inject` como requisito? | (i) sí, revisión documental; (ii) dejarlo como está | (i), con la medición del anfitrión | interpretación de G3 |

---

## 4. Contradicciones y precisiones detectadas (registradas, no corregidas)

| # | Documento dice | Medición | Gravedad |
|---|---|---|---|
| X-01 | GAP-01: "la mitad cliente **no existe** en el host" | `client.js` existe (751 líneas, 43 262 B) y **no carga** por dos defectos concretos (A-1, A-3) | media: el diagnóstico es correcto en el efecto, impreciso en la causa |
| X-02 | ACCEPTANCE G3 exige `dsh.client.inject` | el anfitrión lo trata como orden de activación opcional; declarar un paquete no montado deja el plugin en `pending` | alta para K1-A: seguirlo al pie de la letra puede impedir el arranque |
| X-03 | `WORKSPACE-UX.md` §5.1: la señal de panel activo es `usePanelInfo` | `client.js:583-589` usa `document.visibilityState` y un `setInterval` fijo | media: contradicción código ↔ doc; se corrige en K1-B |
| X-04 | La tarea habla de cuatro "repositorios" | son cuatro **worktrees** de un solo repo (`git-common-dir` común) | baja, pero afecta a la atribución de cambios |
| X-05 | `README.md` promete que "el panel lateral sigue sirviendo ese almacén" | cierto sólo con almacén v0.2; en un perfil PA el panel explica `panel-unavailable` | baja (ya registrada como X-03 en `PA-UI-0-GAPS.md`) |
| X-06 | `PA-UI-0-ACCEPTANCE.md` §M fija `eval/pa-ui-1/evidence/` | la carpeta no existe (`eval/` tiene pa0…pa6) | baja: la evidencia no tiene destino todavía |
| X-07 | `README.md` cita `docs/KNOWN-LIMITATIONS.md` | no existe | baja: referencia rota |
| X-08 | `package.json` declara `engines.dsh >=0.2.2-rc.3 <0.3.0` | host medido `0.2.2-rc.5` | ninguna: compatible |

Ninguna de estas contradicciones se corrigió en K1. Corregir X-01/X-02/X-06 exigiría editar documentos
normativos, y eso no está autorizado.

---

## 5. Lo que este documento **no** decide

- No acepta el riesgo residual (D-UI-03).
- No declara demostrada la Ruta A ni la Ruta B.
- No cambia el contrato, ni GAP, ni gates.
- No autoriza la implementación de K1-A, K1-B ni K1-C.
- No elige el momento de ninguna de las decisiones anteriores.

---

**Estado final:** decisiones existentes intactas; ocho decisiones nuevas propuestas; ocho preguntas
abiertas; ocho contradicciones registradas. La pelota está donde debe: en el propietario.
