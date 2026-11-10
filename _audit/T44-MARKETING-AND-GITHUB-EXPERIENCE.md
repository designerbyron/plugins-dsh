# T44-M — Marketing y experiencia de repositorio (LifeCode Skill Center 1.0.1)

**Tarea:** `task-52` (T44-M). **Ámbito:** `README.md` raíz y `lifecode-skill-center/README.md` (más este
informe). **Fecha:** 2026-11-09. **Sin cambios de código, tests, datos ni git.**

Fuentes de verdad usadas: `lifecode-skill-center/package.json` (1.0.1, MIT, bundle y cliente),
`docs/INSTALLATION.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/TROUBLESHOOTING.md`,
`CHANGELOG.md`, `_audit/FINAL-RELEASE-READINESS.md` §E, `_audit/T42-CHAT-NOTIFICATIONS.md`,
`_audit/t44-assets/README.md` y las capturas públicas de `lifecode-skill-center/docs/images/`.

## 1. Diagnóstico del README anterior

**Producto (`lifecode-skill-center/README.md`, 293 líneas no vacías / 16 672 B).** Era un manual de administración
correcto y honesto, pero no una primera impresión de producto:

- abría con versión y una descripción funcional; no había hero, tagline, propuesta de valor ni prueba
  visual inmediata;
- la captura aparecía a mitad del documento, en tablas de dos columnas con imágenes diminutas;
- no existía la narrativa **problema → consecuencia → respuesta**, ni los cinco pilares del ciclo de vida,
  ni los diferenciadores;
- el posicionamiento «no es un gestor de prompts» no estaba formulado;
- no había versión en español;
- la instalación era honesta (GitHub no verificado), pero quedaba enterrada entre secciones técnicas;
- no se usaba el social preview ni el icono 512 en la cabecera.

**Raíz (`README.md`, 245 líneas no vacías / 13 267 B).** Presentaba bien la familia y los dos plugins, pero como
catálogo técnico: sin tagline de producto, sin narrativa de conocimiento, con la captura del Center como
ilustración suelta y sin separación clara entre «familia LifeCode» y «producto Skill Center». La sección de
instalación ya era honesta sobre la publicación pendiente.

**Riesgo detectado:** el material técnico existente contiene límites reales (notificaciones sólo en la UI,
`skill.loaded` ≠ aplicación, instalación GitHub no verificada, testquality rojo preexistente). Una landing
que los omitiera sería marketing deshonesto; por eso el rediseño los conserva como afirmaciones explícitas.

## 2. Posicionamiento

| Elemento | Texto canónico |
|---|---|
| Nombre | **LifeCode Skill Center** |
| Posicionamiento | **Turn AI Experience Into Reusable Knowledge** |
| Tagline | **Knowledge is Power. Skills Preserve Knowledge.** |
| Headline | **Your AI Knowledge. Organized, Protected and Reusable.** |
| Frase de ciclo | **Create. Preserve. Improve. Reuse.** |
| Idea final | *LifeCode Skill Center preserves the knowledge behind every great AI workflow.* |
| Categoría | Conservación y gestión estructurada de conocimiento reutilizable |

**Lo que NO es:** un gestor de prompts, un chat, un sustituto del Skill-Compiler, un sistema autónomo de
autoaprobación. **Lo que sí es:** el centro visual donde el conocimiento propuesto por la IA se conserva,
se evalúa, se versiona, se protege y se reutiliza con decisión humana.

## 3. Estructura final

### 3.1 README del producto (565 líneas totales / 422 no vacías / 30 091 B)

| Bloque | Sección | Líneas |
|---|---|---|
| A | Hero: icono, tagline, versión/badges objetivos, enlaces, social preview, captura, headline | 1–38 |
| B | The Problem — AI Knowledge Shouldn't Disappear (tabla de 8 filas) | 40–57 |
| C | The Solution | 59–70 |
| D | One Center. A Complete Skill Lifecycle (5 pilares 01–05) | 72–82 |
| E | Everything You Need to Manage AI Skills (5 grupos) | 84–112 |
| F | More Than a Skill Library (5 diferenciadores) | 114–124 |
| G | Product Showcase: las 8 capturas en secuencia narrativa | 126–169 |
| H | How It Works (diagrama ASCII del ciclo) | 171–194 |
| I | Why LifeCode | 196–206 |
| J | Verification Snapshot (métricas reales + testquality) | 208–224 |
| K | Installation (PENDIENTE / NO VERIFICADO) | 226–244 |
| L | Documentation & Support | 246–258 |
| M | Trust & Transparency | 260–274 |
| — | Footer/licencia (producto, versión, enlaces, MIT) | 276–284 |
| — | Sección **Español** completa (misma estructura, claramente identificada) | 286–565 |

