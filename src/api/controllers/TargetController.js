export class TargetController {
  #targets;

  constructor({ targets }) {
    this.#targets = targets;
  }

  register = async (req, res) => {
    const target = await this.#targets.register(req.valid.body.hostname);
    res.status(201).json({ success: true, data: target });
  };

  list = async (_req, res) => {
    res.json({ success: true, data: await this.#targets.list() });
  };

  verify = async (req, res) => {
    const target = await this.#targets.verify(req.valid.params.id, req.valid.body.method);
    res.json({ success: true, data: target });
  };

  remove = async (req, res) => {
    await this.#targets.remove(req.valid.params.id);
    res.status(204).end();
  };
}
