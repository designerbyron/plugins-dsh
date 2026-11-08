# LifeCode Skill Center

El centro visual donde el conocimiento reutilizable de DeepSeek Harness se crea, se evalúa, se publica y se
**enciende por proyecto con un interruptor**.

No es el compilador anterior con un panel encima. El compilador anterior propone una skill y espera; este
centro es el sistema que la administra: biblioteca persistente, versiones inmutables, referencias,
asignaciones por proyecto, telemetría y propuestas de mejora. Lo que ambos comparten es la regla de la casa:
**nada se activa solo.**

## La promesa, en una frase medible

Una skill creada por la IA se puede encender en dos proyectos, y sólo en el que se encendió llega al agente.
Eso está medido de punta a punta en [`tests/api.test.mjs`](tests/api.test.mjs): se crea con `actor:'ai'`, el
proveedor de skills la sirve en A y en B, se apaga en A y A deja de verla mientras B la sigue viendo.

## Qué hay dentro

| Pieza | Qué hace | Dónde |
|---|---|---|
| Núcleo puro | Decide y valida sin el harness: identidad, `SKILL.md`, estado, compuerta de calidad, versiones, detección | [`lib/`](lib/) |
| Adaptador | Registra prompt, herramientas, proveedor de skills y la ruta HTTP del panel | [`index.js`](index.js) |
| Panel | Interfaz completa en la pestaña propia: Overview, Library, Projects, Improvements, Analytics | [`client.js`](client.js) |
| Herramientas | Cuatro herramientas para el agente; ninguna aprueba ni activa | [`lib/tools.mjs`](lib/tools.mjs) |
| Pruebas | 119 pruebas, sin tocar nunca el almacén real | [`tests/`](tests/) |

El ciclo de vida que el panel representa: **crear → evaluar → publicar → asignar → usar → medir → mejorar**.

## Instalación

El perfil de desarrollo recibe el plugin por ruta absoluta, como el resto de la casa:

```jsonc
// %USERPROFILE%\.dsh\profiles\desktop\package.json
"dependencies": { "@local/lifecode-skill-center": "link:C:/xampp/htdocs/plugins-dhs/lifecode-skill-center" },
"dsh": { "profile": { "bundles": ["@local/skill-compiler", "@local/lifecode-skill-center"] } }
```

y el parche del bundle inserta el plugin (`cordis.patch.yml`). Después de instalar hay que **reiniciar el
harness**: el servidor web registra la ruta al montar el plugin, y los catálogos de skills se cachean.

## Cómo se usa

- **Panel**: aparece como icono propio en la barra lateral; abre una página completa, no un panel estrecho.
- **Agente**: `lifecode_skill_search` (¿ya existe?), `lifecode_skill_create` (crear, queda activa en ningún
  proyecto), `lifecode_skill_improve` (propone una versión nueva), `lifecode_skill_status` (qué hay aquí).
- **Persona**: enciende y apaga por proyecto, aprueba o rechaza mejoras, importa lo que ya existía en disco.

## Dónde vive el estado

- Almacén: `%USERPROFILE%\.dsh\lifecode-skill-center\center.json` (documento único, escritura atómica).
- Vista materializada: `%USERPROFILE%\.dsh\lifecode-skill-center\materialized\<proyecto>\<skill>\SKILL.md` —
  lo que el harness carga de verdad. Es derivada: se puede borrar y se rehace.
- Variable `LIFECODE_SKILL_CENTER_ROOT` para apuntar a otro almacén (es lo que usan las pruebas).

## Garantías que el código protege

1. **Apagar no borra** y no afecta a otros proyectos; se recuerda la versión que tenía puesta.
2. **Clonar no toca el original**: `forkSkill` crea otra skill con su propio ciclo.
3. **Mejorar es proponer**: la versión nueva existe cuando una persona la aprueba, con diferencia visible y
   vuelta atrás.
4. **Cargar no es aplicar**: `skill.loaded` cuenta que el catálogo entregó la skill; no afirma que el modelo
   la usara. Está escrito así en el panel y en `lib/analytics.mjs`.
5. **La IA no enciende ni aprueba**: el borde (`lib/api.mjs`) devuelve `approval-required` a `actor:'ai'`.

## Comandos

```sh
npm test               # 119 pruebas
npm run test:hermetic  # la suite entera + huella del almacén real antes y después
npm run check          # comprobaciones estáticas de instalación y pureza del núcleo
node tests/check-hermetic.mjs
```

## Estado

Fases del plan: **0 (descubrimiento) a 4 (creación por IA) terminadas y medidas**; 5 (calidad y versiones)
implementada con evaluación, referencias, versiones y vuelta atrás; 6 (analítica) implementada con series de
actividad y uso por skill; 7 (mejora continua) llega hasta **proponer**, que es lo que la política permite.
Fase 8 (release) es lo que falta: instalación verificada visualmente y decisión de push.

El detalle de arquitectura, operación y desarrollo está en [`docs/`](docs/).
