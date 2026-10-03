// Keeper Grove website.
//   /                 -> enter a code
//   /?code=MOSS-...   -> one chat's tree (polls every 3 s)
//   /?code=GROVE-...  -> a person's enchanted grove: every tree they're part of
// Trees you've opened are remembered on this device; two or more become "My grove".
// Host this folder anywhere (DeepSpace, your GoDaddy domain...) and point it at the bot with ?api=https://bot-url
const params = new URLSearchParams(location.search);
const API = (params.get("api") || document.querySelector('meta[name="keeper-api"]')?.content || "").replace(/\/$/, "");
const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

const state = { code: "", timer: 0, seen: new Set(), firstPaint: true, fromGrove: false };

// ---------------------------------------------------------------- saved codes (per device)
const SAVE_KEY = "keeper-grove-codes";
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || "[]").filter((x) => x && x.code);
  } catch {
    return [];
  }
}
function saveCode(code, title, type) {
  const list = loadSaved().filter((x) => x.code !== code);
  list.unshift({ code, title: title || code, type });
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {}
}
function forgetCode(code) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(loadSaved().filter((x) => x.code !== code)));
  } catch {}
}
const savedTrees = () => loadSaved().filter((x) => x.type === "tree");

// ---------------------------------------------------------------- api
async function getJSON(path) {
  const res = await fetch(API + path, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}
const normalize = (raw) => {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^([A-Z]+?)([A-Z0-9]{6})$/);
  return m ? `${m[1]}-${m[2]}` : s;
};

// ---------------------------------------------------------------- routing
function go(code, { push = true } = {}) {
  if (code) params.set("code", code);
  else params.delete("code");
  if (push) history.pushState(null, "", `${location.pathname}?${params}`.replace(/\?$/, ""));
  route();
}
window.addEventListener("popstate", () => {
  const p = new URLSearchParams(location.search);
  if (p.get("code")) params.set("code", p.get("code"));
  else params.delete("code");
  route();
});
$("homeLink").addEventListener("click", (e) => {
  e.preventDefault();
  go("");
});

async function route() {
  clearInterval(state.timer);
  const code = params.get("code");
  if (code === "mine") return showLocalGrove();
  if (!code) return showGate();
  try {
    const found = await getJSON(`/api/lookup/${encodeURIComponent(normalize(code))}`);
    if (found.type === "grove") {
      saveCode(normalize(code), "My grove", "grove");
      return showGrove(found.trees, { groveCode: normalize(code) });
    }
    const tree = found.trees[0];
    saveCode(tree.code, tree.title, "tree");
    return showTree(tree);
  } catch (e) {
    showGate(e.message);
  }
}

function show(view) {
  for (const id of ["gate", "grove", "treeView"]) $(id).hidden = id !== view;
  $("nav").hidden = view === "gate";
  $("recapBtn").hidden = view !== "treeView";
  $("groveBtn").hidden = !(view === "treeView" && (state.fromGrove || savedTrees().length >= 2));
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- gate
function showGate(error = "") {
  state.fromGrove = false;
  state.groveCode = undefined;
  show("gate");
  $("codeError").textContent = error;
  const saved = loadSaved();
  $("saved").hidden = !saved.length;
  const chips = saved.map(
    (s) =>
      `<span class="chip"><button data-code="${esc(s.code)}">${s.type === "grove" ? "🌲" : "🌳"} ${esc(s.title)}</button><button class="x" data-forget="${esc(s.code)}" aria-label="Forget ${esc(s.title)}">×</button></span>`,
  );
  if (savedTrees().length >= 2) chips.unshift(`<span class="chip"><button data-code="mine">🌲 All my trees (${savedTrees().length})</button></span>`);
  $("savedList").innerHTML = chips.join("");
  if (!error) $("codeInput").focus({ preventScroll: true });
}
$("codeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = normalize($("codeInput").value);
  if (code.length < 8) return void ($("codeError").textContent = "Codes look like MOSS-K7Q2XA.");
  $("codeInput").value = "";
  go(code);
});
$("savedList").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.forget) {
    forgetCode(b.dataset.forget);
    return showGate();
  }
  go(b.dataset.code);
});
$("groveBtn").addEventListener("click", () => (state.groveCode ? go(state.groveCode) : go("mine")));

