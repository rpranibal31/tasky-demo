"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { confirmTaskerAction, deleteShiftAction } from "@/app/actions";
import { clockOf, dayOf, monthOf, type Shift } from "@/lib/shift";

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
  const [open, setOpen] = useState(false);

  function onConfirm() {
    start(async () => {
      const res = await deleteShiftAction(shift.id);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Turno cancelado.");
        setOpen(false);
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <button
            type="button"
            title="Cancelar turno"
            className="inline-flex size-8 items-center justify-center rounded-sm border border-hairline bg-white text-slate-muted transition-colors hover:border-brick hover:bg-brick hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brick"
          >
            <Trash2 className="size-4" aria-hidden />
            <span className="sr-only">Cancelar el turno de {shift.venue}</span>
          </button>
        }
      />
      <AlertDialogContent className="bg-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl uppercase tracking-wide">
            Cancelar turno
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-muted">
            {shift.venue} · {dayOf(shift.starts_at)} {monthOf(shift.starts_at)},{" "}
            {clockOf(shift.starts_at)}–{clockOf(shift.ends_at)}.
            {shift.taskers_confirmed > 0
              ? ` Los ${shift.taskers_confirmed} Taskers confirmados quedan liberados.`
              : " Todavía no hay Taskers confirmados."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Volver</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={pending}
            className="bg-brick text-white hover:bg-brick/90"
          >
            {pending ? "Cancelando…" : "Cancelar turno"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
