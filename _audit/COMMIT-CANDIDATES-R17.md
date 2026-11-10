# Release 1.0.1 — Candidatos de entrega (manifiesto final)

**Producto:** LifeCode Skill Center 1.0.1 · **Rama:** `feature/visual-operation-feedback` · **Fecha de medición:** 2026-11-10 07:14:05 UTC
**Carácter:** manifiesto **completo del release** (sustituye al delta R17). No es un parche ejecutable: el árbol ya contiene el estado final.

## 1. Snapshot

- HEAD `3b295106e5263858c32bd4db4c110068a4bad687`.
- `git status --porcelain -uall`: **2145** entradas (41 modificadas, 2104 sin seguimiento, 0 borradas).
- Candidatas ejecutables: **230 rutas** (6 716 900 B), todas con cambio real en `git status`.
- Ya versionadas sin cambios (no candidatas, no-op para `git add`): **16 rutas**, documentadas en §4.8.
- Excluidos con motivo: **1901 rutas** (incluye 24 documentos de auditoría retirados por ruta de perfil).
- Preexistentes ajenos (skill-compiler): **14 rutas**.
- Suma de control: 230 + 1901 + 14 = **2145** (status: 2145).

## 2. Método y reproducibilidad

1. `git rev-parse HEAD`, `git branch --show-current` y `git status --porcelain -uall -z` (sólo lectura).
2. Para cada candidato: tamaño en bytes y SHA-256 de los bytes exactos (`Get-FileHash -Algorithm SHA256`).
3. Grupos por naturaleza del fichero, no por ronda; un fichero aparece una sola vez.
4. Los excluidos se justifican por regla; no se listan uno a uno los 1 800+ artefactos históricos, sino por motivo y con ejemplos contables.
5. Barrido de seguridad en texto (sin ejecutar nada, sin escribir en el almacén, sin `git add`).

## 3. Resumen por grupo

| Grupo | Rutas | Bytes |
|---|---:|---:|
| Producto (plugin) | 27 | 1 224 315 |
| Pruebas | 88 | 1 183 040 |
| Herramientas | 18 | 260 289 |
| Documentación | 8 | 150 709 |
| Capturas | 16 | 1 651 936 |
| Assets de marca | 4 | 1 486 788 |
| Evidencias de auditoría | 69 | 759 823 |
| **Total** | **230** | **6 716 900** |

## 4. Candidatos a commit

Leyenda «Estado git»: `??` sin seguimiento · `M` modificado. Las 14 rutas ya versionadas y limpias no son candidatas y se documentan aparte en §4.8.

### 4.1 Producto (plugin) (27)

| Ruta | Bytes | SHA-256 | Estado git |
|---|---:|---|---|
| `lifecode-skill-center/LICENSE` | 1127 | `fb0761ffc3a512afd793f2f69901c6dfcbab7459e063959665dff690353a1ee1` | ?? |
| `lifecode-skill-center/client.js` | 532 605 | `9d2490653ee0a4f221cde195e1722d394865b45ba7c03de4a93702f6fadbcde5` | M |
| `lifecode-skill-center/docs/LEGAL.md` | 4644 | `7eb9a37de8484e12939990fffd0613a5aab6d545107becdfb2cf5836814d9c48` | ?? |
| `lifecode-skill-center/icon.svg` | 3486 | `974ce3d662f6b78804ead08d5839f1d48d67cc2c017fdac928c3ea752a5a9d4e` | M |
| `lifecode-skill-center/index.js` | 31 694 | `55ab8aae53388be036774b32c415fecd90f672fbeb0c37f400a0732062f12268` | M |
| `lifecode-skill-center/lib/activity.mjs` | 16 892 | `6ad09ca27e48a124eb58e28a4a0767c4d0e172d7503686f7493510eea5ada4f7` | ?? |
| `lifecode-skill-center/lib/analytics.mjs` | 7438 | `4da779f658c5c0db91016d1af6346960e7084264756ca39af95fc477e885f193` | M |
| `lifecode-skill-center/lib/api.mjs` | 198 448 | `33e75e4f126218c6b3fd034ba97ec75cf14281fdc561bf601cd4915effb3cbe4` | M |
| `lifecode-skill-center/lib/collisions.mjs` | 23 814 | `20de2efa941e75aa22555cb28a1e752c2df6e67001adc67e047778b1481ff12a` | ?? |
| `lifecode-skill-center/lib/decisions.mjs` | 14 330 | `41a896c3d609f97357898d3516519c05bc77d9bcd3effafac649ebcd5f4597f7` | ?? |
| `lifecode-skill-center/lib/distribute.mjs` | 19 525 | `3c3771394baa0eb24273e8952856b357785e57c12924c12f3427de7176e72f20` | ?? |
| `lifecode-skill-center/lib/export.mjs` | 11 062 | `72649e41004939f061094c2aa880a20421b398048689c6249310dcd48c4e3df9` | ?? |
| `lifecode-skill-center/lib/identity.mjs` | 22 082 | `b4f04f807723b4245a1f99cf4a4de0ec0af0dddb4c903d3a4f615fde9b5e9426` | ?? |
| `lifecode-skill-center/lib/insights.mjs` | 20 658 | `f6ba770f1747cb5baa1dbd63de5227bda02a37ea29fe9bfc413e9854bc58c21b` | ?? |
| `lifecode-skill-center/lib/inventory.mjs` | 50 564 | `9235bc92c6afbb27e62448736a2e44ce1b48597d7effa37059da8da4cdf1d3e6` | ?? |
| `lifecode-skill-center/lib/knowledge.mjs` | 28 228 | `d29acf7188571b1784c74e4b92f3b770ba40f41195cf325cb1238d75a4542053` | ?? |
| `lifecode-skill-center/lib/manifest-ops.mjs` | 32 860 | `62ae4047429844d1dcb539bfb86b4be8a4ff28ddab26d15cee9a2dbd0119df4a` | ?? |
| `lifecode-skill-center/lib/operations.mjs` | 28 430 | `99f30cad7942ed2fb27648313e6791752a500ee70a21e8774a09512eaf77468b` | M |
| `lifecode-skill-center/lib/paths.mjs` | 10 235 | `28258bf14ac81e102bc830e4b1100e84c578a8c075da6432f28f251e3c87bc8b` | ?? |
| `lifecode-skill-center/lib/preflight.mjs` | 19 338 | `b44d0bdfd366e68e1c7276dcb1ec95ae1f9be1aa124c96ca05026f7948b445b3` | ?? |
| `lifecode-skill-center/lib/projects.mjs` | 26 094 | `34c9e1da037a3e54571737f069bb0ba13ce74b460bc1c25adf7763bddcbc9a6b` | ?? |
| `lifecode-skill-center/lib/requests.mjs` | 5592 | `b673673110529604a4e68c64dfb9d13454da5e60abeab359be7dad7d3a7c00e4` | ?? |
| `lifecode-skill-center/lib/similarity.mjs` | 2586 | `a812a479fc3abc7f46aab2af67f0c709fe73a5d8456abe4f9ef73d8ddcdba1c4` | ?? |
| `lifecode-skill-center/lib/sources.mjs` | 7838 | `1e3be4ef26cf4f3e2a1b3b2d0a2c830ca453d583b9e38c0e833ba8784e642c42` | M |
| `lifecode-skill-center/lib/state.mjs` | 78 249 | `99c921ce93d8abc759079b855c998b82f5fff6e7b0fe1f7f409671b4cd8a116b` | M |
| `lifecode-skill-center/lib/tools.mjs` | 24 938 | `0f398d97a17813574b3afa100fa7d3ae0aee281b12246e8b960118ef4e2ded39` | M |
| `lifecode-skill-center/package.json` | 1558 | `5d694a4aa25b63ccca445dd1a5eecc3d8c0b87b3276e4b350f4abc412f51298c` | M |

