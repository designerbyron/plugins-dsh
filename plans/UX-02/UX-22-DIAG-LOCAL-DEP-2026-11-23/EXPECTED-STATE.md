# EXPECTED-STATE — estado esperado tras la reparación

**Ningún valor de este documento se ha aplicado.** Los hashes de ficheros que escribe el ejecutor son calculados
y comprobables; los de ficheros que reescribe pnpm **no se pueden predecir** y se verifican por **invariantes de
contenido**, no por hash.

---

## 1. Ficheros cuyo contenido queda determinado por el plan

| Fichero | Valor esperado | Cómo se comprueba |
|---|---|---|
| `profiles/desktop/vendor/designerbyron-lifecode-rag-1.4.0.tgz` | 317 530 B · SHA-256 `7bbecb09482dcc36290956a7623b2247414c99fc42cc1b58caf22ce8dbca132b` | `sha256sum` en el destino, **después de copiar** |
| `profiles/desktop/package.json` | 1 054 B · SHA-256 **`b4db531ad7879c412f2f9e529b9d5e4960d1a98ad79b9b5bc566b94eec37435c`** (con las dos ediciones exactas de `REPAIR-PLAN.md` §6.4-6.5) | `sha256sum`; si difiere, la **invariante** es el contenido de §2 |

## 2. Invariantes de `package.json`

```json
"dependencies": {
  "@designerbyron/lifecode-rag": "file:vendor/designerbyron-lifecode-rag-1.4.0.tgz",
  ...
  "dsh-context": "0.87.1",
  "dsh-data-quality": "0.3.29",
  "dsh-plugins-update": "github:fengzhiyushui/dsh-plugins-update"
}
```
- 8 dependencias (las 7 actuales + `dsh-data-quality`).
- `dsh.profile.bundles` con **10** entradas y `dsh-data-quality` al final.
- **Ninguna** spec semver de LifeCode RAG.
- Las otras seis specs intactas byte a byte: `@local/lifecode-skill-center` (github + commit `827b84e3…` y
  `path:/lifecode-skill-center`), `@local/skill-compiler` (`link:C:/xampp/htdocs/plugins-dhs/skill-compiler`),
  `@tuhengyu/dsh-full-life-memory`, `billion-context 0.1.216`, `dsh-context 0.87.1`, `dsh-plugins-update`.

## 3. Invariantes de `pnpm-lock.yaml` (lo escribe pnpm)

| Invariante | Cómo se comprueba |
|---|---|
| `importers['.'].dependencies['@designerbyron/lifecode-rag'].specifier` empieza por `file:` | `grep -A2 "lifecode-rag" pnpm-lock.yaml` |
| La resolución de LifeCode RAG **referencia el tarball** (no un `integrity` de registro) | buscar la entrada de `lifecode-rag` y comprobar que contiene la ruta `vendor/` |
| `dsh-data-quality@0.3.29` con `integrity: sha512-UV7aTAWA/xIhs7gT79n6Bs3eAy2kS4WwGbgIMR8r8j/apmUkHQFmbCJJ3xs8tHtjAhQfrftVWGGwBIB7NPWrvA==` | `grep -A2 "dsh-data-quality@0.3.29"` |
| **Cero** referencias a `lifecode-rag@1.4.0` como paquete de registro | `grep -c "lifecode-rag@1.4.0"` debe ser la clave del tarball, no una entrada de `packages` con `integrity` del registro |
| Entradas contadas por el verificador de políticas: **86** (84 actuales + 2 de `dsh-data-quality`) | salida de `pnpm install` («… supply-chain policies (86 entries)») |
| Ninguna otra entrada del lock cambia de versión | comparar las claves `name@version` del lock nuevo contra el respaldo (`65e83297…`): la diferencia debe ser exactamente `lifecode-rag` (forma) y `dsh-data-quality` (alta) |

**Nota:** pnpm decide la forma textual exacta de la resolución del tarball. No se fija aquí una plantilla: se exige
que la resolución apunte al fichero local y que no haya `integrity` de registro para `1.4.0`.

## 4. Invariantes de `node_modules/.modules.yaml` (lo escribe pnpm)

- Mapa hoisted con **`@designerbyron/lifecode-rag@1.4.0`** apuntando a `node_modules\@designerbyron\lifecode-rag`.
- Mapa hoisted con **`dsh-data-quality@0.3.29`**.
- Sin entradas duplicadas del mismo paquete.

## 5. Invariantes de paquetes instalados

| Paquete | Esperado | Comprobación |
|---|---|---|
| `@designerbyron/lifecode-rag` | **1.4.0**, 75 ficheros, **75/75 idénticos** al TAR aprobado | `find` + `cmp` contra una extracción del TAR en temporal |
| `dsh-data-quality` | **0.3.29** exacto, directorio completo con `package.json` legible | `node -e require(.../package.json).version` |
| Resto de plugins directos | mismas versiones que §3 del plan: `lifecode-skill-center 1.0.1`, `skill-compiler 5.0.2`, `dsh-full-life-memory 0.8.0`, `billion-context 0.1.216`, `dsh-context 0.87.1`, `dsh-plugins-update 0.2.5` | leer cada `package.json` y comparar |

## 6. Invariantes de datos y configuración (no se tocan)

| Elemento | Esperado |
|---|---|
| `lifecode-rag/profiles/desktop/*` | 6 ficheros hoy; **mismos hashes** de contenido (`4b67cadc…` registro, `4dcf31c4…` ámbito principal, `6130ecba…` ámbito secundario, `b15622c0…` config). Los sidecars pueden cambiar por apertura/cierre del Host: el invariante es el contenido, no el inventario |
| Registro RAG | v2, 3 proyectos, 3 raíces, 0 grants, auditoría intacta (`seq 88`) |
| Almacén principal | v3, 121 fuentes / 964 chunks / 964 vectores |
| `roots`, `grants`, permisos | sin cambios |
| `cordis.patch.yml` (home y perfil) | sin cambios |

## 7. Estado del grafo del Host (esperado, tras arrancar)

- `@designerbyron/lifecode-rag` **presente** (lo está hoy).
- `dsh-data-quality` **presente** (hoy ausente).
- Resto de entradas sin cambios.

## 8. Lo que **no** cambia

`package.json` de LifeCode RAG (sigue 1.4.0, sin `scripts`), su contenido (75 ficheros), `PA_VERSION = pa/1.4.0`,
el esquema v3, el registro v2, `minimumReleaseAge = 1440` y sus exclusiones (la de `lifecode-rag` queda inerte al no
resolverse por registro, y se conserva como documentación de intención).
