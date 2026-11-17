/**
 * Patrón Strategy: cada patrón responde cuántos usuarios virtuales (VUs) deben
 * estar activos en un instante de la prueba. Agregar un patrón nuevo solo
 * requiere una clase y una entrada en `strategies`.
 */
class ConstantLoad {
  constructor({ vus }) {
    this.vus = vus;
  }

  targetVusAt() {
    return this.vus;
  }
}

class RampUpLoad {
  constructor({ vus, durationSeconds, pattern }) {
    this.vus = vus;
    this.startVus = pattern.startVus ?? 1;
    this.rampSeconds = pattern.rampSeconds ?? durationSeconds;
  }

  targetVusAt(elapsedSeconds) {
    const progress = Math.min(1, elapsedSeconds / this.rampSeconds);
    return Math.round(this.startVus + (this.vus - this.startVus) * progress);
  }
}

class SpikeLoad {
  constructor({ vus, durationSeconds, pattern }) {
    this.vus = vus;
    this.baseVus = pattern.baseVus ?? Math.max(1, Math.ceil(vus * 0.1));
    const spikes = pattern.spikes ?? 2;
    this.period = durationSeconds / spikes;
    this.spikeSeconds = pattern.spikeSeconds ?? Math.max(1, Math.round(this.period / 4));
    // Cada pico queda centrado dentro de su periodo.
    this.spikeStart = (this.period - this.spikeSeconds) / 2;
  }

  targetVusAt(elapsedSeconds) {
    const position = elapsedSeconds % this.period;
    const inSpike = position >= this.spikeStart && position < this.spikeStart + this.spikeSeconds;
    return inSpike ? this.vus : this.baseVus;
  }
}

const strategies = {
  constant: ConstantLoad,
  ramp: RampUpLoad,
  spike: SpikeLoad,
};

export const LOAD_PATTERN_TYPES = Object.freeze(Object.keys(strategies));

export function createLoadPattern({ vus, durationSeconds, pattern }) {
  const Strategy = strategies[pattern.type];
  if (!Strategy) throw new Error(`Patrón de carga desconocido: ${pattern.type}`);
  return new Strategy({ vus, durationSeconds, pattern });
}
