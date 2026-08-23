"use client";

// The MapLibre view of Breadboard's geographic state.
//
// Everything on this screen is drawn from `/api/map/context` — the same row the
// `map_*` Hermes tools write. Nothing here parses an assistant message, and
// there is no code path that turns text into a marker or a line: the route the
// user sees is the exact GeoJSON the router returned, and the distance beside it
// is the router's own number.
//
// The state flows one way. User gestures (typing, clicking, panning) call the
// map service and let it write state; the render reacts to the state that comes
// back. That is why the map and the assistant can never drift apart.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { formatDistance, formatDuration } from "@/lib/map/format.ts";
import type { GeographicContext, MapPlace } from "@/lib/map/types.ts";
import {
  automaticTravelMode,
  type RouteModePreference,
} from "@/lib/map/travel-mode.ts";

interface CategoryOption {
  id: string;
  label: string;
}

interface ContextResponse {
  enabled: boolean;
  styleUrl: string;
  categories: CategoryOption[];
  conversationPublicId: string | null;
  context: GeographicContext;
}

const POLL_INTERVAL_MS = 2_500;
const SUGGEST_DEBOUNCE_MS = 280;
const ROUTE_SOURCE_ID = "breadboard-route";
const ROUTE_LAYER_ID = "breadboard-route-line";
const DEVICE_LOCATION_ERROR = "Breadboard could not read this device's location.";

