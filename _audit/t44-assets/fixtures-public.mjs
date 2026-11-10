// Fixtures NEUTRALES y deterministas para las capturas públicas (T51).
// Ningún dato del usuario: proyectos genéricos, rutas <home>/projects/… y nada de nombres reales.
// Los conteos son coherentes entre sí: 10 skills, 4 proyectos, 1 colisión controlada y 6 eventos.

export const GENERATED_AT = '2026-11-09T18:30:00.000Z';

const SKILL_DEFS = [
  { id: 'release-checklist', title: 'Release checklist', version: '1.2.0', previous: '1.1.0', owner: 'lifecode', provider: 'skill-compiler', root: 'acme-web' },
  { id: 'api-contract-review', title: 'API contract review', version: '2.0.0', previous: '1.4.0', owner: 'lifecode', provider: 'skill-compiler', root: 'northwind-api' },
  { id: 'css-token-audit', title: 'CSS token audit', version: '1.0.3', previous: '1.0.2', owner: 'lifecode', provider: 'skill-compiler', root: 'blue-harbor-app' },
  { id: 'accessibility-pass', title: 'Accessibility pass', version: '1.3.0', previous: '1.3.0', owner: 'lifecode', provider: 'skill-compiler', root: 'acme-web' },
  { id: 'migration-plan', title: 'Migration plan', version: '0.9.0', previous: '0.9.0', owner: 'plugin', provider: 'skill-compiler', root: 'northwind-api' },
  { id: 'schema-drift-check', title: 'Schema drift check', version: '1.1.0', previous: '1.0.0', owner: 'plugin', provider: 'skill-compiler', root: 'northwind-api' },
  { id: 'changelog-writer', title: 'Changelog writer', version: '1.0.0', previous: '1.0.0', owner: 'filesystem', provider: null, root: null },
  { id: 'style-guide-sync', title: 'Style guide sync', version: '1.0.0', previous: '1.0.0', owner: 'filesystem', provider: null, root: null },
  { id: 'demo-seed-data', title: 'Demo seed data', version: '1.0.0', previous: '1.0.0', owner: 'filesystem', provider: null, root: null },
  { id: 'release-notes', title: 'Release notes', version: '1.0.0', previous: '1.0.0', owner: 'bundled', provider: null, root: null },
];

function skillPath(def) {
  return def.root === null
    ? `<home>/.dsh/skills/${def.id}/SKILL.md`
    : `<home>/projects/${def.root}/.dsh/skills/${def.id}/SKILL.md`;
}

export function neutralSkills() {
  return SKILL_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    currentVersion: def.version,
    status: 'published',
    origin: { kind: 'human' },
    updatedAt: '2026-11-08T16:20:00.000Z',
    current: { evaluation: { score: 88, issues: [] } },
    versions: [
      { version: def.version, createdAt: '2026-11-08T16:20:00.000Z' },
      { version: def.previous, createdAt: '2026-10-21T09:10:00.000Z' },
    ],
  }));
}

export function neutralSnapshot() {
  return {
    ok: true,
    apiVersion: 1,
    generatedAt: GENERATED_AT,
    version: '1.0.1',
    library: { skills: 10, versions: 14, pending: 1 },
    skills: neutralSkills(),
    projects: [
      { id: 'proj-acme', name: 'acme-web', path: '<home>/projects/acme-web' },
      { id: 'proj-northwind', name: 'northwind-api', path: '<home>/projects/northwind-api' },
    ],
    events: neutralActivities(),
    stats: { skills: 10, projects: 4, events: 6, pending: 1 },
    pending: [
      {
        id: 'imp-release-checklist',
        skillId: 'release-checklist',
        title: 'Añadir verificación de firma al checklist',
        reason: 'La IA propone; publicar y activar lo decide una persona.',
        createdAt: '2026-11-09T17:40:00.000Z',
      },
    ],
  };
}

export function neutralCapabilities() {
  return {
    ok: true,
    kind: 'capabilities',
    apiVersion: 1,
    contractVersion: 2,
    implementation: 'r17.2',
    plugin: { id: 'lifecode-skill-center', version: '1.0.1' },
    capabilities: ['state', 'projects', 'inventory', 'activity', 'register-project', 'inspect-project'],
    contract: { name: 'lifecode-skill-center', minClientContract: 2, maxClientContract: 2 },
  };
}

