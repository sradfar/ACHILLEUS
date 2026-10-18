import { cloneElement, useId, useMemo, useState } from "react";

export function utcTimestamp(value) {
  const text = String(value ?? "");
  const date = new Date(/Z$|[+-]\d\d:\d\d$/i.test(text) ? text : `${text}Z`);
  return Number.isFinite(date.getTime())
    ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`
    : "";
}

/** Adds the same pointer, touch and keyboard inspection to every temporal SVG. */
export default function TimeSeriesHover({ children, series, width, height, label, exact = false }) {
  const id = useId();
  const [active, setActive] = useState(null);
  const clean = useMemo(() => series.map(s => ({ ...s, points: s.points.filter(p =>
    Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.v)) })), [series]);
  const anchors = useMemo(() => [...new Set(clean.flatMap(s => s.points.map(p => p.x)))].sort((a,b) => a-b), [clean]);
  const x = active === null ? null : anchors[Math.min(active, anchors.length-1)];
  const rows = x === null ? [] : clean.flatMap(s => {
    const point = s.points.reduce((best,p) => !best || Math.abs(p.x-x)<Math.abs(best.x-x) ? p : best, null);
    return point && (!exact || Math.abs(point.x-x)<0.001) ? [{ ...s, point }] : [];
  });
  function inspect(event) {
    const box = event.currentTarget.getBoundingClientRect();
    // viewBox is fitted with xMidYMid meet unless the SVG explicitly stretches.
    const stretch = children.props.preserveAspectRatio === "none";
    const scale = stretch ? box.width/width : Math.min(box.width/width, box.height/height);
    const offset = stretch ? 0 : (box.width-width*scale)/2;
    const target = (event.clientX-box.left-offset)/scale;
    let closest = 0;
    anchors.forEach((a,i) => { if (Math.abs(a-target)<Math.abs(anchors[closest]-target)) closest=i; });
    if (anchors.length) setActive(closest);
  }
  function key(event) {
    if (!["ArrowLeft","ArrowRight","Home","End","Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") return setActive(null);
    const index = active ?? 0;
    setActive(event.key === "Home" ? 0 : event.key === "End" ? anchors.length-1 :
      Math.max(0,Math.min(anchors.length-1,index+(event.key === "ArrowRight" ? 1 : -1))));
  }
  const time = rows[0]?.point.t;
  const sameTime = rows.every(r => utcTimestamp(r.point.t) === utcTimestamp(time));
  return <div className="time-series-chart">
    {cloneElement(children, {
      tabIndex: 0, role: "img", "aria-label": `${label}. Hover or use arrow keys to inspect time and values.`,
      "aria-describedby": rows.length ? id : undefined,
      onPointerMove: inspect, onPointerDown: inspect,
      onPointerLeave: e => { if (e.pointerType !== "touch" && document.activeElement !== e.currentTarget) setActive(null); },
      onFocus: () => { if (anchors.length) setActive(previous => previous ?? Math.floor(anchors.length/2)); },
      onBlur: () => setActive(null), onKeyDown: key,
    }, <>{children.props.children}{rows.length>0 && <g pointerEvents="none" aria-hidden="true">
      <line x1={x} x2={x} y1={0} y2={height} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3"/>
      {rows.map((r,i) => <circle key={i} cx={r.point.x} cy={r.point.y} r={3} fill={r.color ?? "var(--cyan)"} stroke="var(--surface)" strokeWidth={1}/>)}
    </g>}</>)}
    {rows.length>0 && <div id={id} role="status" className={`time-series-tooltip ${x/width>0.5 ? "align-right" : "align-left"}`}>
      <strong>{sameTime && time ? utcTimestamp(time) : label}</strong>
      {rows.map((r,i) => <div key={i} className="time-series-tooltip-row">
        <span><i style={{background:r.color ?? "var(--cyan)"}}/>{r.name}
          {!sameTime && r.point.t && <small>{utcTimestamp(r.point.t)}</small>}</span>
        <b>{r.point.v.toFixed(r.decimals ?? 3)} {r.unit ?? "m"}</b>
      </div>)}
    </div>}
  </div>;
}
