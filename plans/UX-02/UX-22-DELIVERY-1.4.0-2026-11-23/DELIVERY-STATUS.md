# DELIVERY-STATUS — LifeCode RAG 1.4.0

**Acto:** HANDOFF T3 — expediente de entrega. **Tipo:** exclusivamente documental y de preparación.
**Fecha:** 2026-11-23. **Ejecución de la instalación:** no autorizada, no iniciada.

> **Actualización (mismo día, acto posterior):** la instalación se autorizó y se ejecutó. El estado vigente está en
> `INFORME-INSTALACION.md`; este documento conserva el estado **previo** a la ejecución, tal como se firmó.

## 1. Dictamen

| Afirmación | Estado |
|---|---|
| **Artefacto aprobado** | Sí — SHA-256 autorizado `7bbecb09482dcc36290956a7623b2247414c99fc42cc1b58caf22ce8dbca132b`, **re-verificado hoy** en su ruta |
| **Expediente preparado** | Sí — cinco documentos (§3) + manifiesto de integridad |
| **Instalación ejecutada** | **No** |
| **Publicación ejecutada** | **No** |
| **Host modificado** | **No** — sin cambios en perfil, `cordis.patch.yml`, datos, roots, grants ni configuración |

## 2. Entorno medido hoy (base del expediente)

| Elemento | Valor |
|---|---|
| Perfil de destino | `C:\Users\BYRON\.dsh\profiles\desktop` (paquete declarado + `profile_root` del almacén) |
| Instalado | `1.3.0`, 74 ficheros, `index 23ed6951…`, `client ff8119dd…`, `pa-api 14ff188d…` |
| Host | `0.2.2-rc.3` · node `24.21.0` · pnpm `11.28.5` · `nodeLinker: hoisted` |
| Host en ejecución | **no** (0 procesos electron/dsh) |
| `minimumReleaseAge` | **1440 min** efectivo; exclusiones **sin** `1.4.0` |
| Registro | v2 · 3 proyectos · 3 raíces · 0 grants · 0 bibliotecas · auditoría `seq 88` / `4c926da2…` |
| Almacén | 10 ficheros · `registry 4b67cadc…`, ámbito principal `4dcf31c4…` (121 fuentes, 964 chunks, 964 vectores, `schema_version 3`), ámbito secundario `6130ecba…` (0/0/0), `config b15622c0…` |
| Delta del paquete | 63 idénticos · 11 cambiados (8 `lib/` + `package.json` + `README` + un contrato) · 1 nuevo · 0 eliminados |
| Contrato PA | **`pa/1.4.0` en ambas versiones** — sin salto |

## 3. Entregables

| Documento | Contenido |
|---|---|
| `ARTIFACT-MANIFEST.md` | identidad inmutable del TAR, inventario, manifiesto de integridad, auditoría y delta real frente a 1.3.0 |
| `DELIVERY-PLAN.md` | perfil, instalación actual, ficheros que cambiarían, procedimiento quirúrgico, puertas G1-G8, abortos y lo no confirmable |
| `BACKUP-AND-ROLLBACK.md` | conjunto lógico a preservar con hashes, procedimiento de respaldo, verificación y reversión con criterios de éxito |
| `POST-INSTALL-VALIDATION.md` | matriz M1-M12 (prueba, esperado, método, evidencia, fallo, reversión) |
| `DELIVERY-STATUS.md` | este documento |
| `DELIVERABLES.sha256` | manifiesto de los cinco documentos (LF, `hash *ruta`) |

## 4. Estado Git

| | Antes del acto | Después |
|---|---|---|
| Rama / HEAD | `release/lifecode-rag-1.0.0` / `7d7e839d514cca27044d595218bf8c67ec5a1f7d` | **idénticos** |
| Índice | vacío | **vacío** |
| `git status` | 54 (27 M / 27 ??) | **54 (27 M / 27 ??)** |

Los cinco documentos se añadieron **dentro de** `plans/UX-02/`, que ya era una entrada no rastreada: el recuento no
cambia y **ningún fichero preexistente se tocó**. Los 27 `M` siguen siendo los mismos (18 preexistentes + 9 del ciclo
de optimización) y las ocho huellas de código del núcleo siguen siendo las revisadas y empaquetadas. No hubo commit,
merge, rebase, push, reset, clean ni stash.

## 5. Lo que falta para poder instalar (no es defecto; es el estado)

1. **Autorización humana explícita** del acto de instalación, atada al hash `7bbecb09…` del artefacto y al hash de
   este expediente.
2. **Host cerrado** durante la operación (ahora lo está) y re-medición del `-wal` a 0 B justo antes.
3. **Añadir `|| 1.4.0`** a la exclusión de `minimumReleaseAge` en `pnpm-workspace.yaml` **y** en el estado de pnpm,
   como parte de la misma transacción.
4. **Sesión del propietario** para M3 y M11 (las dos casillas que no se pueden cerrar sin él).
5. Ejecutar el humo funcional (M12) en el **laboratorio aislado**, no en el perfil.

## 6. Riesgos y límites declarados

- El perfil **se mueve solo**: el actualizador del Host puede reescribir `package.json`, `pnpm-lock.yaml` y
  `pnpm-workspace.yaml` al abrirlo. Las huellas de este expediente son la base de hoy; si cambian antes del acto, se
  re-miden y se declara el delta ajeno con su hora.
- `.modules.yaml` guarda `@designerbyron/lifecode-rag@1.3.0` en su mapa hoisted: hay que reconciliarlo o dejar que el
  Host lo reescriba, y verificarlo (M10).
- `client.js` e `index.js` **no cambian**, así que no se espera ningún efecto visual nuevo; si el panel mostrara algo
  distinto, sería otro cambio y se investigaría antes de firmar.
- No se ha abierto el almacén real en este acto: todas las lecturas se hicieron sobre copias en el scratch, para no
  crear `-shm`/`-wal` en el directorio del propietario.

## 7. Parada

El acto termina aquí. **No se avanza a la instalación.** La ejecución será un acto separado y requerirá autorización
humana explícita sobre este expediente y sobre el hash del artefacto.
