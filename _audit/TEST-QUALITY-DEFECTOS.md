# TEST-QUALITY-DEFECTOS — lo que hoy permite un verde falso

Sólo entran aquí defectos que **hoy** dejan la suite (o el arnés que la mide) en verde
con una implementación incorrecta. Cada uno trae reproducción. Los defectos de
reproducibilidad o de acoplamiento que no producen un verde falso están en
[`TEST-QUALITY.md`](TEST-QUALITY.md).

Resumen:

| # | Defecto | Dónde | Qué deja pasar | Evidencia |
|---|---|---|---|---|
| D1 | Atomicidad sólo de nombre | `tests/state.test.mjs:144` | escritura no atómica (pierde el `rename`) | **medido**: 13/13 verde con `writeFileSync` directo |
| D2 | Espía que nadie lee | `tests/distribute-ui.test.mjs:56` | un componente que nunca llama a `onImport` | **medido**: `calls.length === 0` |
| D3 | Tautología de `JSON.stringify` | `tests/render.test.mjs:96,178,205,263`; `tests/distribute-ui.test.mjs:61` | que la UI llame a la API desde un handler | **semántica + medición**: `JSON.stringify` no serializa funciones |
| D4 | Aguja numérica de un dígito | `tests/render.test.mjs:176` | que el contador «sin declaración» no sea 3 | argumentado: cualquier `3` del árbol satisface |
| D5 | Salto simulado con `ok(true)` | `tests/paths.test.mjs:88,146` | que la guarda de junction no se mida nunca | código visible + comportamiento del runner |
| D6 | Verde en las dos ramas | `tests/repair-api.test.mjs:174` | que la reparación deje de fallar | **medido**: hoy `result.ok === false` y no hay aserción incondicional |
| D7 | Detección ciega de mutantes | `tools/mutation.mjs:325` | que la suite «mate» un mutante por un error de sintaxis o un timeout | **medido**: 14/14 con exit 0, `--only=` ignorado |
| D8 | Aserciones sobre el texto fuente | `tests/client.test.mjs:98` y otros | cambiar conducta conservando los literales | argumentado (30 aserciones) |

---

## D1. «La escritura es atómica» no ejerce la ventana crítica

**Dónde.** `tests/state.test.mjs:144-151`.

```js
test('la escritura es atómica: el fichero final aparece completo', () => {
  const root = tempRoot();
  const state = emptyState(NOW);
  saveState(root, state, { now: NOW });
  const raw = readFileSync(centerFile(root), 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
  assert.equal(JSON.parse(raw).schemaVersion, state.schemaVersion);
});
```

**Qué promete.** Que el fichero final aparece completo, es decir, que un lector nunca ve
un JSON a medias.

**Qué permite.** Cualquier implementación de `saveState` que escriba directamente sobre
`center.json`, sin fichero temporal ni `rename`. La prueba sólo mira el resultado final,
que en una escritura no atómica también es un JSON válido.

**Reproducción medida.**

```sh
# 1. copia del plugin fuera del repositorio, con node_modules enlazado
$base = Join-Path $env:TEMP 'lsc-tq-repro'
robocopy lifecode-skill-center "$base\plugin" /E /XD node_modules .git
cmd /c mklink /J "$base\plugin\node_modules" "$PWD\lifecode-skill-center\node_modules"

# 2. en la COPIA, sustituir en lib/state.mjs las líneas 668-670
#    (tmp + writeFileSync(tmp) + renameWithRetry) por:
#      writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

# 3. la prueba que promete atomicidad sigue verde
node --test "$base\plugin\tests\state.test.mjs"
```

Resultado medido: `tests 13`, `pass 13`, `fail 0`. Y el recuento de la suite completa de
la copia no cambia (`590` pruebas, `580` pass, `10` fail) antes y después del parche: los
10 fallos son pruebas de red-team que ya fallaban en la copia limpia por el entorno de la
copia, no por el parche. Ninguna prueba que estuviera verde pasó a rojo.

**Arreglo.** Escribir en paralelo con la escritura y afirmar que cada lectura es un JSON
completo de la versión anterior o de la nueva; o forzar un fallo entre `writeFileSync` y
`rename` (matar el proceso hijo en ese punto) y comprobar que el fichero final sigue
siendo el anterior y que no queda `.tmp`. Eso sí ejerce la ventana que el nombre promete.

---

## D2. El espía de `onImport` se llena y nadie lo lee

**Dónde.** `tests/distribute-ui.test.mjs:54-88`.

```js
const calls = [];
const tree = ImportSection({ t, onImport: (text) => { calls.push(text); return { ok: true, … }; } });
…
textareas[0].props.onChange({ target: { value: '{"schema":"…"}' } });
});   // ← aquí termina el test; `calls` no se consulta en ninguna línea
```

**Qué promete.** «La biblioteca ofrece importar un paquete y **delega en el panel**».

**Qué permite.** Que `ImportSection` nunca llame a `onImport`: el árbol se renderiza, el
botón está deshabilitado sin texto y el textarea existe, así que las aserciones pasan.

