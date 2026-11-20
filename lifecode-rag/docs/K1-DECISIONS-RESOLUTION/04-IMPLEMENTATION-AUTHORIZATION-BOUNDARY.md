# 04 — Límite de una autorización de implementación

**Acto:** HERMES-LCRAG-K1-DECISIONS-RESOLUTION-01 · **Modo:** `DOCUMENTATION ONLY`
**Afirmación central:** este acto **no autoriza implementación**. Define qué podría contener una
autorización posterior de K1-A y qué queda fuera en cualquier caso.

---

## 1. Principio de autorización

Una autorización de implementación de esta casa se caracteriza por cuatro cosas, y las cuatro son
verificables:

1. **Acto propio**, con identificador y fecha (no se hereda de un plan ni de una conversación).
2. **Alcance por fichero**, con el hash del estado de partida.
3. **Lista de lo prohibido**, explícita, aunque parezca obvia.
4. **Evidencia exigida y condiciones de parada**, antes de empezar.

Una autorización que diga «implementa K1-A» sin ficheros, hashes y pruebas no es una autorización: es una
intención.

---

## 2. Qué podría incluir una autorización posterior de K1-A

Contenido **propuesto**; no concedido. El propietario puede recortarlo, pero no ampliarlo por omisión.

### 2.1 Ficheros y cambios permitidos

| Fichero | Cambio permitido | Límite |
|---|---|---|
| `lifecode-rag/package.json` | añadir el mapa `exports` (`.` → `./index.js`, `./client` → `./client.js`, `./package.json`, `./lib/*` → `./lib/*.mjs`) | **nada más**: `files`, `engines`, `dsh.bundle`, `dsh.client.platform`, `dsh.client.immediately` intactos; `dsh.client.inject` no se añade |
| `lifecode-rag/client.js` | registro de slots con `ctx.slots.inject(slot, cb)`; locales ES/EN; ciclo de vida con disposer; `DATA_MODE='fixture'` con corte de red | sin peticiones HTTP; sin datos reales; sin `ui.read`; sin temporizadores en K1-A |
| `lifecode-rag/tests/client.test.mjs` | pruebas CL-01…CL-09 | no se debilitan las existentes |
| `lifecode-rag/tools/check.mjs` | gate de manifiesto G3 (exports, platform, patch, id, paridad de locales) | no se relajan las comprobaciones actuales (7 herramientas, sin dependencias, sin red) |
| `lifecode-rag/docs/K1-A-EVIDENCE.md` | documento nuevo de evidencia | no sobrescribe nada |

### 2.2 Actividades permitidas, por clase

| Clase | Actividades |
|---|---|
| `CLIENT` | K1-A-02…K1-A-06 (manifiesto, slots, locales, ciclo de vida, fixtures) |
| `TESTING` | K1-A-07, K1-A-08, K1-A-10 (gates y no regresión) |
| `HOST-INTEGRATION` | K1-A-09 (prueba visual), con reinicio **autorizado como acto humano** |
| `DOCUMENTATION` | K1-A-01 y la evidencia final |

### 2.3 Comandos que quedarían permitidos

```sh
# sólo dentro de lifecode-rag/
node --test
node tools/check.mjs
node tools/hermetic.mjs
sha256sum <ficheros tocados>          # antes y después
```

Nada de `git add`, `commit`, `push`, `checkout`, `reset`, `clean`, `stash`, `merge`, `rebase`. Nada de
`npm install`. Nada de tocar el perfil.

### 2.4 Actos humanos que la autorización tendría que nombrar aparte

| Acto | Por qué no puede hacerlo el agente |
|---|---|
| Reiniciar DeepSeek Harness para la prueba visual | cambia el estado del entorno del usuario |
| Provisionar el perfil de laboratorio (Q-04, primera mitad) | modifica un perfil; **fuera** de K1-A |
| Decidir si la evidencia se versiona (Q-07) | decisión del propietario; `git add` prohibido |

### 2.5 Criterio de cierre de K1-A

K1-A se cierra cuando, y sólo cuando:

- G3 y G4 están **medidos** (no inferidos): gate de manifiesto en verde y slots registrados con la forma
  vigente;
- la fila aparece en `sidebar.panellist` y la vista monta en `main`, con evidencia del grafo de arranque y
  conteo DOM, no sólo una captura;
- el desmontaje no deja estilos duplicados;
- el panel sigue montando **tras reiniciar**;
- la suite de `lifecode-rag/` y la puerta hermética están en verde;
- las siete herramientas siguen registradas.

**No** se cierra por: «compila», «el fichero existe», «la captura se ve bien» o «el cliente cargó una vez».

---

