# LE-RAG-07 · Manifiesto de archivos

Directorio `lifecode-rag/` · **413 archivos** (el propio manifiesto no se lista a sí mismo).

Clases: **A** código/configuración · **B** pruebas · **C** documentación · **D** evidencia · **E** artefacto temporal · **F** dato sensible · **G** redundante.

| Ruta | Clase | Bytes | SHA-256 | ¿Staged? | Justificación |
|---|---|---:|---|---|---|
| `.gitignore` | A | 249 | `6bbb6f65f0eaea2c2e3d7253ceeaa348b14983940b030e918c7b1b664b0584eb` | sí | configuración/manifiesto del paquete |
| `README.md` | G | 8418 | `ba1036d6819d4bf248a48cbfd23397e4de47a9609c6b220d3ea7b5debca11735` | sí | revisar |
| `bench/bench-real.mjs` | D | 3029 | `cc42f7c71fefe2e485f96099a3b0e072b07c652a9ce0226c4b7a053210c248cf` | sí | evidencia reproducible / benchmark |
| `bench/bench.mjs` | D | 3424 | `9955e3236536e171fd8f9be2b5cdbc433afb94ace287b854bdabc5d413b37f4f` | sí | evidencia reproducible / benchmark |
| `bench/last-run.json` | D | 922 | `85d1c4cb7becbbb926232ce5ad6e50d81c1cb5cacaab7e9992901b46a4b959fe` | sí | evidencia reproducible / benchmark |
| `bench/real-run.json` | D | 1099 | `5b1c106dc09dd3671242a485f01acf4f25568e5f5d4c94b67b9cb0bdc4f54c35` | sí | evidencia reproducible / benchmark |
| `bin/lifecode-rag.mjs` | A | 21941 | `1b3045f6c8f7f880612dbd8d0d484f948dd6476e19524e549c16b016d62310dd` | sí | código fuente |
| `client.js` | A | 125067 | `4d8c2265be999e58d1bd6f9e9a8ce46ca47effa38999ac13a857265a723c6ead` | sí | código fuente |
| `cordis.patch.yml` | A | 67 | `0beb5beb88371187b8728e2acaea95aa71dd4ab9de4c2ba952615c6af3720053` | sí | configuración/manifiesto del paquete |
| `demo/.gitignore` | D | 8 | `97b5ecb5e87d55c377cfd0e5328f1117a4d8f550ad1fc70b985a54e144ca6733` | sí | demo de referencia |
| `demo/.store/rag.sqlite3` | D | 184320 | `b17e3c6b695ff10f885907669c8abc165582eb3e6e8a66592bc7b1d67ce16381` | no | demo de referencia · EXCLUIDO: no seleccionado |
| `demo/app.js` | D | 19482 | `fc3b4fbd0ca0bb7add7c28bcf4268ff47c3f5b0a8c51f7773dfbde2a70b2fa03` | sí | demo de referencia |
| `demo/corpus/arquitectura.md` | D | 2146 | `1e92e1be04ce5a3dede1aef5d3552f531c893dc46ae25e101d94c1af7da49915` | sí | demo de referencia |
| `demo/corpus/herramientas.md` | D | 1316 | `e75f27fd3ef1046e592b62ec7c60a0c2cf270729eac9ab30961e06a8a00462ed` | sí | demo de referencia |
| `demo/corpus/indice.txt` | D | 100 | `766b008839e4c7e1a68e7bb615c3531bb27c34d53e0baaa4a1927716b8cfb878` | sí | demo de referencia |
| `demo/corpus/observabilidad.md` | D | 1434 | `7116becbce2a53e11e8e5fc1ac004d8093d968e5591195041023e732afd7e44d` | sí | demo de referencia |
| `demo/corpus/operacion.md` | D | 1478 | `6d65d7a0fe9e84991c2d0f3c9e5064a67dc31bebe8b724c58e8aee8448562fbc` | sí | demo de referencia |
| `demo/corpus/recuperacion-hibrida.md` | D | 1514 | `33908d0c184c2950c460ed969560580e0c173858ca1622c288edc1d8309b7341` | sí | demo de referencia |
| `demo/corpus/seguridad.md` | D | 1637 | `f712d450d81cb15b7b227d89babdb02ac149dbe6ac7c8d8cb12452249031f059` | sí | demo de referencia |
| `demo/index.html` | D | 880 | `11e10a7fccf1c2bed3efe7440618bd50609a9f9643c323700424dc2e55c0c94f` | sí | demo de referencia |
| `demo/server.mjs` | D | 3223 | `1561be70c249d63519a515c24ddb078c83cb492bedcde60d7fbc84183c92e45c` | sí | demo de referencia |
| `demo/shots/resumen.png` | D | 64468 | `9b5f0c70f45bf36eeacf891f3d881fa8e30f8ca5bad03f2230511332bdfaff32` | sí | demo de referencia |
| `demo/styles.css` | D | 7667 | `18b6e9cb82747c1039bfc751419491f7b6558fdd8c96b47bbebda6415a47bbb3` | sí | demo de referencia |
| `docs/ACEPTACION-project-aware-propuesta.md` | C | 17212 | `2d91f5f2f72d893fad4a0d42281f3f1d1959b631f4f2cc36b787ee4063dd3ebe` | sí | documentación y ADR |
| `docs/ACEPTACION-v0.1.md` | C | 9123 | `a95cecc13f368b146c8382e37c9b4db56a76bcc96458ce52a9d1189041f63770` | sí | documentación y ADR |
| `docs/ACEPTACION-v0.2-propuesta.md` | C | 7210 | `7afab0bfbeb29cb213c26534a35dc200dde0fadb2f4f3825c64ded83c1bc8c8b` | sí | documentación y ADR |
| `docs/ACEPTACION-v0.2.0.md` | C | 12050 | `2b0b43915eec7b3a4b2ce1d634843ec417e4a7175d9b34d365b3fb02a3409624` | sí | documentación y ADR |
| `docs/ARCHITECTURE-v0.2.md` | C | 12860 | `04a36624ea17d72be336fe92445d2f06e4f8de64f42ed0207a636961fb96b748` | sí | documentación y ADR |
| `docs/AUTO-DISCOVERY.md` | C | 6570 | `206bb3bfb3ba79826a7ab39707784571b38bfa2c6404783a6f06b4a121b23072` | sí | documentación y ADR |
| `docs/AUTOMATION-POLICIES.md` | C | 12671 | `80aef336ff28da79c0e8866cae9127f840fc3513e8c7ad14b270cdcb7af5488f` | sí | documentación y ADR |
| `docs/BENCHMARK-2026-11-17.md` | C | 3167 | `ff8bb9deac4b84c69f452e32aa1bca48dee46db81fabce7fd227fbeb29a980d2` | sí | documentación y ADR |
| `docs/CONTRATO-v0.1.md` | C | 10063 | `a58db7d6cac0756e2711c5ef556111dc7d38cec206420021e2bc42e42b4068f1` | sí | documentación y ADR |
| `docs/EMBEDDING-PROVIDERS.md` | C | 6315 | `10e646166a29084484654669ec45b8a613dfd9eed0e165a9bfc03c1ce046fee4` | sí | documentación y ADR |
| `docs/INSTALACION-M6.md` | C | 3693 | `63f0b5e39178940d9dc82b2f3b6b4a80ade5e5f077560b4c2e0cdd62cdd21838` | sí | documentación y ADR |
| `docs/K1-DECISIONS-RESOLUTION/01-OWNER-DECISIONS.md` | C | 9148 | `4e0053dcc4b79056cc2244ada037cb6b1b7a28baae18a5e376a26754bc2503d1` | sí | documentación y ADR |
| `docs/K1-DECISIONS-RESOLUTION/02-G3-AMENDMENT-PROPOSAL.md` | C | 8125 | `9df8d9ebed9f79fb67eb39181fecd9e434816961333afb5807a76a66ebfe6eaf` | sí | documentación y ADR |
| `docs/K1-DECISIONS-RESOLUTION/03-K1-DECISIONS-TRACEABILITY.md` | C | 9086 | `f7778f04551905d3b82d3557babec244e0aca63ab888f9f4959e82b2f6ec4bd4` | sí | documentación y ADR |
| `docs/K1-DECISIONS-RESOLUTION/04-IMPLEMENTATION-AUTHORIZATION-BOUNDARY.md` | C | 7861 | `e68f129391abd534844289a61d49342bedb79a878d8836dd37f1d0b7c264eaac` | sí | documentación y ADR |
| `docs/K1-DECISIONS-RESOLUTION/05-RESOLUTION-MANIFEST-SHA256.txt` | C | 699 | `c5ec52f10cac2eaaef3f424992c70a327bbf9f46e90bc711e3dc47b385dddf6a` | sí | documentación y ADR |
| `docs/K1-IMPLEMENTATION-PLAN/01 — K1-IMPLEMENTATION-PLAN.md` | C | 22184 | `934107c8b312390d63c0c1ff0ad41df9b72432710d4166e9cac20cc11eb2cdee` | sí | documentación y ADR |
| `docs/K1-IMPLEMENTATION-PLAN/02 — K1-A-CLIENT-INTEGRATION.md` | C | 14286 | `b17c539ff0fdb9754e4755d69966d6f75768a72c7ef92012c509f30f34f997a3` | sí | documentación y ADR |
| `docs/K1-IMPLEMENTATION-PLAN/03 — K1-B-PROJECT-AWARE-UI.md` | C | 15601 | `38573800789ea62da38711f4508eacddcc3807cb90d6fe3bbc21809fc3d46505` | sí | documentación y ADR |
| `docs/K1-IMPLEMENTATION-PLAN/04 — K1-C-API-SECURITY-GATES.md` | C | 12887 | `e9c93bc87546de6b65c4e051a59ffd43b7a626c5de0a8c3232964fd31f77f872` | sí | documentación y ADR |
| `docs/K1-IMPLEMENTATION-PLAN/05 — K1-TEST-AND-ACCEPTANCE.md` | C | 9261 | `22d3ad427800b9e61d5d88e1b16189d1116e4ea4f92e782a2d23da74fe912082` | sí | documentación y ADR |
| `docs/K1-IMPLEMENTATION-PLAN/06 — K1-FILE-IMPACT-MATRIX.md` | C | 8250 | `6b9e585a58e082146fe930ead90680b9fcc866ae08dca940c6c8078c33a25da6` | sí | documentación y ADR |
| `docs/K1-IMPLEMENTATION-PLAN/07 — K1-DECISIONS-AND-OPEN-QUESTIONS.md` | C | 10656 | `a2e0d2e7173798cbb3f78a9907bc39ebd7a9da8f03df30abb566fe5e67813a22` | sí | documentación y ADR |
| `docs/K1-IMPLEMENTATION-PLAN/08 — K1-PLAN-MANIFEST-SHA256.txt` | C | 998 | `829583fb123c7c8da9977f0f4b642afe3cbd1124b101792d1d182030ba7afef1` | sí | documentación y ADR |
| `docs/LE-RAG-01-ARCHITECTURE.md` | C | 5425 | `8020eaa6f53c699648775b435e754fe2aaa3e3f7f00d87d0ba9eff15a8875113` | sí | documentación y ADR |
| `docs/LE-RAG-02-COMPLETION.md` | C | 5418 | `e14ef4c3b3808021595064dab364aa585399d4dc6c9f33a2466633b71849ccab` | sí | documentación y ADR |
| `docs/LE-RAG-03-RELEASE.md` | C | 1051 | `0c184b01bd9a89aa0f5d34dca8eff94148038f7d772d6113e657de3d1cc9fa7b` | sí | documentación y ADR |
| `docs/LE-RAG-04-DECISIONS-AND-SPEC.md` | C | 5859 | `0d570a9c3c8b999a86072339eb4a9562610f48cbab83d36f8c2161b3a915729d` | sí | documentación y ADR |
| `docs/LE-RAG-05-CLIENT-AUDIT.md` | C | 5669 | `32e6847c31425ba8c677e7397ceedaa24697b93eed8e9e862a7ae03a563a72c9` | sí | documentación y ADR |
| `docs/LE-RAG-05-FINAL-REVIEW.md` | C | 5186 | `2ad0397a1f2bd18dfc850d0fe600a4be6a9d7998e0017d3fa3f138c13441ee9f` | sí | documentación y ADR |
| `docs/LE-RAG-06-FILE-RECONCILIATION.md` | C | 5833 | `5aa7d84cd741c85af626bcd6b6627df9658ff99979a6b713457adaafe7a00472` | sí | documentación y ADR |
| `docs/LE-RAG-06-INTEGRATION-REPORT.md` | C | 2458 | `7af16740941610a80dc85900d6576136e10448dfa36f57b9462b2b07ba4fe3bc` | sí | documentación y ADR |
| `docs/LE-RAG-07-COMMIT-PREPARATION.md` | C | 4032 | `5e06f81972b39833270bcd0c0211d794c41eeca03e613ca8bb55cfdf0ead991a` | sí | documentación y ADR |
| `docs/OBSERVABILITY.md` | C | 13107 | `85a92c7811b67a083d6ca4df6e77673ff0a9f039464b22756c759ec92f3dc007` | sí | documentación y ADR |
| `docs/PA-UI-0-ACCEPTANCE.md` | C | 24568 | `aa7fe63598146360ed4dad8a9c736491336da08f543968a25199f34ed718de30` | sí | documentación y ADR |
| `docs/PA-UI-0-API-CONTRACT.md` | C | 55545 | `934224310e10006d0ab3dbc2fec18b5a418a9e7c5e0f68f2570ee544e468c68a` | sí | documentación y ADR |
| `docs/PA-UI-0-GAPS.md` | C | 23565 | `bae5139187138aaa5805ee89140ec9edd1326ee9a1c39bc36b62987151b4d19b` | sí | documentación y ADR |
| `docs/PA-UI-0.1-REVIEW.md` | C | 15154 | `4a3894179f6bd9815c6b831eb863c28a327233941ab2591b0fb8901fa12d7732` | sí | documentación y ADR |
| `docs/PA-UI-0.2-REVIEW.md` | C | 10343 | `268771a2f43e159c3d469219225e9b33db4699a94b72b205ad4206f640602d42` | sí | documentación y ADR |
| `docs/PA-UI-0.3-REVIEW.md` | C | 7849 | `613e91f9fed70dbd04724f0a561195840fab9cdde15258260891b9996fb342eb` | sí | documentación y ADR |
| `docs/PA-UI-0.4-ROUTE-B-EVALUATION.md` | C | 16541 | `187f82ce9551eda1ef91a0a75a70f12e8334b4f63d7a62fbf1fc2bed06929038` | sí | documentación y ADR |
| `docs/PERFORMANCE-BUDGETS.md` | C | 6997 | `553687eb869501a4945af90acc05bbf901366a6a4e9659ae31871190a68294e4` | sí | documentación y ADR |
| `docs/PROJECT-AWARE-ARCHITECTURE.md` | C | 37656 | `fb632fb09e75eab4411fd461a37f81e3e1fa0a7286b0fa86c21a300a21a68309` | sí | documentación y ADR |
| `docs/PROJECT-AWARE-DATA-CONTRACT.md` | C | 20464 | `bd24efca74afaa7676baba534902ed15aa9c0cebb5563964513bbd873ea854aa` | sí | documentación y ADR |
| `docs/PROJECT-AWARE-ERROR-CONTRACT.md` | C | 10113 | `72c50264f8e56e743256b946d6ac13fb5d6c7c88922939425dfbcc67a1c88155` | sí | documentación y ADR |
| `docs/PROJECT-AWARE-SESSION-CONTRACT.md` | C | 8324 | `c4927ea2eecbc2181256b053b1f1750631ee8930eb67b959485a26308db48895` | sí | documentación y ADR |
| `docs/RETRIEVAL-EVALUATION.md` | C | 5876 | `b9f6fbcb2e8a290e9a4f8e94c90c334839712885f58753cdd0f129969d72c1bf` | sí | documentación y ADR |
| `docs/WORKSPACE-API.md` | C | 12509 | `452444939cc081bad7364d736443e2111f432e337b189d8f73bcea5a28da7075` | sí | documentación y ADR |
| `docs/WORKSPACE-UX.md` | C | 12017 | `c895fec4ea767f79604ff16c9a34aba8a7afb21e6e6ad8f3fc7ab4e97b02fb0c` | sí | documentación y ADR |
| `eval/auto-discovery-01/01-tests-full.txt` | D | 29168 | `861adc6d544e25ea1a8ac57dcaff579194907dfe5f94b403bd638ae80b1f15aa` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/02-tests-discovery.txt` | D | 1453 | `cad6753f83cc8c27bfa62b99f7e30020e467bec90e94598525d21a890bc17976` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/03-tests-client.txt` | D | 3840 | `a685e26547064074fe11f93edead9ee427564e8a60ad4100ee368a15f39a96c7` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/04-discovery-plugins-dhs.txt` | D | 1585 | `c4b8a9bc0a00aea066421e9c8cfcca7fd318de4669fecb3e83ec55cfe8b30368` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/05-discovery-htdocs.txt` | D | 35635 | `e00a16f548cfe3c519f5facb2ed9e98a6b9a727c74ce02305a1442c00da28f57` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/06-real-registry-readonly.txt` | D | 1420 | `e890f0671a8a99c9404e7f1af767a418b6841b9282d65bb739ecedf23944d90d` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/07-store-integrity.txt` | D | 333 | `6badf717e720c78c698d5bc151bd5c6ce75111d427bcd3cd0dc270e43b3bceb0` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/08-resolution-real-shape.txt` | D | 1330 | `17d979c39f2317ce5859d0d60b772e53f108abc8f0152a6e120c4cb4c4d19d3e` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/09-panel.txt` | D | 1297 | `004679d108d906a8e2e243fdda531777f705c40119f943e182e94bedbf057ec1` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/10-dsh-real.txt` | D | 2011 | `f70bf52bb0f431a5d6d8800ef4c721dedd9fe6774963803c681119e7a1c474ad` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/11-design.md` | D | 2393 | `0f0d1aac694378dad7ab101e6df0642b1549779120d8b47bc66202cf2fc93d95` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/12-manifest.sha256` | D | 2667 | `d0532002fab594d159f152f980dcb1c8a8ab22e2775f1fd099a03c43ece7498f` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/13-REPORT.md` | D | 3173 | `afc154f9c358b6b37b8990248db40bfce51e32184c50c06f2e5357d71bdfee31` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/14-tests-harness-projects.txt` | D | 1414 | `fefc9eb5982959cc5200e5ea6db13b7f1b2f101fe4ce639cbcff932229cc8a80` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/15-tests-full-after-harness.txt` | D | 57444 | `1409ad9dfd34c8a4e61fcc72b7e66373ebc6218378d6b00f7afebeb23646b8ed` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/16-harness-shape.txt` | D | 1990 | `ec98bceb6b4a76fb1f0bf3c7a9d3420a71efbb242c4b4024c145b84a780a7cbb` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/17-harness-live-state.txt` | D | 853 | `0b44c20b5b31ead4fdf9440f63875d795bd35ca119e9ed81af7a9ed7fb57a7bd` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/18-REPORT-harness-projects.md` | D | 6264 | `db1604260f77711b53a6af01ea3b57f0c7be92bf2dab0e184a359c2522968a45` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/19-manifest-harness.sha256` | D | 1402 | `0ab89f30587374f9513c1a41a86ca2f1c54e89deeddfb4811e9be01e311b9138` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/20-trust-add.txt` | D | 2588 | `f8e0670139c4a0503ade9d52d333a4f992cb14f0e108a99ea6cfabdd7b263f1a` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/README.md` | D | 1609 | `b19b278c3c4fab9aaf00ad4c7c8cb38119430cbf124c5a9d0eaac61f68a5be95` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/scripts-harness-shape.mjs` | D | 4977 | `f94a25c2186bfae13443ef7d5653100dd9b37a4956cab121423a5dcea00e8ab5` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/scripts-live-state.mjs` | D | 2105 | `9a68a12a15bda07b5dc56e33ffb21aa018bd686013931dbfed92a509132932ca` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/scripts-real-shape.mjs` | D | 2912 | `25494e53ed981b0b0e787e9cacf7fd2dccd74f6825da758997528f80b69f1243` | sí | evidencia reproducible / benchmark |
| `eval/auto-discovery-01/scripts-trust-postcheck.mjs` | D | 1786 | `90404914c55547add6604955f29860626e094de6a7b9735b78b8239a4b05d2fc` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/ACCEPTANCE-MATRIX.md` | D | 4471 | `39edd940a92c8130102e4b589f1e2d69602dc547e73523dfa3048d5a79e9460d` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/DATA-PROVENANCE-MATRIX.md` | D | 6806 | `94e248885625369e2e3db263872e462e91865b60d39324288878e5d71608451b` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/DEFECT-REGISTER.md` | D | 10177 | `2a7eefa4851dfb178c45f5c8c2e8fe647d63399992053a643322bf473200c224` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/EXECUTIVE-REPORT.md` | D | 6172 | `cd32c6ac0c6dbcfd32ddfd4299313c9a844e83410817d4f7cea1a84d52be3ef9` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/HASHES.txt` | D | 3695 | `271dd83aad8b35ace3974525bf64caf76364edff6a7e120da75a19b41fcea4a8` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/HOST-VERIFICATION.md` | D | 4432 | `ab73b1af92a60ec89f578f9780ab3de5389022605519f5e7eacf1ded97f43427` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/SECURITY-AND-FIXTURE-VERIFICATION.md` | D | 4110 | `c05013080c36329f4f4131c08a728fea52b22d1f67fc6a5723d49e9f6a8d8038` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/TEST-RESULTS.md` | D | 3237 | `e3970c2a152b249058881c004d2b72c7989e0f6ba6886241d5a6471fbd37da81` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/VIEW-BY-VIEW-RESULTS.md` | D | 10612 | `c452d81d9c4930a7eb33a5350f499a58f1a1c46562650552c162d4192ff85b72` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/VISUAL-OBSERVATIONS.md` | D | 7139 | `3bf2abc49ae58782a877bbb793ad0a6136035faecfadf9efe4180e069d51fb37` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/logs/check.txt` | D | 159 | `fd5a516b70e14a6cbf4291a576c2f3d9e50b23715aec0c50f770c4f002dd7fec` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/logs/hermetic.txt` | D | 26438 | `049ed1090ae839e20df9fe5df2b41b9153a874c8a8f6417eb7e2e0921dd842cc` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/logs/node-test.txt` | D | 25939 | `5eef735e5dd399913bdda58037756985f76de10bb80dc2782e2c96d101857baa` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/01-project.png` | D | 83258 | `1534cb76027eb9eadce85e877cbf285f9106b76028bd46bb742924231482107a` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/02-libraries.png` | D | 69846 | `62889c2e249b4c2b380a1b02f39dc48b1ed6a8173c9cab8b3de4a022ffd17e2f` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/03-sources.png` | D | 115367 | `412d3add3c0a28d43d507e556252bd331497f3d27d0cf060135a6e362ac022b8` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/04-search.png` | D | 60068 | `802e84ca651e86f7a2c641fbf7b9ac7d402f2e584b5c691c9fbe4eec697f5242` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/05-context.png` | D | 61895 | `479b189ef825c521d6eed97ad6f3d401964c8053fd1acb621f84f1acef8f1fb4` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/06-operations.png` | D | 80797 | `34ced8cbc83f1bf18eeef185d75160309d456d99187309bfeb1825e1b26000c4` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/07-diagnostics.png` | D | 84678 | `fca2e1bc7af6a6f675c74cc73f9c347233227160565c8eec2693dbab6c06fabf` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/08-connection.png` | D | 67221 | `098f1f04d07145fd04235031122d9cbe5f4741e788102f52c0c7b669f444e8a9` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/09-history.png` | D | 67202 | `2b8e9d778ee1b85e928e4abc535fdbc4803839038c5eba6a50eb39437f74c774` | sí | evidencia reproducible / benchmark |
| `eval/functional-audit-01/screens/10-fleet-reference.png` | D | 194496 | `e99bdd4c76e75fc9f5d19386dbef65c224e6bc6136de0d813c91799c040f6510` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/ARCHITECTURE-OPTIONS.md` | D | 4203 | `b8566b8e3464df299304d9faa10fa8dc548a3052ebb4c05a71f66256d4fcbffb` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/EXECUTIVE-REPORT.md` | D | 3320 | `4d907fefdc7ee0aafb8e8e1b914977e4a66d50827ad82abf272036f2f41772c4` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/HASHES.txt` | D | 4581 | `f260ff0a8449c3e19e590eaa51ae0253975162466d73d1797583edbf8b7647dc` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/HOST-POST-REDESIGN-VERIFICATION.md` | D | 3991 | `01e9b7ccb86454f7e2b30be59d1744a412ac6af8c91883e2fd73cd1ba7fb4b2b` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/RAG-TOOL-AVAILABILITY-MATRIX.md` | D | 3647 | `64b8210abedae327772bce141c82dc5ceda0bb2a542ab7fa11ffae3d0c27b8f3` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/RECOMMENDATION.md` | D | 2130 | `470eeeb7ef34444a699366dedd1c47b109751a2de7933f66600677eeca9b348c` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/SECURITY-THREAT-MODEL.md` | D | 3794 | `a0f4c28ef3458872fefc3e30b5331ce984b3d234f82e9bf3077d719b6113e3be` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/SUBAGENT-AUTHORIZATION-ANALYSIS.md` | D | 4509 | `5028f4face0a56ae3fc00321db038f1f6f64034ddc63d4c707931d5b9a803910` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/SUBAGENT-PROVIDER-INVENTORY.md` | D | 3820 | `d8100aea0d22bb55d16960d5f2da6b91a7cf2ad1fa7fbcfcbc933a619fa6d676` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/SYNTHETIC-TEST-RESULTS.md` | D | 3966 | `3b0f3ab6b6d5292c51653ed63d9951fee4e240ee56bc0377f2becb159b19a57c` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/VIEW-COUNT-RECONCILIATION.md` | D | 5197 | `e5df76ffe0dcdbd418bde0fc2e4f87179995af4a8ea33a19c5ba7d62bb7c3039` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/evidence-host/approval-README.md` | D | 10627 | `b84f837bf5d3dec13e567cab5d60df6f3f066c33019defca94dbbbba82061071` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/evidence-host/base-patch.yml` | D | 21702 | `c6d3e1ef67250b39dd08321829994e9642af9600ddca267923c52c612e7f3902` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/evidence-host/child-agent.ts` | D | 13080 | `23a88c7cccc553057296b5d445a11447fac9cc59e7147c21382b36a3a5fef962` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/evidence-host/fork-README.md` | D | 8567 | `9a7e05e28841363c3a13be7bd3903f1baf1a346e0587679cadb350336906a1e2` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/evidence-host/spawn-README.md` | D | 7561 | `1cf72e6c109d4aca71446a83983ef0334901750719e5eb2c38bedfd937d8c69c` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/evidence-host/subagent-README.md` | D | 28149 | `9fff746d3ff70432842247705cf390df57622283d18bea9c49feee2efd2be7d5` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/evidence-host/tool-subagent-README.md` | D | 21058 | `9ecd67726f63fa63f9cf6af14ff358d318a44c39f7cfd3c6058265dce548abc9` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/evidence-host/tools-README.md` | D | 16205 | `11795b676043a3a4e6c1f6bbe43d6bf127b43bcbc41e886a0ebb4affc870afa7` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/evidence-host/web-patch.yml` | D | 24174 | `7311a56b7d953214fc027eb5cc02bba7d6aad26fd8f698834de4d742d80b70a5` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/screens-host/01-project.png` | D | 100115 | `c77aeac907d656e52c4ce3d766ba559b110520446673c672330ba9b3bcca5f96` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/screens-host/02-libraries.png` | D | 84261 | `77b17c22afa1bdba1b2c941dee1675bcb8f74f445ee9a9a55e375c0860d047a2` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/screens-host/03-sources.png` | D | 123740 | `78e6ee458984909cd02b332d7f44caf18691d7974e5d5f0100d3673f6899182f` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/screens-host/04-search.png` | D | 75174 | `8605f7091d7e37e2dcff599442ba6c2c6d39a666675c85b0c9b5b32a1c0e68ff` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/screens-host/05-context.png` | D | 77704 | `e97e684d47151d838ff6cf25687adfd17651c31cea68e20ce2d3838804bb291b` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/screens-host/06-operations.png` | D | 92223 | `3de735b56ab2f6dbdd7825b705469a60fbb47ad3254964970b1bde650990a394` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/screens-host/07-diagnostics.png` | D | 102380 | `11286074f0099f59c8c6c083237795294c9de0031bfefa0177d470ad95d9edfa` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/screens-host/08-connection.png` | D | 85525 | `be8208f38d37c643f3483c3b1dbb7a1ec62e3c76f7ecc0d19bcc9ba74f9c64b4` | sí | evidencia reproducible / benchmark |
| `eval/host-subagent-audit-01/screens-host/09-history.png` | D | 81237 | `6ab4e4bb659ae0365d3c9af19ec40914d6a678d182cda66f01c60ca67bfb2be2` | sí | evidencia reproducible / benchmark |
| `eval/le-rag-03/functional-report.json` | D | 1942 | `9eb5de0da39a10f0240896e4cba8db47d67b419fe4b71a00adf80fd324f7f637` | sí | evidencia reproducible / benchmark |
| `eval/le-rag-03/functional.mjs` | D | 4382 | `892a3edff2842d31d18baf1ec8acd71bb22e4d0d45bd1969de48cf75fa2a842b` | sí | evidencia reproducible / benchmark |
| `eval/le-rag-04/seven-tools-report.json` | D | 1562 | `62229808b8c83ba005604c3a693e26c0ef4acb02a364497b881bfea900a4c0b4` | sí | evidencia reproducible / benchmark |
| `eval/le-rag-04/seven-tools.mjs` | D | 4949 | `951b92136d3377025661e2f81c4206c89716d028a7d07682b3a9ba8ccd54af8a` | sí | evidencia reproducible / benchmark |
| `eval/lunascape-token-rotation-01/HASHES.txt` | D | 86 | `b31dc930467c86a5ee1b8fcff25c020fb4a15aae0f6517f0f608e33967ac583b` | sí | evidencia reproducible / benchmark |
| `eval/lunascape-token-rotation-01/OPERATION-REPORT.md` | D | 7278 | `9d0ea0c27b2c4590558442045c9ef5bd2e258032434a7d16363110673268d520` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/CAMBIOS.md` | D | 4559 | `e850349374c90433a4b64375d754c15def64c0d6115fb1a13aff3a266d2ba2ae` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/CAPTURAS.md` | D | 1854 | `02b5bb81ef6aa340483095974b3ad790db8b9795006676d2332ea04e24e971b8` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/CRITERIOS.md` | D | 5746 | `f9271ba72b826c6a5c6c7036085fc3d1fb44ed936abdd39a28b9baaf025ebbdb` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/DEFECTOS-CORREGIDOS.md` | D | 3503 | `9e9e413e46b58302628aa1ce9c7055012c0bd97c8fe720eb90033b416d63769c` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/G3-AMENDMENT.md` | D | 4431 | `aabddf9dc018e39e31a54795a3435a7893c4cfd8aa9dbc7e51dc204840e995f0` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/HASHES.txt` | D | 5208 | `4464be17f4ea3f5e8d1502823a8518f012f34ff1805a85800505beaebef23d61` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/INFORME-EJECUTIVO.md` | D | 3952 | `9ff7d7d851074508f93ef8ca0c35e45c6d900338e59517d78816d5a190f4820e` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/PENDIENTES-Y-BLOQUEOS.md` | D | 2651 | `53bf2f857c7c33d21b8198a0c9b983c90a45a35ebd985baaf496cb3f55d8d900` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/PRUEBAS.md` | D | 3771 | `12e567e1f407be05d0f4c537bd0fb017ad264b809212ebc9cab83f2bfa76c5f9` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/README.md` | D | 1602 | `8bfe98cf28a4bc552392b1790da119d09aaf200aabffeb426e48a433796f45fa` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/SIN-ACCESO-REAL.md` | D | 3329 | `3ce12da8440f98c25a9483a271cbf503e6af636408d9157cc8da11c03e9dbd93` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/TRAZABILIDAD.md` | D | 5905 | `ea8e187d072cf17844146199ca2ca9c98dffc6988aabb27ff037521a9989ee03` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/after/PA-UI-0-ACCEPTANCE.md` | D | 24568 | `aa7fe63598146360ed4dad8a9c736491336da08f543968a25199f34ed718de30` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/after/check.mjs.txt` | D | 5319 | `9ef00251c25d1f8e0e81623b668c70dc04ed2d1bc74237251b53c3f7dccf4206` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/after/client.js.txt` | D | 100966 | `b9f37f029b47ea77cfcf20d36e2bf8f6ca19f68984d2aec53a07260b1ceab9ef` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/after/client.test.mjs.txt` | D | 24428 | `5d200cc623e1ffc7b4a736ac7bd476ded4e8e09e295922bd9206133999c2302c` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/after/package.json` | D | 1723 | `e43ff1a7a296d07c3f4648ab56e1a821adb9a1697edf9c8db4d5b2ecf665804f` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/before/PA-UI-0-ACCEPTANCE.md` | D | 22268 | `d32a4912f6b75b8b97c4b7e82790fd3067bf759a96d867265a07932ccdd547f9` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/before/check.mjs.txt` | D | 3777 | `73b0bd1f0d4422ad34ddab7fcf8cc67f1991d897b4acb83ef9d6e84da4a279f8` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/before/client.js.txt` | D | 43262 | `80c27a543333cd4afbbb892864d196459534bbe21b9535c1be11846f64056d5b` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/before/client.test.mjs.txt` | D | 2441 | `bdee5c71d86a2357ad9dfc17eb6477d468b6b25dfae5aba5e31d05cf4f566e2a` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/before/package.json` | D | 1488 | `a6447caeaa554ca7e145a71cf8d79c5a314187c3e2c9c78f83ee6626c204cf9a` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/check.txt` | D | 159 | `fd5a516b70e14a6cbf4291a576c2f3d9e50b23715aec0c50f770c4f002dd7fec` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/diffs/PA-UI-0-ACCEPTANCE.md.diff` | D | 5466 | `dee57da3d519840e3962188ac69ae6427df020b3d445be32def65da3fa9a05bb` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/diffs/check.mjs.diff` | D | 2783 | `d13daf4c5fe33aaa892998c012284eb6cdc22bf90183f25e07d520336ed06e3b` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/diffs/client.js.diff` | D | 61242 | `b0cf1737b9e04e154cc3bd52dce5f4c384bd2f4e8b54521829d5b9b5c4f6b0e6` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/diffs/client.test.mjs.diff` | D | 27028 | `0f1ab2fab230e75462faa4dcecc85cd9c0216ab8ff8d619d5d6551eda06313ff` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/diffs/package.json.diff` | D | 815 | `36a2a3073874c8e3c6bf96ed6cc986432805de96896869e2ed96b684b054bee3` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/hermetic.txt` | D | 26502 | `36f37e39580453d3a097801b56f4825690a3f6384178e677e8852b47d103d870` | sí | evidencia reproducible / benchmark |
| `eval/pa-ui-1/evidence/node-test.txt` | D | 25970 | `aad5ec459cd51ffa74bcb650b022e62f57948b63ef025ed0a16e4c6bf5a61268` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/CANDIDATE-REPORT.md` | D | 5756 | `38128d6d01a2f8aee23cc2c84e7510668b0506876e4b6b3c5af703d6f289f372` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/HASHES.txt` | D | 1902 | `dde6a8778bae4741af1f3c9b44f9a16da7f2db1ef4aee32a7c8acf618af8ec9c` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/PANEL-DATA-PATH.md` | D | 2061 | `04f3e63784664ce5de355a5d86f229eafc879aa7a7dae748d004f0b02806a448` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/PROMISE-MATRIX.md` | D | 3391 | `6c1f3f705a07e6480aec517f75e1eb81cbb81bd431f9ad8f002acfc2d9e50cef` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/SECURITY-GATES.md` | D | 2355 | `0d76a70d43ad4c281875d3d729eb496556649a6be69a999e0f7a7626fedde8c2` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/SUBAGENT-AUTHORIZATION.md` | D | 5036 | `83c360fae09876ef4d71afa81a3f1da39e599b8b44a7cd046ae5a667e5c8c58a` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/TEST-MATRIX.md` | D | 2928 | `c32e1376ece610e63d3bdd370a97e14bef9c3814c133f0d8e280a2828a37dace` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/TOOLS-ACCEPTANCE.md` | D | 2944 | `472c78c42266f4133a1ea5704c3e41b02d4f15e60f8bf20bd81a4dac00adfd02` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/hermetic.log` | D | 27424 | `85ba8d2752592c06da5374c4b245dc87bc4da1b24c1ee6525869c699a7f15c61` | no | evidencia reproducible / benchmark · EXCLUIDO: no seleccionado |
| `eval/product-readiness-01/probe-forget.mjs` | D | 2339 | `495e48efa59b8cb022551f2547d1c4b65df0e1c9797575f8d4209135dbc3c5e7` | sí | evidencia reproducible / benchmark |
| `eval/product-readiness-01/smoke-tools.log` | D | 1893 | `855478bddea0031485754bcb3528ab1303b8590a9769af33417e8d7de2743d86` | no | evidencia reproducible / benchmark · EXCLUIDO: no seleccionado |
| `eval/product-readiness-01/smoke-tools.mjs` | D | 4676 | `7f0a221707eb94832aa2fb49c3711bc05dd1fecf1fd8dae414c963cde5c47ab5` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/ACCEPTANCE-RUN.md` | D | 5184 | `a0f7fea33efa725bf7d356b36792d1294c04ffe5be3dce3edbea8658b7002cf0` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/COEXISTENCE.md` | D | 7112 | `2b1111802290c3909a98800c386289263174053f5629422fe2c782679261ab28` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/EXECUTIVE-REPORT.md` | D | 5164 | `c55ae3a49df0e11d3f00735ce6d90642347e585f6c174bcf60bfacf06ea3838c` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/HASHES.txt` | D | 3825 | `4816d0dfdccdefeedf84864a14d7eb0d99ad3f207d0d7b42490ae169d4c2ad85` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/INTEGRITY-VERIFICATION.md` | D | 2211 | `b8bc198d2531e94e7fd7a3404435feb6610ee4bc7018a768a9d94303eeadf84a` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/LAYER-VERIFICATION.md` | D | 4113 | `01eea287b4ae0799e23f8bb3d6332046dc9c99a386d2cb74027c7eebed7a0281` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/MODEL-INVOCATION.md` | D | 2183 | `314c20031e801a05d773832ea227421d707403569c6420164c62e38a88e2d32f` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/READ-ONLY-TESTS.md` | D | 3543 | `a34aba531af91de27dcf38f107a6fe525a010d07ae315929d3a776a8baec6989` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/SESSION-CONTEXT.md` | D | 1603 | `f8a6866381104cb73bc31203cc7da2b047073f15bbe20c968cc237b4a0c958fd` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/TOOL-CATALOG.md` | D | 2043 | `2f7969becbc3352177cd7b94f4c5714602d38002121997ffcdc52575f387583e` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/after.files.tsv` | D | 324 | `691012bf6e2c4cc6cea3576fbf100792a579fa63053d551b0e46bad66b3b3a6e` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/after.sha256` | D | 757 | `b494902e2b619a1599c2453685a583759a0fffcd831c909858c58ec21c7a7212` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/baseline-1423.files.tsv` | D | 481 | `df317e43d7d26b8d315197841c2a974bd9c9f3cd5d633c428c8f644544310e9e` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/baseline-1423.sha256` | D | 1027 | `504804c4db01eafdc5a17aca95d5483d927695cc4ed1cb8849f7cf9420dbcf2d` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/before-run.json` | D | 54 | `4daba99d82305ccc30448972dfafb1c8274d6d6d14daf86b3a4bebe19cfd6b21` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/before-run.sha256` | D | 1027 | `87880679f784752dce8fe9a8504795bf609a028315701c49280ea0b743e34346` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/before.files.tsv` | D | 324 | `691012bf6e2c4cc6cea3576fbf100792a579fa63053d551b0e46bad66b3b3a6e` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/before.sha256` | D | 757 | `b494902e2b619a1599c2453685a583759a0fffcd831c909858c58ec21c7a7212` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/chunks-muestra.json` | D | 623 | `2b53ce5f0052a2e0285a853bcfc7f139aab8ca87f11afd1edd643e20357a5779` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/coexistence-probe.json` | D | 3754 | `0370a7c2fa152ab44f64b52775d77b1df754f5425b31f649cc3f1c1018b6c1e5` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/coexistence-probe.mjs` | D | 3276 | `19777a83a3b1859a0d2a1623d2c612fe680813e90a6f152d752f252cab459580` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/diff.files.tsv` | D | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/diff.sha256` | D | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/inspect-proyecto.json` | D | 4116 | `0a2606784f21682e09c43d83e01366bd841936e4d7ecaaab3acf3c3471d2bbfc` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/inspect-readonly.mjs` | D | 3592 | `117255131632237ad1fbc281b730fc2446101863f1bb5ce3ad9d1333fa90cd56` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/owner-acceptance.json` | D | 14004 | `677c7ae9a05f91f3ec8a370605c7769911612efd3dbe3a6c6eaf70b5369baa79` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/owner-acceptance.mjs` | D | 2826 | `4717fd9a2487868fa1a150d4f9a3624ea12f6fada82441a85c5b0fc75880688f` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/resolve-probe-workspace.json` | D | 2200 | `b8e75b8fcd5b80f798cbd052f05ce217076a6ea247d6d1b6b2ccf166810faafb` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/resolve-probe.json` | D | 2243 | `548b499f4feac4ce132bf0d22c6030bf6af00777c3d94578b03e89e9fd1d029e` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/resolve-probe.mjs` | D | 2675 | `6d03b846a47a93e2e4f20e49b0df5087ace7641ad60b653064f1a9fd9e9c48fa` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/tool-path-plugins-dhs.json` | D | 432 | `a7b75af3439f0b3a0d6d74774da6606d026a6381ff8d0c6e68c81d3e1b397a18` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/tool-path-probe.json` | D | 2327 | `4ae628af41ce32256d86b75723682f73298f919bac2a5c843106801ee576ac74` | sí | evidencia reproducible / benchmark |
| `eval/real-host-acceptance-01/tool-path-probe.mjs` | D | 3012 | `74b1430994a392b6d305d6da42749fb5fd397ca9efbf0b48c6c7232b255adc98` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/DAILY-USE.md` | D | 2832 | `93791893e14127d3f3dd964af32dd60e1674f21ae6917a83d1b97fcc4cedb960` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/HASHES.txt` | D | 2107 | `8db25260e4011613fb7b340350f88e2e89a43cfde586736d552c00f91a1d1ec6` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/PANEL-STATE.md` | D | 1495 | `05a9e323d572334cb273e5dd83b450aa09419631014d8b08c67752438387aef8` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/RESULTS.md` | D | 6395 | `abfeebc68889b9d50d89b0522c38a83278e36ec2a6c0b2d777492cc46cc89ed4` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/SUBAGENT-PROTECTION.md` | D | 2570 | `c7e386dc230cab0aa530cc4ee215c1154b7226674fb854e16e227d425ec5523a` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/docs-b/otro-proyecto.md` | D | 66 | `0e8c775cb52d53853841763b87674f9a236f730880dc6eb67f16a1462575ee82` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/docs/borrador-temporal.md` | D | 189 | `2667514a2cbf2cf664ad2ba6296cf497caa38dc164c4a2550416b7da0ac61277` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/docs/guia-turno.md` | D | 518 | `dc1489017f63a5db640d4ae2c06729d0149b4ec5055c7f59fe3ce2e00244b066` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/docs/politica-reembolsos.md` | D | 696 | `4a4bee8f3d25da4b0dd87b7dc0fbab1c25fea23c6134f04152543304cf504e4a` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/ingest.log` | D | 1699 | `00907e337a21ee051ab9de0b3d5bb776d8f6cb16c66507ecaca1eee65eb0efd6` | no | evidencia reproducible / benchmark · EXCLUIDO: no seleccionado |
| `eval/real-world-01/isolation.log` | D | 346 | `f6f64e656f012c2468bd46015cb62b0abb80d9925ea410e1b3d3569c4e2c2dab` | no | evidencia reproducible / benchmark · EXCLUIDO: no seleccionado |
| `eval/real-world-01/isolation.mjs` | D | 2519 | `c6c9c9b44338ca279e30fefb48900eb0127a6cecbab480834cf3f3f15786034a` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/probe.mjs` | D | 1308 | `9c255b83c46b6b0b9456218981808084b097051ea86a0da34fba500df90c7d96` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/project-id.txt` | D | 31 | `18a65e84fb73bbf8f5acad81b884e81d5b2885353bae1e44bb0c1f3348f073ec` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/root.json` | D | 335 | `ee3e7c067f221e7486b8fbc89db4c5f931c8a37988a0747dcb260a43207760c6` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/run-acceptance.mjs` | D | 6738 | `0698b023a33ec510498ba2a3104d71ee4ed4e59d48667d83cec0ae969653fade` | sí | evidencia reproducible / benchmark |
| `eval/real-world-01/store/registry.sqlite3` | D | 151552 | `459e61efb83d6309c7ee00d146125b6d318ff64bb5b627d912e46e32dc8f16f0` | no | evidencia reproducible / benchmark · EXCLUIDO: no seleccionado |
| `eval/real-world-01/store/scopes/prj_01M7TMS0QVWAF5XB8H471KDEG3/rag.sqlite3` | D | 126976 | `b91a36c03d47f68a5075b6abaac9a03d5a8245d224d5847e4ea1d06efdc93262` | no | evidencia reproducible / benchmark · EXCLUIDO: no seleccionado |
| `eval/real-world-01/store/scopes/prj_01M7TMSKQ61FW6XHZ3TQK1T8W8/rag.sqlite3` | D | 126976 | `52b4199b3dc39fc6619ebb9588a967941bd423180ad64bee259cbbc9c02b419b` | no | evidencia reproducible / benchmark · EXCLUIDO: no seleccionado |
| `eval/real-world-01/verify.log` | D | 661 | `cdcae7589d79bf6e5c5e7d1a5bfb0bef0a36e36fb70c46b3ac452aa1d9b6ed0b` | no | evidencia reproducible / benchmark · EXCLUIDO: no seleccionado |
| `eval/remediation-redesign-01/ACCESSIBILITY-RESULTS.md` | D | 2518 | `b61689dee50e2c010ab9079ab7ff6e665df29bfc74a4f4cda01f70b9d094a26b` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/BEFORE-AFTER-INDEX.md` | D | 3064 | `aefc4fa5c647201e6219c10b605f30c8ef5a68df6e48393e04024ceefe9c5520` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/DEFECT-RESOLUTION-MATRIX.md` | D | 4745 | `e7d73633be3860ef4c775146f37f7638f22cf082f10c54dbd813887c13796af9` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/DESIGN-SYSTEM.md` | D | 3648 | `9b5da087b509b5e64c543cb7cf00dfdf00d161eed33ee1cd2761cd3f0a4f6f87` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/EXECUTIVE-REPORT.md` | D | 5313 | `fbfcf9af62459ed75213d4edfdfb605430e485230d8811d187b145b38586189c` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/HASHES.txt` | D | 7500 | `6bbabc00b3dc53e1f83cb71b19fe1a31f047dd604397a2cfe6f1e89dc23a3fb1` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/PHASE-A-FUNCTIONAL-RESULTS.md` | D | 5787 | `eb4e38e8e528f5e41958014ff325de5225ba7b90e250cce37287ae2ca47db86f` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/PHASE-B-VISUAL-RESULTS.md` | D | 4726 | `f1cf3682f46582d5b1e1267aef9bb17ddad4ead3899853f0478ba05b5e7eee52` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/RESPONSIVE-RESULTS.md` | D | 3198 | `f0dd6182dd62980d6f125d7ced42da9aec0198214d13092d3740c66a0f4e83ea` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/SECURITY-INVARIANTS.md` | D | 2403 | `3fb10fabd3b4e70a8c1cea50636a913d4876deead6a053a3f42cd3e751ccf920` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/TEST-RESULTS.md` | D | 2677 | `e5ad253d52ac4fce675b2d2be44c7e3323ea6a1f465660d0f4f0e08f32fafdeb` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/before/client.js.snapshot.txt` | D | 100966 | `b9f37f029b47ea77cfcf20d36e2bf8f6ca19f68984d2aec53a07260b1ceab9ef` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/before/client.test.mjs.snapshot.txt` | D | 24428 | `5d200cc623e1ffc7b4a736ac7bd476ded4e8e09e295922bd9206133999c2302c` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/logs/check.txt` | D | 159 | `fd5a516b70e14a6cbf4291a576c2f3d9e50b23715aec0c50f770c4f002dd7fec` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/logs/client.txt` | D | 3783 | `291f2ba02d4abaf0851a2b8cb58e44be47e9a0624cbde63c4c1d35a74a142c50` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/logs/hermetic.txt` | D | 27768 | `fa89b6aa6ed1ac9ed188303f28bc7977dda1339f2ed0dd611a9445413ff42259` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/logs/render.txt` | D | 787 | `c86ce27a2c4ce7b374dae76af7f2866221777129490b8c5b8f6a1c2a292fd741` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/logs/suite.txt` | D | 27277 | `18076f69b3d249e00349862a9f04331323c2ec05a199eed6b3e4f59c70a82fc6` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/connection.html` | D | 28671 | `24c9371c29748fb43b5b57975dc23039baf27e651ac89b124b21ff4d3e0696e3` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/context.html` | D | 30059 | `562ca5e5b10586ce41a642c28d903129805ad20717a023873d562673188f45fc` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/diagnostics.html` | D | 30083 | `15372021d9143f767e62ce348d851d64eea838a1439f8ed09658b915efb637d7` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/history.html` | D | 28410 | `02cd852143534ccbaabbb8ee2165d4c38eaf82c794151a399d541dd72a246976` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/libraries.html` | D | 28896 | `6d7b0d7a8e03a1fc4115e8ff30cb878f2f0a55ee1a150745af6abd4602adb1db` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/operations.html` | D | 30203 | `629874bff38905bcc0d7f3b894385fcd78dd248b189ccbaab0f030994c764c7f` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/project.html` | D | 29873 | `cbe4f75096a4d18a5a5a0795bd6a651f0d75427c7052324282e9d9c235697b08` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/search.html` | D | 31698 | `a024865c8ac7575bdaaaf6535aeff20481290e7ce528c8a1ccb653cdcf7b287f` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/source.html` | D | 29965 | `bd9cb306418632d904e5562d361acc1ffbc977227fbc9a226470431ede469875` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/preview/sources.html` | D | 48409 | `4b661c7d6d54e31659ad500d7ad005d4cd477985f318b5f6a32057d197874ff0` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/connection-1280.png` | D | 45350 | `fde62a52b2218b3266399c02e2b011f5693a21281771f124b9e7da905251fc21` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/context-1280.png` | D | 64841 | `6b68db0d579b5f93df80fee10ab08967b54f363383c88a1e0f65c776b7d8fd35` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/diagnostics-1280.png` | D | 64541 | `d2077e1a9cc3735fb0f63a68d5f3a7ba5dac0a3a27e26570266c5aac95b33e58` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/history-1280.png` | D | 41449 | `6d394ad0c487fc30cef6056a788994b792e550fc6f4d84a109a1e5dc063a0f07` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/libraries-1280.png` | D | 43594 | `9b8a6384f1ad53e34bf4ee10f409dbf45914f6155e61785e37590b30f4ab96eb` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/operations-1280.png` | D | 56077 | `32e45b4f3d909e9917616a49858f9b2b7e2310e71b9143d0858096a2a5d26d2a` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/operations-390.png` | D | 42417 | `09d90de8a5f63fe078c4306ed90705b4cd38ceac81821eda0a8f8bd946568822` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/project-1280.png` | D | 56893 | `ea9b4a05901d59dece7d450ebcdc59307ae15f193fb97bb76f3387259ddf88ae` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/project-390.png` | D | 41224 | `7de0a16262c04accc55b1c56ec54d9bcc84ae97c23302181dea8cbaaf72d92b4` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/search-1280.png` | D | 82714 | `1ad0b698776df7c61282fbde781ef2476c985f5d3640357058a517a4b6e2dbc5` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/search-390.png` | D | 43230 | `1bbcd7e7f4b34622283f18276d68421364d322ecda60062ac3e6b1b652465599` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/source-1280.png` | D | 65257 | `6d535d81b728e011aeb874ae6b0e8608ee7f9bf83efc7485fdead0de6a309243` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/sources-1280.png` | D | 87749 | `2a47a1a962813a05694ee7970e88cd836084cc2884d2d76a0fd69a072ad0f343` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-after/sources-390.png` | D | 45440 | `3ea38449610380ee1b0285090b89ce2b2a7ccf941601c02d1b29a4dc49f49204` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/01-project.png` | D | 83258 | `1534cb76027eb9eadce85e877cbf285f9106b76028bd46bb742924231482107a` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/02-libraries.png` | D | 69846 | `62889c2e249b4c2b380a1b02f39dc48b1ed6a8173c9cab8b3de4a022ffd17e2f` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/03-sources.png` | D | 115367 | `412d3add3c0a28d43d507e556252bd331497f3d27d0cf060135a6e362ac022b8` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/04-search.png` | D | 60068 | `802e84ca651e86f7a2c641fbf7b9ac7d402f2e584b5c691c9fbe4eec697f5242` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/05-context.png` | D | 61895 | `479b189ef825c521d6eed97ad6f3d401964c8053fd1acb621f84f1acef8f1fb4` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/06-operations.png` | D | 80797 | `34ced8cbc83f1bf18eeef185d75160309d456d99187309bfeb1825e1b26000c4` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/07-diagnostics.png` | D | 84678 | `fca2e1bc7af6a6f675c74cc73f9c347233227160565c8eec2693dbab6c06fabf` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/08-connection.png` | D | 67221 | `098f1f04d07145fd04235031122d9cbe5f4741e788102f52c0c7b669f444e8a9` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/09-history.png` | D | 67202 | `2b8e9d778ee1b85e928e4abc535fdbc4803839038c5eba6a50eb39437f74c774` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/screens-before/10-fleet-reference.png` | D | 194496 | `e99bdd4c76e75fc9f5d19386dbef65c224e6bc6136de0d813c91799c040f6510` | sí | evidencia reproducible / benchmark |
| `eval/remediation-redesign-01/tools/render-html.mjs` | D | 8655 | `ed605d9ceddf7553b0d4db7d8ed8772012864a1639e23d49d26dddfb1e47d029` | sí | evidencia reproducible / benchmark |
| `icon.svg` | A | 477 | `d6e80a69b3b3d2f7d579f3f98ad2d410aadc9d3c10694202de13c9eb84ad7df7` | sí | configuración/manifiesto del paquete |
| `index.js` | A | 6670 | `3f7a206f9c2bcab8857ec29790ce585eb1bfede5bd3ba26cfe1f89f68837a3cd` | sí | código fuente |
| `lib/audit-export.mjs` | A | 3315 | `067e0fdc957707c761e1f097e9a30801ae8d2958c699f188d16b29373c4c755c` | sí | código fuente |
| `lib/audit.mjs` | A | 5077 | `f553eb89958c6e2c883503f618916485338fc549c8dbee695af2c9945776c656` | sí | código fuente |
| `lib/auto-context.mjs` | A | 14115 | `963c57cfc0a124b1683b9e93e9b72ef0c35941f3940d7f3e2171d7de4580048c` | sí | código fuente |
| `lib/automation.mjs` | A | 8775 | `82658fa97d2688710ca50612e057ba8e41a7524aacc277e256ecd0a92b3d589e` | sí | código fuente |
| `lib/chunk.mjs` | A | 3625 | `3e3bd4f98429eb1d6e679544d92e65a70c2f9dd7c2369b11e42e9b168213dd28` | sí | código fuente |
| `lib/config-resolve.mjs` | A | 4760 | `145970cc821795fa45dc8829a5ba3eaf508b0971d019389c287d6811b787f2bc` | sí | código fuente |
| `lib/context.mjs` | A | 6319 | `b0168d6ee32cd9f7a23ae55a125dacf740d10a62b2fbc638432c51955673ee44` | sí | código fuente |
| `lib/conversation-events.mjs` | A | 6693 | `361af99ff4a14898ec0075859729ed55d6f8146e8f476910ee684debb8db0e96` | sí | código fuente |
| `lib/db.mjs` | A | 12279 | `d43d69d364b1541da76d601c26f377baef5dbc4191bb86b177beced6e1cc0701` | sí | código fuente |
| `lib/diagnose.mjs` | A | 9634 | `57c3dd0e4861bae8d7a636019b75c99d1ccfa365c00be28eaab399f5b58cce22` | sí | código fuente |
| `lib/discovery.mjs` | A | 16081 | `96a068e4da32558a4ca803a98128f512033ac905a84a8dceac1bf425ecbc604d` | sí | código fuente |
| `lib/doctor.mjs` | A | 4124 | `b3bc2d287d912e00da9cd8e1e47ba91691e249463c9469c5cd6eb618d0a2864e` | sí | código fuente |
| `lib/embed.mjs` | A | 4060 | `69b77d00a43aa04d3457acbb33cef9c872ef0c0dd01e6687bb18719d8564ccae` | sí | código fuente |
| `lib/embedders.mjs` | A | 4204 | `04869e2a01c8273533e94f4433e2cd409ae6d202181c9e9afce117fd64aef2a7` | sí | código fuente |
| `lib/errors.mjs` | A | 1772 | `57eb24329b44795fa8ce431454866f3f2cf77938a9205dbbb18ba81cdeca66f8` | sí | código fuente |
| `lib/exec-context.mjs` | A | 10460 | `03e14543bc3924c13293508a5187c4a6b544b2011373da48d20dc04e24c1e8df` | sí | código fuente |
| `lib/extract.mjs` | A | 10177 | `5bbcee2d516bd4d9eb2c754402f52508f8f062fd0eac0236081c4e0e4393f73d` | sí | código fuente |
| `lib/harness-workspaces.mjs` | A | 3279 | `fd3a8f761b5134899d4501ebd618698a49dbb843b15c9af1f2714e666e89818e` | sí | código fuente |
| `lib/hash.mjs` | A | 1487 | `aa0e589a6778319ec90072cab197781d9fd2452fb312e4ff36786854f4ba46a1` | sí | código fuente |
| `lib/ingest.mjs` | A | 11855 | `3b0ee00ab018a109f6c23dee422a7e7b0116805a7fe315603f0dcc4e7017bfc0` | sí | código fuente |
| `lib/inputs.mjs` | A | 2844 | `ce422a8903906f21f38c5fcd9750688ea32acbc4ad0282ba979581f513c78438` | sí | código fuente |
| `lib/library-state.mjs` | A | 10756 | `c93f17fcf42c1b9ef87bb30a16f4ce4602bc59400c9026eb761e078d7b74da71` | sí | código fuente |
| `lib/maintenance.mjs` | A | 5211 | `1516fafeaa593b3774d703bff3f6d1fdda6b5357395b3cd07a484e0ee2b39947` | sí | código fuente |
| `lib/metrics.mjs` | A | 6635 | `4fe631fe61959d0a346c8b1fbe394c62b00768c8a47436b758e6a721e6af687f` | sí | código fuente |
| `lib/migrate.mjs` | A | 15859 | `7d85fc307c41d9af62d91301501940f510bf2104814e51fd801a462b00308ab0` | sí | código fuente |
| `lib/operations.mjs` | A | 6294 | `6dab0ba150f2444c4e7b3d9c63327260383670919bc0ef137127ff0bcbcfaed5` | sí | código fuente |
| `lib/paths.mjs` | A | 17155 | `4ba5ad5ce93b238f101f2e71603986732ea1a34aa11787b649bad8dde47873d0` | sí | código fuente |
| `lib/policy.mjs` | A | 6160 | `c333e0e4b807cf537f441c578903a890f264cb83dadff2787b0d46e306daa271` | sí | código fuente |
| `lib/profile.mjs` | A | 5647 | `5227ba8cfc55e319f1fd5db70f5d715d6bd61b45531b81284448ea2bdfef4a09` | sí | código fuente |
| `lib/readmodel.mjs` | A | 6243 | `1f89912fe04da2ef372ff012cbd964e97a80fd227e16ea796eda21ebbf1ef5c9` | sí | código fuente |
| `lib/recovery.mjs` | A | 23793 | `0901387b9b0113f6cfbbed94cf998cd899db1d761d9c3e9603daceb4ade11496` | sí | código fuente |
| `lib/registry-schema.mjs` | A | 7865 | `5c9185380f4f0132f25d88b50326cbaa61e427247269793ab6557b94bbc403c3` | sí | código fuente |
| `lib/registry.mjs` | A | 14649 | `3bce7530e9a78c1df4979a1cd1a295be0a23f58545c7fe1b327c03f991ec7713` | sí | código fuente |
| `lib/resolve.mjs` | A | 12482 | `4ec92b48b2a56cc17ee63017993e0f0327ce52873f05fdd3d1d5b633c801016c` | sí | código fuente |
| `lib/retention.mjs` | A | 6344 | `df2b3bf1c70965c606418818ff28aec64ded05bc5c24fbe67154b96d6b1be843` | sí | código fuente |
| `lib/revocation.mjs` | A | 5944 | `6de9d46aef1f6d0b486063aca6c323997f0f522cce1758e73a536484e3713190` | sí | código fuente |
| `lib/roots-structure.mjs` | A | 8685 | `0f3edc4d20d8ea19d60c7d9a95eec5ae985b482c77df37a8dcd09daf0265dd8b` | sí | código fuente |
| `lib/schema.mjs` | A | 5696 | `5d805e65df2a0605e3793051834bfc52202293f75da542c09dd31c6d510192e4` | sí | código fuente |
| `lib/scope-ops.mjs` | A | 14337 | `00fba8596920a249a6b4ecdea7ba3d5b5abe9a0549625699d694bdce95ac9168` | sí | código fuente |
| `lib/scope-stores.mjs` | A | 5425 | `c7240f82d5f26f55c9dc81e15e7e89c3083013f336443c615ed2616d89a3cc4f` | sí | código fuente |
| `lib/search.mjs` | A | 14122 | `5e974fc64e67adc5eaf117921aa316b20bab98337d66fb9ee50250c47e7ce267` | sí | código fuente |
| `lib/server.mjs` | A | 18112 | `d0ec19a0cd4a34eec7fdbe97ff1996182f4a22b473ebb568c4556438f06fef71` | sí | código fuente |
| `lib/session-identity.mjs` | A | 2140 | `c6b5b11475628802ee81d8d86f695179723944e5132f98bb1c5e32e86daaae3b` | sí | código fuente |
| `lib/sessions.mjs` | A | 14044 | `f770ec230373e94b2b22cbbab1755f00715171c2a83fc291b3530c592a99279b` | sí | código fuente |
| `lib/sync-scheduler.mjs` | A | 14219 | `a9bcb667394f50578bfeb7a5c161aafe3eb133167e7e14656b6a872240b1f202` | sí | código fuente |
| `lib/sync.mjs` | A | 38477 | `2cabd7cc832d79a8a7faf08363c88c8f88fe22c878ea0a51195696d91665c859` | sí | código fuente |
| `lib/tags.mjs` | A | 1364 | `55c94d1641880dab082eea4e2b85ba8a40d7e061205bf3088a83753d8a3ccaf5` | sí | código fuente |
| `lib/tools.mjs` | A | 15198 | `2a3ac69b97a1f61f6c992e576e0a3e38c222eeb8434641012ce0a49e2c32fca6` | sí | código fuente |
| `lib/trusted-roots.mjs` | A | 5690 | `b4ec26c1974a250136d1f87574254f720613df72285b828800233b0cbb50b04a` | sí | código fuente |
| `lib/worker-context.mjs` | A | 1202 | `1b6458e75526ea2d823e7b49fb747046836b8525ffb1f69e304c149a4a09615e` | sí | código fuente |
| `package.json` | A | 1723 | `e43ff1a7a296d07c3f4648ab56e1a821adb9a1697edf9c8db4d5b2ecf665804f` | sí | configuración/manifiesto del paquete |
| `tests/adapter.test.mjs` | B | 2341 | `cd090ab6575e663964281fe9e959619e131bc4c052f2c66f2ee6b3089ef60257` | sí | pruebas |
| `tests/atomicity.test.mjs` | B | 2924 | `0d510f489185755a6241760754e8d06b4e87fcbaf9eb4c2ea951e9a7ddfa29ba` | sí | pruebas |
| `tests/audit-export.test.mjs` | B | 3104 | `4374c5455fdeb8a38fa501c7981b08d781308ff1c1707cbcdbdcc1a631f0fde9` | sí | pruebas |
| `tests/auto-context.test.mjs` | B | 9693 | `7cf3cef7805e88b947c47d53d918190d3ab0d6edcd6772a4255a9ade9a68c232` | sí | pruebas |
| `tests/automation.test.mjs` | B | 4234 | `73a5d910584945bc8d6afcbfb86e87dc05ae617c423db891ccfe8a129db83a27` | sí | pruebas |
| `tests/backoff.test.mjs` | B | 8438 | `4c1d1bd13b6180326a934ae73172527293a525586c745304a8500f48e5949b2b` | sí | pruebas |
| `tests/budget-exhaustion.test.mjs` | B | 10776 | `f33bbeff68c08776bb4d13970f997f4c80d4edc203ce3ef28babf0ac9baf252b` | sí | pruebas |
| `tests/cli-registry.test.mjs` | B | 4085 | `190ca8e2ed9073ca2795d134e146d4df54f2ee76aa06fc43daed13fd38d61749` | sí | pruebas |
| `tests/client.test.mjs` | B | 34998 | `445cdb526305b8c607663de7e94febe0b144a203d528b5903f4a5cda82339861` | sí | pruebas |
| `tests/concurrency.test.mjs` | B | 15936 | `6f6d0f441df5f278d6a68c1716a8baa9214887f79e190155e6e3b9273e1edf44` | sí | pruebas |
| `tests/config-consumers.test.mjs` | B | 4189 | `8064b9b7b531a4b14d336aaee99842fbbe9001dc1d31e8e4e73f6c9d091343ce` | sí | pruebas |
| `tests/config-resolve.test.mjs` | B | 4772 | `69becf3da1f523a5cd2b89e08352f297fb2203bddda68c9b6a899ca9d3c3798a` | sí | pruebas |
| `tests/context-lossless.test.mjs` | B | 1717 | `54f6f6bd31c750dabe9ac759c553cdbb76cd34d2c632448eee592074ac864762` | sí | pruebas |
| `tests/conversation-events-edge.test.mjs` | B | 3162 | `32d95097ade3d42a4b079e73899b2e971700a5f75f555d0489a8bb74a6ab7c33` | sí | pruebas |
| `tests/conversation-events.test.mjs` | B | 3453 | `7d0822a595e620b2873776c472263571bc6377313dc8c43bdfd50c1773d002c6` | sí | pruebas |
| `tests/diagnose.test.mjs` | B | 5644 | `d5f5a50b1a81f2eacfb9408893d105128462bfc5657534a6ec7b5ae1dc1432cc` | sí | pruebas |
| `tests/discovery.test.mjs` | B | 17348 | `38d524d63bffa2997ad22a88eed55de1184f0a345e235c80f84cfe1f4dec203b` | sí | pruebas |
| `tests/doctor.test.mjs` | B | 2844 | `0d97691b2d17e000c75ba94dfda22e00f2f14e2e2efbecbf585da1fd880222b7` | sí | pruebas |
| `tests/efficiency.test.mjs` | B | 3323 | `18f45b1ac1b07a45ecf3e01862336e068699bc065bf88e67f52510760018c9cb` | sí | pruebas |
| `tests/embed.test.mjs` | B | 2509 | `83d3658ac3bd8ee61a5887eac61a708377c65dca4a5cb9e831c84825f0791fb7` | sí | pruebas |
| `tests/harness-projects.test.mjs` | B | 8858 | `dd684755fdef66e0deed0b112bc5de4e5741f0b853fa768873a5d466c79d1330` | sí | pruebas |
| `tests/helpers.mjs` | B | 2322 | `e6d8a6887d04d1410b1ae8e2da11f950bb3ac131044f8337f9d7d99b747af580` | sí | pruebas |
| `tests/host-adapter.test.mjs` | B | 10972 | `0ff5295e7f6dc31bf3c4ff408a6549b046d73dc60214f2d591158e51455a576d` | sí | pruebas |
| `tests/ingest.test.mjs` | B | 7626 | `89f10ed62172e1fbbb9b9b842dba5670b4e9c49ae31b3ee14403afba0824ba17` | sí | pruebas |
| `tests/integration.test.mjs` | B | 13993 | `d0e13e85ed1438ba138445d3a0d344e96c2b281dc6dfdaa16fbd2ffd87848f05` | sí | pruebas |
| `tests/library-state.test.mjs` | B | 8634 | `ce794383173d08700d4a8afd4dca1f11c442f123ddcff74d20acb0597df1fc8a` | sí | pruebas |
| `tests/metrics.test.mjs` | B | 2337 | `937704b761272744e5193f1c59e9014f628a95ae73ab5a323ff7222937bbb9a2` | sí | pruebas |
| `tests/migrate.test.mjs` | B | 8326 | `53964a05d4d97bdf7bc78dfacaeeec1a55e8f2e63342fb147a784dfb5a267ebd` | sí | pruebas |
| `tests/pa3-acceptance.test.mjs` | B | 12789 | `7564c0465dc73ed83692841c18fbac9e181b8b3e799ea9d229ca22cf61512dc9` | sí | pruebas |
| `tests/pa3-helpers.mjs` | B | 6288 | `ffc99e6e209c99be35f68d211221f975acf8d182afd37ffee610b07a500ececf` | sí | pruebas |
| `tests/pa4-helpers.mjs` | B | 7562 | `fa37fdeab7a3f3bef4258765afabbb5618d17fbab6794c420c8b4294c32d425c` | sí | pruebas |
| `tests/partial-results.test.mjs` | B | 14093 | `6044907ce902b6f150b3561590e8262538297d7aa81b89c0787d09727be2de4d` | sí | pruebas |
| `tests/paths.test.mjs` | B | 4144 | `1149357c44042a276781c210e46b2fe8006a4a4a8bf4bc342dbb40353a63a526` | sí | pruebas |
| `tests/policy.test.mjs` | B | 4100 | `c05511c3846a9494a5d3a17b71ae4f5c476aa7cb69e34e9e41f355dd047bf4d2` | sí | pruebas |
| `tests/profile-identity.test.mjs` | B | 2899 | `7edb0e774d6cd6f936200ae07f2ec9e25883a47770857f1d16c25b954735b0ae` | sí | pruebas |
| `tests/recovery.test.mjs` | B | 13144 | `6df888a3ef6a6898ffe3cb8c0de56b0ec3d35ef567e5f8aa0fa3576157f11e3e` | sí | pruebas |
| `tests/registry.test.mjs` | B | 6357 | `a204c6b0f1f444bfe2b916de60c06a4ac3fad472557a72f5404e041d17461472` | sí | pruebas |
| `tests/retention.test.mjs` | B | 6444 | `9c5780cec54a2c72c3ec0376b345a1013df571fbe5d865f1a6c67dba0a19901d` | sí | pruebas |
| `tests/revocation.test.mjs` | B | 11930 | `4b908e99ef8fea9c7b1b5e231bc38205bb5d7c8be081f7d771ae8b4fb10210f5` | sí | pruebas |
| `tests/roots-structure.test.mjs` | B | 8350 | `a866e883beee2ce447281a45cd80df2e3dea92a147ee851d11f2121106ff2a23` | sí | pruebas |
| `tests/schema.test.mjs` | B | 6635 | `0251a0831812bbf9f8b5678751bffd9b535ea3d5162d0908417369e0d53f4007` | sí | pruebas |
| `tests/search-diversity.test.mjs` | B | 20392 | `98b5f6d8681c1250b3a75b2066542a35b3316b3c496bd7159cf30711ef178389` | sí | pruebas |
| `tests/search.test.mjs` | B | 4455 | `4520b767b294f4a1786f13d7a7e6ed96051588abf4b599f5aa0c516f4b33348f` | sí | pruebas |
| `tests/sensitive-names.test.mjs` | B | 2152 | `4d73dbecd369d72f77f943c5ff4038fd234f52507de7bd55f0339d2e7b13f78f` | sí | pruebas |
| `tests/server.test.mjs` | B | 6283 | `8c7921b06026c85a84ba0e1e68af69b21179be2e0624edde63aa9bb8a60e814f` | sí | pruebas |
| `tests/sessions.test.mjs` | B | 18477 | `55e925166edd2f507f6fa76f240b97c793a78d3d85c3190092eb40d12dfe24f4` | sí | pruebas |
| `tests/standalone.test.mjs` | B | 3378 | `62adab2781ac1e6fed2a9180fb0fa17ec335dae67016524535705559b416da5d` | sí | pruebas |
| `tests/sync-scheduler.test.mjs` | B | 9584 | `c6e22ffbd1da5223ee580877c21dda701c5c49be92f41b954f5b2532d91e7d71` | sí | pruebas |
| `tests/sync.test.mjs` | B | 29257 | `777bc297112250e21f7d70ab1fbfc48c5ac46ac8d211333d9101ec02a9d36501` | sí | pruebas |
| `tests/text.test.mjs` | B | 4361 | `cb9f11b5009765abab361e41c0e94072a75240f82ddc4dcad27042d8a507d44b` | sí | pruebas |
| `tests/tool-golden.test.mjs` | B | 3418 | `9aa641bd840a2fac750fe74d5f3df54f76eb95b00a80e0a2dce5f72e04fc5b19` | sí | pruebas |
| `tests/worker-context.test.mjs` | B | 4149 | `67f6f81f66f22cc480baf552d0f020e97d3a7ac95079e2c039c51af15e959b67` | sí | pruebas |
| `tools/benchmark.mjs` | A | 7889 | `5d81f946f8797c88843eeda3d9f724c87cd9258d42b0ba39ceb25df4c5a90772` | sí | código fuente |
| `tools/check.mjs` | A | 5319 | `9ef00251c25d1f8e0e81623b668c70dc04ed2d1bc74237251b53c3f7dccf4206` | sí | código fuente |
| `tools/harness.mjs` | A | 11501 | `2723dd68c22e372c3e2b0d73aa9c049ab1d6789c9bc338371065c2a8ba614359` | sí | código fuente |
| `tools/hermetic.mjs` | A | 2221 | `4213e48c2f1a0922dda430ceb1fc819141b82959e5a8c218148c64a6472d6368` | sí | código fuente |
| `tools/screenshots.mjs` | A | 2708 | `2d9856e57cfb4b897e1b467705700823dadda70c4d8a9bac463f56c7101b6fc6` | sí | código fuente |

**Incluidos: 404** · **Excluidos: 9** (5 logs y 4 ficheros de almacenes locales, ignorados).

su propio SHA-256 no puede figurar aquí; se entrega en el informe de la misión.
