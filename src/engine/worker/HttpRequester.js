import http from 'node:http';
import https from 'node:https';
import { createPinnedLookup } from '../../shared/network.js';

/** Ejecuta una petición HTTP y mide cuánto tarda en recibirse la respuesta completa. */
export class HttpRequester {
  #url;
  #transport;
  #agent;
  #options;
  #body;
  #timeoutMs;

  constructor({ runId, url, method, headers, body, timeoutMs, pinnedAddresses }) {
    this.#url = new URL(url);
    this.#transport = this.#url.protocol === 'https:' ? https : http;
    this.#agent = new this.#transport.Agent({ keepAlive: true });
    this.#body = body ? Buffer.from(body) : null;
    this.#timeoutMs = timeoutMs;

    this.#options = {
      method,
      agent: this.#agent,
      lookup: createPinnedLookup(pinnedAddresses),
      headers: {
        'User-Agent': 'LoadTesterVisual/1.0',
        // Permite al dueño del servidor identificar el tráfico en sus logs.
        'X-Load-Test-Id': runId,
        ...headers,
        ...(this.#body ? { 'Content-Length': this.#body.length } : {}),
      },
    };
  }

  /**
   * Nunca rechaza: un fallo de red es un resultado que se debe medir.
   * Devuelve `{ aborted: true }` si la petición se cortó porque la prueba terminó;
   * esas peticiones no cuentan en las métricas.
   */
  execute(signal) {
    return new Promise((resolve) => {
      const startedAt = performance.now();
      const latencyMs = () => performance.now() - startedAt;
      let settled = false;
      let timer;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const fail = (error) => {
        if (error.name === 'AbortError' || signal.aborted) finish({ aborted: true });
        else {
          finish({ latencyMs: latencyMs(), statusCode: 0, bytes: 0, errorType: error.code ?? 'NETWORK_ERROR' });
        }
      };

      const request = this.#transport.request(this.#url, { ...this.#options, signal }, (response) => {
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
        });
        response.on('error', fail);
        response.on('end', () => {
          const { statusCode } = response;
          finish({
            latencyMs: latencyMs(),
            statusCode,
            bytes,
            errorType: statusCode >= 400 ? `HTTP_${statusCode}` : null,
          });
        });
      });

      // El tiempo límite cubre toda la petición, no solo la inactividad del socket.
      timer = setTimeout(() => {
        request.destroy(Object.assign(new Error('Tiempo de espera agotado'), { code: 'ETIMEDOUT' }));
      }, this.#timeoutMs);

      request.on('error', fail);
      request.end(this.#body ?? undefined);
    });
  }

  close() {
    this.#agent.destroy();
  }
}
