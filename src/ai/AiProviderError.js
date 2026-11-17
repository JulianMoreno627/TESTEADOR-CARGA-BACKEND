/** Fallo de un proveedor de IA. Nunca incluye la clave ni el cuerpo completo de la respuesta. */
export class AiProviderError extends Error {
  constructor(provider, reason, { status = null, cause } = {}) {
    super(`${provider}: ${reason}`, { cause });
    this.name = 'AiProviderError';
    this.provider = provider;
    this.status = status;
  }
}
