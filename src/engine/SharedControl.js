// Distribución del bloque de memoria compartida (enteros de 32 bits):
//   [0]            bandera de parada (0 = seguir, 1 = parar)
//   [1 + 2*i]      usuarios virtuales activos del worker i
//   [1 + 2*i + 1]  peticiones en vuelo del worker i
const STOP = 0;
const HEADER = 1;
const FIELDS_PER_WORKER = 2;
const ACTIVE_VUS = 0;
const IN_FLIGHT = 1;

/**
 * Memoria compartida entre el hilo principal y los workers.
 *
 * Complementa los mensajes (postMessage): un mensaje copia los datos y llega cuando
 * el otro hilo lo atiende; la memoria compartida no copia nada y se lee al instante.
 * El precio es que dos hilos pueden escribir a la vez, por eso toda lectura y
 * escritura usa Atomics, que hace cada operación indivisible.
 *
 * - La bandera de parada detiene a los usuarios virtuales aunque el mensaje "stop"
 *   aún espere en la cola del worker.
 * - Los contadores permiten consultar la carga actual sin esperar el próximo lote.
 */
export class SharedControl {
  #view;
  #workerCount;

  constructor(buffer, workerCount) {
    this.#view = new Int32Array(buffer);
    this.#workerCount = workerCount;
  }

  static create(workerCount) {
    const bytes = Int32Array.BYTES_PER_ELEMENT * (HEADER + FIELDS_PER_WORKER * workerCount);
    return new SharedControl(new SharedArrayBuffer(bytes), workerCount);
  }

  /** El SharedArrayBuffer se envía a los workers sin copiarse: todos ven la misma memoria. */
  get buffer() {
    return this.#view.buffer;
  }

  requestStop() {
    Atomics.store(this.#view, STOP, 1);
  }

  get stopRequested() {
    return Atomics.load(this.#view, STOP) === 1;
  }

  setActiveVus(workerIndex, count) {
    Atomics.store(this.#view, this.#slot(workerIndex, ACTIVE_VUS), count);
  }

  requestStarted(workerIndex) {
    Atomics.add(this.#view, this.#slot(workerIndex, IN_FLIGHT), 1);
  }

  requestFinished(workerIndex) {
    Atomics.sub(this.#view, this.#slot(workerIndex, IN_FLIGHT), 1);
  }

  totals() {
    let activeVus = 0;
    let inFlight = 0;
    for (let index = 0; index < this.#workerCount; index += 1) {
      activeVus += Atomics.load(this.#view, this.#slot(index, ACTIVE_VUS));
      inFlight += Atomics.load(this.#view, this.#slot(index, IN_FLIGHT));
    }
    return { activeVus, inFlight };
  }

  #slot(workerIndex, field) {
    return HEADER + FIELDS_PER_WORKER * workerIndex + field;
  }
}
