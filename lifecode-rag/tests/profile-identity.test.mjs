/**
 * Identidad del perfil (M6.5).
 *
 * El host de escritorio arranca con el directorio del perfil como argumento y no siempre expone
 * `DSH_PROFILE` en su propio entorno. Sin el paso por `argv`, el plugin dentro de la app resolvía
 * `default` mientras el perfil real era `desktop`, y las herramientas decían «este perfil no tiene
 * registro Project-Aware» aunque el registro existiera en `profiles/desktop`.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { profileKey, profileRoot } from '../lib/profile.mjs';

function withProfiles(names, work) {
  const base = mkdtempSync(join(tmpdir(), 'lcr-profile-'));
  const dirs = names.map((name) => {
    const dir = join(base, 'profiles', name);
    mkdirSync(dir, { recursive: true });
    return dir;
  });
  try {
    return work({ base, dirs });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test('el entorno manda sobre el argumento del host', () => {
  withProfiles(['desktop', 'headless'], ({ dirs }) => {
    const argv = ['node', 'host.js', dirs[0]];
    assert.equal(profileKey({ DSH_PROFILE: 'headless' }, argv), 'headless');
    assert.equal(profileKey({ DSH_PROFILE_DIR: dirs[0] }, argv), 'desktop');
    assert.equal(profileKey({ DSH_PROFILE: 'desktop', DSH_PROFILE_DIR: dirs[1] }), 'desktop');
  });
});

test('sin entorno, el perfil sale del directorio con el que arrancó el host', () => {
  withProfiles(['desktop'], ({ dirs }) => {
    const argv = ['C:/app/dsh-desktop-host/lib/index.js', 'C:/app/asar/dsh', dirs[0], 'C:/runtime'];
    assert.equal(profileKey({}, argv), 'desktop');
    assert.equal(profileKey({}, []), 'default');
    assert.equal(profileKey({}, ['C:/app/dsh/index.js']), 'default');
  });
});

test('un argumento que no es un directorio real no cuenta como perfil', () => {
  withProfiles(['desktop'], ({ base }) => {
    const missing = join(base, 'profiles', 'fantasma');
    assert.equal(profileKey({}, ['node', 'host.js', missing]), 'default');
    assert.equal(profileKey({}, ['node', 'host.js', join(base, 'not-profiles', 'desktop')]), 'default');
  });
});

test('el nombre del perfil sigue siendo inyectivo cuando llega por argumento', () => {
  withProfiles(['Desktop Work'], ({ dirs }) => {
    const key = profileKey({}, ['node', 'host.js', dirs[0]]);
    assert.match(key, /^desktop-work-[0-9a-f]{8}$/);
    assert.equal(key, profileKey({ DSH_PROFILE: 'Desktop Work' }));
  });
});

test('la raíz de datos del perfil usa el nombre resuelto', () => {
  withProfiles(['desktop'], ({ base, dirs }) => {
    const home = join(base, 'home');
    const root = profileRoot({ DSH_HOME: home }, ['node', 'host.js', dirs[0]]);
    assert.equal(root, join(home, 'lifecode-rag', 'profiles', 'desktop'));
  });
});

test('LIFECODE_RAG_DATA y LIFECODE_RAG_PROFILE gobiernan la raíz PA sin DSH', () => {
  withProfiles([], ({ base }) => {
    const data = join(base, 'data');
    const root = profileRoot({ LIFECODE_RAG_DATA: data, LIFECODE_RAG_PROFILE: 'custom' }, []);
    assert.equal(root, join(data, 'profiles', 'custom'));
    assert.equal(profileKey({ LIFECODE_RAG_DATA: data, LIFECODE_RAG_PROFILE: 'custom' }, []), 'custom');
    assert.throws(
      () => profileRoot({ LIFECODE_RAG_DATA: 'relative/data' }, []),
      /LIFECODE_RAG_DATA/,
    );
  });
});

test('el perfil saneado no puede escapar de profiles/ ni confundirse con . o ..', () => {
  for (const raw of ['..', '.', 'Laboratório', 'Lab Uno']) {
    const key = profileKey({ LIFECODE_RAG_PROFILE: raw }, []);
    assert.equal(key.includes('/') || key.includes(String.fromCharCode(92)), false);
    assert.notEqual(key, '.');
    assert.notEqual(key, '..');
  }
  const root = profileRoot({ LIFECODE_RAG_DATA: 'C:/data', LIFECODE_RAG_PROFILE: '..' }, []);
  assert.equal(root.includes('..'), false);
});
