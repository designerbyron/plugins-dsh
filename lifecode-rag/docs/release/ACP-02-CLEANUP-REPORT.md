# ACP-02-CLEANUP — Eliminación de la sonda sintética

**Resultado: PASS**
**Fecha:** 2026-11-22 21:36 (hora local)
**Vía:** herramienta oficial `lifecode_rag_forget`, con aprobación del propietario en la tarjeta del host
**Destino único:** `src_8fd3518f8ae5b262` en el proyecto `plugins-dhs`

---

## 1. Verificación previa (sólo lectura)

| Comprobación | Resultado |
|---|---|
| `sourceId` en el scope `prj_01M7TRDQYRAPJR03QTM3PP6PX2` (`plugins-dhs`) | Sí: 1 fuente, `src_8fd3518f8ae5b262`, 473 B, 1 fragmento |
| Marcador `ACP02-PROBE-2026-11-22` | Presente en el texto indexado |
| `sha256` indexado | `049a0c1f4f3b8e1a5249fd10f43f0e7a8da50eadba47be1307762ce1703f0970` = el del fichero en disco |
| Proyecto activo del perfil | `LifeCode RAG` (`prj_01M7RBSRD33M26HGBEFW51WPP6`, rev. 3) — distinto del de la sonda |
| Resolución del proyecto por la herramienta | por `cwd` de la sesión (`C:\xampp\htdocs\plugins-dhs`) → `plugins-dhs`, igual que el `ingest` que la creó |
| Almacén `LifeCode RAG` antes | 121 fuentes, 964 fragmentos, `quick_check=ok`, sha256 `4dcf31c4cb7058bb37528ad2c35ec33faa171ff003ad1faffb3bfec8b2472ae5` |

## 2. Ejecución

Sesión `session-58adcd06-…` (workspace `plugins-dhs`, **Modo estándar**), turno 9:

| seq | evento | contenido |
|---|---|---|
| 172 | `tool/call` | `lifecode_rag_forget {"ref": "src_8fd3518f8ae5b262"}` |
| 173 | `approval/asked` | «Eliminar la fuente src_8fd3518f8ae5b262 (C:\xampp\htdocs\plugins-dhs\ACP02-INGEST-PROBE.md) de proyecto plugins-dhs (prj_01M7TRDQYRAPJR03QTM3PP6PX2) y todo su índice» |
| 174 | `approval/decided` | `allowed-once` — concedida por el propietario en la interfaz |
| 175 | `tool/result` | `eliminada C:\xampp\htdocs\plugins-dhs\ACP02-INGEST-PROBE.md (1 chunks)` · `isError: false` |
| 181 | `tool/result` | `lifecode_rag_list (limit 5)` → `{"total":0,"rows":[]}` |

El modelo no usó SQL, no tocó ninguna otra fuente y no llamó a `ingest` ni a `reindex`.

## 3. Verificación posterior

| Comprobación | Antes | Después |
|---|---|---|
| Fuentes en `plugins-dhs` | 1 | **0** |
| Fragmentos huérfanos | 1 | **0** |
| Marcador en el scope | presente | **ausente** |
| Auditoría del scope | 3 entradas | **4**: `seq 4 · lifecode_rag_forget · src_8fd3518f8ae5b262 · ok` |
| sha256 `scopes/prj_01M7TRDQYRAPJR03QTM3PP6PX2/rag.sqlite3` | `a4d2644d86f528bf6550d450…` | `6130ecbae17b8e8241c792a0…` (esperado: borrado + fila de auditoría) |
| sha256 `scopes/prj_01M7RBSRD33M26HGBEFW51WPP6/rag.sqlite3` (LifeCode RAG) | `4dcf31c4cb7058bb37528ad2c35ec33faa171ff003ad1faffb3bfec8b2472ae5` | **idéntico** |
| LifeCode RAG: fuentes · fragmentos · `quick_check` | 121 · 964 · ok | **121 · 964 · ok** |
| sha256 `registry.sqlite3` | `691fccc3c98223c69fc22c6d…` | `7fff797914ece56f90d2060f…` (esperado: filas de auditoría de registro de las llamadas) |
| `-wal` de ambos scopes | — | 0 B |

La base del proyecto `LifeCode RAG` está **bit a bit igual**: no se abrió en escritura en todo el acto.

## 4. Estado que queda

- La fuente sintética ya no está indexada en ningún proyecto.
- El fichero `C:\xampp\htdocs\plugins-dhs\ACP02-INGEST-PROBE.md` (473 B) **sigue en disco**: el `forget`
  retira la entrada del índice, no el documento. No lo he borrado porque el encargo prohíbe el borrado
  manual de archivos; queda a tu disposición borrarlo o reutilizarlo como fixture.
- El registro del perfil conserva las 76+ entradas de auditoría; la del `forget` es la `seq 4` del scope
  `plugins-dhs`.

## 5. Veredicto

**PASS.** Fuente eliminada por la vía oficial, con aprobación explícita registrada, sin mecanismos
alternativos, y con el proyecto `LifeCode RAG` verificado intacto por hash (`4dcf31c4…` antes y después),
121 fuentes, 964 fragmentos y `quick_check=ok`.
