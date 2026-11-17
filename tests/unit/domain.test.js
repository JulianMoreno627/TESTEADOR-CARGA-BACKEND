import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareRuns } from '../../src/domain/comparison.js';
import { createLoadPattern } from '../../src/domain/loadPatterns.js';
import { toPublicConfig } from '../../src/domain/loadTestConfig.js';
import { MetricsAggregator } from '../../src/domain/metrics/MetricsAggregator.js';
import { LatencyHistogram } from '../../src/domain/metrics/LatencyHistogram.js';

describe('patrones de carga', () => {
  it('constante mantiene los VUs', () => {
    const pattern = createLoadPattern({ vus: 50, durationSeconds: 10, pattern: { type: 'constant' } });
    assert.equal(pattern.targetVusAt(0), 50);
    assert.equal(pattern.targetVusAt(9), 50);
  });

  it('rampa sube de forma lineal y luego se mantiene', () => {
    const pattern = createLoadPattern({
      vus: 101,
      durationSeconds: 20,
      pattern: { type: 'ramp', startVus: 1, rampSeconds: 10 },
    });
    assert.equal(pattern.targetVusAt(0), 1);
    assert.equal(pattern.targetVusAt(5), 51);
    assert.equal(pattern.targetVusAt(10), 101);
    assert.equal(pattern.targetVusAt(15), 101);
  });

  it('picos alterna entre la base y el máximo', () => {
    const pattern = createLoadPattern({
      vus: 100,
      durationSeconds: 20,
      pattern: { type: 'spike', baseVus: 10, spikes: 2, spikeSeconds: 2 },
    });
    assert.equal(pattern.targetVusAt(0), 10);
    assert.equal(pattern.targetVusAt(5), 100);
    assert.equal(pattern.targetVusAt(8), 10);
    assert.equal(pattern.targetVusAt(15), 100);
  });

  it('rechaza un patrón desconocido', () => {
    assert.throws(() => createLoadPattern({ vus: 1, durationSeconds: 1, pattern: { type: 'otro' } }));
  });
});

describe('MetricsAggregator', () => {
  const batch = (values, overrides = {}) => {
    const histogram = new LatencyHistogram();
    values.forEach((value) => histogram.record(value));
    return {
      activeVus: 5,
      requests: values.length,
      errors: 0,
      bytes: 100,
      statusCodes: { 200: values.length },
      errorTypes: {},
      histogram: histogram.serialize(),
      ...overrides,
    };
  };

  it('reinicia la ventana pero conserva el acumulado', () => {
    const aggregator = new MetricsAggregator();
    aggregator.ingest(0, batch([10, 20]));
    aggregator.ingest(1, batch([30], { errors: 1, errorTypes: { HTTP_500: 1 }, statusCodes: { 500: 1 } }));

    const first = aggregator.closeWindow({ elapsedSeconds: 1, windowSeconds: 1, targetVus: 10 });
    assert.equal(first.requests, 3);
    assert.equal(first.rps, 3);
    assert.equal(first.errorRate, 0.3333);
    assert.equal(first.activeVus, 10);

    const second = aggregator.closeWindow({ elapsedSeconds: 2, windowSeconds: 1, targetVus: 10 });
    assert.equal(second.requests, 0);
    assert.equal(second.latency.p95, null);

    const summary = aggregator.summarize(2);
    assert.equal(summary.totalRequests, 3);
    assert.equal(summary.avgRps, 1.5);
    assert.equal(summary.peakRps, 3);
    assert.deepEqual(summary.statusCodes, { 200: 2, 500: 1 });
    assert.deepEqual(summary.errorTypes, { HTTP_500: 1 });
  });
});

describe('toPublicConfig', () => {
  it('oculta credenciales y no conserva el cuerpo', () => {
    const result = toPublicConfig({
      url: 'https://api.test/items?page=2&access_token=abc',
      method: 'POST',
      headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'abc', Accept: 'application/json' },
      body: '{"password":"abc"}',
      vus: 1,
    });

    assert.equal(JSON.stringify(result).includes('abc'), false);
    assert.equal(result.headers.Accept, 'application/json');
    assert.equal(result.bodyBytes, 18);
    assert.equal('body' in result, false);
    assert.match(result.url, /page=2/);
  });
});

describe('compareRuns', () => {
  const run = (id, p95, avgRps, errorRate = 0) => ({
    id,
    name: id,
    finishedAt: null,
    summary: { latency: { p50: 10, p95, p99: p95 }, avgRps, errorRate },
  });

  it('detecta una mejora: menos latencia y más throughput', () => {
    const result = compareRuns(run('a', 200, 100), run('b', 100, 150));
    assert.equal(result.verdict, 'improved');
    assert.equal(result.metrics.find((m) => m.key === 'latencyP95').changePercent, -50);
    assert.equal(result.metrics.find((m) => m.key === 'avgRps').verdict, 'improved');
  });

  it('ignora diferencias menores al umbral de ruido', () => {
    assert.equal(compareRuns(run('a', 100, 100), run('b', 102, 99)).verdict, 'unchanged');
  });

  it('detecta una regresión cuando aparecen errores desde cero', () => {
    const result = compareRuns(run('a', 100, 100, 0), run('b', 100, 100, 0.2));
    assert.equal(result.verdict, 'regressed');
  });

  it('marca resultado mixto si unas métricas mejoran y otras empeoran', () => {
    assert.equal(compareRuns(run('a', 100, 100), run('b', 50, 50)).verdict, 'mixed');
  });
});
