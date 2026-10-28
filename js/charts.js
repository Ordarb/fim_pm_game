// Kleine, abhängigkeitsfreie SVG-Diagramme für die FIM-Webapp.
// Läuft offline (keine CDN-Bibliothek). Spezifikation nach dataviz-Richtlinien:
// Hairline-Grid, 2px Linien, Punkte r>=4 mit 2px Surface-Ring, Balken <=24px mit
// 4px gerundetem Datenende, Tooltip pro Markierung, Hit-Area >= 24px.

const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function text(parent, x, y, str, attrs = {}) {
  const t = el("text", { x, y, ...attrs }, parent);
  t.textContent = str;
  return t;
}

// "Schöne" Achsenticks (1/2/5 x 10^n).
function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

// ---------------------------------------------------------------- Tooltip
const Tooltip = (() => {
  let box = null;
  function ensure() {
    if (!box) {
      box = document.createElement("div");
      box.className = "tooltip";
      box.setAttribute("role", "status");
      document.body.appendChild(box);
    }
    return box;
  }
  // rows: [{value, label, color}] - Wert führt, Label folgt.
  function show(evt, title, rows) {
    const b = ensure();
    b.replaceChildren();
    if (title) {
      const h = document.createElement("div");
      h.className = "tt-title";
      h.textContent = title;
      b.appendChild(h);
    }
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "tt-row";
      if (r.color) {
        const key = document.createElement("span");
        key.className = "tt-key";
        key.style.background = r.color;
        row.appendChild(key);
      }
      const v = document.createElement("strong");
      v.textContent = r.value;
      row.appendChild(v);
      if (r.label) {
        const l = document.createElement("span");
        l.className = "tt-label";
        l.textContent = r.label;
        row.appendChild(l);
      }
      b.appendChild(row);
    }
    b.style.display = "block";
    move(evt);
  }
  function move(evt) {
    if (!box) return;
    const pad = 14;
    let x, y;
    if (evt.clientX !== undefined && evt.type !== "focus") { x = evt.clientX; y = evt.clientY; }
    else { const r = evt.target.getBoundingClientRect(); x = r.right; y = r.top; }
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.min(x + pad, window.innerWidth - w - 8) + "px";
    box.style.top = Math.max(8, Math.min(y + pad, window.innerHeight - h - 8)) + "px";
  }
  function hide() { if (box) box.style.display = "none"; }
  return { show, move, hide };
})();

function bindTooltip(node, title, rows) {
  node.setAttribute("tabindex", "0");
  node.addEventListener("pointerenter", e => Tooltip.show(e, title, rows()));
  node.addEventListener("pointermove", e => Tooltip.move(e));
  node.addEventListener("pointerleave", Tooltip.hide);
  node.addEventListener("focus", e => Tooltip.show(e, title, rows()));
  node.addEventListener("blur", Tooltip.hide);
}

function frame(container, height) {
  container.replaceChildren();
  const width = Math.max(280, container.clientWidth || 600);
  const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "chart" }, container);
  return { svg, width, height };
}

