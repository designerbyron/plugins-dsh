/**
 * Comprobaciones que no son pruebas de comportamiento pero que, si fallan, rompen la instalación.
 *
 * Existe porque el plugin se instala por ruta absoluta en un perfil real: un `exports` que apunta a un
 * fichero que no está, o un `cordis.patch.yml` con otro nombre, falla al montar el perfil y no aquí.
 * `npm run check` lo ejecuta; `npm test` no depende de él para no mezclar dos responsabilidades.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const problems = [];
const checks = [];

function ok(condition, message) {
  checks.push({ condition, message });
  if (!condition) problems.push(message);
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

ok(manifest.name === '@local/lifecode-skill-center', `el nombre del paquete es ${manifest.name}`);
ok(manifest.type === 'module', 'el paquete tiene que ser ESM');
ok(manifest.exports?.['.'] === './index.js', 'exports["."] tiene que ser ./index.js');
ok(manifest.exports?.['./client'] === './client.js', 'exports["./client"] tiene que ser ./client.js');
ok(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch tiene que apuntar al parche');
ok(manifest.dsh?.client?.platform === 'web', 'el cliente es de plataforma web');
ok(
  manifest.peerDependencies?.['@deepseek-ai/dsh-tools'] !== undefined,
  'el adaptador necesita dsh-tools como peer (el Host lo provee en runtime)',
);
ok(
  manifest.devDependencies?.['@deepseek-ai/dsh-tools'] !== undefined,
  'dsh-tools tiene que estar en devDependencies para poder probar el adaptador',
);
ok(manifest.dependencies?.['@deepseek-ai/dsh-tools'] === undefined, 'dsh-tools no puede ser dependencia física: rompe la identidad de clases con el Host');
ok(manifest.engines?.dsh !== undefined, 'el paquete declara el rango de Harness soportado (engines.dsh)');
ok(Array.isArray(manifest.files) && manifest.files.includes('cordis.patch.yml'), 'files whitelist incluye el parche del bundle');
ok(manifest.files?.includes('client.js') && manifest.files?.includes('lib'), 'files whitelist incluye cliente y núcleo');

for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
  ok(existsSync(join(root, file)), `falta ${file}`);
}

const patch = existsSync(join(root, 'cordis.patch.yml')) ? readFileSync(join(root, 'cordis.patch.yml'), 'utf8') : '';
ok(/-\s*insert:/.test(patch), 'el parche tiene que insertar el plugin');
ok(patch.includes(manifest.name), 'el parche tiene que nombrar el paquete');
ok(/id:\s*lifecode-skill-center/.test(patch), 'el parche necesita un id estable');

/** El núcleo puro no puede depender del harness: por eso se puede probar antes de instalar. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(path);
  }
  return out;
}

for (const file of walk(join(root, 'lib'))) {
  const source = readFileSync(file, 'utf8');
  const name = relative(root, file);
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    ok(specifier.startsWith('./') || specifier.startsWith('node:'), `${name} importa «${specifier}», y el núcleo sólo puede importar node: o relativos`);
  }
  ok(!source.includes('@deepseek-ai/'), `${name} nombra un paquete del harness`);
}

const client = readFileSync(join(root, 'client.js'), 'utf8');
for (const match of client.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
  ok(match[1] === 'react', `client.js requiere «${match[1]}»; sólo puede requerir react`);
}
ok(!client.includes('@deepseek-ai/'), 'client.js no puede nombrar paquetes del harness');
ok(client.includes('window.__ModuleLoader__.load'), 'client.js tiene que registrarse con el cargador de módulos');

// Que cada fichero se pueda al menos parsear: un error de sintaxis en el cliente sólo se vería al abrir el panel.
for (const file of [...walk(join(root, 'lib')), join(root, 'index.js'), join(root, 'client.js'), ...walk(join(root, 'tests')), ...walk(join(root, 'tools'))]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  ok(result.status === 0, `${relative(root, file)} no parsea: ${(result.stderr ?? '').split('\n')[0]}`);
}

// Indicadores: la ruta existe, el recorte de fechas no se invierte y una biblioteca vacía no inventa cifras.
const distributeSource = readFileSync(join(root, 'lib', 'distribute.mjs'), 'utf8');
const similaritySource = readFileSync(join(root, 'lib', 'similarity.mjs'), 'utf8');
const knowledgeSource = readFileSync(join(root, 'lib', 'knowledge.mjs'), 'utf8');
const decisionsSource = readFileSync(join(root, 'lib', 'decisions.mjs'), 'utf8');


const uiSource = readFileSync(join(root, 'client.js'), 'utf8');

// La distribución tiene que verse en el panel: importar desde la biblioteca y exportar desde el cajón,
// siempre por las acciones del panel (nunca con fetch a mano, que se saltaría el actor humano).
ok(/function ImportSection\(\{ t, onImport \}\)/.test(uiSource), 'la biblioteca del panel ofrece importar un paquete');
ok(/e\(ImportSection, \{ t, onImport \}\)/.test(uiSource), 'la biblioteca usa la sección de importar');
ok(/onImport: onImportBundle/.test(uiSource), 'el panel pasa el manejador de importar a la biblioteca');
ok(!/function ImportSection[\s\S]{0,1600}?act\(/.test(uiSource), 'importar no habla con la API dentro de la sección');
ok(uiSource.includes("act('import-bundle'"), 'el panel cablea la acción import-bundle');
ok(/onExport: onExportBundle/.test(uiSource), 'el cajón ofrece exportar y recibe el manejador');
ok(uiSource.includes("act('export-skill'"), 'el panel cablea la acción export-skill');
ok(uiSource.includes("'drawer.export.done'"), 'exportar dice dónde quedó el paquete');
ok(uiSource.includes("'library.import.renamed'") || uiSource.includes('renamed'), 'importar avisa cuando renombra por id ocupado');
const apiSource = readFileSync(join(root, 'lib', 'api.mjs'), 'utf8');

// Criterio 2: el elector «skill nueva o mejora» vive en el motor de decisiones, no en la interfaz.
ok(decisionsSource.includes('export function chooseOperation'), 'el motor de decisiones elige entre skill nueva y mejora');
ok(decisionsSource.includes("operation: 'create-skill'") && decisionsSource.includes("operation: 'improve-skill'"), 'el elector nombra las dos operaciones');
ok(apiSource.includes("name === 'plan'"), 'la API expone el plan de operación');
ok(/name === 'plan'[\s\S]{0,700}?chooseOperation\(/.test(apiSource), 'la acción plan usa el elector');
ok(!/name === 'plan'[\s\S]{0,700}?withState\(/.test(apiSource), 'el plan no escribe nada');

// Criterio 13: crear desde un hallazgo enlaza la procedencia y mueve el hallazgo a triaje.
ok(apiSource.includes('const fromInsight = (result)'), 'crear desde un hallazgo tiene un enlace explícito');
  ok(/fromInsight[\s\S]{0,2000}?triageInsight\(/.test(apiSource), 'el enlace mueve el hallazgo por sus transiciones');
  ok(/insight-action-not-done/.test(knowledgeSource), 'acted-on exige una accion con resultado correcto');
  ok(/insight-requires-decision/.test(knowledgeSource), 'acted-on exige una decision registrada');
  ok(/export function recordOriginVerification/.test(knowledgeSource), 'la verificacion de origen es una operacion del nucleo');
  ok(/verified: false/.test(apiSource), 'el origen entra declarado, no verificado');
  ok(/origin-verify/.test(readFileSync(join(root, 'index.js'), 'utf8')), 'el Host expone la ruta de verificacion de origen');

  // La verificación de origen no puede depender de `currentInitiator()`: en un handler HTTP devuelve
  // `null` (medido en vivo como 503) y el hallazgo se queda declarado para siempre.
  const originSource = readFileSync(join(root, 'index.js'), 'utf8');
  const originBody = originSource.slice(originSource.indexOf('async function originVerifyOutcome('), originSource.indexOf('export const name'));
  ok(originBody.length > 0 && !/currentInitiator/u.test(originBody), 'la verificacion de origen no usa currentInitiator (en un handler HTTP es nulo)');
  ok(/agents\.list\?\./.test(originSource) || /agents\.list\(\)/u.test(originSource), 'la verificacion de origen pregunta por las sesiones que el Host conoce');
  ok(/originVerifyOutcome\(\{ ctx, root,/u.test(originSource), 'la verificacion de origen recibe la raiz del centro y se puede probar sobre un almacen temporal');

  // Aprendizaje entre proyectos: el paquete declara lo que no es portable, y el panel lo dice.
  ok(/export function privateReferences/u.test(distributeSource), 'distribucion publica privateReferences (rutas absolutas)');
  ok(/portable: notPortable\.length === 0/u.test(distributeSource), 'el paquete y la importacion publican si son portables');
  ok(/Array\.isArray\(result\.warnings\)/u.test(uiSource), 'el panel avisa cuando el paquete lleva referencias no portables');
  ok(/result\?\.origin\?\.verified === true/u.test(uiSource), 'el panel lee origin.verified, que es lo que publica el servidor');
  ok(/subagents\.listChildren/.test(readFileSync(join(root, 'index.js'), 'utf8')), 'la verificacion usa el catalogo real de subagentes');
  ok(existsSync(join(root, 'tools', 'e2e-autonomous.mjs')), 'existe el E2E autonomo separado del humano')
  {
    const e2e = readFileSync(join(root, 'tools', 'e2e-autonomous.mjs'), 'utf8');
    const steps = (e2e.match(/step\(/g) ?? []).length;
    ok(steps >= 26, `el E2E autonomo conserva al menos 26 pasos (tiene ${steps})`);
    ok(/acted-on no se cierra con una acción fallida/u.test(e2e), 'el E2E cubre el cierre con accion fallida');
    ok(/una persona fija la política del proyecto/u.test(e2e), 'el E2E cubre que una persona fija la politica');
    ok(/la copia nace sin asignaciones/u.test(e2e), 'el E2E cubre la importacion aislada sin asignaciones');
  }
ok(apiSource.includes('insightLink'), 'la respuesta de crear dice si el hallazgo quedó enlazado');
ok(knowledgeSource.includes('appliedSkillId'), 'el hallazgo guarda la skill aplicada');
ok(!/fromInsight[\s\S]{0,600}?state: 'acted-on'/.test(apiSource), 'crear no se declara «acted-on» sin decisión del ledger');
const insightsSource = readFileSync(join(root, 'lib', 'insights.mjs'), 'utf8');
const toolsSource = readFileSync(join(root, 'lib', 'tools.mjs'), 'utf8');
ok(apiSource.includes("from './insights.mjs'"), 'api.mjs tiene que usar el módulo de indicadores');
ok(apiSource.includes("route === 'insights'"), 'la API tiene que exponer la ruta de indicadores');
const insightsModule = await import(pathToFileURL(join(root, 'lib', 'insights.mjs')).href);
const reversed = insightsModule.parseFilters({ from: '2026-02-02', to: '2026-02-01' }, { now: '2026-02-03T00:00:00.000Z' });
ok(reversed.from === '2026-02-01' && reversed.to === '2026-02-02', `un rango con las fechas al revés se ordena: ${reversed.from}..${reversed.to}`);
const emptyInsights = insightsModule.buildInsights(
  { skills: {}, projects: {}, assignments: {}, events: [], improvements: {} },
  { now: '2026-02-03T00:00:00.000Z', filters: insightsModule.parseFilters({}, { now: '2026-02-03T00:00:00.000Z' }) },
);
ok(emptyInsights.ok === true && emptyInsights.window.days === 14, 'un centro vacío devuelve indicadores vacíos, no una excepción');
ok(Array.isArray(emptyInsights.pinsBehind) && emptyInsights.pinsBehind.length === 0, 'sin asignaciones no hay pins atrasados');
ok(emptyInsights.qualityPerVersion.length === 0 && emptyInsights.improvements.approvalRate === null, 'sin datos no se inventa una tasa de aprobación');

// Conocimiento: su registro vive aparte, la IA reporta pero no decide, y la interfaz no firma decisiones.
ok(apiSource.includes("from './knowledge.mjs'"), 'api.mjs tiene que usar el registro de conocimiento');
ok(apiSource.includes("route === 'knowledge'"), 'la API tiene que exponer la ruta del conocimiento');
ok(apiSource.includes("name === 'insight'"), 'la API tiene que aceptar hallazgos por la acción insight');
ok(apiSource.includes('export function knowledgeView'), 'la foto del conocimiento tiene que ser una función del núcleo');
ok(toolsSource.includes("name: 'lifecode_skill_insight'"), 'existe la herramienta de reportar hallazgos');
ok(!/name: 'lifecode_skill_insight'[\s\S]{0,4000}?(approve|activate|publish)\s*\(/i.test(toolsSource.split("name: 'lifecode_skill_insight'")[1] ?? ''), 'la herramienta de hallazgos no puede aprobar ni activar nada');
const knowledgeModule = await import(pathToFileURL(join(root, 'lib', 'knowledge.mjs')).href);
const emptyKnowledge = knowledgeModule.emptyKnowledge('2026-02-03T00:00:00.000Z');
const emptySummary = knowledgeModule.knowledgeSummary(emptyKnowledge);
ok(emptySummary.total === 0 && emptySummary.pending === 0, 'un registro vacío no inventa hallazgos');
ok(emptySummary.mode === knowledgeModule.DEFAULT_POLICY_MODE, `el modo por defecto es guarded-autonomous: ${emptySummary.mode}`);
const humanPolicy = knowledgeModule.setPolicy(emptyKnowledge, { mode: 'human-approved', actor: 'ai' });
ok(humanPolicy.ok === false, 'la IA no puede cambiarse la política a sí misma');
const humanPolicyOk = knowledgeModule.setPolicy(emptyKnowledge, { mode: 'human-approved', actor: 'human' });
ok(humanPolicyOk.ok === true && humanPolicyOk.mode === 'human-approved' && emptyKnowledge.policy.mode === 'human-approved', 'una persona sí puede devolver el modo a human-approved');
ok(knowledgeModule.DEFAULT_POLICY_MODE === 'human-approved', 'sin concesión de una persona, el defecto es human-approved (§6)');
ok(knowledgeModule.policyFor(knowledgeModule.emptyKnowledge('2026-02-03T00:00:00.000Z'), 'proyecto').source === 'default', 'un registro sin política declara que el modo viene del defecto, no de una concesión');
const decisionsText = readFileSync(join(root, 'lib', 'decisions.mjs'), 'utf8');
ok(decisionsText.includes("policy.mode === 'guarded-autonomous' && policy.source !== 'default'"), 'la autonomía exige un modo concedido explícitamente, no el defecto');
ok(decisionsText.includes('const preparesOnly = rule.minLevel === \'weak\';'), 'preparar (create/improve) no exige concesión: no cambia lo que ejecuta ningún proyecto');

// Política de autonomía: la fija una persona, la IA decide dentro de ella y el cambio no toca el centro.
ok(apiSource.includes("name === 'policy'"), 'la API tiene que aceptar cambios de política por la acción policy');
ok(apiSource.includes('setPolicy') && apiSource.includes('POLICY_MODES'), 'api.mjs tiene que usar la puerta de política del registro');
ok(/name === 'policy'[\s\S]{0,700}?actor !== 'human'/.test(apiSource), 'la acción policy tiene que exigir actor humano antes de escribir');
ok(/name === 'policy'[\s\S]{0,1200}?policy-mode-unknown/.test(apiSource), 'un modo de política desconocido se rechaza con su código');
ok(apiSource.includes('modes: POLICY_MODES'), 'la vista del conocimiento publica los modos válidos');
const clientSource = readFileSync(join(root, 'client.js'), 'utf8');
ok(clientSource.includes("act('policy', { projectId: String(projectId ?? ''), mode: String(mode ?? '') })"), 'el panel pide el cambio de política a su API');
ok(clientSource.includes('analytics.knowledge.policy.hint'), 'la interfaz explica que la política la fija una persona');
ok(!/function KnowledgeSection\([\s\S]{0,9000}?act\('(approve|publish|toggle|activate)'/.test(clientSource), 'la bandeja de conocimiento no ejecuta decisiones');

// Evidencia de aplicación (§6): se declara con nota; la brecha con las entregas se cuenta, no se estima.
ok(insightsSource.includes("'skill.applied'"), 'el diario admite el evento de aplicación declarada');
ok(apiSource.includes("case 'declare-application':"), 'la API tiene que aceptar declaraciones de aplicación');
ok(/case 'declare-application':[\s\S]{0,900}?note-required/.test(apiSource), 'una declaración sin nota se rechaza con su código');
ok(insightsSource.includes('withoutDeclaration'), 'los indicadores publican entregas sin declaración');
ok(insightsSource.includes('declarationsBySkill') && insightsSource.includes('applications'), 'las aplicaciones se cuentan por skill');
ok(insightsSource.includes("skill.applied") && /applications:\s*\{/.test(insightsSource), 'la definición de aplicaciones está publicada con el resultado');
ok(clientSource.includes('analytics.applications.withoutDeclaration'), 'el panel muestra la brecha entre entrega y uso');
ok(clientSource.includes("applications.total === 0") && clientSource.includes("t('analytics.applications.empty')"), 'sin datos el panel lo dice en vez de inventar cifras');

// Contrato de descubrimiento (§7): a petición, una lectura por petición, y la foto que se refresca no lo toca.
ok(apiSource.includes('workspaceItems'), 'el inventario reutiliza la lectura del registro en vez de listar dos veces');
ok(/identityInventory\(\{ state, registry, workspaceItems = null \}\)/.test(apiSource), 'identityInventory acepta la lectura ya hecha');
ok(apiSource.includes('identity: identityPayload({ root, registry, workspaceItems: items })'), 'la vista de identidad recibe las filas ya listadas');
ok(clientSource.includes("API}/workspaces") || clientSource.includes('/workspaces'), 'el panel pide el inventario por su ruta cuando se abre la pestaña');
ok(!/setInterval\([^)]{0,200}workspaces/.test(clientSource), 'el inventario no se refresca con un temporizador: sería sondeo del registro del Host');


// Flujo de creación por IA (§9): reintentar no duplica, y una skill nueva avisa de sus parecidas.
ok(apiSource.includes('idempotent: true'), 'la creación idempotente se declara en la respuesta, no se finge');
ok(/retryRequest[\s\S]{0,600}?status === 'fulfilled'/.test(apiSource), 'el reintento comprueba que la petición ya está cumplida antes de crear');
ok(similaritySource.includes('export function similarSkills'), 'la biblioteca se consulta para detectar duplicados probables');
ok(apiSource.includes('duplicates') && similaritySource.includes('reasons.push'), 'el aviso de duplicado explica la razón en vez de sólo señalar');
ok(toolsSource.includes('duplicates'), 'la herramienta de creación publica los duplicados que ve el agente');
ok(toolsSource.includes('already-created'), 'el reintento se informa como ya creado, no como una creación nueva');
// Handoff (§3): la sesión que produjo el hallazgo se saca del Host, no del payload del emisor.
ok(toolsSource.includes('export function sessionOf'), 'la sesión del hallazgo se obtiene del Host, no se inventa');
ok(/sessionOf\(exec\)[\s\S]{0,400}?sessionId/.test(toolsSource), 'la herramienta de hallazgos envía la sesión del Host al centro');

// Distribución (§8): paquete portable, copia aislada y constancia de que el original no se toca.
ok(apiSource.includes("from './distribute.mjs'"), 'la API usa el módulo de distribución en vez de copiar código');
ok(apiSource.includes("name === 'export-skill'"), 'existe la acción de exportar una skill');
ok(apiSource.includes("name === 'import-bundle'"), 'existe la acción de importar un paquete');
ok(/export-skill[\s\S]{0,700}?actor !== 'human'/.test(apiSource), 'exportar lo pide una persona, no la IA sola');
ok(/import-bundle[\s\S]{0,900}?actor !== 'human'/.test(apiSource), 'importar lo pide una persona: añade contenido a la biblioteca');
ok(/import-bundle[\s\S]{0,1200}?withState\(root/.test(apiSource), 'la importación escribe con el candado y la copia del resto de actos');
ok(distributeSource.includes("BUNDLE_SCHEMA = 'lifecode-skill-center/skill-bundle'"), 'el paquete declara su esquema, no es un JSON suelto');
ok(distributeSource.includes('checksum-mismatch'), 'un paquete manipulado se rechaza por su huella');
ok(distributeSource.includes("flag: 'wx'") && distributeSource.includes('bundle-exists'), 'exportar no reescribe un artefacto ya distribuido');
ok(distributeSource.includes('-copia'), 'importar con id ocupado renombra en vez de sobrescribir');
ok(/importBundle\(current\.state/.test(apiSource) === false, 'la importación no se hace sobre el estado leído fuera del candado');

ok(/rollbacks: \{[\s\S]{0,400}?source: 'events:skill\.rollback'/.test(insightsSource), 'las reversiones de pin declaran de qué evento salen');
ok(insightsSource.includes('rollbacksBySkill'), 'las reversiones se cuentan por skill, no en un total suelto');
ok(uiSource.includes("analytics.rollbacks.empty"), 'el panel dice cuando no hay reversiones, sin inventar cifras');
ok(uiSource.includes('toast.duplicates') && uiSource.includes('asArray(result.duplicates)'), 'la biblioteca avisa de parecidos al crear');
ok(/lsc-rollbacks|analytics\.rollbacks/.test(uiSource) && uiSource.includes('analytics.rollbacks.latest'), 'la reversión dice cuándo fue la última');

ok(/export function eventStatus/.test(insightsSource) && /export function eventResult/.test(insightsSource), 'estado y resultado se derivan en el núcleo, no en la vista');
ok(/eventStatus\(event\) !== applied\.status/.test(insightsSource), 'el filtro de estado usa la misma regla que publica la lista');
ok(/eventResult\(event\) !== applied\.result/.test(insightsSource), 'el filtro de resultado usa la misma regla que publica la lista');
ok(insightsSource.includes('options: { statuses: EVENT_STATUSES, results: EVENT_RESULTS }'), 'el servidor publica las opciones de los filtros, no las inventa el panel');
ok(uiSource.includes("analytics.filter.anyStatus") && uiSource.includes("analytics.filter.anyResult"), 'el panel ofrece estado y resultado');
ok(uiSource.includes('onPickDay') && /onPick: onPickDay/.test(uiSource), 'el gráfico lleva a los eventos por el filtro del servidor');
ok(uiSource.includes("t('analytics.events')") && uiSource.includes("analytics.events.empty"), 'la lista de eventos del rango tiene título y vacío');


// RT-D3: un asiento autorizado tiene que cerrarse con lo que de verdad pasó.
ok(/export function settleDecision\(document, \{ decisionId, ok, detail/.test(knowledgeSource), "el conocimiento sabe cerrar un asiento");
ok(/settled: isPlainObject\(raw\.settled\)/.test(knowledgeSource), "la normalización conserva el resultado del asiento");
ok((apiSource.match(/settleGate\(root, gate,/gu) ?? []).length >= 7, "las siete ramas autónomas cierran su asiento");
ok(knowledgeSource.includes("decision-settled"), "el cierre del asiento queda en el diario");

// RT-D5: la IA opera sobre el proyecto de su carpeta, no sobre el que diga el payload.
ok(/function bindAiProject\(state, data, cwd, actor\)/.test(apiSource), "existe la ligadura de proyecto para la IA");
ok((apiSource.match(/bindAiProject\(state, data, cwd, actor\)/gu) ?? []).length >= 3, "toggle, reversión y avance pasan por la ligadura");
ok(/projectId: String\(bound\.projectId/.test(apiSource), "la compuerta usa el proyecto ligado, no el del payload");
ok(apiSource.includes("project-mismatch"), "un proyecto ajeno se rechaza en vez de aceptarse");

// La bandeja enseña procedencia, resultado del asiento y permite verificar el origen.
ok(uiSource.includes("analytics.knowledge.origin.verified") && uiSource.includes("analytics.knowledge.origin.declared"), "el panel distingue origen verificado de declarado");
ok(uiSource.includes("analytics.knowledge.settled.ok") && uiSource.includes("analytics.knowledge.settled.failed"), "el panel enseña si el asiento se ejecutó o falló");
ok(uiSource.includes("const onVerifyOrigin = useCallback") && uiSource.includes("API + \"/origin-verify\""), "verificar el origen pasa por la ruta del Host");
ok((uiSource.match(/onExport, onPolicy, onVerifyOrigin \}/gu) ?? []).length >= 2, "las pestañas de analítica reciben el manejador");
ok(knowledgeSource.includes("export function unsettledDecisions"), "RT-D3: la recuperación se puede reconstruir desde el almacén");
ok(apiSource.includes("pendingSettlements: unsettledDecisions(document)"), "RT-D3: la vista publica los asientos sin resultado");
ok(uiSource.includes("analytics.knowledge.pendingSettlements"), "RT-D3: el panel los enseña para poder recuperarlos");
// Ronda 14: procedencia de la política, recuperación del asiento y ataques de autonomía.
const provenanceSource = readFileSync(join(root, 'tests', 'policy-provenance.test.mjs'), 'utf8');
const attacksSource = readFileSync(join(root, 'tests', 'autonomy-attacks.test.mjs'), 'utf8');
const recoverySource = readFileSync(join(root, 'tests', 'settlement-recovery.test.mjs'), 'utf8');
ok(knowledgeSource.includes('legacy-unverified'), "la procedencia de la política se clasifica (procedencia de la política)");
ok(/granted\s*=\s*\{\s*at/u.test(knowledgeSource), "una concesión global deja comprobante con fecha y autor");
ok(knowledgeSource.includes('storedMode'), "el valor histórico se conserva aunque no conceda autonomía");
ok(apiSource.includes('legacyUnverified') && apiSource.includes('provenance'), "la vista publica la procedencia para poder avisar");
ok(decisionsSource.includes('autonomyGranted'), "la autonomía exige una concesión no heredada");
ok(provenanceSource.includes('legacy-unverified') && /granted[,:]\s*true/u.test(provenanceSource), "las pruebas cubren histórico y concesión explícita");
ok(recoverySource.includes('settled-conflict'), "RT-D3: un asiento no se reescribe con otro resultado");
ok(attacksSource.includes('no se concede política') && attacksSource.includes('project-mismatch'), "las pruebas de ataque cubren política y proyecto ajeno");
ok(attacksSource.includes('authorized: true'), "las pruebas de ataque cubren autorización inyectada en el payload");

const passed = checks.filter((check) => check.condition).length;
for (const problem of problems) process.stderr.write(`✖ ${problem}\n`);
process.stdout.write(`\n${passed}/${checks.length} comprobaciones · ${problems.length === 0 ? 'todo en orden' : `${problems.length} problema(s)`}\n`);
process.exit(problems.length === 0 ? 0 : 1);
