# Tasky — demo full-stack

Demo end-to-end construida para una entrevista técnica, alineada al stack de la vacante
(Go, React Native/Expo, GCP). Modela el dominio real de Tasky: coordinación de **turnos**
de Taskers en terreno.

## Estructura

```
backend/      API en Go (Cloud Run + Cloud SQL MySQL 8.0)
mobile-app/   App Expo / React Native
```

## Dominio

Una empresa publica un **turno**: sede, servicio, ventana horaria y cuántos Taskers necesita.
Los Taskers se van confirmando hasta cubrirlo. El estado del turno no se guarda: se deriva al
leer, cruzando el reloj con la dotación confirmada.

| Estado | Cuándo |
|---|---|
| `abierto` | Faltan Taskers por confirmar |
| `cubierto` | Cupo completo, el turno aún no empieza |
| `en_curso` | Estamos dentro de la ventana horaria |
| `cerrado` | La ventana ya terminó |

## API

| Método | Ruta | Auth | Qué hace |
|---|---|---|---|
| `GET` | `/health` | — | Healthcheck |
| `POST` | `/login` | — | Devuelve el token de demo |
| `GET` | `/shifts` | — | Lista turnos ordenados por inicio |
| `POST` | `/shifts` | ✔ | Publica un turno |
| `GET` | `/shifts/{id}` | — | Detalle de un turno |
| `PUT` | `/shifts/{id}` | ✔ | Edita un turno |
| `DELETE` | `/shifts/{id}` | ✔ | Cancela un turno |
| `POST` | `/shifts/{id}/confirm` | ✔ | Suma un Tasker confirmado |

Detalles que vale la pena mirar en el código:

- **Confirmación sin lock**: `UPDATE … WHERE taskers_confirmed < taskers_needed` más
  `RowsAffected()`. Dos confirmaciones simultáneas no pueden sobrepasar el cupo.
- **Husos horarios**: MySQL guarda el instante en UTC y el API lo devuelve convertido a hora de
  Chile (`-03:00`). La app lee la hora por posición en el string, así el huso del teléfono nunca
  corre la hora del turno.
- **Turnos nocturnos**: si el término es menor o igual al inicio, el turno cierra al día siguiente
  (eventos, logística).
- **Regla de negocio en el update**: no se puede bajar el cupo por debajo de los Taskers ya
  confirmados; devuelve `409`.

Auth simplificada para la demo (`ADMIN_EMAIL`/`ADMIN_PASSWORD` → token estático). En producción
se reemplaza por **Identity Platform** validando el JWT emitido.

## Mobile

Expo / React Native. Cuatro pantallas con estado simple: login → lista → detalle → formulario.

Dirección de diseño *workwear*: la paleta sale de la ropa de trabajo real de un Tasker en terreno
(ámbar alta visibilidad sobre azul mezclilla profundo), tipografía Barlow Condensed para títulos
—lee como señalética de bodega— e Inter para cuerpo. Cada turno se dibuja como un **talón
troquelado**: mitad entrada de evento, mitad tarjeta de reloj control.

## Cómo correr localmente

```bash
# backend — requiere DB_HOST o INSTANCE_CONNECTION_NAME + DB_USER/DB_PASS/DB_NAME
cd backend
go run .

# mobile
cd mobile-app
npx expo start
```

Ver `ARCHITECTURE.md` para las decisiones de arquitectura y `CLEANUP.md` para borrar la
infraestructura.
