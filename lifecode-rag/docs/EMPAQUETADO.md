# Empaquetado de la distribución

El manifiesto del repositorio **no es** el manifiesto publicable. `package.json` declara los comandos de desarrollo
(`test`, `test:hermetic`, `check`, `bench`, `bench:harness`, `demo`, `screenshots`), cuyos destinos viven en
`tests/`, `tools/` y `demo/`, que no se publican (`files` no los incluye).

Publicar ese manifiesto tal cual anuncia comandos que no se pueden ejecutar. Y no fallan: **mienten**. Medido en un
directorio sin pruebas, `node --test --test-concurrency=1` (el comando de `test`) sale con **código 0 y cero pruebas**.

## Cómo se empaqueta

```sh
npm run pack:dist -- --out <carpeta>
# equivalente: node tools/pack.mjs --out <carpeta>
```

`tools/pack.mjs` hace el empaquetado por el mecanismo estándar y **no toca el árbol de trabajo**:

1. `npm pack` en el repositorio (npm decide el conjunto de ficheros según `files`).
2. Extrae el paquete en un directorio temporal y **deriva el manifiesto**: quita `scripts` y `devDependencies`.
3. `npm pack` otra vez sobre esa copia, ya con el manifiesto publicado.
4. Verifica: que no entre nada de `tests/`, `tools/`, `demo/`, `bench/`, `eval/`, `plans/` ni `node_modules/`; que
   todos los ficheros sean idénticos al árbol de trabajo salvo `package.json`; que el manifiesto no cambie ninguna
   clave ajena a las retiradas; que esté el contrato de extensiones.
5. Copia el `.tgz` al destino de `--out` e imprime nombre, versión, número de ficheros, tamaño y SHA-256.

Es determinista: dos ejecuciones producen el mismo SHA-256.

## Por qué no se hace de otra forma

| Alternativa | Por qué se descarta |
|---|---|
| Incluir `tools/` y `demo/` en `files` | Mete herramienta de desarrollo en producción y **no arregla nada**: `tests/` sigue fuera, así que `test` seguiría saliendo en verde sin probar nada |
| `prepack`/`postpack` que recortan y restauran el `package.json` del repositorio | Muta el árbol de trabajo en cada empaquetado; si el proceso muere entre ambos pasos, el manifiesto queda recortado. Inaceptable con cambios sin commitear |
| Mover los comandos a otro fichero | npm sólo lee `scripts` de `package.json`: se perdería `npm test` en el repositorio |

El manifiesto publicado se diferencia del del repositorio **sólo** en `scripts` (y `devDependencies`, si algún día
existen). Cualquier otra diferencia hace fallar la verificación.

## Lo que sigue funcionando en el repositorio

`npm test`, `npm run check`, `npm run test:hermetic`, `npm run bench`, `npm run demo` y `npm run screenshots`, sin
cambios: el manifiesto del repositorio no se toca.

`npm pack` a secas sigue produciendo el paquete con el manifiesto **sin derivar**. Para publicar, usar
`npm run pack:dist`.
