// M6.7 §5.1 — exclusión defensiva por nombre de fichero.
//
// La lista es una defensa en profundidad, no un gestor de secretos: evita indexar por accidente
// ficheros cuyo nombre es un patrón conocido (claves, credenciales, certificados). Se prueba por
// nombre, sin depender del contenido, y con casos límite que NO deben excluirse para no perder
// documentación legítima.
import test from 'node:test';
import assert from 'node:assert/strict';

import { isSensitiveName, SENSITIVE_NAME_PATTERNS } from '../lib/policy.mjs';

test('los nombres de secreto conocidos se excluyen', () => {
  const excluded = [
    '.env',
    '.env.local',
    '.env.production',
    '.npmrc',
    '.netrc',
    '.pgpass',
    'id_rsa',
    'id_rsa.pub',
    'id_ed25519',
    'certificado.pem',
    'clave.key',
    'bundle.pfx',
    'almacen.jks',
    'secrets.json',
    'secret.yaml',
    'credentials.yml',
    'production.env',
    'MY-SECRETS.json',
  ];
  for (const name of excluded) {
    assert.equal(isSensitiveName(name), true, `${name} debería excluirse`);
  }
});

test('la documentación y el código legítimos no se excluyen', () => {
  const allowed = [
    'environment.md',
    'environments.md',
    'keys.md',
    'secretos.md',
    'policy.mjs',
    'README.md',
    'keyboard.json',
    'envelope.txt',
    'docker-compose.yml',
    'id_rsa.md',
  ];
  for (const name of allowed) {
    assert.equal(isSensitiveName(name), false, `${name} NO debería excluirse`);
  }
});

test('el nombre se compara sin distinguir mayúsculas y sin depender de la ruta', () => {
  assert.equal(isSensitiveName('.ENV'), true);
  assert.equal(isSensitiveName('CERTIFICADO.PEM'), true);
  assert.equal(isSensitiveName('Secrets.YAML'), true);
});

test('la lista es de sólo lectura y sus patrones compilan', () => {
  assert.ok(Array.isArray(SENSITIVE_NAME_PATTERNS));
  assert.ok(SENSITIVE_NAME_PATTERNS.length >= 8);
  for (const pattern of SENSITIVE_NAME_PATTERNS) {
    assert.ok(pattern instanceof RegExp);
    assert.equal(pattern.test(''), false, `${pattern} no debe casar la cadena vacía`);
  }
  assert.equal(isSensitiveName(''), false);
});
