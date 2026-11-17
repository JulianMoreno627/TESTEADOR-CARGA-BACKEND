export class LoadTestController {
  #loadTests;
  #reports;

  constructor({ loadTests, reports }) {
    this.#loadTests = loadTests;
    this.#reports = reports;
  }

  start = async (req, res) => {
    const run = await this.#loadTests.start(req.valid.body);
    res.status(201).location(`/api/v1/load-tests/${run.id}`).json({ success: true, data: run });
  };

  stop = async (req, res) => {
    const run = await this.#loadTests.stop(req.valid.params.id);
    res.json({ success: true, data: run });
  };

  list = async (req, res) => {
    const { limit, offset } = req.valid.query;
    const { items, total } = await this.#loadTests.list({ limit, offset });
    res.json({ success: true, data: items, meta: { total, limit, offset } });
  };

  getById = async (req, res) => {
    const run = await this.#loadTests.getById(req.valid.params.id);
    res.json({ success: true, data: run });
  };

  compare = async (req, res) => {
    const { baseline, candidate } = req.valid.query;
    const comparison = await this.#loadTests.compare(baseline, candidate);
    res.json({ success: true, data: comparison });
  };

  remove = async (req, res) => {
    await this.#loadTests.remove(req.valid.params.id);
    res.status(204).end();
  };

  downloadReport = async (req, res) => {
    const { id } = req.valid.params;

    if (req.valid.query.format === 'pdf') {
      const filePath = await this.#reports.pdfPath(id);
      res.attachment(`reporte-carga-${id}.pdf`);
      res.sendFile(filePath, { maxAge: '1h', dotfiles: 'allow' });
      return;
    }

    const run = await this.#reports.buildJson(id);
    res.attachment(`reporte-carga-${id}.json`).json(run);
  };
}
