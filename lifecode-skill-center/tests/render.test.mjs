/**
 * Render de componentes del panel sin navegador.
 *
 * El panel sólo se probaba por estructura (que el texto existe). Eso deja pasar un fallo de ejecución
 * —una variable que no está en el ámbito, un dato con otra forma— que en la ventana se ve como un slot
 * congelado y aquí se ve como una excepción con nombre. Este fichero extrae el componente de `client.js`
 * y lo ejecuta con dobles mínimos de sus ayudantes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

/** Extrae `function name(...) { ... }` contando llaves, para no cortar en una función anidada. */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `no encuentro ${name} en client.js`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  let index = open;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        index += 1;
        break;
      }
    }
  }
  return source.slice(start, index);
}

const e = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
const stub = (name) => (props, ...children) => ({ type: name, props: props ?? {}, children: children.flat(Infinity) });
const t = (key, vars) => `${key}${vars ? JSON.stringify(vars) : ''}`;

const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Recorre el árbol y devuelve la fuente de sus manejadores. `JSON.stringify` no serializa funciones,
 * así que buscar `act(` en el JSON era una tautología: siempre pasaba aunque la sección llamara a la API.
 */
function handlerSource(tree) {
  const parts = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    for (const value of Object.values(node.props ?? {})) if (typeof value === 'function') parts.push(String(value));
    (node.children ?? []).forEach(visit);
  };
  visit(tree);
  return parts.join('\n');
}

/**
 * Texto visible del árbol (sólo cadenas hijas). Se usa para afirmar sobre el mensaje real que
 * recibe `t(...)` sin depender del escapado de comillas de `JSON.stringify`.
 */
function renderText(tree) {
  const parts = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node === 'string' || typeof node === 'number') return parts.push(String(node));
    if (node === null || typeof node !== 'object') return;
    (node.children ?? []).forEach(visit);
  };
  visit(tree);
  return parts.join('\n');
}
function instantiate(name, extra) {
  const body = extract(name);
  const helpers = {
    e,
    Pill: stub('Pill'),
    Section: stub('Section'),
    Empty: stub('Empty'),
    Kpi: stub('Kpi'),
    ActivityChart: stub('ActivityChart'),
    InsightsSection: stub('InsightsSection'),
    KnowledgeSection: stub('KnowledgeSection'),
    AdoptionSection: stub('AdoptionSection'),
    DoctorSection: stub('DoctorSection'),
    MigrationSection: stub('MigrationSection'),
    asArray,
    text: (value) => (value === null || value === undefined ? '' : String(value)),
    backupLabel: () => 'copia',
    shortSha: (value) => String(value ?? '').slice(0, 8),
    formatBytes: (value) => `${value} B`,
    skillsOf: (snapshot) => (Array.isArray(snapshot?.skills) ? snapshot.skills : []),
    findSkill: () => null,
    t,
    lang: 'es',
    ...extra,
  };
  const names = Object.keys(helpers);
  const factory = new Function(...names, `${body}\nreturn ${name};`);
  return factory(...names.map((key) => helpers[key]));
}

const knowledge = {
  ok: true,
  policy: { mode: 'guarded-autonomous', projects: { 'proyecto-b': { mode: 'human-approved' } } },
  modes: ['human-approved', 'guarded-autonomous'],
  summary: { total: 1, pending: 1, mode: 'guarded-autonomous', decisions: 0 },
  insights: [{ insightId: 'x', title: 't', confidence: 'strong', state: 'received', projectId: 'proyecto-b' }],
  decisions: [{ decisionId: 'd1', operation: 'activate', outcome: 'allow', at: '2026-11-09T00:00:00.000Z', actor: 'ai' }],
  contradictions: [],
};

const projects = [{ id: 'plugins-dhs-7e085aaa', name: 'plugins-dhs' }, { id: 'proyecto-b', name: 'proyecto-b' }];

