# Funcionamiento

Cómo funciona `skill-compiler` por dentro: dónde se engancha al harness, dónde guarda lo que sabe, y qué
recorrido hace cada operación desde que el modelo la pide hasta que se sirve una skill.

## 1. Los tres puntos de extensión

Un plugin de Host se engancha donde el harness lo permite, y aquí se usan tres:

| Punto | Para qué | Por qué ese y no otro |
|---|---|---|
| `ctx.systemPrompt.section({ name: 'skill-compiler:protocol', order: 9000, interpolate: false })` | El protocolo que hace que el modelo sepa **cuándo** proponer y vendorizar | Es texto **estático y ordenado**: entra una vez, en una posición fija, y no rompe el prompt caching. `system-prompt/assemble` está prohibido por la guía de DSH para añadir texto, y además reemplazaría el ensamblado de todos los demás plugins |
| `ctx.tools.register(defineTool(...))` | Cuatro herramientas: proponer, vendorizar, revisar y comprobar el origen | Una herramienta tiene **esquema validado**: los argumentos se comprueban antes de que nada toque el disco, cosa que un bloque de texto en la respuesta del modelo no permite |
| `ctx.skills.registerProvider(...)` | Servir al modelo **solo** las skills aprobadas del proyecto actual | El registro de skills acepta cualquier proveedor y fusiona lo que reporte. Un proveedor propio es la única forma de filtrar por proyecto |
| `ctx.sessionProjections.register(...)` | El estado del **feedback visual**, plegado de eventos que ya existen | La guía prohíbe añadir tipos de evento propios (un evento desconocido sin marca `ignorable` impide reabrir la sesión), así que el estado se deriva de la traza. Es opcional y a prueba de fallos: sin él se pierde el adorno, no el trabajo (ver [`FEEDBACK-VISUAL.md`](FEEDBACK-VISUAL.md)) |

El plugin declara `inject: ['tools', 'skills', 'systemPrompt']`: si en un perfil falta alguno de esos
servicios, queda **inactivo** en lugar de lanzar al arrancar.

## 2. Dónde guarda lo que sabe

Nada dentro de un repositorio y nada mezclado con la biblioteca curada de skills:

```
$DSH_HOME/
  skills/                       ← biblioteca curada (solo se LEE; nunca se escribe desde aquí)
  skill-compiler/               ← almacén del plugin
    projects/<clave>/           ← una clave por proyecto; sale del cwd, no lo elige el modelo
      proposed/<id>/            ← propuesto, NO servido al modelo
        SKILL.md
        meta.json
        provenance.json         ← solo en las vendorizadas
        upstream/               ← solo en las vendorizadas: el original verbatim
      approved/<id>/            ← aprobado: esto es lo que el proveedor sirve
      rejected/<id>/            ← apartado sin borrar
      superseded/<id>-<fecha>/  ← versión anterior de una skill reemplazada
      superseded/proposals/<id>/<revision>/  ← candidata sustituida por otra del mismo id (paquete entero)
```

`superseded/proposals/` es **histórico, no operativo**: no sale en pendientes, no se aprueba y no se publica.
Cada `<revision>` lleva marca de tiempo y huella del paquete, no se reutiliza, y su manifiesto
(`<revision>.json`, al lado de la carpeta) declara fichero a fichero el `sha256` y los bytes que tenía, más
el motivo de la sustitución y la huella de la candidata que la reemplazó. La carpeta archivada queda byte a
byte como estaba: el manifiesto se escribe fuera de ella.

**La clave de proyecto** se calcula como `<último-tramo-del-cwd>-<hash8-de-la-ruta-completa>`. El hash
evita que dos proyectos con la misma carpeta en rutas distintas compartan ámbito y, con él, skills.

## 3. `skill_propose`: conocimiento propio

```
modelo → skill_propose(args)
  ├─ 1. scopeOf(exec)                    el cwd de la sesión; si no hay, se rechaza (no-project)
  ├─ 2. validateInput                    id, descripción, cuerpo, secretos, rutas personales
  ├─ 3. checkOverlap                     contra la biblioteca curada Y lo aprendido, con ámbito
  ├─ 4. renderSkill                      frontmatter del contrato DSH + metadata.dsh
  └─ 5. writeAtomic                      escribe la carpeta entera y luego la renombra
       → queda en proposed/ · NO se activa
```

`writeAtomic` escribe en `<destino>.tmp-<aleatorio>`, borra el destino anterior y renombra. De ahí que
reproponer el mismo id sea **idempotente**: reescribe su carpeta y no deja restos temporales.

## 4. `skill_vendor`: nuestra versión de una skill ajena

