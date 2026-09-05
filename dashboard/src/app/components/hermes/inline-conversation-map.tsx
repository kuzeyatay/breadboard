"use client";

// Read-only native map for a completed chat turn. It renders the same
// conversation-scoped geographic context as /map; assistant prose is never
// parsed for places, coordinates, or route geometry.

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { formatDistance, formatDuration } from "@/lib/map/format.ts";
import type { GeographicContext, MapPlace } from "@/lib/map/types.ts";

export type InlineConversationMapKind = "route" | "places";

interface ContextResponse {
  enabled: boolean;
  styleUrl: string;
  context: GeographicContext;
}

const ROUTE_SOURCE_ID = "breadboard-inline-route";
const ROUTE_LAYER_ID = "breadboard-inline-route-line";
const POLL_INTERVAL_MS = 2_500;
const MAX_CONTEXT_POLL_ATTEMPTS = 48;

function retrievedForRequest(retrievedAt: string, requestedAt?: string): boolean {
  if (!requestedAt) return true;
  const retrieved = Date.parse(retrievedAt);
  const requested = Date.parse(requestedAt);
  return !Number.isFinite(retrieved) || !Number.isFinite(requested)
    ? true
    : retrieved >= requested;
}

function placesForDisplay(
  context: GeographicContext,
  requestedAt?: string,
): MapPlace[] {
  const ids = context.nearbyPlaceIds.length
    ? context.nearbyPlaceIds
    : context.lastSearchPlaceIds;
  return ids
    .map((id) => context.places[id])
    .filter(
      (place): place is MapPlace =>
        Boolean(
          place && retrievedForRequest(place.provenance.retrievedAt, requestedAt),
        ),
    );
}

function requestedMapIsReady(
  payload: ContextResponse,
  kind: InlineConversationMapKind,
  requestedAt?: string,
): boolean {
  if (!payload.enabled) return true;
  if (kind === "route") {
    return Boolean(
      payload.context.activeRoute &&
        retrievedForRequest(
          payload.context.activeRoute.provenance.retrievedAt,
          requestedAt,
        ),
    );
  }
  return placesForDisplay(payload.context, requestedAt).length > 0;
}

