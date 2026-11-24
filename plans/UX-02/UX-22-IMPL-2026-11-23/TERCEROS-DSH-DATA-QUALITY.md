# Terceros — `dsh-data-quality@0.3.30`, evidencia y límites (2026-11-23)

**Qué es este documento:** registro de lo medido sobre el complemento de terceros que convive con LifeCode RAG en
el perfil `desktop`. No se ha modificado el paquete, ni su almacén, ni su configuración.

**Método:** copia del paquete a un directorio temporal (`cache/scratch/dq-qa`) con sus *peers* extraídos en
sólo lectura de `app.asar`; ejecución de las tres herramientas contra un CSV **sintético** (duplicado, celda vacía,
atípico, fecha y cadenas con forma de secreto); almacén en memoria. Nada de datos reales del propietario.

## 1. Ejecución real (sintética)

| Herramienta | Veredicto | Evidencia |
|---|---|---|
| `data_profile` | **FUNCIONA** | 5 filas × 7 columnas; `duplicateRows=1 (20 %)` con índice de muestra; `amount` con 1 atípico (50 000); `qty` 40 % faltantes; `updated` inferida como fecha; scorecard 93,7 % con `accuracy: null` (no fabricada) |
| `data_clean` | **FUNCIONA CON LÍMITES** | Cadena de 4 reglas 5→4 filas, relleno por media = 6 (verificado a mano), escrito en `out/sales_clean.csv` sin tocar el origen; `dryRun` no escribe ni persiste y devuelve `diffPreview` |
| `data_verify` | **FUNCIONA** | 5 reglas (2 pasan, 3 fallan con evidencia por fila) y 4 expectativas con `actual` frente a `expected`; `passed:false` es un **resultado**, no un error |
| `data_report` | **NO VERIFICABLE en este acto** | Sólo lectura de código; no se ejecutó su ruta de almacén |

## 2. Discrepancia de versión (defecto del tercero, registrado)

- `package.json` declara **`0.3.30`**.
- La constante interna `VERSION` del módulo dice **`0.3.22`** (`lib/index.js:1170`), y sólo aparece en la línea de
  log de montaje (`lib/index.js:3923`); no viaja en los informes.
- **Consecuencia real:** la identidad de la versión instalada es la del manifiesto; cualquier traza que se apoye en
  la constante interna dirá `0.3.22`. Se registra como observación; **no se corrige** (es de terceros).

## 3. Secretos: **no redacta ni elimina**

Medido: una cadena con forma de clave (`AKIA…`) y otra con prefijo `sk_live_` viajan íntegras a la salida de
`data_profile`, a la de `data_clean` y al fichero limpiado (`grep -c` sobre el fichero: 0 apariciones de
`redacted`, 2 de `AKIA`, 1 de `sk_live_`). Lo que se vio censurado en el terminal fue **el visor de la
herramienta de quien medía**, no el complemento.

**No es una capacidad existente.** `data_clean` limpia duplicados, faltantes, tipos y unidades; no es una
herramienta de redacción. Cualquier proceso que lo use para «quitar secretos» está mal diseñado.

## 4. Escrituras y convivencia

- Escribe en: `outputPath` (acotado al workspace, nunca sobre el origen) y en el dominio de almacenamiento
  `data_quality` (tabla `reports`, clave `reportKey`). No hay *journal*, ni sidecars.
- **Almacén del propietario intacto:** `~/.dsh/storages/data_quality.json` con SHA-256 `9fd2c255…` (6 881 B) y la
  misma `mtime` antes y después. El paquete instalado tampoco cambió (`find -newermt` vacío).
- Convivencia con LifeCode RAG: `zod 4.6.6` **privado** dentro de su `node_modules`; RAG no declara dependencias.
  Nombres de herramienta disjuntos (`data_*` frente a `lifecode_rag_*`). Sin `dsh.client` (server-only), sin
  `storageDomain` compartido, y sus parches de cordis son inserciones con `id` distinto.

## 5. Reglas de uso que se derivan

1. **Nunca** datos sensibles reales en `data_*`, ni siquiera en `dryRun`.
2. **Nunca** tratar `data_clean` como redacción de secretos.
3. La versión que se cite en informes es la del **manifiesto** (`0.3.30`), anotando la discrepancia interna.
4. No se modifica el paquete de terceros sin autorización específica.
