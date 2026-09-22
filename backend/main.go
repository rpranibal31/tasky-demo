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
	"net/http"
	"os"
	"strconv"
	"strings"
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
	ID               int64  `json:"id"`
	Venue            string `json:"venue"`
	Role             string `json:"role"`
	StartsAt         string `json:"starts_at"`
	EndsAt           string `json:"ends_at"`
	TaskersNeeded    int    `json:"taskers_needed"`
	TaskersConfirmed int    `json:"taskers_confirmed"`
	Status           string `json:"status"`
	CreatedAt        string `json:"created_at"`
}

type createShiftRequest struct {
	Venue         string `json:"venue"`
	Role          string `json:"role"`
	Date          string `json:"date"`       // AAAA-MM-DD
	StartTime     string `json:"start_time"` // HH:MM
	EndTime       string `json:"end_time"`   // HH:MM
	TaskersNeeded int    `json:"taskers_needed"`
}

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
	_, err := db.Exec(`
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
		)`)
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
		base      time.Time
		startH    int
		endH      int
		needed    int
		confirmed int
	}{
		{"Costanera Center", "Reposición retail", day(1), 14, 22, 4, 4},
		{"Movistar Arena", "Control de acceso", day(2), 18, 26, 12, 7},
		{"Enea Pudahuel", "Picking y despacho", day(3), 7, 15, 6, 2},
	}

	for _, s := range seeds {
		start := at(s.base, s.startH, 0)
		end := at(s.base, s.endH, 0)
		_, err := db.Exec(`
			INSERT INTO shifts (venue, job_role, starts_at, ends_at, taskers_needed, taskers_confirmed, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			s.venue, s.role, start, end, s.needed, s.confirmed, time.Now().In(chile))
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
		SELECT id, venue, job_role, starts_at, ends_at, taskers_needed, taskers_confirmed, created_at
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
		INSERT INTO shifts (venue, job_role, starts_at, ends_at, taskers_needed, taskers_confirmed, created_at)
		VALUES (?, ?, ?, ?, ?, 0, ?)`,
		req.Venue, req.Role, start, end, req.TaskersNeeded, time.Now().In(chile))
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
		UPDATE shifts SET venue = ?, job_role = ?, starts_at = ?, ends_at = ?, taskers_needed = ?
		WHERE id = ?`,
		req.Venue, req.Role, start, end, req.TaskersNeeded, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	shift, err := getShift(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
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
	writeJSON(w, http.StatusOK, shift)
}

func getShift(id int64) (Shift, error) {
	row := db.QueryRow(`
		SELECT id, venue, job_role, starts_at, ends_at, taskers_needed, taskers_confirmed, created_at
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
	err := sc.Scan(&s.ID, &s.Venue, &s.Role, &startsAt, &endsAt,
		&s.TaskersNeeded, &s.TaskersConfirmed, &createdAt)
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