test('la bandeja de conocimiento se puede ejecutar y pinta la política de cada proyecto', () => {
  const KnowledgeSection = instantiate('KnowledgeSection', {});
  const calls = [];
  const tree = KnowledgeSection({ t, knowledge, projects, onPolicy: (id, mode) => calls.push([id, mode]) });

  const flat = JSON.stringify(tree);
  assert.ok(flat.includes('analytics.knowledge.policy'), 'la sección nombra la política por proyecto');
  assert.ok(flat.includes('guarded-autonomous'), 'muestra el modo vigente');
  assert.ok(flat.includes('proyecto-b'), 'lista los proyectos');
  assert.ok(!handlerSource(tree).includes('act('), 'la sección no habla con la API: delega en onPolicy');

  // Los botones existen y llaman al manejador con el proyecto y el modo que corresponde.
  const buttons = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === 'object') {
      if (node.type === 'button') buttons.push(node);
      (node.children ?? []).forEach(walk);
    }
  };
  walk(tree);
  assert.ok(buttons.length >= 2, 'hay al menos un botón por proyecto');
  const clickable = buttons.find((button) => button.props.onClick && button.props.disabled === false);
  assert.ok(clickable, 'al menos un botón está habilitado (el modo contrario al vigente)');
  clickable.props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'plugins-dhs-7e085aaa');
});

test('las dos pestañas de analítica se ejecutan sin lanzar con una foto realista', () => {
  const snapshot = {
    readable: true,
    apiVersion: '1',
    schemaVersion: 2,
    storePath: 'C:/temp/center.json',
    storeExists: true,
    backup: { status: 'verified', sha256: 'af017e36aa11', generation: 'g-1', size: 33882, createdAt: '2026-11-09T00:00:00.000Z' },
    projects,
    skills: [{ id: 's1', title: 'Demo', currentVersion: '1.0.0', enabledIn: ['plugins-dhs-7e085aaa'], quality: { score: 100 } }],
    knowledge,
    analytics: { loads: 3, quality: { average: 100, measured: 7 }, improvements: { proposed: 0 } },
    insights: {
      eventTypes: ['skill.created'],
      events: { matched: 2, byType: { 'skill.created': 1 } },
      window: { from: '2026-11-01', to: '2026-11-09', days: 14 },
      series: [], topSkills: [], pinsBehind: [], projects: [], qualityPerVersion: [],
      references: { totals: {}, changes: [] }, skills: [], leastUsed: [], definitions: {},
    },
  };

  const AnalyticsView = instantiate('AnalyticsView', {});
  assert.doesNotThrow(() => AnalyticsView({
    t,
    lang: 'es',
    snapshot,
    onMigrate: () => {},
    migrationBusy: '',
    migrationResult: null,
    filters: { project: '', days: 14, from: '', to: '', skill: '', type: '', status: '', version: '' },
    onFilters: () => {},
    onOpen: () => {},
    doctor: null,
    doctorError: '',
    doctorBusy: '',
    onDoctor: () => {},
    onResync: () => {},
    onExport: () => {},
    onPolicy: () => {},
  }), 'AnalyticsView tiene que ejecutarse con la foto del servidor');

  // Con un centro ilegible se pinta el aviso, no se revienta.
  const KnowledgeSection = instantiate('KnowledgeSection', {});
  assert.doesNotThrow(() => KnowledgeSection({ t, knowledge: { ok: false, integrity: { status: 'unreadable' } }, projects, onPolicy: () => {} }));
});

