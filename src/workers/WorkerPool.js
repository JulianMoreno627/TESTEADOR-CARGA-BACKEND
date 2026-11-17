import { Worker } from 'node:worker_threads';

/**
 * Pool de Worker Threads para tareas de CPU (por ejemplo, generar PDF).
 *
 * El motor de carga crea workers por prueba porque cada prueba es larga. Una tarea
 * corta, en cambio, no debe pagar el arranque de un hilo cada vez: el pool mantiene
 * pocos hilos vivos y reparte las tareas, con una cola cuando todos están ocupados.
 *
 * Protocolo con el script del worker:
 *   principal -> worker: { id, payload }
 *   worker -> principal: { id, result } | { id, error }
 */
export class WorkerPool {
  #script;
  #size;
  #idleTimeoutMs;
  #idle = [];
  #busy = new Map();
  #queue = [];
  #nextId = 0;
  #closed = false;

  constructor({ script, size = 1, idleTimeoutMs = 30_000 }) {
    this.#script = script;
    this.#size = size;
    this.#idleTimeoutMs = idleTimeoutMs;
  }

  get stats() {
    return { size: this.#size, busy: this.#busy.size, idle: this.#idle.length, queued: this.#queue.length };
  }

  run(payload) {
    if (this.#closed) return Promise.reject(new Error('El pool de workers está cerrado.'));
    return new Promise((resolve, reject) => {
      this.#queue.push({ id: (this.#nextId += 1), payload, resolve, reject });
      this.#dispatch();
    });
  }

  async close() {
    this.#closed = true;
    for (const task of this.#queue.splice(0)) task.reject(new Error('El pool de workers se cerró.'));
    const workers = [...this.#idle.map(({ thread }) => thread), ...this.#busy.keys()];
    this.#idle = [];
    await Promise.all(workers.map((thread) => thread.terminate()));
  }

  #dispatch() {
    while (this.#queue.length > 0) {
      const entry = this.#idle.pop() ?? (this.#busy.size < this.#size ? { thread: this.#spawn() } : null);
      if (!entry) return;

      clearTimeout(entry.idleTimer);
      const task = this.#queue.shift();
      this.#busy.set(entry.thread, task);
      entry.thread.postMessage({ id: task.id, payload: task.payload });
    }
  }

  #spawn() {
    const thread = new Worker(this.#script);
    // Sin trabajo pendiente, el hilo no debe impedir que el proceso termine.
    thread.unref();

    thread.on('message', ({ id, result, error }) => {
      const task = this.#busy.get(thread);
      if (!task || task.id !== id) return;
      this.#busy.delete(thread);
      if (error) task.reject(new Error(error));
      else task.resolve(result);
      this.#release(thread);
    });

    // Si el hilo muere, su tarea falla y el pool crea otro cuando haga falta.
    const onCrash = (error) => {
      const task = this.#busy.get(thread);
      this.#busy.delete(thread);
      this.#idle = this.#idle.filter((entry) => entry.thread !== thread);
      task?.reject(error instanceof Error ? error : new Error(`El worker terminó con código ${error}.`));
      if (!this.#closed) this.#dispatch();
    };
    thread.once('error', onCrash);
    thread.once('exit', (code) => {
      if (this.#busy.has(thread)) onCrash(code);
    });

    return thread;
  }

  #release(thread) {
    if (this.#closed) {
      thread.terminate();
      return;
    }
    // Un hilo inactivo se cierra tras un rato para liberar memoria (en Render hay 512 MB).
    const entry = { thread };
    entry.idleTimer = setTimeout(() => {
      this.#idle = this.#idle.filter((candidate) => candidate !== entry);
      thread.terminate();
    }, this.#idleTimeoutMs);
    entry.idleTimer.unref();
    this.#idle.push(entry);
    this.#dispatch();
  }
}
