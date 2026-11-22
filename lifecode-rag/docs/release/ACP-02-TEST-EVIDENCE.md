# ACP-02 — Evidencia de pruebas

Todos los comandos se ejecutaron en `C:\xampp\htdocs\plugins-dhs\lifecode-rag` sobre el árbol que
alimenta el snapshot instalado `acp01-576b8d836ad7`.

## 1. Suite completa

```
$ npm test
ℹ tests 448
ℹ pass 448
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 47093.6
```

448 = 433 de ACP-01 + 15 nuevos (8 de `error-codes`, resto de historial y cliente). `--test-concurrency=1`
para eliminar la intermitencia de WAL en Windows.

## 2. Catálogo de errores

```
$ node --test tests/error-codes.test.mjs
✔ todo código lanzado en lib/ y en las herramientas está catalogado (…)
✔ todo código catalogado tiene status HTTP y ninguno de seguridad cae en 5xx (…)
✔ las diferencias de la API heredada son explícitas y sólo tocan códigos catalogados
✔ un código desconocido no se convierte en silencio y no pasa por seguridad
✔ las dos APIs responden con el mapa común (sin tablas locales)
✔ los códigos del contrato del panel tienen el status documentado
ℹ tests 8 · pass 8 · fail 0
```

## 3. Pureza del núcleo y manifiesto

```
$ npm run check
✓ 7 herramientas, sin dependencias de @deepseek-ai/*, manifiesto y parche correctos
  (G3: exports["./client"] resoluble, cliente con la API de slots vigente)
```

## 4. Hermeticidad

```
$ npm run test:hermetic
ℹ tests 448 · pass 448 · fail 0
✓ hermético: el almacén real no cambió (6 fichero(s))
```

La puerta mide `sha256` + tamaño de cada fichero de `C:\Users\BYRON\.dsh\lifecode-rag\profiles\desktop`
antes y después de la suite. Ninguna prueba tocó el almacén real. El recuento de ficheros varía entre
ejecuciones (8 en una pasada anterior, 6 ahora) porque incluye los `-wal`/`-shm` transitorios de SQLite:
la puerta compara fichero a fichero los que existen en cada medición, y en ambas el resultado fue
«no cambió».

## 5. Invocaciones reales, del transcript de la sesión

Fichero: `C:\Users\BYRON\.dsh\sessions\--C-xampp-htdocs-plugins-dhs--\session-ecd9d513-5aa4-4325-b2c0-fb4b13fdf7c4\session.v4.jsonl.zstd`
(multiframe; se lee recorriendo la magia `28 B5 2F FD`, no con una sola descompresión).

| seq | evento | contenido |
|---|---|---|
| 21 | `tool/call` | `lifecode_rag_ingest {"paths": "C:/xampp/htdocs/plugins-dhs/ACP02-INGEST-PROBE.md"}` |
| 27 | `tool/call` | `lifecode_rag_list {"limit": 5}` |
| 33 | `tool/call` | `lifecode_rag_search {"query": "reembolso", "limit": 3}` |
| 39 | `tool/call` | `lifecode_rag_context {"query": "reembolso", "budgetTokens": 400}` |
| 45 | `tool/call` | `lifecode_rag_get {"ref": "src_8fd3518f8ae5b262"}` |

Resultados devueltos por el host: `ingeridos: 1, omitidos: 0, errores: 0`; `total: 1` con `sha256`
`049a0c1f…`; 1 coincidencia con `rrf 0.06557` en 6 ms; contexto de 386 tokens con cita; 1 fragmento con
el marcador `ACP02-PROBE-2026-11-22`.

Compuerta de escritura (misma sesión):

| seq | evento | contenido |
|---|---|---|
| 2 | `approval/policy` | `never` |
| 61 | `approval/asked` | `lifecode_rag_forget` · «Eliminar la fuente src_8fd3518f8ae5b262…» |
| 62 | `approval/decided` | `rejected` |

La herramienta devolvió «la operación necesita aprobación humana» y **no** borró nada: el recuento de
fuentes siguió en 1. Es el comportamiento correcto de un cierre en cerrado.

## 6. Almacén real (sólo lectura)

```
registro  ~/.dsh/lifecode-rag/profiles/desktop/registry.sqlite3   quick_check=ok, user_version=2
proyectos 2 (LifeCode RAG · prj_01M7RBSRD33M26HGBEFW51WPP6 ; plugins-dhs · prj_01M7TRDQYRAPJR03QTM3PP6PX2)
fuentes   121 (LifeCode RAG) · 1 (plugins-dhs, la sonda ACP-02)
auditoría 76 entradas de registro; la del proyecto plugins-dhs con 3 (ingest, forget previo, ingest)
```

## 7. Panel, ventana del propietario (pid 5088)

| Vista | Medición |
|---|---|
| Proyecto | «LifeCode RAG» activo, revisión 3, `Seleccionar` sobre `plugins-dhs` |
| Fuentes | 121 · «Página 1 de 1» |
| Búsqueda | «reembolso» → 8 resultados · modo híbrido · 11,0119 ms · URI y ámbito por fila |
| Contexto | 1.928 tokens · truncado Sí · 16 fragmentos · cita `[1] audit.mjs` |
| Historial | «Total: 141 · Cadena verificada (141 entradas)» · `Cargar más` |
| Conexión | `pa/1.2.0` · modo `api` · ámbitos 1 · servicio ok |
| Operaciones | declara 403 y remite a las herramientas |
| Diagnóstico | `prj_01M7RBSRD33M26HGBEFW51WPP6` presente y verificado; límite de la API declarado |
| DEMO | **no ejercitado** (requiere API caída) |

## 8. Lo que esta evidencia no demuestra

- Que DEMO se pinte bien en la ventana (sólo pruebas de cliente).
- Que dos personas distintas vean selecciones distintas: el host no da identidad de sesión al plugin, y
  la selección es por perfil por decisión documentada (PA01).
- Nada sobre `reindex`: no se ejecutó, por mandato del encargo.
