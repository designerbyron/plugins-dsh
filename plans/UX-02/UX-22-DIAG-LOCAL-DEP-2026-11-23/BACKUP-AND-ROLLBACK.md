# BACKUP-AND-ROLLBACK — reparación de dependencias (1.4.0 local + `dsh-data-quality`)

**Respaldo del estado inmediatamente anterior a la reparación.** Ninguna operación de este documento se ha ejecutado.

---

## 1. Qué se preserva (conjunto lógico declarado)

### 1.1 Manifiestos y metadatos del perfil (estado roto, `2026-11-23 13:0x`)

| Fichero | Bytes | SHA-256 (16) |
|---|---|---|
| `profiles/desktop/package.json` | 1 011 | `85c53c165e479994` |
| `profiles/desktop/pnpm-lock.yaml` | ~29 800 | `65e8329750acacf2` |
| `profiles/desktop/pnpm-workspace.yaml` | 346 | `0a5f31d702917aec` |
| `profiles/desktop/node_modules/.modules.yaml` | ~7 200 | `f5c600fb06b3bd24` |
| `profiles/desktop/node_modules/.pnpm-workspace-state-v1.json` | 1 249 | `0aa73e0000376470` |
| `profiles/desktop/cordis.yml` | 223 | (se respalda; no lo toca la reparación) |
| `profiles/desktop/cordis.patch.yml` | 2 344 | (se respalda; **contiene configuración de proveedores**) |

### 1.2 Paquetes

- `node_modules/@designerbyron/lifecode-rag` — **75 ficheros** (1.4.0). Se respalda el directorio completo: si el
  `pnpm install` lo recopiara mal, se restaura byte a byte.
- Inventario de **todos** los paquetes instalados con su versión (`plugins-instalados.txt`), para demostrar después
  que ningún otro cambió.

### 1.3 Store y dependencia recuperada

No se copia el store (es una caché global y grande). Se **documenta** lo necesario para verificarlo:

| Dato | Valor |
|---|---|
| `dsh-data-quality@0.3.29` | `sha512-UV7aTAWA/xIhs7gT79n6Bs3eAy2kS4WwGbgIMR8r8j/apmUkHQFmbCJJ3xs8tHtjAhQfrftVWGGwBIB7NPWrvA==` (indexada en `pnpm/v11/index.db`) |
| `@designerbyron/lifecode-rag@1.3.0` (respaldo de la versión anterior) | `sha512-Q/EvDeGxJiTjcuoiB0iGn+gkapQA2bKQrcPJwl5dx3PH6EWpj4HSho1XwJTcqBzrtD/02dqR0CzznrqNFW6h1g==` |
| Artefacto 1.4.0 | SHA-256 `7bbecb09…` (en `plans/…/artifact/` y en `vendor/` tras el paso 3) |

### 1.4 Datos reales

**No se respaldan en este acto** porque la reparación **no los abre**: no hay migración, ni escritura, ni cambio de
schema. Los almacenes conservan su huella (`4b67cadc…`, `4dcf31c4…`, `6130ecba…`, `b15622c0…`) y se verifican al
cerrar.

## 2. Procedimiento de respaldo

1. Cerrar el Host (si estuviera vivo) y comprobar los tres `-wal` a **0 B**.
2. Crear `C:\Users\BYRON\.dsh\backups\repair-1.4.0-<AAAAMMDDTHHMM>\` con:
   - `perfil/` — los 7 ficheros de §1.1, con sus rutas relativas;
   - `paquete-lifecode-rag/` — los 75 ficheros;
   - `plugins-instalados.txt` — `name@version` de todos los paquetes de `node_modules` (sin recursión a `node_modules` internos);
   - `store.txt` — las dos integridades de §1.3;
   - `MANIFIESTO.sha256` — todas las entradas, `hash *ruta`, **LF y binario**.
3. Verificar: `sha256sum -c MANIFIESTO.sha256` → **N/N OK**, y que el número de entradas del manifiesto coincide con
   el de ficheros copiados (no vale «verde» con entradas de menos).
4. Comprobar `cmp -r` del paquete copiado contra el instalado.

## 3. Estado de vuelta atrás (lo que se restaura)

El estado anterior a la reparación es **el actual**: LifeCode RAG 1.4.0 instalado por copia manual (no resoluble),
`dsh-data-quality` **ausente**. La reversión devuelve exactamente eso, incluida la ausencia del complemento.

## 4. Reversión paso a paso

1. **Cerrar el Host** y verificar `-wal` a 0 B.
2. **Restaurar los cinco ficheros** de §1.1 (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
   `.modules.yaml`, `.pnpm-workspace-state-v1.json`) y comprobar sus cinco hashes.
3. **Retirar `vendor/`** (no existía antes de la reparación).
4. **Restaurar el paquete** `node_modules/@designerbyron/lifecode-rag` desde `paquete-lifecode-rag/` (75 ficheros) y
   comprobar 75/75.
5. **Retirar `node_modules/dsh-data-quality`** si la reconciliación lo instaló (pertenece al estado que se está
   revirtiendo).
6. **Verificar**:
   - `package.json` → `85c53c16…`, spec `"1.4.0"` semver;
   - lock → `65e83297…`; `.modules.yaml` → `f5c600fb…`; estado de pnpm → `0aa73e00…`;
   - almacenes con sus cuatro hashes;
   - Host arrancado: `lifecode-rag` presente en el grafo, `dsh-data-quality` ausente (estado de origen).
7. **Declarar** el resultado: `rolled-back` o `rollback-partial` con la comprobación fallida.

## 5. Criterios de éxito

- Los cinco ficheros del perfil con sus hashes exactos.
- El paquete de LifeCode RAG con 75/75 idénticos.
- Ningún otro plugin con versión distinta de `plugins-instalados.txt`.
- Almacenes y registro RAG intactos.
- Host arranca y compone el grafo sin errores.

## 6. Prohibido en la reversión

Borrar o reconstruir almacenes; tocar `roots`, `grants` o permisos; re-ejecutar migraciones; usar `pnpm install` desde
cero (movería paquetes ajenos); editar el lock a mano para «dejarlo como estaba» en vez de restaurarlo.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El `pnpm install` de la reparación cambia un paquete ajeno | se compara el inventario completo contra `plugins-instalados.txt` (T9) y se revierte si difiere |
| El Host reescribe el perfil al arrancar (updater) | Host cerrado durante la escritura; re-medición de hashes justo antes; delta ajeno atribuido con hora |
| `vendor/` se pierde | forma parte del estado nuevo; su hash está en el plan y en `EXPECTED-STATE.md`; se puede recopiar del artefacto |
| Reversión parcial deja `dsh-data-quality` instalado sin referencia | el rollback lo retira explícitamente (paso 5); si se prefiere conservarlo, es **otra** operación, no una reversión |
