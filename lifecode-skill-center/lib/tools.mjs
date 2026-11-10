/**
 * Las herramientas del agente. Objetos planos (sin harness), que `index.js` pasa por `defineTool`.
 *
 * Cuatro, y ninguna puede aprobar ni activar nada:
 *   - buscar: ¿esto ya existe en esta máquina, y dónde?
 *   - crear: redactar una skill nueva en la biblioteca (publicada, no activa).
 *   - mejorar: proponer una versión nueva de una skill viva (espera decisión humana).
 *   - estado: qué está encendido en este proyecto y qué espera decisión.
 *
 * La asimetría es el producto: el modelo investiga, redacta y propone; la persona decide qué se enciende
 * y qué se publica. Por eso no hay herramienta de aprobar ni de activar.
 */

import { centerRoot, runAction } from './api.mjs';

/** La ruta de la sesión es el único ámbito válido: el modelo no lo declara. */
export function scopeOf(exec) {
  return exec?.agent?.session?.header?.cwd;
}

/**
 * La sesión que ejecuta la herramienta, sacada del Host (no del payload).
 * Sin esto, un hallazgo entregado por un subagente llega sin sesión declarada y su origen
 * nunca se puede contrastar con `subagents.listChildren`: el handoff queda sin verificar para siempre.
 */
export function sessionOf(exec) {
  const session = exec?.agent?.session;
  const header = session?.header ?? {};
  const id = header.id ?? session?.id ?? session?.sessionId ?? '';
  const parentId = header.parentSessionId ?? header.parent ?? session?.parentSessionId ?? '';
  return { sessionId: typeof id === 'string' ? id : String(id ?? ''), parentRunId: typeof parentId === 'string' ? parentId : String(parentId ?? '') };
}

/** Un objeto abierto: los campos que devuelve cada herramienta están declarados abajo, uno a uno, en su resumen. */
const OUTPUT = { type: 'object', additionalProperties: true };
const render = (_args, value) => [{ type: 'text', text: String(value?.summary ?? '') }];

/** Una referencia declarada como lista `{path, content}` → el mapa que guarda el documento. */
function referencesToMap(references) {
  const out = {};
  for (const entry of Array.isArray(references) ? references : []) {
    if (typeof entry?.path === 'string' && typeof entry?.content === 'string') out[entry.path] = entry.content;
  }
  return out;
}

function findingsOf(result) {
  const list = result?.findings ?? result?.evaluation?.findings ?? [];
  return list
    .filter((finding) => finding?.code !== undefined || finding?.message !== undefined)
    .map((finding) => `${finding.severity ?? 'info'}: ${finding.message ?? finding.code}`);
}

/** Un almacén ilegible no es «no hay nada»: la herramienta tiene que decirlo con esas palabras. */
function unreadableSummary(result, action) {
  const integrity = result?.integrity ?? {};
  return `the center cannot be read (${integrity.status ?? 'unknown'}${integrity.size === undefined ? '' : `, ${integrity.size} bytes`}${integrity.sha256 === undefined || integrity.sha256 === null ? '' : `, sha256 ${integrity.sha256}`}): ${action} was NOT done and the damaged file was left untouched. A person has to restore it from the panel.`;
}

function isUnreadable(result) {
  return result?.code === 'store-unreadable';
}

/**
 * T42: forma pública de la actividad en el `tool/result`. Se construye con las 9 claves exactas que el
 * cliente lee del stream de sesión (`eventId`, `type`, `category`, `severity`, `titleKey`, `titleVars`,
 * `persisted`, `replayed`, `at`) y se omite si la mutación no dejó evento (idempotente o bloqueada).
 * `persisted` sólo es true si la transacción escribió de verdad; un replay nunca se anuncia como hecho.
 */
function activityOf(result) {
  const projection = result?.activity;
  if (projection === null || projection === undefined || typeof projection !== 'object') return null;
  return {
    eventId: projection.eventId ?? null,
    type: projection.type ?? null,
    category: projection.category ?? null,
    severity: projection.severity ?? null,
    titleKey: projection.titleKey ?? null,
    titleVars: projection.titleVars ?? {},
    persisted: projection.persisted === true && result?.replayed !== true,
    replayed: result?.replayed === true,
    at: projection.at ?? null,
  };
}

/**
 * T50: metadata de presentación que el Host persiste con el `tool/result` y proyecta en vivo y en replay
 * (`output.presentationMeta`). Es la MISMA proyección de 9 claves, pero viaja como `meta.activity`: el
 * cliente la lee de ahí (`data.meta.activity`) para el aviso global, sin depender del texto del modelo.
 * Pura por contrato: sólo mira el valor ya producido, sin E/S, para poder recalcularse al reproducir.
 */
