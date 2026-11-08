# Gobernanza de la colección de plugins

> Resumen ejecutivo para quien trabaja aquí, humano o agente. El detalle vive en
> [`docs/`](docs/README.md). Este fichero entra en cada prompt de cada sesión: se mantiene corto a
> propósito.

## Qué es este repositorio

**LifeCode Plugins** — plugins propios para DeepSeek Harness. Ahora mismo contiene dos:

- [`skill-compiler`](skill-compiler/README.md) — el compilador de conocimiento que convierte lo aprendido en
  una tarea en una skill **propuesta**, con ámbito de proyecto y esperando aprobación humana.
- [`lifecode-skill-center`](lifecode-skill-center/README.md) — el centro visual que administra ese
  conocimiento: biblioteca, compuerta de calidad, versiones con vuelta atrás, **interruptor por proyecto** y
  detección de lo que ya existe. Panel propio en la barra lateral; la IA crea y propone, la persona aprueba y
  enciende.

Cada plugin vive en su carpeta, con su código, sus pruebas y su documentación, y **se instala por ruta
absoluta** con el gestor de plugins del harness. El contrato de la casa está en
[`docs/01-governing-rules.md`](docs/01-governing-rules.md).

## Reglas que no se negocian

1. **Núcleo puro, adaptador fino.** Lo que decide algo vive en `lib/`, sin dependencias del harness, y se
   prueba con `node --test`. Lo que se registra en el harness (`index.js`) es lo más corto posible,
   porque es la única parte que no se puede probar antes de instalar.
2. **Las pruebas no tocan nada real.** Cada plugin con estado en disco redirige su raíz a una caja de
   arena y tiene una puerta que **mide** que el almacén real no cambió.
3. **Nada se activa solo.** Lo que un plugin produce para que lo lea el modelo se propone y espera
   aprobación humana; aprobar no es una herramienta del modelo.
4. **Solución robusta, nunca parche.** Si algo es temporal, se declara. Un arreglo que sólo tapa el
   síntoma se rechaza por sistema, aunque cueste más trabajo.
5. **Evidencia antes que adjetivos.** "Terminado" va con lo que lo demuestra: pruebas en verde, medición,
   o el artefacto leído de vuelta. Lo que no está verificado se dice que no lo está.
6. **Un commit = una cosa**, y el push se decide y se declara. Nunca `git add -A`.
7. **Los datos del usuario no se tocan sin su OK.** Copias, borrados, restauración, publicación y
   cualquier cambio en la biblioteca compartida (`~/.dsh/`) se confirman antes.

## Dónde está cada cosa

| Ruta | Qué es |
|---|---|
| `skill-compiler/` | El plugin: `lib/` (lo que decide), `index.js` (adaptador Cordis), `client.js` (pieza de interfaz), `bin/` (CLI), `tests/` |
| `skill-compiler/docs/` | Documentación del plugin: operación, dependencias, desarrollo, feedback visual, confianza |
| `lifecode-skill-center/` | El centro de skills: `lib/` (núcleo puro), `index.js` (adaptador), `client.js` (panel completo), `tools/`, `tests/` |
| `lifecode-skill-center/docs/` | Arquitectura, operación y desarrollo del centro |
| `plans/` | Planes de trabajo, con sus hashes cuando se autorizan |
| `CHANGELOG.md` | Historial de la colección |
| `docs/` | La gobernanza de este repositorio (este contrato, visión, arquitectura, reglas de oro, sistema de diseño) |

## Cómo se trabaja aquí

```sh
cd skill-compiler
npm install            # dependencias del harness, declaradas en el manifiesto
npm test               # 276 pruebas
npm run test:hermetic  # las pruebas + huella del almacén real antes y después
node bin/skill-compiler.mjs doctor   # dice si algo falta y con qué comando se arregla

cd lifecode-skill-center
npm install            # @deepseek-ai/dsh-tools, para el adaptador
npm test               # 103 pruebas
npm run test:hermetic  # la suite + huella del almacén real antes y después
npm run check          # instalación y pureza del núcleo
```

Antes de tocar código: leer este fichero y el índice de [`docs/`](docs/README.md). Mantener
[`MEMORY.md`](MEMORY.md) al día: es la memoria durable del repositorio, no el historial de una sesión.