**Reproducción medida.** Añadir al final del test, en una copia:

```js
assert.equal(calls.length, 1, 'el paquete viaja a onImport');
```

Resultado: `AssertionError … actual: 0, expected: 1`. Es decir, **hoy la prueba pasa sin
que la delegación ocurra ni una vez**. Además el test nunca dispara el `onClick` del
botón: sólo cambia el estado del textarea.

**Arreglo.** Recorrer el árbol, invocar `button.props.onClick()`, y entonces
`assert.equal(calls.length, 1)` y comprobar el texto recibido. Si el componente necesita
un re-render tras el `onChange`, montarlo con el arnés de hooks que ya usa
`tests/client.test.mjs`.

---

## D3. `assert.ok(!JSON.stringify(tree).includes('act('))` no puede fallar

**Dónde.** `tests/render.test.mjs:96`, `:178`, `:205`, `:263`;
`tests/distribute-ui.test.mjs:61`.

**Qué promete.** «No habla con la API: delega en `onImport`/`onPolicy`».

**Qué permite.** Que el componente llame a `act(...)` dentro de cualquier handler.

**Por qué es tautológico.** `JSON.stringify` ignora las funciones: un handler es una
función y nunca aparece serializado. Medido:

```
> JSON.stringify({ onClick: () => act('export-skill'), render() {} })
'{}'
```

Así, la aguja `act(` no puede aparecer en `flat` ni con un componente que llame a la API
en cada clic. La aserción es cierta por construcción, no por la conducta del producto.

**Arreglo.** Espiar `act` de verdad (el arnés de `instantiate()` ya inyecta dependencias):
`assert.equal(actCalls.length, 0)` y, en la misma prueba, comprobar que `onImport` sí se
llamó (ver D2). Alternativamente, inspeccionar `props.onClick` y afirmar que su `source`
no contiene `act(`.

---

## D4. `flat.includes('3')` no ancla el contador

**Dónde.** `tests/render.test.mjs:176`.

```js
assert.ok(flat.includes('3'), 'cuenta las entregas sin declaración');
```

**Qué permite.** Que el contador «sin declaración» valga 0, 1 o 5: cualquier `3` del árbol
serializado (un día del mes, un id, otro total, una versión) satisface la aserción. El
fixture tiene un total de 5/3, de modo que el `3` puede venir del total y no del contador.

**Arreglo.** Anclar clave y valor: buscar la propiedad en el árbol y comparar
`assert.equal(nodo.props.children, 3)` o `assert.match(flat, /"sinDeclaracion":3\b/)`.

---

## D5. `ok(true, …); return;` deja la guarda de junction sin medir

**Dónde.** `tests/paths.test.mjs:86-89` y `:144-147`.

```js
if (!junctionSupported()) {
  ok(true, 'junction no disponible en este entorno');
  return;
}
```

**Qué permite.** Que la protección contra escapes de ruta por junction no se ejecute
nunca en un entorno sin junctions, y que el runner lo cuente como una prueba verde más.
Una implementación que permita escapar del proyecto seguiría verde en ese entorno.

**Arreglo.** `t.skip('junction no disponible')` (la omisión se ve en el TAP) o, mejor,
`assert.fail` si el entorno de CI no ofrece lo necesario, para que la falta de cobertura
sea ruidosa en vez de silenciosa. Si la guarda es opcional por diseño, al menos que la
prueba lo declare en el nombre y el TAP lo muestre como skip, no como pass.

---

## D6. La prueba del fallo de publicación tolera el éxito

**Dónde.** `tests/repair-api.test.mjs:174-195`.

```js
if (result.ok === true) {
  assert.equal(loadState(root).state.operations[result.operationId].kind, 'repair-manifest');
} else {
  assert.equal(loadState(root).state.operations, undefined, 'sin éxito no hay comprobante');
  assert.equal(loadState(root).state.events.length, 0, 'sin éxito no hay evento');
}
```

**Qué promete.** «Un fallo de publicación no deja comprobante ni evento».

**Qué permite.** Si la publicación empieza a tener éxito, la rama del `else` no se ejecuta
y la prueba queda verde sin haber comprobado el fallo que da nombre al test.

**Reproducción medida.** Añadir, en una copia, `assert.equal(result.ok, false, …)` justo
después de `runAction`. No falla: hoy `result.ok` es `false`, así que la rama del `else`
es la que corre. Eso confirma que la prueba no fija la condición de fallo, sólo la
aprovecha.

**Arreglo.** `assert.equal(result.ok, false)` incondicional antes del `if`; el escenario
(`branch: 'missing'`, nombre canónico ocupado) está preparado para fallar. Así el test
falla el día que la reparación deje de fallar, en vez de adaptarse en silencio.

---

## D7. El arnés de mutación cuenta como «detectado» cualquier fallo

**Dónde.** `tools/mutation.mjs:325`.

```js
const detected = run.exitCode !== 0;
```

**Qué permite.**

1. Un error de sintaxis en la copia mutada, un timeout o un fallo de infraestructura
   cuentan como mutante muerto. El marcador mide «la suite se rompió», no «la suite
   detectó la mutación».
