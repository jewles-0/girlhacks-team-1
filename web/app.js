// Keeper Grove: polls /api/chats/<id> every 3 seconds and grows a tree.
// Each person is a branch. Leaves = commitments, flowers = decisions, glowing seeds = ideas.
// Host this folder anywhere (DeepSpace, GoDaddy domain, ...) and point it at the bot with ?api=https://your-bot-url
const params = new URLSearchParams(location.search);
const API = (params.get("api") || "").replace(/\/$/, "");
const POLL_MS = 3000;
const NS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);
const svg = $("tree");
const tooltip = $("tooltip");
const picker = $("chatPicker");
let chatId = params.get("chat") || "";
const seen = new Set();
let firstPaint = true;

// ---------------------------------------------------------------- data
async function getJSON(path) {
  const res = await fetch(API + path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function refreshChats() {
  try {
    const chats = await getJSON("/api/chats");
    const current = picker.value || chatId;
    picker.innerHTML = chats
      .map((c) => `<option value="${esc(c.id)}">${esc(c.title || c.id)} · ${c.items} items</option>`)
      .join("");
    if (!chats.length) return void showEmpty(true);
    chatId = chats.some((c) => c.id === current) ? current : chats[0].id;
    picker.value = chatId;
  } catch (e) {
    console.warn("chats", e);
  }
}

async function refresh() {
  if (!chatId) return;
  try {
    const chat = await getJSON(`/api/chats/${chatId}`);
    showEmpty(false);
    draw(chat);
    side(chat);
  } catch (e) {
    console.warn("chat", e);
  }
}

picker.addEventListener("change", () => {
  chatId = picker.value;
  params.set("chat", chatId);
  history.replaceState(null, "", `?${params}`);
  seen.clear();
  firstPaint = true;
  refresh();
});

// ---------------------------------------------------------------- tree
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

function draw(chat) {
  svg.innerHTML = "";
  const defs = el("defs", {}, svg);
  defs.innerHTML = `
    <radialGradient id="gSeed"><stop offset="0" stop-color="#fffbe0"/><stop offset=".5" stop-color="#ffe27a"/><stop offset="1" stop-color="#ffe27a" stop-opacity="0"/></radialGradient>
    <radialGradient id="gDone"><stop offset="0" stop-color="#fff5d6"/><stop offset=".55" stop-color="#ffd166"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient>
    <radialGradient id="gGround" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#2c8a58" stop-opacity=".55"/><stop offset="1" stop-color="#2c8a58" stop-opacity="0"/></radialGradient>
    <linearGradient id="gBark" x1="0" x2="1"><stop offset="0" stop-color="#4a3222"/><stop offset=".5" stop-color="#7a5539"/><stop offset="1" stop-color="#4a3222"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="2.2"/></filter>`;

  const cx = 400, groundY = 610, trunkTop = 380;
  el("ellipse", { cx, cy: groundY, rx: 300, ry: 40, fill: "url(#gGround)" }, svg);
  // roots
  for (const dx of [-70, -30, 35, 75]) {
    el("path", { d: `M${cx} ${groundY - 10} Q${cx + dx * 0.6} ${groundY} ${cx + dx} ${groundY + 12}`, stroke: "#4a3222", "stroke-width": 6, fill: "none", "stroke-linecap": "round" }, svg);
  }
  // trunk grows a little with the number of items
  const top = trunkTop - Math.min(chat.items.length, 30) * 2;
  // soft canopy glow that gets brighter as the group gets things done
  const doneRatio = chat.items.length ? chat.stats.done / chat.items.length : 0;
  el("ellipse", { cx, cy: top - 40, rx: 260, ry: 170, fill: "#5ee08f", opacity: 0.05 + doneRatio * 0.12, filter: "url(#soft)" }, svg);
  el("path", { d: `M${cx - 26} ${groundY} C${cx - 18} ${groundY - 120} ${cx - 14} ${top + 60} ${cx - 8} ${top} L${cx + 8} ${top} C${cx + 14} ${top + 60} ${cx + 18} ${groundY - 120} ${cx + 26} ${groundY} Z`, fill: "url(#gBark)" }, svg);

  // one branch per person who has items
  const byPerson = new Map();
  for (const it of chat.items) {
    const who = it.kind === "commitment" ? it.owner || it.from : it.from;
    if (!byPerson.has(who)) byPerson.set(who, []);
    byPerson.get(who).push(it);
  }
  const people = [...byPerson.keys()].sort();
  const n = people.length;
  people.forEach((who, i) => {
    const items = byPerson.get(who);
    const ang = ((n === 1 ? 0 : -62 + (124 * i) / (n - 1)) * Math.PI) / 180;
    const sx = cx, sy = top + 30 + (i % 2) * 40;
    const L = 150 + Math.min(items.length, 10) * 10;
    const ex = sx + Math.sin(ang) * L, ey = sy - Math.cos(ang) * L * 0.85;
    const qx = sx + Math.sin(ang) * L * 0.4, qy = sy - Math.cos(ang) * L * 0.6 - 20;
    el("path", { d: `M${sx} ${sy} Q${qx} ${qy} ${ex} ${ey}`, stroke: "#6b4a33", "stroke-width": 7, fill: "none", "stroke-linecap": "round" }, svg);
    const label = el("text", { x: ex, y: ey - 22, "text-anchor": "middle", class: "branchLabel" }, svg);
    label.textContent = who;

    items.forEach((it, j) => {
      const t = 0.3 + (0.68 * (j + 1)) / (items.length + 1);
      // point on the quadratic curve
      const px = (1 - t) ** 2 * sx + 2 * (1 - t) * t * qx + t * t * ex;
      const py = (1 - t) ** 2 * sy + 2 * (1 - t) * t * qy + t * t * ey;
      const side = j % 2 ? 1 : -1;
      const off = 14 + hash(it.id) * 10;
      const x = px + Math.cos(ang) * off * side;
      const y = py + Math.sin(ang) * off * side;
      el("line", { x1: px, y1: py, x2: x, y2: y, stroke: "#6b4a33", "stroke-width": 2 }, svg);
      node(it, x, y, ang + side * 0.8);
    });
  });
  firstPaint = false;
}

function node(it, x, y, rot) {
  const g = el("g", { class: "node", tabindex: 0, transform: `translate(${x} ${y})` }, svg);
  const isNew = !seen.has(it.id) && !firstPaint;
  seen.add(it.id);
  const inner = el("g", { class: isNew ? "node new" : "" }, g);
  const done = it.status === "done";
  if (it.status === "dropped") g.setAttribute("opacity", ".25");

  if (it.kind === "commitment") {
    if (done) el("circle", { r: 14, fill: "url(#gDone)", class: "glow" }, inner);
    el("ellipse", { rx: 11, ry: 5.5, fill: done ? "#ffd166" : "#5ee08f", transform: `rotate(${(rot * 180) / Math.PI})` }, inner);
    el("line", { x1: -9, y1: 0, x2: 9, y2: 0, stroke: "#1d6b40", "stroke-width": 1, transform: `rotate(${(rot * 180) / Math.PI})` }, inner);
  } else if (it.kind === "decision") {
    if (done) el("circle", { r: 16, fill: "url(#gDone)", class: "glow" }, inner);
    for (let k = 0; k < 5; k++) {
      const a = (k * 2 * Math.PI) / 5;
      el("circle", { cx: Math.cos(a) * 6, cy: Math.sin(a) * 6, r: 5, fill: "#f59ad6" }, inner);
    }
    el("circle", { r: 3.5, fill: "#ffe27a" }, inner);
  } else {
    el("circle", { r: it.credited ? 18 : 14, fill: done ? "url(#gDone)" : "url(#gSeed)", class: "glow" }, inner);
    el("circle", { r: 4, fill: "#fffbe0" }, inner);
    if (it.credited) el("circle", { r: 9, fill: "none", stroke: "#fffbe0", "stroke-width": 1, "stroke-dasharray": "2 3" }, inner);
  }

  const show = (ev) => {
    const kind = { commitment: "🍃 Commitment", decision: "🌸 Decision", idea: "✨ Idea" }[it.kind];
    const who = it.kind === "commitment" ? `Owner: ${it.owner || it.from}` : `First said by ${it.from}`;
    tooltip.innerHTML = `<b>${esc(it.text)}</b>${kind} · ${it.status}<br>${esc(who)}${it.due ? `<br>Due: ${esc(it.due)}` : ""}${it.credited ? "<br>✨ credited back to them" : ""}${it.source === "meeting" ? "<br>🎙️ from a meeting" : ""}`;
    tooltip.hidden = false;
    const box = svg.parentElement.getBoundingClientRect();
    const r = g.getBoundingClientRect();
    tooltip.style.left = `${Math.min(r.left - box.left + 16, box.width - 270)}px`;
    tooltip.style.top = `${r.top - box.top + 16}px`;
  };
  g.addEventListener("mouseenter", show);
  g.addEventListener("focus", show);
  g.addEventListener("mouseleave", () => (tooltip.hidden = true));
  g.addEventListener("blur", () => (tooltip.hidden = true));
}

// ---------------------------------------------------------------- side panel
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
        const meta = kind === "commitment" ? `${i.owner || i.from}${i.due ? ` · ${i.due}` : ""}` : `${i.from}`;
        return `<li class="${i.status}">${esc(i.text)}${i.credited ? '<span class="badge">credited</span>' : ""}<span class="meta">${esc(meta)}</span></li>`;
      })
      .join("")}</ul>`;
  };
  $("lists").innerHTML =
    list("commitment", "🍃 Who's doing what") + list("decision", "🌸 Decided") + list("idea", "✨ Ideas") ||
    '<p class="muted">Nothing yet. Keeper is listening quietly.</p>';
}

function showEmpty(on) {
  $("empty").hidden = !on;
  svg.style.visibility = on ? "hidden" : "visible";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------------------------------------------------------------- recap (ElevenLabs)
$("recapBtn").addEventListener("click", async () => {
  if (!chatId) return;
  const audio = $("recapAudio");
  const btn = $("recapBtn");
  btn.disabled = true;
  btn.textContent = "🔊 …";
  try {
    const res = await fetch(`${API}/api/chats/${chatId}/recap.mp3`);
    if (res.ok) {
      audio.src = URL.createObjectURL(await res.blob());
      await audio.play();
    } else {
      const { text } = await res.json();
      if ("speechSynthesis" in window && text) speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
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
    status.textContent = "Transcribing with ElevenLabs (speaker separation)…";
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
    status.textContent = `Planted ${data.added} items 🌱`;
    await refreshChats();
    picker.value = chatId = data.id;
    picker.dispatchEvent(new Event("change"));
    setTimeout(() => dlg.close(), 700);
  } catch (e) {
    status.textContent = `Couldn't add it: ${e.message}`;
  }
});

// ---------------------------------------------------------------- fireflies
(function fireflies() {
  const box = $("fireflies");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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

// ---------------------------------------------------------------- go
await refreshChats();
await refresh();
setInterval(refresh, POLL_MS);
setInterval(refreshChats, POLL_MS * 5);
