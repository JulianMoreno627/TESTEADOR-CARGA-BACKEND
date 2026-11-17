import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';
import { createDemoServer } from '../../scripts/demo-target.js';

describe('API de ejemplo', () => {
  let server;
  let base;

  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('application/json');
    return { status: response.status, body: isJson ? JSON.parse(text) : null, raw: text };
  };

  before(async () => {
    server = createDemoServer({ verificationToken: 'token-de-prueba' }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('lista los productos iniciales', async () => {
    const { status, body } = await call('GET', '/api/products?limit=5');
    assert.equal(status, 200);
    assert.equal(body.total, 20);
    assert.equal(body.items.length, 5);
  });

  it('crea, consulta, actualiza y elimina un producto', async () => {
    const created = await call('POST', '/api/products', { name: 'Teclado', price: 120000 });
    assert.equal(created.status, 201);
    const { id } = created.body;

    assert.equal((await call('GET', `/api/products/${id}`)).body.name, 'Teclado');

    const updated = await call('PUT', `/api/products/${id}`, { name: 'Teclado mecánico', price: 150000 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.price, 150000);

    assert.equal((await call('DELETE', `/api/products/${id}`)).status, 204);
    assert.equal((await call('GET', `/api/products/${id}`)).status, 404);
  });

  it('valida el cuerpo y el método', async () => {
    assert.equal((await call('POST', '/api/products', '{malo')).status, 400);
    assert.equal((await call('POST', '/api/products', { name: '', price: -1 })).status, 422);
    assert.equal((await call('PUT', '/api/products/1', { price: 5 })).status, 422);
    assert.equal((await call('PATCH', '/api/products')).status, 405);
    assert.equal((await call('PUT', '/api/products/99999', { name: 'x', price: 1 })).status, 404);
  });

  it('no crece sin límite aunque una prueba haga miles de POST', async () => {
    for (let index = 0; index < 1100; index += 1) await call('POST', '/api/products', { name: `P${index}`, price: 1 });
    assert.equal((await call('GET', '/api/products')).body.total, 1000);
  });

  it('mantiene las rutas de comportamiento y la verificación', async () => {
    assert.equal((await call('POST', '/fast')).status, 200);
    assert.equal((await call('GET', '/.well-known/load-tester-verification.txt')).raw, 'token-de-prueba');
  });
});
