import { LatencyHistogram } from './LatencyHistogram.js';

const ratio = (part, total) => (total === 0 ? 0 : Number((part / total).toFixed(4)));
const perSecond = (value, seconds) => (seconds <= 0 ? 0 : Number((value / seconds).toFixed(2)));

function emptyCounters() {
  return { requests: 0, errors: 0, bytes: 0, histogram: new LatencyHistogram() };
}

function addCounters(target, batch, histogram) {
  target.requests += batch.requests;
  target.errors += batch.errors;
  target.bytes += batch.bytes;
  target.histogram.merge(histogram);
}

function addTally(tally, additions) {
  for (const [key, count] of Object.entries(additions)) {
    tally[key] = (tally[key] ?? 0) + count;
  }
}

/**
 * Convierte los lotes de los workers en dos vistas: una ventana que se reinicia
 * en cada muestra (lo que se ve en vivo) y un acumulado (el resumen final).
 * Enviar puntos agregados, y no cada petición, mantiene liviana la conexión.
 */
export class MetricsAggregator {
  #window = emptyCounters();
  #total = emptyCounters();
  #statusCodes = {};
  #errorTypes = {};
  #activeVusByWorker = new Map();
  #peakRps = 0;
  #peakVus = 0;

  ingest(workerIndex, batch) {
    const histogram = LatencyHistogram.deserialize(batch.histogram);
    addCounters(this.#window, batch, histogram);
    addCounters(this.#total, batch, histogram);
    addTally(this.#statusCodes, batch.statusCodes);
    addTally(this.#errorTypes, batch.errorTypes);
    this.#activeVusByWorker.set(workerIndex, batch.activeVus);
  }

  /** Cierra la ventana actual y devuelve un punto de la serie de tiempo. */
  closeWindow({ elapsedSeconds, windowSeconds, targetVus }) {
    const window = this.#window;
    this.#window = emptyCounters();

    const rps = perSecond(window.requests, windowSeconds);
    const activeVus = this.#activeVus();
    this.#peakRps = Math.max(this.#peakRps, rps);
    this.#peakVus = Math.max(this.#peakVus, activeVus);

    const { p50, p95, p99, mean, max } = window.histogram.summary();
    return {
      t: Number(elapsedSeconds.toFixed(2)),
      activeVus,
      targetVus,
      requests: window.requests,
      errors: window.errors,
      rps,
      errorRate: ratio(window.errors, window.requests),
      bytesPerSecond: perSecond(window.bytes, windowSeconds),
      latency: { p50, p95, p99, mean, max },
    };
  }

  /** Totales parciales para mostrar junto a la gráfica en vivo. */
  totals() {
    const { requests, errors, bytes } = this.#total;
    return { requests, errors, bytes, errorRate: ratio(errors, requests) };
  }

  summarize(durationSeconds) {
    const { requests, errors, bytes, histogram } = this.#total;
    return {
      durationSeconds: Number(durationSeconds.toFixed(2)),
      totalRequests: requests,
      successfulRequests: requests - errors,
      failedRequests: errors,
      errorRate: ratio(errors, requests),
      avgRps: perSecond(requests, durationSeconds),
      peakRps: this.#peakRps,
      peakVus: this.#peakVus,
      totalBytes: bytes,
      bytesPerSecond: perSecond(bytes, durationSeconds),
      latency: histogram.summary(),
      statusCodes: { ...this.#statusCodes },
      errorTypes: { ...this.#errorTypes },
    };
  }

  #activeVus() {
    let total = 0;
    for (const vus of this.#activeVusByWorker.values()) total += vus;
    return total;
  }
}
