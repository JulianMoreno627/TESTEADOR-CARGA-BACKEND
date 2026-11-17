const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization)$|token|secret|api[-_]?key/i;
const SENSITIVE_QUERY_PARAM = /token|secret|password|passwd|auth|api[-_]?key|signature/i;
const REDACTED = '[REDACTED]';

function redactUrl(rawUrl) {
  const url = new URL(rawUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAM.test(key)) url.searchParams.set(key, REDACTED);
  }
  return url.toString();
}

/**
 * Versión de la configuración apta para guardar y mostrar: oculta credenciales
 * y no conserva el cuerpo, que puede contener datos personales.
 */
export function toPublicConfig(config) {
  const { body, url, headers, ...rest } = config;
  const publicHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER.test(name) ? REDACTED : value,
    ]),
  );
  return {
    ...rest,
    url: redactUrl(url),
    headers: publicHeaders,
    bodyBytes: body ? Buffer.byteLength(body) : 0,
  };
}
