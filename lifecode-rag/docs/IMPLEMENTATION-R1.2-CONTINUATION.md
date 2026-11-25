# Punto de reanudación — R1.2

**Actualizado:** 2026-11-25 · **Estado:** integración local completada en `67e7c8cbb0c96069f305f7514740ecd910e04e6c`; sin push ni publicación.

## Dónde está el trabajo

- Worktree: `<WORKTREE>`
- Rama: `feature/project-memory-lifecycle`
- HEAD: `36148704e191d0689061b6b594135fe5e94d84bc` (base 1.5.11)
- Commit local: `67e7c8cbb0c96069f305f7514740ecd910e04e6c` (43 archivos); el árbol quedó limpio justo tras el commit.
- Árbol posterior: las actualizaciones de este punto y del informe de release-readiness quedan sin commit (documentación post-commit).
- Árbol original: **43 entradas** (31 modificadas y 12 no versionadas: las 10 originales, este punto y
  el informe de release-readiness), sin commit, sin stash, sin reset
- El árbol sucio del propietario (`<REPO>`) y el release
  (`<RELEASE>`) no se tocaron.

## Qué está cerrado

- Contrato `pa/1.6.0`, registro v4, provisión, movimiento, revocación, OFF/reactivación.
- F-02: limpieza durable de acceso anterior (`kind='cleanup'`), con reintento al arrancar.
- M3: host y CLI no deben compartir simultáneamente el mismo perfil; la cola reclama `running` sin dueño al arrancar.
- Rekey durable (`kind='rekey'`), exclusión del sync mientras está pendiente y reintento.
- Doble move: perdedor tardío, perdedor caído, compensación y reencolado de sync.
- Liveness de operaciones (`owner_pid`), guardas `cleanup-pending` y `concurrent-provision`.
- UI/panel: estados derivados del servidor, revocación parcial honesta, compatibilidad con 1.5.

## Evidencia de la última medición

```sh
cd <WORKTREE>/lifecode-rag
node --test --test-concurrency=1     # 810 tests, 810 pass, 0 fail, 0 skipped
node tools/check.mjs                 # limpio
node tools/hermetic.mjs              # 810 pass; almacén real sin cambios (6 ficheros)
```

- Base 1.5.11: 714/714.
- Migración v4 probada sobre copia del registro real: 3 proyectos, 3 raíces, 1 tracking,
  98 auditorías, 0 duplicados.
- Host aislado de laboratorio: `pa/1.6.0`, provisión/movimiento/rekey reales; el host quedó apagado.
- Almacén real `<HOME>/.dsh/lifecode-rag`: intacto (hermética).

## Documentos de referencia

- `docs/IMPLEMENTATION-R1.2-DECISIONS.md` — ADR D-01…D-26.
- `docs/IMPLEMENTATION-R1.2-FINAL-ACCEPTANCE.md` — informe de aceptación.
- `docs/IMPLEMENTATION-R1.2-CONTINUATION.md` — este punto de reanudación.

## Pendiente (requiere decisión humana)

1. Revisar el diff y decidir commit selectivo (nunca `git add -A`) y, si procede, PR.
2. El ciclo Host/UI tras D-26/R-1 ya se repitió en laboratorio sintético; queda decidir si se
   repite en un perfil real antes de instalar (fuera de esta aceptación).
3. Instalación en perfil real, publicación o activación: fuera de esta aceptación y requiere
   autorización expresa.

## No tocar al reanudar

- `<HOME>/.dsh/lifecode-rag` — almacén real; sólo copias en `mkdtemp`.
- `<REPO>` — árbol sucio del propietario.
- `<RELEASE>` — release 1.5.11 intacto.
- No recrear el worktree ni descartar las 43 entradas.
