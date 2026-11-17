import { ForbiddenTargetError, AppError } from '../shared/errors.js';
import {
  isLoopbackAddress,
  isPublicAddress,
  normalizeHostname,
  resolveHostname,
} from '../shared/network.js';

/**
 * Regla ética de la herramienta: solo se envía carga a servidores propios.
 *
 * - localhost: solo si ALLOW_LOCALHOST está activo.
 * - Redes privadas o reservadas: nunca (evita SSRF contra la infraestructura interna).
 * - Dominios públicos: solo si el dueño demostró que los controla.
 */
export class TargetPolicy {
  #targets;
  #allowLocalhost;
  #resolve;

  constructor({ targets, allowLocalhost, resolve = resolveHostname }) {
    this.#targets = targets;
    this.#allowLocalhost = allowLocalhost;
    this.#resolve = resolve;
  }

  /**
   * @returns {Array<{address: string, family: number}>} las IP validadas; el motor
   * se conecta solo a ellas para que el DNS no pueda cambiarlas después.
   */
  async authorize(rawUrl) {
    const hostname = normalizeHostname(new URL(rawUrl).hostname);
    const addresses = await this.resolveAddresses(hostname);

    if (addresses.every(({ address }) => isLoopbackAddress(address))) {
      if (!this.#allowLocalhost) {
        throw new ForbiddenTargetError('TARGET_LOCALHOST_DISABLED', 'Las pruebas contra localhost están deshabilitadas.');
      }
      return addresses;
    }

    this.assertPublic(addresses);

    const target = await this.#targets.findByHostname(hostname);
    if (!target?.verifiedAt) {
      throw new ForbiddenTargetError(
        'TARGET_NOT_VERIFIED',
        `Debes verificar que controlas ${hostname} antes de ejecutar una prueba.`,
        { hostname, registerAt: '/api/v1/targets' },
      );
    }
    return addresses;
  }

  async resolveAddresses(hostname) {
    try {
      return await this.#resolve(hostname);
    } catch {
      throw new AppError(422, 'TARGET_UNRESOLVABLE', `No se pudo resolver el dominio ${hostname}.`);
    }
  }

  assertPublic(addresses) {
    if (!addresses.every(({ address }) => isPublicAddress(address))) {
      throw new ForbiddenTargetError(
        'TARGET_PRIVATE_NETWORK',
        'El destino resuelve a una red privada o reservada, y no se permite.',
      );
    }
  }
}
