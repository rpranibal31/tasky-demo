import { MapPin, Pencil } from "lucide-react";
import { Meter } from "@/components/meter";
import { ShiftDialog } from "@/components/shift-dialog";
import { ConfirmTaskerButton, DeleteShiftButton } from "@/components/shift-actions";
import {
  clockOf,
  dayOf,
  monthOf,
  STATUS_CHIP,
  STATUS_LABEL,
  STATUS_RAIL,
  type Shift,
} from "@/lib/shift";

const RAIL = "5rem";
const NOTCH_OFFSET = `calc(${RAIL} - 0.375rem)`;

/** El talón: riel de fecha, troquel y cuerpo. Es el mismo objeto que dibuja la
 *  app móvil, tendido a lo ancho para un escritorio. */
export function ShiftStub({ shift, mapsKey }: { shift: Shift; mapsKey: string }) {
  const hasFence = shift.lat !== 0 || shift.lng !== 0;

  return (
    <article className="relative flex rounded-sm bg-card shadow-[0_2px_6px_rgba(16,30,43,0.1)]">
      <div
        className={`flex w-20 shrink-0 flex-col items-center justify-center rounded-l-sm py-5 ${STATUS_RAIL[shift.status]}`}
      >
        <span className="font-display text-4xl leading-none">{dayOf(shift.starts_at)}</span>
        <span className="mt-1 text-[10px] font-semibold tracking-[0.18em]">
          {monthOf(shift.starts_at)}
        </span>
      </div>

      {/* troquel */}
      <div
        className="my-4 w-px shrink-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, #d3d9e0 0 3px, transparent 3px 7px)",
        }}
        aria-hidden
      />
      <span className="notch -top-1.5" style={{ left: NOTCH_OFFSET }} aria-hidden />
      <span className="notch -bottom-1.5" style={{ left: NOTCH_OFFSET }} aria-hidden />

      <div className="flex min-w-0 flex-1 flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-2xl uppercase leading-tight tracking-[0.02em]">
            {shift.venue}
          </h3>
          <p className="truncate text-sm text-slate-muted">{shift.role}</p>
          {hasFence ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-muted">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                {shift.address || `${shift.lat.toFixed(4)}, ${shift.lng.toFixed(4)}`}
                <span className="text-hairline"> · </span>
                cerco {shift.radius_m} m
              </span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-brick">Sin cerco configurado</p>
          )}
        </div>

        <div className="shrink-0 sm:w-36">
          <p className="font-display text-xl tracking-wide">
            {clockOf(shift.starts_at)} – {clockOf(shift.ends_at)}
          </p>
          <span
            className={`mt-1 inline-block rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${STATUS_CHIP[shift.status]}`}
          >
            {STATUS_LABEL[shift.status]}
          </span>
        </div>

        <div className="shrink-0 sm:w-40">
          <Meter needed={shift.taskers_needed} confirmed={shift.taskers_confirmed} />
          <p className="mt-2 text-xs text-slate-muted">
            {shift.taskers_confirmed}/{shift.taskers_needed} Taskers
            {shift.checkins > 0 ? (
              <span className="text-moss"> · {shift.checkins} en el punto</span>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ConfirmTaskerButton shift={shift} />
          <ShiftDialog
            shift={shift}
            mapsKey={mapsKey}
            trigger={
              <button
                type="button"
                title="Editar turno"
                className="inline-flex size-8 items-center justify-center rounded-sm border border-hairline bg-white text-ink transition-colors hover:border-ink hover:bg-ink hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-denim"
              >
                <Pencil className="size-4" aria-hidden />
                <span className="sr-only">Editar el turno de {shift.venue}</span>
              </button>
            }
          />
          <DeleteShiftButton shift={shift} />
        </div>
      </div>
    </article>
  );
}