function presentationMetaOf(value) {
  return { activity: activityOf(value) };
}

function describeMatches(matches, totals) {
  if (matches.length === 0) return `no related skill found (${totals.library} in the library, ${totals.external} installed elsewhere): this is new ground`;
  const inLibrary = matches.filter((match) => match.kind === 'library').length;
  const elsewhere = matches.length - inLibrary;
  return `found ${matches.length} related skill(s): ${inLibrary} in the library, ${elsewhere} already installed on this machine`;
}

/** `lifecode_skill_search` — antes de crear, buscar. */
export function lifecodeSkillSearch({ root = centerRoot() } = {}) {
  return {
    name: 'lifecode_skill_search',
    description: 'Search the LifeCode Skill Center library AND the skills already installed on this machine (user library, the previous compiler, the project .dsh/skills) before creating anything. Use it when the task looks like something this machine already knows how to do, and when you are about to name a new skill: an identical or prefixed id is the strongest signal. A match means "update that one" (lifecode_skill_improve) instead of adding a duplicate.',
    parameters: {
      query: { type: 'string', required: true, description: 'What the skill would be about: the situation, the trap, the tool, the exact values. Free text, matched against id, description, whenToUse and tags.' },
      id: { type: 'string', description: 'Optional kebab-case id you were about to use. Same or prefixed id outranks any lexical coincidence.' },
    },
    output: { schema: OUTPUT, render },
    execute(args, exec) {
      const result = runAction({ root, action: 'detect', payload: { text: args.query, id: args.id }, actor: 'ai', cwd: scopeOf(exec) });
      if (isUnreadable(result)) return { status: 'unreadable', summary: unreadableSummary(result, 'the search'), matches: [], integrity: result.integrity };
      if (!result.ok) return { status: 'failed', summary: result.message ?? 'the search could not run', matches: [] };
      const totals = { library: result.libraryTotal ?? 0, external: result.externalTotal ?? 0 };
      const matches = (result.matches ?? []).slice(0, 8).map((match) => ({
        id: match.id,
        score: match.score,
        why: match.why,
        kind: match.kind,
        where: match.kind === 'library' ? 'library' : match.path,
        description: match.description,
        version: match.version,
      }));
      return { status: matches.length === 0 ? 'empty' : 'found', summary: describeMatches(matches, totals), matches, totals };
    },
  };
}

