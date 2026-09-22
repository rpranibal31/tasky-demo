// Tasky mobile — la app del Tasker.
//
// Este cliente es el lado del trabajador: ve los turnos disponibles, toma uno y
// marca su llegada validada por GPS. Publicar, editar y cancelar turnos son
// operaciones del coordinador y viven en el panel web: misma API, dos roles.
//
// Tres pantallas con estado simple, sin react-navigation, para que la demo
// quepa en un archivo legible: login -> lista -> detalle.
//
// Dirección de diseño: "workwear". La paleta sale de la ropa de trabajo real de
// un Tasker en terreno (ámbar alta visibilidad sobre azul mezclilla profundo) y
// cada turno se dibuja como un talón troquelado, mitad entrada de evento, mitad
// tarjeta de reloj control.

import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  AppState,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  RefreshControl,
} from "react-native";
// El SafeAreaView de react-native quedó deprecado; este es el reemplazo oficial
// y además soporta elegir qué bordes respetar.
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import EventSource from "react-native-sse";
import * as Notifications from "expo-notifications";
import { useFonts } from "expo-font";
import {
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
} from "@expo-google-fonts/barlow-condensed";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";

const API_BASE_URL = "https://tasky-api-836283338022.us-central1.run.app";

// Cada cuánto vuelve a consultar la lista cuando no hay conexión de eventos.
const POLL_INTERVAL_MS = 8000;

// Las notificaciones se muestran aunque la app esté abierta: el Tasker puede
// estar mirando otro turno cuando entra uno nuevo.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/* ---------------------------------------------------------------- tokens -- */

const C = {
  ink: "#101E2B",
  inkSoft: "#1C2E3F",
  inkLine: "#2C4257",
  paper: "#E9ECF0",
  surface: "#FFFFFF",
  hiviz: "#FFB000",
  denim: "#2F5C8F",
  moss: "#17715A",
  brick: "#B3321F",
  muted: "#62748A",
  mutedInk: "#8FA3B6",
  line: "#D3D9E0",
};

const F = {
  display: "BarlowCondensed_700Bold",
  displayMid: "BarlowCondensed_600SemiBold",
  body: "Inter_400Regular",
  bodyMid: "Inter_500Medium",
  bodyBold: "Inter_600SemiBold",
};

const STATUS = {
  abierto: { label: "Abierto", color: C.hiviz, onColor: C.ink },
  cubierto: { label: "Cubierto", color: C.moss, onColor: C.surface },
  en_curso: { label: "En curso", color: C.denim, onColor: C.surface },
  cerrado: { label: "Cerrado", color: C.muted, onColor: C.surface },
};

/* ------------------------------------------------------------- utilidades -- */

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const WEEKDAYS = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

// El API devuelve RFC3339 en hora de Chile. Leemos por posición en vez de
// construir un Date, así el huso del teléfono nunca corre la hora del turno.
const dayOf = (iso) => iso.slice(8, 10);
const monthOf = (iso) => MONTHS[parseInt(iso.slice(5, 7), 10) - 1];
const clockOf = (iso) => iso.slice(11, 16);
const dateOf = (iso) => iso.slice(0, 10);

function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

async function api(path, { method = "GET", token, body } = {}) {
  // POST/PUT siempre viajan con cuerpo, aunque sea vacío: el balanceador de
  // Google responde 411 a un POST sin Content-Length.
  const sendsBody = method === "POST" || method === "PUT";
  const payload = sendsBody ? JSON.stringify(body || {}) : undefined;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(sendsBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: payload,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.trim() || `Error ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// El check-in es el único endpoint donde un 422 no es un fallo sino una
// respuesta útil: "estás fuera del cerco, a tantos metros". Por eso se lee el
// cuerpo en vez de tratar el código de error como excepción.
async function checkInAt(shiftId, token, coords) {
  const res = await fetch(`${API_BASE_URL}/shifts/${shiftId}/checkin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(coords),
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.trim() || `Error ${res.status}`);
  }
}

