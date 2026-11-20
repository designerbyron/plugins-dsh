# 04 — K1-C · API, identidad y autorización (gate de seguridad)

**Clase:** `SECURITY` (con `DOCUMENTATION` al cierre) · **Etapa:** K1-C
**Estados que este documento NO altera:** PA01 `BLOCKED` · D-UI-03 `PENDING HUMAN DECISION` ·
G6 `BLOCKED` · Ruta A `BLOCKED` · Ruta B `NOT DEMONSTRATED` · TI-1 `FAIL` · TI-4 `FAIL` · GAP-20
`OPEN / DOCUMENTED HOST LIMITATION`
**No implementa nada. No firma nada. No crea instancias. No cambia topología.**

---

## 1. Objetivo

Separar con precisión tres preguntas que suelen confundirse en una:

1. ¿Puede el panel **direccionar** una sesión? (sí, con una cabecera; eso no autentica nada)
2. ¿Puede el plugin **demostrar** que la petición viene de esa pestaña? (hoy **no**)
3. ¿Qué haría falta para que la respuesta a (2) cambie? (tres alternativas, ninguna disponible)

K1-C produce la evaluación y el gate. No produce autenticación.

## 2. Alcance

Dentro: análisis de las alternativas A, B y C con sus requisitos y su evidencia; catálogo de mecanismos
prohibidos; definición del gate K1-C-00…04; condiciones para que cualquier dato real sea posible.

Fuera: implementar la API, montar la ruta, escribir `ui.read`, crear una instancia aislada, cambiar
`DSH_HOME`, tocar credenciales, firmar la aceptación del riesgo.

## 3. El hecho central, medido en el anfitrión

| Hecho | Fuente |
|---|---|
| El navegador se autentica con una **cookie ligada a la autoridad** (host+puerto), 30 días por defecto, sin logout | `dsh-client-connection/src/browser-auth.ts` (citado en el contrato §3.2; leído en `app.asar` por PA-UI-0.1) |
| El *trust fence* comprueba `Host`, `Origin` y `sec-fetch-site`; su propio comentario dice **«this fence never establishes identity»** | `dsh-client-connection/src/api-request-trust.ts` |
| Todo el navegador autenticado comparte **un** `browserPeer` con `principal: { kind: 'owner' }` | `dsh-client-connection/README.md` |
| El control por rol (`remoteAccess`) **sólo se aplica a peers no-owner** | `dsh-api-remote-access/README.md` |
| Las APIs de sesión del propio anfitrión reciben el `sessionId` **como parámetro de direccionamiento** | `dsh-api-session-controller/src/index.ts` |
| `ctx.agents.get(id)` prueba que el agente existe, **no** quién llama | contrato §3.2 |

Conclusión: cualquier proceso local con la cookie del GUI puede hablar como `owner` y **nombrar**
cualquier `sessionId` vivo. Ese es el riesgo residual, y no se elimina con código del plugin.

> Las seis filas anteriores están documentadas en el contrato §3.2 como leídas en `app.asar` durante
> PA-UI-0.1. K1 **no** volvió a leer esos ficheros: se citan como evidencia heredada del contrato, no como
> medición de esta sesión. Lo que sí se midió hoy es la versión del host (`0.2.2-rc.5`) y el
> comportamiento del compositor de clientes, documentado en `02 — K1-A-CLIENT-INTEGRATION.md` §3.

## 4. Por qué montar el panel no es tener una API segura

| Afirmación | Verdad |
|---|---|
| «El panel se ve, luego la API funciona» | Falso: K1-A/B corren con fixtures; ninguna petición sale |
| «El `sessionId` viaja en una cabecera, luego está autenticado» | Falso: es direccionamiento sobre un peer `owner` |
| «`ctx.agents.get(id)` valida la sesión» | Falso: valida existencia, no emisor |
| «La cookie del host protege la ruta» | Cierto pero insuficiente: protege la **autoridad**, no la sesión; y el propio host lo dice |
| «Aceptar el riesgo (D-UI-03) cierra G6» | Falso: D-UI-03 es una decisión independiente; no demuestra Ruta A ni Ruta B |

## 5. Alternativa A — capacidad de sesión emitida por el host

**Qué requeriría:** una primitiva del anfitrión que emita una capacidad efímera, ligada a la conversación,
revocable al cerrar y **no accesible al modelo**; el backend la validaría antes de servir datos.

**Estado:** `BLOCKED`. No existe API: `browser-auth` sólo emite cookies por autoridad; `agents` no emite
capacidades; `connection` no expone token por peer a plugins.

**Evidencia que haría falta para mover el estado:**
1. Documento del anfitrión que describa la primitiva (nombre, forma, ciclo de vida, revocación).
2. Prueba reproducible de emisión y validación, incluida una capacidad **inválida**, **expirada** y **de
   otra sesión** (rechazo determinista).
