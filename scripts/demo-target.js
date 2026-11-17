/**
 * API de ejemplo para probar la herramienta sin apuntar a ningún servidor ajeno.
 * Local: npm run demo:target. En Render se despliega como un servicio aparte.
 *
 * Rutas para medir comportamientos (aceptan cualquier método):
 *   /fast    responde de inmediato
 *   /slow    tarda entre 100 y 300 ms
 *   /flaky   falla con HTTP 500 en el 10 % de las peticiones
 *   /heavy   bloquea el event loop 5 ms: se degrada con muchos usuarios
 *
 * Recurso REST en memoria, para probar GET, POST, PUT y DELETE:
 *   GET    /api/products        lista (?limit=20)
 *   GET    /api/products/:id    uno; 404 si no existe
 *   POST   /api/products        crea; cuerpo JSON { "name": "…", "price": 10 }
 *   PUT    /api/products/:id    reemplaza; mismo cuerpo
 *   DELETE /api/products/:id    elimina
 *
 * En producción el backend solo prueba dominios verificados. Si se define
 * DEMO_VERIFICATION_TOKEN, esta API publica ese token en
 * /.well-known/load-tester-verification.txt para poder verificarla.
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const MAX_BODY_BYTES = 16 * 1024;
// Una prueba con POST crea miles de productos: se conservan solo los más recientes.
const MAX_PRODUCTS = 1000;
const SEED_PRODUCTS = 20;

const reply = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(Object.assign(new Error('El cuerpo no es JSON válido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function validProduct(body) {
  return (
    body !== null &&
    typeof body === 'object' &&
    typeof body.name === 'string' &&
    body.name.trim().length > 0 &&
    body.name.length <= 100 &&
    typeof body.price === 'number' &&
    Number.isFinite(body.price) &&
    body.price >= 0
  );
}

/** Crea el servidor sin abrir el puerto, para poder probarlo. */
export function createDemoServer({ verificationToken } = {}) {
  const products = new Map();
  let nextId = 1;

  const save = (data) => {
    const product = { id: nextId, name: data.name.trim(), price: data.price, updatedAt: new Date().toISOString() };
    nextId += 1;
    products.set(product.id, product);
    if (products.size > MAX_PRODUCTS) products.delete(products.keys().next().value);
    return product;
  };

  for (let index = 1; index <= SEED_PRODUCTS; index += 1) save({ name: `Producto ${index}`, price: index * 1000 });

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

  if (verificationToken) {
    routes['/.well-known/load-tester-verification.txt'] = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(verificationToken);
    };
  }

  async function handleProducts(req, res, id) {
    if (id === null) {
      if (req.method === 'GET') {
        const limit = Math.min(100, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('limit')) || 20));
        return reply(res, 200, { total: products.size, items: [...products.values()].slice(-limit).reverse() });
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        if (!validProduct(body)) return reply(res, 422, { error: 'Envía { "name": texto, "price": número >= 0 }' });
        return reply(res, 201, save(body));
      }
      return reply(res, 405, { error: 'Usa GET o POST' });
    }

    const product = products.get(id);
    if (!product) return reply(res, 404, { error: `No existe el producto ${id}` });

    if (req.method === 'GET') return reply(res, 200, product);
    if (req.method === 'PUT') {
      const body = await readJson(req);
      if (!validProduct(body)) return reply(res, 422, { error: 'Envía { "name": texto, "price": número >= 0 }' });
      Object.assign(product, { name: body.name.trim(), price: body.price, updatedAt: new Date().toISOString() });
      return reply(res, 200, product);
    }
    if (req.method === 'DELETE') {
      products.delete(id);
      res.writeHead(204).end();
      return undefined;
    }
    return reply(res, 405, { error: 'Usa GET, PUT o DELETE' });
  }

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      const match = /^\/api\/products(?:\/(\d+))?\/?$/.exec(pathname);
      if (match) {
        await handleProducts(req, res, match[1] ? Number(match[1]) : null);
        return;
      }
      const handler = routes[pathname];
      if (handler) handler(req, res);
      else reply(res, 404, { routes: [...Object.keys(routes).filter((route) => !route.startsWith('/.well-known')), '/api/products'] });
    } catch (error) {
      if (!res.headersSent) reply(res, error.status ?? 500, { error: error.message });
    }
  });
}

// Solo abre el puerto si se ejecuta directamente (no al importarlo en las pruebas).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? process.env.DEMO_PORT ?? 4000);
  // En Render se escucha en todas las interfaces; en local, solo en la máquina.
  const host = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
  createDemoServer({ verificationToken: process.env.DEMO_VERIFICATION_TOKEN }).listen(port, host, () => {
    console.log(`API de demostración en http://${host}:${port}`);
  });
}
