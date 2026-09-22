// Tasky API — backend de coordinación de turnos.
//
// Modela el dominio real de Tasky: una empresa publica un turno (sede, servicio,
// ventana horaria, cuántos Taskers necesita) y los Taskers se van confirmando
// hasta cubrirlo.
//
// Endpoints:
//
//	GET  /health
//	POST /login
//	GET    /shifts
//	POST   /shifts
//	GET    /shifts/{id}
//	PUT    /shifts/{id}
//	DELETE /shifts/{id}
//	POST   /shifts/{id}/confirm
//	POST   /shifts/{id}/checkin
//	GET    /events   (SSE: avisa cuando algo cambia)
//
// Auth simplificada para demo: valida contra ADMIN_EMAIL/ADMIN_PASSWORD (env vars)
// y devuelve un token estático. En producción esto lo reemplazarías por Identity
// Platform (validar el JWT que emite).
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

var db *sql.DB

// Los turnos se publican y se leen en hora de Chile continental. MySQL guarda el
// instante en UTC (el driver convierte al escribir); acá lo traemos de vuelta a
// hora local al serializar, así el turno muestra la misma hora que digitó el
// coordinador sin importar el huso del teléfono ni el del contenedor.
var chile = time.FixedZone("-03", -3*60*60)

const demoToken = "demo-token"

type Shift struct {
	ID               int64   `json:"id"`
	Venue            string  `json:"venue"`
	Role             string  `json:"role"`
	Address          string  `json:"address"`
	Lat              float64 `json:"lat"`
	Lng              float64 `json:"lng"`
	RadiusM          int     `json:"radius_m"`
	StartsAt         string  `json:"starts_at"`
	EndsAt           string  `json:"ends_at"`
	TaskersNeeded    int     `json:"taskers_needed"`
	TaskersConfirmed int     `json:"taskers_confirmed"`
	CheckIns         int     `json:"checkins"`
	Status           string  `json:"status"`
	CreatedAt        string  `json:"created_at"`
}