test('el bloque de aplicaciones se ejecuta y separa lo entregado de lo declarado', () => {
  const InsightsSection = instantiate('InsightsSection', {});
  const insights = {
    pinsBehind: [], projects: [], qualityPerVersion: [], skills: [], leastUsed: [],
    references: { totals: {}, changes: [] },
    applications: { total: 2, bySkill: [{ skillId: 'comprobar-despliegue', title: 'Comprobar despliegue', declarations: 2 }] },
    deliveries: { total: 5, withoutDeclaration: 3 },
    definitions: { applications: { definition: 'Declaraciones explícitas de que alguien aplicó la skill.', limits: 'Es una declaración.' } },
  };
  const tree = InsightsSection({ t, insights, onOpen: () => {} });
  const flat = JSON.stringify(tree);
  assert.ok(flat.includes('analytics.applications'), 'la sección existe');
  assert.ok(flat.includes('analytics.applications.withoutDeclaration'), 'nombra la brecha entre entrega y uso');
  // Anclado al dato: el texto sin escapar del árbol lleva el valor que trae la foto.
  const unescaped = (value) => JSON.stringify(value).replaceAll('\\"', '"');
  assert.ok(unescaped(tree).includes('withoutDeclaration{"n":"3"}'), 'pinta el 3 que trae la foto');
  assert.ok(!unescaped(tree).includes('withoutDeclaration{"n":"7"}'), 'no adelanta un valor que la foto no trae');
  const withSeven = InsightsSection({ t, insights: { ...insights, deliveries: { ...insights.deliveries, withoutDeclaration: 7 } }, onOpen: () => {} });
  assert.ok(unescaped(withSeven).includes('withoutDeclaration{"n":"7"}'), 'el contador viene de la foto');
  assert.ok(!unescaped(withSeven).includes('withoutDeclaration{"n":"3"}'), 'con otra foto ya no aparece el 3 anterior');
  assert.ok(flat.includes('comprobar-despliegue'), 'lista la skill que se declaró');
  assert.ok(!handlerSource(tree).includes('act('), 'no habla con la API');

  // Sin datos no inventa: cero declaraciones y cero entregas se muestran tal cual.
  const empty = InsightsSection({ t, insights: { applications: { total: 0, bySkill: [] }, deliveries: { total: 0, withoutDeclaration: 0 }, definitions: {} }, onOpen: () => {} });
  assert.ok(JSON.stringify(empty).includes('analytics.applications'), 'también renderiza vacío');
});

test('el bloque de reversiones de pin se ejecuta y dice cuándo fue la última', () => {
  const InsightsSection = instantiate('InsightsSection', {});
  const insights = {
    pinsBehind: [], projects: [], qualityPerVersion: [], skills: [], leastUsed: [],
    references: { totals: {}, changes: [] },
    applications: { total: 0, bySkill: [] },
    deliveries: { total: 0, withoutDeclaration: 0 },
    rollbacks: {
      total: 2,
      latestAt: '2026-11-05T14:00:00.000Z',
      bySkill: [{ skillId: 'revisar-plugin', title: 'Revisar plugin', count: 2 }],
    },
    definitions: { rollbacks: { definition: 'Reversiones de pin registradas en el diario.', limits: 'Cuenta reversiones, no éxitos.' } },
  };
  const tree = InsightsSection({ t, insights, onOpen: () => {} });
  const flat = JSON.stringify(tree);
  assert.ok(flat.includes('analytics.rollbacks'), 'la sección existe');
  assert.ok(flat.includes('analytics.rollbacks.latest'), 'dice cuándo fue la última');
  assert.ok(flat.includes('2026-11-05T14:00:00.000Z'), 'la fecha viene del servidor, no se inventa');
  assert.ok(flat.includes('revisar-plugin'), 'lista la skill revertida');
  assert.ok(!handlerSource(tree).includes('act('), 'la sección no habla con la API');

  const empty = InsightsSection({ t, insights: { applications: { total: 0, bySkill: [] }, deliveries: { total: 0, withoutDeclaration: 0 }, rollbacks: { total: 0, latestAt: '', bySkill: [] }, definitions: {} }, onOpen: () => {} });
  assert.ok(JSON.stringify(empty).includes('analytics.rollbacks.empty'), 'sin reversiones muestra su vacío');
});

