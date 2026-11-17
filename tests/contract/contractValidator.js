import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const CONTRACT_PATH = new URL('../../contract/openapi.yaml', import.meta.url);
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const escapePointer = (segment) => encodeURIComponent(segment.replace(/~/g, '~0').replace(/\//g, '~1'));

/**
 * Valida respuestas reales contra el contrato OpenAPI. Es la mitad "consumidor" de
 * contract-first: si el código cambia una respuesta sin cambiar el contrato, falla.
 */
export function createContractValidator() {
  const contract = parse(readFileSync(CONTRACT_PATH, 'utf8'));
  // `strict: false` porque OpenAPI añade palabras como `example` que no son de JSON Schema.
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
  addFormats(ajv);
  ajv.addSchema(contract, 'contract');

  const operations = [];
  for (const [path, item] of Object.entries(contract.paths)) {
    for (const method of METHODS) {
      if (item[method]) operations.push({ path, method, operation: item[method] });
    }
  }

  function findOperation(method, path) {
    const found = operations.find((candidate) => candidate.method === method.toLowerCase() && candidate.path === path);
    if (!found) throw new Error(`${method} ${path} no existe en el contrato`);
    return found;
  }

  return {
    operationIds: operations.map(({ operation }) => operation.operationId),

    /**
     * @param {string} path ruta tal como aparece en el contrato, por ejemplo /api/v1/load-tests/{id}
     * @returns {string} el operationId validado
     */
    validate(method, path, status, body) {
      const { operation } = findOperation(method, path);
      const response = operation.responses[String(status)];
      if (!response) throw new Error(`${method} ${path} no documenta la respuesta ${status}`);

      const pointer = ['paths', path, method.toLowerCase(), 'responses', String(status)].map(escapePointer).join('/');
      let schema = null;
      if (response.$ref) schema = { $ref: `contract${response.$ref}/content/application~1json/schema` };
      else if (response.content?.['application/json']) schema = { $ref: `contract#/${pointer}/content/application~1json/schema` };

      if (schema) {
        const check = ajv.compile(schema);
        if (!check(body)) {
          const problems = check.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
          throw new Error(`${method} ${path} ${status} no cumple el contrato: ${problems}`);
        }
      }
      return operation.operationId;
    },
  };
}
