# Despliegue gratuito: Neon, Render y Vercel

| Pieza | Servicio | Plan |
|---|---|---|
| Base de datos PostgreSQL | Neon | Free |
| Backend (API, Socket.io y workers) | Render, Web Service | Free |
| API de ejemplo para probar | Render, Web Service | Free |
| Frontend | Vercel | Hobby |

Ningún secreto va en el código. Los valores reales se escriben solo en los paneles de Neon, Render y Vercel, o en tu `.env` local, que está en `.gitignore`.

## 1. Neon: la base de datos

1. Crea una cuenta en <https://neon.tech> y un proyecto nuevo. Elige **AWS US East 2 (Ohio)**, la misma región que fija `render.yaml` para Render.
2. En el panel del proyecto pulsa **Connect** y copia la *connection string* con **Connection pooling** activado. Tiene esta forma:
   `postgresql://<usuario>:<contraseña>@<host-de-neon>/neondb?sslmode=verify-full`

   Neon la entrega terminada en `?sslmode=require&channel_binding=require`. Cambia ese final por `?sslmode=verify-full`: el driver `pg` ignora `channel_binding` y ya trata `require` como `verify-full`, así que escribirlo explícito evita su advertencia de seguridad.
3. No hace falta crear tablas: el backend aplica las migraciones de `src/database/migrations/` cada vez que arranca.

## 2. Claves de IA

- Gemini: <https://aistudio.google.com/apikey>
- Groq: <https://console.groq.com/keys>

Basta con una de las dos; con ambas, Groq funciona como respaldo de Gemini.

## 3. Render: el backend

1. En <https://render.com> elige **New → Blueprint** y conecta el repositorio `TESTEADOR-CARGA-BACKEND`. Render lee `render.yaml` y crea dos servicios gratuitos:
   - `testeador-carga-api`: el backend.
   - `testeador-carga-demo`: la API de ejemplo.
2. Render pide los secretos marcados con `sync: false`:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | La cadena de Neon del paso 1 |
   | `GEMINI_API_KEY` | Tu clave de Gemini |
   | `GROQ_API_KEY` | Tu clave de Groq |
   | `CORS_ORIGINS` | La URL de Vercel. Si aún no la tienes, pon `http://localhost:5173` y cámbiala en el paso 5 |
   | `DEMO_VERIFICATION_TOKEN` | Cualquier texto por ahora; se reemplaza en el paso 4 |

3. Cuando termine, comprueba `https://testeador-carga-api.onrender.com/health`. Debe responder `"database":"up"`.

## 4. Verificar la API de ejemplo

En producción el backend solo envía carga a dominios verificados, así que la API de ejemplo se verifica como cualquier dominio propio:

1. En el frontend, en **Dominios**, registra `testeador-carga-demo.onrender.com` y copia el token que aparece.
2. En Render, abre el servicio `testeador-carga-demo` → **Environment**, pega el token en `DEMO_VERIFICATION_TOKEN` y guarda. El servicio se reinicia solo.
3. Vuelve a **Dominios** y pulsa **Verificar por HTTP**. Ya puedes lanzar pruebas contra `https://testeador-carga-demo.onrender.com/slow`.

## 5. Vercel: el frontend

1. En <https://vercel.com> elige **Add New → Project** e importa el repositorio `TESTEADOR-CARGA-FRONTEND`.
2. Añade la variable `VITE_API_URL` con el valor `https://testeador-carga-api.onrender.com`.
3. Cuando termine el despliegue, copia la URL que asignó Vercel y ponla en `CORS_ORIGINS` del backend en Render. Si necesitas varias, sepáralas con comas.

## Lo que implica el plan gratuito

| Límite | Efecto | Cómo lo maneja el proyecto |
|---|---|---|
| Render se duerme tras 15 min sin tráfico | La primera visita tarda cerca de un minuto | Nada que hacer en el plan gratuito; conviene abrirlo antes de una demostración |
| Render tiene 0,1 CPU y 512 MB | Pocos usuarios virtuales a la vez | `render.yaml` fija 1 worker, máximo 200 VUs, 120 s y una prueba simultánea |
| Disco temporal en Render | Los reportes SSG se borran al reiniciar | Se regeneran en la siguiente visita; los datos siguen en Neon |
| Render da 750 horas al mes por cuenta | Dos servicios encendidos todo el mes no caben | Como se duermen sin tráfico, en la práctica alcanza |
| Neon suspende el cómputo sin uso | La primera consulta tras la pausa es más lenta | El *health check* usa `/health/live`, que no toca la base de datos, para no despertarla |
| Cuotas gratuitas de Gemini y Groq | Límite de peticiones por minuto y por día | Cada análisis se genera una sola vez y se guarda; además hay un límite propio de 10 por minuto |
