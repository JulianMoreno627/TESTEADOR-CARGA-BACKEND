import { z } from 'zod';

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$/i;

export const registerTargetSchema = z.strictObject({
  hostname: z.string().trim().regex(HOSTNAME, 'Escribe solo el dominio, por ejemplo api.midominio.com.'),
});

export const verifyTargetSchema = z.strictObject({
  method: z.enum(['http', 'dns']).default('http'),
});
