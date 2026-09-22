# Arquitectura — estado actual vs. producción

Esta demo prioriza velocidad y un flujo end-to-end real (login → crear tarea → verla en la lista)
sobre completitud de infraestructura. Documento acá qué quedó implementado y qué agregaría para un
entorno de producción real, siguiendo el stack de la vacante.

## Implementado en esta demo

- **Backend**: Go 1.25 en Cloud Run, sin framework, build automático vía Cloud Build (buildpacks).
- **DB**: Cloud SQL MySQL 8.0 (`db-f1-micro`), conectado a Cloud Run por el conector nativo
  (`--add-cloudsql-instances`, socket unix), sin exponer IP pública de la DB.
- **Mobile**: Expo / React Native consumiendo el API directamente.
- **Logging**: Cloud Logging captura stdout/stderr de Cloud Run automáticamente — sin configuración
  adicional.
- **Control de versiones**: Git + GitHub, historial de commits real.

## Qué agregaría para producción (y por qué no está hoy)

| Pieza | Para qué | Por qué no está en la demo |
|---|---|---|
| **Identity Platform** | Auth real (JWT, multi-usuario, roles) en vez de un token estático | El login demo valida contra env vars; suficiente para probar el flujo, no para producción |
| **VPC + Serverless VPC Access connector** | Cloud SQL con IP solo privada, sin exposición ni siquiera vía Cloud SQL Proxy público | Con una sola instancia y el conector nativo de Cloud Run alcanza para una demo; en prod restringiría la DB a red privada |
| **Load Balancer (HTTPS externo) + Cloud Armor** | Dominio propio, WAF, multi-región | Cloud Run ya da HTTPS gestionado; un LB se justifica con tráfico real o necesidad de dominio/CDN propio |
| **Cloud Tasks** | Procesamiento async (ej. notificar Taskers, reintentos de webhooks) | No hay trabajo async que lo requiera en un CRUD simple de tareas |
| **BigQuery + Looker Studio** | Analytics de uso (cuántas tareas se crean, por quién, SLA de cumplimiento — muy relevante al modelo de Tasky.cl de staffing con SLA de activación) | Requiere volumen de datos real y pipeline de eventos; para un demo de 3 horas no aporta señal, sí en un roadmap de 2-4 semanas |

## Si esto modelara el dominio real de Tasky (staffing, no solo to-dos)

El "Task" de esta demo es genérico. En el dominio real de Tasky.cl, el modelo se parecería más a:

- `Shift` (turno) en vez de `Task`: empresa, sede, fecha/hora, cantidad de Taskers requeridos
- `Tasker` con verificación, historial y rating
- `CheckIn`/`CheckOut` geolocalizado + evidencia fotográfica
- Reemplazo automático si un Tasker no confirma o falta (probablemente vía Cloud Tasks + Cloud
  Scheduler para el timeout)
