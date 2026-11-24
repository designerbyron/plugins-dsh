# Plan de rollback

Objetivo: volver al estado exacto de 1.2.0 con los datos intactos, **en menos de cinco minutos y sin red**,
si la instalación de 1.3.0 no valida.

Tres niveles, de menos a más invasivo. **Nivel 1 cubre el 95 % de los casos** (un plugin que no carga, una
ruta que falla, una versión que no es la esperada).

---

## Nivel 1 · Reversión del paquete (rápida, sin respaldo externo)

El propio plan de instalación deja el 1.2.0 aparcado en el mismo directorio:

```sh
PROF="$HOME/.dsh/profiles/desktop"
PKG="$PROF/node_modules/@designerbyron/lifecode-rag"

# host CERRADO
mv "$PKG" "$PKG.fallida-1.3.0"      # no se borra: es evidencia
mv "$PKG.bak-1.2.0" "$PKG"          # vuelve el 1.2.0 original

# manifiestos: restaurar las DOS versiones de 1.2.0 (no editar a mano hacia atrás)
cp ~/.dsh/backups/inst-1.3.0-<TS>/perfil/package.json   "$PROF/package.json"
cp ~/.dsh/backups/inst-1.3.0-<TS>/perfil/pnpm-lock.yaml "$PROF/pnpm-lock.yaml"
```

**Verificación (obligatoria):**
`package.json` del paquete = `1.2.0`, **73** ficheros, `PA_VERSION = 'pa/1.3.0'`, y los cuatro hashes de
referencia del inventario (`e966b23a…`, `df7b74d6…`, `c5c1bea6…`, `8144fe8c…`). Después, arrancar el host y
comprobar que la app carga el plugin (401 en `/lifecode-rag/pa/config` sin credencial, panel con datos).

## Nivel 2 · Reversión del paquete desde el respaldo

Si el `.bak-1.2.0` no existe (p. ej. se limpió), se restaura desde el respaldo verificado:

```sh
rm -rf "$PKG"    # el host está cerrado; si hay dudas, mover a .fallida en vez de borrar
cp -a ~/.dsh/backups/inst-1.3.0-<TS>/paquete-1.2.0 "$PKG"
```

Y se compara **fichero a fichero** contra el tarball 1.2.0 del registro (`sha512-E+81ki…`, 73 ficheros): 73/73
con el mismo sha256. Esa comparación es la prueba de que lo restaurado es exactamente lo publicado.

## Nivel 3 · Datos (sólo si la huella cambió)

**No debería hacer falta**: la instalación no abre los almacenes ni ejecuta migraciones, y la matriz exige
que la huella de datos sea idéntica. Pero si el `sha256` de un `.sqlite3` cambia:

1. **Parar todo** y no seguir instalando.
2. Identificar **qué** cambió: comparar recuentos y `audit_registry` (¿aparece una acción nueva? ¿un
   `schema.migrate`?). Un cambio de datos sin acción de auditoría es motivo de bloqueo, no de restauración a
   ciegas.
3. Restaurar **sólo** la base afectada desde `almacen/profiles/desktop/…`, con el host cerrado, y verificar:
   `integrity_check ok`, recuentos iguales a `ESTADO-LOGICO-ANTES.json`, cadena de auditoría verificable.
4. Los sidecars se restauran **como ficheros** si estaban en el respaldo; **nunca** se «reconstruyen» a mano.

## Ensayo del rollback (recomendado antes de instalar)

Sin tocar el perfil real: copiar `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` y el `node_modules`
del perfil a un directorio temporal, aplicar allí la instalación quirúrgica y **deshacerla** con el Nivel 1.
Criterio de éxito: el árbol temporal queda con 1.2.0 y los mismos 73 hashes, y `pnpm install
--frozen-lockfile --offline` vuelve a aceptar el lock restaurado.

## Criterios de parada durante el rollback

| Situación | Acción |
|---|---|
| El 1.2.0 restaurado no coincide con los hashes de referencia | **detenerse**; no improvisar otra versión: se documenta y se decide con el propietario |
| El host no arranca tras restaurar | revisar el log del host y `cordis.patch.yml` del perfil; **no** reinstalar a ciegas |
| `-wal` distinto de 0 B al cerrar | detenerse antes de copiar/restaurar datos |
| Una base no abre en sólo lectura o `integrity_check` falla | **BLOCKED**: no se escribe nada más; se investiga sobre copias |

## Estado de este plan

**Preparado, NO EJECUTADO.** No se ha ensayado el rollback (exige copiar y mover directorios del perfil real, o
un ensayo completo en temporal que se hará en la fase autorizada). La afirmación que sí se sostiene hoy: el
1.2.0 que se aparcará es **byte a byte** el publicado (73/73 hashes), así que la vuelta atrás no depende de
reconstruir nada.