### 4.2 Pruebas (88)

| Ruta | Bytes | SHA-256 | Estado git |
|---|---:|---|---|
| `lifecode-skill-center/tests/advance.test.mjs` | 6478 | `5834eb0b17648381273e1df7d9b5b09f47dee5ad2bf3ffb51913e9365c9cc14d` | ?? |
| `lifecode-skill-center/tests/adversarial.test.mjs` | 32 858 | `505e0b2f37d6dbbe2db6329e78edd50020709df029f1d0e232defc1d6157dc0b` | ?? |
| `lifecode-skill-center/tests/analytics.test.mjs` | 5168 | `afeb8a6ec24ca00140b5bfbf59df11baf19da06ad4bb2c4662a8505504eb5d7a` | ?? |
| `lifecode-skill-center/tests/api.test.mjs` | 22 713 | `f0ea4a6172310bb7be3cedbb5053cfa5d4b8b3b6407bee1f8411b2f7151f19a0` | M |
| `lifecode-skill-center/tests/application-evidence.test.mjs` | 4858 | `85d5f84decac8742afed921320a1b551aa42ec062ee85c70256bcb6841a1f0dd` | ?? |
| `lifecode-skill-center/tests/autonomy-attacks.test.mjs` | 8993 | `ec96abdcb98230963a68bc61cec81dbfd316769727d9e0b75b19db4f0226d0b5` | ?? |
| `lifecode-skill-center/tests/autonomy-binding.test.mjs` | 5714 | `b24f3d3dc50330a3ae21ef1ae1641da99c6b327cb11fc2525b6e368db00d6186` | ?? |
| `lifecode-skill-center/tests/autonomy.test.mjs` | 12 639 | `d227a4f0ddcac2eff0d2305f944ca6ccc9f8df3529bd3026f716e3c4083e2aa5` | ?? |
| `lifecode-skill-center/tests/backup-atomic.test.mjs` | 20 966 | `29dfca74b937d981fc0d62db00dbee87d34281908d5d411480001949bcb97248` | M |
| `lifecode-skill-center/tests/backup.test.mjs` | 19 835 | `e8d938d5ae79363094840fe4ad7a72d25005e6d637d26b8da38b1b4ef4a97ed9` | M |
| `lifecode-skill-center/tests/choices.test.mjs` | 7221 | `2eb221bff67e227a88726bcb73fb0e7a4cb71a42b908ad6c03df599080c89efc` | ?? |
| `lifecode-skill-center/tests/client.test.mjs` | 15 806 | `1c4e6863ce81585b7a70054e751afe61a8c575de6b826a857d04fb52461d3551` | M |
| `lifecode-skill-center/tests/concurrency.test.mjs` | 1744 | `ff899eb0e4bf5bb7f97207b10b389efcd76aecafd5fa931524e1936cece12235` | M |
| `lifecode-skill-center/tests/consistency.test.mjs` | 6009 | `9ae82db2a8eee4142d207cdcd3214bd00fe38ba5e51f5ba625edfe2b6fa87645` | ?? |
| `lifecode-skill-center/tests/create-idempotency.test.mjs` | 4942 | `6c0749c1d56b8a855f033250e23f1304aeb778c69f6b78dc5a4c58bd31f8b94b` | ?? |
| `lifecode-skill-center/tests/discovery-contract.test.mjs` | 4992 | `2984730308d1de108322fba69f59bfd98c51ec1dfbd03b7637858d74d394a8e7` | ?? |
| `lifecode-skill-center/tests/distribute-security.test.mjs` | 3203 | `92e0cd737fa6f3387d7e1e0e7e0352538658a9a46241d583770f3ccf1b6966ae` | ?? |
| `lifecode-skill-center/tests/distribute-ui.test.mjs` | 8228 | `8f38fef49f7b51be59da5a92103745db398279cfc5a2a5ecf4ebfede64cc1656` | ?? |
| `lifecode-skill-center/tests/distribute.test.mjs` | 7223 | `dcc6057ce3326fe5c7b23484c5056c8a93c76f3024fc8e90ecd39952ca1d06d7` | ?? |
| `lifecode-skill-center/tests/doctor.test.mjs` | 4691 | `e06a4f60b96846d75f5a5f53ed05a124630d770cb5972c7b95ca3520a82d7585` | ?? |
| `lifecode-skill-center/tests/evaluate.test.mjs` | 5299 | `869be05277be60230e6f5c1fce2212538c5d1e650acd541201169e54a596fdcf` | M |
| `lifecode-skill-center/tests/export-warning-toast.test.mjs` | 3730 | `954a48a30f8663ec73b5851944482ada928702b927181da8bc5083db1a11ef4c` | ?? |
| `lifecode-skill-center/tests/export.test.mjs` | 8146 | `cf177069de28266cb0d3cd5c3aa9983af0785dcbfc6486ff5c0e7e3b0a56d585` | ?? |
| `lifecode-skill-center/tests/fixtures/writer.mjs` | 2029 | `10e4661ddcac8755c41dd7dda3d1d4838503cac75673cfb3ee3c11c6e90d4191` | M |
| `lifecode-skill-center/tests/fork-api.test.mjs` | 8576 | `0912d71b4d31fa58776c3df960fc38d2bc1a570dd33eade404907124af17bcda` | ?? |
| `lifecode-skill-center/tests/fork-manifest.test.mjs` | 5438 | `e4610cb494b52402036ba349d463df86060bf5971d4f89b8ef92119276356b32` | ?? |
| `lifecode-skill-center/tests/helpers.mjs` | 2539 | `8a6e15d3d85bda372ce8eca056a9a0735033f0e3a7252b3be41bcc0f8e577625` | M |
| `lifecode-skill-center/tests/identity-move.test.mjs` | 8615 | `7b6c3e505fc2474ec49e7477513c322fdb8b59a182481feaca4104b1b89b5a8b` | ?? |
| `lifecode-skill-center/tests/identity-ops.test.mjs` | 5597 | `a9afe413c7b24b44097fdea3c5abd305e03e78b432c08f84d4c228c280529808` | ?? |
| `lifecode-skill-center/tests/identity-repair-guards.test.mjs` | 7984 | `d4106013778c13552354302f97253096fbcf02cdf54cf1cf332ceae3d3de7b87` | ?? |
| `lifecode-skill-center/tests/identity-v3.test.mjs` | 41 232 | `3b817fd30f4b191d8d30ff214fe8ca442e765a145de3f767a83b81111b3b02fc` | ?? |
| `lifecode-skill-center/tests/identity-view-projection.test.mjs` | 4426 | `5211e4887a777efbddd30f41e52b052d6b3442d24e4aaf6be07d5827c9c3075c` | ?? |
| `lifecode-skill-center/tests/identity-view.test.mjs` | 9054 | `f268b0c2b9ca709670a89a7025e672416dc16e04f8faba864ccfe9dd4279e356` | ?? |
| `lifecode-skill-center/tests/identity.test.mjs` | 13 441 | `b7be246c0739bf90204d71173363f1edcdc3e72c41e95f971b3e7c576e7a4cf6` | ?? |
| `lifecode-skill-center/tests/index.test.mjs` | 30 508 | `6b5155a7c43f2d381102a325309903eb475de718ad2194fcb2dc49df85e2ec68` | M |
| `lifecode-skill-center/tests/insight-lifecycle.test.mjs` | 5221 | `4009451dbb82b373def93a46019c1165fe56469486726d2bf100ea872a46e616` | ?? |
| `lifecode-skill-center/tests/insights.test.mjs` | 13 006 | `fe6db1dfd00cde7de4ce20d29f5bfb98e4ed2bcab5f806d0b790ab0a8b4f4fe6` | ?? |
| `lifecode-skill-center/tests/integrity.test.mjs` | 11 830 | `059c7c3dfe2066355286dc9ffad3f5159692d0da06029a4cef6f9f4cb80b30c8` | M |
| `lifecode-skill-center/tests/knowledge-api.test.mjs` | 6387 | `84a91c50a5c35702177cbacc50fc03493749ad4d09a9f45e2dc4448327b3b912` | ?? |
| `lifecode-skill-center/tests/manifest-ops.test.mjs` | 12 078 | `9c884c5e743f725ebf938b9be59c831d110e1ea6f149c62fa479ef94a11eb44b` | ?? |
| `lifecode-skill-center/tests/migrate-control.test.mjs` | 12 862 | `414590cdc11d084b673999d24727114f391a660f3d7c43c038274ca9f9f134ed` | M |
| `lifecode-skill-center/tests/operations.test.mjs` | 18 597 | `547087bba256af286c6f4eca4a39ed5acb6968954c9525890c100fc2d83f27ad` | M |
| `lifecode-skill-center/tests/panel-contract.test.mjs` | 1655 | `a410276579d6110cca56aa2951710061293254f86836f56213329247d4a757ff` | ?? |
| `lifecode-skill-center/tests/paths.test.mjs` | 8086 | `3a9b6895d0e76c42987c6c8dcc725bb26ea28612301116219defd7974471185d` | ?? |
| `lifecode-skill-center/tests/policy-provenance.test.mjs` | 9054 | `1975e0107f5b9c42d532608ec0f4351b53ca12acec14fbd34a6406951abfaef0` | ?? |
| `lifecode-skill-center/tests/policy.test.mjs` | 4926 | `5c80af9a43cac69ca9cce0ddbd5f1c40035e8b475915e1ff432b49aeadd8e3e2` | ?? |
| `lifecode-skill-center/tests/portability.test.mjs` | 6171 | `2eec1b07177973acfb8a5bdad3ab5d9e9217ba35a4bd42421a2c74931b83490d` | ?? |
| `lifecode-skill-center/tests/publish-temp-cleanup.test.mjs` | 2991 | `3c4a5670b5d378c403771003fb37ee574cb910320db4ee0dce724ed9c5c6730d` | ?? |
| `lifecode-skill-center/tests/r16-api.test.mjs` | 51 375 | `74cedf8b85334813b4c969c9dc7d54570e2ca40bad48cb796a02b7384c9e37d3` | ?? |
| `lifecode-skill-center/tests/r16-bundle-contract.test.mjs` | 38 198 | `c7e6184ec62bc3d03bcd253cd03144c0fc2fee9a54c4008ee730dafa319781f3` | ?? |
| `lifecode-skill-center/tests/r16-bundle.test.mjs` | 21 124 | `e44e7a83fb5f41877e4d57fb9d147590442c655abcaa64c3c8b27fd50021e53c` | ?? |
| `lifecode-skill-center/tests/r16-coherence.test.mjs` | 25 665 | `b5dfe467a74d52d525342ee4ba868ed65d6c58534b3a4dfd3c541677f6147e23` | ?? |
| `lifecode-skill-center/tests/r16-contract.test.mjs` | 61 594 | `01a452481aa32f78cc0e70ef71e24ca3a85d82c4f6bef3150c78cec30da269d6` | ?? |
| `lifecode-skill-center/tests/r16-domain.test.mjs` | 56 374 | `07d009ca85e9820f838b30f51931418405a42bbd78d6a627f2f13a1145be1801` | ?? |
| `lifecode-skill-center/tests/r16-e2e-sim.test.mjs` | 10 965 | `551252f8e1c57d25515bb83ed733da254b09d2a651f0da4b5c9b1efcc1ed5b14` | ?? |
| `lifecode-skill-center/tests/r16-routing.test.mjs` | 14 705 | `8863b9991c21108c825c87b5ec7359152a997ec6c9f68004443c94cb76e14885` | ?? |
| `lifecode-skill-center/tests/r16-runtime.test.mjs` | 22 102 | `2c15c0c10767432dbbe8f211ec028fb281191b2b8db499560423c8b42745e716` | ?? |
| `lifecode-skill-center/tests/r16-security.test.mjs` | 18 827 | `eb6b296f72b627627638b333aef8e00298e12e2b62fcca550b445f16a287b9ce` | ?? |
| `lifecode-skill-center/tests/r16-ui.test.mjs` | 103 794 | `1aa268de437d71583dd92b6cc1912e9090e0caa977d9c963a428a9716d42c05d` | ?? |
| `lifecode-skill-center/tests/r17-activity.test.mjs` | 17 547 | `6f24328535e87fddc3dab0dfa20b7c0542be4d44aac9a72c28a49ce9bf3bfa55` | ?? |
| `lifecode-skill-center/tests/r17-api-activity.test.mjs` | 11 577 | `495afd2569cca1c1c85054e0037326e465da977304f87dcaf0e807b991f70631` | ?? |
| `lifecode-skill-center/tests/r17-contract.test.mjs` | 13 715 | `d3fa8e314a8a0feaffaf665729dfd33dfac12b24060d919a19217146320a1237` | ?? |
| `lifecode-skill-center/tests/r17-events.test.mjs` | 8851 | `cda7cd77ac932f5d5214dd92414307904b09307d878e810c10696f50d00bf228` | ?? |
| `lifecode-skill-center/tests/r17-r171.test.mjs` | 13 853 | `e02c3b0a3b9bb20b08470559735c8da36a2853553c57c2703e1ff9013a56936c` | ?? |
| `lifecode-skill-center/tests/r17-ui-runtime.mjs` | 14 687 | `25cbd51316cb7c9b517697511cff6f6f947cb3acafdfeaf7882342df7c1533b7` | ?? |
| `lifecode-skill-center/tests/r17-ui.test.mjs` | 16 644 | `cb7d674aea218ddffa1b71da61ab6d0386cfd213603f12f96fcde041cff1f036` | ?? |
| `lifecode-skill-center/tests/r17-ux.test.mjs` | 6748 | `008dc78dcb85f19d60b7655209c26e1faf5a2ec050bacc9b8f78446ce0ba4713` | ?? |
| `lifecode-skill-center/tests/redteam-fixed-contract.test.mjs` | 6925 | `a2cc1cd07a81d3d6d4a1fdc4647e0e59dbf08bc765848a62ee4a6923ee6c4668` | ?? |
| `lifecode-skill-center/tests/render.test.mjs` | 20 806 | `a3c60d889f54fb6515f2290cab3e95f10af00469f4769e3bcb820b70fc7e3547` | ?? |
| `lifecode-skill-center/tests/repair-api.test.mjs` | 9612 | `f960181bc4c5c499068d672638847640af48db3de6aa5adeee57877feb03efc4` | ?? |
| `lifecode-skill-center/tests/repair-interruptions.test.mjs` | 5246 | `76231b2d23f5f30ffebdaf50d2a9c5b518f747a374e0a1bcf9e2645ae093daeb` | ?? |
| `lifecode-skill-center/tests/requests.test.mjs` | 8811 | `3beb0de339316643ac3822d98a8520dbb3aad659eb842f49b91f062a32310c6a` | ?? |
| `lifecode-skill-center/tests/settlement-recovery.test.mjs` | 7135 | `92dc407b1b6ddc3e6d5a6802bd099def62091a9453bde7da5493df6f403e4548` | ?? |
| `lifecode-skill-center/tests/skill-detail.test.mjs` | 6151 | `ffe29294f985529357daa1918fb3a6dcbf3c3d18d889482437fd8db4c9d4c616` | ?? |
| `lifecode-skill-center/tests/skill-diff.test.mjs` | 5476 | `d57d58b88153e28b471b9c9f7adb60390a7687cabb1658ffd22f84a2f5cdd80f` | ?? |
| `lifecode-skill-center/tests/skillfile.test.mjs` | 4603 | `8b967630759ce79d19c63263dc705ff910cb15d11e0518358b0812b667da3db4` | M |
| `lifecode-skill-center/tests/state-atomicity.test.mjs` | 1478 | `95d51846764afe955a64eb2f9a6bca9f06030a74db3a60ef5d3cf7b4631dc3cc` | ?? |
| `lifecode-skill-center/tests/state-scan-contract.test.mjs` | 3632 | `cd433fded46e0bd57becf52bdca1f968ec6f712ea37190fb01912307408f2a2a` | ?? |
| `lifecode-skill-center/tests/state.test.mjs` | 7325 | `ba72768ac1ad86e2f4c8146aaf117089cfba533d76e22842d7220f42603a7388` | M |
| `lifecode-skill-center/tests/styles.test.mjs` | 3986 | `11e4fd2b7298d852b26f99ae678407cd2d23779ee2b488433d7341cf8d2fe7d0` | ?? |
| `lifecode-skill-center/tests/t13.test.mjs` | 9340 | `9f6907d65a9fdac588a97ae8bfc41e3cd59c121aa95864a9ba7d563bd269598b` | M |
| `lifecode-skill-center/tests/t42-tools-activity.test.mjs` | 12 361 | `6ebc2afc2921fb9a77f4e782e726ce3a0c0d8bf36cda1e56cbe9c451c8bcb40e` | ?? |
| `lifecode-skill-center/tests/t42-ui-runtime.mjs` | 16 401 | `134763d4760a0c5fd344073b3cfaa9ad997a69b19ba2e7d2b74e289146ef9407` | ?? |
| `lifecode-skill-center/tests/t42-ui.test.mjs` | 7103 | `5389d14b8cb9c16e604fcb5a45ad69c4056ff851658c74961c43d2c4af80656b` | ?? |
| `lifecode-skill-center/tests/testquality-analyzer.test.mjs` | 16 320 | `ddbf126c41be5677054912231e1166ca282cea4100d9c5c613deed02be90da84` | ?? |
| `lifecode-skill-center/tests/testquality-audit.test.mjs` | 4846 | `684318f865c81e717df98011bd3561cfa8adc3221ff2f3389cfe39684f5c1213` | ?? |
| `lifecode-skill-center/tests/tools.test.mjs` | 9311 | `a81297ed6527c0f18ed1f15f2a3ca7615dce7563ec68952d0fc4c201490588b8` | M |
| `lifecode-skill-center/tests/workspaces.test.mjs` | 14 068 | `46d17860a0a5a52ea0a0ff7f3cae0f47bc0169330740655c335c2f6167d99130` | M |

