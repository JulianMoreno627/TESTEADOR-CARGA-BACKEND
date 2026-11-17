export class InMemoryTargetRepository {
  #targets = new Map();

  async save(target) {
    this.#targets.set(target.id, { ...target });
  }

  async findById(id) {
    const target = this.#targets.get(id);
    return target ? { ...target } : null;
  }

  async findByHostname(hostname) {
    const target = [...this.#targets.values()].find((item) => item.hostname === hostname);
    return target ? { ...target } : null;
  }

  async findAll() {
    return [...this.#targets.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((target) => ({ ...target }));
  }

  async delete(id) {
    return this.#targets.delete(id);
  }
}
