# Evidencia — Auto-descubrimiento y resolución por sesión (2026-11-19)

Carpeta de evidencia de la misión `AUTO-DISCOVERY, PROJECT RESOLUTION & REAL DATA MODE`.
Todo lo escrito aquí es reproducible; nada se generó contra el perfil real salvo lecturas y copias.

| Fichero | Contenido |
|---|---|
| `01-tests-full.txt` | Suite completa (`node --test` desde `lifecode-rag/`): 339/339 |
| `02-tests-discovery.txt` | `tests/discovery.test.mjs`: 16/16 |
| `03-tests-client.txt` | `tests/client.test.mjs`: 46/46 |
| `04-discovery-plugins-dhs.txt` | Escaneo real de `C:\xampp\htdocs\plugins-dhs` (solo lectura) |
| `05-discovery-htdocs.txt` | Escaneo real de `C:\xampp\htdocs` (solo lectura) |
| `06-real-registry-readonly.txt` | Registro real leído en modo `readOnly` |
| `07-store-integrity.txt` | Almacén real: 121 fuentes / 964 fragmentos / 964 vectores |
| `08-resolution-real-shape.txt` | Copia temporal del perfil real + confianza + resolución por cwd + búsqueda/lista |
| `09-panel.txt` | Estado del panel cliente y sus etiquetas de demo |
| `10-dsh-real.txt` | Estado de la prueba real en DSH y autorización pendiente |
| `scripts-real-shape.mjs` | Script reproducible del ensayo 08 (trabaja sólo sobre copia temporal) |

## Verificación de no alteración

- `registry.sqlite3` real: sólo `new DatabaseSync(path, { readOnly: true })`; sin escrituras.
- Almacén real: sólo lectura; los conteos coinciden con las cifras de referencia.
- El ensayo 08 copia el perfil a `%TEMP%` y trabaja allí; borra la copia al terminar.
- No se hizo `git add`, `commit`, `push` ni operaciones destructivas.
