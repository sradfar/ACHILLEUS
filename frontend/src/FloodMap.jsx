import { Component, memo, useEffect, useRef, useState } from "react";
import * as L from "./vendor/leaflet/leaflet.js";
import "./vendor/leaflet/leaflet.css";
import "./flood-map.css";

const DEPTH_COLORS = ["#74d7e5", "#299ac5", "#2562af", "#18366e"];
const PROB_COLORS = ["#c4edf1", "#79cedc", "#379cc6", "#2762ad", "#173568"];
const mercator = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const valueAt = (raster, row, col) => {
  const i = (row * raster.width + col) * 4;
  return raster.pixels[i] * 65536 + raster.pixels[i + 1] * 256 + raster.pixels[i + 2];
};
function decodeRaster(png) {
  if (!png) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        resolve({ width: image.width, height: image.height,
          pixels: context.getImageData(0, 0, image.width, image.height).data });
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error("The flood overlay could not be loaded. Please run impact again."));
    image.src = `data:image/png;base64,${png}`;
  });
}
function nearest(axis, target) {
  const direction = axis[0] > axis.at(-1) ? -1 : 1;
  let low = 0, high = axis.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (axis[mid] * direction < target * direction) low = mid + 1; else high = mid;
  }
  return low > 0 && Math.abs(axis[low - 1] - target) <= Math.abs(axis[low] - target) ? low - 1 : low;
}

class MapBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <div className="flood-map-readout" role="alert">The map could not be displayed. Impact totals remain available. <button onClick={() => this.setState({ failed: false })}>Reload map</button></div> : this.props.children;
  }
}

