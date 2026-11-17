# Paradigmas y trade-offs

Cada decisión de arquitectura del proyecto tiene una alternativa razonable. Este documento explica qué se eligió, qué se ganó y qué se pagó a cambio.

## Paradigma principal: programación orientada a eventos

El backend reacciona a eventos en lugar de seguir un flujo secuencial: una petición HTTP, un lote que llega de un worker, una prueba que termina o un cliente que se suscribe por Socket.io. La pieza central es el patrón **Observer** con `EventEmitter`:

```text
LoadEngine ──'batch'──▶ LoadTestRun ──'metrics'──▶ LoadTestService ──'metrics'──▶ SocketGateway ──▶ navegador
                                    └─'finished'─▶                  ├─'finished'──▶ IsrCache.invalidate()
                                                                    └─'deleted'───▶ ReportService.removeGenerated()
AnalysisService ──'created'──▶ ReportService.removeGenerated()
```

`LoadTestService` no sabe que existen Socket.io ni la caché ISR; solo emite eventos. Quien necesite reaccionar se suscribe en `bootstrap.js`.

| Ganamos | Pagamos |
|---|---|
| Módulos desacoplados: agregar un suscriptor no toca al emisor | El flujo es menos evidente: hay que leer `bootstrap.js` para ver quién escucha qué |
| Encaja con Node.js, que ya es un event loop | Un error dentro de un listener puede pasar inadvertido si no se registra |
| El tiempo real sale casi gratis: un evento se convierte en un mensaje de Socket.io | El orden entre listeners importa y no siempre es obvio |

Los otros paradigmas aparecen donde encajan mejor:

| Paradigma | Dónde | Por qué ahí |
|---|---|---|
| Orientado a objetos | Servicios, repositorios, proveedores de IA, `WorkerPool` | Encapsula estado (pruebas activas, conexiones, circuit breaker) y permite intercambiar implementaciones con la misma interfaz |
| Funcional (funciones puras) | `src/domain/`: percentiles, patrones de carga y comparación | Sin efectos secundarios: se prueban sin servidor ni base de datos |
| Concurrente | Worker Threads, memoria compartida y pool de workers | Generar carga y dibujar PDF no debe bloquear el event loop |

## Concurrencia: mensajes frente a memoria compartida

Los workers se comunican con el hilo principal de las dos formas, a propósito.

| | Mensajes (`postMessage`) | Memoria compartida (`SharedArrayBuffer` + `Atomics`) |
|---|---|---|
| Uso en el proyecto | Lotes de métricas, orden de cambiar los VUs | Bandera de parada; VUs activos y peticiones en vuelo |
| Copia de datos | Sí (structured clone) | No: todos ven la misma memoria |
| Latencia | Llega cuando el otro hilo atiende su cola | Inmediata |
| Riesgo | Ninguno de carreras: cada hilo tiene sus datos | Carreras si no se usa `Atomics` |
| Tipos de datos | Objetos arbitrarios | Solo números en un arreglo tipado |

**Por qué los dos:** un lote de métricas es un objeto complejo que se envía cada 100 ms; los mensajes son lo natural. La parada, en cambio, debe surtir efecto ya, aunque el worker tenga mensajes pendientes, y es un solo entero: la memoria compartida es ideal. `tests/unit/sharedControl.test.js` comprueba que cuatro hilos sumando a la vez no pierden ningún incremento.

## Workers: uno por prueba frente a un pool

| | Un worker por prueba (motor de carga) | Pool reutilizable (PDF) |
|---|---|---|
| Duración de la tarea | Larga: toda la prueba | Corta: un documento |
| Costo de crear el hilo | Irrelevante frente a la prueba | Importante si se crea en cada tarea |
| Aislamiento | Total: una prueba no afecta a otra | Las tareas comparten hilo, una tras otra |
| Memoria | Se libera al terminar la prueba | Hilos ociosos se cierran a los 30 s |

## Tiempo real: push con WebSocket frente a polling