### 3.2 README raíz (219 líneas totales / 163 no vacías / 10 918 B)

`English` → presentación de la familia, «Two plugins, one principle», tabla de los dos plugins, contenido
del repositorio, «Why LifeCode», captura, instalación pendiente, documentación, nota del repositorio,
licencia/soporte. Después `Español` con la misma estructura. Enlaces ancla `#english` / `#español`, README
de cada plugin y `docs/`.

El hero se ajustó en la revisión final del Lead a una fila de **dos tarjetas** (póster del Skill-Compiler +
social preview del Skill Center) para representar la familia; el resto del documento no cambió.

## 4. Problema, beneficios y capacidades

La tabla de problema tiene las 8 filas pedidas: conocimiento disperso, experiencia no reutilizable, sin
versiones, asignación sin contexto, identidades/nombres duplicados, mejoras sin revisión, transferencia
difícil y actividad no rastreable. Cada fila cierra con una respuesta concreta del producto, no con un
adjetivo.

Los cinco pilares (01–05) están redactados como beneficio: **Create & Preserve**, **Organize & Activate**,
**Evaluate & Improve**, **Protect & Govern**, **Transfer & Reuse**. Los cinco grupos de capacidades
(Skill Management, Project Management, Quality & Governance, Knowledge Preservation, Activity & Visibility)
reutilizan los hechos técnicos ya documentados: 7 estados de proyecto, 6 colisiones, preflight fail-closed,
inventario con ejes y confianza, journal separado y notificaciones en la UI.

Los cinco diferenciadores evitan comparaciones con otros productos: ciclo de vida, contexto de proyecto,
evidencia, fronteras humano/IA y procedencia.

## 5. Assets usados

| Asset | Bytes | Uso |
|---|---:|---|
| `assets/lifecode-skill-center/app-icon-512.png` | 131 098 | Icono del hero (producto y ES) |
| `assets/lifecode-skill-center/github-social-preview.png` | 922 868 | Social preview embebido en el hero. 1280×640, sha256 `cd6e11a281d79000c0338daad9b8098c9efb77748895fcfd43187cade2e12e6d`, sin metadatos. Arte corregido por el usuario y reoptimizado sin pérdida. |
| `lifecode-skill-center/docs/images/projects-discovered.png` | 105 385 | Hero + showcase + raíz |
| `.../skill-detail.png` | 133 136 | Showcase |
| `.../project-detail.png` | 168 098 | Showcase |
| `.../collisions.png` | 106 509 | Showcase |
| `.../activity-center.png` | 126 032 | Showcase |
| `.../activity-toast.png` | 47 529 | Showcase |
| `.../activity-chat.png` | 32 275 | Showcase |
| `.../portability.png` | 107 004 | Showcase |

Las 8 capturas son los renders neutrales ya publicados (fixture `acme-web`, `demo-shop`,
`sitio-corporativo`, `panel-interno`, `laboratorio`); no se generó ni copió ninguna imagen nueva. El SVG de
marca no se incrusta porque el render de GitHub no garantiza el mismo tratamiento que el PNG.

## 6. Enlaces comprobados

Se extrajeron con script todos los destinos Markdown `](...)` y todos los `src="..."` de `<img>` de ambos
README. Resultado: **79 enlaces relativos comprobados, 0 rotos**. Se validaron rutas de documentos, capturas,
assets, `CHANGELOG.md`, `LICENSE`, `docs/` y `_audit/FINAL-RELEASE-READINESS.md`; los anclajes internos
`#english` y `#español` corresponden a encabezados existentes.

Los enlaces externos (GitHub, Issues) no se han abierto por red: se consideran válidos por construcción y
**no verificados** de alcanzabilidad en esta sesión.

## 7. Validación móvil / escritorio (razonada)

- Las tablas problemáticas se limitan a 3 columnas con celdas cortas; la tabla de pilares usa 3 columnas y
  marcas numéricas; la de métricas usa 2. No hay tablas de 6+ columnas que fuercen scroll horizontal.
- Las imágenes usan `<img>` con ancho fijo (760 px en hero, 720 px en showcase) y `alt`; en un viewport
  estrecho el navegador las reduce al ancho disponible, sin desbordar el contenedor.
- El diagrama ASCII mide ~72 caracteres y puede desplazarse horizontalmente en móvil sin romper el layout;
  no se usa como única explicación (hay texto equivalente).
- Encabezados jerárquicos y listas cortas favorecen la lectura en pantalla pequeña.
- **No verificado en navegador real:** no se ha renderizado en GitHub ni en un viewport móvil; la validación
  es estructural y de contenido.