### 4.3 Herramientas (18)

| Ruta | Bytes | SHA-256 | Estado git |
|---|---:|---|---|
| `_audit/r16.4-run-gates.mjs` | 2553 | `2ae54f2779a87cc8d992c67dda4ee72511ca636cedc62b0c15d30ceafb4bdf04` | ?? |
| `_audit/r17-run-gates.mjs` | 3301 | `163ad7cec0d364a5f95bdb5e5a5282e2437c202753ddd243cac072c1becb45d5` | ?? |
| `_audit/r17.1-run-gates.mjs` | 3307 | `eb4eeb7f048baaab61850b6cf79b6f62a9d97f05498cd75e349df5ffc3bf0084` | ?? |
| `_audit/release-run-gates.mjs` | 2875 | `6320e47518c27c9983a5f0d9074580541936d8e6441e30b2893dc12199a44096` | ?? |
| `lifecode-skill-center/tools/adversarial.mjs` | 4049 | `e3f32b1f90514bf388cedbe660691403215121b487c3ee80ef14805f55b3f05e` | ?? |
| `lifecode-skill-center/tools/check.mjs` | 26 169 | `6fd4c96b81bbec37769b2fe87d3e5562ca7aaef5ce8f696195552b19caa3710a` | M |
| `lifecode-skill-center/tools/coverage.mjs` | 4487 | `172f70bba7eeaeb057ec1bb6e9e1c3e0bf221af535c478f17fbf79fc1cdcd7bc` | ?? |
| `lifecode-skill-center/tools/e2e-autonomous.mjs` | 30 497 | `e285271a05ea9b9c5479b40c135a3cf376aaeb206566da4afdb544776e482b01` | ?? |
| `lifecode-skill-center/tools/e2e.mjs` | 63 544 | `9fa412f06ae48a791e44b6cb3dea1fe99085cf1e77c3ab6a0971c7543bb27646` | ?? |
| `lifecode-skill-center/tools/mutation.mjs` | 16 016 | `20ae6418c51f75615b0e632822a0af2de1e456a06717355373f8841275c06cf6` | ?? |
| `lifecode-skill-center/tools/perf.mjs` | 6876 | `2b3887d88835500d260a75ad132f43ed6d1dd4b990b275fe063cd5cc9a8c920d` | ?? |
| `lifecode-skill-center/tools/r16-collision-matrix.mjs` | 6761 | `1ba087658b3f9a0065b39513a7a0aae59f7b123e7ef0b020f46b2fcd7e839cbf` | ?? |
| `lifecode-skill-center/tools/r16-e2e.mjs` | 10 681 | `927c8a8c2bb64703fc3e0724f19b455eb8734e51f72f9f07e4f65a6949c6aaa4` | ?? |
| `lifecode-skill-center/tools/r16-portability.mjs` | 11 456 | `3750fa1a5ff9e1ac99878c7fc40eae70ea4cfacda118a2e3dad846a67303ef17` | ?? |
| `lifecode-skill-center/tools/r16-routing.mjs` | 9233 | `99bed937a4b0901586e0f4c258982dd6b49565ea3a87c00c8bae12953ffb7ba8` | ?? |
| `lifecode-skill-center/tools/r17-perf.mjs` | 7613 | `1a248a0e106e5bb71ddc4859d796ef1e74a305834567ac302b5b81537b6b6d8f` | ?? |
| `lifecode-skill-center/tools/redteam.mjs` | 5479 | `7aa383bfb6e35a02b59ba860d9fcd800412ab19d8f335b834266b90a1e42dd20` | ?? |
| `lifecode-skill-center/tools/testquality.mjs` | 45 392 | `c2cd30ae959e1ab53af6dd99358ace3b3ec5e8dbf4dcfe1491d3bb63a3bd8fa5` | ?? |

