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

## El modelo de dominio

La demo no modela "tareas" genéricas: modela **turnos**, que es la unidad real del negocio de
Tasky. Un `Shift` tiene sede, servicio, ventana horaria y cupo de Taskers, y se va llenando con
confirmaciones hasta quedar cubierto.

Dos decisiones que vale la pena defender:

- **El estado es derivado, no almacenado.** `abierto / cubierto / en_curso / cerrado` se calcula al
  leer cruzando el reloj con la dotación. Un estado persistido se desincroniza apenas pasa la hora
  del turno y obliga a un job que lo corrija.
- **La confirmación es atómica sin lock.** `UPDATE … WHERE taskers_confirmed < taskers_needed` y se
  mira `RowsAffected()`. Con dos coordinadores confirmando al mismo tiempo, el cupo no se pasa.

### El cerco de llegada

Cada turno define un punto y un radio. El check-in reporta coordenadas y el servidor decide si
cuentan, calculando la distancia con la fórmula del semiverseno.

Por qué aritmética en Go y no funciones espaciales de MySQL: para decenas o cientos de metros el
semiverseno tiene error despreciable, no agrega dependencia y es trivial de testear. Cuando hiciera
falta *buscar* por proximidad —«qué turnos tengo a menos de 2 km»— ahí sí conviene un índice
espacial (`ST_Distance_Sphere` con índice `SPATIAL`, o PostGIS), porque el problema deja de ser
calcular una distancia y pasa a ser filtrar sin recorrer la tabla entera.

Limitaciones conocidas, que en producción habría que cubrir:

- **El GPS del teléfono se puede falsear.** La validación en el servidor evita el caso fácil
  (modificar la app), pero no un simulador de ubicación. Mitigaciones reales: contrastar con la red
  del dispositivo, exigir foto con metadatos, y marcar como sospechosas las llegadas con precisión
  reportada demasiado buena.
- **No se guarda la precisión del GPS.** Un teléfono puede reportar ±50 m en interiores; hoy se
  trata igual que una lectura exacta. Debería registrarse junto a la posición y ampliar el cerco
  efectivo en consecuencia.
- **No hay check-out.** Solo se registra la llegada, no la permanencia ni la salida.

### Lo que falta para que sea el producto real

- `Tasker` como entidad con verificación, historial y rating (hoy la confirmación es un contador)
- `CheckOut` y evidencia fotográfica → Cloud Storage + signed URLs
- Reemplazo automático cuando un Tasker no confirma o falta: **Cloud Tasks** con un timeout por
  turno, que dispara la reasignación
- Multi-tenant: hoy hay un solo usuario demo; en real, empresas con sus propios coordinadores →
  Identity Platform con custom claims
