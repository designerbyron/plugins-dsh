# Informe del acto preparatorio — publicación de LifeCode RAG 1.3.0

**Estado:** **PREPARACIÓN COMPLETA** · **Publicación: NO EJECUTADA** · **Instalación en DSH: NO EJECUTADA**
**Fecha:** 2026-11-23T02:56–02:59Z (2026-11-22 20:56–20:59 local, UTC-06)
**Worktree:** `C:\xampp\htdocs\plugins-dhs-release` · rama `release/lifecode-rag-1.0.0` · HEAD `7d7e839`
**Entorno:** Node v24.21.0 · npm 11.19.0 · registro `https://registry.npmjs.org/`

---

## 1. Resultado en una línea

El artefacto está **respaldado y verificado**, la **identidad npm está comprobada** (`designerbyron`,
`read-write`, paquete **public**, 2FA **`auth-and-writes`**), el **registro está medido** (la 1.3.0 **no
existe** y no hay conflictos), y el **procedimiento de publicación y la verificación posterior están
escritos con valores esperados fijados de antemano**. Nada se ha publicado ni instalado.

## 2. Fases

| Fase | Qué se hizo | Documento | Estado |
|---|---|---|---|
| A · Protección y respaldo | Hash y tamaño re-verificados contra los autorizados; copia en `artifact-backup/` **byte a byte idéntica**, protegida como solo lectura | `ARTIFACT-BACKUP-VERIFICATION.md` | PASS |
| B · Identidad y acceso | `npm whoami` = `designerbyron`; permisos `read-write`; `tfa.mode = auth-and-writes`; registro correcto; sin leer credenciales | `NPM-IDENTITY-AND-ACCESS.md` | PASS |
| C · Estado del registro | 4 versiones (`0.0.0-stage`, `1.0.0`, `1.1.0`, `1.2.0`); `latest = 1.2.0`; **1.3.0 libre**; `public`; licencia MIT coherente; `fileCount` 73 → 74 | `NPM-REGISTRY-STATUS.md` | PASS |
| D · Procedimiento | Directorio, comando exacto con el `.tgz`, 2FA/OTP, resultado esperado, errores y actuación segura | `PUBLISH-PROCEDURE.md` | PASS (documentado, no ejecutado) |
| E · Verificación posterior | Comandos de sólo lectura y criterios V1–V5 con los valores esperados | `POST-PUBLISH-VERIFICATION.md` | PASS (documentado, `NOT RUN`) |

## 3. Matriz de controles

| # | Control | Resultado | Estado |
|---|---|---|---|
| A1 | Artefacto original existe | 310 675 B | PASS |
| A2 | SHA-256 del original = autorizado | `f848b73e…` | PASS |
| A3 | SHA-512 del original = autorizado | `43f12f0d…` | PASS |
| A4 | Respaldo creado en directorio exclusivo | `artifact-backup/…tgz` | PASS |
| A5 | Respaldo = original byte a byte (`cmp`) | sin diferencias | PASS |
| A6 | Hashes del respaldo = del original (2 instrumentos) | sí (`sha256sum`/`sha512sum` + `certutil`) | PASS |
| A7 | Respaldos/evidencias previas preservados | UX-2.1: 38/38 OK | PASS |
| B1 | `npm --version` / `node --version` | 11.19.0 / v24.21.0 | PASS |
| B2 | `npm whoami` | `designerbyron` (exit 0) | PASS |
| B3 | Registro configurado | `https://registry.npmjs.org/` | PASS |
| B4 | Acceso al paquete | `lifecode-rag => read-write` | PASS |
| B5 | Permiso de publicación | `read-write` sobre paquete `public` | PASS |
| B6 | Estado 2FA | `tfa.mode = auth-and-writes` | PASS (medido) |
| B7 | Secretos expuestos | **ninguno** (no se abrió `.npmrc`) | PASS |
| C1 | Paquete existe y es público | HTTP 200 · `access: public` | PASS |
| C2 | Versiones publicadas | 4 (hasta `1.2.0`) | PASS |
| C3 | `dist-tags` | `latest: 1.2.0` | PASS |
| C4 | ¿Existe 1.3.0? | **no** (HTTP y `npm view` E404, con la hora cruzada) | PASS |
| C5 | Conflicto de versión | ninguno | PASS |
| C6 | Licencia coherente (registro vs artefacto) | MIT en ambos | PASS |
| C7 | Integridad de 1.3.0 si existiera | no aplica: no existe | NOT APPLICABLE |
| D1 | Procedimiento con comando exacto sobre el `.tgz` | `PUBLISH-PROCEDURE.md` §1 | PASS |
| D2 | Tratamiento de 2FA/OTP documentado | §2–§4, OTP sólo del propietario | PASS |
| D3 | Errores y actuación segura | §5 (E401/EOTP/E403/E404/E409/timeout) | PASS |
| D4 | Verificación posterior preparada | `POST-PUBLISH-VERIFICATION.md` | PASS |
| E1 | Comandos de verificación ejecutados | — | NOT RUN (no hay nada publicado) |
| P1 | `npm publish` | — | NOT RUN (prohibido por el mandato) |
| P2 | Instalación / actualización DSH | — | NOT RUN (prohibido) |