### 4.4 Documentación (8)

| Ruta | Bytes | SHA-256 | Estado git |
|---|---:|---|---|
| `README.md` | 11 787 | `7603d8263f02ac77f3aa4d3c3bcf2285fe58534631e6138967db37108fa354ff` | M |
| `lifecode-skill-center/CHANGELOG.md` | 8058 | `5eddb796272967872763c900f520ff557dc06dad57031ed100458401445a83ab` | ?? |
| `lifecode-skill-center/README.md` | 31 360 | `c1f9f25792f1cd552b15ab2897aed4d86fb57155007e810089625a243dbb9d5c` | M |
| `lifecode-skill-center/docs/ARCHITECTURE.md` | 13 067 | `3fb92fd93793b5e3ce5ab3681725a4d7e9f49a10ee2a8212bb948de271780a46` | ?? |
| `lifecode-skill-center/docs/DESARROLLO.md` | 59 528 | `6c6f4e52e40dc260f577bb0eff2c7228759e7abc7242a5e80e2d3199e6ff34bc` | M |
| `lifecode-skill-center/docs/INSTALLATION.md` | 8702 | `caebfa36e4191773bbda095b5d4cb61ae8ca6ad0eced2b919a890d8684ca7911` | ?? |
| `lifecode-skill-center/docs/SECURITY.md` | 8231 | `bbd3927d736c76434b72885e77f3ea2c9b57f1f86d76dd0b98e5e4e877ad517a` | ?? |
| `lifecode-skill-center/docs/TROUBLESHOOTING.md` | 9976 | `d59d8ee8cb08218b0ca789290f7edacb66038d337cf6330aee972dc77b0b1e42` | ?? |

