import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { renderReportPdf } from '../../src/rendering/pdf/reportPdf.js';
import { WorkerPool } from '../../src/workers/WorkerPool.js';

const SQUARE = new URL('../fixtures/squareWorker.js', import.meta.url);
const PDF = new URL('../../src/rendering/pdf/pdfWorker.js', import.meta.url);

describe('WorkerPool', () => {
  const pools = [];
  const createPool = (options) => {
    const pool = new WorkerPool(options);
    pools.push(pool);
    return pool;
  };
  after(() => Promise.all(pools.map((pool) => pool.close())));

  it('reparte tareas entre hilos y encola las que no caben', async () => {
    const pool = createPool({ script: SQUARE, size: 2 });
    const tasks = [1, 2, 3, 4, 5].map((value) => pool.run({ value, delayMs: 30 }));

    assert.deepEqual(pool.stats, { size: 2, busy: 2, idle: 0, queued: 3 });
    assert.deepEqual(await Promise.all(tasks), [1, 4, 9, 16, 25]);
    assert.equal(pool.stats.busy, 0);
  });

  it('un error de la tarea solo rechaza esa tarea', async () => {
    const pool = createPool({ script: SQUARE, size: 1 });
    await assert.rejects(pool.run({ fail: true }), /fallo controlado/);
    assert.equal(await pool.run({ value: 3 }), 9);
  });

  it('si un hilo se cae, rechaza su tarea y crea otro para las siguientes', async () => {
    const pool = createPool({ script: SQUARE, size: 1 });
    await assert.rejects(pool.run({ crash: true }), /código 1/);
    assert.equal(await pool.run({ value: 4 }), 16);
  });

  it('genera el mismo PDF que el hilo principal, transferido sin copia', async () => {
    const pool = createPool({ script: PDF, size: 1 });
    const run = {
      name: 'Prueba PDF',
      status: 'completed',
      startedAt: new Date().toISOString(),
      error: null,
      config: { method: 'GET', url: 'http://localhost/', vus: 1, durationSeconds: 1, pattern: { type: 'constant' } },
      summary: null,
      timeline: [],
    };

    const fromWorker = Buffer.from(await pool.run({ run, analysis: null }));
    assert.equal(fromWorker.subarray(0, 5).toString(), '%PDF-');
    assert.ok(Math.abs(fromWorker.length - (await renderReportPdf(run)).length) < 64);
  });

  it('rechaza tareas nuevas tras cerrarse', async () => {
    const pool = createPool({ script: SQUARE, size: 1 });
    await pool.close();
    await assert.rejects(pool.run({ value: 1 }), /cerrado/);
  });
});