export default function MapClient({
  conversationPublicId,
}: {
  conversationPublicId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const styleReadyRef = useRef(false);
  const lastFittedRouteRef = useRef<string | null>(null);
  const revisionRef = useRef(-1);

  const [settings, setSettings] = useState<Omit<ContextResponse, "context"> | null>(null);
  const [context, setContext] = useState<GeographicContext | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MapPlace[]>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [radius, setRadius] = useState(1_500);
  const [mode, setMode] = useState<RouteModePreference>("auto");

  const scopeBody = useMemo(
    () => (conversationPublicId ? { conversation: conversationPublicId } : {}),
    [conversationPublicId],
  );

  /* ---------------------------------------------------------------- */
  /* State                                                             */
  /* ---------------------------------------------------------------- */

  const loadContext = useCallback(async () => {
    const url = new URL("/api/map/context", window.location.origin);
    if (conversationPublicId) url.searchParams.set("conversation", conversationPublicId);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as ContextResponse;
    setSettings({
      enabled: payload.enabled,
      styleUrl: payload.styleUrl,
      categories: payload.categories,
      conversationPublicId: payload.conversationPublicId,
    });
    // Re-render only when the stored state actually moved. Polling keeps the map
    // following the assistant without the page fighting the user's own panning.
    if (payload.context.revision !== revisionRef.current) {
      revisionRef.current = payload.context.revision;
      setContext(payload.context);
    }
  }, [conversationPublicId]);

  useEffect(() => {
    void loadContext();
    const timer = window.setInterval(() => void loadContext(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadContext]);

  const runOperation = useCallback(
    async (operation: string, args: Record<string, unknown>) => {
      setBusy(true);
      setStatus(null);
      try {
        const response = await fetch("/api/map/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...scopeBody, operation, args }),
        });
        const payload = (await response.json()) as {
          data?: Record<string, unknown>;
          context?: GeographicContext;
          error?: string;
        };
        if (!response.ok) {
          // The service's own sentence, shown verbatim. A failed lookup is a
          // stated failure here for the same reason it is in an answer.
          setStatus(payload.error ?? "The map service could not complete that.");
          return null;
        }
        if (payload.context) {
          revisionRef.current = payload.context.revision;
          setContext(payload.context);
        }
        if (payload.data?.empty === true && typeof payload.data.message === "string") {
          setStatus(payload.data.message);
        }
        return payload.data ?? null;
      } catch {
        setStatus("The map service is unreachable.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [scopeBody],
  );

  const postContextAction = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch("/api/map/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scopeBody, ...body }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { context?: GeographicContext };
      if (payload.context) {
        revisionRef.current = payload.context.revision;
        setContext(payload.context);
      }
    },
    [scopeBody],
  );

  /* ---------------------------------------------------------------- */
  /* Autocomplete                                                      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setHighlighted(-1);
      return;
    }
    const controller = new AbortController();
    // Debounced, and served by Photon rather than Nominatim — the public
    // Nominatim instance must never be queried at keystroke rate.
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/map/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...scopeBody, query: trimmed, useViewport: true }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { places?: MapPlace[] };
        setSuggestions(payload.places ?? []);
        setHighlighted(-1);
      } catch {
        // An aborted keystroke is not an error worth showing.
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, scopeBody]);

  const selectSuggestion = useCallback(
    async (place: MapPlace) => {
      setSuggestions([]);
      setQuery(place.name);
      await postContextAction({ action: "select", placeId: place.id });
    },
    [postContextAction],
  );

  /* ---------------------------------------------------------------- */
  /* Map                                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!settings?.styleUrl || !containerRef.current || mapRef.current) return;
    let cancelled = false;
    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      const map = new maplibre.Map({
        container: containerRef.current,
        style: settings.styleUrl,
        center: [28.9784, 41.0082],
        zoom: 10,
        attributionControl: { compact: false },
      });
      map.addControl(new maplibre.NavigationControl({ visualizePitch: false }), "top-right");
      map.addControl(
        new maplibre.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: false,
        }),
        "top-right",
      );
      map.on("load", () => {
        styleReadyRef.current = true;
        map.addSource(ROUTE_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#2f6f4f", "line-width": 5, "line-opacity": 0.85 },
        });
      });
      map.on("moveend", () => {
        const bounds = map.getBounds();
        const center = map.getCenter();
        void postContextAction({
          action: "viewport",
          viewport: {
            center: { lat: center.lat, lon: center.lng },
            bounds: {
              north: bounds.getNorth(),
              south: bounds.getSouth(),
              east: bounds.getEast(),
              west: bounds.getWest(),
            },
            zoom: map.getZoom(),
          },
        });
      });
      // Clicking the map asks what is actually there rather than inventing a
      // label for the point.
      map.on("click", (event) => {
        void runOperation("map_reverse", {
          lat: event.lngLat.lat,
          lon: event.lngLat.lng,
        });
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
    };
  }, [settings?.styleUrl, postContextAction, runOperation]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const selectedPlace = context?.selectedPlaceId
    ? context.places[context.selectedPlaceId]
    : undefined;
  const nearbyPlaces = useMemo(
    () =>
      (context?.nearbyPlaceIds ?? [])
        .map((id) => context?.places[id])
        .filter((place): place is MapPlace => Boolean(place)),
    [context],
  );
  const route = context?.activeRoute;
  const automaticMode =
    context?.currentLocation && selectedPlace
      ? automaticTravelMode(context.currentLocation, selectedPlace)
      : "walking";

  /** Markers and route geometry, re-rendered from state on every revision. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !context) return;
    let cancelled = false;
    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !mapRef.current) return;
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];

      const addMarker = (place: MapPlace, color: string, label: string) => {
        const marker = new maplibre.Marker({ color })
          .setLngLat([place.lon, place.lat])
          .setPopup(
            new maplibre.Popup({ offset: 18 }).setText(
              `${label}: ${place.displayName}`,
            ),
          )
          .addTo(map);
        markersRef.current.push(marker);
      };

      for (const place of nearbyPlaces) addMarker(place, "#7a6cff", "Nearby");
      if (route) {
        addMarker(route.origin, "#3b82f6", "Origin");
        addMarker(route.destination, "#ef4444", "Destination");
      }
      if (selectedPlace) addMarker(selectedPlace, "#2f6f4f", "Selected");
      if (context.currentLocation) {
        const location = context.currentLocation;
        const marker = new maplibre.Marker({ color: "#f59e0b" })
          .setLngLat([location.lon, location.lat])
          .setPopup(new maplibre.Popup({ offset: 18 }).setText("Current location"))
          .addTo(map);
        markersRef.current.push(marker);
      }

      if (!styleReadyRef.current) return;
      const source = map.getSource(ROUTE_SOURCE_ID);
      if (source && "setData" in source) {
        (source as { setData: (data: unknown) => void }).setData(
          route
            ? {
                type: "Feature",
                properties: {},
                // Exactly the geometry the router returned, unchanged.
                geometry: route.geometry,
              }
            : { type: "FeatureCollection", features: [] },
        );
      }
      if (route && lastFittedRouteRef.current !== `${route.id}:${context.revision}`) {
        lastFittedRouteRef.current = `${route.id}:${context.revision}`;
        map.fitBounds(
          [
            [route.bounds.west, route.bounds.south],
            [route.bounds.east, route.bounds.north],
          ],
          { padding: 64, duration: 700 },
        );
      } else if (!route && selectedPlace) {
        map.flyTo({ center: [selectedPlace.lon, selectedPlace.lat], zoom: 15, duration: 700 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context, nearbyPlaces, route, selectedPlace]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus("This browser does not offer a location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setStatus(null);
        void postContextAction({
          action: "current_location",
          location: {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            source: "device",
          },
        });
      },
      () => setStatus(DEVICE_LOCATION_ERROR),
    );
  }, [postContextAction]);

  const findNearby = useCallback(
    (category: string) => {
      if (!selectedPlace) {
        setStatus("Search for a place first, then look around it.");
        return;
      }
      void runOperation("map_nearby", {
        center: { placeId: selectedPlace.id },
        category,
        radiusMeters: radius,
        limit: 20,
      });
    },
    [radius, runOperation, selectedPlace],
  );

  const routeToSelected = useCallback(() => {
    if (!selectedPlace) return;
    if (!context?.currentLocation) {
      setStatus("Breadboard has no current location to route from.");
      return;
    }
    void runOperation("map_route", {
      origin: { reference: "current_location" },
      destination: { placeId: selectedPlace.id },
      mode,
    });
  }, [context?.currentLocation, mode, runOperation, selectedPlace]);

  if (settings && !settings.enabled) {
    return (
      <main className="flex h-screen items-center justify-center bg-[var(--paper)] p-8 text-sm text-[var(--ink-muted)]">
        Breadboard&apos;s map services are disabled in this installation.
      </main>
    );
  }

  return (
    <main className="flex h-screen w-full flex-col bg-[var(--paper)] text-[var(--ink)] md:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-[var(--rule)] p-4 md:w-[22rem] md:border-r md:border-b-0">
        <header>
          <h1 className="text-base font-medium">Map</h1>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Places, routes and results come from OpenStreetMap. The assistant reads and
            writes this same state.
          </p>
        </header>

        <div className="relative">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlighted((index) => Math.min(index + 1, suggestions.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlighted((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && suggestions.length) {
                event.preventDefault();
                void selectSuggestion(suggestions[Math.max(0, highlighted)]);
              } else if (event.key === "Escape") {
                setSuggestions([]);
              }
            }}
            placeholder="Search for a place"
            aria-label="Search for a place"
            className="w-full rounded-lg border border-[var(--rule)] bg-[var(--paper-raised)] px-3 py-2 text-sm outline-none focus:border-[var(--botanical)]"
          />
          {suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-[var(--rule)] bg-[var(--paper-raised)] shadow-lg"
            >
              {suggestions.map((place, index) => (
                <li key={place.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => void selectSuggestion(place)}
                    className={`block w-full px-3 py-2 text-left text-xs ${
                      index === highlighted ? "bg-[var(--paper-sunken)]" : ""
                    }`}
                  >
                    <span className="block font-medium">{place.name}</span>
                    <span className="block text-[var(--ink-muted)]">
                      {place.displayName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={useMyLocation}
            className="rounded-lg border border-[var(--rule)] px-2.5 py-1 text-xs hover:bg-[var(--paper-sunken)]"
          >
            Use my location
          </button>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as RouteModePreference)}
            aria-label="Travel mode"
            className="rounded-lg border border-[var(--rule)] bg-[var(--paper-raised)] px-2 py-1 text-xs"
          >
            <option value="auto">
              Auto ({automaticMode === "walking" ? "Walking" : "Driving"})
            </option>
            <option value="walking">Walking</option>
            <option value="driving">Driving</option>
            <option value="cycling">Cycling</option>
          </select>
          <button
            type="button"
            onClick={routeToSelected}
            disabled={!selectedPlace || busy}
            className="rounded-lg border border-[var(--rule)] px-2.5 py-1 text-xs disabled:opacity-40 hover:bg-[var(--paper-sunken)]"
          >
            Route here
          </button>
        </div>

        {selectedPlace && (
          <section className="rounded-lg border border-[var(--rule)] p-3">
            <h2 className="text-sm font-medium">{selectedPlace.name}</h2>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              {selectedPlace.displayName}
            </p>
            <p className="mt-1 font-mono text-[10px] text-[var(--ink-muted)]">
              {selectedPlace.id}
            </p>
            <p className="mt-1 text-[10px] text-[var(--ink-muted)]">
              {selectedPlace.provenance.provider} ·{" "}
              {new Date(selectedPlace.provenance.retrievedAt).toLocaleString()}
            </p>
            <button
              type="button"
              onClick={() =>
                void runOperation("map_place_details", { placeId: selectedPlace.id })
              }
              className="mt-2 rounded-lg border border-[var(--rule)] px-2.5 py-1 text-xs hover:bg-[var(--paper-sunken)]"
            >
              Details
            </button>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              Nearby
            </h2>
            <label className="text-[10px] text-[var(--ink-muted)]">
              radius
              <select
                value={radius}
                onChange={(event) => setRadius(Number(event.target.value))}
                className="ml-1 rounded border border-[var(--rule)] bg-[var(--paper-raised)] px-1 py-0.5"
              >
                <option value={500}>500 m</option>
                <option value={1500}>1.5 km</option>
                <option value={5000}>5 km</option>
                <option value={15000}>15 km</option>
              </select>
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(settings?.categories ?? []).slice(0, 14).map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => findNearby(category.id)}
                disabled={!selectedPlace || busy}
                className="rounded-full border border-[var(--rule)] px-2 py-0.5 text-[11px] disabled:opacity-40 hover:bg-[var(--paper-sunken)]"
              >
                {category.label}
              </button>
            ))}
          </div>
          {nearbyPlaces.length > 0 && (
            <ul className="mt-2 space-y-1">
              {nearbyPlaces.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() =>
                      void postContextAction({ action: "select", placeId: place.id })
                    }
                    className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--paper-sunken)]"
                  >
                    <span className="font-medium">{place.name}</span>
                    <span className="block text-[10px] text-[var(--ink-muted)]">
                      {place.displayName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {route && (
          <section className="rounded-lg border border-[var(--rule)] p-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              Route
            </h2>
            <p className="mt-1 text-sm">
              {/* The router's own numbers, formatted once, shown here and quoted
                  by the assistant. Neither side recomputes them. */}
              <span className="font-medium">{formatDistance(route.distanceMeters)}</span>
              {" · "}
              <span className="font-medium">{formatDuration(route.durationSeconds)}</span>
              <span className="text-[var(--ink-muted)]"> ({route.mode})</span>
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {route.origin.name} to {route.destination.name}
            </p>
            <p className="mt-1 text-[10px] text-[var(--ink-muted)]">
              {route.provenance.provider} ·{" "}
              {new Date(route.provenance.retrievedAt).toLocaleString()}
            </p>
            <button
              type="button"
              onClick={() => void postContextAction({ action: "clear_route" })}
              className="mt-2 rounded-lg border border-[var(--rule)] px-2.5 py-1 text-xs hover:bg-[var(--paper-sunken)]"
            >
              Clear
            </button>
          </section>
        )}

        {status && !(status === DEVICE_LOCATION_ERROR && context?.currentLocation) && (
          <p className="rounded-lg border border-[var(--rule)] bg-[var(--paper-sunken)] p-2 text-xs text-[var(--ink-muted)]">
            {status}
          </p>
        )}
      </aside>

      <div ref={containerRef} className="min-h-[24rem] flex-1" aria-label="Map" />
    </main>
  );
}
