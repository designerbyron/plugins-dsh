# Informe de operación — rotación del token MCP de Lunascape

**Misión:** `HERMES-LCRAG-LUNASCAPE-TOKEN-ROTATION-01`
**Inicio:** 2026-11-19 12:41 (HAC) · **Fin:** 2026-11-19 13:05 (HAC)
**Servidor:** `mcp-lunascape` (`serverName: lunascape`) · **Endpoint:** `http://127.0.0.1:7332/mcp`
**Veredicto:** **PARTIAL PASS — OLD TOKEN REVOCATION NOT VERIFIED**

---

## 1. Resumen ejecutivo

El token se rotó con el botón oficial de Lunascape y las dos ubicaciones locales quedaron actualizadas y
coincidentes. El servidor acepta la credencial nueva (HTTP 200 en tres sondas `initialize` de solo lectura),
DSH se reinició y su cliente MCP volvió a conectar. La credencial anterior quedó sustituida por el mecanismo
del propio Lunascape (un único `token`, servidor reiniciado al regenerar), pero **no se ejecutó una prueba
negativa** con el valor anterior: el encargo prohíbe reutilizarlo. Por eso el cierre es `PARTIAL PASS` y no
un PASS completo.

| | |
|---|---|
| Huella del token anterior | `7c4b10ffadd7` (coincide con la del informe de exposición) |
| Huella del token nuevo | `b7dbaad61560` |
| Longitud / alfabeto | 64 caracteres hex, ambos |
| Ubicaciones actualizadas | 2 de 2 |

## 2. Secuencia exacta de operaciones

| # | Operación | Resultado |
|---|---|---|
| 1 | Preflight: existen los dos ficheros, misma credencial comparada en memoria, fila y endpoint correctos | PASS |
| 2 | Arranque de Lunascape (estaba cerrado) y comprobación del puerto 7332 | PASS a los 4 s |
| 3 | Sonda de autenticación con la credencial **anterior** (solo lectura, `initialize`) | **200 · servidor `lunascape`** |
| 4 | Identificación del mecanismo: lectura del bundle de la app (`McpConfigStore.regenerateToken`, `writeToken`, `handleRegenerateToken`) | sustitución inmediata del `token`, sellado con `safeStorage`, reinicio del servidor |
| 5 | Localización de la UI (Settings → AI Integration → pestaña MCP) y de la pestaña «Generic JSON», que muestra el token | PASS |
| 6 | Comprobación de que el token mostrado por la UI **era** el de DSH | PASS (coincidencia en memoria) |
| 7 | Invocación del botón **Regenerate token** (mecanismo oficial) | ejecutado |
| 8 | Lectura del token nuevo desde la propia UI, sin imprimirlo | 64 hex, huella `b7dbaad61560`, distinto del anterior |
| 9 | Escritura de `~/.dsh/secrets/lunascape-mcp-token.txt` | PASS |
| 10 | Sustitución del valor en la cabecera activa de `~/.dsh/cordis.patch.yml` (una sola coincidencia) | PASS |
| 11 | Verificación interna de igualdad entre ambas ubicaciones | PASS |
| 12 | Sonda al servidor con la credencial nueva | **200 · servidor `lunascape`** |
| 13 | Recarga ligera: re-guardado idéntico de la capa de parche | sin efecto observable (el cliente mantuvo el socket) |
| 14 | Reinicio de DSH (cierre ordenado sin respuesta en 15 s → cierre forzado de 5 procesos; relanzado) | ejecutado |
| 15 | Conexión del cliente MCP de DSH al puerto 7332 | **ESTABLISHED desde PID de DSH** |
| 16 | Sonda final con la credencial nueva | **200 · servidor `lunascape`** |

## 3. Archivos modificados

| Archivo | Cambio | Verificación |
|---|---|---|
| `C:\Users\<USER>\.dsh\secrets\lunascape-mcp-token.txt` | valor sustituido (64 hex) | contenido nuevo; sin copia del anterior |
| `C:\Users\<USER>\.dsh\cordis.patch.yml` | **solo** el valor Bearer de la cabecera activa (línea 80) | 5 105 bytes antes y después; 1 cabecera activa; 1 fila `mcp-lunascape`; endpoint intacto |