| | Socket.io (push) | Polling HTTP (pull) |
|---|---|---|
| Latencia | El punto llega al instante | Hasta un intervalo de retraso |
| Peticiones | Una conexión abierta | Una petición por intervalo y cliente, aunque no haya cambios |
| Complejidad | Reconexión, salas y estado en el servidor | Muy simple y sin estado |
| Despliegue | Necesita un proceso que siga vivo (Render) | Funciona en funciones serverless |

Por eso el backend no va en Vercel: sus funciones no mantienen conexiones abiertas ni procesos largos. Además, `test:metrics` se envía como `volatile`: si un cliente va lento se descarta el punto en lugar de acumular mensajes. El cliente recupera lo perdido al terminar, pidiendo la prueba completa por REST.

## Renderizado: CSR, SSR, SSG e ISR

| Patrón | Dónde | Tiempo de servidor medido en producción |
|---|---|---|
| ISR | `/views/history` | 0,6 ms (desde caché) |
| SSG | `/views/reports/:id` | 1,4 ms (archivo ya generado) |
| CSR | Frontend React; la API devuelve JSON | 3,1 ms para los datos, y el navegador dibuja |
| SSR | `/views/compare` | 7,6 ms (base de datos y render en cada visita) |

Medido el 17/11/2026 contra Render Free y Neon Free, con la mediana de 5 peticiones. La página **Renderizado** del frontend repite la medición en vivo.

- **SSG solo sirve para lo inmutable.** Por eso un reporte se regenera si la prueba recibe su análisis con IA: es una revalidación bajo demanda.
- **ISR acepta servir algo unos segundos viejo** a cambio de que casi ninguna visita pague el render.
- **SSR** es para lo que depende de cada petición, como comparar dos pruebas elegidas por el usuario.
- **CSR** es para lo interactivo y en vivo, como el dashboard que recibe métricas por segundo.

## Contract-first frente a code-first

| | Contract-first (el elegido) | Code-first |
|---|---|---|
| Fuente de verdad | `contract/openapi.yaml` | El código del backend |
| Orden de trabajo | Primero el contrato, luego backend y frontend | Primero el código; la documentación se genera o se escribe después |
| Frontend y backend | Pueden avanzar en paralelo con el mismo contrato | El frontend espera a que exista el endpoint |
| Control | Pruebas de contrato en los dos repositorios | La documentación tiende a desactualizarse |
| Costo | Escribir y mantener el YAML | Menos trabajo inicial |

En el historial de git se ve el orden: el contrato del análisis con IA y el de `/health/live` se publicaron antes que su implementación.

## IA: proveedor principal con respaldo

| Decisión | Ganamos | Pagamos |
|---|---|---|
| Gemini principal y Groq de respaldo | El análisis sigue funcionando si un proveedor falla. En producción Gemini respondió 503 por saturación y Groq lo cubrió | Dos claves y dos formatos de API que mantener |
| Circuit breaker | Si Gemini cae, no se espera su tiempo límite en cada análisis | Durante un minuto no se reintenta Gemini aunque ya se haya recuperado |
| Validar la respuesta con Zod | Nunca se guarda ni se muestra un JSON con forma incorrecta | Una respuesta casi correcta se descarta y se pasa al otro proveedor |
| Guardar el análisis en Neon | Cada corrida consulta a la IA una sola vez, lo que cuida la cuota gratuita | El análisis no se actualiza si cambian las instrucciones; habría que borrarlo |
| Enviar un resumen, no los datos crudos | Pocas palabras de entrada y ninguna credencial | La IA no ve cada petición individual |

## Persistencia: PostgreSQL (Neon) frente a memoria

| | Neon (producción) | Memoria (desarrollo y pruebas) |
|---|---|---|
| Sobrevive a reinicios | Sí | No |
| Configuración | Cadena de conexión y migraciones | Ninguna |
| Velocidad en pruebas automáticas | Más lenta y depende de la red | Instantánea |

Ambos cumplen la misma interfaz (patrón Repository), así que los servicios no cambian según cuál se use.