test('el gráfico lleva a los eventos y la lista responde al rango', () => {
  const ActivityChart = instantiate('ActivityChart', {
    SERIES: [
      { key: 'created', color: '#7c5cff', labelKey: 'activity.legend.created' },
      { key: 'assigned', color: '#22d3ee', labelKey: 'activity.legend.assigned' },
      { key: 'versions', color: '#22c55e', labelKey: 'activity.legend.versions' },
      { key: 'loads', color: '#94a3b8', labelKey: 'activity.legend.loads' },
    ],
    formatDayLabel: (day) => String(day),
  });
  const picked = [];
  const series = [
    { day: '2026-11-04', created: 2, assigned: 1, versions: 0, loads: 0, improvements: 0 },
    { day: '2026-11-05', created: 0, assigned: 0, versions: 1, loads: 2, improvements: 0 },
  ];
  const tree = ActivityChart({ t, lang: 'es', series, onPick: (day) => picked.push(day) });
  const flat = JSON.stringify(tree);
  assert.ok(flat.includes('activity.pick'), 'el título dice que se puede pulsar');
  assert.ok(flat.includes('2026-11-04'), 'el día viaja en el nodo');

  // Los nodos con onClick viven en el árbol, no en su JSON: se busca el grupo del primer día y se
  // ejecuta su manejador, que es lo que de verdad hace la navegación.
  // Se recorre el árbol entero: los nodos con manejador están anidados dentro del <svg> y no en una
  // lista plana, así que buscar en un nivel concreto es la forma de escribir una prueba frágil.
  const conManejador = [];
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    const props = node.props ?? {};
    if (typeof props.onClick === 'function') conManejador.push(props);
    // El doble de `e` guarda los hijos en `node.children`, no en `props.children`.
    walk(node.children);
  };
  walk(tree);
  assert.equal(conManejador.length, 2, 'los dos días con actividad deben ser pulsables');
  assert.equal(typeof conManejador[0].onClick, 'function');
  conManejador[0].onClick();
  assert.deepEqual(picked, ['2026-11-04'], 'pulsar el día lo entrega a onPick');

  const InsightsSection = instantiate('InsightsSection', {});
  const insights = {
    pinsBehind: [], projects: [], qualityPerVersion: [], skills: [], leastUsed: [],
    references: { totals: {}, changes: [] },
    applications: { total: 0, bySkill: [] },
    deliveries: { total: 0, withoutDeclaration: 0 },
    rollbacks: { total: 0, latestAt: '', bySkill: [] },
    events: { recent: [{ id: 'e1', at: '2026-11-05T10:00:00.000Z', type: 'skill.loaded', actor: 'system', skillId: 'x', status: 'other', result: 'ok' }], truncated: false },
    definitions: {},
  };
  const section = JSON.stringify(InsightsSection({ t, insights, onOpen: () => {} }));
  assert.ok(section.includes('analytics.events'), 'la sección de eventos existe');
  assert.ok(section.includes('skill.loaded'), 'muestra el evento del rango');
  assert.ok(!handlerSource(InsightsSection({ t, insights, onOpen: () => {} })).includes('act('), 'la sección no habla con la API');
});

test('la bandeja declara la procedencia, deja verificar el origen y dice si el asiento se ejecutó', () => {
  const KnowledgeSection = instantiate('KnowledgeSection', {});
  const verified = [];
  const knowledgeMixed = {
    ok: true,
    policy: { mode: 'guarded-autonomous', projects: {} },
    summary: { pending: 2, mode: 'guarded-autonomous' },
    insights: [
      {
        insightId: 'declarado',
        title: 'hallazgo declarado',
        confidence: 'strong',
        state: 'received',
        origin: { declared: { sourceAgent: 'agente-x' }, verified: false },
      },
      {
        insightId: 'verificado',
        title: 'hallazgo verificado',
        confidence: 'moderate',
        state: 'validated',
        origin: { declared: { sourceAgent: 'agente-y' }, verified: true, verifiedBy: 'subagents.listChildren' },
        actedOn: { operation: 'create-or-improve-skill' },
      },
    ],
    decisions: [
      { decisionId: 'd-ok', outcome: 'activate', actor: 'ai', at: '2026-11-09T00:00:00.000Z', evidenceLevel: 'strong', settled: { ok: true, detail: 'ok' } },
      { decisionId: 'd-fail', outcome: 'rollback', actor: 'ai', at: '2026-11-09T00:00:00.000Z', settled: { ok: false, detail: 'no-previous-version' } },
      { decisionId: 'd-pending', outcome: 'publish', actor: 'ai', at: '2026-11-09T00:00:00.000Z' },
    ],
    contradictions: [],
  };

  const tree = KnowledgeSection({ t, knowledge: knowledgeMixed, projects, onPolicy: () => {}, onVerifyOrigin: (id) => verified.push(id) });
  const flat = JSON.stringify(tree);

  assert.ok(flat.includes('analytics.knowledge.origin.declared'), 'un origen sin prueba del Host se declara');
  assert.ok(flat.includes('analytics.knowledge.origin.verified'), 'un origen verificado se distingue');
  assert.ok(flat.includes('analytics.knowledge.settled.ok'), 'el asiento ejecutado se ve');
  assert.ok(flat.includes('analytics.knowledge.settled.failed'), 'el asiento fallido se ve con su motivo');
  assert.ok(flat.includes('analytics.knowledge.settled.pending'), 'un asiento sin resultado no se disfraza de ejecutado');

  // Sólo el hallazgo declarado ofrece verificarse, y la sección delega: no habla con la API.
  const buttons = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === 'object') {
      if (node.type === 'button') buttons.push(node);
      (node.children ?? []).forEach(walk);
    }
  };
  walk(tree);
  const verify = buttons.filter((button) => button.props.onClick && button.children?.[0] === 'analytics.knowledge.origin.verify');
  assert.equal(verify.length, 1, 'sólo lo no verificado se puede verificar');
  verify[0].props.onClick();
  assert.deepEqual(verified, ['declarado']);
  assert.ok(!handlerSource(tree).includes('fetch('), 'la sección no pide nada al Host: delega en el panel');
});

