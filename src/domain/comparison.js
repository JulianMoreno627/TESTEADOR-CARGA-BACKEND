// Una diferencia menor al 5 % se considera ruido normal entre corridas.
const NOISE_THRESHOLD = 0.05;

const METRICS = [
  { key: 'latencyP50', label: 'Latencia p50 (ms)', read: (s) => s.latency.p50, lowerIsBetter: true },
  { key: 'latencyP95', label: 'Latencia p95 (ms)', read: (s) => s.latency.p95, lowerIsBetter: true },
  { key: 'latencyP99', label: 'Latencia p99 (ms)', read: (s) => s.latency.p99, lowerIsBetter: true },
  { key: 'avgRps', label: 'Throughput (req/s)', read: (s) => s.avgRps, lowerIsBetter: false },
  { key: 'errorRate', label: 'Tasa de errores', read: (s) => s.errorRate, lowerIsBetter: true },
];

function compareMetric({ key, label, read, lowerIsBetter }, baseline, candidate) {
  const before = read(baseline);
  const after = read(candidate);

  if (before === null || after === null) {
    return { key, label, baseline: before, candidate: after, changePercent: null, verdict: 'unknown' };
  }

  const absolute = after - before;
  let change;
  if (before !== 0) change = absolute / before;
  else change = after === 0 ? 0 : Math.sign(absolute);

  let verdict = 'unchanged';
  if (Math.abs(change) >= NOISE_THRESHOLD) {
    verdict = change < 0 === lowerIsBetter ? 'improved' : 'regressed';
  }

  return {
    key,
    label,
    baseline: before,
    candidate: after,
    changePercent: Number((change * 100).toFixed(2)),
    verdict,
  };
}

function overallVerdict(metrics) {
  const regressed = metrics.some((metric) => metric.verdict === 'regressed');
  const improved = metrics.some((metric) => metric.verdict === 'improved');
  if (regressed && improved) return 'mixed';
  if (regressed) return 'regressed';
  if (improved) return 'improved';
  return 'unchanged';
}

/** Compara dos corridas para saber si una optimización realmente mejoró el rendimiento. */
export function compareRuns(baseline, candidate) {
  const metrics = METRICS.map((metric) => compareMetric(metric, baseline.summary, candidate.summary));
  return {
    baseline: { id: baseline.id, name: baseline.name, finishedAt: baseline.finishedAt },
    candidate: { id: candidate.id, name: candidate.name, finishedAt: candidate.finishedAt },
    noiseThresholdPercent: NOISE_THRESHOLD * 100,
    metrics,
    verdict: overallVerdict(metrics),
  };
}
