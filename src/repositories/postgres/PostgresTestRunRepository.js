const iso = (date) => (date ? date.toISOString() : null);

function toRun(row) {
  const run = {
    id: row.id,
    name: row.name,
    status: row.status,
    config: row.config,
    summary: row.summary,
    error: row.error,
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
  if (row.timeline !== undefined) run.timeline = row.timeline;
  return run;
}

export class PostgresTestRunRepository {
  #pool;

  constructor(pool) {
    this.#pool = pool;
  }

  async save(run) {
    await this.#pool.query(
      `INSERT INTO test_runs
         (id, name, status, config, summary, timeline, error, created_at, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         summary = EXCLUDED.summary,
         timeline = EXCLUDED.timeline,
         error = EXCLUDED.error,
         started_at = EXCLUDED.started_at,
         finished_at = EXCLUDED.finished_at`,
      [
        run.id,
        run.name,
        run.status,
        JSON.stringify(run.config),
        run.summary ? JSON.stringify(run.summary) : null,
        JSON.stringify(run.timeline),
        run.error,
        run.createdAt,
        run.startedAt,
        run.finishedAt,
      ],
    );
  }

  async findById(id) {
    const { rows } = await this.#pool.query('SELECT * FROM test_runs WHERE id = $1', [id]);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findAll({ limit, offset }) {
    // El listado omite `timeline`: es la columna más pesada y aquí no se necesita.
    const [page, count] = await Promise.all([
      this.#pool.query(
        `SELECT id, name, status, config, summary, error, created_at, started_at, finished_at
         FROM test_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.#pool.query('SELECT count(*)::int AS total FROM test_runs'),
    ]);
    return { items: page.rows.map(toRun), total: count.rows[0].total };
  }

  async saveAnalysis(id, analysis) {
    await this.#pool.query('UPDATE test_runs SET ai_analysis = $2 WHERE id = $1', [id, JSON.stringify(analysis)]);
  }

  async findAnalysis(id) {
    const { rows } = await this.#pool.query('SELECT ai_analysis FROM test_runs WHERE id = $1', [id]);
    return rows[0]?.ai_analysis ?? null;
  }

  async delete(id) {
    const { rowCount } = await this.#pool.query('DELETE FROM test_runs WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async failInterrupted(message) {
    const { rowCount } = await this.#pool.query(
      `UPDATE test_runs SET status = 'failed', error = $1, finished_at = now()
       WHERE status = 'running'`,
      [message],
    );
    return rowCount;
  }

  async ping() {
    await this.#pool.query('SELECT 1');
    return true;
  }
}
