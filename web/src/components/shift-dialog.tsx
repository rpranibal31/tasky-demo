"use client";

import { useActionState, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveShiftAction, type ActionState } from "@/app/actions";
import { addDays, clockOf, dateOf, todayISO, type Shift } from "@/lib/shift";

export function ShiftDialog({
  shift,
  trigger,
}: {
  shift?: Shift;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(saveShiftAction, {});

  useEffect(() => {
    if (!open) return;
    if (state.ok) {
      toast.success(shift ? "Turno actualizado." : "Turno publicado.");
      setOpen(false);
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, open, shift]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="bg-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl uppercase tracking-wide">
            {shift ? "Editar turno" : "Nuevo turno"}
          </DialogTitle>
          <DialogDescription className="text-slate-muted">
            {shift
              ? "Los cambios se ven al instante en el tablero y en la app de los Taskers."
              : "Publicá el turno y quedará disponible para que los Taskers se confirmen."}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="grid gap-4">
          {shift ? <input type="hidden" name="id" value={shift.id} /> : null}

          <Field label="Sede" htmlFor="venue">
            <Input
              id="venue"
              name="venue"
              defaultValue={shift?.venue ?? ""}
              placeholder="Costanera Center"
              required
            />
          </Field>

          <Field label="Servicio" htmlFor="role">
            <Input
              id="role"
              name="role"
              defaultValue={shift?.role ?? ""}
              placeholder="Reposición retail"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Fecha" htmlFor="date">
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={shift ? dateOf(shift.starts_at) : addDays(todayISO(), 1)}
                required
              />
            </Field>
            <Field label="Taskers" htmlFor="taskers_needed">
              <Input
                id="taskers_needed"
                name="taskers_needed"
                type="number"
                min={shift?.taskers_confirmed || 1}
                max={99}
                defaultValue={shift?.taskers_needed ?? 4}
                required
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Inicio" htmlFor="start_time">
              <Input
                id="start_time"
                name="start_time"
                type="time"
                defaultValue={shift ? clockOf(shift.starts_at) : "14:00"}
                required
              />
            </Field>
            <Field label="Término" htmlFor="end_time">
              <Input
                id="end_time"
                name="end_time"
                type="time"
                defaultValue={shift ? clockOf(shift.ends_at) : "22:00"}
                required
              />
            </Field>
          </div>

          <p className="text-xs leading-relaxed text-slate-muted">
            Si el término es menor al inicio, el turno cierra al día siguiente.
          </p>

          <div className="mt-1 grid gap-4 border-t border-hairline pt-4">
            <p className="eyebrow">Cerco de llegada</p>

            <Field label="Dirección" htmlFor="address">
              <Input
                id="address"
                name="address"
                defaultValue={shift?.address ?? ""}
                placeholder="Av. Andrés Bello 2425, Providencia"
              />
            </Field>

            <div className="grid grid-cols-3 gap-4">
              <Field label="Latitud" htmlFor="lat">
                <Input
                  id="lat"
                  name="lat"
                  type="number"
                  step="any"
                  defaultValue={shift?.lat ?? ""}
                  placeholder="-33.4176"
                />
              </Field>
              <Field label="Longitud" htmlFor="lng">
                <Input
                  id="lng"
                  name="lng"
                  type="number"
                  step="any"
                  defaultValue={shift?.lng ?? ""}
                  placeholder="-70.6068"
                />
              </Field>
              <Field label="Radio (m)" htmlFor="radius_m">
                <Input
                  id="radius_m"
                  name="radius_m"
                  type="number"
                  min={50}
                  max={2000}
                  step={50}
                  defaultValue={shift?.radius_m ?? 150}
                />
              </Field>
            </div>

            <p className="text-xs leading-relaxed text-slate-muted">
              Sin coordenadas el turno se publica igual, pero nadie puede marcar llegada desde la app.
            </p>
          </div>

          <SubmitButton editing={!!shift} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="eyebrow">
        {label}
      </Label>
      {children}
    </div>
  );
}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 w-full rounded-sm bg-hiviz py-3 font-display text-lg uppercase tracking-[0.12em] text-ink transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
    >
      {pending ? "Guardando…" : editing ? "Guardar cambios" : "Publicar turno"}
    </button>
  );
}