**Recuento:** 24 PASS · 0 FAIL · 0 BLOCKED · 1 NOT APPLICABLE · 3 NOT RUN (los tres por prohibición expresa).

## 4. Hallazgos (ninguno bloquea la preparación; dos condicionan la publicación)

| # | Hallazgo | Efecto |
|---|---|---|
| H1 | **Hay sesión npm activa** (`designerbyron`) y `~/.npmrc` existe, aunque una nota previa de operación decía que no. La medición manda: se documenta la discrepancia y se corrige la nota | el procedimiento puede apoyarse en esa sesión |
| H2 | **`tfa.mode = auth-and-writes`** | publicar exigirá **una aprobación por operación**; el OTP es del propietario y el agente no lo pide ni lo consume |
| H3 | `npm publish` puede **redactar la URL de aprobación** en su mensaje de error (medido en actos anteriores del proyecto) | si ocurre, se usa la vía B (`PUT` con `npm-auth-type: web`) o publica el propietario (§3 del procedimiento) |
| H4 | `latest` pasará de `1.2.0` a `1.3.0` al publicar | es el comportamiento esperado; **no** se tocarán dist-tags a mano |
| H5 | `dist.fileCount` 73 → 74 | discriminador útil: un stub (2 ficheros) se detecta al instante |

## 5. Límites y riesgos residuales

- **La publicación no está ejecutada** y no se declara «lista para publicar» en el sentido de que el acto
  productivo está hecho: está **preparado**. Falta la autorización humana explícita.
- El flujo 2FA concreto (PTY + aprobación web) está documentado a partir de la referencia del proyecto y de
  actos anteriores; **no se ha re-medido hoy** porque hacerlo exige iniciar una publicación. Estado de esa
  parte: `NOT RUN`, y así se declara en el procedimiento.
- La propagación tras el `202` es asíncrona (minutos). No se declara «publicado» hasta que metadata **y**
  tarball estén disponibles y los hashes cuadren.
- Nada de lo preparado instala el paquete ni lo prueba en DSH: eso exige otro acto.

## 6. Estado final de Git y de los artefactos

| Dato | Valor |
|---|---|
| HEAD | `7d7e839d514cca27044d595218bf8c67ec5a1f7d` (sin cambios) |
| Rama | `release/lifecode-rag-1.0.0` |
| Índice | **vacío** |
| Worktree | 32 entradas (las mismas); sólo crece `plans/UX-02/` |
| Commits / merges / tags / pushes | **ninguno** |
| Artefacto original | sha256 `f848b73e…`, intacto |
| Respaldo | sha256 `f848b73e…`, solo lectura |
| Entregables UX-2.1 | **38/38 OK** |

## 7. Confirmación expresa

- **No** se ejecutó `npm publish` ni ninguna otra escritura contra el registro.
- **No** se solicitó, leyó ni consumió ningún OTP; **no** se leyó ningún token ni el contenido de `.npmrc`.
- **No** se modificó `.npmrc`, credenciales, permisos, dist-tags ni configuración global.
- **No** se instaló ni actualizó el paquete en DSH ni en ningún consumidor.
- **No** se hicieron commits, merges, tags ni pushes; **no** se modificó ningún worktree.
- **No** se tocaron los datos RAG ni los sidecars SQLite.

## 8. Entregables de este acto

`PUBLISH-PREPARATION-REPORT.md` · `ARTIFACT-BACKUP-VERIFICATION.md` · `NPM-IDENTITY-AND-ACCESS.md` ·
`NPM-REGISTRY-STATUS.md` · `PUBLISH-PROCEDURE.md` · `POST-PUBLISH-VERIFICATION.md` · `DELIVERABLES.sha256` ·
`artifact-backup/designerbyron-lifecode-rag-1.3.0.tgz` · `evidence/` (10 logs de las verificaciones).

**Me detengo aquí**, como pide el mandato. La publicación queda pendiente de autorización humana explícita.