## 8. Claims omitidos por falta de evidencia

| Claim omitido | Motivo |
|---|---|
| «Instalación desde GitHub verificada / un clic» | Sigue BLOCKED por publicación; sólo hay ruta local verificada |
| «Notificaciones del sistema operativo / push» | No existen: sólo UI de DSH con la ventana abierta |
| «Toast global probado en conversación real» | Contrato y transporte verdes; aceptación viva de 12 pasos pendiente |
| «Funciona con cualquier versión de DSH» | Sin matriz de compatibilidad publicada |
| «Aprendizaje automático en segundo plano» | No hay scheduler ni aprendizaje de fondo |
| «Sustituye al Skill-Compiler» | Son plugins independientes; el Compiler propone y el Center administra |
| «Cifras de producción / usuarios / rendimiento a escala» | No hay datos medidos |
| «Certificación de seguridad» | Sólo hay modelo de seguridad y límites documentados |
| «Detección exhaustiva de secretos» | La heurística se declara como tal y no promete exhaustividad |
| Comparaciones con otros productos | El adendum pide no comparar negativamente |

## 9. Social preview

El archivo existe (`assets/lifecode-skill-center/github-social-preview.png`, 1280×640, **922 868 B**, sha256
`cd6e11a281d79000c0338daad9b8098c9efb77748895fcfd43187cade2e12e6d`, < 1 MB y sin metadatos) y está embebido
en el README. El arte fue corregido por el usuario y el PNG se reoptimizó sin pérdida; el original de
1 104 356 B se conserva en `_audit/t44-assets/social-preview-user-original.png`, fuera de los candidatos.
**La configuración del social preview del repositorio en GitHub Settings sigue
siendo manual y está pendiente**: no se ha subido ni configurado desde esta sesión, y no se usan credenciales
ni API de GitHub.

## 10. Estado de instalación

**BLOCKED / NO VERIFICADO.** Ambos README lo declaran en un blockquote visible antes de los pasos. La ruta
local absoluta (clone + `npm install` + **Plugins → Add plugin**) es la verificada; la instalación por
dirección Git se presenta como candidata y remite a `docs/INSTALLATION.md`, que mantiene la prueba con perfil
temporal como pendiente. No se promete publicación ni disponibilidad en el mercado de plugins.

## 11. Notificaciones en conversación

Se describe el mecanismo real (slot global `shell.overlay`, eventos de sesión existentes, sin polling) y se
etiqueta: **«verified by contract and transport tests; the 12-step live acceptance is still pending»**. No se
presenta el toast global como funcionalidad validada en la GUI viva.

## 12. Comparación antes / después

| Fichero | Antes (no vacías · bytes) | Después (totales / no vacías · bytes) | SHA-256 después |
|---|---:|---:|---|
| `lifecode-skill-center/README.md` | 293 · 16 672 B | **565 / 422 · 30 091 B** | `57cd7be727d190030ef240fc1608e07394d7c5d49b9b9721b6b95fe13acdda92` |
| `README.md` (raíz) | 245 · 13 267 B | **219 / 163 · 10 918 B** | `98f8022c7159a2ecf6e2c2717227e57d8b92e5ce355836b6f8cd97dbf4daa4b7` |

Los bytes y líneas «antes» son los medidos en el encargo; **el SHA-256 previo no se conservó** (los ficheros
estaban modificados sin snapshot congelado) y no se inventa. El producto crece porque añade narrativa,
showcase y la sección ES completa; la raíz se acorta porque delega el detalle en el README del producto.
«No vacías» es el recuento con `Measure-Object -Line`; «totales», con `ReadAllLines`. El antes se midió con
el mismo método de no vacías, así que la comparación de líneas es homogénea.

## 13. Privacidad

Grep sobre ambos README de los patrones de ruta de perfil de Windows y POSIX, del nombre de usuario de la
máquina y de los cinco nombres de proyecto privado del fixture anterior: **0 coincidencias**. No hay rutas
personales, tokens ni datos de proyectos. El handle público de la cuenta de GitHub aparece sólo como
autor/repositorio (es información pública del `package.json`). Este informe tampoco reproduce esos valores:
los cita por categoría, no literalmente.

## 14. Pendientes

1. Publicación del repositorio y verificación real de la instalación desde GitHub (acción humana).
2. Subida manual del social preview en GitHub Settings.
3. Aceptación viva de 12 pasos del toast en conversación.
4. Render real en GitHub móvil/escritorio (la validación actual es estructural).
5. Regenerar `COMMIT-CANDIDATES-R17.md` / `COMMIT-PLAN-R17.md` con este nuevo snapshot: lo hará `task-53`.
