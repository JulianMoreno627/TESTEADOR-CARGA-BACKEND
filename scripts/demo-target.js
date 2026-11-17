/**
 * API de ejemplo para probar la herramienta sin apuntar a ningún servidor real.
 * Uso: npm run demo:target
 *
 *   GET /fast    responde de inmediato
 *   GET /slow    tarda entre 100 y 300 ms
 *   GET /flaky   falla con HTTP 500 en el 10 % de las peticiones
 *   GET /heavy   bloquea el event loop 5 ms: se degrada con muchos usuarios
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.DEMO_PORT ?? 4000);

const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const routes = {
  '/fast': (_req, res) => reply(res, 200, { ok: true }),
  '/slow': (_req, res) => setTimeout(() => reply(res, 200, { ok: true }), 100 + Math.random() * 200),
  '/flaky': (_req, res) => {
    if (Math.random() < 0.1) reply(res, 500, { ok: false });
    else reply(res, 200, { ok: true });
  },
  '/heavy': (_req, res) => {
    const end = performance.now() + 5;
    while (performance.now() < end);
    reply(res, 200, { ok: true });
  },
};

createServer((req, res) => {
  const handler = routes[new URL(req.url, 'http://localhost').pathname];
  if (handler) handler(req, res);
  else reply(res, 404, { routes: Object.keys(routes) });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`API de demostración en http://localhost:${PORT} (${Object.keys(routes).join(', ')})`);
});
