# Punto de reanudación — R1.2

**Actualizado:** 2026-11-25 · **Estado:** aceptación técnica cerrada; sin commit ni publicación.

## Dónde está el trabajo

- Worktree: `C:/xampp/htdocs/plugins-dhs-memory-lifecycle`
- Rama: `feature/project-memory-lifecycle`
- HEAD: `36148704e191d0689061b6b594135fe5e94d84bc` (base 1.5.11)
- Árbol: **43 entradas** (31 modificadas y 12 no versionadas: las 10 originales, este punto y
  el informe de release-readiness), sin commit, sin stash, sin reset
- El árbol sucio del propietario (`C:/xampp/htdocs/plugins-dhs`) y el release
  (`C:/xampp/htdocs/plugins-dhs-release/lifecode-rag`) no se tocaron.

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
cd C:/xampp/htdocs/plugins-dhs-memory-lifecycle/lifecode-rag
node --test --test-concurrency=1     # 805 tests, 805 pass, 0 fail, 0 skipped
node tools/check.mjs                 # limpio
node tools/hermetic.mjs              # 805 pass; almacén real sin cambios (6 ficheros)
```

- Base 1.5.11: 714/714.
- Migración v4 probada sobre copia del registro real: 3 proyectos, 3 raíces, 1 tracking,
  98 auditorías, 0 duplicados.
- Host aislado de laboratorio: `pa/1.6.0`, provisión/movimiento/rekey reales; el host quedó apagado.
- Almacén real `C:/Users/BYRON/.dsh/lifecode-rag`: intacto (hermética).

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

- `C:/Users/BYRON/.dsh/lifecode-rag` — almacén real; sólo copias en `mkdtemp`.
- `C:/xampp/htdocs/plugins-dhs` — árbol sucio del propietario.
- `C:/xampp/htdocs/plugins-dhs-release/lifecode-rag` — release 1.5.11 intacto.
- No recrear el worktree ni descartar las 43 entradas.
