# Registro de riesgos y condiciones de parada

Cada riesgo lleva **cómo se detecta** (no basta «hay que tener cuidado») y qué se hace. Las condiciones de
parada son de obligado cumplimiento: si se cumplen una, el acto **se detiene** y se documenta.

---

## 1. Riesgos con medición asociada

| # | Riesgo | Probabilidad | Impacto | Detección | Mitigación |
|---|---|---|---|---|---|
| R1 | `pnpm add` re-resuelve el árbol **hoisted** y mueve paquetes ajenos (incluido el `link:` del skill-compiler) | Media-alta | Alto | inventario completo de `node_modules` (nombre+versión) antes/después; cualquier diferencia ajena = fallo | vía **quirúrgica** por defecto (§4.1 del plan); `pnpm add` sólo con guardas y comparación |
| R2 | `minimumReleaseAge` activo en el momento de instalar → pnpm deja la **1.2.0** y no falla | Baja (hoy `undefined`) | Alto (falsa sensación de éxito) | P6 re-medido + **verificación de la versión instalada**, no del código de salida | exclusión por versión exacta en el perfil; nunca política global |
| R3 | Lock editado a mano inconsistente → `pnpm install` posterior rompe el perfil | Media | Alto | ensayo `pnpm install --frozen-lockfile --offline` sobre una **copia** | no se aplica el lock real hasta que la copia lo acepte |
| R4 | El host sigue vivo y bloquea ficheros de `node_modules` | Media | Medio | `tasklist` + error `EPERM/EBUSY` al mover el directorio | cierre limpio verificado (§2) antes de tocar nada |
| R5 | Copia de una base **abierta** → respaldo inconsistente | Media | Alto (datos) | `-wal` a 0 B y 0 procesos antes de copiar; `integrity_check` sobre la copia | respaldo verificado por apertura en sólo lectura y recuentos; sin respaldo válido no se instala |
| R6 | Al copiar/instalar se pierde un sidecar y alguien lo «reconstruye» | Baja | Medio | listado de sidecars con tamaños antes/después | se copian tal cual y **no se recrean nunca** a mano |
| R7 | Un `401` en `/pa/workspaces` se lee como «la ruta existe» | Alta (trampa de lectura) | Medio (informe falso) | la compuerta rechaza **antes** de mirar la ruta | la versión y la ruta se prueban con sesión o en instancia aislada; si no, `BLOCKED` |
| R8 | Verificar «que carga» mirando sólo que la app abrió | Alta | Medio | la versión se lee del `package.json` instalado y del cuerpo de `/pa/config` con sesión | matriz V-1.4/V-1.5; sin sesión, `BLOCKED` |
| R9 | Datos que cambian por **uso normal** del propietario durante la prueba (una búsqueda, un `sync.run`) | Media | Medio | acciones nuevas en `audit_registry`/`audit` del ámbito con su `actor` | se distingue por la cadena de auditoría: se atribuye, no se «corrige» |
| R10 | El `-shm`/`-wal` aparece o desaparece entre mediciones y se interpreta como corrupción | Alta | Bajo | huella de datos **sin sidecars** + listado de sidecars aparte | ya documentado: los sidecars siguen a la última conexión |
| R11 | Se instala 1.3.0 pero el host carga el **1.2.0 cacheado** en memoria | Baja | Medio | reinicio completo del host y comprobación del `package.json` + `PA_VERSION` servido | reinicio limpio y comprobación con sesión |
| R12 | Confundir `pa/1.4.0` (contrato de la API) con `1.3.0` (versión npm) | Media | Bajo | ambos valores se leen por separado | matriz los separa (V-1.3 vs V-1.5) |

## 2. Condiciones de parada (cualquiera detiene el acto)

1. **Artefacto**: el `.tgz` local o el descargado del registro no da `sha256 f848b73e…` / `dist.integrity
   sha512-Q/EvDeGx…` / 74 ficheros / 310 675 B.
2. **Respaldos**: la copia no coincide por hash, no abre en sólo lectura o sus recuentos difieren
   (`integrity_check` distinto de `ok`).
3. **Host**: no se consigue `0` procesos, el puerto `57200` sigue ocupado o un `-wal` no está a `0 B` antes de
   copiar o de mover `node_modules`.
4. **Datos**: cualquier `.sqlite3` cambia de sha256 antes de empezar a instalar (algo escribió cuando no
   debía) o aparece una acción de auditoría no atribuible.
5. **Perfil**: `package.json`/`pnpm-lock.yaml` no coinciden con el inventario de referencia, o el ensayo del
   lock en la copia falla.
6. **Otros plugins**: el inventario de `node_modules` cambia para cualquier paquete distinto de
   `@designerbyron/lifecode-rag`.
7. **Versión instalada**: tras la instalación, el `package.json` del paquete no es `1.3.0` o el recuento no es
   74.
8. **Alcance**: cualquier paso exige tocar `~/.dsh/cordis.patch.yml`, credenciales, la política global de
   pnpm, otro plugin, datos RAG o los sidecars.
9. **Credenciales**: cualquier verificación que dependa de la sesión del navegador y no haya propietario
   presente → se marca `BLOCKED` y se para ahí; **no** se busca una vía alternativa para autenticarse.

## 3. Riesgos residuales que se aceptan si el propietario firma

| Riesgo | Por qué se acepta | Qué queda como límite |
|---|---|---|
| Ventana de indisponibilidad del host durante la instalación | es inherente a sustituir `node_modules` | el host se cierra y se vuelve a abrir; el rollback es de minutos |
| El panel puede mostrar «panel-unavailable» si el contrato cambia | `pa/1.4.0` es aditivo y la suite lo cubre | si apareciera, el rollback está probado |
| Verificación funcional completa sin sesión del propietario | la compuerta PA01 no se puede saltar por diseño | esos controles quedan `BLOCKED` hasta que el propietario abra el panel |
| Datos que cambian por uso legítimo durante la prueba | el propietario usa la app | se atribuye por la cadena de auditoría; no se reescribe la historia |

## 4. Qué no se hace ni con autorización de ejecución

- Limpiar, restaurar, resetear, hacer stash o commit en ningún repositorio.
- Borrar o «arreglar» sidecars WAL/SHM.
- Abrir bases en modo escritura para «comprobar».
- Reindexar, ingerir, olvidar fuentes o lanzar `sync run`.
- Cambiar la política global de pnpm, `~/.npmrc` o el `minimumReleaseAge` de la máquina.
- Instalar en `headless/` o `web/` sin un acto propio.

## 5. Estado

Ninguna condición de parada está activa **hoy** según lo medido: artefacto verificado, perfil en el estado
inventariado, datos con huella estable, 5 procesos del host (se cerrarán en la fase de ejecución). Este
registro es el que gobierna esa fase; **no se ha ejecutado ningún paso**.
