# LifeCode RAG 1.0.0 · Guía de vuelta atrás

Objetivo: volver al build anterior (`655f03758fe1`) **sin perder datos**. El ensayo de restauración ya se
ejecutó (ver §4) y el respaldo existe; lo que sigue es la secuencia exacta sobre el perfil real.

## 0. Cuándo se usa

- El plugin no carga tras el cambio y no hay arreglo rápido.
- El panel o las herramientas fallan de forma que impide trabajar.
- Hay que volver al comportamiento anterior para comparar.

**No** se usa para «limpiar»: el árbol de trabajo del repositorio no se toca en una vuelta atrás.

## 1. Material necesario (todo ya existe)

| Elemento | Ruta |
|---|---|
| Respaldo del perfil y del almacén | `C:\Users\BYRON\.dsh\backups\acp01-2026-11-21T1842\` (`MANIFEST.json` + `profile/` + `store/`) |
| Instantánea anterior | `C:\xampp\htdocs\dsh-plugins-store\lifecode-rag\655f03758fe1` (407 ficheros) |
| Instantáneas del acto (no necesarias para volver) | `acp01-46d8d4a438e6`, `acp01-71ca6863ad63`, `acp01-7f174851218a` |

## 2. Secuencia

```powershell
# 1) Cerrar la instancia (nunca a la fuerza sin comprobar los WAL)
#    - comprobar que los -wal están a 0 B o ausentes
#    - CloseMainWindow(), luego: MSYS2_ARG_CONV_EXCL='*' cmd /c "taskkill /PID <main> /T"
#    - Stop-Process -Id <main> -Force
#    - verificar 0 procesos y puerto libre

# 2) Devolver la fuente del plugin al build anterior
#    package.json:    "@local/lifecode-rag": "link:C:/xampp/htdocs/dsh-plugins-store/lifecode-rag/655f03758fe1"
#    pnpm-lock.yaml:  specifier y version del mismo paquete → 655f03758fe1
#    (escritura atómica: temporal + rename; validar JSON antes de escribir)

# 3) Junction al build anterior
$p = 'C:\Users\BYRON\.dsh\profiles\desktop\node_modules\@local\lifecode-rag'
(Get-Item $p -Force).Delete()
New-Item -ItemType Junction -Path $p -Target 'C:\xampp\htdocs\dsh-plugins-store\lifecode-rag\655f03758fe1'

# 4) Restaurar el almacén SOLO si hiciera falta (ver §3: normalmente NO)
#    copiar store/registry.sqlite3 (+ scopes) del respaldo sobre el perfil

# 5) Arrancar DSH y verificar
```

## 3. Qué restaurar y qué no

- **Registro (`registry.sqlite3`)**: sólo si se quiere volver también al esquema v1. **No es necesario para que
  el build anterior funcione sobre datos**: el registro v2 tiene una tabla más (`pa_selection`) y el build viejo
  lo rechazaría con `store-version-unsupported`. Se puede (a) restaurar el respaldo v1 —pierde las 3 entradas de
  auditoría de selección y la selección persistida— o (b) dejar el v2 y aceptar que el build viejo no abra el
  perfil. Para volver de verdad: **(a)**.
- **Bases de ámbito (`scopes/**/rag.sqlite3`)**: **no se restauran**. Su contenido no cambió en el acto
  (`4dcf31c4cb70…` y `0788ffb4c59c…` idénticos antes y después); restaurarlas sólo añadiría riesgo.
- **`config.json` del almacén**: no se tocó.

## 4. Ensayo ya ejecutado (2026-11-21)

```
respaldo restaurado en un directorio de ensayo
  registry.sqlite3        sha 80d64e0a749d…  quick_check ok  user_version 1  proyectos 2
  scopes/prj_01M7RBSRD33… sha 4dcf31c4cb70…  quick_check ok
  scopes/prj_01M7TRDQY…   sha 0788ffb4c59c…  quick_check ok
build anterior 655f03758fe1 → abre el registro restaurado: proyectos 2, tablas 11
instantánea anterior intacta: 407 ficheros (index.js sha a8430e2c19a9…)
```

Esto demuestra las dos cosas que importan: el respaldo se restaura **byte a byte** y el build anterior **lee**
lo restaurado.

## 5. Verificación tras la vuelta atrás

1. Panel en modo REAL con el proyecto del perfil (el build anterior no tiene CAS: con dos proyectos y sin
   `?project=` responderá `scope-ambiguous`; es su comportamiento conocido, no una avería nueva).
2. `GET /lifecode-rag/pa/config` responderá **200 sin credencial**: es el defecto PA01 que este acto cerró, y
   vuelve con el build anterior. **Queda declarado**: si se vuelve atrás, la API del panel vuelve a estar
   abierta al loopback.
3. Recuentos de fuentes: 121 (LifeCode RAG) y 0 (plugins-dhs).
4. `PRAGMA quick_check` = `ok` en las tres bases.

## 6. Deshacer la vuelta atrás

Repetir §2 apuntando a `acp01-7f174851218a` y restaurar el registro v2 desde
`C:\Users\BYRON\.dsh\backups\` sólo si se había restaurado el v1. La migración v1→v2 es idempotente: si el
registro sigue en v2, el build nuevo lo abre sin más.

## 7. Límites

- Un build intermedio (`acp01-46d8d4a438e6`, `acp01-71ca6863ad63`) **no** se debe usar: les faltaban
  correcciones del acto (lista de proyectos, refresco tras cambio de selección). Se conservan como historia,
  no como destino.
- Restaurar el registro v1 pierde la selección persistida y las entradas `selection.*` de auditoría; no pierde
  proyectos, raíces, concesiones ni fuentes.
