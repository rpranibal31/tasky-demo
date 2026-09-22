package main

import (
	"math"
	"testing"
	"time"
)

// Coordenadas reales usadas en los turnos de ejemplo.
const (
	costaneraLat, costaneraLng = -33.417600, -70.606800
	movistarLat, movistarLng   = -33.441300, -70.665300
)

func TestDistanceMeters(t *testing.T) {
	t.Run("el mismo punto da cero", func(t *testing.T) {
		if d := distanceMeters(costaneraLat, costaneraLng, costaneraLat, costaneraLng); d != 0 {
			t.Errorf("distancia = %f, se esperaba 0", d)
		}
	})

	t.Run("cien metros al norte", func(t *testing.T) {
		// Un grado de latitud son ~111.32 km, así que 100 m son ~0.000898°.
		got := distanceMeters(costaneraLat, costaneraLng, costaneraLat+0.00089832, costaneraLng)
		if math.Abs(got-100) > 1 {
			t.Errorf("distancia = %.1f m, se esperaban 100 m (±1)", got)
		}
	})

	t.Run("es simetrica", func(t *testing.T) {
		ida := distanceMeters(costaneraLat, costaneraLng, movistarLat, movistarLng)
		vuelta := distanceMeters(movistarLat, movistarLng, costaneraLat, costaneraLng)
		if math.Abs(ida-vuelta) > 0.001 {
			t.Errorf("ida = %.3f, vuelta = %.3f: deberían ser iguales", ida, vuelta)
		}
	})

	t.Run("dos sedes reales de Santiago", func(t *testing.T) {
		// Costanera Center a Movistar Arena son unos 6 km en línea recta.
		got := distanceMeters(costaneraLat, costaneraLng, movistarLat, movistarLng)
		if got < 5500 || got > 6500 {
			t.Errorf("distancia = %.0f m, se esperaba entre 5500 y 6500", got)
		}
	})
}

// El cerco es una sola comparación, pero es la regla que decide si a un Tasker
// le cuenta el turno: conviene fijar el borde exacto.
func TestDecisionDelCerco(t *testing.T) {
	const radius = 150

	cases := []struct {
		name          string
		metrosAlNorte float64
		wantInside    bool
	}{
		{"parado justo en el punto", 0, true},
		{"dentro del cerco", 100, true},
		{"justo en el borde", 150, true},
		{"apenas afuera", 160, false},
		{"en la otra punta de la ciudad", 6000, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// 1 m ≈ 0.0000089832° de latitud.
			lat := costaneraLat + tc.metrosAlNorte*0.0000089832
			distance := int(distanceMeters(lat, costaneraLng, costaneraLat, costaneraLng) + 0.5)
			inside := distance <= radius

			if inside != tc.wantInside {
				t.Errorf("a %.0f m: dentro = %v (distancia calculada %d m), se esperaba %v",
					tc.metrosAlNorte, inside, distance, tc.wantInside)
			}
		})
	}
}

func TestValidCoordinate(t *testing.T) {
	cases := []struct {
		name     string
		lat, lng float64
		want     bool
	}{
		{"Santiago", -33.4176, -70.6068, true},
		{"latitud fuera de rango", 91, 0, false},
		{"longitud fuera de rango", 0, 181, false},
		// (0,0) es el Golfo de Guinea: casi siempre significa "no hay dato".
		{"cero cero se rechaza", 0, 0, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validCoordinate(tc.lat, tc.lng); got != tc.want {
				t.Errorf("validCoordinate(%v, %v) = %v, se esperaba %v", tc.lat, tc.lng, got, tc.want)
			}
		})
	}
}

func TestHumanDistance(t *testing.T) {
	cases := []struct {
		meters int
		want   string
	}{
		{0, "0 m"},
		{45, "45 m"},
		{999, "999 m"},
		{1000, "1.0 km"},
		{6043, "6.0 km"},
	}

	for _, tc := range cases {
		if got := humanDistance(tc.meters); got != tc.want {
			t.Errorf("humanDistance(%d) = %q, se esperaba %q", tc.meters, got, tc.want)
		}
	}
}

// at construye una hora de Chile para los casos de prueba.
func at(day, hour, min int) time.Time {
	return time.Date(2026, time.September, day, hour, min, 0, 0, chile)
}

func TestDeriveStatus(t *testing.T) {
	// Turno del 24 de septiembre, 18:00 a 22:00, con cupo para 4.
	start := at(24, 18, 0)
	end := at(24, 22, 0)

	cases := []struct {
		name      string
		now       time.Time
		needed    int
		confirmed int
		want      string
	}{
		{
			name: "faltan Taskers y el turno no empieza",
			now:  at(24, 9, 0), needed: 4, confirmed: 2,
			want: "abierto",
		},
		{
			name: "cupo completo antes de empezar",
			now:  at(24, 9, 0), needed: 4, confirmed: 4,
			want: "cubierto",
		},
		{
			name: "el reloj manda sobre la dotacion: en curso aunque falte gente",
			now:  at(24, 20, 0), needed: 4, confirmed: 1,
			want: "en_curso",
		},
		{
			name: "justo en la hora de inicio ya esta en curso",
			now:  start, needed: 4, confirmed: 4,
			want: "en_curso",
		},
		{
			name: "termino el turno",
			now:  at(24, 22, 1), needed: 4, confirmed: 4,
			want: "cerrado",
		},
		{
			name: "cierra aunque nunca se haya cubierto",
			now:  at(25, 10, 0), needed: 4, confirmed: 0,
			want: "cerrado",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := deriveStatus(tc.now, start, end, tc.needed, tc.confirmed)
			if got != tc.want {
				t.Errorf("deriveStatus() = %q, se esperaba %q", got, tc.want)
			}
		})
	}
}

