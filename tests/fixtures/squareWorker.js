import { parentPort } from 'node:worker_threads';

// Worker de prueba para WorkerPool: eleva al cuadrado, espera un poco o se cae a propósito.
parentPort.on('message', async ({ id, payload }) => {
  if (payload.crash) process.exit(1);
  if (payload.fail) {
    parentPort.postMessage({ id, error: 'fallo controlado' });
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, payload.delayMs ?? 0));
  parentPort.postMessage({ id, result: payload.value ** 2 });
});