type createShiftRequest struct {
	Venue         string  `json:"venue"`
	Role          string  `json:"role"`
	Address       string  `json:"address"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
	RadiusM       int     `json:"radius_m"`
	Date          string  `json:"date"`       // AAAA-MM-DD
	StartTime     string  `json:"start_time"` // HH:MM
	EndTime       string  `json:"end_time"`   // HH:MM
	TaskersNeeded int     `json:"taskers_needed"`
}

// checkInRequest lleva la posición que reporta el teléfono del Tasker.
type checkInRequest struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

const defaultRadiusM = 150

/* ------------------------------------------------------------- eventos -- */

// hub reparte avisos de cambio a los clientes conectados por SSE. Es
// deliberadamente mínimo: no guarda historial ni garantiza entrega, solo avisa
// "algo cambió, volvé a pedir la lista". Si un aviso se pierde, el sondeo del
// cliente lo cubre.
//
// Limitación conocida: el hub vive en memoria, así que solo alcanza a los
// clientes conectados a ESTA instancia. Con varias instancias de Cloud Run haría
// falta un bus compartido (Pub/Sub o Redis) para que el aviso llegue a todos.
type hub struct {
	mu      sync.RWMutex
	clients map[chan string]struct{}
}

func newHub() *hub {
	return &hub{clients: make(map[chan string]struct{})}
}

func (h *hub) subscribe() chan string {
	// Con búfer: si un cliente está lento, el broadcast no se bloquea.
	ch := make(chan string, 8)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *hub) unsubscribe(ch chan string) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *hub) broadcast(event string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients {
		select {
		case ch <- event:
		default:
			// Cliente saturado: se descarta el aviso en vez de frenar al resto.
		}
	}
}

func (h *hub) count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

var events = newHub()

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func main() {
	var err error
	db, err = connectDB()
	if err != nil {
		log.Fatalf("db connection failed: %v", err)
	}
	defer db.Close()

	if err := ensureSchema(); err != nil {
		log.Fatalf("schema setup failed: %v", err)
	}
	if err := seedIfEmpty(); err != nil {
		log.Printf("seed skipped: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", withCORS(handleHealth))
	mux.HandleFunc("/login", withCORS(handleLogin))
	mux.HandleFunc("/shifts", withCORS(handleShifts))
	mux.HandleFunc("/shifts/{id}", withCORS(handleShiftByID))
	mux.HandleFunc("/shifts/{id}/confirm", withCORS(handleConfirm))
	mux.HandleFunc("/shifts/{id}/checkin", withCORS(handleCheckIn))
	mux.HandleFunc("/events", withCORS(handleEvents))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

// connectDB arma el DSN según el contexto:
//   - En Cloud Run con Cloud SQL: usa el socket unix /cloudsql/<INSTANCE_CONNECTION_NAME>
//   - En local (o si seteas DB_HOST): usa TCP normal
func connectDB() (*sql.DB, error) {
	user := os.Getenv("DB_USER")
	pass := os.Getenv("DB_PASS")
	name := os.Getenv("DB_NAME")
	instanceConnectionName := os.Getenv("INSTANCE_CONNECTION_NAME") // proyecto:región:instancia
	host := os.Getenv("DB_HOST")                                    // solo para local

	var dsn string
	if instanceConnectionName != "" {
		dsn = fmt.Sprintf("%s:%s@unix(/cloudsql/%s)/%s?parseTime=true",
			user, pass, instanceConnectionName, name)
	} else if host != "" {
		dsn = fmt.Sprintf("%s:%s@tcp(%s:3306)/%s?parseTime=true", user, pass, host, name)
	} else {
		return nil, fmt.Errorf("faltan DB_HOST o INSTANCE_CONNECTION_NAME")
	}

	conn, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(5)
	return conn, nil
}

func ensureSchema() error {
	// `role` es palabra reservada en MySQL 8.0, por eso la columna es job_role.
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS shifts (
			id INT AUTO_INCREMENT PRIMARY KEY,
			venue VARCHAR(160) NOT NULL,
			job_role VARCHAR(160) NOT NULL,
			starts_at DATETIME NOT NULL,
			ends_at DATETIME NOT NULL,
			taskers_needed INT NOT NULL DEFAULT 1,
			taskers_confirmed INT NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL,
			INDEX idx_starts_at (starts_at)
		)`); err != nil {
		return err
	}

	// El cerco se agregó después de que la tabla ya tenía datos en producción,
	// así que las columnas se suman con una migración idempotente en vez de
	// recrear la tabla. MySQL 8.0 no soporta ADD COLUMN IF NOT EXISTS.
	columns := []struct{ name, definition string }{
		{"address", "VARCHAR(240) NOT NULL DEFAULT ''"},
		{"lat", "DOUBLE NOT NULL DEFAULT 0"},
		{"lng", "DOUBLE NOT NULL DEFAULT 0"},
		{"radius_m", "INT NOT NULL DEFAULT 150"},
	}
	for _, c := range columns {
		if err := ensureColumn("shifts", c.name, c.definition); err != nil {
			return err
		}
	}

	// Cada check-in guarda dónde estaba el Tasker y a qué distancia del punto:
	// esa es la trazabilidad que justifica el cerco.
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS check_ins (
			id INT AUTO_INCREMENT PRIMARY KEY,
			shift_id INT NOT NULL,
			lat DOUBLE NOT NULL,
			lng DOUBLE NOT NULL,
			distance_m INT NOT NULL,
			created_at DATETIME NOT NULL,
			INDEX idx_shift (shift_id)
		)`)
	return err
}

// ensureColumn agrega una columna solo si todavía no existe. Consultar
// information_schema antes de alterar evita que un redeploy falle sobre una
// base que ya fue migrada.
func ensureColumn(table, column, definition string) error {
	var found int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
		table, column).Scan(&found)
	if err != nil {
		return err
	}
	if found > 0 {
		return nil
	}
	_, err = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition))
	if err == nil {
		log.Printf("migración: %s.%s agregada", table, column)
	}
	return err
}

// seedIfEmpty carga turnos de ejemplo la primera vez, para que la app nunca se
// vea vacía en una demo. Solo corre si la tabla no tiene filas.
func seedIfEmpty() error {
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM shifts").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	today := time.Now().In(chile)
	day := func(offset int) time.Time {
		d := today.AddDate(0, 0, offset)
		return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, chile)
	}
	at := func(base time.Time, hour, min int) time.Time {
		return base.Add(time.Duration(hour)*time.Hour + time.Duration(min)*time.Minute)
	}

	seeds := []struct {
		venue     string
		role      string
		address   string
		lat       float64
		lng       float64
		radius    int
		base      time.Time
		startH    int
		endH      int
		needed    int
		confirmed int
	}{
		{"Costanera Center", "Reposición retail", "Av. Andrés Bello 2425, Providencia",
			-33.417600, -70.606800, 150, day(1), 14, 22, 4, 4},
		{"Movistar Arena", "Control de acceso", "Av. Beaucheff 1204, Santiago",
			-33.441300, -70.665300, 200, day(2), 18, 26, 12, 7},
		{"Enea Pudahuel", "Picking y despacho", "Parque Enea, Pudahuel",
			-33.390000, -70.790000, 300, day(3), 7, 15, 6, 2},
	}

	for _, s := range seeds {
		start := at(s.base, s.startH, 0)
		end := at(s.base, s.endH, 0)
		_, err := db.Exec(`
			INSERT INTO shifts (venue, job_role, address, lat, lng, radius_m,
				starts_at, ends_at, taskers_needed, taskers_confirmed, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			s.venue, s.role, s.address, s.lat, s.lng, s.radius,
			start, end, s.needed, s.confirmed, time.Now().In(chile))
		if err != nil {
			return err
		}
	}
	log.Printf("seeded %d shifts", len(seeds))
	return nil
}

func withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func authorized(r *http.Request) bool {
	return r.Header.Get("Authorization") == "Bearer "+demoToken
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	wantEmail := os.Getenv("ADMIN_EMAIL")
	wantPass := os.Getenv("ADMIN_PASSWORD")
	if wantEmail == "" {
		wantEmail = "demo@tasky.dev"
	}
	if wantPass == "" {
		wantPass = "demo123"
	}

	if req.Email != wantEmail || req.Password != wantPass {
		http.Error(w, "credenciales inválidas", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": demoToken})
}

func handleShifts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listShifts(w, r)
	case http.MethodPost:
		createShift(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func listShifts(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT id, venue, job_role, address, lat, lng, radius_m,
			starts_at, ends_at, taskers_needed, taskers_confirmed, created_at,
			(SELECT COUNT(*) FROM check_ins c WHERE c.shift_id = shifts.id)
		FROM shifts ORDER BY starts_at ASC`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	shifts := []Shift{}
	for rows.Next() {
		s, err := scanShift(rows)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		shifts = append(shifts, s)
	}
	writeJSON(w, http.StatusOK, shifts)
}

func createShift(w http.ResponseWriter, r *http.Request) {
	if !authorized(r) {
		http.Error(w, "no autorizado", http.StatusUnauthorized)
		return
	}
	var req createShiftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	start, end, err := validateShift(&req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	res, err := db.Exec(`
		INSERT INTO shifts (venue, job_role, address, lat, lng, radius_m,
			starts_at, ends_at, taskers_needed, taskers_confirmed, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
		req.Venue, req.Role, req.Address, req.Lat, req.Lng, req.RadiusM,
		start, end, req.TaskersNeeded, time.Now().In(chile))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	id, _ := res.LastInsertId()

	shift, err := getShift(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	notify("created", id)
	writeJSON(w, http.StatusCreated, shift)
}

// validateShift normaliza y valida el payload, y devuelve la ventana horaria ya
// resuelta. Lo comparten crear y editar para que ambas rutas apliquen las mismas
// reglas.
func validateShift(req *createShiftRequest) (time.Time, time.Time, error) {
	req.Venue = strings.TrimSpace(req.Venue)
	req.Role = strings.TrimSpace(req.Role)
	if req.Venue == "" {
		return time.Time{}, time.Time{}, fmt.Errorf("la sede es requerida")
	}
	if req.Role == "" {
		return time.Time{}, time.Time{}, fmt.Errorf("el servicio es requerido")
	}
	if req.TaskersNeeded < 1 {
		req.TaskersNeeded = 1
	}
	req.Address = strings.TrimSpace(req.Address)
	if req.RadiusM <= 0 {
		req.RadiusM = defaultRadiusM
	}
	// Un cerco sin coordenadas no valida nada; se acepta el turno pero queda sin
	// cerco, y el check-in lo rechaza explicando por qué.
	if (req.Lat != 0 || req.Lng != 0) && !validCoordinate(req.Lat, req.Lng) {
		return time.Time{}, time.Time{}, fmt.Errorf("coordenadas inválidas")
	}

	start, err := parseWallClock(req.Date, req.StartTime)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("fecha u hora de inicio inválida")
	}
	end, err := parseWallClock(req.Date, req.EndTime)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("hora de término inválida")
	}
	// Turnos que cruzan medianoche (eventos, logística nocturna) terminan al día siguiente.
	if !end.After(start) {
		end = end.AddDate(0, 0, 1)
	}
	return start, end, nil
}

func handleShiftByID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "id inválido", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		shift, err := getShift(id)
		if err == sql.ErrNoRows {
			http.Error(w, "turno no encontrado", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, shift)

	case http.MethodPut:
		updateShift(w, r, id)

	case http.MethodDelete:
		deleteShift(w, r, id)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func updateShift(w http.ResponseWriter, r *http.Request, id int64) {
	if !authorized(r) {
		http.Error(w, "no autorizado", http.StatusUnauthorized)
		return
	}
	var req createShiftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	start, end, err := validateShift(&req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// No se puede pedir menos Taskers de los que ya confirmaron: habría gente
	// asignada a un cupo que dejó de existir.
	var confirmed int
	if err := db.QueryRow("SELECT taskers_confirmed FROM shifts WHERE id = ?", id).Scan(&confirmed); err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "turno no encontrado", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if req.TaskersNeeded < confirmed {
		http.Error(w, fmt.Sprintf("ya hay %d Taskers confirmados: no podés bajar el cupo por debajo de eso", confirmed), http.StatusConflict)
		return
	}

	_, err = db.Exec(`
		UPDATE shifts SET venue = ?, job_role = ?, address = ?, lat = ?, lng = ?, radius_m = ?,
			starts_at = ?, ends_at = ?, taskers_needed = ?
		WHERE id = ?`,
		req.Venue, req.Role, req.Address, req.Lat, req.Lng, req.RadiusM,
		start, end, req.TaskersNeeded, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	shift, err := getShift(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	notify("updated", id)
	writeJSON(w, http.StatusOK, shift)
}

func deleteShift(w http.ResponseWriter, r *http.Request, id int64) {
	if !authorized(r) {
		http.Error(w, "no autorizado", http.StatusUnauthorized)
		return
	}
	res, err := db.Exec("DELETE FROM shifts WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		http.Error(w, "turno no encontrado", http.StatusNotFound)
		return
	}
	notify("deleted", id)
	w.WriteHeader(http.StatusNoContent)
}

// handleConfirm suma un Tasker confirmado al turno. El UPDATE condicional evita
// que dos confirmaciones simultáneas sobrepasen el cupo sin necesidad de lock.
func handleConfirm(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !authorized(r) {
		http.Error(w, "no autorizado", http.StatusUnauthorized)
		return
	}

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "id inválido", http.StatusBadRequest)
		return
	}

	res, err := db.Exec(`
		UPDATE shifts SET taskers_confirmed = taskers_confirmed + 1
		WHERE id = ? AND taskers_confirmed < taskers_needed`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		http.Error(w, "el turno ya está cubierto o no existe", http.StatusConflict)
		return
	}

	shift, err := getShift(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	notify("confirmed", id)
	writeJSON(w, http.StatusOK, shift)
}

func getShift(id int64) (Shift, error) {
	row := db.QueryRow(`
		SELECT id, venue, job_role, address, lat, lng, radius_m,
			starts_at, ends_at, taskers_needed, taskers_confirmed, created_at,
			(SELECT COUNT(*) FROM check_ins c WHERE c.shift_id = shifts.id)
		FROM shifts WHERE id = ?`, id)
	return scanShift(row)
}

// scanner abstrae *sql.Row y *sql.Rows para reusar el mismo mapeo.
type scanner interface {
	Scan(dest ...any) error
}

func scanShift(sc scanner) (Shift, error) {
	var s Shift
	var startsAt, endsAt, createdAt time.Time
	err := sc.Scan(&s.ID, &s.Venue, &s.Role, &s.Address, &s.Lat, &s.Lng, &s.RadiusM,
		&startsAt, &endsAt, &s.TaskersNeeded, &s.TaskersConfirmed, &createdAt, &s.CheckIns)
	if err != nil {
		return s, err
	}
	s.StartsAt = asChile(startsAt).Format(time.RFC3339)
	s.EndsAt = asChile(endsAt).Format(time.RFC3339)
	s.CreatedAt = asChile(createdAt).Format(time.RFC3339)
	s.Status = deriveStatus(time.Now().In(chile), asChile(startsAt), asChile(endsAt),
		s.TaskersNeeded, s.TaskersConfirmed)
	return s, nil
}

// handleEvents mantiene abierta una conexión SSE y empuja un aviso cada vez que
// cambia algo. No viaja el turno completo a propósito: el cliente vuelve a pedir
// la lista, y así una reconexión o un aviso perdido no dejan pantallas
// desincronizadas.
func handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming no soportado", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Cloud Run y los proxies intermedios pueden acumular la respuesta; esto
	// pide explícitamente que no lo hagan.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	ch := events.subscribe()
	defer events.unsubscribe(ch)

	fmt.Fprintf(w, "event: ready\ndata: {\"clients\":%d}\n\n", events.count())
	flusher.Flush()

	// El latido evita que un proxy corte una conexión que parece inactiva.
	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			fmt.Fprintf(w, "event: shifts\ndata: %s\n\n", msg)
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": keep-alive\n\n")
			flusher.Flush()
		}
	}
}

// notify avisa a los clientes conectados qué pasó, para que recarguen.
func notify(reason string, shiftID int64) {
	events.broadcast(fmt.Sprintf(`{"reason":%q,"shift_id":%d}`, reason, shiftID))
}

// handleCheckIn valida que el Tasker esté dentro del cerco del turno antes de
// registrar su llegada. La validación pasa en el servidor a propósito: la app
// solo reporta coordenadas, y lo que decide si son aceptables es el backend.
func handleCheckIn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !authorized(r) {
		http.Error(w, "no autorizado", http.StatusUnauthorized)
		return
	}

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "id inválido", http.StatusBadRequest)
		return
	}

	var req checkInRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if !validCoordinate(req.Lat, req.Lng) {
		http.Error(w, "coordenadas inválidas", http.StatusBadRequest)
		return
	}

	shift, err := getShift(id)
	if err == sql.ErrNoRows {
		http.Error(w, "turno no encontrado", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if shift.Lat == 0 && shift.Lng == 0 {
		http.Error(w, "el turno no tiene un cerco configurado", http.StatusUnprocessableEntity)
		return
	}

	radius := shift.RadiusM
	if radius <= 0 {
		radius = defaultRadiusM
	}
	distance := int(distanceMeters(req.Lat, req.Lng, shift.Lat, shift.Lng) + 0.5)
	inside := distance <= radius

	result := map[string]any{
		"inside":     inside,
		"distance_m": distance,
		"radius_m":   radius,
		"venue":      shift.Venue,
		"address":    shift.Address,
	}

	if !inside {
		// 422: la petición es válida pero la posición no cumple la regla.
		result["message"] = fmt.Sprintf("Estás a %s del punto. El cerco es de %d m.",
			humanDistance(distance), radius)
		writeJSON(w, http.StatusUnprocessableEntity, result)
		return
	}

	_, err = db.Exec(`
		INSERT INTO check_ins (shift_id, lat, lng, distance_m, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		id, req.Lat, req.Lng, distance, time.Now().In(chile))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	notify("checkin", id)
	result["message"] = fmt.Sprintf("Check-in registrado a %s del punto.", humanDistance(distance))
	writeJSON(w, http.StatusCreated, result)
}

// distanceMeters calcula la distancia sobre la superficie terrestre entre dos
// coordenadas (fórmula del semiverseno). Es suficiente para cercos de decenas o
// cientos de metros; para precisión geodésica real habría que usar PostGIS o las
// funciones espaciales de MySQL.
func distanceMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusM = 6371000.0

	rad := func(deg float64) float64 { return deg * math.Pi / 180 }

	dLat := rad(lat2 - lat1)
	dLng := rad(lng2 - lng1)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)

	return earthRadiusM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func validCoordinate(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat == 0 && lng == 0)
}

func humanDistance(meters int) string {
	if meters < 1000 {
		return fmt.Sprintf("%d m", meters)
	}
	return fmt.Sprintf("%.1f km", float64(meters)/1000)
}

// deriveStatus no se guarda en la tabla: se calcula al leer, para que el estado
// nunca quede desincronizado del reloj ni de la dotación. Recibe `now` en vez de
// llamar a time.Now() para que sea verificable sin depender del reloj real.
func deriveStatus(now, start, end time.Time, needed, confirmed int) string {
	switch {
	case now.After(end):
		return "cerrado"
	case !now.Before(start):
		return "en_curso"
	case confirmed >= needed:
		return "cubierto"
	default:
		return "abierto"
	}
}

// asChile convierte el instante leído de MySQL (UTC) a hora de Chile.
func asChile(t time.Time) time.Time {
	return t.In(chile)
}

func parseWallClock(date, clock string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02 15:04", date+" "+clock, chile)
}
