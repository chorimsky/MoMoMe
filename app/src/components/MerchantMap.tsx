/* ============================================================
   MerchantMap — the "locate a business" map for /discover. A Leaflet + OSM
   slippy map plotting opted-in merchants at their coarse city coordinates.
   Tapping a pin lifts the selection up to Discover, which shows a pay card.
   No settlement numbers or precise addresses are ever plotted here.
   ============================================================ */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MerchantDirectoryEntry } from "@shared/types.js";

type Pinned = MerchantDirectoryEntry & { location: { lat: number; lng: number; label?: string } };

/** Only merchants we could geocode can appear on the map. */
export function pinnable(m: MerchantDirectoryEntry): m is Pinned {
  return typeof m.location?.lat === "number" && typeof m.location?.lng === "number";
}

function pinHtml(selected: boolean): string {
  const fill = selected ? "var(--accent)" : "var(--brand)";
  const scale = selected ? 1.15 : 1;
  return `<div style="transform:translate(-50%,-100%) scale(${scale});transform-origin:bottom center;transition:transform .12s">
    <svg width="30" height="38" viewBox="0 0 30 38" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 37C15 37 27 23.5 27 14C27 6.8 21.6 1 15 1C8.4 1 3 6.8 3 14C3 23.5 15 37 15 37Z" fill="${fill}" stroke="white" stroke-width="2"/>
      <circle cx="15" cy="14" r="5" fill="white"/>
    </svg></div>`;
}

export function MerchantMap({ merchants, selectedCode, onSelect }: {
  merchants: MerchantDirectoryEntry[];
  selectedCode: string | null;
  onSelect: (code: string | null) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { center: [4.6, 12.35], zoom: 6, zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    map.on("click", () => onSelectRef.current(null)); // tap empty space → deselect
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Sync markers whenever the merchant list changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((mk) => mk.remove());
    markersRef.current.clear();

    const pins = merchants.filter(pinnable);
    pins.forEach((m) => {
      const marker = L.marker([m.location.lat, m.location.lng], {
        icon: L.divIcon({ className: "mm-pin", html: pinHtml(false), iconSize: [30, 38], iconAnchor: [15, 38] }),
        title: m.businessName,
        riseOnHover: true,
      });
      marker.on("click", (e) => { L.DomEvent.stopPropagation(e); onSelectRef.current(m.code); });
      marker.addTo(map);
      markersRef.current.set(m.code, marker);
    });

    if (pins.length) {
      const bounds = L.latLngBounds(pins.map((m) => [m.location.lat, m.location.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 });
    }
  }, [merchants]);

  // Reflect the current selection in pin styling + recenter onto it.
  useEffect(() => {
    const map = mapRef.current;
    markersRef.current.forEach((mk, code) => {
      mk.setIcon(L.divIcon({ className: "mm-pin", html: pinHtml(code === selectedCode), iconSize: [30, 38], iconAnchor: [15, 38] }));
      if (code === selectedCode) mk.setZIndexOffset(1000); else mk.setZIndexOffset(0);
    });
    if (selectedCode && map) {
      const mk = markersRef.current.get(selectedCode);
      if (mk) map.panTo(mk.getLatLng(), { animate: true });
    }
  }, [selectedCode]);

  return <div ref={elRef} style={{ position: "absolute", inset: 0 }} aria-label="Map of businesses" />;
}
