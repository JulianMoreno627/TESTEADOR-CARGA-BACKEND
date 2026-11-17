import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { io as connectSocket } from 'socket.io-client';
import { buildServer } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/shared/logger.js';

describe('flujo completo de una prueba de carga', () => {
  let target;
  let targetUrl;
  let server;
  let apiUrl;
  let socket;
  let reportsDir;
  let targetHits = 0;
  let lastTargetHeaders;

  const api = (route, options = {}) =>
    fetch(`${apiUrl}${route}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

  const startTest = async (body) => {
    const response = await api('/api/v1/load-tests', { method: 'POST', body });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).data;
  };

  const waitForFinish = async (id) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { data } = await (await api(`/api/v1/load-tests/${id}`)).json();
      if (data.status !== 'running') return data;
      await sleep(100);
    }
    throw new Error('La prueba no terminó a tiempo');
  };

  before(async () => {
    target = createServer((req, res) => {
      targetHits += 1;
      lastTargetHeaders = req.headers;
      const pathname = new URL(req.url, 'http://x').pathname;
      if (pathname === '/error') {
        res.writeHead(500).end('fallo');
      } else {
        setTimeout(() => res.writeHead(200).end('{"ok":true}'), 5);
      }
    });
    target.listen(0, '127.0.0.1');
    await once(target, 'listening');
    targetUrl = `http://localhost:${target.address().port}`;

    reportsDir = await mkdtemp(path.join(os.tmpdir(), 'load-tester-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '0',
      LOG_LEVEL: 'silent',
      REPORTS_DIR: reportsDir,
      MAX_CONCURRENT_TESTS: '1',
      VUS_PER_WORKER: '5',
      METRICS_INTERVAL_MS: '200',
      RATE_LIMIT_PER_MINUTE: '1000',
    });
    server = await buildServer(config, createLogger('silent'));
    const { port } = await server.listen();
    apiUrl = `http://127.0.0.1:${port}`;

    socket = connectSocket(apiUrl, { transports: ['websocket'] });
    await once(socket, 'connect');
  });

  after(async () => {
    socket?.close();
    await server?.shutdown();
    target?.closeAllConnections();
    target?.close();
    await rm(reportsDir, { recursive: true, force: true });
  });

  it('ejecuta la prueba con workers y transmite métricas por WebSocket', async () => {
    const points = [];
    socket.on('test:metrics', (message) => points.push(message));
    const finished = once(socket, 'test:finished');

    const run = await startTest({
      name: 'Caso <b>feliz</b>',
      url: `${targetUrl}/ok?api_key=secreta`,
      vus: 12,
      durationSeconds: 2,
      headers: { Authorization: 'Bearer secreta' },
      pattern: { type: 'ramp', startVus: 2, rampSeconds: 1 },
    });

    const ack = await socket.emitWithAck('test:subscribe', run.id);
    assert.equal(ack.ok, true);
    assert.equal(ack.run.id, run.id);

    const metrics = await (await api('/api/v1/metrics')).json();
    assert.equal(metrics.data.gauges.activeLoadTests, 1);
    // 12 VUs a 5 por worker requieren 3 workers.
    assert.equal(metrics.data.gauges.activeWorkers, 3);
    // Leído de la memoria compartida con los workers, no de los lotes.
    assert.ok(metrics.data.gauges.inFlightRequests >= 0 && metrics.data.gauges.inFlightRequests <= 12);

    const [finishedEvent] = await finished;
    const result = await waitForFinish(run.id);

    assert.equal(finishedEvent.id, run.id);
    assert.equal(result.status, 'completed');
    assert.ok(points.length >= 3, `se recibieron ${points.length} puntos`);
    assert.ok(points.at(-1).totals.requests > 0);

    const { summary } = result;
    assert.ok(summary.totalRequests > 50, `peticiones: ${summary.totalRequests}`);
    assert.equal(summary.failedRequests, 0);
    assert.equal(summary.peakVus, 12);
    assert.equal(summary.statusCodes['200'], summary.totalRequests);
    assert.ok(summary.latency.p50 >= 4, `p50: ${summary.latency.p50}`);
    assert.ok(summary.latency.p50 <= summary.latency.p95);
    assert.ok(summary.latency.p95 <= summary.latency.p99);
    assert.ok(summary.latency.p99 <= summary.latency.max);
    assert.ok(Math.abs(summary.durationSeconds - 2) < 0.5);

    assert.ok(lastTargetHeaders['x-load-test-id'], 'el tráfico se identifica');
    assert.equal(lastTargetHeaders.authorization, 'Bearer secreta', 'el header real sí se envía');
    assert.equal(JSON.stringify(result).includes('secreta'), false, 'la credencial no se guarda');

    // Generadores detenidos: sin nuevas peticiones al destino.
    const hitsAfterFinish = targetHits;
    await sleep(300);
    assert.equal(targetHits, hitsAfterFinish);
  });

  it('cuenta los errores HTTP y distingue el tipo', async () => {
    const run = await startTest({ url: `${targetUrl}/error`, vus: 2, durationSeconds: 1, thinkTimeMs: 20 });
    const { summary } = await waitForFinish(run.id);
    assert.equal(summary.errorRate, 1);
    assert.equal(summary.errorTypes.HTTP_500, summary.totalRequests);
  });

  it('registra fallos de red sin distorsionar los percentiles', async () => {
    const closed = createServer();
    closed.listen(0, '127.0.0.1');
    await once(closed, 'listening');
    const { port } = closed.address();
    closed.close();
    await once(closed, 'close');

    const run = await startTest({ url: `http://127.0.0.1:${port}/`, vus: 2, durationSeconds: 1 });
    const { summary, status } = await waitForFinish(run.id);
    assert.equal(status, 'completed');
    assert.equal(summary.errorRate, 1);
    assert.ok(summary.errorTypes.ECONNREFUSED > 0);
    assert.equal(summary.latency.p95, null);
  });

  it('permite detener una prueba y rechaza otra si no hay cupo', async () => {
    const run = await startTest({ url: `${targetUrl}/ok`, vus: 3, durationSeconds: 60 });

    const rejected = await api('/api/v1/load-tests', {
      method: 'POST',
      body: { url: `${targetUrl}/ok`, vus: 1, durationSeconds: 1 },
    });
    assert.equal(rejected.status, 429);
    assert.equal((await rejected.json()).error.code, 'CAPACITY_EXCEEDED');

    const reportEarly = await api(`/api/v1/load-tests/${run.id}/report`);
    assert.equal(reportEarly.status, 409);
    assert.equal((await api(`/api/v1/load-tests/${run.id}`, { method: 'DELETE' })).status, 409);

    await sleep(500);
    const stopped = await api(`/api/v1/load-tests/${run.id}/stop`, { method: 'POST' });
    assert.equal(stopped.status, 200);

    const result = await waitForFinish(run.id);
    assert.equal(result.status, 'stopped');
    assert.ok(result.summary.durationSeconds < 5);
    assert.ok(result.summary.totalRequests > 0);

    assert.equal((await api(`/api/v1/load-tests/${run.id}/stop`, { method: 'POST' })).status, 409);
  });

  it('valida la entrada y responde con errores uniformes', async () => {
    const invalid = await api('/api/v1/load-tests', { method: 'POST', body: { url: 'nada', vus: 0 } });
    assert.equal(invalid.status, 422);
    const { error } = await invalid.json();
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.ok(error.details.some((detail) => detail.field === 'vus'));

    assert.equal((await api('/api/v1/load-tests/no-es-uuid')).status, 422);
    assert.equal((await api('/api/v1/load-tests/7f8c1f5e-3d55-4d43-9a6e-111111111111')).status, 404);
    assert.equal((await api('/ruta/inexistente')).status, 404);

    const malformed = await fetch(`${apiUrl}/api/v1/load-tests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{mal',
    });
    assert.equal(malformed.status, 400);
  });

  it('bloquea destinos públicos sin verificar', async () => {
    const response = await api('/api/v1/load-tests', {
      method: 'POST',
      body: { url: 'http://169.254.169.254/latest/meta-data', vus: 1, durationSeconds: 1 },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'TARGET_PRIVATE_NETWORK');
  });

  it('entrega reportes y vistas con los patrones de renderizado', async () => {
    const baseline = await startTest({ name: 'Base', url: `${targetUrl}/ok`, vus: 2, durationSeconds: 1 });
    await waitForFinish(baseline.id);
    const candidate = await startTest({ name: 'Caso <b>nuevo</b>', url: `${targetUrl}/ok`, vus: 4, durationSeconds: 1 });
    await waitForFinish(candidate.id);

    // JSON descargable.
    const json = await api(`/api/v1/load-tests/${baseline.id}/report`);
    assert.match(json.headers.get('content-disposition'), /attachment/);
    assert.equal((await json.json()).id, baseline.id);

    // PDF descargable.
    const pdf = await api(`/api/v1/load-tests/${baseline.id}/report?format=pdf`);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const pdfBytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');

    // SSG: archivo estático con revalidación condicional.
    const reportUrl = `${apiUrl}/views/reports/${candidate.id}`;
    const report = await fetch(reportUrl);
    const reportHtml = await report.text();
    assert.equal(report.headers.get('x-render-strategy'), 'SSG');
    assert.match(reportHtml, /<svg/);
    assert.equal(reportHtml.includes('<b>nuevo</b>'), false, 'el nombre se escapa');
    assert.ok(reportHtml.includes('<script src="/views/theme.js"></script>'), 'carga el script del tema');
    assert.equal(reportHtml.includes('prefers-color-scheme'), false, 'claro por defecto, sin seguir al sistema operativo');
    const themeScript = await fetch(`${apiUrl}/views/theme.js`);
    assert.match(themeScript.headers.get('content-type'), /javascript/);
    assert.match(await themeScript.text(), /localStorage/);
    const etag = report.headers.get('etag');
    assert.ok(etag);
    // Con http.get porque fetch añade Cache-Control: no-cache, que obliga a responder 200.
    const [revalidated] = await once(get(reportUrl, { headers: { 'If-None-Match': etag } }), 'response');
    revalidated.resume();
    assert.equal(revalidated.statusCode, 304);

    // ISR: responde desde caché y se renueva en segundo plano.
    const firstHistory = await fetch(`${apiUrl}/views/history`);
    assert.equal(firstHistory.headers.get('x-render-strategy'), 'ISR');
    const historyHtml = await firstHistory.text();
    assert.ok(['MISS', 'STALE'].includes(firstHistory.headers.get('x-cache')));
    await sleep(50);
    const cachedHistory = await fetch(`${apiUrl}/views/history`);
    assert.equal(cachedHistory.headers.get('x-cache'), 'HIT');
    assert.match(cachedHistory.headers.get('server-timing'), /total;dur=/);
    assert.ok(historyHtml.includes('Historial de pruebas'));

    // SSR: comparación generada por petición.
    const compareView = await fetch(`${apiUrl}/views/compare?baseline=${baseline.id}&candidate=${candidate.id}`);
    assert.equal(compareView.headers.get('x-render-strategy'), 'SSR');
    assert.match(await compareView.text(), /Veredicto/);
    const emptyCompare = await fetch(`${apiUrl}/views/compare?baseline=&candidate=`);
    assert.equal(emptyCompare.status, 200);

    // Comparación por API.
    const comparison = await api(`/api/v1/load-tests/compare?baseline=${baseline.id}&candidate=${candidate.id}`);
    const { data } = await comparison.json();
    assert.equal(data.metrics.length, 5);

    // Listado paginado sin la serie de tiempo.
    const list = await (await api('/api/v1/load-tests?limit=2')).json();
    assert.equal(list.data.length, 2);
    assert.ok(list.meta.total >= 2);
    assert.equal('timeline' in list.data[0], false);

    // Borrar elimina también el reporte estático.
    assert.equal((await api(`/api/v1/load-tests/${candidate.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(reportUrl)).status, 404);
  });

  it('expone salud y métricas del servidor', async () => {
    const health = await (await api('/health')).json();
    assert.equal(health.status, 'ok');

    const { data } = await (await api('/api/v1/metrics')).json();
    assert.ok(data.memoryMb.rss > 0);
    assert.ok(data.routes['POST /api/v1/load-tests/'].count > 0);
    assert.equal(data.gauges.socketClients, 1);
  });

  it('avisa a la suscripción cuando la prueba no existe', async () => {
    const missing = await socket.emitWithAck('test:subscribe', '7f8c1f5e-3d55-4d43-9a6e-111111111111');
    assert.equal(missing.ok, false);
    const invalid = await socket.emitWithAck('test:subscribe', 'x');
    assert.equal(invalid.ok, false);
  });
});
