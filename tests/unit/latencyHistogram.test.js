import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LatencyHistogram } from '../../src/domain/metrics/LatencyHistogram.js';

const exactQuantile = (sorted, q) => sorted[Math.floor(q * (sorted.length - 1))];

function longTailedSample(size) {
  // Distribución log-normal con semilla fija, parecida a la latencia real.
  let seed = 42;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: size }, () => {
    const normal = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
    return Math.exp(3 + normal);
  });
}

describe('LatencyHistogram', () => {
  it('devuelve null sin muestras', () => {
    const histogram = new LatencyHistogram();
    assert.equal(histogram.quantile(0.95), null);
    assert.equal(histogram.summary().mean, null);
  });

  it('estima percentiles con error relativo de máximo 1 %', () => {
    const samples = longTailedSample(100_000);
    const histogram = new LatencyHistogram();
    samples.forEach((sample) => histogram.record(sample));
    const sorted = [...samples].sort((a, b) => a - b);

    for (const q of [0.5, 0.9, 0.95, 0.99, 0.999]) {
      const exact = exactQuantile(sorted, q);
      const error = Math.abs(histogram.quantile(q) - exact) / exact;
      assert.ok(error <= 0.0101, `p${q * 100}: error ${(error * 100).toFixed(3)} %`);
    }
  });

  it('combinar histogramas equivale a medir todo junto, también tras serializar', () => {
    const samples = longTailedSample(20_000);
    const whole = new LatencyHistogram();
    samples.forEach((sample) => whole.record(sample));

    const merged = new LatencyHistogram();
    for (let worker = 0; worker < 4; worker += 1) {
      const part = new LatencyHistogram();
      samples.filter((_, index) => index % 4 === worker).forEach((sample) => part.record(sample));
      merged.merge(LatencyHistogram.deserialize(structuredClone(part.serialize())));
    }

    assert.deepEqual(merged.summary(), whole.summary());
    assert.equal(merged.count, samples.length);
  });

  it('combinar un histograma vacío no altera mínimo ni máximo', () => {
    const histogram = new LatencyHistogram();
    histogram.record(10);
    histogram.merge(LatencyHistogram.deserialize(structuredClone(new LatencyHistogram().serialize())));
    assert.equal(histogram.summary().min, 10);
    assert.equal(histogram.summary().max, 10);
  });

  it('mantiene la memoria acotada sin importar el número de muestras', () => {
    const histogram = new LatencyHistogram();
    for (let index = 0; index < 500_000; index += 1) histogram.record(1 + (index % 60_000));
    assert.ok(histogram.serialize().buckets.length < 700);
  });
});
