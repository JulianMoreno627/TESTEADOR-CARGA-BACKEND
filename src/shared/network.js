import dns from 'node:dns/promises';
import net from 'node:net';

const loopback = new net.BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('::1', 'ipv6');

// Rangos que nunca deben recibir carga: redes internas, enlace local
// (incluye metadatos de nube como 169.254.169.254), multidifusión y reservados.
const nonPublic = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  nonPublic.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
]) {
  nonPublic.addSubnet(network, prefix, 'ipv6');
}

const familyName = (address) => (net.isIPv6(address) ? 'ipv6' : 'ipv4');

export const isLoopbackAddress = (address) => loopback.check(address, familyName(address));
export const isPublicAddress = (address) => !nonPublic.check(address, familyName(address));

/** Quita corchetes de IPv6 y el punto final de un FQDN, y pasa a minúsculas. */
export function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export async function resolveHostname(hostname) {
  return dns.lookup(hostname, { all: true });
}

/**
 * Función `lookup` para node:http que solo responde con las IP ya validadas.
 * Evita el DNS rebinding: el dominio no puede cambiar de IP entre la validación
 * y las peticiones. Se conservan todas porque localhost puede resolver a ::1 y
 * a 127.0.0.1, y el servidor quizá solo escuche en una de ellas.
 */
export function createPinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    if (options?.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  };
}
