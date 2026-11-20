/**
 * Métricas agregadas (M3). Sólo se guardan **números** por día, métrica y dimensión cerrada: ni consultas,
 * ni prompts, ni respuestas, ni rutas de usuario. `dim` es un enum de facto que fija el llamador.
 *
 * `metrics_daily` es la única tabla; el detalle por consulta no se persiste. Los percentiles se estiman
 * por histograma de cubos y se etiquetan como estimación en la API.
 */

import { RagError } from './errors.mjs';

/** Lista cerrada: una métrica nueva exige tocar este módulo y su prueba. */
export const METRICS = Object.freeze([
  'query.count',
  'query.ms',
  'query.ms_bucket',
  'query.empty',
  'context.builds',
  'context.tokens',
  'context.truncated',
  'ingest.documents',
  'ingest.chunks',
  'ingest.skipped',
  'ingest.ms',
  'errors',
  'automation.runs',
  'automation.indexed',
  'automation.failed',
]);

export const DIM_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

export function dayOf(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 10);
}

/** Cubos de latencia; el último es abierto y se informa como «≥ 1000 ms». */
export const LATENCY_BUCKETS = Object.freeze([
  [0, 10, '0-10'],
  [10, 25, '10-25'],
  [25, 50, '25-50'],
  [50, 100, '50-100'],
  [100, 250, '100-250'],
  [250, 500, '250-500'],
  [500, 1_000, '500-1000'],
  [1_000, Infinity, '1000+'],
]);

export function latencyBucket(ms) {
  const value = Number(ms);
  for (const [min, max, label] of LATENCY_BUCKETS) {
    if (value >= min && value < max) return label;
  }
  return '1000+';
}

function validate(metric, dim) {
  if (!METRICS.includes(metric)) throw new RagError('internal', `métrica no declarada: ${metric}`);
  if (typeof dim !== 'string' || (dim !== '' && !DIM_PATTERN.test(dim))) {
    throw new RagError('internal', `dimensión de métrica inválida: ${dim}`);
  }
}

/**
 * Suma `value` a la celda (día, métrica, dimensión). Es un UPSERT aditivo: dos ejecuciones del mismo día
 * acumulan, nunca se pisan.
 */
export function recordMetric(db, { metric, value = 1, dim = '', at = Date.now() }) {
  validate(metric, dim);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RagError('internal', 'valor de métrica no finito');
  }
  db.prepare(`INSERT INTO metrics_daily (day, metric, dim, value, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(day, metric, dim) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`)
    .run(dayOf(at), metric, dim, value, at);
}

/** Varias métricas en una transacción; el llamador decide si el fallo es fatal o best-effort.
 *  Si ya hay una transacción abierta (ingesta, reindexado), se reutiliza: anidar `BEGIN` en
 *  SQLite falla y las métricas deben ser parte de la misma unidad atómica. */
export function recordMetrics(db, entries, { immediate = false } = {}) {
  if (entries.length === 0) return;
  const nested = db.isTransaction === true;
  if (!nested) db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try {
    for (const entry of entries) recordMetric(db, entry);
    if (!nested) db.exec('COMMIT');
  } catch (error) {
    if (!nested) { try { db.exec('ROLLBACK'); } catch { /* la reversión puede haber ocurrido ya */ } }
    throw error;
  }
}

function sinceDay(days, now) {
  const start = now - (Math.max(1, days) - 1) * 86_400_000;
  return dayOf(start);
}

/** Totales por métrica y dimensión en la ventana. */
export function summary(db, { days = 7, now = Date.now() } = {}) {
  const from = sinceDay(days, now);
  const rows = db.prepare(`SELECT metric, dim, SUM(value) AS total FROM metrics_daily
    WHERE day >= ? GROUP BY metric, dim ORDER BY metric ASC, dim ASC`).all(from);
  return {
    days,
    from,
    metrics: rows.map((row) => ({ metric: row.metric, dim: row.dim, total: Number(row.total) })),
  };
}

/** Serie diaria de una métrica (todas sus dimensiones sumadas o filtradas). */
export function series(db, { metric, days = 30, dim = undefined, now = Date.now() } = {}) {
  if (!METRICS.includes(metric)) throw new RagError('invalid-argument', `métrica desconocida: ${metric}`);
  const from = sinceDay(days, now);
  const rows = dim === undefined
    ? db.prepare(`SELECT day, SUM(value) AS value FROM metrics_daily WHERE metric = ? AND day >= ? GROUP BY day ORDER BY day ASC`).all(metric, from)
    : db.prepare(`SELECT day, SUM(value) AS value FROM metrics_daily WHERE metric = ? AND dim = ? AND day >= ? GROUP BY day ORDER BY day ASC`).all(metric, dim, from);
  return { metric, days, from, points: rows.map((row) => ({ day: row.day, value: Number(row.value) })) };
}

/**
 * Estimación de percentil desde el histograma de cubos. Devuelve el borde superior del cubo que contiene
 * la posición pedida y lo declara como estimación: no es un percentil exacto.
 */
export function estimatePercentile(buckets, percentile) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) return null;
  const target = Math.min(1, Math.max(0, percentile)) * total;
  let acc = 0;
  for (const bucket of buckets) {
    acc += bucket.count;
    if (acc >= target) {
      return { value: bucket.upper, label: bucket.label, estimated: true, samples: total };
    }
  }
  return { value: buckets.at(-1)?.upper ?? null, label: buckets.at(-1)?.label ?? null, estimated: true, samples: total };
}

export function latencyDistribution(db, { days = 7, now = Date.now() } = {}) {
  const from = sinceDay(days, now);
  const rows = db.prepare(`SELECT dim, SUM(value) AS count FROM metrics_daily
    WHERE metric = 'query.ms_bucket' AND day >= ? GROUP BY dim`).all(from);
  const byLabel = new Map(rows.map((row) => [row.dim, Number(row.count)]));
  const buckets = LATENCY_BUCKETS.map(([min, max, label]) => ({
    label,
    lower: min,
    upper: max === Infinity ? null : max,
    count: byLabel.get(label) ?? 0,
  }));
  return { days, from, buckets, p50: estimatePercentile(buckets, 0.5), p95: estimatePercentile(buckets, 0.95) };
}

/** Purga por retención. Devuelve filas borradas; el llamador audita la operación. */
export function purgeMetrics(db, { beforeDay, at = Date.now() } = {}) {
  if (typeof beforeDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(beforeDay)) {
    throw new RagError('invalid-argument', 'beforeDay debe ser YYYY-MM-DD');
  }
  const result = db.prepare('DELETE FROM metrics_daily WHERE day < ?').run(beforeDay);
  return { deleted: Number(result.changes), beforeDay, at };
}

/** Ventana de retención en días a partir de la configuración y `now`. */
export function retentionCutoff(config, now = Date.now()) {
  return dayOf(now - config.metrics.retentionDays * 86_400_000);
}