/** `lifecode_skill_create` — redactar una skill nueva. */
export function lifecodeSkillCreate({ root = centerRoot(), evidence = null } = {}) {
  // El cuerpo síncrono se conserva: las pruebas y los usos sin Host no pagan una promesa. Sólo cuando el
  // adaptador ofrece la medición (evidencia real de inventario y colisiones) el `execute` devuelve promesa.
  function create(args, exec, measured) {
    const result = runAction({
      root,
      actor: 'ai',
      cwd: scopeOf(exec),
      action: 'create',
      payload: {
        id: args.id,
        title: args.title,
        description: args.description,
        whenToUse: args.whenToUse,
        body: args.body,
        tags: args.tags,
        references: referencesToMap(args.references),
      },
      inventory: measured?.inventory ?? null,
      collisions: measured?.collisions ?? null,
      hostSources: measured?.hostSources ?? null,
    });
    if (isUnreadable(result)) return { status: 'unreadable', summary: unreadableSummary(result, 'the creation'), integrity: result.integrity };
    if (!result.ok) {
      return { status: result.code === 'exists' ? 'exists' : 'failed', summary: result.message ?? 'the skill was not created', findings: findingsOf(result) };
    }
    const quality = result.evaluation?.score;
    // Si la creación responde a una petición de una persona, se enlaza en el mismo acto: sin esto el
    // panel seguiría mostrando la petición como pendiente aunque la skill ya exista.
    const requestId = typeof args.requestId === 'string' ? args.requestId.trim() : '';
    let fulfilled = null;
    if (requestId !== '') {
      const linked = runAction({ root, actor: 'ai', cwd: scopeOf(exec), action: 'request-fulfill', payload: { requestId, skillId: result.id } });
      fulfilled = linked.ok === true ? requestId : { requestId, error: linked.code ?? 'not-linked', message: linked.message ?? '' };
    }
    // Aviso de duplicados: no bloquea (una variante puede ser legítima), pero el agente tiene que verlo
    // antes de seguir publicando cosas parecidas. El id sirve para proponer una mejora en su lugar.
    const duplicates = Array.isArray(result.duplicates) ? result.duplicates : [];
    const idempotent = result.idempotent === true;
    const duplicateLine = duplicates.length === 0
      ? ''
      : ` Possible duplicates in the library: ${duplicates.map((entry) => `${entry.id} (${entry.reasons.join('; ')})`).join(', ')}.`;
    return {
      status: idempotent ? 'already-created' : 'published',
      id: result.id,
      version: result.version?.version ?? (idempotent ? String(result.skill?.currentVersion ?? '') : '1.0.0'),
      quality,
      request: fulfilled,
      duplicates: duplicates.map((entry) => entry.id),
      idempotent,
      activity: activityOf(result),
      summary: idempotent
        ? `"${result.id}" already existed for that request: nothing new was created, the library still has one copy.`
        : `created "${result.id}" v${result.version?.version ?? '1.0.0'} (quality ${quality ?? '?'}/100). It is in the library and NOT active in any project: the person enables it per project in the panel.${fulfilled === null ? '' : typeof fulfilled === 'string' ? ` It answers the person's request ${fulfilled}.` : ` The request ${fulfilled.requestId} could not be linked (${fulfilled.error}).`}${duplicateLine}`,
    };
  }

  return {
    name: 'lifecode_skill_create',
    description: 'Create a reusable skill in the LifeCode Skill Center library. Only with evidence: a contract discovered the hard way, a trap already paid for, an operational order, or an exact value you will need again. "It could be reused" is not evidence, nor is a solved query. Run lifecode_skill_search first: if something close already exists, improve that one instead. The skill is published to the library but is NOT active in any project — activation is a human toggle in the panel.',
    parameters: {
      description: { type: 'string', required: true, description: 'One line, 60-300 characters: what the skill automates and when it is selected. This is what a model reads when choosing a skill.' },
      whenToUse: { type: 'string', required: true, description: 'At least 20 characters: the situation that should select this skill.' },
      body: { type: 'string', required: true, description: 'The procedure in markdown, at least 200 characters, with at least two "## " sections. Steps, contracts and traps — not a story about the session.' },
      id: { type: 'string', description: 'Optional kebab-case id (lowercase, digits, single hyphens, up to 64 characters). Derived from the description when omitted.' },
      title: { type: 'string', description: 'Optional human title for the library list.' },
      requestId: { type: 'string', description: 'Optional id of a person\'s pending request from the status tool: passing it links the new skill to that request so the panel shows it as fulfilled.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional identifiers that help comparing it against other skills.' },
      references: {
        type: 'array',
        description: 'Optional heavy material that stays beside the skill instead of inside the body. Each item needs a path under references/ and its content; the body must link it (the gate blocks a link that points nowhere).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Relative path under references/, e.g. "references/contracts.md". No absolute paths, no "..".' },
            content: { type: 'string', required: true, description: 'The material itself, verbatim.' },
          },
        },
      },
    },
    output: { schema: OUTPUT, render, presentationMeta: (_args, value) => presentationMetaOf(value) },
    execute(args, exec) {
      if (typeof evidence !== 'function') return create(args, exec, null);
      return (async () => {
        let measured = null;
        try {
          measured = await evidence({ cwd: scopeOf(exec) });
        } catch {
          // Sin medición se cae al comportamiento de siempre: el núcleo sigue validando el nombre y el
          // almacén; lo que no se puede es afirmar que no hay colisiones sin haber mirado.
          measured = null;
        }
        return create(args, exec, measured);
      })();
    },
  };
}