// ---------------------------------------------------------------- grove
async function showLocalGrove() {
  const codes = savedTrees();
  const trees = (await Promise.all(codes.map((c) => getJSON(`/api/trees/${c.code}`).catch(() => null)))).filter(Boolean);
  if (!trees.length) return showGate("Open a tree first, then it'll show up in your grove.");
  showGrove(trees, {});
}

function showGrove(trees, { groveCode }) {
  show("grove");
  state.groveCode = groveCode;
  state.fromGrove = true;
  trees.sort((a, b) => b.items.length - a.items.length);
  const done = trees.reduce((s, t) => s + t.stats.done, 0);
  const total = trees.reduce((s, t) => s + t.items.length, 0);
  $("groveTitle").textContent = trees.length > 1 ? "Your Enchanted Grove" : "Your grove";
  $("groveSub").textContent = `${trees.length} tree${trees.length === 1 ? "" : "s"} · ${total} things planted · ${done} in bloom`;
  const box = $("groveTrees");
  box.innerHTML = "";
  trees.forEach((t, i) => {
    const b = document.createElement("button");
    b.className = "groveTree";
    // the busiest tree stands in the middle, like the oldest tree in a grove
    b.style.order = String(i % 2 ? i : -i);
    // more planted = a bigger tree
    const size = 0.7 + Math.min(t.items.length, 20) / 30;
    b.style.width = `${Math.round(240 * size)}px`;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "130 130 540 520");
    b.append(svg);
    b.insertAdjacentHTML("beforeend", `<b>${esc(t.title || "Untitled tree")}</b><span>${t.stats.open} open · ${t.stats.done} done · ${t.stats.people} people</span>`);
    b.addEventListener("click", () => go(t.code));
    box.append(b);
    drawTree(svg, t, { compact: true });
  });
}

// ---------------------------------------------------------------- tree
function showTree(tree) {
  show("treeView");
  state.code = tree.code;
  state.seen = new Set();
  state.firstPaint = true;
  paintTree(tree);
  refreshGrowth();
  let n = 0;
  state.timer = setInterval(async () => {
    try {
      paintTree(await getJSON(`/api/trees/${state.code}`));
      if (++n % 5 === 0) refreshGrowth();
    } catch (e) {
      if (e.status === 404) go("");
    }
  }, 3000);
}

function paintTree(tree) {
  $("treeTitle").textContent = tree.title || "Your tree";
  document.title = `${tree.title || "Tree"} · Keeper Grove`;
  drawTree($("tree"), tree, { compact: false });
  side(tree);
}

async function refreshGrowth() {
  try {
    const g = await getJSON(`/api/trees/${state.code}/growth`);
    $("growthSrc").textContent = g.source === "tiger" ? "· Tiger Data" : "";
    drawGrowth(g.points);
  } catch {}
}

