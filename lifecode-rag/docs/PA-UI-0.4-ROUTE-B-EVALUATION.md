# PA-UI-0.4 — Evaluación controlada de Ruta B (TI-1…TI-7)

**Proyecto:** LifeCode RAG · **Fase:** PA-UI-0.4 (evaluación técnica no destructiva) · **Fecha:** 2026-11-18
**Entorno evaluado:** perfil `desktop`, `DSH_HOME=C:\Users\<USER>\.dsh`, host DeepSeek Harness 0.2.2-rc.5 (PID 16604)
**Documento:** este informe (archivo nuevo; no se sobrescribió ningún documento anterior)
**Resultado global de Ruta B:** **`NOT DEMONSTRATED`** — ningún criterio TI demostrado; dos con evidencia de incumplimiento (TI-1, TI-4)
**G6:** sigue **`BLOCKED`**. **D-UI-03:** no otorgada. **Ruta A:** `BLOCKED`. **PA01:** `BLOCKED`. **PA-UI-1:** `NOT AUTHORIZED / NOT STARTED`.

---

## 1. Resumen ejecutivo

Se evaluó si la topología **actual** cumple los criterios TI-1…TI-7 del contrato §3.6 para que la Ruta B (aislamiento topológico) pueda pasar a decisión humana. La evaluación fue de solo lectura: inspección de configuración, procesos, puertos, ACL y disposición de datos; ninguna prueba modificó el entorno.

Resultado: **la topología actual no cumple TI-1 ni TI-4**, y los demás criterios no pueden demostrarse con la evidencia disponible o no son evaluables sin pruebas invasivas que esta autorización prohíbe. En particular:

- El proceso es la instancia **general** de escritorio (10 bundles, uno de ellos RAG, con plugins de terceros), no una instancia dedicada al entorno RAG.
- Existe **un único `DSH_HOME` compartido** por 4 perfiles, 28 skills, 6 almacenes, 10 workspaces y 223 ficheros de sesión; el almacén de sesiones es común.
- El fichero de credenciales del host (`\.credentials.yaml`, 727 B) es legible y escribible por la misma cuenta de usuario, que también es propietaria de todos los almacenes y de la base de registro.
- El puerto está correctamente ligado a loopback (`127.0.0.1:59686`) y no hay proxy configurado, lo que reduce exposición de red, pero no demuestra aislamiento entre sesiones.

Ningún criterio alcanza `PASS`. La Ruta B **no puede avanzar** con esta evidencia y **no se cierra G6**.

---

## 2. Estado de partida y huellas

### 2.1 Git y documentos

| Elemento | Valor |
|---|---|
| Rama | `fix/t45-4-r17-acceptance` |
| HEAD | `b6c0cd24621c8bc3282185d1821c60b7956f8a83` |
| `git status --porcelain` | **1151** líneas (25 ` M` + 1126 `??`) |
| `PA-UI-0-API-CONTRACT.md` | 55 545 B · `934224310e10006d0ab3dbc2fec18b5a418a9e7c5e0f68f2570ee544e468c68a` · **MATCH** |
| `PA-UI-0-ACCEPTANCE.md` | 22 268 B · `d32a4912f6b75b8b97c4b7e82790fd3067bf759a96d867265a07932ccdd547f9` · **MATCH** |
| `PA-UI-0-GAPS.md` | 23 565 B · `bae5139187138aaa5805ee89140ec9edd1326ee9a1c39bc36b62987151b4d19b` · **MATCH** |
| `PA-UI-0.3-REVIEW.md` | 7 849 B · `613e91f9fed70dbd04724f0a561195840fab9cdde15258260891b9996fb342eb` · **MATCH** |

Los cuatro documentos normativos coinciden con los hashes aprobados. No se modificó ninguno.

### 2.2 Perfil, rutas y almacenes

| Elemento | Ruta / valor observado |
|---|---|
| Perfil activo | `C:\Users\<USER>\.dsh\profiles\desktop` (`DSH_PROFILE=desktop`) |
| Otros perfiles presentes | `headless` (17/11), `web` (24/10), `node_modules` |
| Manifiesto del perfil | `package.json` 1 035 B, mtime 2026-11-18T15:27:09 |
| `cordis.patch.yml` del perfil | 2 344 B, mtime 2026-11-18T18:49:01 |
| Registro | `…\profiles\desktop\registry.sqlite3` 212 992 B, mtime 2026-11-18T18:49:07 |
| Datos RAG | `C:\Users\<USER>\.dsh\lifecode-rag\profiles\desktop` (único perfil RAG) |
| Almacén de ámbito | `…\scopes\prj_01M7RBSRD33M26HGBEFW51WPP6\rag.sqlite3` 3 862 528 B, mtime 2026-11-18T18:43:47 |
| Almacén legado v0.2 | ausente (`$DSH_HOME\lifecode-rag\rag.sqlite3` no existe) |

