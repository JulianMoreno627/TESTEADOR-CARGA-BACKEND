import { Server } from 'socket.io';
import { z } from 'zod';
import { NotFoundError } from '../shared/errors.js';

const SERVER_METRICS_INTERVAL_MS = 5_000;
const testIdSchema = z.uuid();
const roomOf = (testId) => `test:${testId}`;

/**
 * Canal en tiempo real. Cada cliente se suscribe solo a la prueba que está viendo.
 *
 * Cliente -> servidor: 'test:subscribe' (testId, ack) | 'test:unsubscribe' (testId)
 * Servidor -> cliente: 'test:started' | 'test:metrics' | 'test:finished' | 'server:metrics'
 */
export class SocketGateway {
  #io;
  #loadTests;
  #serverMetrics;
  #logger;
  #metricsTimer = null;

  constructor({ httpServer, corsOrigins, loadTests, serverMetrics, logger }) {
    this.#loadTests = loadTests;
    this.#serverMetrics = serverMetrics;
    this.#logger = logger;
    this.#io = new Server(httpServer, { cors: { origin: corsOrigins } });

    this.#io.on('connection', (socket) => this.#handleConnection(socket));
    this.#bindServiceEvents();
    this.#metricsTimer = setInterval(() => {
      this.#io.volatile.emit('server:metrics', this.#serverMetrics.snapshot());
    }, SERVER_METRICS_INTERVAL_MS);
    this.#metricsTimer.unref();
  }

  get clientCount() {
    return this.#io.engine.clientsCount;
  }

  close() {
    clearInterval(this.#metricsTimer);
    return this.#io.close();
  }

  #handleConnection(socket) {
    socket.on('test:subscribe', async (testId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!testIdSchema.safeParse(testId).success) {
        reply({ ok: false, error: 'Id de prueba inválido.' });
        return;
      }

      try {
        // Se une a la sala antes de leer el estado para no perder puntos entre ambos pasos.
        socket.join(roomOf(testId));
        // Quien llega a mitad de la prueba recibe lo ya ocurrido para dibujar la gráfica.
        const run = await this.#loadTests.getById(testId);
        reply({ ok: true, run });
      } catch (error) {
        socket.leave(roomOf(testId));
        if (!(error instanceof NotFoundError)) {
          this.#logger.error({ err: error, testId }, 'Falló una suscripción a una prueba');
        }
        reply({ ok: false, error: error instanceof NotFoundError ? error.message : 'Error interno.' });
      }
    });

    socket.on('test:unsubscribe', (testId) => {
      if (testIdSchema.safeParse(testId).success) socket.leave(roomOf(testId));
    });
  }

  #bindServiceEvents() {
    this.#loadTests.on('started', ({ id, name, config, startedAt }) => {
      this.#io.emit('test:started', { id, name, config, startedAt });
    });

    // `volatile`: si un cliente va atrasado se descarta el punto en lugar de acumular
    // mensajes. El siguiente punto y el resumen final corrigen lo que se haya perdido.
    this.#loadTests.on('metrics', (testId, payload) => {
      this.#io.to(roomOf(testId)).volatile.emit('test:metrics', { testId, ...payload });
    });

    this.#loadTests.on('finished', ({ id, status, summary, error, finishedAt }) => {
      this.#io.emit('test:finished', { id, status, summary, error, finishedAt });
    });
  }
}
