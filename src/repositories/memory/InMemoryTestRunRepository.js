import { RunStatus } from '../../domain/runStatus.js';

/** Historial en memoria: para desarrollo sin base de datos y para las pruebas. */
export class InMemoryTestRunRepository {
  #runs = new Map();

  async save(run) {
    this.#runs.set(run.id, structuredClone(run));
  }

  async findById(id) {
    const run = this.#runs.get(id);
    return run ? structuredClone(run) : null;
  }

  async findAll({ limit, offset }) {
    const sorted = [...this.#runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const items = sorted.slice(offset, offset + limit).map(({ timeline, ...run }) => structuredClone(run));
    return { items, total: sorted.length };
  }

  async delete(id) {
    return this.#runs.delete(id);
  }

  async failInterrupted(message) {
    let count = 0;
    for (const run of this.#runs.values()) {
      if (run.status === RunStatus.RUNNING) {
        Object.assign(run, { status: RunStatus.FAILED, error: message, finishedAt: new Date().toISOString() });
        count += 1;
      }
    }
    return count;
  }

  async ping() {
    return true;
  }
}
