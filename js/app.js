// FIM Portfoliomanagement-Spiel - Auswertungen der eingereichten Portfolios.
// Daten: window.GAME_DATA aus data/game_data.js (grading/src/export_webapp.py).
// Alle Kennzahlen werden hier aus Bond-Stammdaten + Gewichten berechnet.

(() => {
  const D = window.GAME_DATA;
  const $ = s => document.querySelector(s);
  const app = $("#app");
  if (!D) {
    app.innerHTML = "<p class='empty'>Keine Daten gefunden. Bitte zuerst <code>python grading/src/export_webapp.py</code> ausführen.</p>";
    return;
  }

  const SBI = D.meta.benchmark;
  const BONDS = Object.fromEntries(D.bonds.map(b => [b.isin, b]));
  // Grösste Kohorte zuerst -> sie erhält Farbslot 1 (feste Zuordnung, unabhängig vom Filter)
  const TEAMS = [...new Set(D.participants.map(p => p.team))]
    .sort((a, b) => D.participants.filter(p => p.team === b).length - D.participants.filter(p => p.team === a).length);
  const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();
  const teamColor = t => css(`--series-${TEAMS.indexOf(t) + 1}`);

  // ------------------------------------------------------------ Formatierung
  const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
  const pp = (v, d = 2) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d) + "%";
  const num = (v, d = 2) => v.toFixed(d);
  const RATING_NAMES = ["", "AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-"];
  const ratingName = v => RATING_NAMES[Math.round(v)] || "–";

  // ------------------------------------------------------------ Buckets
  const ratingBucket = n => n <= 1 ? "AAA" : n <= 4 ? "AA" : n <= 7 ? "A" : "BBB";
  const RATING_BUCKETS = ["AAA", "AA", "A", "BBB"];
  const MAT_BUCKETS = [["0–3 J.", 3], ["3–5 J.", 5], ["5–7 J.", 7], ["7–10 J.", 10], ["10–15 J.", 15], ["> 15 J.", 1e9]];
  const matBucket = y => MAT_BUCKETS.find(([, hi]) => y < hi)[0];
  const SECTORS = [...new Set(D.bonds.map(b => b.sektor))];

  // ------------------------------------------------------------ Portfolio-Kennzahlen
  function metrics(positions) {
    const w = Object.entries(positions).map(([isin, wt]) => [BONDS[isin], wt / 100]);
    const tot = w.reduce((s, [, x]) => s + x, 0) || 1;
    const avg = f => w.reduce((s, [b, x]) => s + f(b) * x, 0) / tot;
    const share = (key, buckets) => {
      const out = Object.fromEntries(buckets.map(k => [k, 0]));
      for (const [b, x] of w) out[key(b)] = (out[key(b)] || 0) + x / tot;
      return out;
    };
    return {
      n: w.length,
      duration: avg(b => b.duration), ytm: avg(b => b.ytm), spread: avg(b => b.spread),
      dts: avg(b => b.duration * b.spread),  // Duration Times Spread (Spreadsensitivität)
      coupon: avg(b => b.coupon), rating: avg(b => b.rating_num),
      esg: avg(b => b.nachhaltig ? 1 : 0), laufzeit: avg(b => b.laufzeit),
      sector: share(b => b.sektor, SECTORS),
      ratingMix: share(b => ratingBucket(b.rating_num), RATING_BUCKETS),
      maturity: share(b => matBucket(b.laufzeit), MAT_BUCKETS.map(m => m[0])),
      country: share(b => b.land, []),
    };
  }
  const PEOPLE = D.participants.map(p => ({ ...p, m: metrics(p.positions) }));

  function state0() { try { return JSON.parse(localStorage.getItem("fim-state") || "{}"); } catch { return {}; } }
  // Mit Namen exportiert -> Namen standardmässig anzeigen (lässt sich per Häkchen ausblenden)
  const state = Object.assign({ view: "overview", team: "", names: !!D.meta.with_names, selected: PEOPLE[0].id,
    sc: { dy: 0, dsAA: 0, dsA: 0, dsBBB: 0, h: 4 } }, state0());
  const save = () => { try { localStorage.setItem("fim-state", JSON.stringify(state)); } catch { /* egal */ } };
  const displayName = p => (D.meta.with_names && state.names && p.name) ? p.name : p.alias;
  const visible = () => PEOPLE.filter(p => !state.team || p.team === state.team);
  const mean = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0;

  // ------------------------------------------------------------ Szenario
  // Rendite über den Horizont ≈ Carry (YTM × h) − Duration × ΔZins − Spread-Duration × ΔSpread.
  // Spread-Duration ≈ Mod. Duration; Eidgenossen (Treasury) ohne Spreadänderung.
  function bondScenario(b, sc) {
    const ds = b.sektor === "Treasury" ? 0 : { AAA: sc.dsAA, AA: sc.dsAA, A: sc.dsA, BBB: sc.dsBBB }[ratingBucket(b.rating_num)];
    return { carry: b.ytm * sc.h / 12, zins: -b.duration * sc.dy / 1e4, kredit: -b.duration * ds / 1e4 };
  }
  function scenario(positions, sc) {
    const out = { carry: 0, zins: 0, kredit: 0 };
    const tot = Object.values(positions).reduce((s, x) => s + x, 0) || 1;
    for (const [isin, wt] of Object.entries(positions)) {
      const r = bondScenario(BONDS[isin], sc);
      for (const k in out) out[k] += r[k] * wt / tot;
    }
    out.total = out.carry + out.zins + out.kredit;
    return out;
  }
  // SBI: nur Aggregatkennzahlen bekannt -> Spreadänderung wie AAA/AA (SBI-Rating A+, Spread 49 bp).
  function sbiScenario(sc) {
    const r = { carry: SBI.ytm * sc.h / 12, zins: -SBI.duration * sc.dy / 1e4, kredit: -SBI.duration * sc.dsAA / 1e4 };
    r.total = r.carry + r.zins + r.kredit;
    return r;
  }
  const PRESETS = [
    ["Basisfall: alles stabil", { dy: 0, dsAA: 0, dsA: 0, dsBBB: 0 }],
    ["Zinsanstieg +50 bp", { dy: 50, dsAA: 0, dsA: 0, dsBBB: 0 }],
    ["Zinsrückgang −30 bp", { dy: -30, dsAA: 0, dsA: 0, dsBBB: 0 }],
    ["Risk-off (Flucht in Qualität)", { dy: -30, dsAA: 10, dsA: 40, dsBBB: 80 }],
    ["Stagflation", { dy: 50, dsAA: 10, dsA: 30, dsBBB: 60 }],
    ["Spread-Rally", { dy: 0, dsAA: -5, dsA: -15, dsBBB: -25 }],
  ];

  // ------------------------------------------------------------ Bausteine
  function h(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  const tile = (label, value, sub) => h("div", { class: "tile" }, h("span", { class: "tile-label" }, label),
    h("b", { class: "tile-value" }, value), sub ? h("span", { class: "tile-sub" }, sub) : null);
  const card = (title, subtitle, body, extra) => h("section", { class: "card" },
    h("h2", {}, title), subtitle ? h("p", { class: "card-sub" }, subtitle) : null, body, extra || null);
  const chartBox = () => h("div", { class: "chart-box" });
  const legend = items => h("div", { class: "legend" }, items.map(([name, color, shape]) =>
    h("span", { class: "legend-item" }, h("span", { class: "legend-key " + (shape || "dot"), style: color ? `background:${color}` : "" }), name)));
  function table(cols, rows, opts = {}) {
    // cols: [{key,label,fmt,num}] - sortierbar per Klick
    let sortKey = opts.sortKey || cols[0].key, asc = opts.asc ?? true;
    const wrap = h("div", { class: "table-wrap" });
    const render = () => {
      const sorted = [...rows].sort((a, b) => {
        const x = a[sortKey], y = b[sortKey];
        return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "de")) * (asc ? 1 : -1);
      });
      wrap.replaceChildren(h("table", {},
        h("thead", {}, h("tr", {}, cols.map(c => h("th", {
          class: (c.num ? "num " : "") + (c.key === sortKey ? (asc ? "sorted asc" : "sorted") : ""),
          onclick: () => { asc = sortKey === c.key ? !asc : !c.num; sortKey = c.key; render(); },
        }, c.label)))),
        h("tbody", {}, sorted.map(r => h("tr", { class: opts.rowClass ? opts.rowClass(r) : "" },
          cols.map(c => h("td", { class: c.num ? "num" : "" }, c.fmt ? c.fmt(r[c.key], r) : r[c.key])))))));
    };
    render();
    return wrap;
  }
  const asTable = (cols, rows, opts) => h("details", { class: "as-table" }, h("summary", {}, "Als Tabelle anzeigen"), table(cols, rows, opts));

  // Diagramme werden nach dem Einfügen ins DOM gezeichnet (Breite bekannt) und bei Resize neu.
  let drawers = [];
  const draw = (box, fn) => { drawers.push(() => fn(box)); return box; };
  window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => drawers.forEach(f => f()), 120); });

  // ------------------------------------------------------------ Ansicht: Überblick
  function viewOverview() {
    const ps = visible();
    const longer = ps.filter(p => p.m.duration > SBI.duration).length;
    const beatYtm = ps.filter(p => p.m.ytm > SBI.ytm).length;
    const tiles = h("div", { class: "tiles" },
      tile("Portfolios", String(ps.length), state.team || TEAMS.map(t => `${PEOPLE.filter(p => p.team === t).length} ${t}`).join(" · ")),
      tile("Ø Modified Duration", num(mean(ps, p => p.m.duration)), `SBI ${num(SBI.duration)} · ${longer} länger als SBI`),
      tile("Ø Verfallsrendite", pct(mean(ps, p => p.m.ytm), 2), `SBI ${pct(SBI.ytm, 2)} · ${beatYtm} von ${ps.length} darüber`),
      tile("Ø Kreditspread", num(mean(ps, p => p.m.spread), 0) + " bp", `SBI ${SBI.spread} bp`),
      tile("Ø DTS (Duration × Spread)", num(mean(ps, p => p.m.dts), 0),
        `SBI ${num(SBI.duration * SBI.spread, 0)} · ${ps.filter(p => p.m.dts > SBI.duration * SBI.spread).length} von ${ps.length} darüber`),
      tile("Ø Rating", ratingName(mean(ps, p => p.m.rating)), `Score ${num(mean(ps, p => p.m.rating))} · SBI ${ratingName(SBI.rating)}`),
      tile("Ø Anzahl Bonds", num(mean(ps, p => p.m.n), 1), `Spanne ${Math.min(...ps.map(p => p.m.n))}–${Math.max(...ps.map(p => p.m.n))}`),
    );
    const teamsShown = state.team ? [state.team] : TEAMS;
    const scat = draw(chartBox(), box => Charts.scatter(box, {
      points: ps.map(p => ({ id: p.id, x: p.m.duration, y: p.m.ytm, color: teamColor(p.team), title: displayName(p),
        rows: () => [{ value: num(p.m.duration), label: "Mod. Duration" }, { value: pct(p.m.ytm, 2), label: "YTM" },
          { value: num(p.m.spread, 0) + " bp", label: "Spread" }, { value: p.team, label: "" }] })),
      refs: [{ x: SBI.duration, y: SBI.ytm, label: "SBI", rows: () => [{ value: num(SBI.duration), label: "Duration" }, { value: pct(SBI.ytm, 2), label: "YTM" }] }],
      xLabel: "Modified Duration", yLabel: "Verfallsrendite", xFmt: v => num(v, 0), yFmt: v => pct(v, 1),
      onClick: p => { state.selected = p.id; state.view = "profile"; save(); render(); },
    }));
    const cols = [{ key: "name", label: "Portfolio" }, { key: "team", label: "Kohorte" },
      { key: "duration", label: "Duration", num: true, fmt: v => num(v) }, { key: "ytm", label: "YTM", num: true, fmt: v => pct(v, 2) },
      { key: "spread", label: "Spread", num: true, fmt: v => num(v, 0) }];
    const rows = ps.map(p => ({ name: displayName(p), team: p.team, duration: p.m.duration, ytm: p.m.ytm, spread: p.m.spread }));
    const histD = draw(chartBox(), box => Charts.histogram(box, { values: ps.map(p => p.m.duration), step: 1, color: css("--series-1"),
      xFmt: v => num(v, 0), xLabel: "Modified Duration", ref: { value: SBI.duration, label: "SBI 7.04" } }));
    const sbiDts = SBI.duration * SBI.spread;
    const histS = draw(chartBox(), box => Charts.histogram(box, { values: ps.map(p => p.m.dts), step: 100, color: css("--series-1"),
      xFmt: v => num(v, 0), xLabel: "DTS (Duration × Spread)", ref: { value: sbiDts, label: `SBI ${num(sbiDts, 0)}` } }));
    return [tiles,
      card("Risiko-Rendite-Karte", "Jeder Punkt ein Portfolio: Zinsrisiko (Duration) gegen Verfallsrendite. Rechts oben = mehr Rendite, aber mehr Zinsrisiko. Klick öffnet das Profil.",
        h("div", {}, legend(teamsShown.map(t => [t, teamColor(t)]).concat([["SBI (Benchmark)", "", "diamond"]])), scat), asTable(cols, rows, { sortKey: "ytm", asc: false })),
      h("div", { class: "grid-2" },
        card("Wie lang ist die Duration?", "Verteilung der Modified Duration. Links vom SBI = defensiv bei Zinsanstieg.", histD),
        card("Wie viel Kreditrisiko?", "Verteilung der DTS (Duration × Spread). Rechts vom SBI = mehr Kreditrisiko: Das Portfolio verliert bei einer Spreadausweitung stärker.", histS)),
    ];
  }

  // ------------------------------------------------------------ Ansicht: Positionierung
  function viewPositioning() {
    const teamsShown = state.team ? [state.team] : TEAMS;
    const avgShare = (team, key, cats) => cats.map(c => mean(PEOPLE.filter(p => p.team === team), p => p.m[key][c] || 0));
    const block = (title, sub, key, cats) => {
      const series = teamsShown.map(t => ({ name: t, color: teamColor(t), values: avgShare(t, key, cats) }));
      const box = draw(chartBox(), b => Charts.groupedBars(b, { categories: cats, series, fmt: v => pct(v, 0) }));
      const rows = cats.map((c, i) => Object.fromEntries([["cat", c], ...series.map(s => [s.name, s.values[i]])]));
      return card(title, sub, h("div", {}, teamsShown.length > 1 ? legend(teamsShown.map(t => [t, teamColor(t), "rect"])) : null, box),
        asTable([{ key: "cat", label: "Kategorie" }, ...series.map(s => ({ key: s.name, label: s.name, num: true, fmt: v => pct(v, 1) }))], rows));
    };
    const countries = Object.entries(PEOPLE.reduce((acc, p) => { for (const [k, v] of Object.entries(p.m.country)) acc[k] = (acc[k] || 0) + v; return acc; }, {}))
      .sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 8);
    // Konsens-Portfolio: Durchschnittsgewicht je Bond über alle sichtbaren Portfolios
    const ps = visible();
    const cons = D.bonds.map(b => {
      const held = ps.filter(p => p.positions[b.isin]);
      return { name: b.name, rating: b.rating, sektor: b.sektor, ytm: b.ytm, duration: b.duration,
        holders: held.length, avgw: mean(ps, p => (p.positions[b.isin] || 0) / 100) };
    }).filter(r => r.holders).sort((a, b) => b.avgw - a.avgw);
    const consPos = Object.fromEntries(D.bonds.map(b => [b.isin, mean(ps, p => p.positions[b.isin] || 0)]));
    const cm = metrics(Object.fromEntries(Object.entries(consPos).filter(([, v]) => v > 0)));
    return [
      h("div", { class: "tiles" },
        tile("Konsens-Portfolio: Duration", num(cm.duration), `SBI ${num(SBI.duration)}`),
        tile("Konsens: YTM", pct(cm.ytm, 2), `SBI ${pct(SBI.ytm, 2)}`),
        tile("Konsens: Spread", num(cm.spread, 0) + " bp", `SBI ${SBI.spread} bp`),
        tile("Konsens: Bonds gehalten", String(cons.length), `von ${D.bonds.length} im Universum`)),
      h("p", { class: "note" }, "Konsens-Portfolio = Durchschnitt aller Gewichte der gewählten Kohorte – so sähe das Portfolio der ganzen Klasse aus."),
      h("div", { class: "grid-2" },
        block("Sektoren", "Ø Anteil am Portfolio. Corporate-Limite 70%.", "sector", SECTORS),
        block("Ratingklassen", "Ø Anteil nach Rating (AA inkl. AA+/AA−, usw.).", "ratingMix", RATING_BUCKETS),
        block("Laufzeitbänder", "Ø Anteil nach Restlaufzeit.", "maturity", MAT_BUCKETS.map(m => m[0])),
        block("Länder", "Ø Anteil der 8 grössten Länder. Limite 10% pro Land ausser CH.", "country", countries)),
      card("Die Lieblinge der Klasse", "Bonds mit dem höchsten Durchschnittsgewicht im Konsens-Portfolio.",
        table([{ key: "name", label: "Bond" }, { key: "rating", label: "Rating" }, { key: "sektor", label: "Sektor" },
          { key: "ytm", label: "YTM", num: true, fmt: v => pct(v, 2) }, { key: "duration", label: "Duration", num: true, fmt: v => num(v) },
          { key: "holders", label: "gehalten von", num: true }, { key: "avgw", label: "Ø Gewicht", num: true, fmt: v => pct(v, 2) }],
          cons.slice(0, 15), { sortKey: "avgw", asc: false })),
    ];
  }

  // ------------------------------------------------------------ Ansicht: Szenario-Rangliste
  function viewScenario() {
    const sc = state.sc;
    const ps = visible();
    const res = ps.map(p => ({ p, r: scenario(p.positions, sc) })).sort((a, b) => b.r.total - a.r.total);
    const sbi = sbiScenario(sc);
    const beat = res.filter(x => x.r.total > sbi.total).length;
    const slider = (key, label, min, max, stepv, unit) => {
      const out = h("output", {}, `${sc[key] > 0 && unit === "bp" ? "+" : ""}${sc[key]} ${unit}`);
      const input = h("input", { type: "range", min, max, step: stepv, value: sc[key], "aria-label": label,
        oninput: e => { sc[key] = +e.target.value; save(); render(); } });
      return h("label", { class: "slider" }, h("span", {}, label), input, out);
    };
    const controls = h("div", { class: "scenario-controls" },
      h("div", { class: "presets" }, PRESETS.map(([name, p]) => h("button", { type: "button",
        class: Object.entries(p).every(([k, v]) => sc[k] === v) ? "active" : "",
        onclick: () => { Object.assign(sc, p); save(); render(); } }, name))),
      h("div", { class: "sliders" },
        slider("dy", "Zinsänderung (parallel)", -100, 100, 5, "bp"),
        slider("dsAA", "Spread AAA/AA", -50, 150, 5, "bp"),
        slider("dsA", "Spread A", -50, 150, 5, "bp"),
        slider("dsBBB", "Spread BBB", -50, 200, 5, "bp"),
        slider("h", "Horizont", 1, 12, 1, "Mt.")));
    const teamAvg = TEAMS.filter(t => !state.team || t === state.team).map(t =>
      tile(`Ø ${t}`, pp(mean(res.filter(x => x.p.team === t), x => x.r.total)), `${res.filter(x => x.p.team === t && x.r.total > sbi.total).length} schlagen den SBI`));
    const bars = draw(chartBox(), box => Charts.rankingBars(box, {
      rows: res.map((x, i) => ({ id: x.p.id, label: `${i + 1}. ${displayName(x.p)}`, value: x.r.total, color: teamColor(x.p.team),
        rows: () => [{ value: pp(x.r.total), label: "Total" }, { value: pp(x.r.carry), label: "Carry (YTM)" },
          { value: pp(x.r.zins), label: "Zinseffekt" }, { value: pp(x.r.kredit), label: "Krediteffekt" }, { value: x.p.team, label: "" }] })),
      ref: { value: sbi.total, label: `SBI ${pp(sbi.total)}` }, fmt: v => pp(v, 1), highlight: null,
      onClick: r => { state.selected = r.id; state.view = "profile"; save(); render(); },
    }));
    const cols = [{ key: "rank", label: "#", num: true }, { key: "name", label: "Portfolio" }, { key: "team", label: "Kohorte" },
      { key: "carry", label: "Carry", num: true, fmt: v => pp(v) }, { key: "zins", label: "Zins", num: true, fmt: v => pp(v) },
      { key: "kredit", label: "Kredit", num: true, fmt: v => pp(v) }, { key: "total", label: "Total", num: true, fmt: v => pp(v) },
      { key: "vsSBI", label: "vs. SBI", num: true, fmt: v => pp(v) }];
    const rows = res.map((x, i) => ({ rank: i + 1, name: displayName(x.p), team: x.p.team, ...x.r, vsSBI: x.r.total - sbi.total }));
    return [
      card("Was wäre, wenn …?", "Geschätzte Rendite jedes Portfolios über den Horizont: Carry (YTM × Zeit) − Duration × Zinsänderung − Duration × Spreadänderung (je Ratingklasse). Eidgenossen ohne Spreadänderung; der SBI erhält die AAA/AA-Spreadänderung. Erste Näherung ohne Konvexität und Roll-down.", controls),
      h("div", { class: "tiles" },
        tile("SBI im Szenario", pp(sbi.total), `Carry ${pp(sbi.carry)} · Zins ${pp(sbi.zins)} · Kredit ${pp(sbi.kredit)}`),
        tile("schlagen den SBI", `${beat} von ${res.length}`, pct(beat / res.length, 0)),
        tile("Bestes Portfolio", pp(res[0].r.total), displayName(res[0].p)), ...teamAvg),
      card("Rangliste im Szenario", "Balken = geschätzte Gesamtrendite, Linie = SBI. Hover zeigt die Zerlegung, Klick öffnet das Profil.",
        h("div", {}, state.team ? null : legend(TEAMS.map(t => [t, teamColor(t), "rect"])), bars), asTable(cols, rows, { sortKey: "rank" })),
    ];
  }

  // ------------------------------------------------------------ Ansicht: Profil
  function viewProfile() {
    const p = PEOPLE.find(x => x.id === state.selected) || PEOPLE[0];
    const peers = PEOPLE;
    const avgM = k => mean(peers, x => x.m[k]);
    const rankOf = (k, desc = true) => 1 + peers.filter(x => desc ? x.m[k] > p.m[k] : x.m[k] < p.m[k]).length;
    const select = h("select", { "aria-label": "Portfolio wählen", onchange: e => { state.selected = e.target.value; save(); render(); } },
      [...PEOPLE].sort((a, b) => displayName(a).localeCompare(displayName(b), "de")).map(x =>
        h("option", { value: x.id, selected: x.id === p.id ? "" : null }, `${displayName(x)} (${x.team})`)));
    const cmp = (label, v, crowd, sbi, fmt, rank) => tile(label, fmt(v), `Klasse ${fmt(crowd)} · SBI ${fmt(sbi)}${rank ? ` · Rang ${rank}/${peers.length}` : ""}`);
    const exposure = (title, key, cats) => {
      const series = [{ name: displayName(p), color: teamColor(p.team), values: cats.map(c => p.m[key][c] || 0) },
        { name: "Ø Klasse", color: css("--neutral-series"), values: cats.map(c => mean(peers, x => x.m[key][c] || 0)) }];
      return card(title, null, h("div", {}, legend(series.map(s => [s.name, s.color, "rect"])),
        draw(chartBox(), b => Charts.groupedBars(b, { categories: cats, series, fmt: v => pct(v, 0) }))));
    };
    const scat = draw(chartBox(), box => Charts.scatter(box, {
      points: peers.map(x => ({ id: x.id, x: x.m.duration, y: x.m.ytm, color: teamColor(x.team), title: displayName(x),
        rows: () => [{ value: num(x.m.duration), label: "Duration" }, { value: pct(x.m.ytm, 2), label: "YTM" }] })),
      refs: [{ x: SBI.duration, y: SBI.ytm, label: "SBI" }], highlight: p.id, height: 300,
      xLabel: "Modified Duration", yLabel: "Verfallsrendite", xFmt: v => num(v, 0), yFmt: v => pct(v, 1),
      onClick: x => { state.selected = x.id; save(); render(); },
    }));
    const pos = Object.entries(p.positions).map(([isin, w]) => ({ ...BONDS[isin], w: w / 100,
      holders: peers.filter(x => x.positions[isin]).length })).sort((a, b) => b.w - a.w);
    const res = scenario(p.positions, state.sc), sbi = sbiScenario(state.sc);
    const allRes = peers.map(x => scenario(x.positions, state.sc).total);
    const scRank = 1 + allRes.filter(v => v > res.total).length;
    return [
      h("div", { class: "profile-head" }, select, h("span", { class: "muted" }, p.team)),
      h("div", { class: "tiles" },
        cmp("Modified Duration", p.m.duration, avgM("duration"), SBI.duration, v => num(v)),
        cmp("Verfallsrendite", p.m.ytm, avgM("ytm"), SBI.ytm, v => pct(v, 2), rankOf("ytm")),
        cmp("Kreditspread", p.m.spread, avgM("spread"), SBI.spread, v => num(v, 0) + " bp"),
        cmp("DTS (Duration × Spread)", p.m.dts, avgM("dts"), SBI.duration * SBI.spread, v => num(v, 0), rankOf("dts")),
        cmp("Rating (Score)", p.m.rating, avgM("rating"), SBI.rating, v => `${ratingName(v)} (${num(v)})`),
        tile("Coupon / Nachhaltigkeit", `${pct(p.m.coupon, 2)} · ${pct(p.m.esg, 0)}`, "Ziel ≥ 2% · Minimum 60%"),
        tile("Aktuelles Szenario", pp(res.total), `Rang ${scRank}/${peers.length} · SBI ${pp(sbi.total)}`)),
      ...profilePerformance(p),
      card("Wo steht das Portfolio?", "Hervorgehoben im Feld aller Portfolios.", scat),
      h("div", { class: "grid-2" },
        exposure("Sektoren vs. Klasse", "sector", SECTORS),
        exposure("Ratingklassen vs. Klasse", "ratingMix", RATING_BUCKETS),
        exposure("Laufzeitbänder vs. Klasse", "maturity", MAT_BUCKETS.map(m => m[0]))),
      card(`Positionen (${pos.length})`, "„gehalten von“ = wie viele Portfolios denselben Bond haben – tiefe Zahl = eigenständige Wahl.",
        table([{ key: "name", label: "Bond" }, { key: "rating_num", label: "Rating", num: true, fmt: (v, r) => r.rating }, { key: "sektor", label: "Sektor" },
          { key: "land", label: "Land" }, { key: "ytm", label: "YTM", num: true, fmt: v => pct(v, 2) }, { key: "spread", label: "Spread", num: true },
          { key: "duration", label: "Duration", num: true, fmt: v => num(v) }, { key: "w", label: "Gewicht", num: true, fmt: v => pct(v, 1) },
          { key: "holders", label: "gehalten von", num: true }], pos, { sortKey: "w", asc: false })),
    ];
  }

  // ------------------------------------------------------------ Ansicht: Performance (realisiert)
  const PERF = D.performance;
  const dateFmt = (iso, long) => { const [y, mo, d] = iso.split("-"); return long ? `${d}.${mo}.${y}` : `${d}.${mo}.`; };
  const perfOf = p => PERF && PERF.participants[p.id];
  const bp = v => (v >= 0 ? "+" : "−") + Math.abs(v * 1e4).toFixed(0) + " bp";
  const r2 = v => v == null ? "–" : v.toFixed(2);

  function perfBanner() {
    if (!PERF) return null;
    return PERF.demo ? h("div", { class: "demo-banner" }, "DEMO-DATEN: synthetische Kurse zum Testen – keine echte Performance.")
      : h("p", { class: "note" }, `Kurse ${dateFmt(PERF.start, true)} – ${dateFmt(PERF.end, true)} · Quelle ${PERF.source}`);
  }

  function viewPerformance() {
    const avgLabel = t => PEOPLE.filter(p => p.team === t).length > 1 ? `Ø ${t}` : t;
    if (!PERF) return [card("Noch keine Marktdaten", "Sobald das Marktdaten-Excel (OneDrive: 2026\\Marktdaten) mit Preisen und SBI befüllt ist, " +
      "erscheint hier die Rangliste. Update: python grading/src/export_webapp.py", null)];
    const ps = visible().filter(perfOf);
    const last = a => a[a.length - 1];
    const sbi = last(PERF.sbi.cum);
    const res = ps.map(p => ({ p, r: perfOf(p) })).sort((a, b) => last(b.r.cum) - last(a.r.cum));
    const beat = res.filter(x => last(x.r.cum) > sbi).length;
    const sel = PEOPLE.find(x => x.id === state.selected);
    const teamsShown = state.team ? [state.team] : TEAMS;
    const avgSeries = t => PERF.dates.map((_, i) => mean(res.filter(x => x.p.team === t), x => x.r.cum[i]));
    const series = [
      ...res.map(x => ({ name: displayName(x.p), color: css("--neutral-series"), values: x.r.cum, width: 1, faint: true })),
      ...teamsShown.map(t => ({ name: avgLabel(t), color: teamColor(t), values: avgSeries(t), width: 2.5, label: avgLabel(t) })),
      { name: "SBI", color: css("--text-primary"), values: PERF.sbi.cum, width: 2, label: "SBI" },
    ];
    if (sel && perfOf(sel) && (!state.team || sel.team === state.team))
      series.push({ name: displayName(sel), color: css("--accent-2"), values: perfOf(sel).cum, width: 2.5, label: displayName(sel) });
    const lineBox = draw(chartBox(), box => Charts.lines(box, {
      x: PERF.dates, xFmt: dateFmt, series, yFmt: v => pct(v, 1), zeroLine: true, height: 360,
      tooltipSeries: i => series.filter(s => !s.faint).map(s => ({ value: pp(s.values[i]), label: s.name, color: s.color, sortValue: s.values[i] }))
        .concat([{ value: `${res.filter(x => x.r.cum[i] > PERF.sbi.cum[i]).length} von ${res.length}`, label: "über dem SBI" }]),
    }));
    const bars = draw(chartBox(), box => Charts.rankingBars(box, {
      rows: res.map((x, i) => ({ id: x.p.id, label: `${i + 1}. ${displayName(x.p)}`, value: last(x.r.cum), color: teamColor(x.p.team),
        rows: () => [{ value: pp(last(x.r.cum)), label: "Rendite" }, { value: pp(last(x.r.carry) + last(x.r.zins)), label: "Zinsrendite" },
          { value: pp(last(x.r.kredit)), label: "Spreadrendite" },
          { value: bp(x.r.metrics.ueberrendite), label: "vs. SBI" }, { value: x.p.team, label: "" }] })),
      ref: { value: sbi, label: `SBI ${pp(sbi)}` }, fmt: v => pp(v, 1), highlight: null,
      onClick: r => { state.selected = r.id; state.view = "profile"; save(); render(); },
    }));
    const cols = [{ key: "rank", label: "#", num: true }, { key: "name", label: "Portfolio" }, { key: "team", label: "Kohorte" },
      { key: "rendite", label: "Rendite", num: true, fmt: v => pp(v) }, { key: "rendite_ann", label: "annualisiert", num: true, fmt: v => pp(v, 1) },
      { key: "vol", label: "Vola p.a.", num: true, fmt: v => pct(v, 2) }, { key: "sharpe", label: "Sharpe", num: true, fmt: r2 },
      { key: "ueberrendite", label: "vs. SBI", num: true, fmt: bp }, { key: "te", label: "Tracking Error", num: true, fmt: v => pct(v, 2) },
      { key: "ir", label: "Information Ratio", num: true, fmt: r2 },
      { key: "zins", label: "Zinsrendite", num: true, fmt: v => pp(v) }, { key: "kredit", label: "Spreadrendite", num: true, fmt: v => pp(v) }];
    const rows = res.map((x, i) => ({ rank: i + 1, name: displayName(x.p), team: x.p.team, ...x.r.metrics,
      zins: last(x.r.carry) + last(x.r.zins), kredit: last(x.r.kredit) }));  // Zinsrendite inkl. Carry
    const teamTiles = TEAMS.filter(t => !state.team || t === state.team).map(t => {
      const tr = res.filter(x => x.p.team === t);
      return tile(avgLabel(t), pp(mean(tr, x => last(x.r.cum))), `${tr.filter(x => last(x.r.cum) > sbi).length} von ${tr.length} über dem SBI`);
    });
    const out = [perfBanner(),
      h("div", { class: "tiles" },
        tile("SBI (Benchmark)", pp(sbi), `${dateFmt(PERF.start, true)} – ${dateFmt(PERF.end, true)}`),
        tile("über dem SBI", `${beat} von ${res.length}`, pct(beat / Math.max(1, res.length), 0)),
        tile("Spitze", pp(last(res[0].r.cum)), displayName(res[0].p)), ...teamTiles),
      card("Wertentwicklung seit Start", "Kumulierte Rendite (Buy & Hold ab Starttag). Graue Linien = einzelne Portfolios, farbig = Kohorten-Durchschnitt, schwarz = SBI. Das im Profil gewählte Portfolio ist hervorgehoben.",
        h("div", {}, legend(teamsShown.map(t => [avgLabel(t), teamColor(t), "rect"]).concat([["SBI", css("--text-primary"), "rect"], ["einzelne Portfolios", css("--neutral-series"), "rect"]])), lineBox)),
      card("Rangliste", "Realisierte Rendite seit Start. Hover zeigt Zins- und Spreadrendite, Klick öffnet das Profil.",
        h("div", {}, state.team ? null : legend(TEAMS.map(t => [t, teamColor(t), "rect"])), bars)),
      card("Kennzahlen", "Annualisierte Werte auf Basis der Handelstage, Sharpe mit risikolosem Zins 0 % (SARON ≈ 0).",
        table(cols, rows, { sortKey: "rank" })),
    ];
    if (PERF.curve) {
      const c = PERF.curve;
      const curveBox = draw(chartBox(), box => Charts.lines(box, {
        x: c.tenors, xNum: c.tenors, xFmt: t => `${t} J`, yFmt: v => pct(v, 2), height: 260, zeroLine: true,
        series: [{ name: `Start ${dateFmt(PERF.start, true)}`, color: css("--neutral-series"), values: c.start, label: "Start" },
          { name: `Aktuell ${dateFmt(PERF.end, true)}`, color: css("--series-1"), values: c.end, label: "Aktuell" }],
      }));
      out.push(card("CHF-Zinskurve (Zero Rates)", "Verschiebung seit Start – treibt den Zinsanteil der Rendite.",
        h("div", {}, legend([[`Start ${dateFmt(PERF.start, true)}`, css("--neutral-series"), "rect"], [`Aktuell ${dateFmt(PERF.end, true)}`, css("--series-1"), "rect"]]), curveBox)));
    }
    return out;
  }

  // ------------------------------------------------------------ Ansicht: Markt
  function viewMarket() {
    const M = PERF && PERF.market;
    if (!M) return [card("Noch keine Marktdaten", "Die Marktübersicht braucht die Tabs Preise und Zinskurve im Marktdaten-Excel.", null)];
    // Zeitraum (Standard: Start bis letzter Kurstag)
    const n = PERF.dates.length;
    let i0 = Math.max(0, PERF.dates.indexOf(state.mkFrom)), i1 = PERF.dates.indexOf(state.mkTo);
    if (i1 < 0) i1 = n - 1;
    if (i0 >= i1) { i0 = 0; i1 = n - 1; }
    const setRange = (from, to) => { state.mkFrom = from; state.mkTo = to; save(); render(); };
    const dateSelect = (value, onChange, minI, maxI) => h("select", { onchange: e => onChange(e.target.value) },
      PERF.dates.map((d, i) => h("option", { value: d, selected: i === value ? "" : null, disabled: (i < minI || i > maxI) ? "" : null }, dateFmt(d, true))));
    const controls = h("div", { class: "filters range" },
      h("label", {}, "Zeitraum von ", dateSelect(i0, v => setRange(v, PERF.dates[i1]), 0, i1 - 1)),
      h("label", {}, "bis ", dateSelect(i1, v => setRange(PERF.dates[i0], v), i0 + 1, n - 1)),
      h("button", { type: "button", class: "chip" + (i0 === 0 && i1 === n - 1 ? " active" : ""), onclick: () => setRange(null, null) }, "Start bis heute"));

    const tenorLabel = t => `${t} J`;
    const key = t => String(t);
    const near = t => M.tenors.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a);
    const bpS = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + " bp";
    const t10 = near(10);
    const z10 = M.zero[key(t10)];
    const dSpread = M.spread_all[i1] - M.spread_all[i0];
    const fromL = dateFmt(PERF.dates[i0], true), toL = dateFmt(PERF.dates[i1], true);
    const tiles = h("div", { class: "tiles" },
      tile(`Veränderung Zero ${tenorLabel(t10)}`, bpS((z10[i1] - z10[i0]) * 1e4), `${pct(z10[i0], 2)} → ${pct(z10[i1], 2)}`),
      tile("Veränderung Ø Spread (alle Bonds)", bpS(dSpread), `${num(M.spread_all[i0], 1)} bp → ${num(M.spread_all[i1], 1)} bp`));

    const up = css("--series-2"), down = css("--series-1");
    const curveBox = draw(chartBox(), box => Charts.curveWithDelta(box, {
      tenors: M.tenors, from: M.tenors.map(t => M.zero[key(t)][i0]), to: M.tenors.map(t => M.zero[key(t)][i1]),
      fromLabel: fromL, toLabel: toL, fromColor: css("--neutral-series"), toColor: css("--series-1"),
      upColor: up, downColor: down, height: 440 }));

    const RB = ["AAA", "AA", "A", "BBB"];
    const groups = [{ id: "all", label: "Ø alle Bonds", s: M.spread_all }]
      .concat(RB.map(k => ({ id: "r" + k, label: `Rating ${k}`, s: M.spread_by_rating[k] })))
      .concat(Object.entries(M.spread_by_sector).filter(([k]) => k !== "Treasury").map(([k, v]) => ({ id: "s" + k, label: k, s: v })));
    const spreadRows = groups.map(g => ({ ...g, start: g.s[i0], end: g.s[i1], delta: g.s[i1] - g.s[i0] }));
    const spreadBox = draw(chartBox(), box => Charts.rankingBars(box, {
      rows: spreadRows.map(g => ({ id: g.id, label: g.label, value: g.delta, color: g.delta >= 0 ? up : down,
        rows: () => [{ value: bpS(g.delta), label: "Veränderung" }, { value: num(g.start, 1) + " bp", label: fromL }, { value: num(g.end, 1) + " bp", label: toL }] })),
      fmt: v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " bp",
      barH: 18,
    }));

    // Alle Bonds im gewählten Zeitraum: Rendite total = Carry + Zins + Spread (additiv, Tageswerte summiert)
    const holders = isin => PEOPLE.filter(p => p.positions[isin]).length;
    const sum = (a) => a.slice(i0, i1).reduce((x, y) => x + y, 0);
    const bondRows = D.bonds.filter(b => PERF.bonds[b.isin]).map(b => {
      const B = PERF.bonds[b.isin];
      const ts = M.bond_spread_ts[b.isin] || [];
      return { name: b.name, rating_num: b.rating_num, rating: b.rating, sektor: b.sektor, duration: b.duration,
        rendite: B.r.slice(i0, i1).reduce((acc, x) => acc * (1 + x), 1) - 1,
        zins: sum(B.carry_d) + sum(B.zins_d), kredit: sum(B.kredit_d),  // Zinsrendite inkl. Carry
        dspread: ts[i0] != null && ts[i1] != null ? ts[i1] - ts[i0] : null, holders: holders(b.isin) };
    });
    const bcols = [{ key: "name", label: "Bond" }, { key: "rating_num", label: "Rating", num: true, fmt: (v, r) => r.rating },
      { key: "sektor", label: "Sektor" }, { key: "duration", label: "Duration", num: true, fmt: v => num(v, 1) },
      { key: "rendite", label: "Rendite total", num: true, fmt: v => pp(v) },
      { key: "zins", label: "Zinsrendite", num: true, fmt: v => pp(v) }, { key: "kredit", label: "Spreadrendite", num: true, fmt: v => pp(v) },
      { key: "dspread", label: "Δ Spread", num: true, fmt: v => v == null ? "–" : bpS(v) }, { key: "holders", label: "gehalten von", num: true }];

    return [perfBanner(), controls, tiles,
      h("div", { class: "grid-2" },
        card("CHF-Zinskurve (Zero Rates)", `Oben das Niveau am ${fromL} und ${toL}, unten die Veränderung je Laufzeit (blau = gesunken, orange = gestiegen).`,
          h("div", {}, legend([[fromL, css("--neutral-series"), "rect"], [toL, css("--series-1"), "rect"]]), curveBox)),
        card("Veränderung der Kreditspreads", `Wie sich die Risikoaufschläge unserer Bonds gegenüber Staatsanleihen vom ${fromL} bis ${toL} verändert haben – im Durchschnitt, je Ratingklasse und je Sektor. Orange = Spreads gestiegen (Kursverluste), blau = Spreads gesunken (Kursgewinne).`,
          spreadBox, asTable([{ key: "label", label: "Gruppe" }, { key: "start", label: fromL, num: true, fmt: v => num(v, 1) + " bp" },
            { key: "end", label: toL, num: true, fmt: v => num(v, 1) + " bp" }, { key: "delta", label: "Δ", num: true, fmt: bpS }], spreadRows))),
      card(`Alle Bonds ${fromL} – ${toL}`, "Rendite total ≈ Zinsrendite (laufender Ertrag und Wirkung der Zinskurve) + Spreadrendite (Wirkung der Risikoaufschläge). Spaltenköpfe sortieren.",
        table(bcols, bondRows, { sortKey: "rendite", asc: false })),
    ];
  }

  function profilePerformance(p) {
    const r = perfOf(p);
    if (!r) return [];
    const last = a => a[a.length - 1];
    const box = draw(chartBox(), b => Charts.lines(b, {
      x: PERF.dates, xFmt: dateFmt, yFmt: v => pct(v, 1), zeroLine: true, height: 260,
      series: [{ name: displayName(p), color: teamColor(p.team), values: r.cum, label: "Portfolio" },
        { name: "SBI", color: css("--text-primary"), values: PERF.sbi.cum, label: "SBI" }],
    }));
    const crow = ([isin, c, cz, ck]) => ({ isin, name: BONDS[isin].name, rating_num: BONDS[isin].rating_num, rating: BONDS[isin].rating,
      w: (p.positions[isin] || 0) / 100, rendite: PERF.bonds[isin] ? PERF.bonds[isin].rendite : null, beitrag: c, zins: cz, kredit: ck });
    const crows = r.contrib.map(crow);
    const total = k => crows.reduce((a, x) => a + (x[k] || 0), 0);
    const ccols = [{ key: "name", label: "Bond" }, { key: "rating_num", label: "Rating", num: true, fmt: (v, x) => x.rating },
      { key: "w", label: "Startgewicht", num: true, fmt: v => pct(v, 1) },
      { key: "rendite", label: "Rendite Bond", num: true, fmt: v => v == null ? "–" : pp(v) },
      { key: "beitrag", label: "Beitrag", num: true, fmt: bp }, { key: "zins", label: "davon Zins", num: true, fmt: bp },
      { key: "kredit", label: "davon Spread", num: true, fmt: bp }];
    const contribBox = draw(chartBox(), b => Charts.rankingBars(b, {
      rows: crows.map(x => ({ id: x.isin, label: x.name.length > 22 ? x.name.slice(0, 21) + "…" : x.name, value: x.beitrag,
        color: x.beitrag >= 0 ? css("--series-1") : css("--series-2"),
        rows: () => [{ value: bp(x.beitrag), label: "Beitrag" }, { value: bp(x.zins), label: "davon Zins" }, { value: bp(x.kredit), label: "davon Spread" },
          { value: pct(x.w, 1), label: "Startgewicht" }, { value: x.rendite == null ? "–" : pp(x.rendite), label: "Rendite Bond" }] })),
      fmt: v => bp(v), barH: 12,
    }));
    const m = r.metrics;
    return [
      card("Performance seit Start", null, h("div", {},
        h("div", { class: "tiles" },
          tile("Rendite", pp(m.rendite), `SBI ${pp(last(PERF.sbi.cum))} · Differenz ${bp(m.ueberrendite)}`),
          tile("Zinsrendite / Spreadrendite", `${pp(last(r.carry) + last(r.zins), 2)} / ${pp(last(r.kredit), 2)}`, "Zinsrendite inkl. laufendem Ertrag"),
          tile("Volatilität / Sharpe", `${pct(m.vol, 2)} / ${r2(m.sharpe)}`, "p.a., rf = 0"),
          tile("Tracking Error / IR", `${pct(m.te, 2)} / ${r2(m.ir)}`, "gegenüber SBI")),
        legend([[displayName(p), teamColor(p.team), "rect"], ["SBI", css("--text-primary"), "rect"]]), box)),
      card("Performance Contribution", `Beitrag jeder Position zur Portfoliorendite (Summe ${bp(total("beitrag"))}: Zins ${bp(total("zins"))}, Spread ${bp(total("kredit"))}).`,
        contribBox, asTable(ccols, crows, { sortKey: "beitrag", asc: false })),
    ];
  }

  // ------------------------------------------------------------ Rahmen
  const VIEWS = [["overview", "Überblick", viewOverview], ["market", "Markt", viewMarket],
    ["positioning", "Positionierung", viewPositioning], ["performance", "Performance", viewPerformance],
    ["scenario", "Szenario-Rangliste", viewScenario], ["profile", "Portfolio-Profil", viewProfile]];

  function render() {
    drawers = [];
    Charts.Tooltip.hide();
    const nav = h("nav", { class: "tabs", role: "tablist" }, VIEWS.map(([id, label]) => h("button", { type: "button", role: "tab",
      "aria-selected": String(state.view === id), class: state.view === id ? "active" : "",
      onclick: () => { state.view = id; save(); render(); } }, label)));
    const filters = h("div", { class: "filters" },
      h("label", {}, "Kohorte ", h("select", { onchange: e => { state.team = e.target.value; save(); render(); } },
        h("option", { value: "" }, "Alle"), TEAMS.map(t => h("option", { value: t, selected: state.team === t ? "" : null }, t)))),
      D.meta.with_names ? h("label", {}, h("input", { type: "checkbox", checked: state.names ? "" : null,
        onchange: e => { state.names = e.target.checked; save(); render(); } }), " echte Namen anzeigen") : null,
      h("span", { class: "muted" }, `${D.meta.round} · Stand ${D.meta.generated}`));
    const view = VIEWS.find(v => v[0] === state.view) || VIEWS[0];
    if (location.hash.slice(1) !== view[0]) history.replaceState(null, "", "#" + view[0]);
    app.replaceChildren(nav, filters, ...view[2]());
    drawers.forEach(f => f());
  }
  // Direktlink auf eine Ansicht, z. B. index.html#scenario (praktisch für die Vorlesung)
  const fromHash = () => { const v = location.hash.slice(1); if (VIEWS.some(x => x[0] === v)) state.view = v; };
  window.addEventListener("hashchange", () => { fromHash(); render(); });
  fromHash();
  render();
})();
