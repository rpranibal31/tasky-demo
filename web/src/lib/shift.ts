// Tipos y helpers puros, compartidos entre servidor y cliente.

export type ShiftStatus = "abierto" | "cubierto" | "en_curso" | "cerrado";

export type Shift = {
  id: number;
  venue: string;
  role: string;
  starts_at: string;
  ends_at: string;
  taskers_needed: number;
  taskers_confirmed: number;
  status: ShiftStatus;
  created_at: string;
};

export const STATUS_LABEL: Record<ShiftStatus, string> = {
  abierto: "Abierto",
  cubierto: "Cubierto",
  en_curso: "En curso",
  cerrado: "Cerrado",
};

// Clases en vez de valores dinámicos: Tailwind necesita ver el literal completo
// para incluirlo en el bundle.
export const STATUS_CHIP: Record<ShiftStatus, string> = {
  abierto: "bg-hiviz text-ink",
  cubierto: "bg-moss text-white",
  en_curso: "bg-denim text-white",
  cerrado: "bg-slate-muted text-white",
};

export const STATUS_RAIL: Record<ShiftStatus, string> = {
  abierto: "bg-hiviz text-ink",
  cubierto: "bg-moss text-white",
  en_curso: "bg-denim text-white",
  cerrado: "bg-slate-muted text-white",
};

const MONTHS = [
  "ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
  "JUL", "AGO", "SEP", "OCT", "NOV", "DIC",
];
const WEEKDAYS = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

// El API entrega RFC3339 ya en hora de Chile. Leemos por posición en vez de
// construir un Date, así el huso del navegador nunca corre la hora del turno.
export const dayOf = (iso: string) => iso.slice(8, 10);
export const monthOf = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];
export const clockOf = (iso: string) => iso.slice(11, 16);
export const dateOf = (iso: string) => iso.slice(0, 10);

export function weekdayOf(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function longDate(isoDate: string) {
  return `${weekdayOf(isoDate)} ${isoDate.slice(8, 10)} ${MONTHS[Number(isoDate.slice(5, 7)) - 1]}`;
}

export function todayISO() {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))
    .toISOString()
    .slice(0, 10);
}

export function addDays(isoDate: string, delta: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Agrupa por día de inicio: un coordinador piensa la semana en jornadas. */
export function groupByDay(shifts: Shift[]) {
  const groups = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const key = dateOf(shift.starts_at);
    const bucket = groups.get(key);
    if (bucket) bucket.push(shift);
    else groups.set(key, [shift]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