// announce avisa al Tasker que se publicó un turno nuevo.
//
// Hoy la notificación se genera en el teléfono al recibir el evento SSE, así que
// solo llega con la app corriendo. En producción el aviso lo dispara el backend:
// al crear un turno encola una tarea en Cloud Tasks, que envía el push a los
// Taskers con perfil compatible. Se hace con cola y no en línea para que publicar
// un turno no dependa de que el servicio de push responda, y para tener
// reintentos si falla. Recibir push remoto requiere un development build: Expo
// Go dejó de soportarlo.
async function announce(raw) {
  try {
    const { reason } = JSON.parse(raw);
    if (reason !== "created") return;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      if (asked.status !== "granted") return;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Nuevo turno disponible",
        body: "Se publicó un turno que podés tomar. Abrí Tasky para verlo.",
      },
      trigger: null, // inmediata
    });
  } catch {
    // Un aviso que no se muestra no debe romper la actualización de la lista.
  }
}

/* ------------------------------------------------------------------- app -- */

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [fontsLoaded] = useFonts({
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const [token, setToken] = useState(null);
  const [screen, setScreen] = useState("login"); // login | list | detail
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  // Qué turnos tomó este Tasker. Vive en el dispositivo porque la demo tiene un
  // solo usuario; con Identity Platform esto sería una tabla de postulaciones
  // por Tasker en el backend.
  const [myShiftIds, setMyShiftIds] = useState([]);
  const [live, setLive] = useState(false);

  // silent: las recargas automáticas no muestran spinner ni alertan si fallan.
  // Un corte de red momentáneo no tiene por qué interrumpir al Tasker.
  const loadShifts = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      setShifts(await api("/shifts"));
    } catch (err) {
      if (!silent) Alert.alert("No se pudieron cargar los turnos", err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) loadShifts();
  }, [token, loadShifts]);

  // Conexión de eventos: el servidor avisa apenas algo cambia, sin esperar al
  // próximo sondeo. Si se cae, el sondeo de abajo sigue cubriendo — por eso este
  // efecto no reintenta con lógica propia ni bloquea nada si falla.
  useEffect(() => {
    if (!token) return;

    const source = new EventSource(`${API_BASE_URL}/events`, {
      headers: { Authorization: `Bearer ${token}` },
      pollingInterval: 0, // reconexión la maneja la librería
    });

    source.addEventListener("open", () => setLive(true));
    source.addEventListener("error", () => setLive(false));
    source.addEventListener("close", () => setLive(false));
    source.addEventListener("shifts", (ev) => {
      loadShifts({ silent: true });
      announce(ev.data);
    });

    return () => {
      setLive(false);
      source.removeAllEventListeners();
      source.close();
    };
  }, [token, loadShifts]);

  // El coordinador publica turnos desde el panel web y el Tasker tiene que
  // verlos sin reabrir la app. El sondeo es la red de seguridad: corre siempre,
  // y se apaga mientras la app está en segundo plano para no gastar batería ni
  // datos en algo que nadie está mirando.
  useEffect(() => {
    if (!token) return;

    let timer = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => loadShifts({ silent: true }), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        loadShifts({ silent: true });
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [token, loadShifts]);

  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: C.ink }} />;

  const selected = shifts.find((s) => s.id === selectedId) || null;

  if (!token) {
    return (
      <LoginScreen
        onLoggedIn={(t) => {
          setToken(t);
          setScreen("list");
        }}
      />
    );
  }

  if (screen === "detail" && selected) {
    return (
      <DetailScreen
        token={token}
        shift={selected}
        mine={myShiftIds.includes(selected.id)}
        onBack={() => setScreen("list")}
        onChanged={loadShifts}
        onTaken={async () => {
          setMyShiftIds((ids) => [...ids, selected.id]);
          await loadShifts();
        }}
      />
    );
  }

  return (
    <ListScreen
      shifts={shifts}
      myShiftIds={myShiftIds}
      loading={loading}
      live={live}
      onRefresh={loadShifts}
      onSelect={(id) => {
        setSelectedId(id);
        setScreen("detail");
      }}
    />
  );
}

