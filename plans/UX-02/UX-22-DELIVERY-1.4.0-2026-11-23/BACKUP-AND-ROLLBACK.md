# BACKUP-AND-ROLLBACK — LifeCode RAG 1.4.0

**Alcance:** respaldo verificable del estado previo y vuelta atrás sin tocar datos reales.
Todas las huellas de este documento son **medidas** el 2026-11-23 con el Host cerrado.

---

## 1. Qué se preserva (conjunto lógico declarado)

### 1.1 Plugin anterior (1.3.0)

`C:\Users\BYRON\.dsh\profiles\desktop\node_modules\@designerbyron\lifecode-rag` — **74 ficheros**.
Huellas de referencia: `index.js 23ed6951…`, `client.js ff8119dde0c1a41e…`, `lib/pa-api.mjs 14ff188d…`.

### 1.2 Configuración del perfil

| Fichero | Bytes | SHA-256 (16) |
|---|---|---|
| `profiles/desktop/package.json` | 1 011 | `ed9e1426dc55f207` |
| `profiles/desktop/pnpm-lock.yaml` | 30 297 | `6f97fe2b89ce2501` |
| `profiles/desktop/pnpm-workspace.yaml` | 346 | `03c867f7dac62530` |
| `profiles/desktop/node_modules/.modules.yaml` | 7 457 | `3c55c109bf24455c` |
| `profiles/desktop/node_modules/.pnpm-workspace-state-v1.json` | 1 249 | `b952038fe02750f2` |
| `profiles/desktop/cordis.patch.yml` | 2 344 | (se respalda; hash en el manifiesto del acto) |
| `profiles/desktop/cordis.yml` | 223 | (se respalda) |

### 1.3 `cordis.patch.yml` del home

`C:\Users\BYRON\.dsh\cordis.patch.yml` — **82 líneas**, SHA-256 `8ab9f8f0c3f561b8…`.
**Contiene credenciales** (3 ocurrencias de `Bearer`, una de ellas del MCP de Lunascape). Se copia **byte a byte** al
respaldo, cuyo directorio hereda la protección del perfil. **No se imprime, no se abre en claro y no se diffea.**

### 1.4 Almacenes y datos (10 ficheros, inventario exacto)

| Fichero (bajo `C:\Users\BYRON\.dsh\lifecode-rag\profiles\desktop`) | Bytes | SHA-256 (16) |
|---|---|---|
| `registry.sqlite3` | 241 664 | `4b67cadc9afee8f6` |
| `registry.sqlite3-shm` | 32 768 | `fd4c9fda9cd3f9ae` |
| `registry.sqlite3-wal` | **0** | `e3b0c44298fc1c14` (vacío) |
| `scopes/prj_01M7RBSRD33M26HGBEFW51WPP6/rag.sqlite3` | 3 862 528 | `4dcf31c4cb7058bb` |
| `scopes/prj_01M7RBSRD33M26HGBEFW51WPP6/rag.sqlite3-shm` | 32 768 | `fd4c9fda9cd3f9ae` |
| `scopes/prj_01M7RBSRD33M26HGBEFW51WPP6/rag.sqlite3-wal` | **0** | `e3b0c44298fc1c14` (vacío) |
| `scopes/prj_01M7TRDQYRAPJR03QTM3PP6PX2/rag.sqlite3` | 126 976 | `6130ecbae17b8e82` |
| `…/rag.sqlite3-shm` | 32 768 | `fd4c9fda9cd3f9ae` |
| `…/rag.sqlite3-wal` | **0** | `e3b0c44298fc1c14` (vacío) |
| `config.json` | 998 | `b15622c0ab9f790f` |

**Un `-wal` a 0 B prueba que no hay transacción pendiente.** El respaldo se hace **con el Host cerrado**; si el Host
se abre antes de copiar, se re-mide y se repite.

### 1.5 Registro de plugins y configuraciones del Host

El «registro de plugins» de DSH es el `package.json` del perfil + `dsh.profile.bundles` (§1.2) y el grafo que compone
el Host al arrancar. No existe un fichero aparte que enumerar: se respalda el manifiesto y, para la verificación, se
captura el grafo del Host antes y después (matriz M2).

### 1.6 Configuración de proveedores

`config.json` del almacén (§1.4): `embedding.provider = local-hash-v1`, `dim = 256`, `remote = null`. **No hay
credenciales de proveedor en el almacén.** Los proveedores del Host viven en `profiles/desktop/cordis.patch.yml`
(§1.2), que se respalda.

## 2. Procedimiento de respaldo

