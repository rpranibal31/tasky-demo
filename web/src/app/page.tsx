import { Plus } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { ShiftDialog } from "@/components/shift-dialog";
import { ShiftStub } from "@/components/shift-stub";
import { logoutAction } from "@/app/actions";
import { getToken, listShifts } from "@/lib/tasky-server";
import { groupByDay, longDate, type Shift } from "@/lib/shift";

export default async function Page() {
  const token = await getToken();
  if (!token) return <LoginForm />;

  // La clave del mapa se lee en el servidor y baja como prop: es una clave de
  // navegador (restringida por dominio), pero así no queda incrustada en el
  // bundle en build y se puede rotar sin recompilar.
  const mapsKey = process.env.MAPS_API_KEY ?? "";

  let shifts: Shift[] = [];
  let loadError: string | null = null;
  try {
    shifts = await listShifts();
  } catch (err) {
    loadError = err instanceof Error ? err.message : "No se pudieron cargar los turnos.";
  }

  const days = groupByDay(shifts);
  const uncovered = shifts.filter((s) => s.status === "abierto").length;
  const confirmed = shifts.reduce((n, s) => n + s.taskers_confirmed, 0);
  const needed = shifts.reduce((n, s) => n + s.taskers_needed, 0);

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-ink px-6 py-5 sm:px-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-4">
          <span className="font-display text-2xl tracking-[0.22em] text-white">TASKY</span>
          <span className="hidden h-5 w-px bg-ink-line sm:block" aria-hidden />

          {/* Lectura de operaciones: el estado del día en una línea, como el
              readout de una consola de despacho. */}
          <p className="font-display text-lg tracking-[0.06em] text-muted-ink">
            {shifts.length} turnos
            <span className="mx-2 text-ink-line">·</span>
            <span className={uncovered > 0 ? "text-hiviz" : "text-white"}>
              {uncovered} sin cubrir
            </span>
            <span className="mx-2 text-ink-line">·</span>
            <span className="text-white">
              {confirmed}/{needed}
            </span>{" "}
            Taskers
          </p>

          <div className="ml-auto flex items-center gap-3">
            <ShiftDialog
              mapsKey={mapsKey}
              trigger={
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-sm bg-hiviz px-4 py-2.5 font-display text-base uppercase tracking-[0.12em] text-ink transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hiviz"
                >
                  <Plus className="size-4" aria-hidden />
                  Publicar turno
                </button>
              }
            />
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-sm border border-ink-line px-3 py-2.5 font-display text-base uppercase tracking-[0.12em] text-muted-ink transition-colors hover:border-white hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 sm:px-10">
        <div className="mx-auto max-w-6xl">
          {loadError ? (
            <p role="alert" className="rounded-sm border border-brick bg-white p-5 text-brick">
              {loadError}
            </p>
          ) : days.length === 0 ? (
            <div className="py-24 text-center">
              <h2 className="font-display text-3xl uppercase tracking-wide">
                Sin turnos publicados
              </h2>
              <p className="mt-2 text-slate-muted">
                Publica el primer turno para empezar a coordinar Taskers.
              </p>
            </div>
          ) : (
            days.map(([date, dayShifts]) => (
              <section key={date} className="mb-9">
                <div className="mb-3 flex items-center gap-4">
                  <h2 className="font-display text-xl tracking-[0.1em] uppercase">
                    {longDate(date)}
                  </h2>
                  <span className="h-px flex-1 bg-hairline" aria-hidden />
                  <span className="eyebrow">
                    {dayShifts.length} {dayShifts.length === 1 ? "turno" : "turnos"}
                  </span>
                </div>
                <div className="grid gap-3">
                  {dayShifts.map((shift) => (
                    <ShiftStub key={shift.id} shift={shift} mapsKey={mapsKey} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
