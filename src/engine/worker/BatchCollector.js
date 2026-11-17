import { LatencyHistogram } from '../../domain/metrics/LatencyHistogram.js';

/** Acumula resultados dentro del worker para no enviar un mensaje por petición. */
export class BatchCollector {
  #reset() {
    this.requests = 0;
    this.errors = 0;
    this.bytes = 0;
    this.statusCodes = {};
    this.errorTypes = {};
    this.histogram = new LatencyHistogram();
  }

  constructor() {
    this.#reset();
  }

  record({ latencyMs, statusCode, bytes, errorType }) {
    this.requests += 1;
    this.bytes += bytes;

    if (statusCode > 0) {
      this.statusCodes[statusCode] = (this.statusCodes[statusCode] ?? 0) + 1;
      // Los fallos de red se excluyen: un timeout mediría el límite configurado,
      // no al servidor, y distorsionaría los percentiles.
      this.histogram.record(latencyMs);
    }
    if (errorType) {
      this.errors += 1;
      this.errorTypes[errorType] = (this.errorTypes[errorType] ?? 0) + 1;
    }
  }

  drain(activeVus) {
    const batch = {
      activeVus,
      requests: this.requests,
      errors: this.errors,
      bytes: this.bytes,
      statusCodes: this.statusCodes,
      errorTypes: this.errorTypes,
      histogram: this.histogram.serialize(),
    };
    this.#reset();
    return batch;
  }
}
