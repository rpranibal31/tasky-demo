package main

import (
	"testing"
	"time"
)

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
