# DEPENDENCY-GRAPH — grafo de dependencias del perfil `desktop`

**Medido el 2026-11-23 (13:0x).** Sin ejecutar pnpm.

---

## 1. Grafo actual (roto para re-resolver)

```
pnpm-workspace.yaml  (packages: ['.'], nodeLinker: hoisted, autoInstallPeers: false)
└── perfil  C:\Users\BYRON\.dsh\profiles\desktop
    │
    ├─ package.json  (importer '.')
    │   ├─ @designerbyron/lifecode-rag        1.4.0            → REGISTRO  ✗ no existe (404)
    │   ├─ @local/lifecode-skill-center       github:…#827b84e3&path:/…  → GitHub
    │   ├─ @local/skill-compiler              link:C:/xampp/…/skill-compiler → enlace local
    │   ├─ @tuhengyu/dsh-full-life-memory     github:Toctsu/…   → GitHub
    │   ├─ billion-context                    0.1.216           → REGISTRO ✓
    │   ├─ dsh-context                        0.87.1            → REGISTRO ✓
    │   └─ dsh-plugins-update                 github:fengzhiyushui/… → GitHub
    │        (dsh-data-quality: AUSENTE — fue retirado por el fallo)
    │
    ├─ dsh.profile.bundles  [ base, web-app, market, dsh-plugins-update,
    │                         full-life-memory, lifecode-skill-center,
    │                         billion-context, lifecode-rag, dsh-context ]
    │        (dsh-data-quality: AUSENTE)
    │
    └─ pnpm-lock.yaml  84 entradas · lifecode-rag@1.4.0 con integrity del registro (dato huérfano)
```

## 2. Por qué falla una actualización de otro complemento

```
usuario pulsa «actualizar dsh-data-quality»
        │
        ▼
[12:51:09] pnpm install  (lock cuadra con el manifiesto)  → resolución OMITIDA → OK
            aplica: −lifecode-rag 1.3.0  +lifecode-rag 1.4.0  −dsh-data-quality 0.3.29
        │
        ▼
[12:51:11] pnpm install tras cambiar el manifiesto (alta de 0.3.30)
            → el lock ya no cuadra → RE-RESOLUCIÓN COMPLETA
            → pide  @designerbyron/lifecode-rag@1.4.0  a registry.npmjs.org
            → 404  ERR_PNPM_NO_MATCHING_VERSION
        │
        ▼
[12:51:13 / :16 / :17] reintentos con npmmirror.org y npmjs.org → mismo 404
```

El disparador no es el complemento actualizado: es la **spec semver no publicada**. Cualquier operación que cambie el
conjunto de dependencias (alta, baja, actualización de cualquier paquete) obliga a re-resolver todo el importer.

## 3. Grafo esperado tras la reparación

```
    ├─ package.json
    │   ├─ @designerbyron/lifecode-rag  file:vendor/designerbyron-lifecode-rag-1.4.0.tgz
    │   │        → TARBALL LOCAL (sin registro, sin red)
    │   ├─ … (seis specs sin cambios)
    │   └─ dsh-data-quality            0.3.29   → REGISTRO o STORE ✓
    │
    ├─ bundles: 10 entradas (con dsh-data-quality al final)
    │
    └─ lock: lifecode-rag resuelto por ruta local · dsh-data-quality@0.3.29 con su integrity
```

Con ese grafo, una actualización de `dsh-data-quality`, `dsh-context` o cualquiera de los otros re-resuelve el
importer y **no consulta el registro para LifeCode RAG**: lo resuelve del tarball.

## 4. Qué registra pnpm para una dependencia `file:` (comportamiento, no medición local)

- El `specifier` del importer queda como `file:vendor/…tgz` (relativo al directorio del manifiesto → el perfil).
- La resolución apunta al tarball y pnpm guarda su `integrity`, de modo que un tarball distinto rompe el install en
  vez de instalarse en silencio.
- El paquete se **copia** a `node_modules` (no se enlaza), igual que hoy, así que el resultado en disco no cambia de
  forma.
- No hay consulta de metadatos de registro para ese paquete: `minimumReleaseAge` no le aplica (no tiene fecha de
  publicación).

*Precedente en esta máquina:* el store `pnpm/v11` contiene un artefacto `file:` procesado
(`file+..+..+..+..+..+artifac_a9f083e950c941490d0a3c11177cdb33`, con `tarball-integrity`), prueba de que este pnpm
(11.28.5) maneja tarballs locales. La forma textual exacta de la entrada del lock se verificará al ejecutar (ver
`EXPECTED-STATE.md` §3).

## 5. Efecto sobre los demás complementos

| Complemento | Hoy | Tras la reparación |
|---|---|---|
| `dsh-data-quality` | ausente | **0.3.29** (la versión que había, no `latest`) |
| `dsh-context` 0.87.1 | instalado | igual |
| `billion-context` 0.1.216 | instalado | igual |
| `dsh-plugins-update` 0.2.5 | instalado | igual |
| `dsh-full-life-memory` 0.8.0 | instalado | igual |
| `lifecode-skill-center` 1.0.1 | instalado | igual |
| `skill-compiler` 5.0.2 (`link:`) | instalado | igual |
| `lifecode-rag` 1.4.0 | instalado, no resoluble | instalado y **resoluble desde el perfil** |

`pnpm install` con el lock actualizado sólo añade `dsh-data-quality` y cambia la forma de `lifecode-rag`; el resto de
entradas del lock deberían quedar idénticas (se compara contra el respaldo: ver `ACCEPTANCE-TESTS.md` T9).

## 6. Riesgos de resolución duplicada

- **No** hay dos fuentes para LifeCode RAG: la spec es `file:` y no existe ninguna otra entrada semver. El riesgo
  desaparece por construcción.
- El registro sigue teniendo `1.3.0`; si alguien instalara `@designerbyron/lifecode-rag` a mano (gestor del Host),
  `pnpm add` reescribiría la spec a `1.3.0` (downgrade) → se detecta por la comprobación de actualización
  (`compareSemver > 0` no lo ofrece) y se revierte con el respaldo.
- `vendor/` dentro del perfil evita depender de una ruta del repositorio (`plans/…`), que podría moverse o limpiarse.
