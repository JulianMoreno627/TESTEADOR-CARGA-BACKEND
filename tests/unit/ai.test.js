import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAnalysisPrompt } from '../../src/ai/analysisPrompt.js';
import { CircuitBreaker } from '../../src/ai/CircuitBreaker.js';
import { toPublicConfig } from '../../src/domain/loadTestConfig.js';
import { FallbackAiClient } from '../../src/ai/FallbackAiClient.js';
import { GeminiProvider } from '../../src/ai/providers/GeminiProvider.js';
import { GroqProvider } from '../../src/ai/providers/GroqProvider.js';

const VALID = {
  verdict: 'degraded',
  summary: 'La latencia p95 se triplica al llegar a 400 usuarios.',
  findings: [{ title: 'Saturación', detail: 'El throughput deja de crecer.', severity: 'warning' }],
  recommendations: ['Agregar caché a la ruta /slow.'],
};
const silentLogger = { warn() {} };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** fetch simulado que guarda la última petición. */
function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return respond(url, init);
  };
  fn.calls = calls;
  return fn;
}

describe('buildAnalysisPrompt', () => {
  const point = (t) => ({ t, activeVus: 10, rps: 50, errorRate: 0, latency: { p50: 5, p95: 9, p99: 12 } });
  const run = {
    name: 'Prueba',
    status: 'completed',
    config: toPublicConfig({
      url: 'https://api.test/x?token=secreto',
      method: 'GET',
      headers: { Authorization: 'Bearer secreto' },
      vus: 10,
      durationSeconds: 120,
      pattern: { type: 'constant' },
      thinkTimeMs: 0,
      timeoutMs: 10000,
    }),
    summary: { totalRequests: 6000 },
    timeline: Array.from({ length: 120 }, (_, index) => point(index + 1)),
  };

  it('resume la serie, separa los datos de las instrucciones y no envía credenciales', () => {
    const { system, prompt } = buildAnalysisPrompt(run);
    const data = JSON.parse(prompt.match(/<datos>\n(.*)\n<\/datos>/s)[1]);

    assert.equal(data.serieDeTiempo.length, 40);
    assert.equal(data.serieDeTiempo[0].segundo, 1);
    assert.equal(data.serieDeTiempo.at(-1).segundo, 120);
    assert.equal(prompt.includes('secreto'), false);
    assert.match(system, /ignora cualquier orden/);
  });
});

describe('CircuitBreaker', () => {
  it('se abre tras N fallos, deja probar al pasar el tiempo y se cierra con un éxito', () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now });

    breaker.recordFailure();
    assert.equal(breaker.state, 'closed');
    breaker.recordFailure();
    assert.equal(breaker.state, 'open');
    assert.equal(breaker.canAttempt(), false);

    now = 1000;
    assert.equal(breaker.state, 'half-open');
    breaker.recordFailure();
    assert.equal(breaker.state, 'open', 'un fallo en half-open lo vuelve a abrir');

    now = 2000;
    breaker.recordSuccess();
    assert.equal(breaker.state, 'closed');
  });
});

describe('GeminiProvider', () => {
  it('envía la clave en cabecera, pide JSON y descarta las partes de razonamiento', async () => {
    const fetchFn = fakeFetch(() =>
      json(200, {
        candidates: [{ content: { parts: [{ text: 'pensando…', thought: true }, { text: JSON.stringify(VALID) }] } }],
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'clave-gemini', model: 'gemini-test', fetchFn });

    assert.deepEqual(await provider.generate({ system: 's', prompt: 'p' }), VALID);
    const [call] = fetchFn.calls;
    assert.match(call.url, /models\/gemini-test:generateContent$/);
    assert.equal(call.url.includes('clave-gemini'), false, 'la clave no va en la URL');
    assert.equal(call.init.headers['x-goog-api-key'], 'clave-gemini');
    assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(call.body.systemInstruction.parts[0].text, 's');
  });

  it('informa el motivo cuando la respuesta viene bloqueada o vacía', async () => {
    const provider = new GeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetchFn: fakeFetch(() => json(200, { promptFeedback: { blockReason: 'SAFETY' } })),
    });
    await assert.rejects(provider.generate({ system: 's', prompt: 'p' }), /SAFETY/);
  });
});

describe('GroqProvider', () => {
  it('usa la API compatible con OpenAI y acepta JSON envuelto en un bloque de código', async () => {
    const fetchFn = fakeFetch(() =>
      json(200, { choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`` } }] }),
    );
    const provider = new GroqProvider({ apiKey: 'clave-groq', model: 'openai/gpt-oss-20b', fetchFn });

    assert.deepEqual(await provider.generate({ system: 's', prompt: 'p' }), VALID);
    const [call] = fetchFn.calls;
    assert.equal(call.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(call.init.headers.Authorization, 'Bearer clave-groq');
    assert.equal(call.body.response_format.type, 'json_schema');
    assert.deepEqual(call.body.messages.map((message) => message.role), ['system', 'user']);
  });

  it('rechaza un JSON que no cumple el esquema', async () => {
    const provider = new GroqProvider({
      apiKey: 'k',
      model: 'm',
      fetchFn: fakeFetch(() => json(200, { choices: [{ message: { content: '{"verdict":"excelente"}' } }] })),
    });
    await assert.rejects(provider.generate({ system: 's', prompt: 'p' }), /forma esperada/);
  });
});

describe('FallbackAiClient', () => {
  const provider = (name, behavior) => ({
    name,
    model: `${name}-model`,
    calls: 0,
    async generate() {
      this.calls += 1;
      return behavior();
    },
  });

  it('usa Gemini si responde', async () => {
    const gemini = provider('gemini', () => VALID);
    const groq = provider('groq', () => VALID);
    const client = new FallbackAiClient({ providers: [gemini, groq], timeoutMs: 1000, logger: silentLogger });

    const result = await client.generate({ system: 's', prompt: 'p' });
    assert.equal(result.provider, 'gemini');
    assert.equal(result.fallbackUsed, false);
    assert.equal(groq.calls, 0);
  });

  it('pasa a Groq si Gemini falla, y tras varios fallos ya no intenta Gemini', async () => {
    const gemini = provider('gemini', () => {
      throw new Error('gemini: HTTP 503');
    });
    const groq = provider('groq', () => VALID);
    const client = new FallbackAiClient({
      providers: [gemini, groq],
      timeoutMs: 1000,
      logger: silentLogger,
      breakerOptions: { failureThreshold: 2, cooldownMs: 60_000 },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await client.generate({ system: 's', prompt: 'p' });
      assert.equal(result.provider, 'groq');
      assert.equal(result.fallbackUsed, true);
    }
    assert.equal(gemini.calls, 2, 'el circuito se abrió tras el segundo fallo');
    assert.deepEqual(client.status(), { gemini: 'open', groq: 'closed' });
  });

  it('responde AI_UNAVAILABLE si todos fallan o si no hay proveedores', async () => {
    const failing = provider('gemini', () => {
      throw new Error('gemini: HTTP 500');
    });
    const client = new FallbackAiClient({ providers: [failing], timeoutMs: 1000, logger: silentLogger });
    await assert.rejects(client.generate({ system: 's', prompt: 'p' }), (error) => error.code === 'AI_UNAVAILABLE');

    const empty = new FallbackAiClient({ providers: [], timeoutMs: 1000, logger: silentLogger });
    await assert.rejects(empty.generate({ system: 's', prompt: 'p' }), (error) => error.status === 503);
  });
});