// ---------------------------------------------------------------- Scatter
// opts: {points:[{x,y,color,title,rows:()=>[], id}], refs:[{x,y,label}], xLabel, yLabel,
//        xFmt, yFmt, height, highlight:id, onClick:(p)=>{}}
function scatter(container, opts) {
  const height = opts.height || 380;
  const { svg, width } = frame(container, height);
  const m = { l: 56, r: 16, t: 14, b: 44 };
  const pts = opts.points;
  const allX = pts.map(p => p.x).concat((opts.refs || []).map(r => r.x));
  const allY = pts.map(p => p.y).concat((opts.refs || []).map(r => r.y));
  const xs = niceTicks(Math.min(...allX), Math.max(...allX), Math.max(3, Math.floor(width / 110)));
  const ys = niceTicks(Math.min(...allY), Math.max(...allY), 5);
  const X = v => m.l + (v - xs.lo) / (xs.hi - xs.lo) * (width - m.l - m.r);
  const Y = v => height - m.b - (v - ys.lo) / (ys.hi - ys.lo) * (height - m.t - m.b);

  const grid = el("g", { class: "grid" }, svg);
  for (const t of ys.ticks) {
    el("line", { x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t) }, grid);
    text(grid, m.l - 8, Y(t) + 4, opts.yFmt(t), { class: "tick", "text-anchor": "end" });
  }
  for (const t of xs.ticks) {
    el("line", { x1: X(t), x2: X(t), y1: m.t, y2: height - m.b }, grid);
    text(grid, X(t), height - m.b + 18, opts.xFmt(t), { class: "tick", "text-anchor": "middle" });
  }
  text(svg, (m.l + width - m.r) / 2, height - 6, opts.xLabel, { class: "axis-label", "text-anchor": "middle" });
  text(svg, 14, (m.t + height - m.b) / 2, opts.yLabel,
    { class: "axis-label", "text-anchor": "middle", transform: `rotate(-90 14 ${(m.t + height - m.b) / 2})` });

  const layer = el("g", {}, svg);
  const sorted = [...pts].sort((a, b) => (a.id === opts.highlight) - (b.id === opts.highlight));
  for (const p of sorted) {
    const g = el("g", { class: "pt" + (opts.highlight && p.id !== opts.highlight ? " dim" : "") }, layer);
    el("circle", { cx: X(p.x), cy: Y(p.y), r: 12, class: "hit" }, g);
    el("circle", { cx: X(p.x), cy: Y(p.y), r: p.id === opts.highlight ? 7 : (p.r || 5),
      fill: p.color, class: "dot" }, g);
    bindTooltip(g, p.title, p.rows);
    if (opts.onClick) { g.style.cursor = "pointer"; g.addEventListener("click", () => opts.onClick(p)); }
  }
  for (const r of opts.refs || []) {
    const g = el("g", { class: "ref" }, svg);
    const cx = X(r.x), cy = Y(r.y), s = 7;
    el("rect", { x: cx - s, y: cy - s, width: 2 * s, height: 2 * s, transform: `rotate(45 ${cx} ${cy})`,
      class: "ref-mark" }, g);
    text(g, cx + 12, cy - 10, r.label, { class: "ref-label" });
    el("circle", { cx, cy, r: 12, class: "hit" }, g);
    bindTooltip(g, r.label, r.rows || (() => []));
  }
}

// ---------------------------------------------------------------- Histogram
// opts: {values, color, step, xFmt, ref:{value,label}, xLabel, height}
function histogram(container, opts) {
  const height = opts.height || 220;
  const { svg, width } = frame(container, height);
  const m = { l: 40, r: 16, t: 22, b: 40 };
  const vals = opts.values;
  const step = opts.step;
  const lo = Math.floor(Math.min(...vals, opts.ref ? opts.ref.value : Infinity) / step) * step;
  const hi = Math.ceil(Math.max(...vals, opts.ref ? opts.ref.value : -Infinity) / step + 1e-9) * step;
  const nb = Math.max(1, Math.round((hi - lo) / step));
  const bins = Array.from({ length: nb }, (_, i) => ({ a: lo + i * step, b: lo + (i + 1) * step, n: 0 }));
  for (const v of vals) bins[Math.min(nb - 1, Math.floor((v - lo) / step + 1e-9))].n++;
  const ys = niceTicks(0, Math.max(...bins.map(b => b.n)), 4);
  const X = v => m.l + (v - lo) / (hi - lo) * (width - m.l - m.r);
  const Y = v => height - m.b - v / ys.hi * (height - m.t - m.b);

  const grid = el("g", { class: "grid" }, svg);
  for (const t of ys.ticks) {
    el("line", { x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t) }, grid);
    text(grid, m.l - 8, Y(t) + 4, String(t), { class: "tick", "text-anchor": "end" });
  }
  const labelEvery = Math.ceil(nb / Math.max(2, Math.floor(width / 70)));
  bins.forEach((b, i) => {
    if (i % labelEvery === 0) text(grid, X(b.a), height - m.b + 18, opts.xFmt(b.a), { class: "tick", "text-anchor": "middle" });
  });
  text(svg, (m.l + width - m.r) / 2, height - 4, opts.xLabel, { class: "axis-label", "text-anchor": "middle" });
  el("line", { x1: m.l, x2: width - m.r, y1: Y(0), y2: Y(0), class: "baseline" }, svg);

  for (const b of bins) {
    if (!b.n) continue;
    const x0 = X(b.a) + 1, x1 = X(b.b) - 1, w = Math.max(1, x1 - x0);
    const g = el("g", { class: "bar" }, svg);
    el("rect", { x: x0, y: m.t, width: w, height: Y(0) - m.t, class: "hit-rect" }, g);
    el("path", { d: roundedTopBar(x0, Y(b.n), w, Y(0) - Y(b.n)), fill: opts.color }, g);
    bindTooltip(g, `${opts.xFmt(b.a)} – ${opts.xFmt(b.b)}`, () => [{ value: String(b.n), label: "Portfolios" }]);
  }
  if (opts.ref) {
    const x = X(opts.ref.value);
    el("line", { x1: x, x2: x, y1: m.t - 6, y2: Y(0), class: "ref-line" }, svg);
    text(svg, x + 4, m.t - 8, opts.ref.label, { class: "ref-label" });
  }
}