/* --------------------------------------------------------------- pantallas -- */

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("demo@tasky.dev");
  const [password, setPassword] = useState("demo123");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    try {
      const data = await api("/login", { method: "POST", body: { email, password } });
      onLoggedIn(data.token);
    } catch (err) {
      Alert.alert("No pudimos iniciar tu sesión", err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={s.rootInk}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={s.flex}>
        <KeyboardAvoidingView
          style={[s.flex, s.loginPad]}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.flex} />

          <Text style={s.loginEyebrow}>Coordinación de turnos</Text>
          <Text style={s.loginWordmark}>TASKY</Text>
          <View style={s.loginRule} />

          <Text style={s.fieldLabelInk}>Correo</Text>
          <TextInput
            style={s.inputInk}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor={C.mutedInk}
            accessibilityLabel="Correo"
          />

          <Text style={[s.fieldLabelInk, { marginTop: 22 }]}>Contraseña</Text>
          <TextInput
            style={s.inputInk}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholderTextColor={C.mutedInk}
            accessibilityLabel="Contraseña"
          />

          <View style={{ height: 36 }} />
          <ActionButton
            label={loading ? "Ingresando…" : "Ingresar"}
            onPress={handleLogin}
            disabled={loading}
            variant="hiviz"
          />

          <View style={s.flex} />
          <Text style={s.loginFoot}>Operaciones · Santiago de Chile</Text>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// La app del Tasker solo muestra turnos: los que tomó y los que todavía puede
// tomar. Publicar, editar y cancelar son operaciones del coordinador y viven en
// el panel web.
function ListScreen({ shifts, myShiftIds, loading, live, onRefresh, onSelect }) {
  // Un turno no es "tomable" por su estado sino por si le queda cupo y no cerró.
  // Eso incluye los que ya empezaron: si falta gente en un turno en curso, es
  // justamente el reemplazo que el cliente necesita ahora.
  const isMine = (x) => myShiftIds.includes(x.id);
  const hasRoom = (x) => x.taskers_confirmed < x.taskers_needed;

  const mine = shifts.filter(isMine);
  const others = shifts.filter((x) => !isMine(x));

  const urgent = others.filter((x) => x.status === "en_curso" && hasRoom(x));
  const available = others.filter((x) => x.status === "abierto" && hasRoom(x));
  const noRoom = others.filter((x) => x.status !== "cerrado" && !hasRoom(x));
  const closed = others.filter((x) => x.status === "cerrado");

  const sections = [
    { key: "mine", title: "Mis turnos", data: mine },
    { key: "urgent", title: "Te necesitamos ahora", data: urgent, accent: true },
    { key: "available", title: "Disponibles", data: available },
    { key: "noRoom", title: "Con cupo completo", data: noRoom, dim: true },
    { key: "closed", title: "Cerrados", data: closed, dim: true },
  ].filter((sec) => sec.data.length > 0);

  // Una sola lista plana con encabezados: evita traer SectionList solo por esto.
  const rows = sections.flatMap((sec) => [
    {
      type: "header",
      key: sec.key,
      title: sec.title,
      count: sec.data.length,
      accent: sec.accent,
    },
    ...sec.data.map((shift) => ({
      type: "shift",
      key: `s${shift.id}`,
      shift,
      dim: sec.dim,
    })),
  ]);

  return (
    <View style={s.rootInk}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={s.flex}>
        <View style={s.header}>
          <View style={s.headerRow}>
            <Text style={s.wordmark}>TASKY</Text>
            <View style={s.liveRow}>
              <View style={[s.liveDot, { backgroundColor: live ? C.hiviz : C.inkLine }]} />
              <Text style={s.liveText}>{live ? "En vivo" : "Sin conexión"}</Text>
            </View>
          </View>
          <Text style={s.headerTitle}>Turnos</Text>
          <Text style={s.headerSub}>
            {urgent.length > 0
              ? `${urgent.length} ${urgent.length === 1 ? "turno te necesita" : "turnos te necesitan"} ahora`
              : mine.length === 0
                ? `${available.length} disponibles para tomar`
                : `${mine.length} ${mine.length === 1 ? "turno tomado" : "turnos tomados"} · ${available.length} disponibles`}
          </Text>
        </View>

        <View style={s.sheet}>
          {loading && shifts.length === 0 ? (
            <View style={s.center}>
              <ActivityIndicator color={C.ink} />
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => item.key}
              contentContainerStyle={s.listPad}
              refreshControl={
                <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={C.ink} />
              }
              renderItem={({ item }) =>
                item.type === "header" ? (
                  <View style={s.sectionHead}>
                    <Text
                      style={[s.sectionHeadText, item.accent && { color: C.brick }]}
                    >
                      {item.title}
                    </Text>
                    <View style={s.sectionRule} />
                    <Text style={s.sectionHeadCount}>{item.count}</Text>
                  </View>
                ) : (
                  <ShiftStub
                    shift={item.shift}
                    mine={myShiftIds.includes(item.shift.id)}
                    dim={item.dim}
                    onPress={() => onSelect(item.shift.id)}
                  />
                )
              }
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>No hay turnos disponibles</Text>
                  <Text style={s.emptyBody}>
                    Cuando una empresa publique un turno, aparece acá para que lo tomes.
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function DetailScreen({ token, shift, mine, onBack, onChanged, onTaken }) {
  const [busy, setBusy] = useState(false);
  const st = STATUS[shift.status] || STATUS.abierto;
  const full = shift.taskers_confirmed >= shift.taskers_needed;
  const closed = shift.status === "cerrado";
  const hasFence = !!(shift.lat || shift.lng);

  // Tomar el turno es la misma operación que usa el coordinador para confirmar
  // dotación: quien decide si queda cupo es el servidor, con un UPDATE
  // condicional. Si dos Taskers postulan a la vez, uno recibe 409.
  async function takeShift() {
    setBusy(true);
    try {
      await api(`/shifts/${shift.id}/confirm`, { method: "POST", token });
      await onTaken();
      Alert.alert("Turno tomado", `Te esperamos en ${shift.venue}.`);
    } catch (err) {
      Alert.alert("No pudiste tomar el turno", err.message);
    } finally {
      setBusy(false);
    }
  }

  // El teléfono solo reporta dónde está; quien decide si eso cuenta como
  // llegada es el servidor, comparando contra el cerco del turno.
  async function doCheckIn() {
    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Falta el permiso de ubicación",
          "Tasky la necesita para confirmar que estás en el punto del turno."
        );
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const result = await checkInAt(shift.id, token, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });

      if (result.inside) {
        Alert.alert("Llegada registrada", result.message);
        await onChanged();
      } else {
        Alert.alert("Estás fuera del cerco", result.message);
      }
    } catch (err) {
      Alert.alert("No se pudo registrar la llegada", err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.rootInk}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={s.flex}>
        <View style={s.header}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button">
            <Text style={s.back}>‹ Turnos</Text>
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={2}>
            {shift.venue}
          </Text>
          <Text style={s.headerSub}>{shift.role}</Text>
        </View>

        <View style={s.sheet}>
          <ScrollView contentContainerStyle={s.detailPad}>
            <View style={s.pillRow}>
              <View style={[s.pill, { backgroundColor: st.color }]}>
                <Text style={[s.pillText, { color: st.onColor }]}>{st.label}</Text>
              </View>
            </View>

            <DataRow
              label="Fecha"
              value={`${weekdayOf(dateOf(shift.starts_at))} ${dayOf(shift.starts_at)} ${monthOf(shift.starts_at)}`}
            />
            <DataRow
              label="Ventana"
              value={`${clockOf(shift.starts_at)} – ${clockOf(shift.ends_at)}`}
            />
            <DataRow label="Sede" value={shift.venue} />
            <DataRow label="Servicio" value={shift.role} />
            {!!shift.address && <DataRow label="Dirección" value={shift.address} />}

            <Text style={s.sectionLabel}>Dotación</Text>
            <Meter needed={shift.taskers_needed} confirmed={shift.taskers_confirmed} />
            <Text style={s.meterCaption}>
              {shift.taskers_confirmed} de {shift.taskers_needed} Taskers confirmados
            </Text>

            {mine ? (
              <>
                <Text style={s.sectionLabel}>Marcar llegada</Text>
                {hasFence ? (
                  <>
                    <Text style={s.fenceLine}>
                      Tenés que estar a menos de {shift.radius_m} m del punto
                    </Text>
                    <Text style={s.meterCaption}>
                      {shift.checkins === 0
                        ? "Todavía nadie marcó llegada en este turno"
                        : `${shift.checkins} ${shift.checkins === 1 ? "llegada registrada" : "llegadas registradas"}`}
                    </Text>
                    <View style={{ height: 14 }} />
                    <ActionButton
                      label={busy ? "Ubicando…" : "Marcar llegada"}
                      onPress={doCheckIn}
                      disabled={busy || closed}
                      variant="hiviz"
                    />
                  </>
                ) : (
                  <Text style={s.fenceLine}>
                    Este turno todavía no tiene punto configurado.
                  </Text>
                )}
              </>
            ) : (
              <>
                <View style={{ height: 28 }} />
                <ActionButton
                  label={
                    closed
                      ? "El turno ya cerró"
                      : full
                        ? "Cupo completo"
                        : busy
                          ? "Tomando…"
                          : "Tomar turno"
                  }
                  onPress={takeShift}
                  disabled={busy || full || closed}
                  variant="hiviz"
                />
                {full && !closed ? (
                  <Text style={s.hint}>
                    Otros Taskers ya completaron el cupo de este turno.
                  </Text>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}

/* ------------------------------------------------------------ componentes -- */

// El talón: riel de fecha a la izquierda, línea troquelada, cuerpo a la derecha.
// Las muescas superior e inferior se pintan del color del fondo para simular el
// corte del papel.
function ShiftStub({ shift, mine, dim, onPress }) {
  const st = STATUS[shift.status] || STATUS.abierto;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${shift.venue}, ${shift.role}, ${st.label}`}
      style={({ pressed }) => [s.stub, dim && s.stubDim, pressed && s.stubPressed]}
    >
      <View style={[s.rail, { backgroundColor: st.color }]}>
        <Text style={[s.railDay, { color: st.onColor }]}>{dayOf(shift.starts_at)}</Text>
        <Text style={[s.railMonth, { color: st.onColor }]}>{monthOf(shift.starts_at)}</Text>
      </View>

      <Perforation />
      <View style={s.notchTop} />
      <View style={s.notchBottom} />

      <View style={s.stubBody}>
        <Text style={s.stubVenue} numberOfLines={1}>
          {shift.venue}
        </Text>
        <Text style={s.stubRole} numberOfLines={1}>
          {shift.role}
        </Text>
        <Text style={s.stubTime}>
          {clockOf(shift.starts_at)} – {clockOf(shift.ends_at)}
        </Text>
        <Meter needed={shift.taskers_needed} confirmed={shift.taskers_confirmed} />
        <View style={s.stubFoot}>
          <Text style={s.stubCount}>
            {shift.taskers_confirmed}/{shift.taskers_needed} Taskers
          </Text>
          <Text
            style={[
              s.stubStatus,
              { color: mine ? C.moss : st.color === C.hiviz ? C.brick : st.color },
            ]}
          >
            {mine ? "Tomado" : st.label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function Perforation() {
  return (
    <View style={s.perf}>
      {Array.from({ length: 16 }).map((_, i) => (
        <View key={i} style={s.perfDot} />
      ))}
    </View>
  );
}

// Un segmento por Tasker requerido: se lee de un vistazo cuánto falta para
// cubrir el turno, que es la pregunta que importa en operaciones.
function Meter({ needed, confirmed }) {
  return (
    <View style={s.meter}>
      {Array.from({ length: needed }).map((_, i) => (
        <View key={i} style={[s.seg, i < confirmed ? s.segOn : s.segOff]} />
      ))}
    </View>
  );
}

function DataRow({ label, value }) {
  return (
    <View style={s.dataRow}>
      <Text style={s.dataLabel}>{label}</Text>
      <Text style={s.dataValue}>{value}</Text>
    </View>
  );
}

function ActionButton({ label, onPress, disabled, variant = "ink" }) {
  const box = [s.btn, s[`btn_${variant}`], disabled && s.btnDisabled];
  const txt = [s.btnText, s[`btnText_${variant}`], disabled && s.btnTextDisabled];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [...box, pressed && !disabled && s.btnPressed]}
    >
      <Text style={txt}>{label}</Text>
    </Pressable>
  );
}

/* ----------------------------------------------------------------- estilos -- */

const RAIL_W = 58;

const s = StyleSheet.create({
  flex: { flex: 1 },
  rootInk: { flex: 1, backgroundColor: C.ink },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  /* header */
  header: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 20 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  wordmark: {
    fontFamily: F.display,
    fontSize: 22,
    color: C.surface,
    letterSpacing: 3,
  },
  countChip: {
    minWidth: 30,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: C.inkSoft,
    borderWidth: 1,
    borderColor: C.inkLine,
    alignItems: "center",
  },
  countChipText: { fontFamily: F.display, fontSize: 16, color: C.hiviz, letterSpacing: 1 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: {
    fontFamily: F.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: C.mutedInk,
  },
  headerTitle: {
    fontFamily: F.display,
    fontSize: 38,
    lineHeight: 40,
    color: C.surface,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
  },
  headerSub: {
    fontFamily: F.body,
    fontSize: 13,
    color: C.mutedInk,
    marginTop: 6,
  },
  back: {
    fontFamily: F.bodyMid,
    fontSize: 14,
    color: C.hiviz,
    letterSpacing: 0.3,
  },

  /* lámina de contenido */
  sheet: { flex: 1, backgroundColor: C.paper },
  listPad: { padding: 18, paddingBottom: 28 },
  detailPad: { padding: 22, paddingBottom: 40 },
  bottomBar: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 6,
    backgroundColor: C.ink,
  },

  /* talón */
  stub: {
    flexDirection: "row",
    backgroundColor: C.surface,
    marginBottom: 14,
    borderRadius: 3,
    overflow: "visible",
    shadowColor: C.ink,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  stubPressed: { opacity: 0.85 },
  stubDim: { opacity: 0.55 },
  rail: {
    width: RAIL_W,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
  },
  railDay: { fontFamily: F.display, fontSize: 30, lineHeight: 32 },
  railMonth: { fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 1.6, marginTop: 2 },
  perf: {
    width: 1,
    marginVertical: 14,
    alignItems: "center",
    justifyContent: "space-between",
  },
  perfDot: { width: 1, height: 3, backgroundColor: C.line },
  notchTop: {
    position: "absolute",
    top: -6,
    left: RAIL_W - 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.paper,
  },
  notchBottom: {
    position: "absolute",
    bottom: -6,
    left: RAIL_W - 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.paper,
  },
  stubBody: { flex: 1, paddingVertical: 14, paddingHorizontal: 16 },
  stubVenue: {
    fontFamily: F.display,
    fontSize: 20,
    lineHeight: 22,
    color: C.ink,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  stubRole: { fontFamily: F.body, fontSize: 13, color: C.muted, marginTop: 2 },
  stubTime: {
    fontFamily: F.displayMid,
    fontSize: 17,
    color: C.ink,
    letterSpacing: 0.6,
    marginTop: 8,
    marginBottom: 10,
  },
  stubFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  stubCount: { fontFamily: F.bodyMid, fontSize: 12, color: C.muted },
  stubStatus: {
    fontFamily: F.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },

  /* medidor */
  meter: { flexDirection: "row", gap: 3 },
  seg: { flex: 1, height: 5, borderRadius: 1 },
  segOn: { backgroundColor: C.moss },
  segOff: { backgroundColor: C.line },
  meterCaption: { fontFamily: F.body, fontSize: 13, color: C.muted, marginTop: 10 },
  fenceLine: { fontFamily: F.displayMid, fontSize: 17, color: C.ink, letterSpacing: 0.4 },

  /* encabezado de sección */
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
    marginBottom: 12,
  },
  sectionHeadText: {
    fontFamily: F.display,
    fontSize: 18,
    color: C.ink,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  sectionRule: { flex: 1, height: 1, backgroundColor: C.line },
  sectionHeadCount: {
    fontFamily: F.bodyBold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: C.muted,
  },

  /* vacío */
  empty: { paddingTop: 70, paddingHorizontal: 20, alignItems: "center" },
  emptyTitle: {
    fontFamily: F.display,
    fontSize: 22,
    color: C.ink,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  emptyBody: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.muted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },

  /* detalle */
  pillRow: { flexDirection: "row", marginBottom: 22 },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 2 },
  pillText: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  dataRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    gap: 16,
  },
  dataLabel: { fontFamily: F.bodyMid, fontSize: 13, color: C.muted },
  dataValue: {
    fontFamily: F.displayMid,
    fontSize: 18,
    color: C.ink,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    flexShrink: 1,
    textAlign: "right",
  },
  sectionLabel: {
    fontFamily: F.bodyBold,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: C.muted,
    marginTop: 26,
    marginBottom: 10,
  },

  /* campos */
  fieldLabel: {
    fontFamily: F.bodyBold,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: C.muted,
    marginTop: 20,
    marginBottom: 6,
  },
  input: {
    fontFamily: F.body,
    fontSize: 16,
    color: C.ink,
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
    paddingVertical: 8,
  },
  fieldLabelInk: {
    fontFamily: F.bodyBold,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: C.mutedInk,
    marginBottom: 6,
  },
  inputInk: {
    fontFamily: F.body,
    fontSize: 16,
    color: C.surface,
    borderBottomWidth: 1.5,
    borderBottomColor: C.inkLine,
    paddingVertical: 8,
  },
  hint: { fontFamily: F.body, fontSize: 12, color: C.muted, marginTop: 10, lineHeight: 17 },
  splitRow: { flexDirection: "row" },
  splitCol: { flex: 1 },

  /* stepper */
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: C.ink,
    paddingHorizontal: 6,
  },
  stepBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepBtnText: { fontFamily: F.display, fontSize: 24, color: C.ink },
  stepperValue: {
    fontFamily: F.display,
    fontSize: 20,
    color: C.ink,
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  /* botones */
  btn: { paddingVertical: 15, alignItems: "center", justifyContent: "center", borderRadius: 2 },
  btnPressed: { opacity: 0.82 },
  btnDisabled: { opacity: 0.4 },
  btn_hiviz: { backgroundColor: C.hiviz },
  btn_ink: { backgroundColor: C.ink },
  btn_ghost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.ink },
  btn_danger: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: C.brick },
  btnText: {
    fontFamily: F.display,
    fontSize: 17,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  btnText_hiviz: { color: C.ink },
  btnText_ink: { color: C.surface },
  btnText_ghost: { color: C.ink },
  btnText_danger: { color: C.brick },
  btnTextDisabled: {},

  /* login */
  loginPad: { paddingHorizontal: 30 },
  loginEyebrow: {
    fontFamily: F.bodyBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: C.mutedInk,
  },
  loginWordmark: {
    fontFamily: F.display,
    fontSize: 64,
    lineHeight: 66,
    color: C.surface,
    letterSpacing: 4,
    marginTop: 6,
  },
  loginRule: { height: 4, width: 72, backgroundColor: C.hiviz, marginTop: 14, marginBottom: 42 },
  loginFoot: {
    fontFamily: F.body,
    fontSize: 12,
    color: C.mutedInk,
    textAlign: "center",
    paddingBottom: 8,
  },
});
