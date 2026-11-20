# LE-RAG-05 · Revisión final de la copia

Copia: `C:\xampp\htdocs\plugins-dhs-le-rag-01` · Baseline: 130 ficheros con hash · Original: `b6c0cd2`, manifiesto idéntico.

## 1 · Inventario del diff (LE-RAG-01 → 05)

**Modificados (6):** `index.js` · `lib/tools.mjs` · `lib/diagnose.mjs` · `lib/doctor.mjs` ·
`lib/sync-scheduler.mjs` · `lib/automation.mjs`.

**Nuevos (24):**

| Área | Ficheros |
|---|---|
| Core | `lib/config-resolve.mjs`, `lib/conversation-events.mjs`, `lib/worker-context.mjs` |
| Pruebas | `tests/config-resolve`, `tests/conversation-events`, `tests/conversation-events-edge`, `tests/tool-golden`, `tests/config-consumers`, `tests/worker-context`, `tests/standalone` (7) |
| Benchmarks | `bench/bench.mjs`, `bench/bench-real.mjs`, `bench/last-run.json`, `bench/real-run.json` |
| Evidencia | `eval/le-rag-03/functional.mjs` + informe, `eval/le-rag-04/seven-tools.mjs` + informe |
| Documentación | `docs/LE-RAG-01-ARCHITECTURE.md`, `-02-COMPLETION`, `-03-RELEASE`, `-04-DECISIONS-AND-SPEC`, `-05-CLIENT-AUDIT`, `-05-FINAL-REVIEW` (6) |

**Sin tocar:** `package.json` (cero dependencias npm nuevas), `tools/check.mjs`, `client.js`, el esquema
SQLite, `skill-compiler/`, `lifecode-skill-center/`, `MEMORY.md`, `AGENTS.md`.

## 2 · Compatibilidad de contratos

- **Herramientas:** las 7 conservan nombre, parámetros y forma de resultado; `search` no admite `diversity`
  por llamada (sólo configuración).
- **API v0.2:** intacta; su `config.json` sigue siendo suyo.
- **Trabajadores:** `createAutomation` y `createSyncScheduler` ganan `config`/`dataRoot` opcionales; sin ellos
  el comportamiento es el histórico (probado con las 13 pruebas del programador).
- **Eventos:** contrato nuevo, sin consumidores reales todavía.

## 3 · Coherencia de los cuatro ámbitos de configuración

| Ámbito | Fichero | Quién lo lee | Quién escribe |
|---|---|---|---|
| Global | `<dataRoot>/config.json` | resolvedor (plugin, tools, diagnose, doctor, trabajadores con `dataRoot`) | instalación / operador |
| Perfil | `<dataRoot>/profiles/<key>/config.json` | igual | operador / CLI de perfil |
| API v0.2 | `config.json` de la raíz legacy | `server`/`readmodel` | su propia ruta de escritura |
| Trabajadores | los tres anteriores, en ese orden | `workerConfig` | nadie (sólo leen) |

Ninguna ruta escribe en otra: el panel no puede tocar el archivo global ni el de perfil (ADR-02).

## 4 · Independencia del Harness

- Gate `tools/check.mjs`: sin imports de `@deepseek-ai/*` en core, manifiesto y parche correctos.
- `tests/standalone.test.mjs`: escaneo de imports estáticos, `import()` y `require()` con comentarios
  descartados; motor y persistencia funcionan con `LIFECODE_RAG_DATA`, sin `DSH_PROFILE` ni DSH instalado.
- `client.js` (propio) y `index.js` son la única frontera con el host.

## 5 · Persistencia y seguridad SQLite

WAL, `quick_check` ok en la copia; sondas con `readOnly`; `path-denied` impide ingerir rutas dentro del
almacén; ingesta de prueba fuera del store y escritura sólo en la copia. Original con hash `4dcf31c4…` al
cierre; la copia cambió (`27839d44…`) por ingest/forget/reindex, como se esperaba.

## 6 · Autorización y aislamiento (medido)

| Caso | Resultado |
|---|---|
| `cwd` = raíz del proyecto | autorizado, 121 fuentes |
| `cwd` = `C:/Windows` con sesión que tiene selección explícita | autorizado (la selección manda: diseño) |
| `cwd` = repo padre | `scope-ambiguous` con `candidates[]` |
| `cwd` con `..` hacia el repo padre | `scope-ambiguous` (realpath normaliza, sin traversal) |
| `cwd` ajeno + sesión desconocida | `scope-unresolved` |

Sin rutas fuera de los roots autorizados; dos proyectos no comparten contexto en ningún caso probado.
El comportamiento es el mismo en las siete herramientas (todas pasan por `resolveScope`).

## 7 · Validación final

- Suite: **396/396 pass**.
- `tools/check.mjs`: verde.
- Configuración: 10 pruebas (resolvedor + consumidores + perfiles).
- Trabajadores: 5 + 13 históricas.
- Eventos: 6 + 7 de casos límite.
- Siete herramientas sobre copia real: ingest, search, context, get, list, forget, reindex + errores y auditoría (145 → 149).
- Benchmarks: no repetidos (ningún cambio en la ruta de búsqueda desde LE-RAG-03).
- Original verificado contra manifiesto.

## 8 · Riesgos residuales

1. **Adaptadores de otros hosts:** no existen todavía; el contrato de eventos está listo, sin implementación.
2. **`WorkspaceContextProvider`/`ToolRegistrar`/`LifecycleProvider`:** descartados a propósito; un segundo host podría exigirlos.
3. **Defectos F-1…F-6 del cliente externo:** son suyos, no nuestros; documentados sin copiar código.
4. **Benchmarks de trabajadores** (tick/backoff) sin medir.
5. **Integración de memoria conversacional** no autorizada en esta fase.

## 9 · Veredicto

La copia está **lista para una fase de integración independiente**: contratos preservados, suite verde,
hermeticidad probada, cero dependencias nuevas, evidencia reproducible y original intacto. La integración
en `plugins-dhs` **no se ejecuta** aquí.
