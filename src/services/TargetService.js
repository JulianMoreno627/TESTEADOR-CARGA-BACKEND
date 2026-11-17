import { randomBytes, randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { AppError, ConflictError, NotFoundError } from '../shared/errors.js';
import { createPinnedLookup, isLoopbackAddress, normalizeHostname } from '../shared/network.js';

const VERIFICATION_PATH = '/.well-known/load-tester-verification.txt';
const DNS_RECORD_PREFIX = '_load-tester-challenge';
const FETCH_TIMEOUT_MS = 5_000;
const MAX_FILE_BYTES = 1024;

/** Descarga el archivo de verificación sin seguir redirecciones y con tamaño limitado. */
function fetchVerificationFile(protocol, hostname, pinnedAddresses) {
  const transport = protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.get(
      { protocol, hostname, path: VERIFICATION_PATH, lookup: createPinnedLookup(pinnedAddresses), timeout: FETCH_TIMEOUT_MS },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        let content = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          content += chunk;
          if (content.length > MAX_FILE_BYTES) request.destroy(new Error('Archivo demasiado grande'));
        });
        response.on('error', reject);
        response.on('end', () => resolve(content));
      },
    );
    request.on('timeout', () => request.destroy(new Error('Tiempo de espera agotado')));
    request.on('error', reject);
  });
}

/** Registro de dominios y comprobación de propiedad con un token, como en Let's Encrypt. */
export class TargetService {
  #targets;
  #policy;
  #fetchFile;
  #resolveTxt;

  constructor({ targets, policy, fetchFile = fetchVerificationFile, resolveTxt = dns.resolveTxt }) {
    this.#targets = targets;
    this.#policy = policy;
    this.#fetchFile = fetchFile;
    this.#resolveTxt = resolveTxt;
  }

  async register(rawHostname) {
    const hostname = normalizeHostname(rawHostname);
    const addresses = await this.#policy.resolveAddresses(hostname);

    if (addresses.every(({ address }) => isLoopbackAddress(address))) {
      throw new AppError(422, 'TARGET_VERIFICATION_NOT_NEEDED', 'localhost no requiere verificación.');
    }
    this.#policy.assertPublic(addresses);

    const existing = await this.#targets.findByHostname(hostname);
    if (existing) return this.#present(existing);

    const target = {
      id: randomUUID(),
      hostname,
      token: randomBytes(24).toString('hex'),
      method: null,
      verifiedAt: null,
      createdAt: new Date().toISOString(),
    };
    await this.#targets.save(target);
    return this.#present(target);
  }

  async list() {
    const targets = await this.#targets.findAll();
    return targets.map((target) => this.#present(target));
  }

  async verify(id, method) {
    const target = await this.#targets.findById(id);
    if (!target) throw new NotFoundError('Dominio no registrado.');

    const verified = method === 'dns' ? await this.#checkDns(target) : await this.#checkHttp(target);
    if (!verified) {
      throw new ConflictError(
        'TARGET_VERIFICATION_FAILED',
        `No se encontró el token de verificación por ${method.toUpperCase()}.`,
      );
    }

    target.method = method;
    target.verifiedAt = new Date().toISOString();
    await this.#targets.save(target);
    return this.#present(target);
  }

  async remove(id) {
    if (!(await this.#targets.delete(id))) throw new NotFoundError('Dominio no registrado.');
  }

  async #checkHttp({ hostname, token }) {
    const addresses = await this.#policy.resolveAddresses(hostname);
    this.#policy.assertPublic(addresses);

    for (const protocol of ['https:', 'http:']) {
      try {
        const content = await this.#fetchFile(protocol, hostname, addresses);
        if (content.trim() === token) return true;
      } catch {
        // Si HTTPS no está disponible, se intenta con HTTP.
      }
    }
    return false;
  }

  async #checkDns({ hostname, token }) {
    try {
      const records = await this.#resolveTxt(`${DNS_RECORD_PREFIX}.${hostname}`);
      return records.some((chunks) => chunks.join('') === token);
    } catch {
      return false;
    }
  }

  #present(target) {
    return {
      ...target,
      verified: target.verifiedAt !== null,
      instructions: {
        http: {
          url: `https://${target.hostname}${VERIFICATION_PATH}`,
          content: target.token,
        },
        dns: {
          type: 'TXT',
          name: `${DNS_RECORD_PREFIX}.${target.hostname}`,
          value: target.token,
        },
      },
    };
  }
}
