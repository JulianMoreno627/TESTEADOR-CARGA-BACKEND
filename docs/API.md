# Contrato de la API

Guía del contrato para construir el frontend. La fuente de verdad es [contract/openapi.yaml](../contract/openapi.yaml), publicado también en `GET /api/v1/openapi.yaml`; si este documento y el contrato no coinciden, manda el contrato.

URL base en desarrollo: `http://localhost:3000`; en producción, `https://testeador-carga-api.onrender.com`. El origen del frontend debe estar en `CORS_ORIGINS`.

## Formato de respuesta

```jsonc
// Éxito
{ "success": true, "data": { }, "meta": { } }

// Error
{ "success": false, "error": { "code": "TARGET_NOT_VERIFIED", "message": "Texto para mostrar", "details": { } } }
```

En `VALIDATION_ERROR`, `details` es una lista de `{ "field": "vus", "message": "..." }`, útil para marcar cada campo del formulario.

| Estado | Códigos de `error.code` |
|---|---|
| 400 | `BAD_REQUEST` |
| 403 | `TARGET_NOT_VERIFIED`, `TARGET_PRIVATE_NETWORK`, `TARGET_LOCALHOST_DISABLED` |
| 404 | `NOT_FOUND`, `ANALYSIS_NOT_FOUND` |
| 409 | `TEST_NOT_RUNNING`, `TEST_RUNNING`, `TEST_NOT_COMPARABLE`, `REPORT_NOT_READY`, `TARGET_VERIFICATION_FAILED` |
| 422 | `VALIDATION_ERROR`, `TARGET_UNRESOLVABLE`, `TARGET_VERIFICATION_NOT_NEEDED` |
| 429 | `CAPACITY_EXCEEDED`, `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |
| 503 | `AI_UNAVAILABLE` |

## Pruebas de carga

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/load-tests` | Inicia una prueba (201) |
| `GET` | `/api/v1/load-tests?limit=20&offset=0` | Historial paginado, sin `timeline` |
| `GET` | `/api/v1/load-tests/:id` | Detalle, con `timeline` |
| `POST` | `/api/v1/load-tests/:id/stop` | Detiene la prueba |
| `DELETE` | `/api/v1/load-tests/:id` | Elimina una prueba terminada (204) |
| `GET` | `/api/v1/load-tests/:id/report?format=json` | Descarga el reporte: `json` o `pdf` |
| `GET` | `/api/v1/load-tests/compare?baseline=:id&candidate=:id` | Compara dos corridas |

### Iniciar una prueba

| Campo | Tipo | Obligatorio | Por defecto | Notas |
|---|---|---|---|---|
| `url` | string | Sí | | `http` o `https`, sin credenciales |
| `vus` | entero | Sí | | Máximo `MAX_VUS` (500) |
| `durationSeconds` | entero | Sí | | Máximo `MAX_DURATION_SECONDS` (300) |
| `name` | string | No | `Prueba <dominio>` | Hasta 120 caracteres |
| `method` | string | No | `GET` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` |
| `headers` | objeto | No | `{}` | No admite `Host`, `Content-Length`, `Connection` ni similares |
| `body` | string, objeto o lista | No | | Hasta 64 KB. No se admite en `GET`, `HEAD` ni `OPTIONS` |
| `pattern` | objeto | No | `{ "type": "constant" }` | Ver la tabla siguiente |
| `thinkTimeMs` | entero | No | `0` | Pausa de cada VU entre peticiones |
| `timeoutMs` | entero | No | `10000` | Límite por petición, de 100 a 60000 |

| `pattern.type` | Campos opcionales | Valores por defecto |
|---|---|---|
| `constant` | | |
| `ramp` | `startVus`, `rampSeconds` | 1 VU; toda la duración |
| `spike` | `baseVus`, `spikes`, `spikeSeconds` | 10 % de `vus`; 2 picos; una cuarta parte de cada periodo |

### Objeto de prueba

```jsonc
{
  "id": "a93a5cf8-45f8-4d5c-be71-3533e194f52e",
  "name": "Mi prueba",
  "status": "running",            // running | completed | stopped | failed
  "config": {                     // credenciales ocultas; sin el cuerpo
    "url": "http://localhost:4000/slow",
    "method": "GET",
    "headers": {},
    "vus": 100,
    "durationSeconds": 15,
    "pattern": { "type": "ramp" },
    "thinkTimeMs": 0,
    "timeoutMs": 10000,
    "bodyBytes": 0
  },
  "timeline": [],                 // lista de puntos; se omite en el historial
  "summary": null,                // se llena al terminar
  "error": null,
  "createdAt": "2026-11-03T18:00:00.000Z",
  "startedAt": "2026-11-03T18:00:00.100Z",
  "finishedAt": null
}
```

### Punto de la serie de tiempo

Los valores de `latency` son `null` si en esa ventana no hubo respuestas: la gráfica debe dejar un hueco.

```jsonc
{
  "t": 5.01,                      // segundos desde el inicio
  "activeVus": 50,
  "targetVus": 50,
  "requests": 240,                // en esta ventana
  "errors": 2,
  "rps": 240,
  "errorRate": 0.0083,            // de 0 a 1
  "bytesPerSecond": 2640,
  "latency": { "p50": 206.4, "p95": 295.9, "p99": 301.9, "mean": 205.8, "max": 316.3 }
}
```

### Resumen final

```jsonc
{
  "durationSeconds": 12.09,
  "totalRequests": 19337,
  "successfulRequests": 19337,
  "failedRequests": 0,
  "errorRate": 0,
  "avgRps": 1599.55,
  "peakRps": 2507.47,
  "peakVus": 500,
  "totalBytes": 212707,
  "bytesPerSecond": 17594,
  "latency": { "min": 99.97, "mean": 204.86, "p50": 206.46, "p90": 284.33, "p95": 295.93, "p99": 301.91, "max": 318.82 },
  "statusCodes": { "200": 19337 },
  "errorTypes": {}                // por ejemplo { "HTTP_500": 3, "ECONNREFUSED": 1, "ETIMEDOUT": 2 }
}
```

Las respuestas 4xx y 5xx cuentan como error. Los fallos de red también, pero no entran en los percentiles, porque no miden al servidor. Una corrida interrumpida por una caída del servidor queda con `summary: null`.

### Comparación

`verdict` puede ser `improved`, `regressed`, `unchanged` o `mixed`. Cada métrica lleva su propio veredicto, y también puede valer `unknown` si falta el dato. Un cambio menor al 5 % cuenta como `unchanged`.

```jsonc
{
  "baseline": { "id": "...", "name": "...", "finishedAt": "..." },
  "candidate": { "id": "...", "name": "...", "finishedAt": "..." },
  "noiseThresholdPercent": 5,
  "verdict": "improved",
  "metrics": [
    { "key": "latencyP95", "label": "Latencia p95 (ms)", "baseline": 200, "candidate": 100, "changePercent": -50, "verdict": "improved" }
  ]
}
```

## Análisis con IA

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/v1/load-tests/:id/analysis` | El análisis ya generado; 404 `ANALYSIS_NOT_FOUND` si aún no existe |
| `POST` | `/api/v1/load-tests/:id/analysis` | Lo genera con Gemini (Groq de respaldo). Si ya existe, devuelve el guardado sin llamar a la IA |