const RasterFloodMap = memo(function FloodMap({ grid, floodResult, probabilityPng, station, dark }) {
  const container = useRef(null), mapRef = useRef(null), overlayRef = useRef(null);
  const readout = useRef(null), active = useRef(null), baseRef = useRef(null);
  const [ready, setReady] = useState(false), [rasters, setRasters] = useState(null);
  const [base, setBase] = useState("streets"), [layer, setLayer] = useState("depth");
  const [landOnly, setLandOnly] = useState(true), [opacity, setOpacity] = useState(.72);
  const [error, setError] = useState("");
  const north = grid?.lat_edges?.[0], south = grid?.lat_edges?.at(-1);
  const west = grid?.lon_edges?.[0], east = grid?.lon_edges?.at(-1);
  const inspect = latlng => {
    if (!readout.current || !active.current) return;
    const { grid, rasters, landOnly } = active.current;
    const { lat, lng } = latlng;
    if (lat > grid.lat_edges[0] || lat < grid.lat_edges.at(-1) || lng < grid.lon_edges[0] || lng > grid.lon_edges.at(-1)) {
      readout.current.textContent = "Outside mapped terrain · pan or use Fit domain"; return;
    }
    const row = nearest(grid.lats, lat), col = nearest(grid.lons, lng);
    const encodedElevation = valueAt(rasters.elevation, row, col);
    const coordinates = `${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°${lng < 0 ? "W" : "E"}`;
    if (!encodedElevation) { readout.current.textContent = `${coordinates} · No terrain data`; return; }
    const elevation = (encodedElevation - grid.elevation_offset) / 1000;
    const depth = valueAt(rasters.depth, row, col) / 1000;
    const probability = rasters.probability ? ` · Flood likelihood ${(valueAt(rasters.probability, row, col) / 1000).toFixed(1)}%` : "";
    readout.current.textContent = `${coordinates} · Terrain ${elevation.toFixed(2)} m NAVD88 · Depth ${depth.toFixed(2)} m${probability}${landOnly && elevation <= 0 ? " · Below-zero terrain hidden" : ""}`;
  };

  useEffect(() => {
    const map = L.map(container.current, { scrollWheelZoom: false, zoomControl: true, minZoom: 7, maxZoom: 19 });
    map.createPane("floodRaster"); map.getPane("floodRaster").style.zIndex = "450";
    map.getPane("floodRaster").style.pointerEvents = "none";
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    map.on("mousemove click", event => inspect(event.latlng));
    map.on("moveend", () => inspect(map.getCenter()));
    mapRef.current = map; setReady(true);
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false })); resize.observe(container.current);
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (baseRef.current) map.removeLayer(baseRef.current);
    baseRef.current = base === "satellite"
      ? L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community", maxZoom: 19 })
      : L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        { attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>', maxZoom: 19,
          className: dark ? "flood-streets-dark" : "" });
    baseRef.current.addTo(map);
  }, [ready, base, dark]);

  useEffect(() => {
    if (!ready || north === undefined) return;
    mapRef.current.fitBounds([[south, west], [north, east]], { padding: [14, 14], animate: false });
    const boundary = L.rectangle([[south, west], [north, east]], { color: "#2459a9", weight: 1, fill: false, dashArray: "5 5", interactive: false }).addTo(mapRef.current);
    const gauge = L.circleMarker([station.lat, station.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#102b5c", fillOpacity: 1 }).addTo(mapRef.current);
    gauge.bindTooltip(`${station.name} · NOAA ${station.id}`, { direction: "top" });
    return () => { boundary.remove(); gauge.remove(); };
  }, [ready, station.id, north, south, west, east]);

  useEffect(() => {
    let cancelled = false; setError("");
    Promise.all([decodeRaster(grid?.elevation_png), decodeRaster(floodResult?.map_depth_png), decodeRaster(probabilityPng)])
      .then(([elevation, depth, probability]) => {
        if (!cancelled && elevation && depth) setRasters({ elevation, depth, probability });
      }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [grid?.elevation_png, floodResult?.map_depth_png, probabilityPng]);

  useEffect(() => {
    if (!ready || !rasters || !grid) return;
    active.current = { grid, rasters, landOnly };
    const probability = layer === "probability" && rasters.probability;
    const canvas = document.createElement("canvas");
    canvas.width = rasters.depth.width; canvas.height = rasters.depth.height;
    const context = canvas.getContext("2d");
    const y = grid.lat_edges.map(lat => (mercator(north) - mercator(lat)) / (mercator(north) - mercator(south)) * canvas.height);
    const x = grid.lon_edges.map(lon => (lon - west) / (east - west) * canvas.width);
    for (let r = 0; r < canvas.height; r++) for (let c = 0; c < canvas.width; c++) {
      const elevation = valueAt(rasters.elevation, r, c);
      if (!elevation || (landOnly && elevation <= grid.elevation_offset)) continue;
      const value = valueAt(probability ? rasters.probability : rasters.depth, r, c) / 1000;
      if (value <= 0) continue;
      context.fillStyle = probability ? PROB_COLORS[Math.min(4, Math.floor(value / 20))]
        : DEPTH_COLORS[value <= .3 ? 0 : value <= 1 ? 1 : value <= 2 ? 2 : 3];
      context.fillRect(Math.floor(x[c]), Math.floor(y[r]), Math.ceil(x[c + 1]) - Math.floor(x[c]), Math.ceil(y[r + 1]) - Math.floor(y[r]));
    }
    if (overlayRef.current) overlayRef.current.remove();
    overlayRef.current = L.imageOverlay(canvas.toDataURL("image/png"), [[south, west], [north, east]],
      { pane: "floodRaster", opacity, interactive: false, className: "flood-raster-image" }).addTo(mapRef.current);
    inspect(mapRef.current.getCenter());
  }, [ready, rasters, grid, landOnly, layer]);
  useEffect(() => { overlayRef.current?.setOpacity(opacity); }, [opacity]);
  useEffect(() => { if (!probabilityPng) setLayer("depth"); }, [probabilityPng]);

  return <section className="flood-map-shell" aria-label="Flood map controls and legend">
    <div className="flood-map-toolbar">
      <div className="flood-map-options" role="group" aria-label="Basemap">
        <button aria-pressed={base === "streets"} onClick={() => setBase("streets")}>Streets</button>
        <button aria-pressed={base === "satellite"} onClick={() => setBase("satellite")}>Satellite</button>
      </div>
      <div className="flood-map-options" role="group" aria-label="Flood layer">
        <button aria-pressed={layer === "depth"} onClick={() => setLayer("depth")}>Flood depth</button>
        {probabilityPng && <button aria-pressed={layer === "probability"} onClick={() => setLayer("probability")}>Flood likelihood</button>}
      </div>
      <label className="flood-map-checkbox"><input type="checkbox" checked={landOnly} onChange={e => setLandOnly(e.target.checked)}/>Land overlay only</label>
      <button className="flood-fit" onClick={() => mapRef.current?.fitBounds([[south, west], [north, east]], { padding: [14, 14] })}>Fit domain</button>
    </div>
    <div ref={container} className="flood-map-canvas" role="region" aria-label="Interactive flood map"/>
    <div className="flood-map-legend">
      <div><strong>{layer === "probability" ? "Flood likelihood (%)" : "Flood depth (m)"}</strong>
        <div className="flood-map-swatches">{(layer === "probability" ? PROB_COLORS : DEPTH_COLORS).map((color, i) =>
          <span key={color}><i style={{ background: color }}/>{layer === "probability" ? ["0–20", "20–40", "40–60", "60–80", "80–100"][i] : ["0–0.3", "0.3–1", "1–2", ">2"][i]}</span>)}</div>
      </div>
      <label className="flood-map-opacity">Overlay opacity <input aria-label="Flood overlay opacity" type="range" min=".15" max="1" step=".05" value={opacity} onChange={e => setOpacity(Number(e.target.value))}/></label>
    </div>
    <div ref={readout} className="flood-map-readout" role="status">Move over the map or tap to inspect terrain and flood depth.</div>
    <p className="flood-map-note">{floodResult?.modelInfo} · Water level {floodResult?.wl?.toFixed(2)} m MLLW · {landOnly ? "Overlay shows terrain above 0 m NAVD88. Turn off Land overlay only to include lower terrain." : "Overlay includes all mapped terrain."} Pan and zoom to explore.</p>
    {error && <p className="flood-map-error" role="alert">{error}</p>}
  </section>;
});

export default function FloodMap(props) {
  return <MapBoundary resetKey={props.floodResult?.map_depth_png}><RasterFloodMap {...props}/></MapBoundary>;
}
