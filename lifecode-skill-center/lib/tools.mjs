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
export function lifecodeSkillCreate({ root = centerRoot() } = {}) {
  return {
    name: 'lifecode_skill_create',
    description: 'Create a reusable skill in the LifeCode Skill Center library. Only with evidence: a contract discovered the hard way, a trap already paid for, an operational order, or an exact value you will need again. "It could be reused" is not evidence, nor is a solved query. Run lifecode_skill_search first: if something close already exists, improve that one instead. The skill is published to the library but is NOT active in any project — activation is a human toggle in the panel.',
    parameters: {
      description: { type: 'string', required: true, description: 'One line, 60-300 characters: what the skill automates and when it is selected. This is what a model reads when choosing a skill.' },
      whenToUse: { type: 'string', required: true, description: 'At least 20 characters: the situation that should select this skill.' },
      body: { type: 'string', required: true, description: 'The procedure in markdown, at least 200 characters, with at least two "## " sections. Steps, contracts and traps — not a story about the session.' },
      id: { type: 'string', description: 'Optional kebab-case id (lowercase, digits, single hyphens, up to 64 characters). Derived from the description when omitted.' },
      title: { type: 'string', description: 'Optional human title for the library list.' },
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
    output: { schema: OUTPUT, render },
    execute(args, exec) {
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
      });
      if (!result.ok) {
        return { status: result.code === 'exists' ? 'exists' : 'failed', summary: result.message ?? 'the skill was not created', findings: findingsOf(result) };
      }
      const quality = result.evaluation?.score;
      return {
        status: 'published',
        id: result.id,
        version: result.version?.version ?? '1.0.0',
        quality,
        summary: `created "${result.id}" v${result.version?.version ?? '1.0.0'} (quality ${quality ?? '?'}/100). It is in the library and NOT active in any project: the person enables it per project in the panel.`,
      };
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
    output: { schema: OUTPUT, render },
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
      if (!result.ok) {
        return { status: result.code === 'missing' ? 'missing-skill' : 'failed', summary: result.message ?? 'the proposal was not created', findings: findingsOf(result) };
      }
      const diff = result.diff ?? { added: 0, removed: 0 };
      return {
        status: 'proposed',
        improvementId: result.improvementId,
        baseVersion: result.improvement?.baseVersion,
        diff: { added: diff.added, removed: diff.removed, preview: diff.preview?.slice(0, 12) ?? [] },
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
      const project = snapshot.project;
      const enabledHere = (snapshot.skills ?? []).filter((skill) => project !== null && (skill.enabledIn ?? []).includes(project.id));
      const pending = (snapshot.improvements ?? []).filter((entry) => entry.status === 'proposed');
      const analytics = snapshot.analytics ?? {};
      const summary = project === null
        ? `this session has no working directory: no project to resolve (${snapshot.projects?.length ?? 0} projects in the registry)`
        : `project ${project.name}${project.registered === false ? ' (not in the registry yet: opening the panel registers it)' : ''}: ${enabledHere.length} skill(s) enabled here, ${pending.length} proposal(s) waiting for a person, library ${analytics.skills?.total ?? 0} skills`;
      return {
        status: 'ok',
        summary,
        project,
        enabledHere: enabledHere.map((skill) => ({ id: skill.id, version: skill.currentVersion, quality: skill.current?.evaluation?.score ?? null })),
        pending: pending.map((entry) => ({ id: entry.id, skillId: entry.skillId, baseVersion: entry.baseVersion, rationale: entry.rationale })),
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

/** Las cuatro, en el orden en que se ofrecen. */
export function centerTools({ root = centerRoot() } = {}) {
  return [lifecodeSkillSearch({ root }), lifecodeSkillCreate({ root }), lifecodeSkillImprove({ root }), lifecodeSkillStatus({ root })];
}