function roundedTopBar(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function roundedEndBar(x0, x1, y, h) {
  // horizontaler Balken von x0 (Basis, eckig) nach x1 (Datenende, gerundet)
  const dir = x1 >= x0 ? 1 : -1, len = Math.abs(x1 - x0);
  const r = Math.min(4, h / 2, len);
  if (len <= 0) return "";
  const xe = x1 - dir * r;
  return `M${x0},${y}H${xe}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${xe},${y + h}H${x0}Z`;
}

// ---------------------------------------------------------------- Grouped horizontal bars
// opts: {categories:[...], series:[{name,color,values:[]}], fmt, maxValue}
function groupedBars(container, opts) {
  const ns = opts.series.length;
  const barH = ns > 1 ? 10 : 14, gap = 2, groupPad = 12;
  const groupH = ns * barH + (ns - 1) * gap;
  const m = { l: Math.min(170, 12 + 7 * Math.max(...opts.categories.map(c => c.length))), r: 56, t: 6, b: 6 };
  const height = m.t + m.b + opts.categories.length * (groupH + groupPad);
  const { svg, width } = frame(container, height);
  const max = opts.maxValue || Math.max(...opts.series.flatMap(s => s.values), 1e-9);
  const X = v => m.l + v / max * (width - m.l - m.r);
  el("line", { x1: m.l, x2: m.l, y1: m.t, y2: height - m.b, class: "baseline" }, svg);
  opts.categories.forEach((cat, i) => {
    const y0 = m.t + i * (groupH + groupPad) + groupPad / 2;
    text(svg, m.l - 8, y0 + groupH / 2 + 4, cat, { class: "cat-label", "text-anchor": "end" });
    opts.series.forEach((s, j) => {
      const v = s.values[i] || 0, y = y0 + j * (barH + gap);
      const g = el("g", { class: "bar" }, svg);
      el("rect", { x: m.l, y: y - 1, width: width - m.l - m.r, height: barH + 2, class: "hit-rect" }, g);
      el("path", { d: roundedEndBar(m.l, X(v), y, barH), fill: s.color }, g);
      text(svg, X(v) + 6, y + barH - 1, opts.fmt(v), { class: "val-label" });
      bindTooltip(g, cat, () => opts.series.map(ss => ({ value: opts.fmt(ss.values[i] || 0), label: ss.name, color: ss.color })));
    });
  });
}

// ---------------------------------------------------------------- Ranking bars (können negativ sein)
// opts: {rows:[{id,label,value,color,rows:()=>[]}], ref:{value,label}, fmt, highlight, onClick}
function rankingBars(container, opts) {
  const barH = opts.barH || 10, gap = opts.barH ? 6 : 3;
  const m = { l: 128, r: 60, t: 44, b: 8 };
  const height = m.t + m.b + opts.rows.length * (barH + gap);
  const { svg, width } = frame(container, height);
  const vals = opts.rows.map(r => r.value).concat(opts.ref ? [opts.ref.value] : []);
  const ts = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), Math.max(3, Math.floor(width / 120)));
  const X = v => m.l + (v - ts.lo) / (ts.hi - ts.lo) * (width - m.l - m.r);
  const grid = el("g", { class: "grid" }, svg);
  for (const t of ts.ticks) {
    el("line", { x1: X(t), x2: X(t), y1: m.t - 4, y2: height - m.b }, grid);
    text(grid, X(t), m.t - 26, opts.fmt(t), { class: "tick", "text-anchor": "middle" });
  }
  el("line", { x1: X(0), x2: X(0), y1: m.t - 4, y2: height - m.b, class: "baseline" }, svg);
  opts.rows.forEach((r, i) => {
    const y = m.t + i * (barH + gap);
    const g = el("g", { class: "bar" + (opts.highlight && r.id !== opts.highlight ? " dim" : "") }, svg);
    el("rect", { x: 0, y: y - 1, width, height: barH + gap, class: "hit-rect" }, g);
    text(g, m.l - 8, y + barH - 1, r.label, { class: "cat-label small" + (r.id === opts.highlight ? " strong" : ""), "text-anchor": "end" });
    el("path", { d: roundedEndBar(X(0), X(r.value), y, barH), fill: r.color }, g);
    bindTooltip(g, r.label, r.rows);
    if (opts.onClick) { g.style.cursor = "pointer"; g.addEventListener("click", () => opts.onClick(r)); }
  });
  if (opts.ref) {
    const x = X(opts.ref.value);
    el("line", { x1: x, x2: x, y1: m.t - 14, y2: height - m.b, class: "ref-line" }, svg);
    text(svg, Math.min(x + 4, width - 4), m.t - 6, opts.ref.label,
      { class: "ref-label", "text-anchor": x > width - 120 ? "end" : "start" });
  }
}

