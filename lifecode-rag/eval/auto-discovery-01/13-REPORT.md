# AUTO-DISCOVERY — Informe final (2026-11-19)

**Estado global:** `IMPLEMENTED + TESTED LOCAL` — la prueba real en DSH queda **pendiente de
autorización humana** (confiar el workspace y reiniciar), no de código.

## Respuestas

1. **¿Descubre proyectos automáticamente?** Sí: escanea un workspace confiable (máx. profundidad 4,
   200 proyectos), detecta indicadores reales y registra el proyecto. No recorre el disco ni indexa.
2. **¿Qué tipos reconoce?** Git, Laravel/PHP, Node (clasificado en Nuxt/Next/Vue/React/Angular/
   Svelte), .NET, Python, Go, Rust, Java (Maven), Ruby (Gemfile) y web por `index.html`.
3. **¿Descubrimiento vs registro vs autorización vs indexación?** Son cuatro estados distintos.
   Descubrir no escribe nada; registrar crea identidad y raíz; la autorización de lectura sólo la da
   `trust add --read true` (persona/host); indexar es una operación explícita de ingesta que nunca
   ocurre al descubrir.
4. **¿Resuelve el proyecto por sesión?** Sí: selección explícita primero; si no hay, `cwd` →
   frontera de proyecto dentro del workspace confiable → auto-registro → resolución normal. Con
   raíces anidadas gana la más específica. Sin coincidencia: `scope-unresolved` (nunca global).
5. **¿Se corrigió `scope-unresolved`?** En código y en pruebas sí; en esta sesión de DSH todavía no,
   porque el host sigue ejecutando el código cargado al arrancar y el workspace real aún no está
   confiado. Ensayo equivalente sobre copia del perfil: `08-resolution-real-shape.txt` (resuelve
   `plugins-dhs`, search `empty`, sin crear almacén).
6. **¿Las siete herramientas sin selección manual?** Sí con workspace confiable: la prueba 16
   demuestra `search`/`list`/`get`/`context`/`forget`/`reindex`/`ingest` sobre el proyecto
   descubierto; sin workspace confiable fallan en cerrado.
7. **¿Se conservó el almacén real?** Sí: `sources=121`, `chunks=964`, `vectors=964`, `audit=141`,
   meta `scope_id` y `store_state=ready`, leído con `readOnly: true` (`07-store-integrity.txt`).
8. **¿El panel usa datos reales?** No: sigue siendo demostración; ahora está etiquetado sin ambigüedad
   («DEMO: no lee el proyecto real») y las herramientas del agente sí usan datos reales. No se creó
   API sin autenticación.
9. **¿Qué capacidad de DSH limita el producto?** La falta de identidad de sesión en el transporte
   HTTP (PA-UI-0, BLOCKED): el navegador autentica la autoridad, no la conversación. Por eso el panel
   no puede leer el registro aunque quiera.
10. **¿Qué requiere autorización humana?** `trust add --path C:\xampp\htdocs\plugins-dhs --read true`
    sobre el perfil real y reiniciar DSH para cargar el código nuevo. Alcance: escribe
    `meta.trusted_roots`; autoriza registrar proyectos contenidos; no indexa, no borra, no recrea
    almacenes, no toca la raíz existente.

## Verificación

- Suite completa: 339/339. Discovery: 16/16. Cliente: 46/46.
- Git sin escritura; HEAD `b6c0cd24621c8bc3282185d1821c60b7956f8a83`.
- Cambios concurrentes externos detectados durante la sesión (CHANGELOG/MEMORY y `skill-compiler/`):
  no son de esta misión, no se tocaron.