1. Cerrar el Host (§3) y comprobar `-wal` a 0 B.
2. Crear `C:\Users\BYRON\.dsh\backups\inst-1.4.0-<AAAAMMDDTHHMM>\` con:
   - `perfil/` — los 7 ficheros de §1.2, conservando rutas relativas (`node_modules/.modules.yaml`, etc.);
   - `home/cordis.patch.yml` — copia íntegra (protegida);
   - `paquete-1.3.0/` — el directorio completo (74 ficheros);
   - `almacen/` — los 10 ficheros de §1.4 **incluidos `-wal`/`-shm`** (los vacíos se copian: su ausencia no es
     equivalente);
   - `MANIFIESTO.sha256` — **todas** las entradas, formato `hash *ruta`, escrito en **LF y binario**
     (`open(…, 'wb')`; `'w'` en Windows mete CRLF y rompe `sha256sum -c`).
3. Verificar: `sha256sum -c MANIFIESTO.sha256` → **N/N OK**, y contar las entradas contra el total de ficheros
   copiados (no vale «el manifiesto está en verde» si no cubre todo).

## 3. Cierre del Host (si estuviera vivo)

Orden probado: medir procesos y `-wal`; `CloseMainWindow()`; `taskkill /PID <main> /T`; `Stop-Process -Id <main>
-Force` **sólo si** los `-wal` están a 0 B; comprobar 0 procesos, puertos libres y **mismos hashes** de las bases.
«La ventana se cerró» ≠ «el proceso terminó».

## 4. Verificación de que el respaldo sirve

| Control | Criterio |
|---|---|
| Integridad de ficheros | `sha256sum -c` N/N OK |
| Bases | `PRAGMA quick_check` → `ok` en la **copia** de `registry.sqlite3` y de cada `rag.sqlite3` |
| Contenido lógico de la copia | `registry_version = 2`, 3 proyectos, 3 raíces, `audit_head_seq = 88`; ámbito principal `schema_version = 3`, 121 fuentes, 964 chunks, 964 vectores |
| Paquete | `import('file:///…/paquete-1.3.0/index.js')` carga sin dependencias externas; `package.json` dice `1.3.0` |
| Comparación antes/después | `cmp` del árbol de datos contra el original: idéntico (incluidos los `-wal` de 0 B) |

## 5. Reversión

**Objetivo:** volver a 1.3.0 sin borrar ni reconstruir datos.

1. Cerrar el Host (§3) y verificar `-wal` a 0 B.
2. Restaurar el directorio del paquete: eliminar `node_modules/@designerbyron/lifecode-rag` y copiar
   `paquete-1.3.0/` en su lugar.
3. Restaurar `perfil/package.json`, `perfil/pnpm-lock.yaml`, `perfil/pnpm-workspace.yaml`,
   `perfil/node_modules/.modules.yaml` y `perfil/node_modules/.pnpm-workspace-state-v1.json` desde el respaldo.
4. **No** tocar `cordis.patch.yml`, el almacén ni `config.json`: no los modificó la instalación.
5. Verificar éxito:
   - `package.json` del paquete = `1.3.0`, `PA_VERSION = 'pa/1.4.0'`, **74** ficheros;
   - huellas `index.js 23ed6951…`, `client.js ff8119dd…`, `lib/pa-api.mjs 14ff188d…`;
   - ficheros del perfil con sus SHA-256 del §1.2;
   - almacén con los 10 hashes del §1.4 (o, si el Host escribió métricas al arrancar, con el delta atribuido a la
     cadena de auditoría, nunca «revertido» a la fuerza);
   - Host arrancado: siete herramientas registradas y `/pa/config` responde.

**Prohibido en la reversión:** restaurar el almacén sobre una base que el Host tenga abierta; borrar `-wal`/`-shm`
«para limpiar»; re-ejecutar migraciones; usar `pnpm install` completo desde cero (movería paquetes ajenos).

## 6. Riesgos residuales

| Riesgo | Mitigación |
|---|---|
| El Host reescribe el perfil por su cuenta (actualizador de plugins) durante el acto | Host cerrado; re-medición de hashes justo antes de escribir; delta ajeno atribuido con hora y autoría |
| `pnpm` regenera `.modules.yaml` con otra forma | control M10 acepta «1.4.0» escrito por el Host, con la versión instalada como prueba primaria |
| Abrir una base en WAL crea `-shm`/`-wal` aunque sea lectura | toda medición se hace sobre **copias** en el scratch; el almacén real no se abre |
| El respaldo incluye un `cordis.patch.yml` con credenciales | directorio de respaldo bajo el perfil del usuario, nunca versionado ni impreso |
