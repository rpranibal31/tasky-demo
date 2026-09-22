# Tasky — demo full-stack

Demo end-to-end construida para una entrevista técnica, alineada al stack de la vacante
(Go, React Native/Expo, GCP). Modela el dominio real de Tasky: coordinación de **turnos**
de Taskers en terreno.

## Estructura

```
backend/      API en Go (Cloud Run + Cloud SQL MySQL 8.0)
mobile-app/   App Expo / React Native
web/          Panel de operaciones (Next.js 16 + Tailwind 4 + shadcn/ui)
```

Los tres clientes consumen **la misma API**: una sola fuente de verdad para el estado de los
turnos, ya sea que lo mire un coordinador desde el escritorio o un Tasker desde el teléfono.

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
| `POST` | `/shifts/{id}/checkin` | ✔ | Valida la llegada contra el cerco |

## Cercos de llegada

Cada turno tiene un punto (`lat`, `lng`) y un radio en metros. Cuando un Tasker marca llegada, la
app reporta su posición y **el servidor decide** si cuenta: calcula la distancia real con la fórmula
del semiverseno y la compara contra el radio.

```
POST /shifts/9/checkin   {"lat": -33.4176, "lng": -70.6068}
201  {"inside": true,  "distance_m": 0,    "message": "Check-in registrado a 0 m del punto."}

POST /shifts/9/checkin   {"lat": -33.4413, "lng": -70.6653}
422  {"inside": false, "distance_m": 6035, "message": "Estás a 6.0 km del punto. El cerco es de 150 m."}
```

Tres decisiones que vale la pena mirar:

- **La validación vive en el servidor.** El teléfono solo informa coordenadas; si la regla estuviera
  en el cliente, bastaría con modificar la app para falsear una llegada.
- **Fuera del cerco es `422`, no `400`.** La petición está bien formada; lo que no se cumple es una
  regla de negocio. Y la respuesta incluye la distancia real para que la app pueda explicar *por qué*
  falló en vez de mostrar un error genérico.
- **Cada llegada válida se guarda** en `check_ins` con posición y distancia. El cerco sin registro no
  sirve de nada: lo que el negocio necesita es la trazabilidad, no el permiso puntual.

Las columnas del cerco se agregaron sobre una tabla que ya tenía datos en producción, con una
migración idempotente que consulta `information_schema` antes de alterar — MySQL 8.0 no soporta
`ADD COLUMN IF NOT EXISTS`, y un redeploy sobre una base ya migrada no debe fallar.

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

### Tests

```bash
cd backend && go test ./... -v
```

Cubren la lógica de negocio que no depende de la base: los cuatro estados derivados, la ventana
horaria (incluido el turno que cruza medianoche) y la normalización de la entrada. `deriveStatus`
recibe el `now` como parámetro en vez de llamar a `time.Now()` justamente para poder verificarla
sin depender del reloj.

Hay además un test de regresión sobre `asChile`: durante el desarrollo, los turnos se guardaban
bien pero se mostraban tres horas más tarde, porque el código re-etiquetaba el `DATETIME` como
hora de Chile en lugar de convertirlo desde UTC. El test fija el comportamiento correcto.

## Mobile

Expo / React Native. Cuatro pantallas con estado simple: login → lista → detalle → formulario.

Dirección de diseño *workwear*: la paleta sale de la ropa de trabajo real de un Tasker en terreno
(ámbar alta visibilidad sobre azul mezclilla profundo), tipografía Barlow Condensed para títulos
—lee como señalética de bodega— e Inter para cuerpo. Cada turno se dibuja como un **talón
troquelado**: mitad entrada de evento, mitad tarjeta de reloj control.

## Web — panel de operaciones

Next.js 16 (App Router) con Tailwind 4, shadcn/ui y lucide-react.

- **Server Components**: el tablero se arma en el servidor con `cache: "no-store"` — los turnos
  cambian de estado con el reloj, así que cachear la lista no tiene sentido.
- **Server Actions**: login y mutaciones corren en el servidor; el token nunca llega al navegador.
- **Cookie `httpOnly`**: la sesión no es legible desde JavaScript, a diferencia de `localStorage`.
- **`revalidatePath`** después de cada mutación: el tablero se refresca solo, sin estado cliente
  que mantener sincronizado.
- Los turnos se agrupan por jornada, que es como piensa la semana un coordinador.

> Nota: esta versión de shadcn/ui ya migró de Radix a **Base UI**, así que los triggers se componen
> con `render={...}` en lugar de `asChild`.

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