// ---------------------------------------------------------------- drawing
function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function drawTree(svg, chat, { compact }) {
  svg.innerHTML = "";
  const uid = compact ? chat.code : "main";
  const defs = el("defs", {}, svg);
  defs.innerHTML = `
    <radialGradient id="gSeed-${uid}"><stop offset="0" stop-color="#fffbe0"/><stop offset=".5" stop-color="#ffe27a"/><stop offset="1" stop-color="#ffe27a" stop-opacity="0"/></radialGradient>
    <radialGradient id="gDone-${uid}"><stop offset="0" stop-color="#fff5d6"/><stop offset=".55" stop-color="#ffd166"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient>
    <radialGradient id="gGround-${uid}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#2c8a58" stop-opacity=".55"/><stop offset="1" stop-color="#2c8a58" stop-opacity="0"/></radialGradient>
    <linearGradient id="gBark-${uid}" x1="0" x2="1"><stop offset="0" stop-color="#4a3222"/><stop offset=".5" stop-color="#7a5539"/><stop offset="1" stop-color="#4a3222"/></linearGradient>
    <filter id="soft-${uid}"><feGaussianBlur stdDeviation="2.2"/></filter>`;
  const ref = (n) => `url(#${n}-${uid})`;

  const cx = 400, groundY = 610, trunkTop = 380;
  const items = chat.items;
  el("ellipse", { cx, cy: groundY, rx: 300, ry: 40, fill: ref("gGround") }, svg);
  for (const dx of [-70, -30, 35, 75]) {
    el("path", { d: `M${cx} ${groundY - 10} Q${cx + dx * 0.6} ${groundY} ${cx + dx} ${groundY + 12}`, stroke: "#4a3222", "stroke-width": 6, fill: "none", "stroke-linecap": "round" }, svg);
  }
  const top = trunkTop - Math.min(items.length, 30) * 2;
  const doneRatio = items.length ? chat.stats.done / items.length : 0;
  el("ellipse", { cx, cy: top - 40, rx: 260, ry: 170, fill: "#5ee08f", opacity: 0.05 + doneRatio * 0.14, filter: ref("soft") }, svg);
  el("path", { d: `M${cx - 26} ${groundY} C${cx - 18} ${groundY - 120} ${cx - 14} ${top + 60} ${cx - 8} ${top} L${cx + 8} ${top} C${cx + 14} ${top + 60} ${cx + 18} ${groundY - 120} ${cx + 26} ${groundY} Z`, fill: ref("gBark") }, svg);

  if (!items.length) {
    // a sprout: nothing planted yet
    el("path", { d: `M${cx} ${top} q-30 -40 -60 -30 q30 0 60 30 q30 -40 60 -30 q-30 0 -60 30`, fill: "#5ee08f", opacity: 0.8 }, svg);
  }

  const byPerson = new Map();
  for (const it of items) {
    const who = it.kind === "commitment" ? it.owner || it.from : it.from;
    if (!byPerson.has(who)) byPerson.set(who, []);
    byPerson.get(who).push(it);
  }
  const people = [...byPerson.keys()].sort();
  const n = people.length;
  people.forEach((who, i) => {
    const mine = byPerson.get(who);
    const ang = ((n === 1 ? 0 : -62 + (124 * i) / (n - 1)) * Math.PI) / 180;
    const sx = cx, sy = top + 30 + (i % 2) * 40;
    const L = 150 + Math.min(mine.length, 10) * 10;
    const ex = sx + Math.sin(ang) * L, ey = sy - Math.cos(ang) * L * 0.85;
    const qx = sx + Math.sin(ang) * L * 0.4, qy = sy - Math.cos(ang) * L * 0.6 - 20;
    el("path", { d: `M${sx} ${sy} Q${qx} ${qy} ${ex} ${ey}`, stroke: "#6b4a33", "stroke-width": 7, fill: "none", "stroke-linecap": "round" }, svg);
    if (!compact) el("text", { x: ex, y: ey - 22, "text-anchor": "middle", class: "branchLabel" }, svg).textContent = who;
    mine.forEach((it, j) => {
      const t = 0.3 + (0.68 * (j + 1)) / (mine.length + 1);
      const px = (1 - t) ** 2 * sx + 2 * (1 - t) * t * qx + t * t * ex;
      const py = (1 - t) ** 2 * sy + 2 * (1 - t) * t * qy + t * t * ey;
      const sideSign = j % 2 ? 1 : -1;
      const off = 14 + hash(it.id) * 10;
      const x = px + Math.cos(ang) * off * sideSign;
      const y = py + Math.sin(ang) * off * sideSign;
      el("line", { x1: px, y1: py, x2: x, y2: y, stroke: "#6b4a33", "stroke-width": 2 }, svg);
      node(svg, it, x, y, ang + sideSign * 0.8, ref, compact);
    });
  });
  if (!compact) state.firstPaint = false;
}