3. Prueba de que el modelo no puede leerla (ni por herramienta, ni por contexto, ni por log).
4. Declaración del responsable de la verificación.

**Lo que esta ruta NO probaría aunque se implementara:** que el plugin sea confiable; sólo traslada la
prueba al anfitrión.

**Acción en K1-C:** inventariar la superficie pública del host y **documentar la ausencia** con la misma
evidencia de PA-UI-0.1. No se asume que exista.

## 6. Alternativa B — aislamiento topológico demostrado

**Qué requeriría:** una instancia realmente dedicada: `DSH_HOME` independiente, un solo perfil,
credenciales separadas, ausencia de otros bundles, separación de sesiones y almacenes, runbook operativo
y responsable de revisión.

**Estado:** `NOT DEMONSTRATED`. La evaluación de PA-UI-0.4 incumplió **TI-1** (proceso general con 10
bundles, no dedicado) y **TI-4** (un único `DSH_HOME` compartido por 4 perfiles, 28 skills, 6 almacenes,
223 sesiones; `.credentials.yaml` legible y escribible por la misma cuenta). Los demás criterios no son
demostrables con la evidencia disponible.

**Requisitos mínimos (los siete, del contrato §3.6):** TI-1 proceso dedicado · TI-2 sin otras sesiones
no autorizadas en ese proceso · TI-3 el plugin no puede direccionar sesiones de otros procesos ·
TI-4 sin mecanismos compartidos que salten la frontera · TI-5 runbook de inicio/cierre/verificación ·
TI-6 prueba de que una sesión externa no es alcanzable · TI-7 evidencia y responsable.

**Lo que esta ruta NO es:** autenticación. Reduce el conjunto de sesiones a las que se podría direccionar;
no demuestra quién envía la petición. Presentarla como «segura» sería el error que este documento evita.

**Acción en K1-C:** **no** crear ninguna instancia ni cambiar la topología. Sólo se evalúa qué faltaría y
cuánto costaría; la ejecución es una decisión de operación del propietario, con su propia autorización.

## 7. Alternativa C — aceptación explícita del riesgo residual

**Qué requeriría:** una decisión humana **por escrito** que diga qué riesgo se acepta (suplantación local
por un proceso con la cookie del GUI), con qué controles compensatorios obligatorios y con qué vigencia.

**Estado:** **no otorgada**. Este documento no la firma, no la registra como concedida y no la presenta
como camino abierto.

**Controles compensatorios que la aceptación tendría que incluir, como mínimo:**
- auditoría `ui.read` append-only y **fail-closed** (GAP-07 / G6b);
- `assertLoopback` + `connection.requestRejection` + sin CORS + cabecera de escritura;
- mensajes que no permitan enumerar sesiones, proyectos ni bibliotecas;
- `expectedRevision` en la selección (GAP-09) y `ui.read` sin deduplicación;
- revisión periódica de la cadena de auditoría y de la cabeza publicada.

**Lo que la aceptación NO haría:** no convierte Ruta A en disponible, no demuestra Ruta B, no pone G6 en
`PASS`, no autoriza por sí sola la implementación de la API.

## 8. Mecanismos prohibidos como «autenticación»

Ninguno de estos puede sostener una ruta de datos reales. Si una propuesta los usa como prueba, se
rechaza:

| Mecanismo | Por qué no |
|---|---|
| `sessionId` enviado por el cliente | El cliente puede escribir cualquier cadena; el host no la firma |
| Cookie de autoridad del GUI | Autentica el peer `owner`, no la conversación |
| `ctx.agents.get(id)` | Prueba existencia del agente, no propiedad de la petición |
| `browserPeer` | Es único para todo el navegador; `principal: owner` fijo |
| Token compartido del plugin | Se distribuye al cliente; cualquiera con el bundle lo tiene |
| `Origin`/`Host` loopback | Fence de transporte, no identidad (lo dice el host) |
| Cabecera personalizada `x-lifecode-rag: 1` | Antídoto CSRF, no credencial |

## 9. Trabajo de backend que **no** es seguridad (clasificado aparte)

Estas piezas son necesarias para K1-B→datos reales, pero **no** son el gate y **no** pueden habilitarse
antes de G6:

| Pieza | Clase | GAP | Nota |
|---|---|---|---|
| `GET /projects` acotado a cwd ∪ actual | `BACKEND` | GAP-04, GAP-12 | exportar `matchingProjects` o añadir `projectsForCwd` |
| `GET /sources/:id` con fragmentos | `BACKEND` | GAP-05, GAP-16 | `sourceChunks(db, sourceId, {limit, offset})` |
| `/diagnostics` compuesto por ámbito | `BACKEND` | GAP-06, GAP-10 | componer desde `ctx.scopes` + `library-state` |
| Redactor de rutas y sensibles | `BACKEND` | GAP-13 | nunca rutas absolutas en respuestas |
| Id público `scopeId:sourceId` | `BACKEND` | GAP-14 | enlaces entre ámbitos |
| `ui.read` append-only fail-closed | **`SECURITY`** | GAP-07 | usa la tabla `audit_registry` existente; **no** cambia esquema |
| `expectedRevision` con CAS | **`SECURITY`** | GAP-09 | `UPDATE … WHERE revision = ?`; no es «mejora de UX» |