### 4.5 Capturas (16)

| Ruta | Bytes | SHA-256 | Estado git |
|---|---:|---|---|
| `_audit/t44-assets/generated/activity-center.png` | 126 032 | `8e83ca71ed9d495b4c9179d3da23c10fce7370f653303268503d5ee7c1c86e31` | ?? |
| `_audit/t44-assets/generated/activity-chat.png` | 32 275 | `b7c7b2cadd1206df526c36cac22144f96eebd02fec2ac8defcecc3f9948024ea` | ?? |
| `_audit/t44-assets/generated/activity-toast.png` | 47 529 | `ca94b0a5b863d56bd20b989c20df70ded47678d46d6ee59555b3e22eddcf679f` | ?? |
| `_audit/t44-assets/generated/collisions.png` | 106 509 | `3e4578626d830e3e16c5ad3f27639e52eb2d3c4dfbee3d1d86ad8093822df578` | ?? |
| `_audit/t44-assets/generated/portability.png` | 107 004 | `4bd049269b1f7b5b34830872b34107477735a936cd350e64bb76a42a6ce606a3` | ?? |
| `_audit/t44-assets/generated/project-detail.png` | 168 098 | `7735cb85f9bb454db3824ae039449fc9c66b410396307ffd631b774106c522da` | ?? |
| `_audit/t44-assets/generated/projects-discovered.png` | 105 385 | `e5e2f1829e7e8974d049ae84644190c5945fbdac8b2a60e39d60a6611c0561fe` | ?? |
| `_audit/t44-assets/generated/skill-detail.png` | 133 136 | `696799c018a2e71a9f6af85129789a7182194d6e26453b3c370853843eb65c9e` | ?? |
| `lifecode-skill-center/docs/images/activity-center.png` | 126 032 | `8e83ca71ed9d495b4c9179d3da23c10fce7370f653303268503d5ee7c1c86e31` | ?? |
| `lifecode-skill-center/docs/images/activity-chat.png` | 32 275 | `b7c7b2cadd1206df526c36cac22144f96eebd02fec2ac8defcecc3f9948024ea` | ?? |
| `lifecode-skill-center/docs/images/activity-toast.png` | 47 529 | `ca94b0a5b863d56bd20b989c20df70ded47678d46d6ee59555b3e22eddcf679f` | ?? |
| `lifecode-skill-center/docs/images/collisions.png` | 106 509 | `3e4578626d830e3e16c5ad3f27639e52eb2d3c4dfbee3d1d86ad8093822df578` | ?? |
| `lifecode-skill-center/docs/images/portability.png` | 107 004 | `4bd049269b1f7b5b34830872b34107477735a936cd350e64bb76a42a6ce606a3` | ?? |
| `lifecode-skill-center/docs/images/project-detail.png` | 168 098 | `7735cb85f9bb454db3824ae039449fc9c66b410396307ffd631b774106c522da` | ?? |
| `lifecode-skill-center/docs/images/projects-discovered.png` | 105 385 | `e5e2f1829e7e8974d049ae84644190c5945fbdac8b2a60e39d60a6611c0561fe` | ?? |
| `lifecode-skill-center/docs/images/skill-detail.png` | 133 136 | `696799c018a2e71a9f6af85129789a7182194d6e26453b3c370853843eb65c9e` | ?? |

### 4.6 Assets de marca (4)

| Ruta | Bytes | SHA-256 | Estado git |
|---|---:|---|---|
| `assets/lifecode-skill-center/app-icon-512.png` | 131 098 | `0836e4d2af250b5fcd9536c887b1e2d23bf5d2aec61593665f52398b5a63abba` | ?? |
| `assets/lifecode-skill-center/app-icon-transparent.png` | 429 336 | `ac581552d4ccfc123d16eee4bd9d58af386fee27ce862c09094aaa3f0de0c705` | ?? |
| `assets/lifecode-skill-center/app-icon.svg` | 3486 | `974ce3d662f6b78804ead08d5839f1d48d67cc2c017fdac928c3ea752a5a9d4e` | ?? |
| `assets/lifecode-skill-center/github-social-preview.png` | 922 868 | `cd6e11a281d79000c0338daad9b8098c9efb77748895fcfd43187cade2e12e6d` | ?? |

### 4.7 Evidencias de auditoría (69)

