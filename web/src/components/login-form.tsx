"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type ActionState } from "@/app/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(loginAction, {});

  return (
    <main className="flex flex-1 items-center justify-center bg-ink px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-ink">
          Coordinación de turnos
        </p>
        <h1 className="mt-1 font-display text-7xl leading-none tracking-[0.06em] text-white">
          TASKY
        </h1>
        <div className="mt-4 mb-10 h-1 w-18 bg-hiviz" />

        <form action={formAction} className="grid gap-5">
          <div className="grid gap-1.5">
            <Label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-ink">
              Correo
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              defaultValue="demo@tasky.dev"
              required
              className="border-0 border-b-2 border-ink-line bg-transparent px-0 text-white rounded-none focus-visible:border-hiviz focus-visible:ring-0"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-ink">
              Contraseña
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              defaultValue="demo123"
              required
              className="border-0 border-b-2 border-ink-line bg-transparent px-0 text-white rounded-none focus-visible:border-hiviz focus-visible:ring-0"
            />
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-hiviz">
              {state.error}
            </p>
          ) : null}

          <SubmitButton />
        </form>

        <p className="mt-12 text-center text-xs text-muted-ink">
          Operaciones · Santiago de Chile
        </p>
      </div>
    </main>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 w-full rounded-sm bg-hiviz py-3.5 font-display text-lg uppercase tracking-[0.14em] text-ink transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hiviz disabled:opacity-50"
    >
      {pending ? "Ingresando…" : "Ingresar"}
    </button>
  );
}