## 3. Lo que sigue fuera de alcance en cualquier caso

Aunque se autorice K1-A, esto no queda habilitado:

| Elemento | Motivo |
|---|---|
| Modo `live` y cualquier dato real | D-UI-03 `PENDING HUMAN DECISION`; PA01 `BLOCKED` |
| API `/lifecode-rag/ui/api` | no existe; su creación es posterior a G6 |
| `ui.read` desde cualquier sitio | es `SECURITY` (G6b), no una tarea de cliente |
| Modificar `index.js`, `lib/**`, el esquema SQLite | fuera del alcance de K1-A |
| Cambiar el perfil, reinstalar o crear instancias | actos separados, con autorización propia |
| Modificar los documentos `01`…`08` de K1 o los normativos `PA-UI-0.*` | este acto los deja intactos y así deben seguir |
| Tocar `lifecode-skill-center/**` o `skill-compiler/**` | otros productos |
| Abrir el registro del perfil, los almacenes o `.credentials.yaml` | datos del usuario |
| Declarar K1-B o K1-C | ni siquiera existen como actos autorizados |

---

## 4. K1-B requiere el cierre de K1-A

- Sin módulo cargado no hay dónde montar las vistas; sin montaje probado no hay nada que probar con
  fixtures.
- El cierre de K1-A es el **único** pase a K1-B. No se sustituye por «el cliente ya está escrito»: hoy
  está escrito y no carga.
- K1-B tendrá su propia autorización, con su propio alcance (vistas, fixtures, a11y, higiene) y sus propias
  condiciones de parada. No se hereda de K1-A.
- Q-02, Q-03, Q-04 y Q-05 ya fijan parte del resultado de K1-B; ninguna de ellas lo autoriza.

---

## 5. K1-C continúa como gate independiente

| Hecho | Estado |
|---|---|
| Ruta A · capacidad de sesión del host | `BLOCKED` |
| Ruta B · aislamiento topológico | `NOT DEMONSTRATED` |
| Ruta C · aceptación del riesgo | **no aceptada** |
| Responsable de TI-7 | `PENDING DESIGNATION` |
| PA01 | `BLOCKED` |
| G6 | `BLOCKED` |
| GAP-20 | `OPEN / DOCUMENTED HOST LIMITATION` |

- K1-C **no** se desbloquea con K1-A ni con K1-B: su bloqueo es del anfitrión, no del plugin.
- Un panel bonito con fixtures no aporta ni una prueba de identidad.
- K1-C exigirá su propia autorización, con acceso de lectura a configuración del host y, si alguna vez se
  planteara la Ruta B, un runbook y un responsable designado.
- La enmienda de G3 (Q-08) no toca K1-C.

---

## 6. Qué autoriza este acto, exactamente

1. Crear **cinco** documentos en `lifecode-rag/docs/K1-DECISIONS-RESOLUTION/`.
2. Registrar las ocho decisiones aprobadas y dejar constancia de lo pendiente.
3. Redactar —no aplicar— la propuesta de enmienda de G3.
4. Verificar hashes y estados de git, y reportar.

Y nada más. En particular:

> **Este acto documental no constituye autorización de implementación.**
> **K1-A IMPLEMENTATION: NOT AUTHORIZED. K1-B IMPLEMENTATION: NOT AUTHORIZED. K1-C: BLOCKED.**

---

## 7. Plantilla mínima para una autorización futura

Para que una autorización de K1-A sea verificable, debería declarar:

| Campo | Contenido esperado |
|---|---|
| Acto | identificador propio y fecha |
| Alcance | tabla de ficheros con hash de partida |
| Permitido | actividades por clase y comandos exactos |
| Prohibido | lista explícita (los de §3) |
| Actos humanos | reinicio, y cualquier cambio de perfil si se autoriza |
| Evidencia | artefactos y formato (`05` de K1) |
| Condiciones de parada | las de `02` §14 de K1 |
| Vigencia | hasta el cierre del acto o hasta que el árbol cambie |
| Estado esperado | `CLIENT MOUNTED (fixtures)`; G3/G4 cerrados; G5 `NO PROBADO`; G6 `BLOCKED` |

## 8. Cuándo una autorización dejaría de ser válida

- Si el hash de un fichero del alcance cambia antes de tocarlo (árbol movido por otro proceso).
- Si aparece un cambio concurrente en `plugins-dhs` que afecte a los ficheros del acto.
- Si el host cambia de versión respecto de la línea base (`0.2.2-rc.5`).
- Si el cierre exige tocar algo fuera del alcance.

En cualquiera de esos casos: detenerse, informar y pedir una autorización nueva. No se «reinterpreta» la
existente.
