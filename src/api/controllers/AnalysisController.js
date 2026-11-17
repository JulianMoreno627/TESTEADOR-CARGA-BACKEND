export class AnalysisController {
  #analyses;

  constructor({ analyses }) {
    this.#analyses = analyses;
  }

  get = async (req, res) => {
    res.json({ success: true, data: await this.#analyses.get(req.valid.params.id) });
  };

  create = async (req, res) => {
    res.json({ success: true, data: await this.#analyses.create(req.valid.params.id) });
  };
}