/** `lifecode_skill_improve` — proponer una versión nueva de algo vivo. */
export function lifecodeSkillImprove({ root = centerRoot() } = {}) {
  return {
    name: 'lifecode_skill_improve',
    description: 'Propose a new version of a skill that already exists. This does NOT publish and does NOT activate: it stores a proposal with a diff and a quality report, and a person approves or rejects it in the panel. Use it when the session measured something that contradicts the skill, or learned a detail that changes its procedure. Send the FULL new body, not a fragment.',
    parameters: {
      skillId: { type: 'string', required: true, description: 'Id of the skill to improve.' },
      rationale: { type: 'string', required: true, description: 'At least 20 characters: why this change, with the evidence (a measurement, a command, a path).' },
      body: { type: 'string', description: 'The complete new body in markdown. Omit to keep the current one and change only the metadata.' },
      description: { type: 'string', description: 'Optional new one-line description.' },
      whenToUse: { type: 'string', description: 'Optional new trigger.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional replacement tag list.' },
      references: {
        type: 'array',
        description: 'Optional replacement reference material (full set, not an increment).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Relative path under references/.' },
            content: { type: 'string', required: true, description: 'The material itself, verbatim.' },
          },
        },
      },
    },
    output: { schema: OUTPUT, render, presentationMeta: (_args, value) => presentationMetaOf(value) },
    execute(args, exec) {
      const result = runAction({
        root,
        actor: 'ai',
        cwd: scopeOf(exec),
        action: 'improve',
        payload: {
          skillId: args.skillId,
          rationale: args.rationale,
          body: args.body,
          description: args.description,
          whenToUse: args.whenToUse,
          tags: args.tags,
          references: args.references === undefined ? undefined : referencesToMap(args.references),
        },
      });
      if (isUnreadable(result)) return { status: 'unreadable', summary: unreadableSummary(result, 'the proposal'), integrity: result.integrity };
      if (!result.ok) {
        return { status: result.code === 'missing' ? 'missing-skill' : 'failed', summary: result.message ?? 'the proposal was not created', findings: findingsOf(result) };
      }
      const diff = result.diff ?? { added: 0, removed: 0 };
      return {
        status: 'proposed',
        improvementId: result.improvementId,
        baseVersion: result.improvement?.baseVersion,
        diff: { added: diff.added, removed: diff.removed, preview: diff.preview?.slice(0, 12) ?? [] },
        activity: activityOf(result),
        summary: `proposal ${result.improvementId} against v${result.improvement?.baseVersion} (+${diff.added}/-${diff.removed} lines). It is NOT published: a person approves or rejects it in the panel, and until then the project keeps loading the current version.`,
      };
    },
  };
}

/** `lifecode_skill_status` — qué está pasando en este proyecto. */
export function lifecodeSkillStatus({ root = centerRoot() } = {}) {
  return {
    name: 'lifecode_skill_status',
    description: 'Read the LifeCode Skill Center state for this session: the project it resolves to, which skills are enabled here (and therefore loading), what proposals wait for a human decision, and how healthy the library is. Read-only.',
    parameters: {},
    output: { schema: OUTPUT, render },
    execute(_args, exec) {
      const cwd = scopeOf(exec);
      const snapshot = runAction({ root, action: 'state', actor: 'ai', cwd, payload: { scan: false } });
      if (!snapshot.ok) return { status: 'failed', summary: snapshot.message ?? 'the center could not be read' };
      if (snapshot.readable === false) {
        const integrity = snapshot.integrity ?? {};
        return {
          status: 'unreadable',
          summary: `the center cannot be read (${integrity.status}${integrity.size === undefined ? '' : `, ${integrity.size} bytes`}${integrity.sha256 === undefined || integrity.sha256 === null ? '' : `, sha256 ${integrity.sha256}`}): nothing is known about this project's skills, and the damaged file was left untouched. A person has to restore it from the panel.`,
          integrity,
        };
      }
      const project = snapshot.project;
      const enabledHere = (snapshot.skills ?? []).filter((skill) => project !== null && (skill.enabledIn ?? []).includes(project.id));
      const pending = (snapshot.improvements ?? []).filter((entry) => entry.status === 'proposed');
      const analytics = snapshot.analytics ?? {};
      // Cola de personas esperando: sin esto el panel sería un buzón que nadie lee.
      const requests = snapshot.requests ?? { pending: 0, items: [] };
      const waiting = (requests.items ?? []).filter((entry) => entry.status === 'pending');
      // El modelo sólo ve el texto renderizado, no el objeto devuelto: si los ids y el texto de las
      // peticiones no van en el resumen, el agente no puede atenderlas sin leer el fichero del centro.
      const waitingLine = waiting.length === 0
        ? ''
        : ` Waiting requests (link one by passing its id as requestId to the create tool): ${waiting
          .slice(0, 5)
          .map((entry) => `${entry.id} «${String(entry.text ?? '').slice(0, 120)}»`)
          .join('; ')}${waiting.length > 5 ? `; and ${waiting.length - 5} more` : ''}.`;
      const summary = project === null
        ? `this session has no working directory: no project to resolve (${snapshot.projects?.length ?? 0} projects in the registry)`
        : `project ${project.name}${project.registered === false ? ' (not in the registry yet: opening the panel registers it)' : ''}: ${enabledHere.length} skill(s) enabled here, ${pending.length} proposal(s) waiting for a person, ${waiting.length} request(s) from a person waiting for the AI, library ${analytics.skills?.total ?? 0} skills.${waitingLine}`;
      return {
        status: 'ok',
        summary,
        project,
        enabledHere: enabledHere.map((skill) => ({ id: skill.id, version: skill.currentVersion, quality: skill.current?.evaluation?.score ?? null })),
        pending: pending.map((entry) => ({ id: entry.id, skillId: entry.skillId, baseVersion: entry.baseVersion, rationale: entry.rationale })),
        requests: {
          pending: waiting.length,
          items: waiting.map((entry) => ({ id: entry.id, text: entry.text, createdAt: entry.createdAt })),
        },
        library: {
          skills: analytics.skills ?? {},
          projects: analytics.projects ?? {},
          assignments: analytics.assignments ?? {},
          quality: analytics.quality ?? {},
          loads: analytics.loads ?? 0,
        },
      };
    },
  };
}