### 2.3 Procesos y red

| PID | Inicio | Rol observado |
|---|---|---|
| 20708 | 2026-11-18T19:08:54 | proceso principal (`--updated`) |
| 10688 | 19:08:54 | GPU process |
| 24980 | 19:08:54 | network service |
| 20296 | 19:08:54 | renderer |
| **16604** | **19:08:55** | host (`--expose-internals … app.asar\dsh\…`) — dueño del puerto |
| 12144 | 23:04:40 | proceso node hijo del host |

Todos ejecutan el mismo binario: `C:\Users\<USER>\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe`.
Puertos en escucha del host: **solo `127.0.0.1:59686`** (PID 16604). Sin `0.0.0.0`, sin proxy (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` vacíos).

### 2.4 Estado compartido (huellas)

| Recurso | Observación |
|---|---|
| `DSH_HOME\sessions` | 10 directorios de workspace; **223** ficheros `session.v4.jsonl.zstd` |
| `DSH_HOME\skills` | 28 entradas |
| `DSH_HOME\profiles` | 4 entradas |
| `DSH_HOME\storages` | 6 entradas |
| `DSH_HOME\hooks.json` | hooks globales `SessionStart` y `UserPromptSubmit` → `node …\.dsh\prompt-doctor\hook.mjs` (por sesión) |
| `DSH_HOME\.credentials.yaml` | 727 B, mtime 04/11; propietario `DESKTOP-2QUJQOR\<USER>` |
| ACL de `DSH_HOME` y credenciales | `<USER>`, `SYSTEM` y `Administradores` con **FullControl** |
| Bundles del perfil | `dsh-base`, `dsh-web-app`, `plugin-market`, `dsh-plugins-update`, `full-life-memory`, `lifecode-skill-center`, `billion-context`, `lifecode-rag`, `dsh-context`, `dsh-data-quality` |

### 2.5 Límites de observabilidad (declarados)

- No es posible leer variables de entorno de procesos ajenos con las herramientas disponibles.
- No hay superficie de inspección de solo lectura para **enumerar agentes vivos** (`ctx.agents.list` es un servicio, no un método de inspección).
- El GUI exige autenticación (`HTTP 401` al abrir la URL sin credencial de navegador): no se dispone de DOM ni consola.
- No hay logs del cargador cliente legibles; los ficheros de sesión están comprimidos en zstd y no hay decodificador disponible.
- Por tanto: *configuración declarada* ≠ *configuración observada* ≠ *comportamiento probado*; en esta fase solo hay configuración observada y ninguna prueba de comportamiento.

---

## 3. Matriz TI-1…TI-7

| TI | Criterio (literal, contrato §3.6) | Propiedad a demostrar | Método (solo lectura) | Resultado observado | Estado | Limitación / riesgo residual |
|---|---|---|---|---|---|---|
| **TI-1** | Proceso Harness **dedicado** al entorno RAG (una instancia, un `DSH_HOME`/perfil, sin plugins de terceros innecesarios) | La instancia que sirve RAG no atiende nada más | Procesos + bundles + contenido de `DSH_HOME` | 1 instancia, pero **general**: 10 bundles (market, memoria, skill-center, billion-context, dsh-context, data-quality), 1 `DSH_HOME` con 4 perfiles, 28 skills, 6 storages, 10 workspaces y 223 sesiones | **FAIL** | No se puede crear un perfil/instancia dedicada sin cambiar entorno (prohibido). Riesgo: toda sesión del escritorio comparte proceso y almacenes |
| **TI-2** | **Ausencia** de otras conversaciones/sesiones no autorizadas dentro de ese mismo proceso | Solo hay agentes autorizados vivos en el proceso | Enumeración de agentes vivos | No existe método de inspección de solo lectura para `agents.list`; no se ejecutó ninguna llamada a servicios del host | **NOT TESTED** | Contexto: 223 sesiones persistidas en el almacén compartido. No se convierte en PASS por falta de evidencia |
| **TI-3** | El plugin **no puede direccionar** sesiones de otros procesos/instancias (sin bus/almacén de sesiones compartido) | Frontera entre procesos para el direccionamiento de sesiones | Evidencia de código + topología | `dsh-api-session-controller` recibe `sessionId` como direccionamiento del llamante; el almacén de sesiones vive en `DSH_HOME` compartido; hoy **solo existe una instancia**, por lo que no hay otra a la que direccionar, pero tampoco se ha probado la frontera | **NOT TESTED** | Probar la frontera exige una segunda instancia (prohibido). Indicio contrario: almacén común |
| **TI-4** | Ausencia de mecanismos compartidos que permitan saltar la frontera (cookie/token reutilizable, mismo puerto, proxy común, almacén de sesiones compartido) | Ningún canal compartido atraviesa la frontera | Puertos, ACL, credenciales, hooks, almacenes | Puerto solo loopback (bien) y sin proxy (bien); pero **almacén de sesiones/estado compartido**, **credenciales del host legibles/escribibles por el mismo usuario**, **hooks globales** y plugins de terceros en el mismo proceso | **FAIL** | Cualquier proceso de la misma cuenta puede leer credenciales y almacenes; `SYSTEM`/Administradores también. No es un riesgo eliminable por el plugin |
| **TI-5** | Procedimiento operativo documentado: iniciar, mantener, cerrar y **verificar** el aislamiento (incluye segunda instancia) | Procedimiento existente y verificable | Búsqueda documental | No existe procedimiento operativo; solo aparecen los criterios TI en documentos de diseño. Ningún runbook de inicio/cierre/verificación ni conducta ante segunda instancia | **NOT DEMONSTRATED** | Sin procedimiento no hay repetibilidad ni verificación |
| **TI-6** | Prueba reproducible de que una sesión externa no puede ser alcanzada desde el proceso aislado (o de que no existe) | Frontera probada, no solo declarada | Prueba con segunda instancia/sesión | No ejecutada: exigiría iniciar otra instancia o sesión, prohibido por §3. Observación: hoy no hay otra instancia DSH en escucha | **NOT TESTED** | La ausencia actual de otra instancia no demuestra la propiedad |
| **TI-7** | Evidencia y **responsable de la verificación** registrados; revisión humana de la frontera | Cadena de responsabilidad y revisión | Registro documental | No existe registro previo de responsable ni revisión humana de esta frontera; este informe es una evaluación técnica, no una revisión humana | **NOT DEMONSTRATED** | La revisión humana sigue pendiente |

**Criterios con `PASS`: ninguno.** TI-1 y TI-4 tienen evidencia **positiva de incumplimiento**; TI-2, TI-3 y TI-6 no son evaluables sin pruebas invasivas; TI-5 y TI-7 carecen de evidencia.

---

## 4. Evidencia y procedimientos reproducibles

### 4.1 Git y hashes (2026-11-18T23:05Z aprox.)

```powershell
git rev-parse --abbrev-ref HEAD        # fix/t45-4-r17-acceptance
git rev-parse HEAD                     # b6c0cd24621c8bc3282185d1821c60b7956f8a83
(git status --porcelain | Measure-Object -Line).Lines   # 1151
Get-FileHash -Algorithm SHA256 -LiteralPath <doc>       # 4/4 MATCH
```

### 4.2 Procesos y puertos

```powershell
Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" |
  Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath
Get-NetTCPConnection -State Listen | Where-Object { $dshPids -contains $_.OwningProcess }
# 127.0.0.1  59686  16604
```

### 4.3 Estado compartido

```powershell
(Get-ChildItem "$env:DSH_HOME\sessions" -Recurse -Filter 'session.v4.jsonl.zstd').Count  # 223
Get-ChildItem "$env:DSH_HOME\sessions" | Measure-Object                                  # 10 workspaces
(Get-Content -Raw "$env:DSH_HOME\profiles\desktop\package.json" | ConvertFrom-Json).dsh.profile.bundles
Get-Acl "$env:DSH_HOME\.credentials.yaml"   # <USER> / SYSTEM / Administradores: FullControl
Get-Content -Raw "$env:DSH_HOME\hooks.json" # prompt-doctor en SessionStart y UserPromptSubmit
```

### 4.4 Configuración declarada vs observada vs probada

| Capa | Qué se verificó | Resultado |
|---|---|---|
| Declarada | `package.json` del perfil, `cordis.patch.yml`, `hooks.json`, manifiesto del plugin | Bundles, hooks y parches tal como declaran los ficheros |
| Observada | Procesos, PIDs, ruta del ejecutable, puertos, ACL, recuentos de `DSH_HOME`, mtimes de registry y almacenes | Coincide con lo declarado; un único puerto loopback |
| Probada | Comportamiento de frontera entre sesiones/procesos | **Nada** (prohibido por §3) |
| Demostrada | Propiedad de aislamiento TI-1…TI-7 | **Ninguna** |

---

## 5. Riesgos y limitaciones

| Id | Riesgo | Estado |
|---|---|---|
| R-A | Cualquier proceso de la cuenta `<USER>` (y `SYSTEM`/Administradores) puede leer credenciales y todos los almacenes; la frontera no es criptográfica | **Abierto** — estructural del host/usuario |
| R-B | El almacén de sesiones es único y compartido por todos los workspaces/perfiles bajo `DSH_HOME`; 223 sesiones persistidas | **Abierto** |
| R-C | El proceso sirve a la vez RAG y otros plugins de terceros, incluidos los que leen/escriben estado en el mismo `DSH_HOME` | **Abierto** |
| R-D | Los hooks globales ejecutan `node` con el workspace de cada sesión como `cwd` en cada prompt | Observado; no evaluado como canal |
| R-E | La evaluación no midió comportamiento dinámico (sin pruebas invasivas), por lo que no se descartan ni se confirman canales no documentados | Limitación de la fase |

---

## 6. Pruebas no ejecutadas y motivos

| Prueba | Motivo |
|---|---|
| Iniciar una segunda instancia DSH y comprobar direccionamiento cruzado de sesiones | Prohibido: iniciar procesos/servicios y alterar topología (§3) |
| Enumerar agentes vivos del proceso mediante servicio `agents.list` | No hay superficie de inspección de solo lectura; invocarlo sería ejecutar servicios del host no autorizados en esta fase |
| Abrir una segunda sesión de conversación en el proceso actual | Alteraría el entorno de sesiones activas (§3) |
| Probar el GUI con la cookie de otra sesión/pestaña | Prueba invasiva y de suplantación; expresamente prohibida |
| Verificar exposición de red externa | El bind es solo loopback; no se escaneó la red ni se intentó acceso remoto |
| Leer variables de entorno del proceso host | Sin herramienta de solo lectura disponible; se documenta como `NOT TESTED` |

---

## 7. Resultado global de Ruta B

| Criterio | Estado |
|---|---|
| TI-1 | **FAIL** |
| TI-2 | **NOT TESTED** |
| TI-3 | **NOT TESTED** |
| TI-4 | **FAIL** |
| TI-5 | **NOT DEMONSTRATED** |
| TI-6 | **NOT TESTED** |
| TI-7 | **NOT DEMONSTRATED** |
| **Ruta B (global)** | **`NOT DEMONSTRATED`** |

No procede `PASS` (no hay siete criterios demostrados), ni `PARTIAL` (ningún criterio demostrado), ni `BLOCKED` global (la evaluación parcial pudo ejecutarse con seguridad; el bloqueo afecta a las pruebas invasivas, que se registran como `NOT TESTED`). Con TI-1 y TI-4 en `FAIL`, la topología actual **no es candidata** a demostrar aislamiento sin cambios de entorno.

---

## 8. Recomendación técnica y siguiente decisión necesaria

1. **No avanzar la Ruta B con la topología actual.** Los dos criterios observables con incumplimiento (TI-1 dedicación y TI-4 ausencia de canales compartidos) no son ajustables por el plugin y su corrección exige cambios de entorno expresamente fuera de alcance.
2. Si se desea explorar la Ruta B, la decisión humana previa necesaria es autorizar una fase **separada** con: (a) una instancia/perfil y `DSH_HOME` dedicados, sin otros plugins; (b) un procedimiento operativo de inicio/cierre/verificación; (c) una prueba de frontera con una segunda instancia en entorno controlado; (d) un responsable y revisión humana registrados (TI-7). Aun así, la Ruta B **no autentica sesiones**: sólo reduce superficie.
3. **Ruta A** sigue `BLOCKED` (el host no emite capacidad ligada a sesión) y **PA01** sigue `BLOCKED`. **D-UI-03** no se otorga ni se infiere de este informe.
4. **G6 permanece `BLOCKED`** y **PA-UI-1 no se inicia** hasta una decisión humana explícita.

---

## 9. Estado de los elementos tras la evaluación

| Elemento | Estado |
|---|---|
| GAP-20 | `OPEN / DOCUMENTED HOST LIMITATION` |
| D-UI-03 | `BLOCKED / PENDING HUMAN DECISION` — no otorgada |
| D-UI-11 / Ruta B | `NOT DEMONSTRATED` (TI-1 y TI-4 `FAIL`) |
| Ruta A | `BLOCKED` |
| PA01 | `BLOCKED` |
| G6 | `BLOCKED` |
| PA-UI-1 | `NOT AUTHORIZED / NOT STARTED` |

## 10. Integridad del entorno

- Rama y HEAD sin cambios; `git status` = 1151 antes y después; sin operaciones Git de escritura.
- Único archivo escrito: este informe, nuevo, bajo `lifecode-rag/docs/`. Ningún fichero existente fue modificado ni sobrescrito.
- Perfil, `cordis.patch.yml`, `hooks.json`, `registry.sqlite3`, almacenes RAG y credenciales: solo lectura; sin cambios de permisos, configuración ni topología.
- Sin instalación, desinstalación, reinicio, creación de perfiles/proyectos/raíces ni ejecución de pruebas invasivas.
- **SHA-256 de este informe:** se publica en la entrega (un documento no puede contener su propio hash sin invalidarlo); los hashes de los cuatro documentos de referencia están en §2.1 y se verificaron al inicio.