// ---------------------------------------------------------------- Linien (Zeitreihen / Kurven)
// opts: {x:[labels], xFmt:(label)=>str, xNum: optional numerische x-Werte (z.B. Laufzeiten),
//        series:[{name,color,values,width,faint,dash}], yFmt, height, zeroLine, tooltipSeries:(i)=>rows}
function lines(container, opts) {
  const height = opts.height || 340;
  const { svg, width } = frame(container, height);
  const m = { l: 56, r: 92, t: 12, b: 34 };
  const n = opts.x.length;
  const xv = opts.xNum || opts.x.map((_, i) => i);
  const vals = opts.series.flatMap(s => s.values.filter(v => v != null));
  if (opts.zeroLine) vals.push(0);
  const ys = niceTicks(Math.min(...vals), Math.max(...vals), 5);
  const X = v => m.l + (v - xv[0]) / ((xv[n - 1] - xv[0]) || 1) * (width - m.l - m.r);
  const Y = v => height - m.b - (v - ys.lo) / (ys.hi - ys.lo) * (height - m.t - m.b);
  const grid = el("g", { class: "grid" }, svg);
  for (const t of ys.ticks) {
    el("line", { x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t) }, grid);
    text(grid, m.l - 8, Y(t) + 4, opts.yFmt(t), { class: "tick", "text-anchor": "end" });
  }
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - m.l - m.r) / 80))));
  for (let i = 0; i < n; i += every) text(grid, X(xv[i]), height - m.b + 18, opts.xFmt(opts.x[i]), { class: "tick", "text-anchor": "middle" });
  if (opts.zeroLine && ys.lo < 0) el("line", { x1: m.l, x2: width - m.r, y1: Y(0), y2: Y(0), class: "baseline" }, svg);
  const path = vals => vals.map((v, i) => v == null ? "" : `${i && vals[i - 1] != null ? "L" : "M"}${X(xv[i]).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const layer = el("g", {}, svg);
  const ordered = [...opts.series].sort((a, b) => (!!b.faint) - (!!a.faint));
  for (const s of ordered) {
    el("path", { d: path(s.values), fill: "none", stroke: s.color, "stroke-width": s.width || 2,
      "stroke-linejoin": "round", "stroke-linecap": "round", class: s.faint ? "line faint" : "line" }, layer);
  }
  // Endlabels nur für die hervorgehobenen Serien (sparsam), mit Kollisionsschutz
  let lastY = -Infinity;
  ordered.filter(s => s.label).map(s => ({ s, y: Y(s.values[s.values.length - 1]) })).sort((a, b) => a.y - b.y).forEach(({ s, y }) => {
    const yy = Math.max(y, lastY + 13); lastY = yy;
    el("circle", { cx: X(xv[n - 1]), cy: y, r: 4, fill: s.color, class: "dot" }, layer);
    text(layer, X(xv[n - 1]) + 8, yy + 4, s.label, { class: "val-label" });
  });
  // Fadenkreuz
  const cross = el("line", { y1: m.t, y2: height - m.b, class: "crosshair", visibility: "hidden" }, svg);
  const hit = el("rect", { x: m.l, y: m.t, width: width - m.l - m.r, height: height - m.t - m.b, class: "hit-rect", tabindex: 0 }, svg);
  const at = evt => {
    const r = svg.getBoundingClientRect();
    const px = (evt.clientX ?? r.left + width - m.r) - r.left;
    let best = 0;
    xv.forEach((v, i) => { if (Math.abs(X(v) - px) < Math.abs(X(xv[best]) - px)) best = i; });
    return best;
  };
  const show = evt => {
    const i = at(evt);
    cross.setAttribute("x1", X(xv[i])); cross.setAttribute("x2", X(xv[i])); cross.setAttribute("visibility", "visible");
    const rows = (opts.tooltipSeries ? opts.tooltipSeries(i) : opts.series.filter(s => !s.faint)
      .map(s => ({ value: s.values[i] == null ? "–" : opts.yFmt(s.values[i]), label: s.name, color: s.color })))
      .sort((a, b) => (b.sortValue ?? 0) - (a.sortValue ?? 0));
    Tooltip.show(evt, opts.xFmt(opts.x[i], true), rows);
  };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerenter", show);
  hit.addEventListener("focus", show);
  const hide = () => { cross.setAttribute("visibility", "hidden"); Tooltip.hide(); };
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("blur", hide);
}

// ---------------------------------------------------------------- Zinskurve + Veränderung (zwei Panels, eine x-Achse)
// opts: {tenors, from:[...], to:[...], fromLabel, toLabel, fromColor, toColor, upColor, downColor, height}
// Oben: Niveau beider Kurven (%), unten: Differenz in bp als Säulen ab Nulllinie. Zwei getrennte
// y-Achsen in getrennten Panels (keine Doppelachse im selben Plot).
function curveWithDelta(container, opts) {
  const height = opts.height || 420;
  const { svg, width } = frame(container, height);
  const m = { l: 56, r: 60, t: 12, b: 30 };
  const gap = 34, topH = (height - m.t - m.b - gap) * 0.62, botH = (height - m.t - m.b - gap) - topH;
  const top0 = m.t, bot0 = m.t + topH + gap;
  const T = opts.tenors;
  // x: Laufzeit auf Wurzelskala, damit kurze Laufzeiten nicht zusammengedrängt werden
  const sx = t => Math.sqrt(t);
  const X = t => m.l + (sx(t) - sx(T[0])) / (sx(T[T.length - 1]) - sx(T[0])) * (width - m.l - m.r);
  const lv = opts.from.concat(opts.to).filter(v => v != null);
  const ys = niceTicks(Math.min(...lv, 0), Math.max(...lv), 4);
  const Y = v => top0 + topH - (v - ys.lo) / (ys.hi - ys.lo) * topH;
  const d = T.map((_, i) => (opts.to[i] == null || opts.from[i] == null) ? null : (opts.to[i] - opts.from[i]) * 1e4);
  const dv = d.filter(v => v != null);
  const ds = niceTicks(Math.min(0, ...dv), Math.max(0, ...dv), 3);
  const YD = v => bot0 + botH - (v - ds.lo) / (ds.hi - ds.lo) * botH;

  const grid = el("g", { class: "grid" }, svg);
  for (const t of ys.ticks) {
    el("line", { x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t) }, grid);
    text(grid, m.l - 8, Y(t) + 4, (t * 100).toFixed(2) + "%", { class: "tick", "text-anchor": "end" });
  }
  for (const t of ds.ticks) {
    el("line", { x1: m.l, x2: width - m.r, y1: YD(t), y2: YD(t) }, grid);
    text(grid, m.l - 8, YD(t) + 4, (t > 0 ? "+" : "") + t + " bp", { class: "tick", "text-anchor": "end" });
  }
  el("line", { x1: m.l, x2: width - m.r, y1: YD(0), y2: YD(0), class: "baseline" }, svg);
  text(svg, m.l, top0 - 2 + 10, "", {});
  text(svg, m.l, bot0 - 10, "Veränderung (bp)", { class: "axis-label" });
  for (const t of T) text(grid, X(t), height - m.b + 18, `${t} J`, { class: "tick", "text-anchor": "middle" });

  const path = vals => vals.map((v, i) => v == null ? "" : `${i && vals[i - 1] != null ? "L" : "M"}${X(T[i]).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  el("path", { d: path(opts.from), fill: "none", stroke: opts.fromColor, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  el("path", { d: path(opts.to), fill: "none", stroke: opts.toColor, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  const lastI = T.length - 1;
  const ends = [[opts.from[lastI], opts.fromLabel, opts.fromColor], [opts.to[lastI], opts.toLabel, opts.toColor]].sort((a, b) => Y(a[0]) - Y(b[0]));
  let prev = -Infinity;
  for (const [v, label, color] of ends) {
    const y = Math.max(Y(v), prev + 13); prev = y;
    el("circle", { cx: X(T[lastI]), cy: Y(v), r: 4, fill: color, class: "dot" }, svg);
    text(svg, X(T[lastI]) + 8, y + 4, label, { class: "val-label" });
  }
  const bw = Math.min(18, (width - m.l - m.r) / T.length * 0.5);
  T.forEach((t, i) => {
    if (d[i] == null) return;
    const g = el("g", { class: "bar" }, svg);
    el("rect", { x: X(t) - 14, y: top0, width: 28, height: height - m.b - top0, class: "hit-rect" }, g);
    const y0 = YD(0), y1 = YD(d[i]);
    const hgt = Math.abs(y1 - y0);
    if (hgt > 0.5) {
      // gerundetes Datenende, eckig an der Nulllinie
      const r = Math.min(4, hgt, bw / 2), x = X(t) - bw / 2;
      const p = d[i] >= 0
        ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + r}V${y0}Z`
        : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 - r}V${y0}Z`;
      el("path", { d: p, fill: d[i] >= 0 ? opts.upColor : opts.downColor }, g);
    }
    el("circle", { cx: X(t), cy: Y(opts.to[i]), r: 3, fill: opts.toColor, class: "dot" }, g);
    bindTooltip(g, `${t} Jahre`, () => [
      { value: (d[i] >= 0 ? "+" : "−") + Math.abs(d[i]).toFixed(1) + " bp", label: "Veränderung" },
      { value: (opts.from[i] * 100).toFixed(3) + "%", label: opts.fromLabel, color: opts.fromColor },
      { value: (opts.to[i] * 100).toFixed(3) + "%", label: opts.toLabel, color: opts.toColor }]);
  });
}

window.Charts = { scatter, histogram, groupedBars, rankingBars, lines, curveWithDelta, Tooltip };