```
modelo → skill_vendor({ url })
  ├─ 1. parseSource(url)      ¿qué es? un .md suelto, un blob/tree de GitHub, la raíz de un repo
  ├─ 2. fetchSource(...)      descarga SOLO markdown: SKILL.md + hasta 10 references/*.md
  │                           · si la carpeta tiene varias skills → needs-choice, con los nombres
  │                           · techo de 512 KB por fichero · timeout de 15 s · solo https
  ├─ 3. scanUpstream(...)     credenciales, órdenes dirigidas al agente, texto invisible
  │                           → si hay algo de eso: BLOCKED y no se escribe NADA
  ├─ 4. adaptUpstream(...)    frontmatter DSH, descripción acotada, título normalizado,
  │                           referencias reescritas a upstream/references/, avisos de lo omitido
  └─ 5. propose(..., extraFiles)
       ├─ SKILL.md            nuestra versión, con banner de procedencia y metadata.dsh.upstream*
       ├─ upstream/<ruta>     el original VERBATIM, con su SHA-256
       └─ provenance.json     URL, ref, SHA-256, fecha, ficheros, omitidos, avisos, licencia
       → queda en proposed/ · NO se activa · nunca se ejecuta nada del origen
```

El proveedor no distingue una skill propia de una vendorizada: las dos son skills aprobadas del
proyecto. La diferencia viaja en el frontmatter (`metadata.dsh.upstreamUrl`, `upstreamRef`,
`upstreamSha256`, `upstreamFetchedAt`) y en `provenance.json`.

## 5. `skill_upstream_check`: ¿se movió el origen?

Re-descarga el origen y compara su SHA-256 con el guardado. **No toca nuestra versión**: está adaptada a
propósito, y sobrescribirla con lo que publique el upstream destruiría justo lo que la hace útil.
Devuelve el hecho para que decidir sea humano.

## 6. El ciclo de vida de una skill

```
        skill_propose / skill_vendor
                    │
                    ▼
              ┌───────────┐   CLI: approve   ┌───────────┐
              │ proposed  │ ───────────────▶ │ approved  │ ──▶ el proveedor la sirve
              └───────────┘                  └───────────┘     (solo en su proyecto)
                    │                              │
        CLI: reject │                              │ re-proponer + approve
                    ▼                              ▼
              ┌───────────┐                  ┌──────────────┐
              │ rejected  │                  │ superseded/  │  la anterior se aparta, no se borra
              └───────────┘                  └──────────────┘
```

Aprobar vive en la **CLI**, no en una herramienta del modelo. Si fuera una herramienta, el modelo podría
auto-aprobarse su propuesta y la revisión humana sería decorativa. `skill_review` existe para que el
modelo pueda **leer** lo pendiente, y no aprueba nada.

## 7. Lo que se rechaza, y con qué regla

| Regla | Efecto | Dónde se aplica |
|---|---|---|
| `id` en kebab-case, ≤ 64, empezando por letra | Error | Propuesta y vendorizado |
| Descripción de 12 a 300 caracteres, una sola línea | Error | Propuesta y vendorizado (en vendorizado, se recorta con aviso) |
| Cuerpo de al menos 200 caracteres | Error | Propuesta y vendorizado |
| Formas de credencial (`sk-`, `ghp_`, JWT, PEM, `clave=valor`, Bearer) | **Bloqueo** | Propuesta (veta) y vendorizado (no escribe nada) |
| Órdenes dirigidas al agente, tuberías a shell, `sudo`, exfiltración | **Bloqueo** | Vendorizado |
| Caracteres invisibles (ancho cero, sobreescritura bidireccional) | **Bloqueo** | Vendorizado |
| Rutas personales (`C:\Users\<alguien>\…`, `/home/<alguien>/…`) | Error | Propuesta y vendorizado |
| Rutas absolutas en general | Aviso | Propuesta y vendorizado |
| Id ya ocupado en la **biblioteca curada** | Error | Propuesta y vendorizado |
| Tema parecido (Jaccard ≥ 0,5 sobre nombre + etiquetas + descripción) **en el mismo ámbito** | Error | Propuesta y vendorizado |
| Tema parecido **en otro proyecto** | Se informa, no se veta | Propuesta y vendorizado |
| Reproponer el **mismo id** en el mismo ámbito | Se trata como actualización | Propuesta |
| Ficheros que no son markdown, y carpetas como `scripts/` | Se omiten y se declaran | Vendorizado |
| `http://` o un enlace que no sabe leer | Error | Vendorizado |

El umbral de parecido se mide como el **mayor** de dos Jaccard: uno sobre los tallos del nombre (sin las
palabras de familia como `hash` o `authorized`) y otro sobre una bolsa amplia (nombre, etiquetas,
descripción y `whenToUse`). Las constantes de palabras vacías son las mismas que usa el guardián de la
biblioteca curada, para que las dos puertas midan parecido de la misma forma.

## 8. Lo que este plugin no hace, por diseño

- **No instala nada de un origen.** Ni `npm install`, ni `git clone`, ni descarga de binarios.
- **No ejecuta nada.** No hay un solo `exec`, `spawn` ni `eval` sobre contenido ajeno: se lee, se analiza
  y se escribe texto.
- **No activa nada solo.** Todo pasa por `proposed` y espera aprobación humana.
- **No sobrescribe una versión adaptada.** El origen se comprueba, no se fusiona.
- **No escribe fuera de su almacén.** La biblioteca curada se lee y nunca se toca.