| Ruta | Bytes | SHA-256 | Estado git |
|---|---:|---|---|
| `_audit/COBERTURA.md` | 3740 | `b8ad20f1abcbf3342db4ed14a4c3cc2c7d9f6f8bd3b174699399dea0acf9d9e9` | ?? |
| `_audit/E2E-AUTONOMO.md` | 3531 | `3bdaa98061105bee85679de26ca6dd3419d41a912fad0388e860a3a1c51b44ef` | ?? |
| `_audit/FINAL-RELEASE-READINESS.md` | 19 152 | `ab1723476c2687505079c4908acc55f17c4b4faecd3a0f1eb0dba538d961b622` | ?? |
| `_audit/INCIDENTE-2026-11-09-web-boot.md` | 3901 | `bb2eb6c8397801087ac91ab96c4bb01b8f4e6862b68b2e04d2a64060594ac5ff` | ?? |
| `_audit/R16-ACCEPTANCE.md` | 15 838 | `69a9f997cb9c07d63f19f4c62cec93c2a92dcf4b8eda9fdb0cebc933ecb6cd3d` | ?? |
| `_audit/R16-COLLISION-MATRIX.md` | 13 964 | `44e562acb3e7b50b6e290e7935fa9c901112005cab382a8901bc0f9cd0150a96` | ?? |
| `_audit/R16-CONTRACT.md` | 51 005 | `958384bb605d8052d3a09d0bc08d128682ce393066fd3c5b945df659d7e42070` | ?? |
| `_audit/R16-GATES.md` | 8347 | `a6d0c3dbb2332667314783321873a67218a39ea91a5317fb2f165270b87b4e71` | ?? |
| `_audit/R16-PROJECT-LIFECYCLE.md` | 16 285 | `9b6255490e51ea80ad9fd3613748001efa4ca8ac3f09690aa0cdc7928da059f4` | ?? |
| `_audit/R16-SKILL-INVENTORY.md` | 13 900 | `371416e11818cc61a74956cf1c96e4ace19c89627863ae34db33fa7610ed4bd4` | ?? |
| `_audit/R16-UX-UI.md` | 19 350 | `158ff80f4a4c17ddbdabce8141f7d2e5e3e682a20d53817d92959b5a02ec3120` | ?? |
| `_audit/R16.1-GATES.md` | 7364 | `254e9bfceafa555e5b1f55371025fe1bb546ca020434eff9a8f4135824db4d1f` | ?? |
| `_audit/R16.1-PLUGIN-CONFLICT.md` | 6902 | `8360400b32a5482d0e18902ee3cb580694a5674668e7efeb6fd6c4f514d90b52` | ?? |
| `_audit/R16.2-ACCEPTANCE.md` | 13 548 | `da75b3ac9f1ab2d1fe700c0275f946866937820b12cb7dfca00f4102b5bbfc1c` | ?? |
| `_audit/R16.2-GATES.md` | 7600 | `dc77c906a4e6989893e65aa849ca08f521e7e184cb1193bf520ac1a3be9eea4b` | ?? |
| `_audit/R16.2-LIFECYCLE.md` | 8952 | `27586a092a5cbae3d903f70878c3d09623a736fa8ef91539c3b87eb120329611` | ?? |
| `_audit/R16.2-ROUTING-CONTRACT.md` | 14 388 | `eb51cf46968284492728ed58c0af5a96c44aa55b1e562a678f6258b3845a3322` | ?? |
| `_audit/R16.2-RUNTIME-DIAGNOSTIC.md` | 11 117 | `678c8a78dac268c81389e155a91cb9c8be0ed94927293e4d4839c05ad00d1765` | ?? |
| `_audit/R16.3-COLLISION-AUDIT.md` | 15 239 | `735b539eb4fa8cde9356ae8f84000dd0e1fbb48fbc9a302e481bac9c5a4bc922` | ?? |
| `_audit/R16.3-GATES.md` | 7504 | `aae8e5e387be99550c35140744b93474dc7aa829285e061325bf3cf859588057` | ?? |
| `_audit/R16.3-METRICS-UX.md` | 11 363 | `33c87f2a24117bbc9f1b2eec4e13842ad1052cbb5d5bade1daf064f9056c41ae` | ?? |
| `_audit/R16.4-ACCEPTANCE.md` | 12 401 | `6164c11094549d947cf362c2d4bd225e9abb00d7c3fa035a81cd9a449cf7d422` | ?? |
| `_audit/R16.4-GATES.md` | 8351 | `c8f8f551db46f5584f5019fb57bdb9b634a656297916cec799bafb9858a95edc` | ?? |
| `_audit/R16.4-PACKAGE-PORTABILITY.md` | 28 396 | `113dffb34d82e4a894de6834e94266a98359fc63c325026030b7efc80b01ae57` | ?? |
| `_audit/R16.4-PORTABILITY-UX.md` | 16 861 | `0b3ec9c2f91b1ba0191110bfb141a85710c988aee4033ff6fb7f7aa23ce1aab9` | ?? |
| `_audit/R16.4-POST-IMPORT-VERIFICATION.md` | 20 503 | `f1db968024f9868668ffbd082daba95636c3332cc66e8de941c6eb7a199618e9` | ?? |
| `_audit/R17-ACTIVITY-ACCEPTANCE.md` | 8874 | `d70c21e0041b3c9c6feaa566203242672b40d2e1a50da36a573047b81bbe6ef7` | ?? |
| `_audit/R17-ACTIVITY-ARCHITECTURE.md` | 17 446 | `35ce04d026eb4a3527b1d048a1750fd70a63a54cf1cc8d60dc188d7c6f02761d` | ?? |
| `_audit/R17-EVENT-CONTRACT.md` | 17 984 | `ef9d0097719b13fe6f85f47dd23ff16c2ac54865f4953540c588851779a6c352` | ?? |
| `_audit/R17-GATES.md` | 6889 | `355f815604d2c9d8e1edcc186090a66283b2256d15bc21e1f735752d3df2b049` | ?? |
| `_audit/R17-LIGHTWEIGHT-ARCHITECTURE-REPORT.md` | 12 709 | `ad0d4671cd18cf0ebcaa6349eb300cccfe1620aefae6e77a7e57c426dae1f82b` | ?? |
| `_audit/R17-NOTIFICATIONS-UX.md` | 21 225 | `9356fea59121ab8cf96fa6afbcdff7d85c287fed305ef5503222fbc935834a00` | ?? |
| `_audit/R17.1-GATES.md` | 6956 | `72782ebdcc89bc1e97d67e03cbc124b7fd6272e0c3beb613d6f9a4226570a391` | ?? |
| `_audit/T42-CHAT-NOTIFICATIONS.md` | 13 804 | `6e8f6c13261dcd9dadd0a747853f7581ae5523c2cf62c6d0dc3aed8aeb3b1112` | ?? |
| `_audit/T43-DISTRIBUTION-AUDIT.md` | 15 347 | `e1a7416edd5a402318fd129e26651c0197f80dd96c4e1773d2ec6446fb34911a` | ?? |
| `_audit/T43-PUBLISH-PLAN.md` | 20 608 | `7cff384899d426ddf9ecae1ce22741426421fcb8e8c48584b7b476a70c6755c2` | ?? |
| `_audit/T44-MARKETING-AND-GITHUB-EXPERIENCE.md` | 12 907 | `04515b4216001648024c192222f834f577a4fb248f6a22430388b7beaefa9103` | ?? |
| `_audit/TEST-QUALITY-DEFECTOS.md` | 13 857 | `2429e94efd8817fb538eb9b267c2029da948d6ddf5862aa60a7afcb0ad2b4877` | ?? |
| `_audit/UX-UI-R15.md` | 9715 | `b66a0545f81d6d63ad37d682a2ba9d6c2de25858361b09a0bfe7e29b66f9491f` | ?? |
| `_audit/r16-sources/50-catalog.json` | 4882 | `8743af94107e5743df100adb0b1c582c6e0b7b88e5374995053f84b3ec6c6635` | ?? |
| `_audit/r16-sources/60-provenance.json` | 4731 | `497ed3194d58d60223a814a1e35b8470e7a2d676cc9f365af1a04138c890e0ef` | ?? |
| `_audit/r16-sources/analyze.mjs` | 9267 | `489372266f54475eb49840edc76e9361474b0d9bb08d2deaaed31afb8d248589` | ?? |
| `_audit/r16-sources/probe-exposure.mjs` | 2284 | `b9c740fa513150422ec76fe0174257887b59eca2f16507367c0927dbffd35ca6` | ?? |
| `_audit/r16-sources/scan2.mjs` | 22 506 | `8deb6ba0f067e309b629896ca379fe04a2cfd83274105293117ba8f3fbe74b58` | ?? |
| `_audit/r16-verify-r161.md` | 7784 | `8b48f640e38898f8aaf79d4833e9a6424de508d3bc72e3bcfde02c6448a2bb49` | ?? |
| `_audit/r16-verify-r162.md` | 14 922 | `89894876e635ce05d971a0291313a41bb6f1c50d1958f9d96cca178c13e75a29` | ?? |
| `_audit/r16-verify-r163.md` | 11 823 | `c40cff6bba7633d56d60296f5b6fdcd2099120ae3288cb5306c6081d3dc9e6af` | ?? |
| `_audit/r16-verify-r164.md` | 16 043 | `5d5f6711fd65cd2ffd56b718e89edbbd940b64f5f7ac523230a4ca1e9129e71c` | ?? |
| `_audit/r16-write-matrix.md` | 11 011 | `ec9d03110e5bdb9ae370973a9c7bc796e3055d45d696182790aee14c898880f6` | ?? |
| `_audit/r16.3-recon/README.md` | 6978 | `101e69e9af8e2fc99c3f8439a40e76f7826307241d09c66531c36fea8cd6b059` | ?? |
| `_audit/r16.3-recon/analyze-live.mjs` | 5472 | `d63c4d28d6686eb1fee66b2f410b4b1f743ef7d95cfdded1bd15479b0cdfe2e0` | ?? |
| `_audit/r16.3-recon/case-selfshadow.json` | 6229 | `a9a0713c89a8d7c76d790b045c3cf0719e85d913435d7fd1a6216fbacd32b61f` | ?? |
| `_audit/r16.3-recon/extract-case.mjs` | 805 | `4a86ec5b33f45c3847edecf4a0c83d9c1e9b56ec6bc62c2ddbf69c6de3b2e87e` | ?? |
| `_audit/r16.3-recon/sanitize-r163.mjs` | 3573 | `e2ca21dbc3ccbba8a7187eabedaa9158ee8cd09da75989a7396178a4d1d66baf` | ?? |
| `_audit/r17-link-annex.mjs` | 1248 | `ca288496e31be5b5995f293d2c3eec7da121da90265c8964f4d99ee83d6376d3` | ?? |
| `_audit/r17-notifier.txt` | 3078 | `fe4983f05f26b4d2efe85747863c38fb4b916e5a79cdaacb7cbe8fdce1c47350` | ?? |
| `_audit/r17-perf-after.json` | 2116 | `45b182e84366c9b85a9995d21466a9ebc9cf568bb26390b37e9484f9f56e6a77` | ?? |
| `_audit/r17-perf-baseline.json` | 861 | `4fbd6b42dc4f8c8e5f91b5196d5325b06b08f64b5501dd3aeae253f919621e70` | ?? |
| `_audit/r17-render.mjs` | 6122 | `129a843a0d1f48ce52546f4bd93e4deffe987e808efdff4ac9f50259905b1c32` | ?? |
| `_audit/r17-verify-r17.md` | 12 734 | `1266f2fbbb20b33d2c82b2dc72215a72914f681a1b12957e2f396c5973620b26` | ?? |
| `_audit/r17-verify-r171.md` | 9194 | `a42e1cc2b4261b82f8dd4f739c87f0a7f06f1a732deedeb52694b3d84a97a21c` | ?? |
| `_audit/r17.1-recon/history-evidence.json` | 1445 | `d543e71b6ce2964acfe116d89ac4733bd29560e7fe10ff0adbe6dc8e83329229` | ?? |
| `_audit/r17.1-recon/render-check.mjs` | 2924 | `edd076529f8ecdd3b6fff547595c1ab1ad7eab5b34875d321217e374f8ef60a2` | ?? |
| `_audit/r17.1-recon/render-evidence.json` | 1128 | `3c169601d1f36ccbf8ee87470f3c498381202839d2ed5d6e83a6a90ded6c1b57` | ?? |
| `_audit/r17.1-recon/verify-history.mjs` | 2432 | `b1b2378fa3adcd149d067b3e9083cf818b12a9e42a26274834076258edf991d2` | ?? |
| `_audit/release-verify.md` | 14 404 | `ce5ebc0e39ab7724f6589f020e5125bd911831e314776909417910983eb269d8` | ?? |
| `_audit/t44-assets/fixtures-public.mjs` | 18 870 | `3c7ee558dec8473655acf414c640712d9f8edbc4d179eea6aa45f3005b30e563` | ?? |
| `_audit/t44-assets/manifest-public.mjs` | 1015 | `7fb2b6ad2b2c1a10885804a351d051347b5096c67077ca55cff7997defa89645` | ?? |
| `_audit/t44-assets/render-public.mjs` | 16 119 | `6e33f35712b23a33e441d0169393c8db79e6d7c5cd74a8b0610bc340520ede53` | ?? |

