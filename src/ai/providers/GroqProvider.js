import { analysisJsonSchema } from '../analysisSchema.js';
import { AiProviderError } from '../AiProviderError.js';
import { parseModelJson } from '../parseModelJson.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** Proveedor de respaldo: Groq, con su API compatible con la de OpenAI. */
export class GroqProvider {
  name = 'groq';
  #apiKey;
  #fetch;
  model;

  constructor({ apiKey, model, fetchFn = fetch }) {
    this.#apiKey = apiKey;
    this.model = model;
    this.#fetch = fetchFn;
  }

  async generate({ system, prompt, signal }) {
    let response;
    try {
      response = await this.#fetch(ENDPOINT, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          // Salida estructurada en modo "best effort"; de todas formas se valida al recibirla.
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'load_test_analysis', strict: false, schema: analysisJsonSchema },
          },
          temperature: 0.2,
          max_completion_tokens: 4096,
        }),
      });
    } catch (error) {
      throw new AiProviderError(this.name, error.name === 'TimeoutError' ? 'tiempo de espera agotado' : 'sin conexión', { cause: error });
    }

    if (!response.ok) {
      throw new AiProviderError(this.name, `HTTP ${response.status}`, { status: response.status });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new AiProviderError(this.name, `sin contenido (${data.choices?.[0]?.finish_reason ?? 'respuesta vacía'})`);
    return parseModelJson(this.name, text);
  }
}