export default function InlineConversationMap({
  conversationPublicId,
  kind,
  requestedAt,
}: {
  conversationPublicId: string;
  kind: InlineConversationMapKind;
  requestedAt?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const fittedRevisionRef = useRef<string | null>(null);
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [context, setContext] = useState<GeographicContext | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let request: AbortController | null = null;
    let attempts = 0;
    const load = async () => {
      const controller = new AbortController();
      request?.abort();
      request = controller;
      attempts += 1;
      try {
        const url = new URL("/api/map/context", window.location.origin);
        url.searchParams.set("conversation", conversationPublicId);
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (disposed) return;
        if (response.ok) {
          const payload = (await response.json()) as ContextResponse;
          if (disposed) return;
          setEnabled(payload.enabled);
          setStyleUrl(payload.styleUrl);
          setContext((current) =>
            current?.revision === payload.context.revision
              ? current
              : payload.context,
          );
          if (requestedMapIsReady(payload, kind, requestedAt)) return;
        }
      } catch {
        // The answer remains useful when the optional visual cannot load.
      } finally {
        if (request === controller) request = null;
      }
      if (!disposed && attempts < MAX_CONTEXT_POLL_ATTEMPTS) {
        timer = window.setTimeout(() => void load(), POLL_INTERVAL_MS);
      }
    };
    void load();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      request?.abort();
      request = null;
    };
  }, [conversationPublicId, kind, requestedAt]);

  const places = useMemo(
    () => (context ? placesForDisplay(context, requestedAt) : []),
    [context, requestedAt],
  );
  const route =
    kind === "route" &&
    context?.activeRoute &&
    retrievedForRequest(context.activeRoute.provenance.retrievedAt, requestedAt)
      ? context.activeRoute
      : undefined;
  const hasRenderableData = Boolean(route || (kind === "places" && places.length));

  useEffect(() => {
    if (!styleUrl || !hasRenderableData || !containerRef.current || mapRef.current) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      const map = new maplibre.Map({
        container: containerRef.current,
        style: styleUrl,
        center: [28.9784, 41.0082],
        zoom: 11,
        attributionControl: { compact: true },
      });
      map.addControl(
        new maplibre.NavigationControl({ visualizePitch: false }),
        "top-right",
      );
      map.on("load", () => {
        map
          .getContainer()
          .querySelector(".maplibregl-ctrl-attrib")
          ?.classList.remove("maplibregl-compact-show");
        map.addSource(ROUTE_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#4f8cff",
            "line-width": 6,
            "line-opacity": 0.9,
          },
        });
        setMapReady(true);
        map.resize();
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
    };
  }, [hasRenderableData, styleUrl]);

  useEffect(
    () => () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !context) return;
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

      if (route) {
        addMarker(route.origin, "#3b82f6", "Origin");
        addMarker(route.destination, "#ef4444", "Destination");
      } else {
        for (const place of places) addMarker(place, "#7a6cff", "Recommended");
      }

      const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData(
        route
          ? {
              type: "Feature",
              properties: {},
              // Router-owned geometry, passed to MapLibre unchanged.
              geometry: route.geometry,
            }
          : { type: "FeatureCollection", features: [] },
      );

      const fitKey = `${kind}:${context.revision}`;
      if (fittedRevisionRef.current === fitKey) return;
      fittedRevisionRef.current = fitKey;
      if (route) {
        map.fitBounds(
          [
            [route.bounds.west, route.bounds.south],
            [route.bounds.east, route.bounds.north],
          ],
          { padding: 56, duration: 500 },
        );
      } else if (places.length === 1) {
        map.flyTo({
          center: [places[0].lon, places[0].lat],
          zoom: 15,
          duration: 500,
        });
      } else if (places.length > 1) {
        const bounds = new maplibre.LngLatBounds();
        for (const place of places) bounds.extend([place.lon, place.lat]);
        map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 500 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context, kind, mapReady, places, route]);

  if (!enabled || !hasRenderableData) return null;

  const mapHref = `/map?conversation=${encodeURIComponent(conversationPublicId)}`;
  return (
    <section
      aria-label={kind === "route" ? "Requested directions map" : "Recommended places map"}
      className="mb-4 mt-1 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)]"
    >
      <div className="relative">
        <div ref={containerRef} className="h-80 w-full" />
        <a
          href={mapHref}
          target="_blank"
          rel="noreferrer"
          className="absolute top-3 left-3 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 text-xs text-[#fff] shadow-lg backdrop-blur hover:bg-black/85"
        >
          Open map
        </a>
        {route ? (
          <div className="absolute right-3 bottom-3 left-3 rounded-xl border border-white/10 bg-black/80 px-3 py-2.5 text-[#fff] shadow-xl backdrop-blur">
            <p className="truncate text-xs font-medium">
              {route.origin.name} to {route.destination.name}
            </p>
            <p className="mt-0.5 text-[11px] text-[#fff]/75">
              {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)} · {route.mode}
              {route.steps?.length ? ` · ${route.steps.length} steps` : ""}
            </p>
          </div>
        ) : places.length ? (
          <div className="absolute right-3 bottom-8 left-3 rounded-xl border border-white/10 bg-black/80 px-3 py-2.5 text-[#fff] shadow-xl backdrop-blur">
            <p className="text-xs font-medium">
              {places.length} {places.length === 1 ? "place" : "places"} on the map
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[#fff]/75">
              {places.slice(0, 3).map((place) => place.name).join(" · ")}
              {places.length > 3 ? ` · +${places.length - 3}` : ""}
            </p>
          </div>
        ) : null}
      </div>
      {route?.steps?.length ? (
        <details className="border-t border-[var(--line)] px-3 py-2 text-xs text-[var(--ink)]">
          <summary className="cursor-pointer select-none font-medium">
            Turn-by-turn directions ({route.steps.length})
          </summary>
          <ol className="mt-2 max-h-48 list-decimal space-y-1.5 overflow-y-auto pl-5 text-[var(--ink-muted)]">
            {route.steps.map((step, index) => (
              <li key={`${index}:${step.instruction}`}>
                <span className="text-[var(--ink)]">{step.instruction}</span>
                {step.distanceMeters > 0 ? (
                  <span> · {formatDistance(step.distanceMeters)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