### 4.8 Rutas ya versionadas sin cambios (no candidatas)

Estas 16 rutas ya están en HEAD y no aparecen en `git status`; no se pueden commitear porque no hay cambio que stagear. Se documentan aquí con el SHA-256 del blob de HEAD para que el conjunto ejecutable real sea verificable: **230 candidatas + 16 ya versionadas = 246 rutas del inventario de producto**.

| Ruta | Bytes | SHA-256 (blob HEAD) |
|---|---:|---|
| `lifecode-skill-center/lib/detect.mjs` | 5146 | `44c735b6122413234ed5e517eed62e0177b2bc2e2763df8622eeb572f66d8f79` |
| `lifecode-skill-center/lib/evaluate.mjs` | 9205 | `4efaedebded68bfcbae57b161810ca878c8dac4c9432405c44fe020f22a89e8c` |
| `lifecode-skill-center/lib/format.mjs` | 6450 | `9b721889647d21cdc8bd6c1aa8e40d21467b906f773dbd65a7ff123a0e987465` |
| `lifecode-skill-center/lib/materialize.mjs` | 5280 | `26cfc0fefe354ec27665acf7ea6e7b194cc5264641ebc581213f08c710b3f633` |
| `lifecode-skill-center/lib/provider.mjs` | 7259 | `108522bbd1a613b9de776cb28003a37529a33e2986c2f20a38e4a779b2dac64c` |
| `lifecode-skill-center/lib/skillfile.mjs` | 6017 | `f94705ba32e6c084b216eccf5809606abc58ddb42e7780a12caad0de439a8aee` |
| `lifecode-skill-center/lib/watch.mjs` | 3402 | `93e2de5b2330f43da21d97c575394412da0a03d7b4ac15873d849a2426ce25fa` |
| `lifecode-skill-center/lib/workspaces.mjs` | 10 464 | `d260ed6602f712faa109fa53bfe06d7668902159ed853826d4f2474898bfd105` |
| `lifecode-skill-center/tests/check-hermetic.mjs` | 4097 | `a065c144f92f053d8f3b31fa328f078df19ff8a20ee8f746338cec10a3d34c23` |
| `lifecode-skill-center/tests/detect.test.mjs` | 3394 | `d3aa6de69137cd4167c88667d76975e0aa569619117d6079c04fa5bb9e3e8b9c` |
| `lifecode-skill-center/tests/fixtures/creator.mjs` | 1120 | `4f14eb00f560d46eac430bb3d3d4d81c73c08dcd1f16e60c83520d6155bfcc2f` |
| `lifecode-skill-center/tests/fixtures/loader.mjs` | 801 | `180ac2761fc64ba7d1ae339769d638d46f46a2ba658eaa9c120da8b8a605848a` |
| `lifecode-skill-center/tests/format.test.mjs` | 4504 | `aa937a42b9111b8d9f8b415eddf20bf8cbecb89b3fd2236495932457892c82d5` |
| `lifecode-skill-center/docs/ARQUITECTURA.md` | 6543 | `6eedb621c136ef2e003112880e5e2a16fe320aaae5c9e74a78fd2355b8888681` |
| `lifecode-skill-center/docs/OPERACION.md` | 4089 | `7e7e2e286effc3529e321d89f76d21290854bbdf4bda0814366c5c275d390681` |
| `lifecode-skill-center/docs/README.md` | 693 | `190ff52d9a8d412cc2e15ab6c3cb22352fe298a1a710e372c6d32411c5047899` |