2. El comando **nunca asigna `process.exitCode`** cuando hay supervivientes
   (`:349-353`): imprime «SUPERVIVIENTES» y sale 0. Un CI que sólo mire el exit code da
   por bueno un catálogo con mutantes vivos.
3. `--only=<id>` se ignora en silencio (`:214-224` sólo acepta `--only <id>`), así que un
   comando selectivo ejecuta los 17 mutantes y tarda/ensucia el informe.
4. El `line` declarado no se contrasta con el fichero: 10 de 14 mutantes declaran una
   línea que no es la que mutan (A/M10-M19 en `TEST-QUALITY.md`).

**Reproducción medida.**

```sh
node tools/mutation.mjs --only=j2-stale-never-removed
```

Resultado: como la forma `=` se ignora, corren todos; imprime `CRÍTICOS: 11/11 (100%)`,
`TOTAL: 14/14 (100%)` y sale **0**.

**Arreglo.** Distinguir detección real: exigir TAP parseable, un mínimo de pruebas
ejecutadas y que el fallo venga de una aserción (`not ok` con `AssertionError`), no de un
`SyntaxError`; asignar `process.exitCode = 1` si quedan supervivientes; aceptar
`--only=<id>`; y validar el `line` contra el `find` (o eliminar el campo si no se va a
verificar).

---

## D8. Aserciones sobre el texto fuente: la conducta puede cambiar sin cambiar el texto

**Dónde.** `tests/client.test.mjs:98` (30 aserciones), `tests/export.test.mjs:79` (18),
`tests/distribute-ui.test.mjs:91` (4), `tests/migrate-control.test.mjs:212` (4),
`tools/e2e.mjs:634` (8).

**Qué permite.** Un cambio de conducta que conserve los literales pasa: por ejemplo,
duplicar la llamada a `act('export-skill', …)` dos veces por clic mantiene todas las
aserciones `source.includes(...)` verdaderas. Y el refactor legítimo (renombrar la
variable `detectState`) rompe la prueba sin que nada se haya roto.

**Reproducción (no medida, argumentada).** Las pruebas afirman presencia de cadenas,
no el número de llamadas ni sus argumentos; cualquier cambio que preserve las cadenas
—más llamadas, otro orden, otro camino— las satisface.

**Arreglo.** Mover la comprobación a conducta con el arnés de hooks falsos que ya existe
(`instantiate()` en `render.test.mjs`, `loadClient()` en `client.test.mjs`), y dejar en
`source.includes` sólo uno o dos contratos de cableado que no se puedan ejercer de otro
modo.

## Ronda 11 · correcciones aplicadas tras esta auditoría

- **Espía sin leer** (distribute-ui): la prueba ahora monta el componente con estado real, escribe el paquete y pulsa el botón; si la delegación a `onImport` se rompe, falla.
- **Tautologías de `JSON.stringify`** (render ×4 y distribute-ui): sustituidas por inspección de la fuente de los manejadores del árbol.
- **Atomicidad** (state): nueva `tests/state-atomicity.test.mjs` que mide la fecha de creación del fichero; una escritura directa en el destino la hace fallar.
- **`tools/mutation.mjs`**: `--only=` respetado, detección honesta (exige pruebas fallando), mutante que rompe el módulo marcado `invalid`, líneas calculadas y salida 1 si sobrevive algo.
- El candado del analizador baja de 13 hallazgos altos a **6**; los siete restantes están corregidos y medidos.

## Estado en la ronda 13

- **D1–D3 y D7**: cerrados antes (atomicidad medida con `birthtimeMs`, `onImport` con montaje real, `handlerSource`, arnés de mutación honesto).
- **D4** (aguja numérica): cerrada. La prueba ancla el texto real `withoutDeclaration{"n":"3"}` y comprueba que con 7 no aparece el 3; probado que detecta (clavar `n: '3'` en `client.js` la rompe).
- **D5** (salto simulado): cerrada. Los dos casos usan `tc.skip(...)`; con junctions deshabilitadas la suite informa `skipped 1`, no verde.
- **D6** (verde condicional): cerrada. `tests/repair-api.test.mjs` afirma la negativa sin ramas (`ok === false`, `code === 'exists'`) y añade un segundo caso determinista; probado que detecta (`lib/manifest-ops.mjs` mutado).
- **D8** (aserciones sobre texto fuente): **parcial y declarada**. `tests/migrate-control.test.mjs` pasó de leer `client.js` a ejecutar los dos manejadores con dobles (probado que detecta: quitar la guarda `canMigrate` rompe la prueba). Las aserciones de `tests/export.test.mjs` (12) y `tools/e2e.mjs` (7) son conducta del documento generado o del SKILL.md materializado, no acoplamiento interno. Quedan 10 en `tests/client.test.mjs` que son contratos de cableado (prohibición de importar paquetes del harness, presencia del diálogo de identidad, prop `currentVersion`) cubiertos además por pruebas de comportamiento: se aceptan como **riesgo bajo declarado**.

