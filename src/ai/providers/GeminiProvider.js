import { AiProviderError } from '../AiProviderError.js';
import { parseModelJson } from '../parseModelJson.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Proveedor principal: Google Gemini mediante su API REST (generateContent). */
export class GeminiProvider {
  name = 'gemini';
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
      response = await this.#fetch(`${API_BASE}/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        signal,
        // La clave va en una cabecera, no en la URL, para que no quede en logs de proxies.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.#apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2048 },
        }),
      });
    } catch (error) {
      throw new AiProviderError(this.name, error.name === 'TimeoutError' ? 'tiempo de espera agotado' : 'sin conexión', { cause: error });
    }

    if (!response.ok) {
      throw new AiProviderError(this.name, `HTTP ${response.status}`, { status: response.status });
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    // Los modelos con razonamiento pueden incluir partes de "pensamiento": se descartan.
    const text = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? '').join('');
    if (!text) {
      const reason = data.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'respuesta vacía';
      throw new AiProviderError(this.name, `sin contenido (${reason})`);
    }
    return parseModelJson(this.name, text);
  }
}
