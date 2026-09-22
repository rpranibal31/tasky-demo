"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { confirmTaskerAction, deleteShiftAction } from "@/app/actions";
import type { Shift } from "@/lib/shift";

export function ConfirmTaskerButton({ shift }: { shift: Shift }) {
  const [pending, start] = useTransition();
  const full = shift.taskers_confirmed >= shift.taskers_needed;
  const closed = shift.status === "cerrado";
  const disabled = pending || full || closed;

  function onClick() {
    start(async () => {
      const res = await confirmTaskerAction(shift.id);
      if (res.error) toast.error(res.error);
      else toast.success(`Tasker confirmado en ${shift.venue}.`);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={full ? "Cupo completo" : closed ? "El turno ya cerró" : "Confirmar un Tasker"}
      className="inline-flex size-8 items-center justify-center rounded-sm border border-hairline bg-white text-ink transition-colors hover:border-ink hover:bg-ink hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-denim disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-ink"
    >
      <UserPlus className="size-4" aria-hidden />
      <span className="sr-only">Confirmar un Tasker en {shift.venue}</span>
    </button>
  );
}

export function DeleteShiftButton({ shift }: { shift: Shift }) {
  const [pending, start] = useTransition();

  function onClick() {
    const ok = window.confirm(
      `¿Cancelar el turno de ${shift.venue}? Los ${shift.taskers_confirmed} Taskers confirmados quedan liberados.`
    );
    if (!ok) return;

    start(async () => {
      const res = await deleteShiftAction(shift.id);
      if (res.error) toast.error(res.error);
      else toast.success("Turno cancelado.");
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Cancelar turno"
      className="inline-flex size-8 items-center justify-center rounded-sm border border-hairline bg-white text-slate-muted transition-colors hover:border-brick hover:bg-brick hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brick disabled:cursor-not-allowed disabled:opacity-35"
    >
      <Trash2 className="size-4" aria-hidden />
      <span className="sr-only">Cancelar el turno de {shift.venue}</span>
    </button>
  );
}