No se incluyen en ningún `git add`; su contenido ya está publicado en el repositorio en el HEAD indicado.

## 5. Capturas públicas y su instalación

Cada PNG instalado es copia byte a byte del generado con el fixture neutral. Mapa instalación → origen:

| Instalación | Qué muestra | Origen (evidencia) |
|---|---|---|
| `lifecode-skill-center/docs/images/projects-discovered.png` | Projects panel (discovered + indicators) | _audit/t44-assets/generated/projects-discovered.png |
| `lifecode-skill-center/docs/images/project-detail.png` | Project detail with six sections | _audit/t44-assets/generated/project-detail.png |
| `lifecode-skill-center/docs/images/collisions.png` | Global collision list | _audit/t44-assets/generated/collisions.png |
| `lifecode-skill-center/docs/images/skill-detail.png` | Skill detail with provenance and confidence | _audit/t44-assets/generated/skill-detail.png |
| `lifecode-skill-center/docs/images/activity-toast.png` | In-app notification toasts | _audit/t44-assets/generated/activity-toast.png |
| `lifecode-skill-center/docs/images/activity-center.png` | Activity drawer | _audit/t44-assets/generated/activity-center.png |
| `lifecode-skill-center/docs/images/activity-chat.png` | Notification over a conversation | _audit/t44-assets/generated/activity-chat.png |
| `lifecode-skill-center/docs/images/portability.png` | Read-only import preview | _audit/t44-assets/generated/portability.png |

Los PNG se generan con el fixture neutral (`acme-web`, `demo-shop`, `sitio-corporativo`, `panel-interno`, `laboratorio`) y no muestran proyectos privados. Ficheros retirados respecto de la primera entrega: `projects.png` y `skill.png` (sustituidos por `projects-discovered.png` y `skill-detail.png`).

## 6. Excluidos con motivo

| Motivo | Rutas | Ejemplos |
|---|---:|---|
| evidencia histórica no incluida en el release (se conserva fuera del commit) | 1047 | `_audit/ACEPTACION.md`<br>`_audit/ANEXO-LIMITES.md`<br>`_audit/AUTONOMIA.md` |
| captura cruda sustituida por render neutral en docs/images (se conserva fuera del commit) | 328 | `_audit/acc-analitica.png`<br>`_audit/acc-bib2.png`<br>`_audit/acc-biblioteca.png` |
| paquetes del Host/plugin manager extraídos (reproducibles) | 264 | `_audit/r16-arch/extract.mjs`<br>`_audit/t43-arch/extract.mjs`<br>`_audit/t43-arch/extracted/dsh-app-boot/LICENSE` |
| perfil de navegador / cookies (no entregable) | 164 | `_audit/chrome-profile/Crashpad/metadata`<br>`_audit/chrome-profile/Crashpad/settings.dat`<br>`_audit/chrome-profile/CrashpadMetrics-active.pma` |
| salida intermedia de render (regenerable) | 55 | `_audit/r16-capture/discovered-pill-legacy-click.png`<br>`_audit/r16-capture/discovered-pill-nohover.png`<br>`_audit/r16-capture/discovered-pill-workspace-click.png` |
| documento de auditoría con ruta de perfil sin sanear (se conserva fuera del commit) | 24 | `_audit/E2E-REPORT.md`<br>`_audit/INFORME-LSC-016.md`<br>`_audit/MUTACION.md` |
| captura cruda con contenido no saneado | 13 | `_audit/r16.3-recon/_audit/r16.3-recon/live-inventory-snapshot.json`<br>`_audit/r16.3-recon/_entries.tsv`<br>`_audit/r16.3-recon/case-selfshadow.raw.json` |
| auditoría interna de publicación; contiene la revisión pre-publicación y sus hashes, se conserva localmente y no se publica hasta autorización humana explícita | 2 | — (rutas no reproducidas) |
| no forma parte del release 1.0.1 | 2 | `lifecode-skill-center/tests/historical/redteam-autonomy.historical.mjs`<br>`lifecode-skill-center/tests/historical/redteam-handoff.historical.mjs` |
| índice de asar voluminoso (22 102 entradas, reproducible) | 1 | `_audit/asar-index.json` |
| fixture local de proyecto | 1 | `_audit/proyecto-b/.dsh/skills/desplegar-en-la-nube/SKILL.md` |

## 7. Preexistentes de otros proyectos (excluidos)

`skill-compiler/` (14 rutas) no forma parte del release de LifeCode Skill Center; se conserva tal cual en el repo y no se commitea en esta serie.

## 8. Seguridad y contenido

- Barrido de rutas de perfil en candidatos: **7** coincidencias (se muestran por categoría, sin reproducir el valor).
  - `_audit/release-verify.md`: patrón de ruta de perfil.
  - `lifecode-skill-center/lib/distribute.mjs`: patrón de ruta de perfil.
  - `lifecode-skill-center/tests/evaluate.test.mjs`: fixture de prueba saneado (perfil genérico `example`, no personal).
  - `lifecode-skill-center/tests/index.test.mjs`: nombre de proyecto privado en fixture/histórico.
  - `lifecode-skill-center/tests/r16-domain.test.mjs`: patrón de ruta de perfil.
  - `lifecode-skill-center/tests/workspaces.test.mjs`: nombre de proyecto privado en fixture/histórico.
  - `lifecode-skill-center/tools/r16-portability.mjs`: patrón de ruta de perfil.
- PNG públicos con el nombre de usuario del perfil: **0**.
- `T43-PUBLISH-PLAN.md` fue saneado (la ruta de perfil del ejemplo se sustituyó por `$env:LOCALAPPDATA`); `release-verify.md` se conserva por petición expresa y debe revisarse antes de publicar si aún muestra un ejemplo con ruta de perfil.
- Los fixtures de pruebas usan valores señuelo (`sk-`, contraseñas de ejemplo) y no credenciales reales; los nombres de proyecto que aparecen en tests son datos de fixture preexistentes.

## 9. Verificación de este manifiesto

- Muestra de 10 SHA-256 recalculados: **10/10 OK**.
- Control: 230 candidatas en status + 1901 excluidas + 14 preexistentes = 2145 (status 2145); las 16 rutas ya versionadas sin cambios no aparecen en `git status` y no suman (documentadas en §4.8).
- No se ejecutó `git add`, `commit` ni `push`; no se escribió en el almacén real.

## 10. Límites

- `_audit/release-verify.md` está incluido como evidencia de la verificación final del release.
- `T43-PUBLISH-PLAN.md` sigue **BLOCKED por publicación**: el manifiesto no afirma que la instalación desde GitHub esté verificada.
- Los `*.log` (incluido `release-1.0.1-final-gates.log`) quedan fuera; las cifras canónicas viven en `_audit/FINAL-RELEASE-READINESS.md` §E.
- 16 rutas del inventario ya están versionadas sin cambios y no se commitean (§4.8); el plan ejecutable tiene 230 rutas.
