// probe-exposure.mjs -- ¿se puede derivar el catálogo de sesión desde los ficheros?
// Sólo lectura. Compara las 27 skills de %USERPROFILE%/.dsh/skills con las 19 que la sesión expone
// y busca en el frontmatter la causa de cada exclusión.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const B = join(process.env.USERPROFILE, '.dsh', 'skills');
const EXPOSED = new Set([
  'agent-team-specialized-delivery', 'ai-image-batch-generation', 'authorized-plan-artifacts',
  'browser-qa-measurement-traps', 'data-backup-and-restore', 'deepseek-usage-monitor',
  'deepseek-workwindow', 'external-provider-integration', 'git-attributes-effect-probe',
  'guard-and-check-verification', 'live-host-release', 'nixie-fx-effect-authoring',
  'nixie-fx-runtime-integration', 'php-pdo-mariadb-local-contracts', 'powershell-colon-variable-trap',
  'session-state-recovery', 'ui-ux-pro-max', 'verifying-external-ai-advice', 'windows-git-bash-commands',
]);
const rows = [];
for (const d of readdirSync(B, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name === '.system') continue;
  const f = join(B, d.name, 'SKILL.md');
  if (!existsSync(f)) continue;
  const t = readFileSync(f, 'utf8');
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = m ? m[1] : '';
  const g = (k) => {
    const r = new RegExp('^\\s*' + k + ':\\s*(.+)$', 'm').exec(fm);
    return r ? r[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  rows.push({
    dir: d.name,
    name: g('name'),
    project: g('project'),
    origin: g('origin'),
    disable: /disable-model-invocation/.test(fm),
    userInvocable: g('user-invocable'),
    store: g('store'),
  });
}
for (const r of rows) {
  console.log([EXPOSED.has(r.name) ? 'YES' : 'no ', r.dir.padEnd(42), 'project=' + r.project, 'origin=' + r.origin, 'store=' + r.store, 'disable=' + r.disable, 'user-invocable=' + r.userInvocable].join(' '));
}
const missing = rows.filter((r) => !EXPOSED.has(r.name));
console.log('\nfiles=' + rows.length, 'exposed=' + rows.filter((r) => EXPOSED.has(r.name)).length, 'excluded=' + missing.length);
console.log('excluded:', JSON.stringify(missing.map((r) => ({ name: r.name, disable: r.disable, project: r.project, userInvocable: r.userInvocable }))));
