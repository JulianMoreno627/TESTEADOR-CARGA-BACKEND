const iso = (date) => (date ? date.toISOString() : null);

function toTarget(row) {
  return {
    id: row.id,
    hostname: row.hostname,
    token: row.token,
    method: row.method,
    verifiedAt: iso(row.verified_at),
    createdAt: iso(row.created_at),
  };
}

export class PostgresTargetRepository {
  #pool;

  constructor(pool) {
    this.#pool = pool;
  }

  async save(target) {
    await this.#pool.query(
      `INSERT INTO targets (id, hostname, token, method, verified_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         method = EXCLUDED.method,
         verified_at = EXCLUDED.verified_at`,
      [target.id, target.hostname, target.token, target.method, target.verifiedAt, target.createdAt],
    );
  }

  async findById(id) {
    const { rows } = await this.#pool.query('SELECT * FROM targets WHERE id = $1', [id]);
    return rows[0] ? toTarget(rows[0]) : null;
  }

  async findByHostname(hostname) {
    const { rows } = await this.#pool.query('SELECT * FROM targets WHERE hostname = $1', [hostname]);
    return rows[0] ? toTarget(rows[0]) : null;
  }

  async findAll() {
    const { rows } = await this.#pool.query('SELECT * FROM targets ORDER BY created_at DESC');
    return rows.map(toTarget);
  }

  async delete(id) {
    const { rowCount } = await this.#pool.query('DELETE FROM targets WHERE id = $1', [id]);
    return rowCount > 0;
  }
}
