import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildServer } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/shared/logger.js';
import { createContractValidator } from './contractValidator.js';

// Operaciones definidas en el contrato que todavía no están implementadas.
const PENDING = new Set();

/** IA simulada: las pruebas no gastan cuota ni dependen de la red. */
const fakeAiClient = {
  calls: 0,
  async generate() {
    this.calls += 1;
    return {
      provider: 'gemini',
      model: 'gemini-test',
      fallbackUsed: false,
      durationMs: 12,
      content: {
        verdict: 'healthy',
        summary: 'La API respondió sin errores durante toda la prueba.',
        findings: [{ title: 'Latencia estable', detail: 'El p95 se mantuvo bajo 10 ms.', severity: 'info' }],
        recommendations: ['Repetir la prueba con más usuarios para encontrar el límite.'],
      },
    };
  },
};
const UNKNOWN_ID = '7f8c1f5e-3d55-4d43-9a6e-111111111111';

describe('la API cumple el contrato OpenAPI', () => {
  const contract = createContractValidator();
  const covered = new Set();
  let server;
  let target;
  let apiUrl;
  let targetUrl;
  let reportsDir;

  /** Hace la petición, valida la respuesta contra el contrato y la devuelve. */
  async function call(method, contractPath, { params = {}, query = '', body } = {}) {
    const url = contractPath.replace(/\{(\w+)\}/g, (_, name) => params[name]);
    const response = await fetch(`${apiUrl}${url}${query}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const isJson = response.headers.get('content-type')?.includes('application/json');
    const payload = isJson ? await response.json() : await response.arrayBuffer();
    covered.add(contract.validate(method, contractPath, response.status, payload));
    return { status: response.status, body: payload };
  }

  const waitForFinish = async (id) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const { body } = await call('GET', '/api/v1/load-tests/{id}', { params: { id } });
      if (body.data.status !== 'running') return body.data;
      await sleep(100);
    }
    throw new Error('La prueba no terminó a tiempo');
  };

  before(async () => {
    target = createServer((_req, res) => res.end('ok'));
    target.listen(0, '127.0.0.1');
    await once(target, 'listening');
    targetUrl = `http://localhost:${target.address().port}/`;

    reportsDir = await mkdtemp(path.join(os.tmpdir(), 'load-tester-contract-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '0',
      LOG_LEVEL: 'silent',
      REPORTS_DIR: reportsDir,
      METRICS_INTERVAL_MS: '200',
      RATE_LIMIT_PER_MINUTE: '1000',
    });

    // Un dominio público simulado, para recorrer el flujo de verificación sin red.
    let token;
    const resolve = async (hostname) =>
      hostname === 'localhost' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];
    server = await buildServer(config, createLogger('silent'), {
      policy: { resolve },
      targetService: { fetchFile: async () => token },
      aiClient: fakeAiClient,
    });
    server.setVerificationToken = (value) => {
      token = value;
    };
    apiUrl = `http://127.0.0.1:${(await server.listen()).port}`;
  });

  after(async () => {
    await server?.shutdown();
    target?.close();
    await rm(reportsDir, { recursive: true, force: true });
  });

  it('sistema', async () => {
    assert.equal((await call('GET', '/health')).status, 200);
    assert.equal((await call('GET', '/health/live')).status, 200);
    assert.equal((await call('GET', '/api/v1/metrics')).status, 200);
  });

  it('ciclo de vida de una prueba', async () => {
    const invalid = await call('POST', '/api/v1/load-tests', { body: { url: 'x', vus: 0 } });
    assert.equal(invalid.status, 422);

    const forbidden = await call('POST', '/api/v1/load-tests', {
      body: { url: 'https://publico.test/', vus: 1, durationSeconds: 1 },
    });
    assert.equal(forbidden.status, 403);

    const first = await call('POST', '/api/v1/load-tests', {
      body: { name: 'Contrato', url: targetUrl, vus: 2, durationSeconds: 1, pattern: { type: 'ramp' } },
    });
    assert.equal(first.status, 201);
    const baseline = await waitForFinish(first.body.data.id);

    const long = await call('POST', '/api/v1/load-tests', { body: { url: targetUrl, vus: 1, durationSeconds: 30 } });
    const stopped = await call('POST', '/api/v1/load-tests/{id}/stop', { params: { id: long.body.data.id } });
    assert.equal(stopped.status, 200);
    const candidate = await waitForFinish(long.body.data.id);
    assert.equal((await call('POST', '/api/v1/load-tests/{id}/stop', { params: { id: candidate.id } })).status, 409);

    assert.equal((await call('GET', '/api/v1/load-tests', { query: '?limit=5' })).status, 200);
    assert.equal((await call('GET', '/api/v1/load-tests/{id}', { params: { id: UNKNOWN_ID } })).status, 404);

    const comparison = await call('GET', '/api/v1/load-tests/compare', {
      query: `?baseline=${baseline.id}&candidate=${candidate.id}`,
    });
    assert.equal(comparison.status, 200);

    const report = await call('GET', '/api/v1/load-tests/{id}/report', { params: { id: baseline.id } });
    assert.equal(report.status, 200);

    // Análisis con IA: no existe, se genera una vez y luego se sirve guardado.
    const analysisPath = '/api/v1/load-tests/{id}/analysis';
    assert.equal((await call('GET', analysisPath, { params: { id: baseline.id } })).body.error.code, 'ANALYSIS_NOT_FOUND');
    const reportBefore = await (await fetch(`${apiUrl}/views/reports/${baseline.id}`)).text();
    assert.equal(reportBefore.includes('Análisis con IA'), false);

    const created = await call('POST', analysisPath, { params: { id: baseline.id } });
    assert.equal(created.status, 200);
    assert.equal(created.body.data.runId, baseline.id);
    const again = await call('POST', analysisPath, { params: { id: baseline.id } });
    assert.deepEqual(again.body.data, created.body.data);
    assert.equal(fakeAiClient.calls, 1, 'el segundo POST devuelve el análisis guardado');
    assert.equal((await call('GET', analysisPath, { params: { id: baseline.id } })).status, 200);
    assert.equal((await call('POST', analysisPath, { params: { id: UNKNOWN_ID } })).status, 404);

    // El reporte estático se regeneró para incluir el análisis.
    const reportAfter = await (await fetch(`${apiUrl}/views/reports/${baseline.id}`)).text();
    assert.match(reportAfter, /Análisis con IA/);
    const pdf = await fetch(`${apiUrl}/api/v1/load-tests/${baseline.id}/report?format=pdf`);
    assert.equal(pdf.status, 200);

    assert.equal((await call('DELETE', '/api/v1/load-tests/{id}', { params: { id: candidate.id } })).status, 204);
    assert.equal((await call('DELETE', '/api/v1/load-tests/{id}', { params: { id: candidate.id } })).status, 404);
  });

  it('dominios verificados', async () => {
    const registered = await call('POST', '/api/v1/targets', { body: { hostname: 'api.propio.test' } });
    assert.equal(registered.status, 201);
    const { id, token } = registered.body.data;

    assert.equal((await call('POST', '/api/v1/targets/{id}/verify', { params: { id }, body: { method: 'http' } })).status, 409);
    server.setVerificationToken(token);
    assert.equal((await call('POST', '/api/v1/targets/{id}/verify', { params: { id }, body: { method: 'http' } })).status, 200);

    assert.equal((await call('GET', '/api/v1/targets')).status, 200);
    assert.equal((await call('DELETE', '/api/v1/targets/{id}', { params: { id } })).status, 204);
  });

  it('detecta una respuesta que se sale del contrato', () => {
    const broken = { success: true, data: { status: 'ok', database: 'up' } };
    assert.throws(() => contract.validate('GET', '/api/v1/metrics', 200, broken), /no cumple el contrato/);
    assert.throws(() => contract.validate('GET', '/health', 418, {}), /no documenta/);
  });

  it('publica el contrato para el frontend', async () => {
    const response = await fetch(`${apiUrl}/api/v1/openapi.yaml`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /^openapi: 3\.1/);
  });

  it('todas las operaciones del contrato están probadas', () => {
    const missing = contract.operationIds.filter((id) => !covered.has(id) && !PENDING.has(id));
    assert.deepEqual(missing, []);
  });
});