func TestValidateShiftVentanaHoraria(t *testing.T) {
	cases := []struct {
		name      string
		date      string
		start     string
		end       string
		wantStart time.Time
		wantEnd   time.Time
	}{
		{
			name: "turno diurno normal",
			date: "2026-09-24", start: "14:00", end: "22:00",
			wantStart: at(24, 14, 0), wantEnd: at(24, 22, 0),
		},
		{
			name: "turno nocturno cierra al dia siguiente",
			date: "2026-09-24", start: "18:00", end: "02:00",
			wantStart: at(24, 18, 0), wantEnd: at(25, 2, 0),
		},
		{
			name: "turno de 24 horas cuando inicio y termino coinciden",
			date: "2026-09-24", start: "08:00", end: "08:00",
			wantStart: at(24, 8, 0), wantEnd: at(25, 8, 0),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := &createShiftRequest{
				Venue: "Movistar Arena", Role: "Control de acceso",
				Date: tc.date, StartTime: tc.start, EndTime: tc.end,
				TaskersNeeded: 4,
			}
			start, end, err := validateShift(req)
			if err != nil {
				t.Fatalf("validateShift() devolvió error inesperado: %v", err)
			}
			if !start.Equal(tc.wantStart) {
				t.Errorf("inicio = %v, se esperaba %v", start, tc.wantStart)
			}
			if !end.Equal(tc.wantEnd) {
				t.Errorf("término = %v, se esperaba %v", end, tc.wantEnd)
			}
			if !end.After(start) {
				t.Error("el término siempre debe quedar después del inicio")
			}
		})
	}
}

func TestValidateShiftRechazaDatosInvalidos(t *testing.T) {
	base := func() *createShiftRequest {
		return &createShiftRequest{
			Venue: "Costanera Center", Role: "Reposición retail",
			Date: "2026-09-24", StartTime: "14:00", EndTime: "22:00",
			TaskersNeeded: 4,
		}
	}

	cases := []struct {
		name   string
		mutate func(*createShiftRequest)
	}{
		{"sede vacía", func(r *createShiftRequest) { r.Venue = "" }},
		{"sede solo con espacios", func(r *createShiftRequest) { r.Venue = "   " }},
		{"servicio vacío", func(r *createShiftRequest) { r.Role = "" }},
		{"fecha con formato inválido", func(r *createShiftRequest) { r.Date = "24-09-2026" }},
		{"hora de inicio inválida", func(r *createShiftRequest) { r.StartTime = "25:00" }},
		{"hora de término vacía", func(r *createShiftRequest) { r.EndTime = "" }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := base()
			tc.mutate(req)
			if _, _, err := validateShift(req); err == nil {
				t.Error("se esperaba un error de validación y no hubo ninguno")
			}
		})
	}
}

func TestValidateShiftNormalizaEntrada(t *testing.T) {
	req := &createShiftRequest{
		Venue: "  Enea Pudahuel  ", Role: "  Picking y despacho  ",
		Date: "2026-09-24", StartTime: "07:00", EndTime: "15:00",
		TaskersNeeded: 0, // sin cupo explícito
	}

	if _, _, err := validateShift(req); err != nil {
		t.Fatalf("validateShift() devolvió error inesperado: %v", err)
	}
	if req.Venue != "Enea Pudahuel" {
		t.Errorf("la sede no se normalizó: %q", req.Venue)
	}
	if req.Role != "Picking y despacho" {
		t.Errorf("el servicio no se normalizó: %q", req.Role)
	}
	// Un turno sin Taskers no tiene sentido: el mínimo es uno.
	if req.TaskersNeeded != 1 {
		t.Errorf("cupo = %d, se esperaba 1", req.TaskersNeeded)
	}
}

// asChile debe convertir el instante leído de MySQL (UTC) a hora de Chile, no
// re-etiquetarlo. Este test cubre el bug que hacía que un turno publicado a las
// 14:00 se mostrara a las 17:00.
func TestAsChileConvierteDesdeUTC(t *testing.T) {
	utc := time.Date(2026, time.September, 24, 17, 0, 0, 0, time.UTC)

	got := asChile(utc)

	if h, m := got.Hour(), got.Minute(); h != 14 || m != 0 {
		t.Errorf("hora = %02d:%02d, se esperaba 14:00", h, m)
	}
	if !got.Equal(utc) {
		t.Error("asChile no debe mover el instante, solo cambiar el huso")
	}
}