function node(svg, it, x, y, rot, ref, compact) {
  const g = el("g", { class: compact ? "" : "node", transform: `translate(${x} ${y})` }, svg);
  const isNew = !compact && !state.seen.has(it.id) && !state.firstPaint;
  if (!compact) state.seen.add(it.id);
  const inner = el("g", { class: isNew ? "node new" : "" }, g);
  const done = it.status === "done";
  if (it.status === "dropped") g.setAttribute("opacity", ".25");
  const deg = (rot * 180) / Math.PI;

  if (it.kind === "commitment") {
    if (done) el("circle", { r: 14, fill: ref("gDone"), class: "glow" }, inner);
    el("ellipse", { rx: 11, ry: 5.5, fill: done ? "#ffd166" : "#5ee08f", transform: `rotate(${deg})` }, inner);
    el("line", { x1: -9, y1: 0, x2: 9, y2: 0, stroke: "#1d6b40", "stroke-width": 1, transform: `rotate(${deg})` }, inner);
  } else if (it.kind === "decision") {
    if (done) el("circle", { r: 16, fill: ref("gDone"), class: "glow" }, inner);
    for (let k = 0; k < 5; k++) {
      const a = (k * 2 * Math.PI) / 5;
      el("circle", { cx: Math.cos(a) * 6, cy: Math.sin(a) * 6, r: 5, fill: "#f59ad6" }, inner);
    }
    el("circle", { r: 3.5, fill: "#ffe27a" }, inner);
  } else {
    el("circle", { r: it.credited ? 18 : 14, fill: done ? ref("gDone") : ref("gSeed"), class: "glow" }, inner);
    el("circle", { r: 4, fill: "#fffbe0" }, inner);
    if (it.credited) el("circle", { r: 9, fill: "none", stroke: "#fffbe0", "stroke-width": 1, "stroke-dasharray": "2 3" }, inner);
  }
  if (compact) return;

  g.setAttribute("tabindex", "0");
  const tip = $("tooltip");
  const showTip = () => {
    const kind = { commitment: "🍃 Commitment", decision: "🌸 Decision", idea: "✨ Idea" }[it.kind];
    const who = it.kind === "commitment" ? `Owner: ${it.owner || it.from}` : `First said by ${it.from}`;
    tip.innerHTML = `<b>${esc(it.text)}</b>${kind} · ${it.status}<br>${esc(who)}${it.due ? `<br>Due: ${esc(it.due)}` : ""}${it.credited ? "<br>✨ credited back to them" : ""}${it.source === "meeting" ? "<br>🎙️ from a meeting" : ""}`;
    tip.hidden = false;
    const box = svg.parentElement.getBoundingClientRect();
    const r = g.getBoundingClientRect();
    tip.style.left = `${Math.max(0, Math.min(r.left - box.left + 16, box.width - 270))}px`;
    tip.style.top = `${r.top - box.top + 16}px`;
  };
  g.addEventListener("mouseenter", showTip);
  g.addEventListener("focus", showTip);
  g.addEventListener("mouseleave", () => (tip.hidden = true));
  g.addEventListener("blur", () => (tip.hidden = true));
}

function drawGrowth(points) {
  const svg = $("growth");
  svg.innerHTML = "";
  if (points.length < 2) {
    el("text", { x: 150, y: 50, "text-anchor": "middle", class: "empty" }, svg).textContent = "Rings appear as your tree grows over time";
    return;
  }
  const W = 300, H = 90, P = 6;
  const t0 = points[0].t, t1 = points.at(-1).t;
  const max = Math.max(...points.map((p) => p.planted), 1);
  const X = (t) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const Y = (v) => H - P - (v / max) * (H - 2 * P - 10);
  const line = (key) => points.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(" ");
  el("path", { d: `${line("planted")} L${X(t1)} ${H - P} L${X(t0)} ${H - P} Z`, fill: "#5ee08f", opacity: 0.12 }, svg);
  el("path", { d: line("planted"), stroke: "#5ee08f", "stroke-width": 2, fill: "none" }, svg);
  el("path", { d: line("bloomed"), stroke: "#ffd166", "stroke-width": 2, fill: "none" }, svg);
  const last = points.at(-1);
  el("text", { x: W - P, y: 12, "text-anchor": "end", fill: "#9ab9a6", "font-size": 10 }, svg).textContent = `${last.planted} planted · ${last.bloomed} bloomed`;
}

