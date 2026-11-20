# 01 — Registro de decisiones del propietario (K1)

**Acto:** HERMES-LCRAG-K1-DECISIONS-RESOLUTION-01
**Modo:** `DOCUMENTATION ONLY` · **Fecha:** 2026-11-19 · **Naturaleza:** registro documental, no autorización
**Fuentes normativas:** los ocho documentos de `lifecode-rag/docs/K1-IMPLEMENTATION-PLAN/` (01…08)
**Predecesor:** HERMES-LCRAG-K1-PLAN-01 (aprobado; ver `08 — K1-PLAN-MANIFEST-SHA256.txt`)

> Este documento registra lo que el propietario **aprobó expresamente**. No convierte ninguna
> recomendación anterior en decisión, no aplica enmiendas y no autoriza implementación.

---

## 1. Estado de partida (verificado antes de escribir)

| Elemento | Medición (2026-11-19, 00:18 local) |
|---|---|
| Ruta de los originales | `C:\xampp\htdocs\plugins-dhs\lifecode-rag\docs\K1-IMPLEMENTATION-PLAN\` |
| Documentos `01`…`08` | existen los ocho; `01`…`07` verificados contra `08` con `sha256sum -c`: **7/7 OK** |
| SHA-256 de `08` | `829583fb123c7c8da9977f0f4b642afe3cbd1124b101792d1d182030ba7afef1` |
| Carpeta de destino | `K1-DECISIONS-RESOLUTION/` **no existía** |
| Worktree `plugins-dhs` | rama `fix/t45-4-r17-acceptance`, HEAD `b6c0cd2`, 1153 entradas (25 ` M`) |
| Worktree `plugins-dhs-auto` | rama `feature/auto-learning-trigger`, HEAD `c2473a5`, limpio |
| Worktree `plugins-dhs-integracion` | rama `feature/learning-visual-integration`, HEAD `c2473a5`, 27 entradas |
| Worktree `plugins-dsh-lsc-pack` | rama `publish/lifecode-skill-center`, HEAD `0c73169`, 44 entradas |
| Índice de git | vacío (`git diff --cached` sin líneas) |

---

## 2. Las ocho decisiones aprobadas

Cada ficha lleva: resolución **literal**, alcance, consecuencias y estado. Ninguna se amplía por
interpretación.

### Q-01 · Riesgo residual (D-UI-03)

- **Resolución aprobada:** *No aceptar el riesgo residual en esta fase. Mantener `PENDING HUMAN DECISION`.*
- **Alcance:** D-UI-03 no se otorga; no hay aceptación parcial, condicional ni implícita.
- **Consecuencias:** la API visual no puede servir datos reales; K1-C sigue como gate; PA01 sigue
  `BLOCKED`; G6 sigue `BLOCKED`; Ruta A `BLOCKED`; Ruta B `NOT DEMONSTRATED`; Ruta C no aceptada.
- **Estado:** `APROBADA` — y a la vez `D-UI-03: PENDING HUMAN DECISION` (la decisión de *no aceptar* no
  cierra la pregunta; la mantiene abierta).

### Q-02 · Historial de operaciones

- **Resolución aprobada:** *Historial de operaciones no disponible en K1-B. No inventar rutas.*
- **Alcance:** la vista V10 se pinta como no disponible, con la causa exacta (el contrato
  `pa-ui/0.1.0-draft` no expone listado de auditoría; `/diagnostics` sólo devuelve `integrity.auditHead`).
- **Consecuencias:** K1-B no crea ruta, no lee la tabla de auditoría por otra vía y no presenta una tabla
  vacía como si fuera una lista. Una ampliación del contrato queda fuera de K1.
- **Estado:** `APROBADA` · implementación: no autorizada.

### Q-03 · Bibliotecas

- **Resolución aprobada:** *Bibliotecas exclusivamente informativas y de sólo lectura.*
- **Alcance:** V3 muestra grants abiertos y estado de almacén; no hay concesión, revocación ni edición.
- **Consecuencias:** ninguna ruta nueva; el contrato se respeta tal cual. Si en el futuro se quiere
  gestión de grants, exige contrato nuevo y su propio gate de seguridad.
- **Estado:** `APROBADA`.

### Q-04 · Perfil para el modo fixtures

- **Resolución aprobada:** *Preferir perfil de laboratorio si existe. Si no existe, perfil normal con banda
  permanente de datos sintéticos.*
- **Verificación hecha para aplicarla:**
  | Laboratorio | ¿Tiene `DSH_HOME` con perfil? | ¿Tiene `@local/lifecode-rag`? |
  |---|---|---|
  | `C:/xampp/htdocs/skill-compiler-lab-2026-11-05` | sí (`home/profiles/desktop`) | **no**: sus `bundles` son base, web-app, `@local/skill-compiler`, market, billion-context, dsh-context, dsh-data-quality, dsh-plugins-update, full-life-memory |
  | `C:/xampp/htdocs/lsc-compat-lab-2026-11-17` | **no**: no tiene `home/profiles`; es un banco de compatibilidad de bundles | no aplica |
- **Consecuencia precisa:** existe un laboratorio DSH, pero **no está habilitado para RAG**. Habilitarlo
  exige modificar el manifiesto de un perfil y su instalación: acto **fuera** de este documento y fuera de
  la autorización actual. Mientras eso no se autorice por separado, se aplica la segunda mitad de Q-04:
  **perfil normal con banda permanente de datos sintéticos**, que además es la única opción compatible con
  K1-A tal como está definido (sin cambios de perfil).
- **Estado:** `APROBADA` en su preferencia; **la primera mitad queda condicionada** a un acto posterior de
  aprovisionamiento del laboratorio (no autorizado aquí).

### Q-05 · Coexistencia con el panel legacy

- **Resolución aprobada:** *Opción A: coexistencia con el panel legacy, detección sólo en modo live y nunca
  durante fixtures.*
- **Alcance:** un solo `id` de panel (`lifecode-rag`); en modo `live` se sondea
  `/lifecode-rag/api/health` para decidir workspace legacy (200) o Project-Aware (404). En modo fixture no
  se sondea nada y no se emite ninguna petición.
- **Consecuencias:** K1-B no implementa el sondeo; lo deja especificado. La retirada del panel legacy deja
  de estar sobre la mesa salvo decisión futura.
- **Estado:** `APROBADA` (decisión de producto; su implementación pertenece a una fase autorizada).

### Q-06 · Responsable de la verificación TI-7

- **Resolución aprobada:** *Responsable TI-7: `PENDING DESIGNATION`. No inventar nombre ni rol.*
- **Alcance:** el criterio TI-7 de la Ruta B exige evidencia **y responsable de la verificación**. Ese
  responsable no está designado.
- **Consecuencias:** la Ruta B no puede pasar a `DEMONSTRATED` ni con los otros seis criterios: falta el
  séptimo. No se atribuye a «el equipo», «el propietario» ni a un agente.
- **Estado:** `PENDING DESIGNATION` — literal, sin sustitución.

### Q-07 · Evidencia versionada

- **Resolución aprobada:** *Versionar `eval/pa-ui-1/evidence/` cuando corresponda crearla en una fase
  autorizada.*
- **Alcance:** la carpeta no se crea ahora. Hoy `eval/` existe pero **no está versionado** (`??`), y
  `eval/pa-ui-1/` no existe.
- **Consecuencias:** la evidencia de K1-A/K1-B tendrá casa versionada cuando se cree; hasta entonces no se
  altera el estado de `eval/` ni se hace `git add`.
- **Estado:** `APROBADA` (diferida a la fase que cree la carpeta).

### Q-08 · Enmienda documental de G3

- **Resolución aprobada:** *Enmendar documentalmente G3 para retirar `dsh.client.inject` como requisito
  obligatorio, conservando la evidencia técnica y distinguiendo carga del cliente de orden de activación.*
- **Alcance:** se autoriza **redactar la propuesta** (`02` de esta carpeta). No se aplica al documento
  normativo; `PA-UI-0-ACCEPTANCE.md` no se modifica en este acto.
- **Consecuencias:** G3 sigue hoy con su redacción original; la enmienda se aplicará, si se aprueba, en una
  fase documental expresamente autorizada.
- **Estado:** `APROBADA` como propuesta; `PENDIENTE DE APLICACIÓN` en el documento normativo.

---

## 3. Lo que sigue pendiente (no se cierra aquí)

| Elemento | Estado literal | Qué lo movería |
|---|---|---|
| D-UI-03 · riesgo residual | `PENDING HUMAN DECISION` | decisión del propietario, por escrito, con controles compensatorios |
| Q-06 / TI-7 · responsable | `PENDING DESIGNATION` | designación nominal del propietario |
| Ruta A · capacidad de sesión del host | `BLOCKED` | primitiva documentada y probada del anfitrión |
| Ruta B · aislamiento topológico | `NOT DEMONSTRATED` | TI-1…TI-7 con evidencia reproducible y responsable |
| Ruta C · aceptación del riesgo | **no aceptada** | decisión del propietario (no es una ruta de G6) |
| GAP-20 | `OPEN / DOCUMENTED HOST LIMITATION` | cambio del anfitrión |
| PA01 | `BLOCKED` | Ruta A o B demostradas |
| G6 | `BLOCKED` | ídem |
| Enmienda G3 | `PENDIENTE DE APLICACIÓN` | fase documental autorizada sobre `PA-UI-0-ACCEPTANCE.md` |

---

## 4. Lo que este acto **no** hace

1. **No autoriza K1-A** ni ninguna implementación. Ninguna actividad de código queda habilitada.
2. **No aplica** la enmienda de G3: `PA-UI-0-ACCEPTANCE.md` conserva su texto y su hash.
3. **No habilita datos reales** ni el modo `live`.
4. **No declara** que el panel funcione: el cliente sigue sin cargar (defectos A-1 y A-3 de `01` §2.3).
5. **No ejecuta pruebas**: no se corrió `node --test`, ni `tools/check.mjs`, ni `tools/hermetic.mjs`.
6. **No toca** `MEMORY.md`, `AGENTS.md`, código, perfiles, almacenes ni credenciales.
7. **No modifica** los documentos `01`…`08`: sus hashes se re-verifican al cierre.

---

## 5. Condiciones que impiden certificar este registro

- Que un documento `01`…`08` haya cambiado de hash durante el acto.
- Que exista un destino previo en `K1-DECISIONS-RESOLUTION/` (no era el caso).
- Que aparezca una decisión que el propietario no aprobó presentada como aprobada.
- Que se haya aplicado la enmienda de G3 al documento normativo.

Ninguna se cumple. El detalle de la verificación va en el informe de cierre y en
`05-RESOLUTION-MANIFEST-SHA256.txt`.
