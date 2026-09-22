"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SANTIAGO = { lat: -33.4372, lng: -70.6506 };

type Point = { lat: number; lng: number };

/**
 * Elegir el cerco en un mapa en vez de escribir coordenadas a mano: el
 * coordinador busca la dirección, ajusta el punto y ve el radio real dibujado.
 * Los valores viajan en inputs ocultos, así el formulario sigue siendo un
 * <form> normal que envía a una Server Action.
 */
export function FencePicker({
  apiKey,
  defaultAddress = "",
  defaultLat,
  defaultLng,
  defaultRadius = 150,
}: {
  apiKey: string;
  defaultAddress?: string;
  defaultLat?: number;
  defaultLng?: number;
  defaultRadius?: number;
}) {
  const hasInitial = !!(defaultLat || defaultLng);
  const [address, setAddress] = useState(defaultAddress);
  const [point, setPoint] = useState<Point | null>(
    hasInitial ? { lat: defaultLat!, lng: defaultLng! } : null
  );
  const [radius, setRadius] = useState(defaultRadius);

  if (!apiKey) {
    return (
      <ManualFallback
        address={address}
        setAddress={setAddress}
        point={point}
        setPoint={setPoint}
        radius={radius}
        setRadius={setRadius}
      />
    );
  }

  return (
    <div className="grid gap-3">
      {/* Lo que realmente se envía */}
      <input type="hidden" name="address" value={address} />
      <input type="hidden" name="lat" value={point?.lat ?? 0} />
      <input type="hidden" name="lng" value={point?.lng ?? 0} />
      <input type="hidden" name="radius_m" value={radius} />

      <APIProvider apiKey={apiKey}>
        <AddressSearch address={address} onAddress={setAddress} onFound={setPoint} />

        <div className="h-56 w-full overflow-hidden rounded-sm border border-hairline">
          <Map
            mapId="tasky-fence"
            defaultCenter={point ?? SANTIAGO}
            defaultZoom={point ? 16 : 11}
            gestureHandling="greedy"
            disableDefaultUI
            zoomControl
            onClick={(e) => {
              const ll = e.detail.latLng;
              if (ll) setPoint({ lat: ll.lat, lng: ll.lng });
            }}
          >
            {point ? <AdvancedMarker position={point} /> : null}
            <FenceCircle center={point} radius={radius} />
            <Recenter point={point} />
          </Map>
        </div>

        <p className="text-xs text-slate-muted">
          {point
            ? "Toca el mapa para mover el punto."
            : "Busca una dirección o toca el mapa para fijar el punto."}
        </p>
      </APIProvider>

      <div className="grid gap-1.5">
        <Label htmlFor="radius-range" className="eyebrow">
          Radio del cerco — {radius} m
        </Label>
        <input
          id="radius-range"
          type="range"
          min={50}
          max={1000}
          step={25}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="accent-hiviz"
        />
      </div>
    </div>
  );
}

/** Busca la dirección con el servicio de Geocoding y mueve el punto. */
function AddressSearch({
  address,
  onAddress,
  onFound,
}: {
  address: string;
  onAddress: (v: string) => void;
  onFound: (p: Point) => void;
}) {
  const geocodingLib = useMapsLibrary("geocoding");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!geocodingLib || !address.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const geocoder = new geocodingLib.Geocoder();
      const { results } = await geocoder.geocode({
        address: address.trim(),
        componentRestrictions: { country: "CL" },
      });
      const best = results[0];
      if (!best) {
        setError("No encontramos esa dirección.");
        return;
      }
      onFound({ lat: best.geometry.location.lat(), lng: best.geometry.location.lng() });
      onAddress(best.formatted_address);
    } catch {
      setError("No pudimos buscar la dirección. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }, [geocodingLib, address, onAddress, onFound]);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="address-search" className="eyebrow">
        Dirección
      </Label>
      <div className="flex gap-2">
        <Input
          id="address-search"
          value={address}
          onChange={(e) => onAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="Av. Andrés Bello 2425, Providencia"
        />
        <button
          type="button"
          onClick={search}
          disabled={busy || !geocodingLib}
          className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-ink px-3 font-display text-sm uppercase tracking-[0.1em] text-ink transition-colors hover:bg-ink hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-denim disabled:opacity-40"
        >
          <Search className="size-4" aria-hidden />
          {busy ? "Buscando…" : "Buscar"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-brick">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** El círculo del cerco, dibujado con la API imperativa del mapa. */
function FenceCircle({ center, radius }: { center: Point | null; radius: number }) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");
  const circleRef = useRef<google.maps.Circle | null>(null);

  useEffect(() => {
    if (!map || !mapsLib) return;
    if (!circleRef.current) {
      circleRef.current = new mapsLib.Circle({
        strokeColor: "#101E2B",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: "#FFB000",
        fillOpacity: 0.25,
      });
    }
    const circle = circleRef.current;
    circle.setMap(center ? map : null);
    if (center) {
      circle.setCenter(center);
      circle.setRadius(radius);
    }
  }, [map, mapsLib, center, radius]);

  useEffect(() => {
    return () => {
      circleRef.current?.setMap(null);
      circleRef.current = null;
    };
  }, []);

  return null;
}

/** Centra el mapa cuando el punto cambia por una búsqueda. */
function Recenter({ point }: { point: Point | null }) {
  const map = useMap();
  const last = useRef<string>("");

  useEffect(() => {
    if (!map || !point) return;
    const key = `${point.lat},${point.lng}`;
    if (key === last.current) return;
    last.current = key;
    map.panTo(point);
    if ((map.getZoom() ?? 0) < 15) map.setZoom(16);
  }, [map, point]);

  return null;
}

/** Si no hay clave configurada, el formulario sigue siendo usable a mano. */
function ManualFallback({
  address,
  setAddress,
  point,
  setPoint,
  radius,
  setRadius,
}: {
  address: string;
  setAddress: (v: string) => void;
  point: Point | null;
  setPoint: (p: Point) => void;
  radius: number;
  setRadius: (n: number) => void;
}) {
  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-muted">
        El mapa no está configurado en este entorno. Puedes cargar las coordenadas a mano.
      </p>
      <Input
        name="address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Dirección"
      />
      <div className="grid grid-cols-3 gap-3">
        <Input
          name="lat"
          type="number"
          step="any"
          value={point?.lat ?? ""}
          onChange={(e) => setPoint({ lat: Number(e.target.value), lng: point?.lng ?? 0 })}
          placeholder="Latitud"
        />
        <Input
          name="lng"
          type="number"
          step="any"
          value={point?.lng ?? ""}
          onChange={(e) => setPoint({ lat: point?.lat ?? 0, lng: Number(e.target.value) })}
          placeholder="Longitud"
        />
        <Input
          name="radius_m"
          type="number"
          min={50}
          max={2000}
          step={50}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
