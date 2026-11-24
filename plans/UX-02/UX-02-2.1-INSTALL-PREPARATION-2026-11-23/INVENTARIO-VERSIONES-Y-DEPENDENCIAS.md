# Inventario de versiones y dependencias (perfil `desktop`)

**Medido:** 2026-11-23T03:46Z · **Fuente:** `~/.dsh/profiles/desktop/package.json`, `pnpm-lock.yaml` (v9.0),
`node_modules` real, registro npm por HTTP.

---

## 1. Entorno

| Componente | Versión |
|---|---|
| Node | `v24.21.0` |
| npm | `11.19.0` |
| pnpm | `12.15.0` |
| DSH (app instalada) | `C:\Users\BYRON\AppData\Local\Programs\DeepSeek Harness` (perfil `desktop`) |
| Linker del perfil | `nodeLinker: hoisted` · **sin `node_modules/.pnpm`** · `autoInstallPeers: false` |

## 2. Dependencias del perfil

| Paquete | Declarado | Origen | Instalado | Nota |
|---|---|---|---|---|
| `@designerbyron/lifecode-rag` | `1.2.0` | registro npm | **1.2.0** (73 ficheros, idéntico al tarball publicado) | **objetivo de la actualización** |
| `@local/lifecode-skill-center` | `github:designerbyron/plugins-dsh#827b84e…&path:/lifecode-skill-center` | GitHub, commit fijo | (según lock) | no se toca |
| `@local/skill-compiler` | `link:C:/xampp/htdocs/plugins-dhs/skill-compiler` | **enlace a árbol local** | enlace | no se toca; sensible a reinstalaciones |
| `@tuhengyu/dsh-full-life-memory` | `github:Toctsu/dsh-full-life-memory` | GitHub | (según lock) | no se toca |
| `billion-context` | `0.1.216` | registro | 0.1.216 | no se toca |
| `dsh-context` | `0.87.0` | registro | 0.87.0 | no se toca |
| `dsh-data-quality` | `0.3.28` | registro | 0.3.28 | no se toca |
| `dsh-plugins-update` | `github:fengzhiyushui/dsh-plugins-update` | GitHub | (según lock) | no se toca |

## 3. Bundles cargados (orden del manifiesto)

`@deepseek-ai/dsh-base` → `dsh-web-app` → `dsh-experimental-plugin-market-bundle` → `dsh-plugins-update` →
`@tuhengyu/dsh-full-life-memory` → `@local/lifecode-skill-center` → `billion-context` →
**`@designerbyron/lifecode-rag`** (último).

El bundle de LifeCode RAG aporta `cordis.patch.yml` con `insert: [{id: lifecode-rag, name: '@designerbyron/lifecode-rag'}]`.

## 4. Entradas del lock que hay que mover (v9.0)

Tres, y sólo tres (verificado leyendo el lock):

```yaml
importers:
  .:
    dependencies:
      '@designerbyron/lifecode-rag':
        specifier: 1.2.0          # → 1.3.0
        version: 1.2.0            # → 1.3.0

packages:
  '@designerbyron/lifecode-rag@1.2.0':            # → @1.3.0
    resolution: {integrity: sha512-E+81ki…}        # → sha512-Q/EvDeGx…
    engines: {dsh: '>=0.2.2-rc.3 <0.3.0', node: '>=22.5.0'}   # igual

snapshots:
  '@designerbyron/lifecode-rag@1.2.0': {}          # → @1.3.0
```

Integridad de **1.3.0** (medida en el registro): `sha512-Q/EvDeGxJiTjcuoiB0iGn+gkapQA2bKQrcPJwl5dx3PH6EWpj4HSho1XwJTcqBzrtD/02dqR0CzznrqNFW6h1g==`.
`engines`, `files`, `exports` y `publishConfig` no cambian entre 1.2.0 y 1.3.0 (mismo manifiesto salvo `version`).

## 5. Versiones publicadas del paquete (registro, HTTP)

`0.0.0-stage` · `1.0.0` · `1.1.0` · `1.2.0` · **`1.3.0` (latest)** — `fileCount` 73 → **74**; `unpackedSize`
1 078 261; `dist.integrity` de 1.3.0 = la del artefacto aprobado (`sha256 f848b73e…`).

## 6. Estado del paquete instalado (referencia para el rollback)

| Fichero | sha256 |
|---|---|
| `package.json` | `e966b23a3a8925e8bda5f5e3a201ddc758318ec15eb6bc768be1b9e2a503df55` |
| `lib/pa-api.mjs` | `df7b74d6c2e528ee3077f19dd24e9c1ae53fa149c77a62a96a7cffddefe4a7f1` |
| `index.js` | `c5c1bea60d0bc1a64348a65d75302b86582ffb5b59efecc43b11724e54e3d94e` |
| `client.js` | `8144fe8c376741a9f761b534c0b1b18c3c299e0985c74bba115c08e1d07958a3` |
| Recuento | 73 ficheros |

Estos cuatro hashes coinciden con los del árbol de release **antes** de UX-2.1: el 1.2.0 instalado es
exactamente el publicado, y no lleva nada de 1.3.0.

## 7. Configuración del plugin que puede cambiar por versión

`~/.dsh/lifecode-rag/profiles/desktop/config.json` (998 B, `sha256 b15622c0ab9f…`) tiene 12 claves:
`maxFileBytes, maxFilesPerIngest, chunk, context, search, embedding, audit, roots, metrics, automation,
autoContext`. `automation.enabled = false` y `autoContext.enabled = false` — leer la configuración **no**
la migra, pero la fase de ejecución debe comprobar que el JSON sigue idéntico después de cargar 1.3.0.