No modificados: `~/.dsh/cordis.patch.yml` (otras filas), perfiles, proveedores de IA, otros servidores MCP,
base de datos de auditoría de Lunascape.

## 4. Criterios de aceptación

| Criterio | Estado |
|---|---|
| Lunascape generó una credencial nueva | **PASS** (botón oficial; valor distinto) |
| Las dos ubicaciones fueron actualizadas | **PASS** |
| Ambas ubicaciones coinciden | **PASS** (comparación en memoria) |
| La configuración permanece válida | **PASS** (DSH arrancó después y cargó la capa; estructura y bytes conservados) |
| DSH reconoce el servidor | **PASS con matiz**: conexión ESTABLISHED desde un proceso de DSH; la autenticación por petición no se ejerció con una herramienta real |
| Una llamada MCP real de solo lectura funciona | **PASS** (`initialize` → 200, `serverInfo.name = lunascape`, respuesta JSON-RPC) |
| No se debilitó la protección de los archivos | **PASS** (ACL heredada idéntica: SYSTEM, Administradores, <USER>) |
| No se expuso el secreto en ninguna evidencia | **PASS** |
| Estado de la credencial anterior correctamente clasificado | **PASS**: sustitución automática; prueba negativa no ejecutada |

## 5. Resultado de la llamada MCP real

Tres `initialize` (antes, después y final) contra `http://127.0.0.1:7332/mcp`, sin invocar ninguna herramienta:

- Antes: `200`, `autorizado=true`, `servidor=lunascape`.
- Después: `200`, `autorizado=true`, `servidor=lunascape`.
- Final: `200`, `autorizado=true`, `servidor=lunascape`.

No se ejecutaron navegación, escritura, bookmarks ni historial.

## 6. Estado de la revocación del token anterior

**`AUTOMATICALLY REVOKED`** por el mecanismo del servidor: hay un único campo `token`, `regenerateToken()`
lo sobrescribe y el servidor se reinicia al regenerar (código leído en el bundle de la app). No existe
coexistencia.

**`NOT VERIFIED`** por prueba negativa: no se conservó el valor anterior (prohibido por el encargo) y no se
reintrodujo. Esa es la razón del `PARTIAL PASS`.

## 7. Confirmación de no exposición

- El valor nunca se imprimió: los scripts propios solo devolvieron booleanos, longitudes, recuentos y huellas
  SHA-256 truncadas a 12.
- No se creó ningún archivo con el token: la sustitución se hizo en memoria y se escribió directamente en las
  dos ubicaciones autorizadas.
- No se usó portapapeles, ni variables de entorno, ni argumentos de proceso con el valor, ni servicios
  externos.
- Este informe no contiene el token, ni fragmentos, ni la cabecera `Authorization`, ni capturas de la UI con
  el valor.
- Las capturas tomadas para navegar la UI no contienen el token: la pestaña que lo muestra solo se leyó por
  UI Automation y su valor se enmascaró en los volcados.

## 8. Reinicio

**DSH reiniciado.** Motivo: el cliente MCP mantiene la cabecera en memoria desde el arranque; el re-guardado
idéntico de la capa de parche no provocó recarga observable (mismo socket, mismo PID). Cierre ordenado sin
respuesta en 15 s → cierre forzado de 5 procesos → relanzado el ejecutable del perfil. No se reinició Windows
ni ningún otro servicio.

## 9. Efectos colaterales declarados

- **Lunascape estaba cerrado y se arrancó** para poder usar su interfaz; sigue abierto (su servidor MCP es el
  que DSH consume).
- Su ventana se movió del monitor secundario (x negativo) al primario para poder operarla; el tamaño quedó en
  1200×850.
- La rotación invalida cualquier otro cliente que usara el `token` anterior. No se encontró ninguno más allá de
  DSH en el barrido del acto anterior.

## 10. Ubicación de este informe

`C:\xampp\htdocs\plugins-dhs\lifecode-rag\eval\lunascape-token-rotation-01\OPERATION-REPORT.md`