function side(chat) {
  const s = chat.stats;
  $("stats").innerHTML = [
    [s.open, "open"],
    [s.done, "done"],
    [s.ideas, "ideas"],
    [s.credits, "credited"],
  ]
    .map(([v, k]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`)
    .join("");
  const list = (kind, title) => {
    const xs = chat.items.filter((i) => i.kind === kind && i.status !== "dropped");
    if (!xs.length) return "";
    return `<h3>${title}</h3><ul>${xs
      .map((i) => {
        const meta = kind === "commitment" ? `${i.owner || i.from}${i.due ? ` · ${i.due}` : ""}` : i.from;
        return `<li class="${i.status}">${esc(i.text)}${i.credited ? '<span class="badge">credited</span>' : ""}<span class="meta">${esc(meta)}</span></li>`;
      })
      .join("")}</ul>`;
  };
  $("lists").innerHTML =
    list("commitment", "🍃 Who's doing what") + list("decision", "🌸 Decided") + list("idea", "✨ Ideas") ||
    '<p class="muted">Nothing yet. Keeper is listening quietly.</p>';
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------------------------------------------------------------- built with (live status from /api/health)
const TOOLS = [
  { key: "photon", icon: "💬", name: "Photon Spectrum", what: "Keeper lives in your real iMessage group chat: tapbacks, threaded replies, voice notes." },
  { key: "azure", icon: "🧠", name: "Azure OpenAI", what: "One small model call per burst of messages finds commitments, decisions and restated ideas." },
  { key: "elevenlabs", icon: "🎙️", name: "ElevenLabs", what: "Spoken recaps in the chat and here, plus meeting transcription that tells speakers apart." },
  { key: "tiger", icon: "🐯", name: "Tiger Data", what: "Every sprout and bloom is a time-series event; continuous aggregates draw the growth rings." },
  { key: "adp", icon: "📋", name: "Meetings → next steps", what: "Messy meeting transcripts and recordings become owners, decisions and ideas." },
  { key: "site", icon: "🌐", name: "DeepSpace + GoDaddy Registry", what: "This site is deployed on DeepSpace and served on our own domain." },
];
async function renderTools() {
  let live = {};
  try {
    live = (await getJSON("/api/health")).tools || {};
  } catch {}
  const on = { photon: live.photon, azure: live.azure, elevenlabs: live.elevenlabs, tiger: !!live.tiger, adp: true, site: true };
  $("tools").innerHTML = TOOLS.map(
    (t) =>
      `<div class="tool"><b><span>${t.icon}</span>${t.name}${t.key in live || t.key === "adp" ? `<span class="pill ${on[t.key] ? "on" : "off"}">${on[t.key] ? "live" : "off"}</span>` : ""}</b><p>${t.what}</p></div>`,
  ).join("");
  $("footTools").textContent = "Photon · Azure OpenAI · ElevenLabs · Tiger Data · DeepSpace · GoDaddy Registry";
}

// ---------------------------------------------------------------- recap (ElevenLabs)
$("recapBtn").addEventListener("click", async () => {
  if (!state.code) return;
  const btn = $("recapBtn");
  btn.disabled = true;
  btn.textContent = "🔊 …";
  try {
    const res = await fetch(`${API}/api/trees/${state.code}/recap.mp3`);
    if (res.ok) {
      const audio = $("recapAudio");
      audio.src = URL.createObjectURL(await res.blob());
      await audio.play();
    } else {
      const { text } = await res.json();
      if ("speechSynthesis" in window && text) speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  } catch {
  } finally {
    btn.disabled = false;
    btn.textContent = "🔊 Recap";
  }
});

// ---------------------------------------------------------------- meetings (ADP)
const dlg = $("meetingDialog");
$("meetingBtn").addEventListener("click", () => dlg.showModal());
$("meetingSubmit").addEventListener("click", async (ev) => {
  ev.preventDefault();
  const f = $("meetingForm");
  const status = $("meetingStatus");
  const title = f.title.value || "Meeting";
  const file = f.audio.files[0];
  const headers = {};
  if (f.token.value) headers.authorization = `Bearer ${f.token.value}`;
  let body;
  if (file) {
    headers["content-type"] = file.type || "application/octet-stream";
    body = file;
    status.textContent = "Transcribing with ElevenLabs (separating speakers)…";
  } else if (f.transcript.value.trim()) {
    headers["content-type"] = "text/plain";
    body = f.transcript.value;
    status.textContent = "Reading the transcript…";
  } else {
    status.textContent = "Paste a transcript or choose a recording.";
    return;
  }
  try {
    const res = await fetch(`${API}/api/meetings?title=${encodeURIComponent(title)}&filename=${encodeURIComponent(file?.name || "")}`, { method: "POST", headers, body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    status.textContent = `Planted ${data.added} items 🌱 Code: ${data.code}`;
    setTimeout(() => {
      dlg.close();
      go(data.code);
    }, 900);
  } catch (e) {
    status.textContent = `Couldn't add it: ${e.message}`;
  }
});

// ---------------------------------------------------------------- fireflies
(function fireflies() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = $("fireflies");
  for (let i = 0; i < 28; i++) {
    const f = document.createElement("div");
    f.className = "ff";
    f.style.left = `${Math.random() * 100}%`;
    f.style.top = `${30 + Math.random() * 70}%`;
    f.style.setProperty("--dx", `${(Math.random() - 0.5) * 120}px`);
    f.style.animationDuration = `${6 + Math.random() * 8}s`;
    f.style.animationDelay = `${-Math.random() * 10}s`;
    box.appendChild(f);
  }
})();

renderTools();
route();
