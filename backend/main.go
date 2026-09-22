// Tasky API — backend mínimo para demo de entrevista.
// Endpoints: GET /health, POST /login, GET /tasks, POST /tasks
//
// Auth simplificada para demo: valida contra ADMIN_EMAIL/ADMIN_PASSWORD
// (env vars) y devuelve un token estático. En producción esto lo
// reemplazarías por Identity Platform (validar el JWT que emite).
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

var db *sql.DB

type Task struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	CreatedAt   string `json:"created_at"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

const demoToken = "demo-token"

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

	mux := http.NewServeMux()
	mux.HandleFunc("/health", withCORS(handleHealth))
	mux.HandleFunc("/login", withCORS(handleLogin))
	mux.HandleFunc("/tasks", withCORS(handleTasks))

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
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS tasks (
			id INT AUTO_INCREMENT PRIMARY KEY,
			title VARCHAR(255) NOT NULL,
			description TEXT,
			created_at DATETIME NOT NULL
		)`)
	return err
}

func withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
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
	json.NewEncoder(w).Encode(map[string]string{"token": demoToken})
}

func handleTasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listTasks(w, r)
	case http.MethodPost:
		createTask(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func listTasks(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, title, description, created_at FROM tasks ORDER BY id DESC")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tasks := []Task{}
	for rows.Next() {
		var t Task
		var createdAt time.Time
		if err := rows.Scan(&t.ID, &t.Title, &t.Description, &createdAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		t.CreatedAt = createdAt.Format(time.RFC3339)
		tasks = append(tasks, t)
	}
	json.NewEncoder(w).Encode(tasks)
}

func createTask(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer "+demoToken {
		http.Error(w, "no autorizado", http.StatusUnauthorized)
		return
	}
	var t Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if t.Title == "" {
		http.Error(w, "title es requerido", http.StatusBadRequest)
		return
	}
	res, err := db.Exec("INSERT INTO tasks (title, description, created_at) VALUES (?, ?, ?)",
		t.Title, t.Description, time.Now())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	id, _ := res.LastInsertId()
	t.ID = id
	t.CreatedAt = time.Now().Format(time.RFC3339)
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(t)
}
