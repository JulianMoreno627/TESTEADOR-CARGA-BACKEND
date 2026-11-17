import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createStartLoadTestSchema } from '../../src/api/schemas/loadTestSchemas.js';
import { html } from '../../src/rendering/html.js';
import { InMemoryTargetRepository } from '../../src/repositories/memory/InMemoryTargetRepository.js';
import { TargetPolicy } from '../../src/services/TargetPolicy.js';
import { TargetService } from '../../src/services/TargetService.js';

const resolves = (...addresses) => async () =>
  addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

const policyFor = (resolve, { allowLocalhost = true, targets = new InMemoryTargetRepository() } = {}) =>
  new TargetPolicy({ targets, allowLocalhost, resolve });

const rejectsWith = (promise, code) => assert.rejects(promise, (error) => error.code === code);

describe('TargetPolicy', () => {
  it('permite localhost solo si la configuración lo habilita', async () => {
    assert.ok(await policyFor(resolves('127.0.0.1', '::1')).authorize('http://localhost:3000'));
    await rejectsWith(
      policyFor(resolves('127.0.0.1'), { allowLocalhost: false }).authorize('http://localhost:3000'),
      'TARGET_LOCALHOST_DISABLED',
    );
  });

  for (const address of [
    '10.0.0.5',
    '172.16.0.1',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    'fd00::1',
    'fe80::1',
    '::ffff:192.168.1.10',
  ]) {
    it(`bloquea la dirección interna ${address}`, async () => {
      await rejectsWith(policyFor(resolves(address)).authorize('http://interno.test'), 'TARGET_PRIVATE_NETWORK');
    });
  }

  it('bloquea un dominio que mezcla una IP pública con una privada', async () => {
    await rejectsWith(
      policyFor(resolves('93.184.216.34', '10.0.0.1')).authorize('http://mixto.test'),
      'TARGET_PRIVATE_NETWORK',
    );
  });

  it('bloquea un dominio público sin verificar y permite uno verificado', async () => {
    const targets = new InMemoryTargetRepository();
    const policy = policyFor(resolves('93.184.216.34'), { targets });
    await rejectsWith(policy.authorize('https://terceros.test'), 'TARGET_NOT_VERIFIED');

    await targets.save({
      id: 'a',
      hostname: 'propio.test',
      token: 't',
      method: 'http',
      verifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    const addresses = await policy.authorize('https://PROPIO.test/ruta');
    assert.equal(addresses[0].address, '93.184.216.34');
  });

  it('informa cuando el dominio no se puede resolver', async () => {
    const policy = policyFor(async () => {
      throw new Error('ENOTFOUND');
    });
    await rejectsWith(policy.authorize('http://noexiste.test'), 'TARGET_UNRESOLVABLE');
  });
});

describe('TargetService', () => {
  const build = (overrides = {}) => {
    const targets = new InMemoryTargetRepository();
    const policy = policyFor(resolves('93.184.216.34'), { targets });
    return { policy, service: new TargetService({ targets, policy, ...overrides }) };
  };

  it('verifica un dominio con el archivo que contiene el token', async () => {
    let token;
    const { service, policy } = build({ fetchFile: async () => `${token}\n` });
    const target = await service.register('API.Propio.test');
    token = target.token;

    assert.equal(target.hostname, 'api.propio.test');
    assert.equal(target.verified, false);
    assert.equal((await service.verify(target.id, 'http')).verified, true);
    assert.ok(await policy.authorize('https://api.propio.test/x'));
  });

  it('rechaza la verificación si el contenido no coincide', async () => {
    const { service } = build({ fetchFile: async () => 'otro' });
    const target = await service.register('propio.test');
    await rejectsWith(service.verify(target.id, 'http'), 'TARGET_VERIFICATION_FAILED');
  });

  it('verifica por registro TXT de DNS', async () => {
    let token;
    const { service } = build({ resolveTxt: async () => [[token.slice(0, 10), token.slice(10)]] });
    const target = await service.register('propio.test');
    token = target.token;
    assert.equal((await service.verify(target.id, 'dns')).method, 'dns');
  });

  it('reutiliza el token si el dominio ya estaba registrado', async () => {
    const { service } = build();
    const first = await service.register('propio.test');
    const second = await service.register('propio.test');
    assert.equal(first.token, second.token);
  });
});

describe('esquema de inicio de prueba', () => {
  const schema = createStartLoadTestSchema({ maxVus: 100, maxDurationSeconds: 60 });
  const valid = { url: 'http://localhost/x', vus: 10, durationSeconds: 10 };
  const issuesOf = (input) => schema.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? [];

  it('aplica valores por defecto', () => {
    const { method, pattern, thinkTimeMs, timeoutMs } = schema.parse(valid);
    assert.deepEqual({ method, pattern, thinkTimeMs, timeoutMs }, {
      method: 'GET',
      pattern: { type: 'constant' },
      thinkTimeMs: 0,
      timeoutMs: 10_000,
    });
  });

  it('hace cumplir los límites de VUs y duración', () => {
    assert.deepEqual(issuesOf({ ...valid, vus: 101 }), ['vus']);
    assert.deepEqual(issuesOf({ ...valid, durationSeconds: 61 }), ['durationSeconds']);
  });

  it('rechaza protocolos no HTTP y credenciales en la URL', () => {
    assert.deepEqual(issuesOf({ ...valid, url: 'file:///etc/passwd' }), ['url']);
    assert.deepEqual(issuesOf({ ...valid, url: 'http://user:clave@localhost' }), ['url']);
  });

  it('impide alterar Host para saltarse la verificación', () => {
    assert.deepEqual(issuesOf({ ...valid, headers: { HOST: 'victima.test' } }), ['headers.HOST']);
  });

  it('rechaza headers con saltos de línea', () => {
    assert.deepEqual(issuesOf({ ...valid, headers: { 'X-A': 'a\r\nX-B: b' } }), ['headers.X-A']);
  });

  it('rechaza cuerpo en GET y patrones que no caben en la prueba', () => {
    assert.deepEqual(issuesOf({ ...valid, body: 'x' }), ['body']);
    assert.deepEqual(
      issuesOf({ ...valid, pattern: { type: 'ramp', startVus: 50 } }),
      ['pattern.startVus'],
    );
    assert.deepEqual(
      issuesOf({ ...valid, pattern: { type: 'spike', spikes: 5, spikeSeconds: 5 } }),
      ['pattern.spikeSeconds'],
    );
  });

  it('serializa un cuerpo JSON y añade Content-Type', () => {
    const { body, headers } = schema.parse({ ...valid, method: 'POST', body: { a: 1 } });
    assert.equal(body, '{"a":1}');
    assert.equal(headers['Content-Type'], 'application/json');
  });
});

describe('plantilla html', () => {
  it('escapa los valores interpolados para evitar XSS', () => {
    const output = html`<p title="${'"><script>'}">${'<img src=x onerror=alert(1)>'}</p>`.toString();
    assert.equal(output.includes('<script>'), false);
    assert.equal(output.includes('<img'), false);
  });

  it('no vuelve a escapar plantillas anidadas', () => {
    assert.equal(html`<ul>${[1, 2].map((n) => html`<li>${n}</li>`)}</ul>`.toString(), '<ul><li>1</li><li>2</li></ul>');
  });
});
