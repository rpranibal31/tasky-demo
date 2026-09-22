import "server-only";

import { cookies } from "next/headers";
import type { Shift } from "./shift";

export const API_BASE_URL =
  process.env.TASKY_API_URL ?? "https://tasky-api-836283338022.us-central1.run.app";

export const TOKEN_COOKIE = "tasky_token";

export async function getToken() {
  const store = await cookies();
  return store.get(TOKEN_COOKIE)?.value ?? null;
}

/** El tablero siempre refleja el estado actual: los turnos cambian de estado con
 *  el reloj, así que no tiene sentido cachear la lista. */
export async function listShifts(): Promise<Shift[]> {
  const res = await fetch(`${API_BASE_URL}/shifts`, { cache: "no-store" });
  if (!res.ok) throw new Error(`El API respondió ${res.status}`);
  return res.json();
}

type ApiOptions = {
  method: "POST" | "PUT" | "DELETE";
  token: string;
  body?: unknown;
};

/** POST y PUT viajan siempre con cuerpo: el balanceador de Google responde 411
 *  a un POST sin Content-Length. */
export async function callApi(path: string, { method, token, body }: ApiOptions) {
  const sendsBody = method === "POST" || method === "PUT";
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(sendsBody ? { "Content-Type": "application/json" } : {}),
    },
    body: sendsBody ? JSON.stringify(body ?? {}) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = (await res.text()).trim();
    throw new Error(detail || `El API respondió ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}