export function neutralProjects() {
  const base = {
    registration: { present: true, uuid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', manifestSha256: '5d41402abc4b2a76b9719d911017c592', registeredAt: '2026-10-02T10:00:00.000Z', adoptedAt: null },
    reasons: [],
  };
  return {
    ok: true,
    apiVersion: 1,
    generatedAt: GENERATED_AT,
    readable: true,
    complete: true,
    sources: [
      { id: 'state', status: 'complete', reason: null },
      { id: 'workspace-registry', status: 'complete', reason: null },
      { id: 'skills-registry', status: 'complete', reason: null },
      { id: 'filesystem-project', status: 'complete', reason: null },
    ],
    current: { cwd: '<home>/projects/acme-web', workspaceId: 'ws-acme', workspaceTitle: 'acme-web', projectId: 'proj-acme', confidence: 'session', via: 'cwd' },
    discovered: [
      { workspaceId: 'ws-blue-harbor', title: 'blue-harbor-app', path: '<home>/projects/blue-harbor-app', canonicalPath: '<home>/projects/blue-harbor-app', sessionCount: 3, availability: 'ok', projectId: 'proj-blue-harbor', state: 'discovered' },
      { workspaceId: 'ws-demo', title: 'demo-workspace', path: '<home>/projects/demo-workspace', canonicalPath: '<home>/projects/demo-workspace', sessionCount: null, availability: 'unknown', projectId: 'proj-demo', state: 'discovered' },
    ],
    projects: [
      {
        ...base,
        projectId: 'proj-acme',
        name: 'acme-web',
        cwd: '<home>/projects/acme-web',
        canonicalPath: '<home>/projects/acme-web',
        state: 'healthy',
        workspace: { workspaceId: 'ws-acme', title: 'acme-web', path: '<home>/projects/acme-web', availability: 'ok' },
        inspection: { status: 'complete', inspectedAt: '2026-11-09T18:00:00.000Z', reason: null },
        counts: { assigned: 3, active: 2, materialized: 1 },
      },
      {
        ...base,
        projectId: 'proj-northwind',
        name: 'northwind-api',
        cwd: '<home>/projects/northwind-api',
        canonicalPath: '<home>/projects/northwind-api',
        state: 'managed',
        registration: { present: true, uuid: '7c9e6679-7425-40de-944b-e07fc1f90ae7', manifestSha256: 'd41d8cd98f00b204e9800998ecf8427e', registeredAt: '2026-10-18T12:30:00.000Z', adoptedAt: null },
        workspace: { workspaceId: 'ws-northwind', title: 'northwind-api', path: '<home>/projects/northwind-api', availability: 'ok' },
        inspection: { status: 'complete', inspectedAt: '2026-11-09T17:45:00.000Z', reason: null },
        counts: { assigned: 2, active: 1, materialized: 0 },
      },
    ],
    summary: { total: 4, discovered: 2, managed: 2, available: 2, unavailable: 0, conflicts: 0, legacy: 0, withoutWorkspace: 1 },
  };
}

export function neutralInventory() {
  const entries = SKILL_DEFS.map((def, index) => ({
    key: def.id,
    name: def.id,
    canonicalName: def.id,
    description: `Guía reutilizable para ${def.title.toLowerCase()}.`,
    whenToUse: 'Cuando el proyecto lo necesite y la persona lo active.',
    owner: { kind: def.owner, provider: def.provider, pluginEntryId: def.owner === 'plugin' ? `plugin-${def.id}` : null },
    origin: { kind: def.owner, label: def.provider ?? 'este centro' },
    location: { kind: 'file', path: skillPath(def), directory: skillPath(def).replace(/\/SKILL\.md$/, ''), rootId: def.root === null ? 'lifecode' : 'project' },
    scope: { kind: def.root === null ? 'user' : 'project', projectRoot: def.root === null ? null : `<home>/projects/${def.root}`, cwd: def.root === null ? '<home>' : `<home>/projects/${def.root}` },
    association: { loadedByHost: index % 4 === 3 ? null : index % 3 !== 0, provider: def.provider, path: skillPath(def), shadowedBy: null },
    execution: { modelInvocable: true, userInvocable: true },
    identity: { uuid: def.owner === 'lifecode' ? `a1b2c3d4-0000-4000-8000-0000000000${String(index + 1).padStart(2, '0')}` : null, version: def.version, contentSha256: `9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a0${index}`, manifestSha256: null },
    confidence: def.owner === 'lifecode' ? 'verified' : def.owner === 'plugin' ? 'plugin-contract' : index % 2 === 0 ? 'content-hash' : 'unknown',
    reasons: def.owner === 'lifecode' ? [] : ['La procedencia viene del inventario del Host.'],
  }));
  return {
    ok: true,
    apiVersion: 1,
    generatedAt: GENERATED_AT,
    complete: true,
    truncated: false,
    sources: [
      { id: 'state', status: 'complete', reason: null },
      { id: 'workspace-registry', status: 'complete', reason: null },
      { id: 'skills-registry', status: 'complete', reason: null },
      { id: 'loader', status: 'complete', reason: null },
    ],
    entries,
    collisions: [
      {
        code: 'name-collision',
        severity: 'warn',
        key: 'release-checklist',
        rows: [
          { key: 'release-checklist', owner: 'lifecode', location: '<home>/projects/acme-web/.dsh/skills/release-checklist/SKILL.md' },
          { key: 'release-checklist', owner: 'filesystem', location: '<home>/.dsh/skills/release-checklist/SKILL.md' },
        ],
        explanation: 'Dos procedencias distintas ofrecen la misma skill con cuerpos distintos: la vista debe decirlo, no elegir.',
        evidence: [],
      },
      {
        code: 'legacy-collision',
        severity: 'warn',
        key: 'compiler-projects',
        rows: [
          { key: 'compiler-projects', owner: 'filesystem', location: '<home>/.dsh/skill-compiler/projects/acme-web-7a1b2c/approved/release-checklist/SKILL.md' },
          { key: 'compiler-projects', owner: 'filesystem', location: '<home>/.dsh/skill-compiler/projects/northwind-api-9d8e7f/approved/api-contract-review/SKILL.md' },
          { key: 'compiler-projects', owner: 'filesystem', location: '<home>/.dsh/skill-compiler/projects/blue-harbor-3c4d5e/approved/css-token-audit/SKILL.md' },
        ],
        explanation: 'La raíz heredada del compilador conserva 3 skills que el Host ya no carga: es historia del compilador, no un conflicto actual.',
        evidence: [],
      },
    ],
    summary: { total: 10, byOwner: { own: 4, external: 2, filesystem: 3, host: 1, unknown: 0 }, shadowed: 0, ambiguous: 0, invalidNames: 0 },
  };
}

export function neutralProjectDetail(projectId = 'proj-acme') {
  const projects = neutralProjects();
  const summary = projects.projects.find((entry) => entry.projectId === projectId) ?? projects.projects[0];
  const skills = [
    { skillId: 'release-checklist', name: 'release-checklist', assignedVersion: '1.2.0', host: { provider: 'skill-compiler', path: '<home>/projects/acme-web/.dsh/skills/release-checklist/SKILL.md', source: 'lifecode' }, shadowed: false },
    { skillId: 'accessibility-pass', name: 'accessibility-pass', assignedVersion: '1.3.0', host: { provider: 'skill-compiler', path: '<home>/projects/acme-web/.dsh/skills/accessibility-pass/SKILL.md', source: 'lifecode' }, shadowed: false },
    { skillId: 'css-token-audit', name: 'css-token-audit', assignedVersion: '1.0.3', host: null, shadowed: false },
  ];
  return {
    ...summary,
    sources: projects.sources,
    identity: { projectId, uuid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', manifestSha256: '5d41402abc4b2a76b9719d911017c592', state: 'match' },
    assignments: [
      { skillId: 'release-checklist', version: '1.2.0', enabled: true, pinnedAt: '2026-11-03T09:00:00.000Z', updatedAt: '2026-11-08T16:20:00.000Z', by: 'human' },
      { skillId: 'accessibility-pass', version: '1.3.0', enabled: true, pinnedAt: '2026-10-30T08:00:00.000Z', updatedAt: '2026-11-06T11:00:00.000Z', by: 'human' },
      { skillId: 'css-token-audit', version: '1.0.3', enabled: false, pinnedAt: '2026-10-12T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', by: 'human' },
    ],
    skills,
    sessions: { count: 4, archived: 0, source: 'workspace' },
    collisions: [{
      code: 'name-collision',
      severity: 'warn',
      key: 'release-checklist',
      rows: [
        { key: 'release-checklist', owner: 'lifecode', location: '<home>/projects/acme-web/.dsh/skills/release-checklist/SKILL.md' },
        { key: 'release-checklist', owner: 'filesystem', location: '<home>/.dsh/skills/release-checklist/SKILL.md' },
      ],
    }],
    findings: [],
  };
}

export function neutralActivities() {
  return [
    {
      eventId: 'evt-public-1',
      type: 'skill-created',
      at: '2026-11-09T18:12:00.000Z',
      actor: 'agent',
      actorEvidence: { channel: 'tool', stored: 'activity.jsonl' },
      origin: 'skill-compiler',
      source: 'center.json',
      projectId: 'proj-acme',
      skillId: 'release-checklist',
      skillTitle: 'release-checklist',
      versionBefore: null,
      versionAfter: '1.2.0',
      referencesAdded: ['docs/release.md'],
      referencesUpdated: null,
      referencesRemoved: null,
      correlationId: 'corr-demo-1',
      requestId: 'req-demo-1',
      outcome: 'ok',
      persisted: true,
      humanApprovalRequired: false,
      confidence: 'verified',
      category: 'create',
      severity: 'success',
      titleKey: 'activity.title.skill-created',
      titleVars: { skill: 'release-checklist' },
    },
    {
      eventId: 'evt-public-2',
      type: 'skill-version-saved',
      at: '2026-11-09T18:04:00.000Z',
      actor: 'agent',
      actorEvidence: { channel: 'tool', stored: 'activity.jsonl' },
      origin: 'skill-compiler',
      source: 'center.json',
      projectId: 'proj-northwind',
      skillId: 'api-contract-review',
      skillTitle: 'api-contract-review',
      versionBefore: '1.4.0',
      versionAfter: '2.0.0',
      referencesAdded: ['docs/api.md', 'docs/versioning.md'],
      referencesUpdated: null,
      referencesRemoved: null,
      correlationId: 'corr-demo-2',
      requestId: 'req-demo-2',
      outcome: 'ok',
      persisted: true,
      humanApprovalRequired: false,
      confidence: 'verified',
      category: 'update',
      severity: 'info',
      titleKey: 'activity.title.skill-version-saved',
      titleVars: { skill: 'api-contract-review', version: '2.0.0' },
    },
    {
      eventId: 'evt-public-3',
      type: 'improvement-prepared',
      at: '2026-11-09T17:41:00.000Z',
      actor: 'human',
      actorEvidence: { channel: 'panel', stored: 'knowledge.json' },
      origin: 'panel',
      source: 'knowledge.json',
      projectId: 'proj-acme',
      skillId: 'release-checklist',
      skillTitle: 'release-checklist',
      versionBefore: null,
      versionAfter: null,
      referencesAdded: null,
      referencesUpdated: null,
      referencesRemoved: null,
      correlationId: null,
      requestId: null,
      outcome: 'info',
      persisted: true,
      humanApprovalRequired: true,
      confidence: 'derived',
      category: 'improvement',
      severity: 'info',
      titleKey: 'activity.title.improvement-prepared',
      titleVars: { skill: 'release-checklist' },
    },
    {
      eventId: 'evt-public-4',
      type: 'project-linked',
      at: '2026-11-09T16:22:00.000Z',
      actor: 'human',
      actorEvidence: { channel: 'panel', stored: 'center.json' },
      origin: 'panel',
      source: 'center.json',
      projectId: 'proj-blue-harbor',
      skillId: null,
      skillTitle: null,
      versionBefore: null,
      versionAfter: null,
      referencesAdded: null,
      referencesUpdated: null,
      referencesRemoved: null,
      correlationId: null,
      requestId: null,
      outcome: 'ok',
      persisted: true,
      humanApprovalRequired: false,
      confidence: 'verified',
      category: 'update',
      severity: 'success',
      titleKey: 'activity.title.project-linked',
      titleVars: { project: 'blue-harbor-app' },
    },
    {
      eventId: 'evt-public-5',
      type: 'knowledge-incorporated',
      at: '2026-11-08T15:05:00.000Z',
      actor: 'agent',
      actorEvidence: { channel: 'tool', stored: 'knowledge.json' },
      origin: 'skill-compiler',
      source: 'knowledge.json',
      projectId: null,
      skillId: 'css-token-audit',
      skillTitle: 'css-token-audit',
      versionBefore: null,
      versionAfter: null,
      referencesAdded: null,
      referencesUpdated: null,
      referencesRemoved: null,
      correlationId: 'corr-demo-3',
      requestId: null,
      outcome: 'ok',
      persisted: true,
      humanApprovalRequired: false,
      confidence: 'derived',
      category: 'create',
      severity: 'info',
      titleKey: 'activity.title.knowledge-incorporated',
      titleVars: { skill: 'css-token-audit' },
    },
    {
      eventId: 'evt-public-6',
      type: 'references-unverified',
      at: '2026-11-07T11:30:00.000Z',
      actor: 'system',
      actorEvidence: { channel: 'scan', stored: 'knowledge.json' },
      origin: 'panel',
      source: 'knowledge.json',
      projectId: 'proj-acme',
      skillId: 'release-checklist',
      skillTitle: 'release-checklist',
      versionBefore: null,
      versionAfter: null,
      referencesAdded: null,
      referencesUpdated: null,
      referencesRemoved: null,
      correlationId: null,
      requestId: null,
      outcome: 'info',
      persisted: true,
      humanApprovalRequired: false,
      confidence: 'unknown',
      category: 'alert',
      severity: 'warning',
      titleKey: 'activity.title.references-unverified',
      titleVars: { skill: 'release-checklist' },
    },
  ];
}

export function neutralActivityPayload(events = neutralActivities()) {
  return {
    ok: true,
    apiVersion: 1,
    contractVersion: 2,
    generatedAt: GENERATED_AT,
    events,
    sources: [
      { id: 'center.json', status: 'complete', reason: null },
      { id: 'knowledge.json', status: 'complete', reason: null },
    ],
    nextBefore: null,
    total: events.length,
    complete: true,
    truncated: false,
  };
}

export function neutralBundlePreview() {
  return {
    name: 'release-checklist',
    description: 'Checklist reutilizable para publicar sin sorpresas.',
    version: '1.2.0',
    tags: ['release', 'quality'],
    origin: { app: 'lifecode-skill-center', skillId: 'release-checklist', version: '1.2.0', exportedAt: GENERATED_AT, from: 'demo-workspace' },
    identity: { skillId: 'release-checklist', checksum: 'sha256:5d41402abc4b2a76b9719d911017c592', bytes: 18432 },
    compatibility: { schema: 'lifecode-skill-center/skill-bundle', schemaVersion: 1, supported: true, minSupported: 1, maxSupported: 1, compatible: true },
    integrity: { checksum: 'ok' },
    portability: { portable: true, warnings: [] },
    conflicts: { sameId: { exists: false, currentVersion: null }, sameName: [], alreadyImported: [], idInUse: false, nameInUse: false },
    plan: { action: 'create', targetIdCandidate: 'release-checklist' },
    preflight: { decision: 'allow', findings: [], reasons: [] },
  };
}

export function neutralBundleText() {
  return JSON.stringify({
    schema: 'lifecode-skill-center/skill-bundle',
    schemaVersion: 1,
    skill: { id: 'release-checklist', title: 'Release checklist', version: '1.2.0' },
    files: ['SKILL.md', 'references/release.md'],
  }, null, 2);
}
