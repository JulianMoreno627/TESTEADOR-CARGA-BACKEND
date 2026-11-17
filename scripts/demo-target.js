/**
 * API de ejemplo para probar la herramienta sin apuntar a ningún servidor ajeno.
 * Local: npm run demo:target. En Render se despliega como un servicio aparte.
 *
 *   GET /fast    responde de inmediato
 *   GET /slow    tarda entre 100 y 300 ms
 *   GET /flaky   falla con HTTP 500 en el 10 % de las peticiones
 *   GET /heavy   bloquea el event loop 5 ms: se degrada con muchos usuarios
 *
 * En producción el backend solo prueba dominios verificados. Si se define
 * DEMO_VERIFICATION_TOKEN, esta API publica ese token en
 * /.well-known/load-tester-verification.txt para poder verificarla.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? process.env.DEMO_PORT ?? 4000);
// En Render se escucha en todas las interfaces; en local, solo en la máquina.
const HOST = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
const VERIFICATION_TOKEN = process.env.DEMO_VERIFICATION_TOKEN;

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

if (VERIFICATION_TOKEN) {
  routes['/.well-known/load-tester-verification.txt'] = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(VERIFICATION_TOKEN);
  };
}

createServer((req, res) => {
  const handler = routes[new URL(req.url, 'http://localhost').pathname];
  if (handler) handler(req, res);
  else reply(res, 404, { routes: Object.keys(routes).filter((route) => !route.startsWith('/.well-known')) });
}).listen(PORT, HOST, () => {
  console.log(`API de demostración en http://${HOST}:${PORT}`);
});