test('el panel pide la verificación de origen por la ruta del Host y recarga la foto', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.ok(source.includes('const onVerifyOrigin = useCallback'), 'el panel tiene el manejador');
  assert.ok(source.includes('API + "/origin-verify"'), 'llama a la ruta del Host, no a una inventada');
  assert.ok((source.match(/onExport, onPolicy, onVerifyOrigin \}/gu) ?? []).length >= 2, 'lo pasa a las pestañas de analítica');
  assert.ok(source.includes('await load({});'), 'recarga la foto después de verificar');
});


test('las decisiones autorizadas sin resultado se ven y no se borran', () => {
  const KnowledgeSection = instantiate('KnowledgeSection', {});
  const withPending = KnowledgeSection({
    t,
    knowledge: { ...knowledge, pendingSettlements: [{ decisionId: 'dec-pendiente', operation: 'activate', projectId: 'proyecto-b', ageMs: 42_000 }] },
    projects,
    onPolicy: () => {},
  });
  const flat = JSON.stringify(withPending);
  assert.ok(flat.includes('analytics.knowledge.pendingSettlements'), 'el bloque tiene título');
  assert.ok(flat.includes('dec-pendiente'), 'nombra la decisión pendiente');
  assert.ok(flat.includes('hace 42 s'), 'muestra la antigüedad para que se pueda priorizar');

  const none = KnowledgeSection({ t, knowledge: { ...knowledge, pendingSettlements: [] }, projects, onPolicy: () => {} });
  assert.ok(JSON.stringify(none).includes('analytics.knowledge.pendingSettlements.empty'), 'sin pendientes lo dice');
  assert.ok(!JSON.stringify(none).includes('dec-pendiente'));
});

test('el bloque de aplicaciones se ejecuta y separa lo entregado de lo declarado', () => {
  const InsightsSection = instantiate('InsightsSection', {});
  const insights = {
    pinsBehind: [], projects: [], qualityPerVersion: [], skills: [], leastUsed: [],
    references: { totals: {}, changes: [] },
    applications: { total: 2, bySkill: [{ skillId: 'comprobar-despliegue', title: 'Comprobar despliegue', declarations: 2 }] },
    deliveries: { total: 5, withoutDeclaration: 3 },
    definitions: { applications: { definition: 'Declaraciones explícitas de que alguien aplicó la skill.', limits: 'Es una declaración.' } },
  };
  const tree = InsightsSection({ t, insights, onOpen: () => {} });
  const flat = JSON.stringify(tree);
  assert.ok(flat.includes('analytics.applications'), 'la sección existe');
  assert.ok(
    renderText(tree).includes('analytics.applications.withoutDeclaration{"n":"3"}'),
    'cuenta las entregas sin declaración',
  );
  assert.ok(flat.includes('comprobar-despliegue'), 'lista la skill que se declaró');
  assert.ok(!handlerSource(tree).includes('/api/'), 'no habla con la API');

  // Sin datos no inventa: cero declaraciones y cero entregas se muestran tal cual.
  const empty = InsightsSection({ t, insights: { applications: { total: 0, bySkill: [] }, deliveries: { total: 0, withoutDeclaration: 0 }, definitions: {} }, onOpen: () => {} });
  assert.ok(JSON.stringify(empty).includes('analytics.applications'), 'también renderiza vacío');
});
