"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { API_BASE_URL, TOKEN_COOKIE, callApi, getToken } from "@/lib/tasky-server";

export type ActionState = { error?: string; ok?: boolean };

/** Toda Server Action es alcanzable por POST directo, no solo desde la UI, así
 *  que cada mutación revalida la sesión antes de tocar el API. */
async function requireToken() {
  const token = await getToken();
  if (!token) throw new Error("Tu sesión expiró. Volvé a ingresar.");
  return token;
}

function message(err: unknown) {
  return err instanceof Error ? err.message : "Algo salió mal.";
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    const res = await fetch(`${API_BASE_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { error: res.status === 401 ? "Correo o contraseña incorrectos." : "No pudimos iniciar tu sesión." };
    }
    const { token } = (await res.json()) as { token: string };

    const store = await cookies();
    store.set(TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
  } catch (err) {
    return { error: message(err) };
  }

  revalidatePath("/");
  return { ok: true };
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  revalidatePath("/");
}

export async function saveShiftAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const id = formData.get("id");
  // El cerco viaja completo en cada guardado: el PUT reemplaza el turno entero,
  // así que omitir las coordenadas lo dejaría sin cerco.
  const body = {
    venue: String(formData.get("venue") ?? "").trim(),
    role: String(formData.get("role") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    lat: Number(formData.get("lat") ?? 0),
    lng: Number(formData.get("lng") ?? 0),
    radius_m: Number(formData.get("radius_m") ?? 150),
    date: String(formData.get("date") ?? ""),
    start_time: String(formData.get("start_time") ?? ""),
    end_time: String(formData.get("end_time") ?? ""),
    taskers_needed: Number(formData.get("taskers_needed") ?? 1),
  };

  if (!body.venue) return { error: "Indicá en qué sede se ejecuta el turno." };
  if (!body.role) return { error: "Indicá qué van a hacer los Taskers." };

  try {
    const token = await requireToken();
    await callApi(id ? `/shifts/${id}` : "/shifts", {
      method: id ? "PUT" : "POST",
      token,
      body,
    });
  } catch (err) {
    return { error: message(err) };
  }

  revalidatePath("/");
  return { ok: true };
}

export async function confirmTaskerAction(id: number): Promise<ActionState> {
  try {
    const token = await requireToken();
    await callApi(`/shifts/${id}/confirm`, { method: "POST", token });
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/");
  return { ok: true };
}

export async function deleteShiftAction(id: number): Promise<ActionState> {
  try {
    const token = await requireToken();
    await callApi(`/shifts/${id}`, { method: "DELETE", token });
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/");
  return { ok: true };
}
