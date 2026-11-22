# LE-RAG-09 · Seguridad e integridad

## Comprobado

| Comprobación | Resultado |
|---|---|
| Rutas del laboratorio vs habituales | solape **ninguno** (`realpath` distintos) |
| Almacén real | `4dcf31c4cb7058bb…` antes y después |
| `config.json` del perfil `desktop` | `b15622c0ab9f790f…` sin cambios |
| Credenciales | no leídas, no copiadas, no reutilizadas; el laboratorio no contiene ninguna |
| Datos sintéticos | sólo en `lab\corpus`; el laboratorio no apunta a rutas productivas |
| Core sin DSH | suite 396/396 y gate en verde en la copia limpia del commit, sin `node_modules` |
| Dirección de dependencias | `lib/**` no importa `index.js`/`client.js`; el adaptador importa el core |
| Aprobaciones | 3 ficheros de pruebas cubren `approval-required`/`approval-unavailable`; sin servicio, falla cerrado |
| Políticas de autorización | no modificadas: el laboratorio usa las del commit evaluado |
| Escrituras fuera de rutas permitidas | ninguna: el almacén real y el perfil habitual conservan su hash |

## Pendiente (requiere sesión autenticada)

- Ausencia de credenciales en los logs del host.
- Ausencia de conexiones SQLite abiertas tras desactivar el plugin.
- Ausencia de escrituras posteriores a la desactivación.
- Acceso cruzado entre proyectos dentro del host.
- Que el panel no exponga secretos (hallazgos F-1…F-6 de la auditoría del cliente como riesgos a comprobar).

## Riesgos registrados

- F-1 (cliente externo, no el nuestro): no comprobar `r.ok`.
- El adaptador propio no guarda credenciales y su panel está en modo fixture hasta que exista transporte real.
- El laboratorio demuestra aislamiento de rutas; **no** demuestra aún comportamiento del host bajo sesión real.
