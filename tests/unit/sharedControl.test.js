import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import { Worker } from 'node:worker_threads';
import { SharedControl } from '../../src/engine/SharedControl.js';

const CONTROL_MODULE = new URL('../../src/engine/SharedControl.js', import.meta.url).href;

/** Un worker que ejecuta `iterations` veces el par requestStarted/requestFinished más una suma extra. */
function hammer(buffer, workerCount, workerIndex, iterations) {
  const code = `
    const { workerData, parentPort } = require('node:worker_threads');
    import(workerData.module).then(({ SharedControl }) => {
      const control = new SharedControl(workerData.buffer, workerData.workerCount);
      for (let i = 0; i < workerData.iterations; i += 1) control.requestStarted(workerData.workerIndex);
      parentPort.postMessage('listo');
    });
  `;
  return new Worker(code, {
    eval: true,
    workerData: { module: CONTROL_MODULE, buffer, workerCount, workerIndex, iterations },
  });
}

describe('SharedControl (memoria compartida entre hilos)', () => {
  it('los workers escriben en la misma memoria que lee el hilo principal, sin perder sumas', async () => {
    const workerCount = 4;
    const control = SharedControl.create(workerCount);
    // Dos workers escriben a la vez en el mismo contador: sin Atomics se perderían incrementos.
    const workers = [0, 0, 1, 2].map((index) => hammer(control.buffer, workerCount, index, 50_000));
    await Promise.all(workers.map((worker) => once(worker, 'message')));
    await Promise.all(workers.map((worker) => worker.terminate()));

    assert.equal(control.totals().inFlight, 200_000);
  });

  it('la bandera de parada se ve de inmediato desde otra vista del mismo buffer', () => {
    const control = SharedControl.create(2);
    const workerView = new SharedControl(control.buffer, 2);

    assert.equal(workerView.stopRequested, false);
    control.requestStop();
    assert.equal(workerView.stopRequested, true);

    workerView.setActiveVus(1, 7);
    workerView.requestStarted(0);
    workerView.requestFinished(0);
    assert.deepEqual(control.totals(), { activeVus: 7, inFlight: 0 });
  });
});
