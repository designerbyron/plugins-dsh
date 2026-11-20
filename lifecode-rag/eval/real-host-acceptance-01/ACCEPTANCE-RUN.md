# Aceptación pedida por el propietario — ejecución real

**Fecha:** 2026-11-19 14:40 (local) · **Sesión:** `session-c90d50d6-aa3d-4330-a9c8-76b21dc0f188`
**Perfil:** `desktop` · **Proyecto seleccionado:** `LifeCode RAG` (`prj_01M7RBSRD33M26HGBEFW51WPP6`)

## 0 · Quien ejecuta

Hermes **no tiene** `lifecode_rag_search` en su juego de herramientas (`tool_search`: 0 coincidencias; es un
proceso distinto de DSH). La ejecución se hizo con las **definiciones de producción** (`createToolDefinitions`,
el mismo código que el host registra) contra el **almacén real**, con la sesión real. No es una llamada del
modelo dentro de DSH, y no se presenta como tal.

## 1 · Primer intento, desde el cwd del workspace (`…\plugins-dhs`)

```
scope-ambiguous — «el directorio de trabajo no corresponde a la selección explícita»
details.session_id      = session-c90d50d6-…
details.selected_project= prj_01M7RBSRD33M26HGBEFW51WPP6   (LifeCode RAG)
details.candidates[]    = [{ project_id: prj_01M7TRDQYRAPJR03QTM3PP6PX2, path: …\plugins-dhs }]
```

**Causa medida:** a las **14:36:59** el host descubrió un segundo proyecto, `plugins-dhs`
(`prj_01M7TRDQYRAPJR03QTM3PP6PX2`, raíz `…\plugins-dhs`, `authorized`), con auditoría `project.discover` +
`scope.resolve ok` (`seq 45-46`, actor `host`). Desde entonces, el cwd del workspace resuelve a ese proyecto
distinto del seleccionado y la resolución **falla en cerrado** en lugar de buscar en el proyecto equivocado.

## 2 · Ejecución con `cwd` coherente con la selección (`…\plugins-dhs\lifecode-rag`)

- `list` → **121 fuentes**.
- `search "project-aware"` → **3 resultados**, modo `and`, 34 ms.

| # | `sourceId` | `uri` | Sección |
|---|---|---|---|
| 1 | `src_a26afe7725768150` | `C:\xampp\htdocs\plugins-dhs\lifecode-rag\docs\PROJECT-AWARE-ERROR-CONTRACT.md` | 2. Códigos |
| 2 | `src_c3f912136c2f1107` | `C:\xampp\htdocs\plugins-dhs\lifecode-rag\docs\PROJECT-AWARE-ARCHITECTURE.md` | 18.5 Ciclo de vida y convivencia con v0.2 |
| 3 | `src_c3f912136c2f1107` | `C:\xampp\htdocs\plugins-dhs\lifecode-rag\docs\PROJECT-AWARE-ARCHITECTURE.md` | 19. Hardening de calidad (2026-11-18) |

- `get src_a26afe7725768150` → **10 fragmentos**, título «Contrato de errores — Project-Aware RAG (PA0)»,
  11 168 caracteres de texto.

## 3 · Resumen del contenido recuperado

El documento fija la semántica de errores del proyecto Project-Aware:

- **Regla transversal:** un error de seguridad, permisos o integridad **nunca** se convierte en un resultado
  vacío aparentemente exitoso; si no se puede demostrar que la consulta está autorizada, se falla en cerrado
  con su código.
- **Cinco familias:** Selección, Autorización, Integridad, Infraestructura y Sincronización.
- **Códigos** con `details` mínimos y efecto: `scope-unresolved`, `scope-ambiguous` (el que disparó el primer
  intento), `scope-forbidden`, `path-escape`, `root-overlap`, `root-symlink`, `root-changed`,
  `scope-store-unavailable`, `scope-store-corrupt`, `session-invalid`, `session-expired`, `grant-revoked`,
  `sync-root-unavailable`.
- **Revocación durante una operación:** la autorización se fija como instantánea al inicio y cada ámbito se
  revalida antes de abrirse y antes de devolver nada; si uno pierde la autorización, la operación falla en
  cerrado y **no entrega ni el resultado parcial** de los ámbitos que seguían autorizados.
- **Clasificación:** en v0.1 el fallo total es el único desenlace; el fallo parcial no existe (propuesta para
  v0.3 documentada y no implementada, `D-PA4-F-01`).
- **Prohibiciones:** convertir un error en «sin resultados»; tratar una fuente `missing` como error (es un
  estado); convertir la ausencia de una biblioteca en una biblioteca vacía.
- **Futuro:** correspondencia HTTP estable (400/403/409/422/503) y UI que muestra código + texto humano.

## 4 · Escrituras declaradas

| Dónde | Antes | Después |
|---|---|---|
| `audit_registry` (registro) | 46 | **50** |
| — de esas, de esta ejecución | — | **4**: 1 `denied` (14:40:18) + 3 `scope.resolve ok` (14:40:45) |
| `metrics_daily` (almacén del proyecto) | 16 filas | 16 filas; **1 actualizada**: `query.ms_bucket/10-25 = 3`, `updated_at` 14:40:45 |
| `audit` del almacén del proyecto | 141 | 141 |
| `sources` / `chunks` / `vectors` | 121 / 964 / 964 | 121 / 964 / 964 |

Las dos primeras filas de `audit_registry` de la sesión anterior (`seq 45-46`, 14:36:59) **no son mías**: son
del host, que descubrió el proyecto `plugins-dhs` antes de esta ejecución.

No se ejecutó `ingest`, `forget`, `reindex`, ni se cambió selección, raíces o configuración.

## 5 · Conclusión

- La herramienta funciona contra el almacén real y devuelve documentos reales.
- **El error de resolución es real y actual**: con el workspace `plugins-dhs` abierto y un proyecto propio
  descubierto por el host, la sesión con selección explícita a `LifeCode RAG` queda en `scope-ambiguous` para
  cualquier llamada lanzada desde la raíz del workspace.
- Decisión del propietario: o se selecciona `plugins-dhs` para esa sesión, o se archiva/elimina el proyecto
  descubierto. Ninguna de las dos se ha hecho.
