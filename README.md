# Tasky — demo full-stack

Demo mínima end-to-end construida para una entrevista técnica, alineada al stack pedido en la oferta
(Go, React Native/Expo, GCP). Prioridad: que funcione de punta a punta, no que se vea perfecta.

## Estructura

```
backend/      API en Go (Cloud Run + Cloud SQL MySQL)
mobile-app/   App Expo / React Native (consume el API)
```

## Backend

- Go 1.25, sin framework — `net/http` puro.
- Endpoints: `GET /health`, `POST /login`, `GET /tasks`, `POST /tasks`.
- Auth simplificada para demo (`ADMIN_EMAIL`/`ADMIN_PASSWORD` → token estático). En producción,
  reemplazar por **Identity Platform** validando el JWT emitido.
- Persistencia en Cloud SQL (MySQL 8.0) vía socket unix `/cloudsql/<INSTANCE_CONNECTION_NAME>`.
- Desplegado en **Cloud Run** (build automático con Cloud Build via buildpacks).

## Mobile

- Expo / React Native, 3 pantallas con estado simple (login → home → form).
- Apunta al mismo API que la web/backend.

## Cómo correr localmente

```bash
# backend
cd backend
go run . # requiere DB_HOST o INSTANCE_CONNECTION_NAME + DB_USER/DB_PASS/DB_NAME

# mobile
cd mobile-app
npx expo start
```

Ver `ARCHITECTURE.md` para las decisiones de arquitectura y qué se agregaría para producción.