/**
 * `lifecode_skill_insight` — un hallazgo verificado entra en la bandeja de conocimiento.
 *
 * No decide nada: deja el hallazgo con su procedencia y su evidencia para que el motor de decisiones
 * (o una persona) lo use. Un subagente puede reportar; ninguno puede aprobar.
 */
export function lifecodeSkillInsight({ root = centerRoot() } = {}) {
  return {
    name: 'lifecode_skill_insight',
    description: 'Report one verified finding into the LifeCode Skill Center knowledge inbox (idempotent by insightId). It does not decide, approve, publish or activate anything: it records what was observed, where, and how it was verified, so the decision engine or a person can act on it. Use it when you found something a future task would need: a trap already paid for, a contract, a duplicated skill, a defect in the product.',
    parameters: {
      insightId: { type: 'string', required: true, description: 'Stable id for this finding (e.g. a slug). Repeating it returns the stored insight instead of a duplicate.' },
      title: { type: 'string', required: true, description: 'One line: what was found.' },
      category: { type: 'string', required: true, description: 'One of: trap, contract, defect, duplicate, observation, decision-input.' },
      confidence: { type: 'string', required: true, description: 'One of: strong, moderate, weak. Strong needs at least one verification described in evidence.' },
      summary: { type: 'string', description: 'What it means and why it matters.' },
      projectId: { type: 'string', description: 'Registry project id this finding belongs to, or empty for a global finding.' },
      suggestedAction: { type: 'string', description: 'What should probably happen next, in one line. A suggestion, not an order.' },
      risks: { type: 'string', description: 'What could go wrong if someone acts on this.' },
      evidence: {
        type: 'array',
        description: 'Where it was observed and how it was verified.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string', required: true, description: 'Who or what produced the observation (test, panel, audit, command).' },
            location: { type: 'string', description: 'File, route, panel or project where it was seen.' },
            verification: { type: 'string', description: 'How it was verified, with a measurement or a command.' },
            result: { type: 'string', description: 'What the verification produced.' },
          },
        },
      },
    },
    output: { schema: OUTPUT, render, presentationMeta: (_args, value) => presentationMetaOf(value) },
    execute(args, exec) {
      const cwd = scopeOf(exec);
      const { sessionId, parentRunId } = sessionOf(exec);
      const payload = { ...args, sourceAgent: 'lifecode_skill_insight', sessionId, parentRunId };
      const result = runAction({ root, action: 'insight', actor: 'ai', cwd, payload });
      if (result.ok !== true) {
        return { status: 'failed', summary: result.message ?? `the finding was not recorded (${result.code ?? 'unknown'})`, code: result.code ?? null };
      }
      const insight = result.insight ?? {};
      const summary = result.summary ?? {};
      return {
        status: 'ok',
        summary: `finding ${insight.insightId} recorded in the knowledge inbox with confidence ${insight.confidence}: ${insight.title}. It decides nothing: ${summary.pending ?? 0} finding(s) now wait for triage, and no skill, version or assignment was touched.`,
        insight: { insightId: insight.insightId, state: insight.state, confidence: insight.confidence, duplicate: result.duplicate === true },
        inbox: { pending: summary.pending ?? 0, total: summary.total ?? 0, mode: summary.mode ?? '' },
        activity: activityOf(result),
      };
    },
  };
}

/** Las cuatro, en el orden en que se ofrecen. */
export function centerTools({ root = centerRoot(), evidence = null } = {}) {
  return [lifecodeSkillSearch({ root }), lifecodeSkillCreate({ root, evidence }), lifecodeSkillImprove({ root }), lifecodeSkillStatus({ root }), lifecodeSkillInsight({ root })];
}
