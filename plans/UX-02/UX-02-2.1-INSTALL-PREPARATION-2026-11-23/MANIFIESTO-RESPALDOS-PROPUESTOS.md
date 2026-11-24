# Manifiesto de respaldos y hashes **propuestos** (no ejecutados)

Este documento define **qué se respaldará, dónde, cómo se verificará y qué hashes se guardarán** en la fase
de ejecución. **No se ha creado ningún respaldo todavía**: crearlos implica escribir en el medio y esta fase
sólo autoriza inspección.

---

## 1. Conjunto lógico a respaldar

| # | Elemento | Ruta | Por qué |
|---|---|---|---|
| B1 | Manifiestos del perfil | `~/.dsh/profiles/desktop/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `cordis.patch.yml`, `cordis.yml` | son lo que cambia al instalar; el resto del perfil no |
| B2 | Paquete instalado 1.2.0 | `~/.dsh/profiles/desktop/node_modules/@designerbyron/lifecode-rag` (73 ficheros) | rollback inmediato y comparación de hashes |
| B3 | Configuración del plugin | `~/.dsh/lifecode-rag/profiles/desktop/config.json` | no debe cambiar; se verifica |
| B4 | Registro PA | `~/.dsh/lifecode-rag/profiles/desktop/registry.sqlite3` | proyectos, raíces, selección, auditoría |
| B5 | Almacenes de ámbito | `~/.dsh/lifecode-rag/profiles/desktop/scopes/*/rag.sqlite3` (2) | **las 121 fuentes** |
| B6 | Sidecars WAL/SHM presentes | `…/scopes/prj_01M7TRD…/rag.sqlite3-{shm,wal}` (hoy) | se copian **tal cual**, con su tamaño; **nunca** se borran ni se manipulan |
| B7 | Inventario del perfil | salida de `node_modules` (nombre+versión de cada paquete de primer y segundo nivel) | detectar si la instalación mueve algo ajeno |

**Fuera del respaldo (a propósito):** `node_modules` completo (cientos de MB, reproducible desde el lock),
`AppData\Roaming\@deepseek-ai\dsh-desktop` (estado de Electron; no interviene) y `~/.dsh/cordis.patch.yml`
(contiene credenciales: se respalda **por hash**, no se copia a un directorio de evidencias).

## 2. Ubicación y nombres

```
~/.dsh/backups/inst-1.3.0-<AAAAMMDDTHHMM>/
    perfil/                      package.json, pnpm-lock.yaml, pnpm-workspace.yaml, cordis.patch.yml, cordis.yml
    paquete-1.2.0/               copia del directorio instalado (73 ficheros)
    almacen/profiles/desktop/    config.json, registry.sqlite3, scopes/<id>/rag.sqlite3 (+ sidecars si existen)
    inventario-node_modules.txt
    MANIFIESTO.sha256            LF, `hash *ruta_relativa`, verificado con `sha256sum -c`
    ESTADO-LOGICO-ANTES.json     recuentos leídos en sólo lectura
```

Se usa `~/.dsh/backups/…` porque el propietario ya tiene ahí sus respaldos anteriores
(`ux1-1.2.0-2026-11-22T2013`, `acp01…`, `acp02…`, `p2…`). **No se sobrescribe ninguno**: el nombre lleva
marca de tiempo y el acto aborta si el directorio ya existe.

## 3. Cómo se hace cada copia (y por qué así)

| Elemento | Método | Cautela |
|---|---|---|
| B1, B3, B6 | `cp -p` (conserva permisos y mtime) | sidecars copiados **byte a byte**, sin interpretarlos |
| B2 | `cp -a` del directorio | incluye ficheros ocultos; recuento 73 |
| B4, B5 | copia del fichero **con el host cerrado** (§2 del plan de instalación) | copiar una base SQLite abierta por otro proceso puede dar una imagen inconsistente; con 0 procesos y `-wal` a 0 B la copia es completa |
| Inventario | `find node_modules -name package.json` → nombre+versión | base de comparación tras instalar |

**Regla de oro:** un respaldo **no está validado porque exista**. Se valida:

1. hash del original y del respaldo (dos instrumentos: `sha256sum` y `certutil`),
2. apertura de **la copia** en sólo lectura (`DatabaseSync(..., { readOnly: true })`),
3. `PRAGMA integrity_check` = `ok` en las tres bases,
4. recuentos iguales al original: 3 proyectos, 3 raíces, selección rev. 5, auditoría 88/88,
   **121 fuentes · 964 chunks · 964 vectores**, auditoría del ámbito 141.

Si la copia no abre o los recuentos no coinciden, **no se instala**.

## 4. Huella de datos (y la trampa de los sidecars)

- La huella de **datos** se calcula sobre los `.sqlite3` (3 ficheros): hoy
  `4b67cadc…` (registro), `4dcf31c4…`, `6130ecba…`.
- Los sidecars **se registran por tamaño y se comparan**, pero **no entran en la huella de datos**: se ha
  medido que aparecen y desaparecen según qué conexión abrió cada base (hoy en `prj_01M7TRD…`, hace unas horas
  en `prj_01M7RBS…`), siempre con `-wal` a `0 B`. Un hash que los incluya se mueve sin que los datos cambien.
- Si tras cerrar el host el `-wal` **no** está a 0 B, **se para**: significa que hay una transacción sin
  confirmar y copiar ahora puede dejar una imagen a medias.

## 5. Manifiesto de respaldos (formato)

`MANIFIESTO.sha256`, escrito en **LF** y modo binario (`hash *ruta`), para que `sha256sum -c` funcione:

```
<sha256> *perfil/package.json
<sha256> *perfil/pnpm-lock.yaml
…
<sha256> *paquete-1.2.0/lib/pa-api.mjs
…
<sha256> *almacen/profiles/desktop/scopes/prj_01M7RBS…/rag.sqlite3
```

Se genera **después** de copiar y se verifica desde el directorio del respaldo. Se guarda también el hash de
`~/.dsh/cordis.patch.yml` **sin copiar su contenido**.

## 6. Estado del respaldo en esta fase

**NOT RUN** — ningún directorio de respaldo creado, ningún byte copiado. Este manifiesto es el **contrato**
de lo que se hará; los valores «antes» que se usarán como referencia ya están medidos y guardados en
`evidence/huella-antes.txt`.