Regla de clasificación: si su fallo permite **ver datos que no corresponden** o **negar trazabilidad**,
es `SECURITY`; si sólo mejora una lectura, es `BACKEND`. No se agrupan.

## 10. Secuencia del gate

| Id | Clase | Tarea | Salida |
|---|---|---|---|
| K1-C-00 | `SECURITY` | Verificar que G3/G4 están cerrados y que G5 se probó de verdad (sesión real, captura) | línea base del gate |
| K1-C-01 | `SECURITY` | Alternativa A: inventario de la superficie del host y evidencia de ausencia | `A: BLOCKED` (o cambio justificado) |
| K1-C-02 | `SECURITY` | Alternativa B: coste y requisitos TI-1…TI-7 **sin ejecutar** | `B: NOT DEMONSTRATED` |
| K1-C-03 | `SECURITY` | Alternativa C: redactar qué decisión haría falta, sin firmarla | `C: PENDING HUMAN DECISION` |
| K1-C-04 | `DOCUMENTATION` | Informe del gate, con los estados intactos | informe + hashes |

## 11. Pruebas (cuando se autoricen)

- **A:** rechazo determinista de capacidad inválida, expirada y de otra sesión; el modelo no puede leerla.
- **B:** los siete criterios con evidencia reproducible y responsable; si falta uno, `NOT DEMONSTRATED`.
- **C:** que la decisión registrada diga riesgo, controles, vigencia y responsable; y que **no** se
  presente como aprobación técnica.
- **Comunes (sólo con API autorizada):** B-02…B-08d, H-01…H-13, I-01…I-08 de
  `PA-UI-0-ACCEPTANCE.md`. Ninguna se puede declarar en K1.

## 12. Riesgos

| Id | Riesgo | Control |
|---|---|---|
| R-C-01 | Se presenta el panel como «API segura» | este documento + banda de fixtures + estados repetidos |
| R-C-02 | Se implementa un token propio «para salir del paso» | lista de prohibidos §8 |
| R-C-03 | Se crea una instancia aislada «para probar» sin autorización | K1-C no crea topología |
| R-C-04 | Se escribe `ui.read` desde el cliente | la auditoría es del servidor, por petición, con `call_id` del servidor |
| R-C-05 | Se firma D-UI-03 en nombre del propietario | prohibido explícitamente; sólo el propietario decide |
| R-C-06 | La aceptación del riesgo se usa para saltarse A o B | el contrato §9 lo prohíbe: no es una tercera ruta |

## 13. Criterios de aceptación de K1-C

| Id | Criterio |
|---|---|
| C-1 | Las tres alternativas están descritas con requisitos y evidencia exigible |
| C-2 | Ningún estado (`PA01`, `G6`, `D-UI-03`, A, B, TI-1/TI-4, GAP-20) se ha alterado |
| C-3 | La lista de mecanismos prohibidos es explícita y aplicable |
| C-4 | La separación `SECURITY` / `BACKEND` está hecha y sostenida |
| C-5 | El informe declara qué **no** se probó y por qué |
| C-6 | No se creó ninguna instancia, ni se cambió `DSH_HOME`, puertos o firewall |

## 14. Condiciones de parada

- Se pide «probar» una ruta creando una instancia o cambiando credenciales → parar.
- Aparece una primitiva del host que podría ser una capacidad de sesión → **no** asumirla: pedir
  documentación y prueba de rechazo antes de decir nada.
- Alguien pide firmar o registrar D-UI-03 → derivar al propietario.
- La única forma de cerrar el gate es aceptar el riesgo → el gate sigue `BLOCKED`; se informa, no se
  resuelve.

## 15. Autorización humana requerida

| Acto | Autorización |
|---|---|
| Leer configuración del anfitrión y del perfil | la de esta tarea (sólo lectura) ya cubierta |
| Ejecutar pruebas de aislamiento | nueva, específica, con runbook y responsable |
| Crear instancia o cambiar topología | **no** cubierta por K1 en ningún caso |
| Registrar D-UI-03 | sólo el propietario, por escrito |
| Implementar la API | posterior a G6; no autorizada |

---

**Estado final esperado de K1-C:** `SECURITY GATE EVALUATED` — A `BLOCKED`, B `NOT DEMONSTRATED`,
C `PENDING HUMAN DECISION`, G6 `BLOCKED`, PA01 `BLOCKED`. Ningún dato real expuesto.
