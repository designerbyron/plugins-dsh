# LE-RAG-06 · Reconciliación de archivos

Original: `plugins-dhs` @ `b6c0cd2`, branch `fix/t45-4-r17-acceptance`, índice vacío, 1154 entradas porcelain.
Copia de referencia: `plugins-dhs-le-rag-01`.

**Comprobación previa clave:** los 130 ficheros `.mjs/.js/.json` de `lifecode-rag` en el original seguían
coincidiendo con `BASELINE-ORIGEN.sha256` → **no hubo trabajo independiente** en LifeCode RAG desde la
creación de la copia. Por eso los 6 modificados son clase B sin conflicto y no hay clase C ni D.

| Archivo | Clase | Estrategia | SHA-256 final |
|---|---|---|---|
| `index.js` | B · sin conflicto (original = baseline de la copia) | reemplazo por la versión validada | `3f7a206f9c2bcab8857ec29790ce585eb1bfede5bd3ba26cfe1f89f68837a3cd` |
| `lib/tools.mjs` | B · sin conflicto (original = baseline de la copia) | reemplazo por la versión validada | `2a3ac69b97a1f61f6c992e576e0a3e38c222eeb8434641012ce0a49e2c32fca6` |
| `lib/diagnose.mjs` | B · sin conflicto (original = baseline de la copia) | reemplazo por la versión validada | `57c3dd0e4861bae8d7a636019b75c99d1ccfa365c00be28eaab399f5b58cce22` |
| `lib/doctor.mjs` | B · sin conflicto (original = baseline de la copia) | reemplazo por la versión validada | `b3bc2d287d912e00da9cd8e1e47ba91691e249463c9469c5cd6eb618d0a2864e` |
| `lib/sync-scheduler.mjs` | B · sin conflicto (original = baseline de la copia) | reemplazo por la versión validada | `a9bcb667394f50578bfeb7a5c161aafe3eb133167e7e14656b6a872240b1f202` |
| `lib/automation.mjs` | B · sin conflicto (original = baseline de la copia) | reemplazo por la versión validada | `82658fa97d2688710ca50612e057ba8e41a7524aacc277e256ecd0a92b3d589e` |
| `lib/config-resolve.mjs` | A · nuevo (no existía) | alta directa | `145970cc821795fa45dc8829a5ba3eaf508b0971d019389c287d6811b787f2bc` |
| `lib/conversation-events.mjs` | A · nuevo (no existía) | alta directa | `361af99ff4a14898ec0075859729ed55d6f8146e8f476910ee684debb8db0e96` |
| `lib/worker-context.mjs` | A · nuevo (no existía) | alta directa | `1b6458e75526ea2d823e7b49fb747046836b8525ffb1f69e304c149a4a09615e` |
| `tests/config-resolve.test.mjs` | A · nuevo (no existía) | alta directa | `69becf3da1f523a5cd2b89e08352f297fb2203bddda68c9b6a899ca9d3c3798a` |
| `tests/conversation-events.test.mjs` | A · nuevo (no existía) | alta directa | `7d0822a595e620b2873776c472263571bc6377313dc8c43bdfd50c1773d002c6` |
| `tests/conversation-events-edge.test.mjs` | A · nuevo (no existía) | alta directa | `32d95097ade3d42a4b079e73899b2e971700a5f75f555d0489a8bb74a6ab7c33` |
| `tests/tool-golden.test.mjs` | A · nuevo (no existía) | alta directa | `9aa641bd840a2fac750fe74d5f3df54f76eb95b00a80e0a2dce5f72e04fc5b19` |
| `tests/config-consumers.test.mjs` | A · nuevo (no existía) | alta directa | `8064b9b7b531a4b14d336aaee99842fbbe9001dc1d31e8e4e73f6c9d091343ce` |
| `tests/worker-context.test.mjs` | A · nuevo (no existía) | alta directa | `67f6f81f66f22cc480baf552d0f020e97d3a7ac95079e2c039c51af15e959b67` |
| `tests/standalone.test.mjs` | A · nuevo (no existía) | alta directa | `62adab2781ac1e6fed2a9180fb0fa17ec335dae67016524535705559b416da5d` |
| `bench/bench.mjs` | A · nuevo (no existía) | alta directa | `9955e3236536e171fd8f9be2b5cdbc433afb94ace287b854bdabc5d413b37f4f` |
| `bench/bench-real.mjs` | A · nuevo (no existía) | alta directa | `cc42f7c71fefe2e485f96099a3b0e072b07c652a9ce0226c4b7a053210c248cf` |
| `bench/last-run.json` | A · nuevo (no existía) | alta directa | `85d1c4cb7becbbb926232ce5ad6e50d81c1cb5cacaab7e9992901b46a4b959fe` |
| `bench/real-run.json` | A · nuevo (no existía) | alta directa | `c5c8988a42c74857dc37f7b8984f5f019e042febd9f052b345dbb3685bbd567c` |
| `eval/le-rag-03/functional.mjs` | A · nuevo (no existía) | alta directa | `892a3edff2842d31d18baf1ec8acd71bb22e4d0d45bd1969de48cf75fa2a842b` |
| `eval/le-rag-03/functional-report.json` | A · nuevo (no existía) | alta directa | `9eb5de0da39a10f0240896e4cba8db47d67b419fe4b71a00adf80fd324f7f637` |
| `eval/le-rag-04/seven-tools.mjs` | A · nuevo (no existía) | alta directa | `951b92136d3377025661e2f81c4206c89716d028a7d07682b3a9ba8ccd54af8a` |
| `eval/le-rag-04/seven-tools-report.json` | A · nuevo (no existía) | alta directa | `c4c7e5e2859aca18698d6fce4095273ab9e9bf95737eba5fa9b298ccabcf6343` |
| `docs/LE-RAG-01-ARCHITECTURE.md` | A · nuevo (no existía) | alta directa | `8020eaa6f53c699648775b435e754fe2aaa3e3f7f00d87d0ba9eff15a8875113` |
| `docs/LE-RAG-02-COMPLETION.md` | A · nuevo (no existía) | alta directa | `e14ef4c3b3808021595064dab364aa585399d4dc6c9f33a2466633b71849ccab` |
| `docs/LE-RAG-03-RELEASE.md` | A · nuevo (no existía) | alta directa | `0c184b01bd9a89aa0f5d34dca8eff94148038f7d772d6113e657de3d1cc9fa7b` |
| `docs/LE-RAG-04-DECISIONS-AND-SPEC.md` | A · nuevo (no existía) | alta directa | `0d570a9c3c8b999a86072339eb4a9562610f48cbab83d36f8c2161b3a915729d` |
| `docs/LE-RAG-05-CLIENT-AUDIT.md` | A · nuevo (no existía) | alta directa | `32e6847c31425ba8c677e7397ceedaa24697b93eed8e9e862a7ae03a563a72c9` |
| `docs/LE-RAG-05-FINAL-REVIEW.md` | A · nuevo (no existía) | alta directa | `236cfe1b1671e90519d9cebcbc0b71ebb979700a4f6db8826fef833c75f0b991` |

### Corrección de inventario (E-01)

`lib/conversation-events.mjs` figuraba como «modificado» en el inventario de LE-RAG-05; en realidad es **nuevo**
(se creó en LE-RAG-01). Aquí se clasifica como A. El resto del inventario se confirma.

### Protegidos y fuera de alcance

- `skill-compiler/` (1300 ficheros), `lifecode-skill-center/` (1324), `_audit/` (3765), `MEMORY.md`, `AGENTS.md`:
  bloques de manifiesto idénticos antes y después.
- Fuera de `lifecode-rag/`: 6 880 ficheros antes y después, `diff` vacío.
- Sin borrados dentro de `lifecode-rag/`: 385 → 409 rutas (+24 nuevas).