La prueba debe haber terminado y tener resultados; si no, responde 409. Si ningún proveedor responde, devuelve 503 `AI_UNAVAILABLE`. Tiene su propio límite de 10 solicitudes por minuto.

```jsonc
{
  "runId": "...",
  "provider": "gemini",          // o "groq"
  "model": "gemini-3.1-flash-lite",
  "fallbackUsed": false,          // true si Gemini falló y respondió Groq
  "generatedAt": "2026-11-17T16:20:00.000Z",
  "durationMs": 1834,
  "content": {
    "verdict": "degraded",         // healthy | degraded | critical
    "summary": "La API presenta una tasa de error del 10,8 %…",
    "findings": [{ "title": "…", "detail": "…", "severity": "critical" }],   // info | warning | critical; máximo 6
    "recommendations": ["…"]     // máximo 6
  }
}
```

## Dominios verificados

`localhost` no los necesita en desarrollo. Cualquier dominio público debe pasar por este flujo antes de recibir carga:

1. `POST /api/v1/targets` con `{ "hostname": "api.midominio.com" }`. La respuesta incluye `id` e `instructions`.
2. El usuario publica el token de una de estas dos formas:
   - `instructions.http`: el archivo `https://api.midominio.com/.well-known/load-tester-verification.txt` con el token como contenido.
   - `instructions.dns`: un registro TXT `_load-tester-challenge.api.midominio.com` con el token como valor.
3. `POST /api/v1/targets/:id/verify` con `{ "method": "http" }` o `{ "method": "dns" }`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/v1/targets` | Lista los dominios registrados |
| `DELETE` | `/api/v1/targets/:id` | Elimina un dominio (204) |

## Tiempo real (Socket.io)

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

// 1. Inicia la prueba con POST y suscríbete con su id.
const { ok, run, error } = await socket.emitWithAck('test:subscribe', testId);
// `run` trae el estado actual y el `timeline`: dibuja con eso los puntos anteriores.

// 2. Añade cada punto nuevo a la gráfica.
socket.on('test:metrics', ({ testId, point, totals }) => {});

// 3. Muestra el resumen final.
socket.on('test:finished', ({ id, status, summary, error, finishedAt }) => {});
```

| Evento | Dirección | Contenido |
|---|---|---|
| `test:subscribe` | Cliente a servidor | `testId` y función de respuesta |
| `test:unsubscribe` | Cliente a servidor | `testId` |
| `test:metrics` | Servidor a suscriptores | `{ testId, point, totals: { requests, errors, bytes, errorRate } }`, una vez por segundo |
| `test:started` | Servidor a todos | `{ id, name, config, startedAt }` |
| `test:finished` | Servidor a todos | `{ id, status, summary, error, finishedAt }` |
| `server:metrics` | Servidor a todos | Igual que `GET /api/v1/metrics`, cada 5 segundos |

`test:metrics` puede perder puntos si el cliente va atrasado. Por eso conviene tomar el `summary` de `test:finished` como valor definitivo, y filtrar `test:finished` por `id`, porque llega a todos los clientes.

## Sistema y vistas

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Estado del servidor y de la base de datos (503 si la base falla) |
| `GET` | `/health/live` | Solo indica que el proceso responde; no consulta la base de datos. Lo usa Render |
| `GET` | `/api/v1/metrics` | Rendimiento del backend. `gauges` incluye `activeLoadTests`, `activeWorkers`, `inFlightRequests` (leído de la memoria compartida), `socketClients`, `pdfWorkersBusy` y `pdfTasksQueued` |
| `GET` | `/api/v1/openapi.yaml` | El contrato OpenAPI |
| `GET` | `/views/history` | Historial en HTML (ISR) |
| `GET` | `/views/reports/:id` | Reporte en HTML (SSG) |
| `GET` | `/views/compare?baseline=:id&candidate=:id` | Comparación en HTML (SSR) |

Todas las respuestas llevan la cabecera `Server-Timing` (`total`, y `render` en las vistas). Las vistas añaden `X-Render-Strategy`, y el historial también `X-Cache` (`MISS`, `HIT` o `STALE`). Las tres están expuestas por CORS para que el frontend pueda leerlas.
