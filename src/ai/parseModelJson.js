import { analysisContentSchema } from './analysisSchema.js';
import { AiProviderError } from './AiProviderError.js';

/** Convierte el texto del modelo en un análisis válido o lanza AiProviderError. */
export function parseModelJson(provider, text) {
  // Algunos modelos envuelven el JSON en un bloque ```json aunque se les pida que no.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (error) {
    throw new AiProviderError(provider, 'la respuesta no es JSON válido', { cause: error });
  }

  const result = analysisContentSchema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new AiProviderError(provider, `la respuesta no tiene la forma esperada (${problems.join('; ')})`);
  }
  return result.data;
}
