export class SystemController {
  #serverMetrics;
  #runs;

  constructor({ serverMetrics, runs }) {
    this.#serverMetrics = serverMetrics;
    this.#runs = runs;
  }

  health = async (_req, res) => {
    try {
      await this.#runs.ping();
      res.json({ status: 'ok', database: 'up', uptimeSeconds: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  };

  metrics = (_req, res) => {
    res.json({ success: true, data: this.#serverMetrics.snapshot() });
  };
}
