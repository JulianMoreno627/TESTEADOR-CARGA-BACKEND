const RELATIVE_ACCURACY = 0.01;
const GAMMA = (1 + RELATIVE_ACCURACY) / (1 - RELATIVE_ACCURACY);
const LOG_GAMMA = Math.log(GAMMA);
const MIN_TRACKABLE_MS = 0.001;

/**
 * Histograma de cubetas logarítmicas (la idea de DDSketch) para calcular
 * percentiles sobre un flujo de datos sin guardar cada muestra:
 *
 * - Memoria acotada: un millón de muestras ocupa las mismas pocas cubetas.
 * - Error relativo máximo del 1 % en cualquier percentil.
 * - Combinable: cada worker mide por su cuenta y el hilo principal suma los
 *   histogramas. Promediar los p95 de cada worker daría un resultado incorrecto.
 */
export class LatencyHistogram {
  #buckets = new Map();

  count = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;

  record(valueMs) {
    const value = Math.max(valueMs, MIN_TRACKABLE_MS);
    const index = Math.ceil(Math.log(value) / LOG_GAMMA);
    this.#buckets.set(index, (this.#buckets.get(index) ?? 0) + 1);
    this.count += 1;
    this.sum += valueMs;
    this.min = Math.min(this.min, valueMs);
    this.max = Math.max(this.max, valueMs);
  }

  /** @param {number} q cuantil entre 0 y 1 (0.95 = p95). */
  quantile(q) {
    if (this.count === 0) return null;

    const rank = q * (this.count - 1);
    const indexes = [...this.#buckets.keys()].sort((a, b) => a - b);
    let accumulated = 0;

    for (const index of indexes) {
      accumulated += this.#buckets.get(index);
      if (accumulated > rank) {
        const estimate = (2 * GAMMA ** index) / (GAMMA + 1);
        return Math.min(this.max, Math.max(this.min, estimate));
      }
    }
    return this.max;
  }

  merge(other) {
    for (const [index, count] of other.#buckets) {
      this.#buckets.set(index, (this.#buckets.get(index) ?? 0) + count);
    }
    this.count += other.count;
    this.sum += other.sum;
    this.min = Math.min(this.min, other.min);
    this.max = Math.max(this.max, other.max);
  }

  /** Resumen de latencia en milisegundos, o nulos si no hubo muestras. */
  summary() {
    const round = (value) => (value === null ? null : Number(value.toFixed(2)));
    const hasData = this.count > 0;
    return {
      min: round(hasData ? this.min : null),
      mean: round(hasData ? this.sum / this.count : null),
      p50: round(this.quantile(0.5)),
      p90: round(this.quantile(0.9)),
      p95: round(this.quantile(0.95)),
      p99: round(this.quantile(0.99)),
      max: round(hasData ? this.max : null),
    };
  }

  /** Forma compacta para enviarlo entre hilos con postMessage. */
  serialize() {
    return {
      buckets: [...this.#buckets],
      count: this.count,
      sum: this.sum,
      min: this.min,
      max: this.max,
    };
  }

  static deserialize({ buckets, count, sum, min, max }) {
    const histogram = new LatencyHistogram();
    histogram.#buckets = new Map(buckets);
    histogram.count = count;
    histogram.sum = sum;
    histogram.min = min;
    histogram.max = max;
    return histogram;
  }
}
