import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = new URL('../../lifecode-skill-center/docs/images/', import.meta.url);
const files = [
  'projects-discovered.png',
  'project-detail.png',
  'collisions.png',
  'skill-detail.png',
  'activity-center.png',
  'activity-toast.png',
  'activity-chat.png',
  'portability.png',
];
const rows = [];
for (const file of files) {
  const target = new URL(file, dir);
  const buffer = fs.readFileSync(target);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  rows.push({ file, bytes: buffer.length, width, height, hash });
}
const formatBytes = (value) => value.toLocaleString('es-ES').replace(/\u202f/g, ' ');
for (const row of rows) {
  console.log(`${row.file} | ${formatBytes(row.bytes)} B | ${row.width}×${row.height} | ${row.hash}`);
}
console.log('max bytes', Math.max(...rows.map((row) => row.bytes)));
