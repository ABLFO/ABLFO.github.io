(() => {
"use strict";

/* ===================================================================
   TGA Chanukah Raffle: one page, two views.
   - Watch view (the plain link): anyone can follow each night's drawing.
   - Organizer view (the link ending in #run): password page, then the draw desk.
   Each change is signed with the organizer's key (unlocked by the password)
   and sent through ntfy.sh; every open copy updates within a second.
   A GitHub workflow keeps a lasting copy of the latest results in state.json.
   =================================================================== */

/* ---------- Raffle definition (from causematch.com/tgacr26) ---------- */
const PRIZES = {
  1: { name: "Summer On Us", tier: "Gold", blurb: "One session of sleepaway camp this coming summer (up to $3,500)" },
  2: { name: "Crowning Glory", tier: "Gold", blurb: "A beautiful new sheitel (up to $2,000)" },
  3: { name: "Siyum Hashas", tier: "Gold", blurb: "A seat at the Siyum Hashas this summer, transportation included" },
  4: { name: "Getaway for 2", tier: "Gold", blurb: "Domestic flights and a hotel stay for two" },
  5: { name: "Grill Master", tier: "Silver", blurb: "A new meat smoker and a selection of meat to get you started" },
  6: { name: "Shopping Spree", tier: "Silver", blurb: "Gift cards to Fame, T.O. Online, Adee, Tottini and Hosiery Plus" },
  7: { name: "Library of Your Dreams", tier: "Silver", blurb: "A $500 ArtScroll gift card" },
  8: { name: "Night Out", tier: "Silver", blurb: "Dinner for two at Casa, dinner for the kids, and babysitting" },
};
// Night n draws prize 9-n. Chanukah 5787: first candle Friday Dec 4, 2026.
const NIGHTS = [
  { n: 1, prize: 8, light: "Fri, Dec 4", draw: "Motzei Shabbos, Dec 5" },
  { n: 2, prize: 7, light: "Sat, Dec 5", draw: "Motzei Shabbos, Dec 5" },
  { n: 3, prize: 6, light: "Sun, Dec 6", draw: "Sun, Dec 6" },
  { n: 4, prize: 5, light: "Mon, Dec 7", draw: "Mon, Dec 7" },
  { n: 5, prize: 4, light: "Tue, Dec 8", draw: "Tue, Dec 8" },
  { n: 6, prize: 3, light: "Wed, Dec 9", draw: "Wed, Dec 9" },
  { n: 7, prize: 2, light: "Thu, Dec 10", draw: "Thu, Dec 10" },
  { n: 8, prize: 1, light: "Fri, Dec 11", draw: "Motzei Shabbos, Dec 12" },
];
const NIGHT_OF = Object.fromEntries(NIGHTS.map(N => [N.prize, N.n]));
const ALL = [1,2,3,4,5,6,7,8], GOLD = [1,2,3,4], SILVER = [5,6,7,8];
const mk = (prizes, k) => Object.fromEntries(prizes.map(p => [p, k]));
const PACKAGES = [
  { id: "b10", label: "10 Tickets in Each Package", short: "Full Illumination", price: 500, per: mk(ALL, 10), img: "img/pkg-b10.jpg" },
  { id: "b5",  label: "5 Tickets in Each Package", short: "Shining Bright", price: 360, per: mk(ALL, 5), img: "img/pkg-b5.jpg" },
  { id: "b2",  label: "2 Tickets in Each Package", short: "Double Light", price: 250, per: mk(ALL, 2), img: "img/pkg-b2.jpg" },
  { id: "b1",  label: "1 Ticket in Each Package", short: "First Light", price: 180, per: mk(ALL, 1), img: "img/pkg-b1.jpg" },
  { id: "bg",  label: "1 Ticket in Each Gold Package", short: "Solid Gold", price: 150, per: mk(GOLD, 1), img: "img/pkg-bg.jpg" },
  { id: "bs",  label: "1 Ticket in Each Silver Package", short: "Pure Silver", price: 100, per: mk(SILVER, 1), img: "img/pkg-bs.jpg" },
  ...ALL.map(p => ({ id: "p" + p, label: `${PRIZES[p].name} (${PRIZES[p].tier} #${p})`, short: PRIZES[p].name, price: p <= 4 ? 50 : 36, per: { [p]: 1 }, img: `img/prize-${p}.jpg` })),
];
const PKG = Object.fromEntries(PACKAGES.map(p => [p.id, p]));
const REVEAL_MS = 15000;
const LEAD_MS = 2000;   // "Get ready" before the first ticket, so every watcher sees the list from the start
const SLOW_MS = 4000;   // the last few names slow down before the winner
// every ticket gets its own flash: about 34 ms each (two frames on a phone), between 8 and 30 seconds in all
const rollTime = tickets => Math.min(30000, Math.max(8000, tickets * 34)) + SLOW_MS;
const HOLD_MS = 12000; // how long viewers see the winner on the draw screen before returning to the dashboard // time between pressing Draw and the name appearing, so watchers' screens catch up

/* ---------- Small helpers ---------- */
const $ = id => document.getElementById(id);
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false && k !== "") e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const fmt = n => Number(n).toLocaleString("en-US");
// CauseMatch puts an apostrophe in front of numbers so Excel keeps them as text; drop it.
const norm = s => String(s ?? "").replace(/\s+/g, " ").trim().replace(/^'(?=\S)/, "");
// Names shown differently from how CauseMatch has them (matched ignoring case, spacing and any title already there).
const NAME_FIXES = { "zev munk": "Dr. Zev Munk" };
const fixName = s => { const k = norm(s).toLowerCase().replace(/^dr\.?\s+/, ""); return NAME_FIXES[k] || norm(s); };
const store = {
  get(k, d) { try { const v = localStorage.getItem("tga-raffle:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("tga-raffle:" + k, JSON.stringify(v)); } catch {} },
};
const session = {
  get(k, d) { try { const v = sessionStorage.getItem("tga-raffle:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem("tga-raffle:" + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { sessionStorage.removeItem("tga-raffle:" + k); } catch {} },
};
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3800); }
function shortName(n) { const p = norm(n).split(" "); return p.length < 2 ? n : p.slice(0, -1).join(" ") + " " + p[p.length - 1][0] + "."; }
const when = d => d ? d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const hhmm = d => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
// SHA-256 in plain JavaScript, for browsers or frames without crypto.subtle
const K256 = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
function sha256Bytes(msg) {
  const len = msg.length, total = ((len + 9 + 63) >> 6) << 6, buf = new Uint8Array(total);
  buf.set(msg); buf[len] = 0x80; const bits = len * 8;
  buf[total - 4] = bits >>> 24; buf[total - 3] = bits >>> 16; buf[total - 2] = bits >>> 8; buf[total - 1] = bits; buf[total - 5] = Math.floor(bits / 2 ** 32);
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), W = new Uint32Array(64);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = (buf[o + 4 * i] << 24) | (buf[o + 4 * i + 1] << 16) | (buf[o + 4 * i + 2] << 8) | buf[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) { const a = W[i - 15], b = W[i - 2]; W[i] = (((a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ (a >>> 3)) + W[i - 7] + ((b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ (b >>> 10)) + W[i - 16]) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
      const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32); for (let i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = H[i] >>> 16; out[4 * i + 2] = H[i] >>> 8; out[4 * i + 3] = H[i]; }
  return out;
}
const hasSubtle = () => { try { return !!(window.crypto && crypto.subtle && crypto.subtle.digest); } catch { return false; } };
async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  if (hasSubtle()) { try { return hex(await crypto.subtle.digest("SHA-256", bytes)); } catch {} }
  return hex(sha256Bytes(bytes));
}
function randomBelow(n) { // unbiased integer in [0, n) from the browser's cryptographic generator
  const lim = Math.floor(0x100000000 / n) * n, a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return a[0] % n;
}
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
async function pbkdf2(pw, saltHex, iter) {
  const pwBytes = new TextEncoder().encode(pw);
  if (hasSubtle()) {
    try {
      const key = await crypto.subtle.importKey("raw", pwBytes, "PBKDF2", false, ["deriveBits"]);
      return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: iter }, key, 256));
    } catch {}
  }
  // plain JavaScript fallback (HMAC-SHA-256, one 32-byte block)
  let key = pwBytes.length > 64 ? sha256Bytes(pwBytes) : pwBytes;
  const ip = new Uint8Array(64).fill(0x36), op = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < key.length; i++) { ip[i] ^= key[i]; op[i] ^= key[i]; }
  const hmac = m => { const a = new Uint8Array(64 + m.length); a.set(ip); a.set(m, 64); const inner = sha256Bytes(a); const b = new Uint8Array(96); b.set(op); b.set(inner, 64); return sha256Bytes(b); };
  const salt = unhex(saltHex), s1 = new Uint8Array(salt.length + 4); s1.set(salt); s1[s1.length - 1] = 1;
  let u = hmac(s1); const t = u.slice();
  for (let i = 1; i < iter; i++) { u = hmac(u); for (let j = 0; j < 32; j++) t[j] ^= u[j]; if (i % 20000 === 0) await new Promise(r => setTimeout(r)); }
  return hex(t);
}
// passwords are compared without regard to capitals or surrounding spaces (phones like to capitalize)
const normPw = pw => String(pw || "").trim().toLowerCase();

/* ---------- Live state: signed messages over ntfy.sh ---------- */
const CFG = JSON.parse(document.getElementById("raffle-config").textContent);
let STATE = { ver: 0, results: [], live: null };
const NAMES = {};                 // drawing id -> names flashed on screen (older format)
const TICKETS = {};               // drawing id -> { of, parts: { i: { first, names, counts } } }
// every ticket in the drawing as { n: name, t: ticket number }; built from whichever parts have arrived
function ticketList(id) {
  const T = TICKETS[id];
  if (!T) return NAMES[id] ? NAMES[id].map((n, i) => ({ n, t: i + 1 })) : null;
  const out = [];
  for (const part of Object.values(T.parts)) {
    let t = part.first;
    part.names.forEach((n, i) => { for (let k = 0; k < (part.counts[i] || 1); k++) out.push({ n, t: t++ }); });
  }
  return out.length ? out : null;
}
function ticketsFromPool(pool, display) {
  const out = [];
  for (const e of pool.entries) for (let t = e.from; t <= e.to; t++) out.push({ n: display(e), t });
  return out;
}
// split names + ticket counts into pieces that each fit one message
function chunkTickets(names, counts) {
  const parts = []; let cur = { first: 1, names: [], counts: [] }, next = 1;
  for (let i = 0; i < names.length; i++) {
    cur.names.push(names[i]); cur.counts.push(counts[i]);
    if (encUtf8(JSON.stringify(cur)).length > 3200 && cur.names.length > 1) {
      cur.names.pop(); cur.counts.pop(); parts.push(cur);
      cur = { first: next, names: [names[i]], counts: [counts[i]] };
    }
    next += counts[i];
  }
  parts.push(cur);
  return parts;
}
const encUtf8 = s => new TextEncoder().encode(s);
const b64 = buf => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
let PUBKEY = null, SIGNER = null;
async function pubKey() { return PUBKEY || (PUBKEY = await crypto.subtle.importKey("jwk", CFG.pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])); }
// the password decrypts the organizer's signing key; a wrong password simply fails to decrypt
async function unlock(pw) {
  const base = await crypto.subtle.importKey("raw", encUtf8(pw), "PBKDF2", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unhex(CFG.enc.salt), iterations: CFG.enc.iter }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: unhex(CFG.enc.iv) }, aes, unb64(CFG.enc.ct));
}
async function useSigner(pkcs8) { SIGNER = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]); }
async function signed(payload) {
  const text = JSON.stringify(payload);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, SIGNER, encUtf8(text));
  return b64(sig) + "\n" + text;
}
async function readSigned(body) {
  if (typeof body !== "string") return null;
  const i = body.indexOf("\n"); if (i < 1) return null;
  try {
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await pubKey(), unb64(body.slice(0, i)), encUtf8(body.slice(i + 1)));
    return ok ? JSON.parse(body.slice(i + 1)) : null;
  } catch { return null; }
}
const NTFY = "https://ntfy.sh/" + CFG.topic;
async function post(payload) {
  const body = await signed(payload);
  if (encUtf8(body).length > 3990) throw { code: "too_large" };
  const r = await fetch(NTFY, { method: "POST", body });
  if (!r.ok) throw { code: r.status === 429 ? "rate_limited" : "upstream_error" };
  await ingest(body);
}
// keep the flashing-names message inside ntfy's 4 KB limit
function fitNames(names) {
  const list = [...names];
  while (list.length > 5 && encUtf8(JSON.stringify(list)).length > 3300) list.splice(randomBelow(list.length), 1);
  return list;
}
const listeners = new Set();
async function ingest(body) {
  const p = await readSigned(body);
  if (!p) return;
  if (p.kind === "names" && p.id && Array.isArray(p.names)) { NAMES[p.id] = p.names; return; }
  if (p.kind === "tickets" && p.id && Array.isArray(p.names) && Array.isArray(p.counts)) {
    const T = TICKETS[p.id] || (TICKETS[p.id] = { of: p.of, parts: {} });
    T.parts[p.part] = { first: p.first, names: p.names, counts: p.counts };
    return;
  }
  if (p.kind === "state" && p.ver > (STATE.ver || 0)) {
    STATE = { ver: p.ver, results: p.results || [], live: p.live || null };
    store.set("lastState", body);
    listeners.forEach(fn => { try { fn(); } catch {} });
  }
}
const FEED = { connected: false, lastAt: 0 };
async function startFeed() {
  const saved = store.get("lastState", null); if (saved) await ingest(saved);
  fetch(CFG.stateUrl + "?t=" + Date.now(), { cache: "no-store" }).then(r => r.ok ? r.text() : "").then(t => t && ingest(t.trim())).catch(() => {});
  let lastId = "all", pollTimer = null;
  const onMsg = m => { if (m && m.event === "message" && m.message) { lastId = m.id || lastId; FEED.lastAt = Math.max(FEED.lastAt, (m.time || 0) * 1000); ingest(m.message); } };
  const poll = async () => {
    try {
      const r = await fetch(`${NTFY}/json?poll=1&since=${lastId}`, { cache: "no-store" });
      const t = await r.text();
      for (const line of t.split("\n")) if (line.trim()) { try { onMsg(JSON.parse(line)); } catch {} }
      FEED.connected = true;
    } catch { FEED.connected = false; }
    pollTimer = setTimeout(poll, 4000);
  };
  if (window.EventSource) {
    let errors = 0;
    const es = new EventSource(`${NTFY}/sse?since=all`);
    es.onopen = () => { FEED.connected = true; errors = 0; };
    es.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch {} };
    es.onerror = () => { FEED.connected = false; if (++errors >= 3 && !pollTimer) { es.close(); poll(); } };
  } else poll();
  // an organizer's desk refreshes the copy ntfy keeps (12 hours), so late arrivals still get it
  setInterval(() => { if (SIGNER) republishIfStale(); }, 30 * 60e3);
}
async function republishIfStale() {
  const body = store.get("lastState", null);
  if (!body || Date.now() - FEED.lastAt < 3 * 60 * 60e3) return;
  try { const r = await fetch(NTFY, { method: "POST", body }); if (r.ok) FEED.lastAt = Date.now(); } catch {}
}
async function publishState(mutate) {
  if (!SIGNER) return { ok: false, code: "locked" };
  const next = JSON.parse(JSON.stringify(STATE));
  mutate(next);
  const live = next.live ? { ...next.live } : null;
  let entries = null;
  if (live && live.entries) { entries = live.entries; delete live.entries; }
  try {
    if (entries) {
      const parts = chunkTickets(entries.names, entries.counts);
      TICKETS[live.id] = { of: parts.length, parts: {} };
      for (let i = 0; i < parts.length; i++) {
        TICKETS[live.id].parts[i] = parts[i];
        await post({ kind: "tickets", id: live.id, part: i, of: parts.length, ...parts[i] });
      }
    }
    await post({ kind: "state", ver: Math.max(Date.now(), (STATE.ver || 0) + 1), results: next.results || [], live });
    return { ok: true };
  } catch (e) { return { ok: false, code: (e && e.code) || "upstream_error" }; }
}

/* ===================================================================
   Watch view
   =================================================================== */
let holdBack = null; // a result still being revealed stays off the dashboard until the reveal ends
function officialResults() { return (STATE.results || []).filter(r => !r.practice && r.id !== holdBack); }
function winnerOf(n) { return officialResults().filter(r => r.night === n && r.status !== "void").sort((a, b) => b.drawnAt.localeCompare(a.drawnAt))[0]; }
function nextNight() { return NIGHTS.find(N => !winnerOf(N.n)); }
const WATCH_HTML = `
<div class="watch" id="watch">
  <img class="banner" src="img/banner.jpg" alt="TGA Illuminations Chanukah Raffle">
  <div><div class="eyebrow">Bnos Yisroel of Houston · Chanukah 5787</div><h1>8 Nights · 8 Winners</h1></div>
  <div id="wNotice"></div>
  <section class="w-now" id="wNow" aria-live="polite"></section>
  <section class="w-cta" id="wCta" hidden></section>
  <section style="display:grid;gap:12px" aria-labelledby="wWinH">
    <h2 id="wWinH">The prizes</h2>
    <div class="w-grid" id="wGrid"></div>
  </section>
  <img class="sponsors" src="img/sponsors.jpg" alt="Thank you to our sponsors">
  <p class="w-foot">When a drawing starts, this page switches to it by itself. Keep it open. · <a href="#run" id="orgLink">Organizers</a></p>
</div>`;
function renderWatch() {
  const L = STATE.live, now = Date.now();
  $("wNotice").replaceChildren(L && L.phase === "test" && now - L.at < 60 * 60e3
    ? el("div", { class: "notice good", text: `Test from the organizers received at ${hhmm(L.at)}. The live page is working.` })
    : L && L.practice && now - L.at < 60 * 60e3 ? el("div", { class: "notice good", text: `Rehearsal at ${hhmm(L.at)} worked. No prize was drawn.` }) : "");
  const latest = officialResults().filter(r => r.status !== "void").sort((a, b) => b.drawnAt.localeCompare(a.drawnAt))[0];
  const nx = nextNight();
  const open = NIGHTS.filter(N => !winnerOf(N.n));
  const box = $("wNow"); box.replaceChildren();
  if (latest) {
    const N = NIGHTS[latest.night - 1];
    const just = now - Date.parse(latest.drawnAt) < 12 * 60 * 60e3;
    box.append(el("img", { src: `img/prize-${latest.prize}.jpg`, alt: "" }), el("div", { class: "txt" },
      el("div", { class: "eyebrow", text: `${just ? "Just drawn" : "Latest winner"} · Night ${N.n} · Prize #${latest.prize}` }),
      el("div", { class: "big", text: PRIZES[latest.prize].name }),
      el("div", { class: "who", text: latest.name }),
      el("div", { class: "muted", text: `Ticket #${fmt(latest.ticket)} of ${fmt(latest.poolTickets)}${latest.seller ? " · sold by " + latest.seller : ""}` }),
      nx ? el("div", { class: "small", text: `Up next: Night ${nx.n}, Prize #${nx.prize} ${PRIZES[nx.prize].name}, ${nx.draw}` }) : el("div", { class: "small muted", text: "That was the last prize. Thank you to everyone who took part!" })));
  } else if (nx) {
    box.append(el("img", { src: `img/prize-${nx.prize}.jpg`, alt: "" }), el("div", { class: "txt" },
      el("div", { class: "eyebrow", text: `Up next · Night ${nx.n}` }),
      el("div", { class: "big", text: `Prize #${nx.prize}: ${PRIZES[nx.prize].name}` }),
      el("div", { class: "muted", text: PRIZES[nx.prize].blurb }),
      el("div", { text: `Drawing ${nx.draw}. Keep this page open to watch it live.` })));
  }
  // the ticket pitch appears once at least one prize has been drawn and others are still open
  const cta = $("wCta");
  cta.hidden = !(latest && open.length);
  if (!cta.hidden) cta.replaceChildren(el("div", null,
      el("div", { class: "cta-h", text: "Still want in? You can still get tickets." }),
      el("div", { class: "muted", text: `${open.length === 1 ? "One prize is" : open.length + " prizes are"} still to be drawn. Bundles bought now count for every prize still to come.` })),
    el("a", { class: "btn primary cta-btn", href: "https://tgatexas.org/raffle", target: "_blank", rel: "noopener", text: "Buy tickets" }));
  $("wGrid").replaceChildren(...NIGHTS.map(N => {
    const w = winnerOf(N.n);
    return el("div", { class: "w-card" + (w ? " won" : "") }, el("img", { src: `img/prize-${N.prize}.jpg`, alt: "", loading: "lazy" }), el("div", { class: "body" },
      el("span", { class: "eyebrow", text: `Night ${N.n} · ${N.draw}` }),
      el("div", { style: "font-family:var(--f-display);font-weight:700", text: `#${N.prize} ${PRIZES[N.prize].name}` }),
      w ? el("div", { class: "winner", text: "Won by " + w.name }) : el("div", { class: "pending", text: "Tickets still available" }),
      w && w.seller ? el("div", { class: "small muted", text: "Sold by " + w.seller }) : ""));
  }));
}
function markRehearsal() {
  const n = $("stNight"); if (n && !/^Rehearsal/.test(n.textContent)) n.textContent = "Rehearsal · " + n.textContent;
  const m = $("stMeta"); if (m && !/rehearsal/i.test(m.textContent)) m.prepend("Rehearsal, not a real drawing · ");
}
function showDashboard() {
  if (document.documentElement.dataset.view !== "watch") return;
  shownKey = shownKey || "none";
  clearTimeout(stage.timer); stage.rolling = false; holdBack = null;
  $("stage").hidden = true; document.body.style.overflow = "";
  delete document.documentElement.dataset.stage;
  renderWatch(); window.scrollTo(0, 0);
}
// The ticket pitch (buy button and open prizes) appears only once a winner is on screen.
function renderWinnersStrip(promo = false) {
  const box = $("stWinners"); if (!box) return;
  const won = NIGHTS.map(N => ({ N, w: winnerOf(N.n) })).filter(x => x.w);
  const open = promo ? NIGHTS.filter(N => !winnerOf(N.n)) : [];
  $("buyLink").hidden = stage.operator || !open.length;
  box.replaceChildren(
    won.length ? el("div", { class: "strip" }, el("span", { class: "lab", text: "Winners so far" }),
      ...won.map(({ N, w }) => el("span", { class: "chip-w" }, el("b", { text: `#${N.prize} ${PRIZES[N.prize].name}` }), " " + w.name + (w.seller ? " · sold by " + w.seller : "")))) : "",
    open.length ? el("div", { class: "strip" }, el("span", { class: "lab", text: open.length === 8 ? "All 8 prizes still open" : "Still open: tickets available" }),
      ...open.map(N => el("span", { class: "chip-w open" }, el("b", { text: `#${N.prize}` }), ` ${PRIZES[N.prize].name} · ${N.draw}`)),
      el("a", { class: "buy-inline", href: "https://tgatexas.org/raffle", target: "_blank", rel: "noopener", text: "Buy at tgatexas.org/raffle" }),
      el("span", { class: "hint", text: "Bundles bought now count for every prize still to be drawn." })) : "");
}
/* ===================================================================
   Organizer password page
   =================================================================== */
const GATE_HTML = `
<div class="gate" id="gate">
  <div class="gate-card">
    <img src="img/banner.jpg" alt="TGA Illuminations Chanukah Raffle">
    <form id="gateForm" autocomplete="off">
      <h2>Organizer sign-in</h2>
      <p class="muted small">This part of the page runs the drawing. Enter the organizer password to continue.</p>
      <label class="small muted" for="gatePw">Password</label>
      <input type="password" id="gatePw" autocomplete="current-password">
      <div class="gate-err" id="gateErr" aria-live="polite"></div>
      <div class="row" style="justify-content:space-between">
        <a href="#" id="gateBack" class="small muted">Back to the live view</a>
        <button class="btn primary" type="submit">Continue</button>
      </div>
    </form>
  </div>
</div>`;

/* ===================================================================
   Organizer desk
   =================================================================== */
const DESK_HTML = `
<div class="wrap" id="desk">
  <img class="banner" src="img/banner.jpg" alt="TGA Illuminations Chanukah Raffle">
  <header class="top">
    <div>
      <div class="eyebrow">Organizer view · Chanukah 5787</div>
      <h1>Raffle Draw Desk</h1>
      <p class="lede">Load the CauseMatch export, check the packages, and draw tonight's winner. Each drawing shows up on the public live view by itself.</p>
    </div>
    <div class="row" id="modeChips"></div>
  </header>

  <section aria-labelledby="nightsH" style="display:grid;gap:12px">
    <div class="step-head">
      <h2 id="nightsH">8 Nights · 8 Winners</h2>
      <span class="muted small">We start with Prize #8 and build up to the grand prize. Friday drawings happen Motzei Shabbos.</span>
    </div>
    <div class="nights" id="nights"></div>
  </section>

  <section class="step" aria-labelledby="s1">
    <div class="step-head">
      <div class="lab"><span class="step-no">1</span><h2 id="s1">Load the CauseMatch export</h2></div>
      <span class="muted small">Your file stays in this browser. Nothing in it is uploaded or shown to viewers.</span>
    </div>
    <div class="drop" id="drop">
      <div style="display:grid;gap:4px;min-width:0">
        <strong id="fileName">Sample export loaded</strong>
        <span class="muted small" id="fileHint"></span>
      </div>
      <div class="row">
        <label class="btn primary" for="fileInput">Choose file</label>
        <input type="file" id="fileInput" accept=".csv,.xlsx,.xls,.tsv,.txt" hidden>
        <button class="btn" id="loadSample" type="button">Use sample data</button>
      </div>
    </div>
    <div class="campaign" id="campaignRow" hidden>
      <label class="small muted" for="campaignSel">Raffle in this file</label>
      <select id="campaignSel"></select>
    </div>
    <div class="stats" id="loadStats"></div>
    <div id="loadNotices" style="display:grid;gap:8px"></div>
    <details id="mapDetails">
      <summary>Columns used from the file</summary>
      <p class="muted small" style="margin-top:6px">These are picked automatically from the column headings. Change one only if it picked the wrong column.</p>
      <div class="map-grid" id="mapGrid"></div>
    </details>
  </section>

  <section class="step" aria-labelledby="s2">
    <div class="step-head">
      <div class="lab"><span class="step-no">2</span><h2 id="s2">Check the packages</h2></div>
      <span class="muted small" id="pkgSummary"></span>
    </div>
    <div id="reviewBox" style="display:grid;gap:10px"></div>
    <div class="table-wrap scroll"><table id="pkgTable"></table></div>
  </section>

  <section class="step" aria-labelledby="s3">
    <div class="step-head">
      <div class="lab"><span class="step-no">3</span><h2 id="s3">Tonight's ticket pool</h2></div>
      <span class="muted small" id="poolFor"></span>
    </div>
    <div class="stats" id="poolStats"></div>
    <div id="poolNotices" style="display:grid;gap:8px"></div>
    <div class="row" style="justify-content:space-between">
      <div class="row">
        <button class="btn primary" id="openStage" type="button">Open the draw screen</button>
        <button class="btn" id="dlWorkbook" type="button">Download all prize tabs (.xlsx)</button>
        <button class="btn" id="copyList" type="button">Copy this list</button>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" id="oneWin"> One prize per person</label>
        <label class="check"><input type="checkbox" id="perTicket"> Excel: one row per ticket</label>
      </div>
    </div>
    <div class="row">
      <input type="search" id="poolSearch" placeholder="Find a name, email, seller or ticket number" aria-label="Find a name, email, seller or ticket number in the pool" style="flex:1;min-width:200px">
      <label class="check"><input type="checkbox" id="onlyNew"> Only new since the last drawing</label>
      <span class="muted small" id="poolCount"></span>
    </div>
    <div class="table-wrap scroll"><table id="poolTable"></table></div>
  </section>

  <section class="step" aria-labelledby="s4">
    <div class="step-head">
      <div class="lab"><span class="step-no">4</span><h2 id="s4">Results log</h2></div>
      <span class="muted small" id="logWhere"></span>
    </div>
    <div class="table-wrap"><table id="logTable"></table></div>
    <div class="row"><button class="btn" id="dlResults" type="button">Download results (.csv)</button></div>
  </section>

  <section class="step settings" aria-labelledby="s5">
    <div class="step-head">
      <div class="lab"><h2 id="s5">Live view and sign-in</h2></div>
      <span class="muted small" id="pubState"></span>
    </div>
    <p class="muted small">The live view is this page's address without <span class="mono">#run</span> at the end. Each drawing, void and test is sent to everyone watching within a second or two. No one needs to refresh.</p>
    <div class="row">
      <button class="btn" id="testLive" type="button">Send a test to the live view</button>
      <button class="btn" id="clearLive" type="button">Clear the live screen</button>
      <button class="btn" id="viewLive" type="button">See the live view</button>
      <button class="btn" id="signOut" type="button">Sign out</button>
    </div>
    <p class="muted small">To change the organizer password, ask Claude to issue a new one; the page is updated with it.</p>
  </section>

  <img class="sponsors" src="img/sponsors.jpg" alt="Thank you to our sponsors">
</div>`;

const STAGE_HTML = `
<div class="stage" id="stage" hidden role="dialog" aria-modal="true" aria-labelledby="stPrize">
  <div class="stage-top">
    <img class="wordmark" src="img/wordmark.png" alt="Illuminations: TGA Chanukah Raffle">
    <div class="row">
      <span class="live-dot" id="stLive" hidden>Live</span>
      <a class="btn gold buy" id="buyLink" href="https://tgatexas.org/raffle" target="_blank" rel="noopener" hidden>Buy tickets</a>
      <label class="check" id="stShortWrap"><input type="checkbox" id="stShort"> Last initial only</label>
      <label class="check" id="stPracticeWrap"><input type="checkbox" id="stPractice"> Practice draw</label>
      <label class="check" id="stShowWrap"><input type="checkbox" id="stShow"> Show practice on live page</label>
      <button class="btn" id="stClose" type="button">Close</button>
    </div>
  </div>
  <div class="stage-mid">
    <img class="st-prize-img" id="stImg" alt="">
    <div class="st-text">
      <svg class="menorah" id="menorah" viewBox="0 0 520 220" aria-hidden="true"></svg>
      <div class="st-night" id="stNight"></div>
      <div class="st-prize" id="stPrize"></div>
      <div class="st-detail" id="stDetail"></div>
      <div class="st-name" id="stName" aria-live="polite"></div>
      <div class="st-count" id="stCount"></div>
      <div class="st-sub" id="stSub"></div>
      <div class="st-seller" id="stSeller"></div>
      <div class="st-meta" id="stMeta"></div>
    </div>
  </div>
  <div class="stage-bot" id="stControls"></div>
  <div class="st-winners" id="stWinners"></div>
  <img class="stage-sponsors" src="img/sponsors.jpg" alt="Thank you to our sponsors">
  <canvas class="fx" id="fx" aria-hidden="true"></canvas>
</div>
<button class="sound-btn" id="soundBtn" type="button" hidden></button>
<div class="toast" id="toast" hidden></div>`;

/* ---------- Package matching ---------- */
function matchPackage(text) {
  const t = norm(text).toLowerCase().replace(/[’']/g, "'");
  if (!t) return null;
  if (/silver/.test(t) && /\b(each|all)\b/.test(t)) return "bs";
  if (/gold/.test(t) && /\b(each|all)\b/.test(t)) return "bg";
  const b = t.match(/\b(10|5|2|1)\s*tickets?\b.*\b(each|all|every)\b/);
  if (b) return "b" + b[1];
  for (const p of PACKAGES.slice(0, 6)) if (t === p.short.toLowerCase()) return p.id;
  const num = t.match(/(?:gold|silver|prize)\s*(?:package\s*)?#\s*([1-8])\b/) || t.match(/\bpackage\s*#\s*([1-8])\b/);
  if (num) return "p" + num[1];
  for (const p of ALL) if (t.includes(PRIZES[p].name.toLowerCase())) return "p" + p;
  return null;
}
// CauseMatch lists several packages in one cell ("Getaway for 2,Summer On Us") with matching quantities ("1,1").
function splitPackages(titleCell, qtyCell, hasQtyCol) {
  const title = norm(titleCell);
  if (!title) return [];
  const qtys = norm(qtyCell).split(/\s*,\s*/).filter(Boolean).map(q => Math.max(1, Math.round(parseFloat(q)) || 1));
  let parts = title.split(/\s*[;|\n]\s*/).filter(Boolean);
  if (parts.length === 1 && title.includes(",")) {
    const byComma = title.split(/\s*,\s*/).filter(Boolean);
    if (byComma.length === qtys.length || byComma.every(matchPackage)) parts = byComma;
  }
  return parts.map((p, i) => {
    let text = p, qty = hasQtyCol ? (qtys.length === parts.length ? qtys[i] : (qtys.length === 1 ? qtys[0] : 1)) : 1;
    let m = p.match(/^(.*?)\s*[x×]\s*(\d+)\s*$/i) || p.match(/^(.*?)\s*\((\d+)\)\s*$/);
    if (m) { text = m[1].trim(); qty = +m[2] * (hasQtyCol && qtys.length === 1 && parts.length === 1 ? qty : 1); }
    else if ((m = p.match(/^(\d+)\s*[x×]\s+(.*)$/i))) { text = m[2].trim(); qty = +m[1]; }
    return { text, qty };
  });
}
const AMOUNT_FALLBACK = { 500: "b10", 360: "b5", 250: "b2", 180: "b1", 150: "bg", 100: "bs" };

/* ---------- Column detection ---------- */
const FIELDS = [
  { key: "campaign", label: "Campaign", re: /^campaign( name)?$|^page name$/i },
  { key: "first", label: "First name", re: /first\s*name|^first$|given/i },
  { key: "last", label: "Last name", re: /last\s*name|^last$|surname|family name/i },
  { key: "name", label: "Full name (if no first/last)", re: /^(full\s*name|name|donor|donor\s*name|donor\s*full\s*name|customer\s*name|buyer)$/i },
  { key: "email", label: "Email", re: /e-?mail/i },
  { key: "phone", label: "Phone", re: /phone|mobile|cell/i },
  { key: "pkg", label: "Package (perk)", re: /perk\s*title|reward|package|perk|product|item|prize|option/i },
  { key: "qty", label: "Quantity", re: /perk\s*quantity|^(qty|quantity|units?)$|quantity/i },
  { key: "amount", label: "Amount", re: /without multiplier|amount in local currency donated|^amount$|^total$|donation amount|amount/i },
  { key: "status", label: "Payment status", re: /payment\s*status|^status$/i },
  { key: "date", label: "Purchase date and time", re: /date.*(hh|time)|^date$|created|^date/i },
  { key: "seller", label: "Sold by", re: /sold\s*by|seller|sales\s*person/i },
  { key: "ambassador", label: "Ambassador", re: /ambassador/i },
  { key: "privacy", label: "Anonymous / privacy", re: /^privacy$|anonymous/i },
  { key: "id", label: "Transaction ID", re: /^txn\s*id$|(donation|transaction|order|payment|receipt)\s*(id|#|no|number)|^id$/i },
];
const AVOID = /team|dedicat|honou?r|memory|display|card|referr|fundrais|comment|message|note|address|city|zip|country|^state|gift\s*aid|utm|stripe|fee|pledge|exchange|subscription|installment/i;
// split a pattern on its top-level "|" only, so grouped alternatives stay whole
function topLevelAlts(src) {
  const out = []; let depth = 0, cur = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { cur += c + src[++i]; continue; }
    if (c === "(") depth++; else if (c === ")") depth--;
    if (c === "|" && depth === 0) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}
function detectColumns(header) {
  const map = {}, used = new Set();
  for (const f of FIELDS) {
    // try each alternative in order, so the most specific heading wins
    const alts = topLevelAlts(f.re.source).map(s => new RegExp(s, "i"));
    let best = -1;
    for (const alt of alts) {
      header.forEach((h, i) => {
        if (best >= 0 || used.has(i)) return;
        const hh = norm(h);
        if (!hh || !alt.test(hh)) return;
        if (AVOID.test(hh) && !["seller", "ambassador"].includes(f.key)) return;
        if (f.key === "amount" && /id$|date|number|#|count|ticket|perk|fee|tip|net/i.test(hh)) return;
        if (f.key === "pkg" && /id$|date|count|qty|quantity|number|amount|discount/i.test(hh)) return;
        if (f.key === "date" && /update|birth|pledge|due|reminder|batch/i.test(hh)) return;
        if (f.key === "phone" && /prefix/i.test(hh)) return;
        best = i;
      });
      if (best >= 0) break;
    }
    if (best >= 0) { map[f.key] = best; used.add(best); }
  }
  return map;
}
function findHeaderRow(rows) {
  let best = 0, bestScore = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const score = rows[r].filter(c => { const s = norm(c); return s && FIELDS.some(f => f.re.test(s)); }).length;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}
const EXCLUDE_STATUS = /refund|fail|cancel|declin|void|chargeback|reject|revers|dispute|error|unpaid/i;
function toNumber(v) { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
function parseDate(v, header) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = norm(v); if (!s) return null;
  const utc = /utc/i.test(header);
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (m) {
    const dayFirst = /dd\s*\/\s*mm/i.test(header) || +m[1] > 12;
    let [d, mo] = dayFirst ? [+m[1], +m[2]] : [+m[2], +m[1]];
    let h = +(m[4] || 0); if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0);
    const args = [+m[3], mo - 1, d, h, +(m[5] || 0), +(m[6] || 0)];
    const dt = utc ? new Date(Date.UTC(...args)) : new Date(...args);
    return isNaN(dt) ? null : dt;
  }
  const dt = new Date(utc && !/z|[+-]\d\d:?\d\d$/i.test(s) ? s.replace(" ", "T") + "Z" : s);
  return isNaN(dt) ? null : dt;
}
const isTrue = v => /^(true|yes|1|y|anonymous)$/i.test(norm(v));

/* ---------- Desk state ---------- */
const S = {
  source: "sample", fileName: "", header: [], rows: [], map: {}, campaign: null,
  overrides: store.get("overrides", {}),
  selected: null, localDraws: store.get("localDraws", []), practice: [],
  processed: null, pool: null, keyHash: new Map(),
  flags: { oneWin: store.get("oneWin", false), perTicket: false, short: false, onlyNew: false, showPractice: store.get("showPractice", true) },
};
function stashDesk() {
  if (S.source === "sample") { session.del("desk"); session.set("sampleFlags", S.flags); return true; }
  const ok = session.set("desk", { header: S.header, rows: S.rows, map: S.map, campaign: S.campaign, fileName: S.fileName, selected: S.selected, flags: S.flags });
  if (!ok) toast("This file is too big to keep through the page reload. Load it again after the drawing if you need it.");
  return ok;
}

/* ---------- Processing ---------- */
function campaignsIn() {
  if (S.map.campaign == null) return [];
  const c = new Map();
  for (const r of S.rows) { const k = norm(r[S.map.campaign]); if (!k) continue; const d = parseDate(r[S.map.date], S.header[S.map.date] || ""); const e = c.get(k) || { name: k, rows: 0, last: 0 }; e.rows++; if (d && +d > e.last) e.last = +d; c.set(k, e); }
  return [...c.values()];
}
function pickCampaign(list) {
  if (list.length < 2) return null;
  const raffle = list.filter(c => /raffle|chanuk|hanuk|illumin/i.test(c.name));
  const pool = raffle.length ? raffle : list;
  return pool.sort((a, b) => b.last - a.last || b.rows - a.rows)[0].name;
}
function process() {
  const { rows, map } = S;
  const dateHeader = map.date != null ? S.header[map.date] : "";
  const entrants = new Map(); const groups = new Map();
  let counted = 0, excluded = 0, otherCampaign = 0, latest = null, total = 0, noDate = 0;
  const excludedRows = [], purchases = [];
  rows.forEach((r, i) => {
    const get = k => map[k] != null ? r[map[k]] : "";
    if (r.every(c => !norm(c))) return;
    if (S.campaign && map.campaign != null && norm(get("campaign")) !== S.campaign) { otherCampaign++; return; }
    total++;
    const status = norm(get("status"));
    const name = fixName(norm(map.first != null || map.last != null ? `${norm(get("first"))} ${norm(get("last"))}` : get("name")) || norm(get("name")));
    const email = norm(get("email")).toLowerCase();
    if (status && EXCLUDE_STATUS.test(status)) { excluded++; excludedRows.push({ name, status }); return; }
    const date = parseDate(get("date"), dateHeader);
    if (date && (!latest || date > latest)) latest = date;
    if (!date) noDate++;
    const amount = toNumber(get("amount"));
    const seller = fixName(norm(get("seller")) || norm(get("ambassador")));
    const rowId = norm(get("id")) || "row" + (i + 1);
    let parts = splitPackages(get("pkg"), get("qty"), map.qty != null);
    const blank = !parts.length;
    if (blank) parts = [{ text: "", qty: 1 }];
    const rowPurchases = [];
    for (const p of parts) {
      // a row with no package chosen is decided on its own, since it could be anything
      const key = blank ? `(no package) ${rowId}` : p.text.toLowerCase().replace(/[’']/g, "'");
      let rule = S.overrides[key], how = rule ? "you" : "";
      if (!rule) { rule = blank ? (AMOUNT_FALLBACK[amount] || null) : matchPackage(p.text); how = rule ? (blank ? "amount" : "auto") : ""; }
      const g = groups.get(key) || { key, text: blank ? `No package chosen · $${fmt(amount)}` : p.text, blank, who: blank ? name : "", rule, how, rows: 0, qty: 0, examples: [] };
      g.rows++; g.qty += p.qty; if (g.examples.length < 3 && name && !blank) g.examples.push(name);
      groups.set(key, g);
      if (rule && rule !== "skip") {
        const tickets = {};
        for (const [prize, k] of Object.entries(PKG[rule].per)) tickets[prize] = k * p.qty;
        rowPurchases.push({ tickets, line: `${PKG[rule].short}${p.qty > 1 ? " ×" + p.qty : ""}`, rule, qty: p.qty });
      }
    }
    if (!rowPurchases.length) return;
    counted++;
    const ekey = email || ("name:" + name.toLowerCase()) || ("row:" + i);
    const e = entrants.get(ekey) || { key: ekey, name: name || "(no name)", email, phone: "", private: false, purchases: [] };
    if (!e.phone) e.phone = norm(get("phone"));
    if (map.privacy != null && isTrue(get("privacy"))) e.private = true;
    for (const rp of rowPurchases) { const pu = { ...rp, ekey, date, seller, rowId }; e.purchases.push(pu); purchases.push(pu); }
    entrants.set(ekey, e);
  });
  const groupList = [...groups.values()].sort((a, b) => (a.rule ? 1 : 0) - (b.rule ? 1 : 0) || (a.blank - b.blank) || b.rows - a.rows);
  S.processed = { entrants: [...entrants.values()], purchases, groups: groupList, counted, excluded, excludedRows, otherCampaign, latest, total, noDate };
}

// Results that count: the page's saved results, plus any kept only in this browser when it couldn't save the page.
function officialDraws() {
  if (S.source === "sample") return S.practice;
  const ids = new Set(officialResults().map(r => r.id));
  return officialResults().concat(S.localDraws.filter(d => !ids.has(d.id)));
}
function nightRecord(n) { return officialDraws().filter(d => d.night === n && d.status !== "void").sort((a, b) => b.drawnAt.localeCompare(a.drawnAt))[0]; }
// The list for a night is frozen the moment its first drawing happens; later sales never change it.
// practice draws never freeze a list
function closeTime(n) { const t = officialDraws().filter(d => d.night === n && !d.practice).map(d => d.drawnAt).sort()[0]; return t ? new Date(t) : null; }
function lastDrawBefore(n) { const t = officialDraws().filter(d => d.night < n && d.status !== "void" && !d.practice).map(d => d.drawnAt).sort().pop(); return t ? new Date(t) : null; }

async function hashKey(k) { if (!S.keyHash.has(k)) S.keyHash.set(k, (await sha256(k)).slice(0, 16)); return S.keyHash.get(k); }
async function buildPool(night) {
  const N = NIGHTS[night - 1]; const prize = N.prize;
  const cutoff = closeTime(night), since = lastDrawBefore(night);
  const winners = S.flags.oneWin ? new Set(officialDraws().filter(d => d.status !== "void" && d.night < night).map(d => d.keyHash)) : new Set();
  const list = [];
  let lateLeftOut = 0;
  for (const e of S.processed.entrants) {
    const parts = [];
    for (const pu of e.purchases) {
      const k = pu.tickets[prize] || 0; if (!k) continue;
      if (cutoff && pu.date && pu.date > cutoff) { lateLeftOut += k; continue; }
      parts.push({ count: k, line: pu.line, seller: pu.seller, date: pu.date, isNew: !!(since && pu.date && pu.date > since) });
    }
    if (!parts.length) continue;
    parts.sort((a, b) => (a.date ? +a.date : 0) - (b.date ? +b.date : 0));
    list.push({ key: e.key, name: e.name, email: e.email, phone: e.phone, private: e.private, keyHash: await hashKey(e.key), parts, count: parts.reduce((s, p) => s + p.count, 0), isNew: parts.some(p => p.isNew) });
  }
  const removed = list.filter(e => winners.has(e.keyHash));
  const entries = list.filter(e => !winners.has(e.keyHash))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.key.localeCompare(b.key));
  let next = 1;
  for (const e of entries) { e.from = next; for (const p of e.parts) { p.from = next; p.to = next + p.count - 1; next = p.to + 1; } e.to = next - 1; }
  const total = next - 1;
  const newTickets = entries.reduce((s, e) => s + e.parts.filter(p => p.isNew).reduce((t, p) => t + p.count, 0), 0);
  const canon = entries.map(e => `${e.from}-${e.to}\t${e.name}\t${e.keyHash}`).join("\n");
  const fp = (await sha256(`TGA-${night}-${prize}\n${canon}`)).slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");
  return { night, prize, entries, total, fp, removed, cutoff, since, newTickets, lateLeftOut };
}
function ticketOwner(pool, ticket) {
  let lo = 0, hi = pool.entries.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1, e = pool.entries[mid]; if (ticket < e.from) hi = mid - 1; else if (ticket > e.to) lo = mid + 1; else return { entry: e, part: e.parts.find(p => ticket >= p.from && ticket <= p.to) }; }
  return null;
}
// Single-prize tickets bought after that prize was already drawn can never be drawn.
function strandedPurchases() {
  const out = [];
  for (const pu of S.processed.purchases) {
    if (!pu.date) continue;
    const live = Object.keys(pu.tickets).map(Number).filter(p => { const c = closeTime(NIGHT_OF[p]); return !c || pu.date <= c; });
    if (!live.length) { const e = S.processed.entrants.find(x => x.key === pu.ekey); out.push({ name: e ? e.name : "", line: pu.line, date: pu.date, seller: pu.seller }); }
  }
  return out;
}

/* ---------- Desk rendering ---------- */
function renderChips() {
  const c = $("modeChips"); if (!c) return; c.replaceChildren();
  if (S.source === "sample") c.append(el("span", { class: "chip practice" }, el("span", { class: "dot" }), "Practice: sample data"));
  else c.append(el("span", { class: "chip live" }, el("span", { class: "dot" }), "Live file loaded"));
  c.append(el("span", { class: "chip " + (FEED.connected ? "live" : "warn"), text: FEED.connected ? "Connected to the live view" : "Connecting to the live view…" }));
}
function renderNights() {
  const box = $("nights"); box.replaceChildren();
  for (const N of NIGHTS) {
    const rec = nightRecord(N.n);
    const flames = el("span", { class: "flames", "aria-hidden": "true" }, ...Array.from({ length: 8 }, (_, i) => el("i", { class: i < N.n ? "on" : "" })));
    box.append(el("button", { class: "night", type: "button", "aria-pressed": String(S.selected === N.n), onclick: () => selectNight(N.n) },
      el("img", { src: `img/prize-${N.prize}.jpg`, alt: "", loading: "lazy" }),
      el("div", { class: "body" },
        el("div", { class: "n" }, el("span", { class: "eyebrow", text: `Night ${N.n}` }), flames),
        el("div", { class: "prize", text: `#${N.prize} ${PRIZES[N.prize].name}` }),
        el("div", { class: "when", text: N.draw === N.light ? N.light : `Lit ${N.light} · drawn ${N.draw}` }),
        el("div", { class: "status" + (rec ? " won" : ""), text: rec ? `${rec.practice ? "Practice: " : "Won by "}${rec.name}` : (S.selected === N.n ? "Selected" : "Not drawn yet") }))));
  }
}
function colLetter(i) { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function renderLoad() {
  const P = S.processed;
  $("fileName").textContent = S.source === "sample" ? "Sample export loaded (made-up names)" : S.fileName;
  $("fileHint").textContent = S.source === "sample"
    ? "Practice with this. On the night, download the donations export from CauseMatch right before the drawing and drop it here."
    : `${fmt(P.total)} purchases in this raffle${P.latest ? " · newest " + when(P.latest) : ""}. Load a fresh download before each drawing.`;
  const camps = campaignsIn();
  $("campaignRow").hidden = camps.length < 2;
  if (camps.length >= 2) {
    const sel = $("campaignSel"); sel.replaceChildren(...camps.sort((a, b) => b.last - a.last).map(c => el("option", { value: c.name, text: `${c.name} (${fmt(c.rows)} rows)` })));
    sel.value = S.campaign || "";
  }
  const needs = P.groups.filter(g => !g.rule).length;
  $("loadStats").replaceChildren(
    el("div", { class: "stat" }, el("b", { text: fmt(P.counted) }), el("span", { text: "purchases counted" })),
    el("div", { class: "stat" }, el("b", { text: fmt(P.entrants.length) }), el("span", { text: "people in the raffle" })),
    el("div", { class: "stat" + (P.excluded ? " warn" : "") }, el("b", { text: fmt(P.excluded) }), el("span", { text: "refunded or failed, left out" })),
    el("div", { class: "stat" + (needs ? " bad" : "") }, el("b", { text: fmt(needs) }), el("span", { text: needs === 1 ? "item needs a decision" : "items need a decision" })),
  );
  const notes = $("loadNotices"); notes.replaceChildren();
  const missing = [];
  if (S.map.pkg == null) missing.push("package (perk)");
  if (S.map.first == null && S.map.last == null && S.map.name == null) missing.push("name");
  if (S.map.email == null) missing.push("email");
  if (missing.length) notes.append(el("div", { class: "notice bad", text: `Couldn't find a ${missing.join(", ")} column. Pick it under "Columns used from the file" below.` }));
  if (P.otherCampaign) notes.append(el("div", { class: "notice good", text: `${fmt(P.otherCampaign)} rows from other campaigns in this file are left out.` }));
  if (S.map.date == null && S.source !== "sample") notes.append(el("div", { class: "notice warn", text: "No purchase date column was found, so purchases made after a drawing can't be kept out of that night's list." }));
  if (S.map.seller == null && S.map.ambassador == null && S.source !== "sample") notes.append(el("div", { class: "notice warn", text: "No \"Sold by\" or ambassador column was found, so the seller won't be shown." }));
  if (S.map.status == null && S.source !== "sample") notes.append(el("div", { class: "notice warn", text: "No payment status column was found, so refunds can't be left out automatically. Check CauseMatch for refunds before drawing." }));

  const grid = $("mapGrid"); grid.replaceChildren();
  for (const f of FIELDS) {
    const sel = el("select", { id: "map-" + f.key, onchange: e => { const v = e.target.value; if (v === "") delete S.map[f.key]; else S.map[f.key] = +v; if (f.key === "campaign") S.campaign = pickCampaign(campaignsIn()); stashDesk(); refresh(); } },
      el("option", { value: "", text: "(not in file)" }),
      ...S.header.map((h, i) => el("option", { value: String(i), text: `${colLetter(i)}: ${norm(h) || "(blank heading)"}` })));
    sel.value = S.map[f.key] != null ? String(S.map[f.key]) : "";
    grid.append(el("label", { for: "map-" + f.key }, f.label, sel));
  }
}
function pkgSelect(g) {
  const sel = el("select", { "aria-label": `What is "${g.text}"?`, onchange: e => {
    const v = e.target.value;
    if (v === "") delete S.overrides[g.key]; else S.overrides[g.key] = v;
    store.set("overrides", S.overrides); refresh();
  } },
    el("option", { value: "", text: g.rule && g.how !== "you" ? "Matched automatically" : "Choose what this is…" }),
    el("option", { value: "skip", text: "Not a raffle ticket (leave out)" }),
    ...PACKAGES.map(p => el("option", { value: p.id, text: `${p.label} · $${p.price}` })));
  sel.value = g.how === "you" ? g.rule : "";
  return sel;
}
function perPrizeText(rule) {
  if (!rule || rule === "skip") return "";
  const per = PKG[rule].per, ks = Object.keys(per);
  if (ks.length === 8) return `${per[1]} in every prize`;
  if (ks.length === 4) return `1 in each ${+ks[0] === 1 ? "Gold (#1–4)" : "Silver (#5–8)"}`;
  return `1 in #${ks[0]} only`;
}
function renderPackages() {
  const P = S.processed;
  const needs = P.groups.filter(g => !g.rule);
  const box = $("reviewBox"); box.replaceChildren();
  if (needs.length) {
    box.append(el("div", { class: "notice bad" },
      `${needs.length === 1 ? "One item" : needs.length + " items"} in the file didn't match a raffle package. Choose what each one is. Your choices are remembered for later files.`,
      needs.some(g => g.blank) ? el("div", { style: "margin-top:8px" }, el("button", { class: "btn", type: "button", onclick: () => {
        needs.filter(g => g.blank).forEach(g => S.overrides[g.key] = "skip"); store.set("overrides", S.overrides); refresh();
      }, text: "Leave out every purchase with no package chosen" })) : ""));
  } else {
    box.append(el("div", { class: "notice good", text: "Every package in the file is matched. Check the ticket counts below look right." }));
  }
  const stranded = strandedPurchases();
  if (stranded.length) box.append(el("div", { class: "notice warn" },
    `${stranded.length === 1 ? "One purchase was" : stranded.length + " purchases were"} made after its prize was already drawn, so it can't win anything: `,
    stranded.slice(0, 6).map(s => `${s.name} (${s.line}, ${when(s.date)}${s.seller ? ", sold by " + s.seller : ""})`).join("; "),
    stranded.length > 6 ? ` and ${stranded.length - 6} more.` : ".",
    " Close each prize's package in CauseMatch after its drawing to stop this."));
  $("pkgSummary").textContent = `${P.groups.length} package names found`;
  $("pkgTable").replaceChildren(
    el("thead", null, el("tr", null, el("th", { text: "In the file" }), el("th", { text: "Counts as" }), el("th", { text: "Tickets" }), el("th", { class: "r", text: "Rows" }), el("th", { class: "r", text: "Qty" }), el("th", { text: "Decision" }))),
    el("tbody", null, ...P.groups.map(g => el("tr", null,
      el("td", null, el("div", { text: g.text }), g.who ? el("div", { class: "muted small", text: g.who }) : g.examples.length ? el("div", { class: "muted small", text: "e.g. " + g.examples.join(", ") }) : null),
      el("td", null, !g.rule ? el("span", { class: "chip bad", text: "Needs a decision" }) : g.rule === "skip" ? el("span", { class: "chip quiet", text: "Left out" }) :
        el("div", { class: "pk" }, el("img", { src: PKG[g.rule].img, alt: "", loading: "lazy" }), el("div", null, PKG[g.rule].label, g.how === "amount" ? el("div", { class: "muted small", text: "matched by price" }) : g.how === "you" ? el("div", { class: "muted small", text: "your choice" }) : null))),
      el("td", { text: perPrizeText(g.rule) }),
      el("td", { class: "r", text: fmt(g.rows) }), el("td", { class: "r", text: fmt(g.qty) }),
      el("td", null, pkgSelect(g))))));
}
let poolSeq = 0;
async function renderPool() {
  const seq = ++poolSeq;
  const pool = await buildPool(S.selected);
  if (seq !== poolSeq) return;
  S.pool = pool;
  const N = NIGHTS[S.selected - 1];
  $("poolFor").textContent = `Night ${N.n} · Prize #${N.prize} ${PRIZES[N.prize].name} · drawn ${N.draw}`;
  const top = pool.entries.reduce((m, e) => Math.max(m, e.count), 0);
  $("poolStats").replaceChildren(
    el("div", { class: "stat" }, el("b", { text: fmt(pool.total) }), el("span", { text: "tickets in this drawing" })),
    el("div", { class: "stat" }, el("b", { text: fmt(pool.entries.length) }), el("span", { text: "people holding them" })),
    el("div", { class: "stat new" }, el("b", { text: pool.since ? fmt(pool.newTickets) : "–" }), el("span", { text: pool.since ? "tickets added since the last drawing" : "new since last drawing (after night 1)" })),
    el("div", { class: "stat" }, el("b", { text: pool.total ? (100 * top / pool.total).toFixed(1) + "%" : "–" }), el("span", { text: "best single chance" })),
    el("div", { class: "stat" }, el("b", { class: "mono", style: "font-size:15px;padding-top:6px", text: pool.fp }), el("span", { text: "list fingerprint" })),
  );
  const notes = $("poolNotices"); notes.replaceChildren();
  if (pool.cutoff) notes.append(el("div", { class: "notice good", text: `This list was frozen when the prize was drawn (${when(pool.cutoff)}). ${pool.lateLeftOut ? fmt(pool.lateLeftOut) + " tickets bought after that are left out of it." : "Later purchases don't change it."}` }));
  else if (pool.since) notes.append(el("div", { class: "notice new", text: `Purchases since the last drawing (${when(pool.since)}) are marked New. They count for this prize and every prize still to come.` }));
  $("openStage").disabled = !pool.total;
  renderPoolTable();
}
function renderPoolTable() {
  const pool = S.pool; if (!pool) return;
  const q = norm($("poolSearch").value).toLowerCase().replace(/^#/, "");
  let rows = pool.entries;
  if (S.flags.onlyNew) rows = rows.filter(e => e.isNew);
  if (q) rows = /^\d+$/.test(q) ? rows.filter(e => +q >= e.from && +q <= e.to)
    : rows.filter(e => e.name.toLowerCase().includes(q) || e.email.includes(q) || e.parts.some(p => (p.seller || "").toLowerCase().includes(q)));
  $("poolCount").textContent = (q || S.flags.onlyNew) ? `${fmt(rows.length)} of ${fmt(pool.entries.length)} shown` : (pool.removed.length ? `${pool.removed.length} earlier ${pool.removed.length === 1 ? "winner" : "winners"} left out` : "");
  const shown = rows.slice(0, 400);
  $("poolTable").replaceChildren(
    el("thead", null, el("tr", null, el("th", { text: "Ticket numbers" }), el("th", { text: "Name" }), el("th", { class: "r", text: "Tickets" }), el("th", { text: "Packages" }), el("th", { text: "Sold by" }))),
    el("tbody", null, ...shown.map(e => el("tr", null,
      el("td", { class: "mono", text: e.from === e.to ? `${e.from}` : `${e.from}–${e.to}` }),
      el("td", null, el("div", { text: e.name }), el("div", { class: "muted small", text: e.email })),
      el("td", { class: "r", text: fmt(e.count) }),
      el("td", null, ...e.parts.map(p => el("span", { class: "tag" + (p.isNew ? " new" : ""), title: p.date ? "Bought " + when(p.date) : "", text: (p.isNew ? "New · " : "") + p.line + (p.count > 1 ? ` (${p.count})` : "") }))),
      el("td", { class: "small", text: [...new Set(e.parts.map(p => p.seller).filter(Boolean))].join(", ") || "–" })))),
    rows.length > 400 ? el("tfoot", null, el("tr", null, el("td", { colspan: "5", class: "muted", text: `Showing the first 400. The download has all ${fmt(rows.length)}.` }))) : "");
}
function renderLog() {
  const list = officialDraws().concat(S.source === "sample" ? [] : S.practice).sort((a, b) => a.night - b.night || a.drawnAt.localeCompare(b.drawnAt));
  $("logWhere").textContent = "Sent to the live view and kept by the site";
  const t = $("logTable");
  if (!list.length) { t.replaceChildren(el("tbody", null, el("tr", null, el("td", { class: "muted", text: "No drawings yet. Each winner appears here the moment they're drawn, with the winning ticket, who sold it, and the list fingerprint." })))); return; }
  t.replaceChildren(
    el("thead", null, el("tr", null, ...["Night", "Prize", "Winner", "Ticket", "Sold by", "Pool", "Fingerprint", "Drawn", "", "Share"].map((h, i) => el("th", { class: i === 3 || i === 5 ? "r" : "", text: h })))),
    el("tbody", null, ...list.map(d => el("tr", { class: d.status === "void" ? "void" : "" },
      el("td", { text: d.night }), el("td", { text: `#${d.prize} ${PRIZES[d.prize].name}` }),
      el("td", { text: d.name }),
      el("td", { class: "r mono", text: `#${fmt(d.ticket)}` }),
      el("td", null, d.seller || "–", d.pkg ? el("div", { class: "muted small", text: d.pkg }) : null),
      el("td", { class: "r", text: fmt(d.poolTickets) }),
      el("td", { class: "mono small", text: d.fp }),
      el("td", { class: "small", text: new Date(d.drawnAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) }),
      el("td", { class: "keep" }, d.practice ? el("span", { class: "chip practice", text: "Practice" }) : d.status === "void" ? el("span", { class: "chip bad", text: "Void: " + (d.voidReason || "") }) : d.localOnly ? el("span", { class: "chip warn", text: "This browser only" }) : el("span", { class: "chip live", text: "Official" })),
      el("td", { class: "keep" }, d.status === "void" ? "" : el("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, ...logShare(d)))))));
}
function logShare(d) {
  const pic = el("button", { class: "btn small", type: "button", text: "Picture" });
  const clip = el("button", { class: "btn small", type: "button", text: "Clip" });
  pic.addEventListener("click", async () => { pic.disabled = true; try { await winnerPicture(d); } catch { toast("Couldn't make the picture here."); } pic.disabled = false; });
  clip.addEventListener("click", async () => {
    clip.disabled = true;
    try { const names = await namesForNight(d.night); await winnerClip(d, names, p => clip.textContent = `${Math.round(p * 100)}%`); }
    catch { toast("Couldn't make the clip in this browser. Try Chrome or Safari."); }
    clip.textContent = "Clip"; clip.disabled = false;
  });
  return [pic, clip];
}
function renderPubState() {
  const L = STATE.live;
  $("pubState").textContent = L ? `Live screen: ${L.phase === "test" ? "test" : L.phase === "ready" ? "night " + L.night + ", waiting to draw" : L.phase === "drawn" ? "night " + L.night + " winner" : "cleared"} (${hhmm(L.at)})` : "Live screen: showing the schedule";
}

async function refresh() {
  process();
  if (S.selected == null) S.selected = (NIGHTS.find(N => !nightRecord(N.n)) || NIGHTS[7]).n;
  renderChips(); renderNights(); renderLoad(); renderPackages(); renderLog(); renderPubState();
  await renderPool();
}
function selectNight(n) { S.selected = n; renderNights(); renderPool(); }

/* ---------- File loading ---------- */
function loadTable(aoa, name, source, keepSelected) {
  const h = findHeaderRow(aoa);
  S.header = (aoa[h] || []).map(norm);
  S.rows = aoa.slice(h + 1).map(r => S.header.map((_, i) => r[i] ?? ""));
  S.map = detectColumns(S.header);
  S.campaign = pickCampaign(campaignsIn());
  S.fileName = name; S.source = source;
  if (!keepSelected) S.selected = null;
  $("mapDetails").open = false;
  stashDesk();
  return refresh();
}
async function readFile(file) {
  if (!window.XLSX) { toast("The spreadsheet reader didn't load. Check the connection and reload the page."); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", raw: true, cellDates: true });
    let best = null;
    for (const n of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", raw: true, blankrows: false });
      if (!best || aoa.length > best.aoa.length) best = { n, aoa };
    }
    if (!best || best.aoa.length < 2) { toast("That file has no rows to read."); return; }
    // dates from Excel become text so they survive the page reload after each drawing
    const aoa = best.aoa.map(r => r.map(c => c instanceof Date ? c.toISOString() : c));
    await loadTable(aoa, file.name, "file");
    toast(`Loaded ${file.name}`);
  } catch (err) { toast("Couldn't read that file. Save it from CauseMatch as .xlsx or .csv and try again."); }
}

/* ---------- Sample export, shaped like a real CauseMatch file (made-up people) ---------- */
function sampleData() {
  let seed = 5787; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const firsts = ["Leah", "Rivka", "Chaya", "Miriam", "Esther", "Sarah", "Devorah", "Rachel", "Malka", "Shira", "Yael", "Tova", "Dina", "Batsheva", "Naomi", "Yosef", "Dovid", "Moshe", "Eli", "Avi", "Shmuel", "Binyamin", "Ari", "Yehuda"];
  const lasts = ["Adler", "Baum", "Feld", "Gross", "Hirsch", "Kessler", "Klein", "Lerner", "Mandel", "Roth", "Schreiber", "Stern", "Weiss", "Wolf", "Zeller", "Brenner", "Falk", "Gelb"];
  const sellers = ["Ambassador A", "Ambassador B", "Ambassador C", "Ambassador D", "Ambassador E", ""];
  const weights = [["10 Tickets in Each Package", 500, 3], ["5 Tickets in Each Package", 360, 4], ["2 Tickets in Each Package", 250, 5], ["1 Ticket in Each Package", 180, 8], ["1 Ticket in Each Gold Package", 150, 5], ["1 Ticket in Each Silver Package", 100, 5],
    ["Summer On Us", 50, 4], ["Crowning Glory", 50, 3], ["Siyum Hashas", 50, 2], ["Getaway for 2", 50, 3], ["Grill Master", 36, 2], ["Shopping Spree", 36, 3], ["Library of Your Dreams", 36, 2], ["Night Out", 36, 2]];
  const bag = weights.flatMap(([n, p, w]) => Array(w).fill([n, p]));
  const out = [["FIRST NAME", "LAST NAME", "EMAIL", "CAMPAIGN", "DONATION AMOUNT IN DEFAULT CURRENCY", "DATE (DD/MM/YYYY HH:MM) UTC", "PHONE", "TXN ID", "PRIVACY", "PAYMENT STATUS", "SOLD BY NAME", "PERK TITLE", "PERK AMOUNT", "PERK QUANTITY"]];
  const people = [];
  for (let i = 0; i < 46; i++) { const f = pick(firsts), l = pick(lasts); people.push([f, l, `${f}.${l}${i}`.toLowerCase() + "@example.com", `713555${String(1000 + Math.floor(rnd() * 8999))}`, pick(sellers)]); }
  const pad = n => String(n).padStart(2, "0");
  const stamp = d => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  let id = 880100;
  for (let i = 0; i < 70; i++) {
    const p = people[i < 46 ? i : Math.floor(rnd() * 46)];
    const k = rnd() < 0.1 ? 2 : 1;
    const picks = Array.from({ length: k }, () => pick(bag));
    const q = picks.map(() => rnd() < 0.1 ? 2 : 1);
    const d = new Date(Date.now() - Math.floor((1 + rnd() * 20) * 864e5));
    out.push([p[0], p[1], p[2], "Illuminations: TGA Chanukah Raffle", String(picks.reduce((s, x, j) => s + x[1] * q[j], 0)), stamp(d), p[3], String(id++), rnd() < 0.15 ? "TRUE" : "FALSE", "PAYMENT SUCCEEDED", p[4],
      "'" + picks.map(x => x[0]).join(","), "'" + picks.map(x => x[1]).join(","), "'" + q.join(",")]);
  }
  out.push(["Tova", "Brenner", "tova.brenner90@example.com", "Illuminations: TGA Chanukah Raffle", "180", stamp(new Date(Date.now() - 3 * 864e5)), "7135554410", String(id++), "FALSE", "REFUNDED", "Ambassador B", "'1 Ticket in Each Package", "'180", "'1"]);
  out.push(["Naomi", "Falk", "naomi.falk92@example.com", "Illuminations: TGA Chanukah Raffle", "18", stamp(new Date(Date.now() - 2 * 864e5)), "7135553301", String(id++), "FALSE", "PAYMENT SUCCEEDED", "", "", "", ""]);
  out.push(["Avi", "Gelb", "avi.gelb91@example.com", "TGA Campaign 2026", "360", "12/05/2026 15:00", "7135557720", String(id++), "FALSE", "PAYMENT SUCCEEDED", "", "", "", ""]);
  return out;
}

/* ---------- Exports ---------- */
const TYPES = { jpg: "image/jpeg", mp4: "video/mp4", gif: "image/gif", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
async function save(filename, data) {
  const type = TYPES[filename.split(".").pop()] || "application/octet-stream";
  const blob = data instanceof Blob && data.type ? data : new Blob([data], { type });
  // on phones, offer the share sheet (WhatsApp, Photos) when the browser allows it
  try {
    const file = new File([blob], filename, { type });
    if (/iPhone|iPad|Android/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast("Saved " + filename);
}
function sheetName(s) { return s.replace(/[:\\/?*\[\]]/g, "").slice(0, 31); }
const sellersOf = e => [...new Set(e.parts.map(p => p.seller).filter(Boolean))].join(", ");
async function workbook() {
  if (!window.XLSX) { toast("The spreadsheet writer didn't load. Reload the page."); return; }
  const wb = XLSX.utils.book_new();
  const P = S.processed;
  const summary = [["Name", "Email", "Phone", "Sold by", ...NIGHTS.map(N => `N${N.n} #${N.prize} ${PRIZES[N.prize].name}`)]];
  for (const e of [...P.entrants].sort((a, b) => a.name.localeCompare(b.name))) {
    const t = {}; e.purchases.forEach(pu => Object.entries(pu.tickets).forEach(([p, k]) => t[p] = (t[p] || 0) + k));
    summary.push([e.name, e.email, e.phone, [...new Set(e.purchases.map(p => p.seller).filter(Boolean))].join(", "), ...NIGHTS.map(N => t[N.prize] || 0)]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "All entrants");
  for (const N of NIGHTS) {
    const pool = await buildPool(N.n);
    const aoa = [[`Night ${N.n} · Prize #${N.prize} ${PRIZES[N.prize].name} · drawn ${N.draw}`], [`${pool.total} tickets · ${pool.entries.length} people · fingerprint ${pool.fp}${pool.cutoff ? " · frozen at " + pool.cutoff.toISOString() : ""}`], []];
    if (S.flags.perTicket) {
      aoa.push(["Ticket", "Name", "Email", "Phone", "Package", "Sold by", "Bought"]);
      for (const e of pool.entries) for (const p of e.parts) for (let t = p.from; t <= p.to; t++) aoa.push([t, e.name, e.email, e.phone, p.line, p.seller, p.date ? p.date.toISOString() : ""]);
    } else {
      aoa.push(["First ticket", "Last ticket", "Tickets", "Name", "Email", "Phone", "Packages", "Sold by", "New since last drawing"]);
      for (const e of pool.entries) aoa.push([e.from, e.to, e.count, e.name, e.email, e.phone, e.parts.map(p => p.line).join("; "), sellersOf(e), e.isNew ? "yes" : ""]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(`N${N.n} #${N.prize} ${PRIZES[N.prize].name}`));
  }
  const bySeller = new Map();
  for (const pu of P.purchases) { const k = pu.seller || "(no seller)"; const s = bySeller.get(k) || { n: 0, t: 0 }; s.n++; s.t += Object.values(pu.tickets).reduce((a, b) => a + b, 0); bySeller.set(k, s); }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Sold by", "Packages sold", "Tickets across all prizes"], ...[...bySeller.entries()].sort((a, b) => b[1].t - a[1].t).map(([k, s]) => [k, s.n, s.t])]), "Sellers");
  const rev = [["In the file", "Counts as", "Rows", "Qty"], ...P.groups.map(g => [g.text + (g.who ? " · " + g.who : ""), !g.rule ? "NEEDS A DECISION" : g.rule === "skip" ? "Left out" : PKG[g.rule].label, g.rows, g.qty])];
  rev.push([], ["Refunded / failed rows left out"], ...P.excludedRows.map(r => [r.name, r.status]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rev), "Package check");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resultsAoa()), "Results");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  await save(`TGA-raffle-tickets-${stamp}.xlsx`, new Blob([out]));
}
function resultsAoa() {
  const list = officialDraws().concat(S.source === "sample" ? [] : S.practice).sort((a, b) => a.night - b.night || a.drawnAt.localeCompare(b.drawnAt));
  return [["Night", "Prize", "Winner", "Winning ticket", "Package it came from", "Sold by", "Tickets held", "Tickets in pool", "People in pool", "Fingerprint", "Drawn at", "Status", "Void reason", "Source file"],
    ...list.map(d => [d.night, `#${d.prize} ${PRIZES[d.prize].name}`, d.name, d.ticket, d.pkg || "", d.seller || "", d.held, d.poolTickets, d.poolEntrants, d.fp, d.drawnAt, d.practice ? "practice" : d.status, d.voidReason || "", d.file || ""])];
}

/* ===================================================================
   Draw stage (shared by both views)
   =================================================================== */
const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
function drawMenorah(lit, glowNight) {
  const m = $("menorah"); m.replaceChildren();
  const defs = svg("defs", {}), rg = svg("radialGradient", { id: "flameHalo" });
  [["0", "#fff1b8", "0.95"], ["0.35", "#ffc24a", "0.55"], ["1", "#ff8a1a", "0"]].forEach(([o, c, a]) => rg.append(svg("stop", { offset: o, "stop-color": c, "stop-opacity": a })));
  defs.append(rg); m.append(defs);
  const gold = "#e9c46a", metal = "#c9a64a";
  const xs = [40, 92, 144, 196, 324, 376, 428, 480];
  m.append(svg("rect", { x: 160, y: 196, width: 200, height: 12, rx: 4, fill: metal }));
  m.append(svg("rect", { x: 254, y: 104, width: 12, height: 94, fill: metal }));
  m.append(svg("rect", { x: 28, y: 116, width: 464, height: 9, rx: 4, fill: metal }));
  m.append(svg("rect", { x: 244, y: 64, width: 32, height: 9, rx: 3, fill: metal }));
  m.append(svg("rect", { x: 254, y: 72, width: 12, height: 44, fill: metal }));
  const candle = (x, y, on, glow) => {
    m.append(svg("rect", { x: x - 6, y, width: 12, height: 34, rx: 2, fill: "#ece7f4" }));
    const f = svg("path", { class: "flame-path", d: `M${x} ${y - 24} C ${x + 9} ${y - 12}, ${x + 6} ${y - 2}, ${x} ${y - 2} C ${x - 6} ${y - 2}, ${x - 9} ${y - 12}, ${x} ${y - 24} Z`, fill: gold, opacity: on ? 1 : 0.12 });
    if (glow) {
      const halo = svg("circle", { class: "halo", cx: x, cy: y - 12, r: 26, fill: "url(#flameHalo)" });
      m.append(halo);
      f.setAttribute("opacity", "0.12"); f.classList.add("ignite"); requestAnimationFrame(() => requestAnimationFrame(() => f.setAttribute("opacity", "1"))); }
    m.append(f);
  };
  candle(260, 30, true, false);
  // candles are added right to left: the rightmost is night 1
  xs.forEach((x, i) => { const order = 8 - i; candle(x, 82, order <= lit, order === glowNight); });
}
const stage = { rec: null, rolling: false, operator: false, timer: null };
function stageFrame(night, { operator, subtitle }) {
  const N = NIGHTS[night - 1];
  stage.operator = operator;
  $("stage").hidden = false; document.body.style.overflow = "hidden";
  document.documentElement.dataset.stage = "open";
  setHeat(0); updateSoundBtn();
  $("stShortWrap").hidden = !operator; $("stPracticeWrap").hidden = !operator; $("stShowWrap").hidden = true;
  $("stLive").hidden = operator;
  $("stClose").hidden = !operator;
  $("stWinners").hidden = true;
  $("buyLink").hidden = true;
  drawMenorah(N.n - 1, 0);
  $("stImg").src = `img/prize-${N.prize}.jpg`; $("stImg").alt = `Prize #${N.prize}: ${PRIZES[N.prize].name}`;
  $("stNight").textContent = `Night ${N.n} · Prize #${N.prize}`;
  $("stPrize").textContent = PRIZES[N.prize].name;
  $("stDetail").textContent = PRIZES[N.prize].blurb;
  $("stName").textContent = ""; $("stName").className = "st-name";
  $("stCount").textContent = ""; $("stSeller").textContent = "";
  $("stSub").textContent = subtitle || "";
  $("stMeta").replaceChildren();
  $("stControls").replaceChildren();
}
function closeStage() {
  if (stage.rolling || !stage.operator) return;
  clearTimeout(stage.timer);
  $("stage").hidden = true; document.body.style.overflow = "";
  delete document.documentElement.dataset.stage;
  updateSoundBtn();
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
  if (stage.operator) refresh();
}
// Flash every ticket in the drawing once, in random order (a name shows as many times as it has tickets),
// then slow down over the last few and land on the winner at the reveal time.
function shuffledOrder(n) { const o = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = randomBelow(i + 1); [o[i], o[j]] = [o[j], o[i]]; } return o; }
function rollTo(rec, revealAt, tickets, rollMs) {
  return new Promise(resolve => {
    stage.rolling = true;
    const nm = $("stName"), cnt = $("stCount");
    nm.className = "st-name rolling";
    const getList = () => { const l = typeof tickets === "function" ? tickets() : tickets; return l && l.length ? l : null; };
    const total = Math.max(1, rec.poolTickets || 1);
    const fastEnd = revealAt - SLOW_MS, fastStart = revealAt - (rollMs || REVEAL_MS);
    let order = null, orderFor = 0, shown = -1, slowNext = 0, nextHit = 0;
    const show = x => { nm.textContent = x.n; cnt.textContent = "Ticket #" + fmt(x.t); };
    const tick = () => {
      const now = Date.now();
      if (now >= revealAt) { stage.rolling = false; return resolve(); }
      const list = getList();
      if (now < fastStart) {
        nm.textContent = "Get ready"; cnt.textContent = `${fmt(total)} tickets in this drawing`;
      } else if (now < fastEnd) {
        const prog = (now - fastStart) / (fastEnd - fastStart);
        setHeat(0.15 + 0.6 * prog);
        if (now >= nextHit) { sfxHit(0.05 + 0.13 * prog); nextHit = now + 1000 / (13 + 11 * prog); }
        if (list) {
          if (!order || orderFor !== list.length) { order = shuffledOrder(list.length); orderFor = list.length; }
          const i = Math.min(order.length - 1, Math.floor((now - fastStart) / ((fastEnd - fastStart) / order.length)));
          if (i !== shown) { shown = i; show(list[order[i]]); }
        } else { nm.textContent = "#" + fmt(randomBelow(total) + 1); cnt.textContent = "Drawing…"; }
      } else if (now >= slowNext) {
        if (list) show(list[randomBelow(list.length)]); else nm.textContent = "#" + fmt(randomBelow(total) + 1);
        sfxTick();
        const p = (now - fastEnd) / SLOW_MS;
        setHeat(0.75 + 0.25 * p);
        slowNext = now + 90 + 520 * p * p;
      }
      stage.timer = setTimeout(tick, now < fastEnd ? 8 : 20);
    };
    tick();
  });
}
function showWinner(rec, fresh = true) {
  const N = NIGHTS[rec.night - 1];
  $("stName").textContent = rec.name; $("stName").className = "st-name won" + (fresh ? " landing" : "");
  setHeat(0);
  if (fresh) { sfxIgnite(); setTimeout(sfxFanfare, 150); requestAnimationFrame(() => { candleSparks(N.n); confetti(); }); $("stage").classList.remove("flash"); void $("stage").offsetWidth; $("stage").classList.add("flash"); }
  $("stCount").textContent = "";
  $("stSub").textContent = `Ticket #${fmt(rec.ticket)} of ${fmt(rec.poolTickets)} · held ${fmt(rec.held)} ${rec.held === 1 ? "ticket" : "tickets"}`;
  $("stSeller").textContent = rec.seller ? `Sold by ${rec.seller}${rec.pkg ? " · " + rec.pkg : ""}` : (rec.pkg || "");
  $("stMeta").replaceChildren(rec.practice ? "Practice draw, not recorded · " : "", "List fingerprint ", el("span", { class: "fp", text: rec.fp }));
  drawMenorah(N.n, N.n);
}
async function playReveal(rec, revealAt, operator, tickets, rollMs) {
  const list = typeof tickets === "function" ? tickets() : tickets;
  stage.names = list ? [...new Set(list.map(x => x.n))] : [];
  stageFrame(rec.night, { operator, subtitle: `${fmt(rec.poolTickets)} tickets · ${fmt(rec.poolEntrants)} people` });
  $("stMeta").replaceChildren("List fingerprint ", el("span", { class: "fp", text: rec.fp }));
  if (Date.now() < revealAt) await rollTo(rec, revealAt, tickets, rollMs);
  showWinner(rec, Date.now() - revealAt < 4000);
  if (operator) operatorControls("done");
}

/* ===================================================================
   Sound and celebration effects for the draw screen
   Sounds are made in the browser (no files). Phones only play sound after a tap,
   so viewers turn it on with the gold button; the organizer's Draw press counts.
   =================================================================== */
const REDUCED = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const SFX = { ctx: null, master: null, noise: null };
function soundWanted() {
  const v = document.documentElement.dataset.view;
  const pref = store.get(v === "desk" ? "soundDesk" : "soundWatch", null);
  return pref === null ? v === "desk" : pref;   // organizer: on unless muted; viewers: off until they tap
}
function audio() {
  if (!soundWanted()) return null;
  if (!SFX.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { SFX.ctx = new AC(); } catch { return null; }
    SFX.master = SFX.ctx.createGain(); SFX.master.gain.value = 0.55; SFX.master.connect(SFX.ctx.destination);
  }
  if (SFX.ctx.state === "suspended") SFX.ctx.resume().catch(() => {});
  return SFX.ctx.state === "running" ? SFX.ctx : null;
}
function unlockAudio() { if (soundWanted()) { audio(); setTimeout(updateSoundBtn, 50); } }
function noiseBuf(c) {
  if (SFX.noise) return SFX.noise;
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (SFX.noise = b);
}
// one stroke of the snare drumroll
function sfxHit(vol) {
  const c = audio(); if (!c) return;
  const t = c.currentTime, src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf(c); bp.type = "bandpass"; bp.frequency.value = 1700 + Math.random() * 300; bp.Q.value = 0.8;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
  src.connect(bp).connect(g).connect(SFX.master); src.start(t, Math.random() * 0.8); src.stop(t + 0.09);
}
// the click of each name in the slow-down, like a prize wheel
function sfxTick() {
  const c = audio(); if (!c) return;
  const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  o.type = "square"; o.frequency.setValueAtTime(2300, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.03);
  g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.035);
  o.connect(g).connect(SFX.master); o.start(t); o.stop(t + 0.04);
}
// the reveal: a bright rising arpeggio into a held chord, a soft cymbal and a few sparkles
function sfxFanfare() {
  const c = audio(); if (!c) return;
  const t0 = c.currentTime + 0.02;
  const note = (f, start, dur, vol, type = "triangle") => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + start); g.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + start + dur);
    o.connect(g).connect(SFX.master); o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
  };
  [523.25, 659.25, 783.99].forEach((f, i) => note(f, i * 0.09, 0.5, 0.16));
  [523.25, 659.25, 783.99, 1046.5].forEach(f => note(f, 0.3, 1.9, 0.11));
  note(261.63, 0.3, 1.9, 0.12, "sine");
  for (let i = 0; i < 9; i++) note(2000 + Math.random() * 2200, 0.35 + Math.random() * 1.1, 0.35, 0.035, "sine");
  const src = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf(c); hp.type = "highpass"; hp.frequency.value = 6500;
  g.gain.setValueAtTime(0.0001, t0 + 0.3); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.32); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.9);
  src.connect(hp).connect(g).connect(SFX.master); src.start(t0 + 0.3); src.stop(t0 + 2);
}
// the gold sound button, on the watch page and on the organizer's draw screen
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path class="waves" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="slash" d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function updateSoundBtn() {
  const b = $("soundBtn"); if (!b) return;
  const v = document.documentElement.dataset.view;
  b.hidden = v === "gate" || (v === "desk" && $("stage").hidden);
  const on = soundWanted() && SFX.ctx && SFX.ctx.state === "running";
  b.classList.toggle("on", !!on);
  b.innerHTML = SPEAKER + `<span>${on ? "Sound on" : soundWanted() ? "Tap to start sound" : "Tap for sound"}</span>`;
  b.setAttribute("aria-pressed", String(!!on));
}
function toggleSound() {
  const v = document.documentElement.dataset.view, key = v === "desk" ? "soundDesk" : "soundWatch";
  const on = soundWanted() && SFX.ctx && SFX.ctx.state === "running";
  store.set(key, !on);
  if (!on) { audio(); setTimeout(() => { updateSoundBtn(); sfxTick(); }, 60); }
  updateSoundBtn();
}
// rising glow behind the flashing names (0 = calm, 1 = about to land)
function setHeat(h) { const st = $("stage"); if (st) st.style.setProperty("--heat", String(Math.max(0, Math.min(1, h)))); }
// One animation layer for the reveal: sparks from tonight's candle and confetti from the winner's name.
const FXS = { parts: [], emitters: [], running: false, W: 0, H: 0, ctx: null };
function fxStart() {
  const cv = $("fx"); if (!cv) return null;
  if (!FXS.running) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    FXS.W = innerWidth; FXS.H = innerHeight;
    cv.width = FXS.W * dpr; cv.height = FXS.H * dpr; cv.style.width = FXS.W + "px"; cv.style.height = FXS.H + "px";
    FXS.ctx = cv.getContext("2d"); FXS.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    FXS.running = true;
    let last = performance.now();
    const frame = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const ctx = FXS.ctx; ctx.clearRect(0, 0, FXS.W, FXS.H);
      for (const em of FXS.emitters) { em.left -= dt; em.acc += em.rate * dt; while (em.acc >= 1 && em.left > 0) { em.acc--; FXS.parts.push(em.make()); } }
      FXS.emitters = FXS.emitters.filter(e => e.left > 0);
      for (const p of FXS.parts) {
        p.age += dt; p.px = p.x; p.py = p.y;
        p.vy += p.g * dt; p.vx *= p.drag; p.vy *= p.drag; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += (p.vr || 0) * dt;
        const life = 1 - p.age / p.life; if (life <= 0) continue;
        if (p.kind === "spark") {
          ctx.globalAlpha = Math.min(1, life * 1.3) * (0.75 + 0.25 * Math.sin(p.age * 40 + p.seed));
          ctx.strokeStyle = p.c; ctx.lineWidth = p.size; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(p.px - p.vx * 0.025, p.py - p.vy * 0.025); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.globalAlpha = life * 0.28; ctx.fillStyle = "#ff9a3c"; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.globalAlpha = Math.min(1, life * 1.6); ctx.fillStyle = p.c;
          if (p.star) { const r = 2.5 + 1.5 * Math.sin(p.age * 18 + p.seed); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); }
          else { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.rot * 1.7)); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
        }
      }
      ctx.globalAlpha = 1;
      FXS.parts = FXS.parts.filter(p => p.age < p.life);
      if (FXS.parts.length || FXS.emitters.length) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, FXS.W, FXS.H); FXS.running = false; }
    };
    requestAnimationFrame(frame);
  }
  return FXS;
}
function confetti() {
  if (REDUCED() || !fxStart()) return;
  const r = $("stName").getBoundingClientRect(), ox = r.left + r.width / 2, oy = r.top + r.height / 2;
  const colors = ["#e9c46a", "#f7dc8c", "#f5f1e6", "#c9a64a", "#9fb5ff"], scale = Math.min(1.4, Math.max(0.7, FXS.W / 900));
  for (let i = 0; i < 170; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5, sp = (260 + Math.random() * 620) * scale;
    FXS.parts.push({ kind: "confetti", x: ox + (Math.random() - 0.5) * r.width * 0.6, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 900 * scale, drag: 0.985, w: 6 + Math.random() * 7, h: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, c: colors[i % colors.length], star: i % 6 === 0, seed: Math.random() * 9, age: 0, life: 3.4 + Math.random() * 0.4 });
  }
}
// tonight's candle bursts into flame: a shower of sparks from its wick for about a second and a half
function candleSparks(night) {
  if (REDUCED()) return;
  const svgEl = $("menorah"); if (!svgEl || !fxStart()) return;
  const r = svgEl.getBoundingClientRect(); if (!r.width) return;
  const xs = [40, 92, 144, 196, 324, 376, 428, 480], cx = xs[8 - night], k = r.width / 520;
  const ox = r.left + cx * k, oy = r.top + (82 - 14) * k, s = Math.max(0.6, k * 1.6);
  const hot = ["#fff6c8", "#ffe08a", "#ffc24a", "#ff9a3c", "#ff7a1a"];
  const spark = burst => () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * (burst ? 2.6 : 1.3), sp = (burst ? 260 + Math.random() * 520 : 120 + Math.random() * 260) * s;
    return { kind: "spark", x: ox + (Math.random() - 0.5) * 4, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 420 * s, drag: 0.97, size: (1.2 + Math.random() * 1.8) * Math.min(1.6, s), c: hot[randomBelow(hot.length)], seed: Math.random() * 9, age: 0, life: 0.5 + Math.random() * (burst ? 1.1 : 0.8) };
  };
  const first = spark(true); for (let i = 0; i < 60; i++) FXS.parts.push(first());
  FXS.emitters.push({ rate: 55, acc: 0, left: 1.6, make: spark(false) });
}
// the whoosh and crackle of the candle catching
function sfxIgnite() {
  const c = audio(); if (!c) return;
  const t = c.currentTime, src = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf(c); lp.type = "lowpass"; lp.Q.value = 2;
  lp.frequency.setValueAtTime(250, t); lp.frequency.exponentialRampToValueAtTime(4200, t + 0.35); lp.frequency.exponentialRampToValueAtTime(900, t + 0.9);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.0);
  src.connect(lp).connect(g).connect(SFX.master); src.start(t, Math.random() * 0.5); src.stop(t + 1.05);
  for (let i = 0; i < 9; i++) {
    const tt = t + 0.12 + Math.random() * 1.1, s2 = c.createBufferSource(), hp = c.createBiquadFilter(), g2 = c.createGain();
    s2.buffer = noiseBuf(c); hp.type = "highpass"; hp.frequency.value = 2500 + Math.random() * 3000;
    g2.gain.setValueAtTime(0.06 + Math.random() * 0.08, tt); g2.gain.exponentialRampToValueAtTime(0.0008, tt + 0.03);
    s2.connect(hp).connect(g2).connect(SFX.master); s2.start(tt, Math.random() * 0.8); s2.stop(tt + 0.04);
  }
}

/* ===================================================================
   Shareable winner picture and clip (for WhatsApp chats and statuses)
   Both are drawn on a canvas in the campaign's colors, sized 9:16 for statuses.
   =================================================================== */
const imgCache = {};
function loadImg(src) {
  if (!imgCache[src]) imgCache[src] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  return imgCache[src];
}
async function shareAssets(rec) {
  await Promise.all(["800 110px Cinzel", "700 76px Cinzel", "700 40px Inter", "500 36px Inter"].map(f => document.fonts.load(f).catch(() => {})));
  const [wordmark, prize] = await Promise.all([loadImg("img/wordmark.png"), loadImg(`img/prize-${rec.prize}.jpg`)]);
  return { wordmark, prize };
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function fitFont(ctx, text, weight, size, family, maxW) {
  let s = size; ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > 20) { s -= 2; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}
function spaced(ctx, px) { try { ctx.letterSpacing = px + "px"; } catch {} }
function canvasMenorah(ctx, cx, top, width, lit, glowNight, glow) {
  const k = width / 520, x0 = cx - width / 2;
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x0 + x * k, top + y * k, w * k, h * k); };
  const metal = "#c9a64a";
  R(160, 196, 200, 12, metal); R(254, 104, 12, 94, metal); R(28, 116, 464, 9, metal); R(244, 64, 32, 9, metal); R(254, 72, 12, 44, metal);
  const flame = (x, y, a) => {
    ctx.globalAlpha = a; ctx.fillStyle = "#e9c46a"; ctx.beginPath();
    const X = v => x0 + v * k, Y = v => top + v * k;
    ctx.moveTo(X(x), Y(y - 24)); ctx.bezierCurveTo(X(x + 9), Y(y - 12), X(x + 6), Y(y - 2), X(x), Y(y - 2)); ctx.bezierCurveTo(X(x - 6), Y(y - 2), X(x - 9), Y(y - 12), X(x), Y(y - 24));
    ctx.fill(); ctx.globalAlpha = 1;
  };
  const candle = (x, y, a) => { R(x - 6, y, 12, 34, "#ece7f4"); flame(x, y, a); };
  candle(260, 30, 1);
  [40, 92, 144, 196, 324, 376, 428, 480].forEach((x, i) => { const order = 8 - i; candle(x, 82, order === glowNight ? 0.12 + 0.88 * glow : order <= lit ? 1 : 0.12); });
}
// One frame of the card. state: "roll" (a flashing name) or "won" (glow 0..1).
function drawCard(ctx, W, H, A, rec, { state, label, glow = 1 }) {
  const k = W / 1080; ctx.save(); ctx.scale(k, k);
  const w = 1080, h = 1920, cx = w / 2;
  const g = ctx.createRadialGradient(cx, 0, 80, cx, 300, 1500); g.addColorStop(0, "#1b2f82"); g.addColorStop(0.55, "#0d1a4e"); g.addColorStop(1, "#060d2c");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(233,196,106,.45)"; ctx.lineWidth = 3; roundRect(ctx, 36, 36, w - 72, h - 72, 40); ctx.stroke();
  const ww = 760, wh = ww * A.wordmark.height / A.wordmark.width; ctx.drawImage(A.wordmark, cx - ww / 2, 96, ww, wh);
  const ps = 640, px = cx - ps / 2, py = 290;
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20; roundRect(ctx, px, py, ps, ps, 36); ctx.fillStyle = "#000"; ctx.fill(); ctx.restore();
  ctx.save(); roundRect(ctx, px, py, ps, ps, 36); ctx.clip(); ctx.drawImage(A.prize, px, py, ps, ps); ctx.restore();
  ctx.strokeStyle = "rgba(233,196,106,.6)"; ctx.lineWidth = 3; roundRect(ctx, px, py, ps, ps, 36); ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  spaced(ctx, 6); ctx.fillStyle = "#e9c46a"; ctx.font = "700 36px Inter, sans-serif"; ctx.fillText(`NIGHT ${rec.night} · PRIZE #${rec.prize}`, cx, 1012);
  spaced(ctx, 1); ctx.fillStyle = "#f5f1e6"; fitFont(ctx, PRIZES[rec.prize].name, 700, 78, "Cinzel, Georgia, serif", 940); ctx.fillText(PRIZES[rec.prize].name, cx, 1104);
  canvasMenorah(ctx, cx, 1150, 330, rec.night - 1, state === "won" ? rec.night : 0, state === "won" ? glow : 0);
  spaced(ctx, 10); ctx.fillStyle = "#e9c46a"; ctx.font = "700 38px Inter, sans-serif";
  ctx.fillText(state === "won" ? "MAZEL TOV TO OUR WINNER" : "DRAWING…", cx, 1370);
  spaced(ctx, 0);
  if (state === "won") {
    fitFont(ctx, label, 800, 118, "Cinzel, Georgia, serif", 960);
    ctx.save(); ctx.shadowColor = `rgba(233,196,106,${0.55 * glow})`; ctx.shadowBlur = 60 * glow; ctx.fillStyle = "#e9c46a"; ctx.fillText(label, cx, 1500); ctx.restore();
    ctx.globalAlpha = Math.min(1, glow * 1.4);
    ctx.fillStyle = "#f5f1e6"; ctx.font = "500 38px Inter, sans-serif"; ctx.fillText(`Ticket #${fmt(rec.ticket)} of ${fmt(rec.poolTickets)}`, cx, 1580);
    if (rec.seller) { ctx.fillStyle = "#e9c46a"; fitFont(ctx, `Sold by ${rec.seller}`, 500, 38, "Inter, sans-serif", 940); ctx.fillText(`Sold by ${rec.seller}`, cx, 1636); }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = "#a9b4da"; fitFont(ctx, label, 800, 104, "Cinzel, Georgia, serif", 960); ctx.fillText(label, cx, 1500);
  }
  const open = NIGHTS.filter(N => !winnerOf(N.n) && N.n !== rec.night).length;
  ctx.fillStyle = "rgba(233,196,106,.14)"; roundRect(ctx, 90, 1712, w - 180, 112, 56); ctx.fill();
  ctx.fillStyle = "#f5f1e6"; ctx.font = "600 34px Inter, sans-serif";
  ctx.fillText(open ? `${open} more ${open === 1 ? "prize" : "prizes"} to go · tgatexas.org/raffle` : "Thank you for supporting TGA this Chanukah", cx, 1780);
  ctx.fillStyle = "#a9b4da"; ctx.font = "500 26px Inter, sans-serif"; ctx.fillText("Bnos Yisroel of Houston · Chanukah 5787", cx, 1872);
  ctx.restore();
}
const slug = rec => `TGA-raffle-night${rec.night}-${PRIZES[rec.prize].name.replace(/[^a-z0-9]+/gi, "-")}`;
async function winnerPicture(rec) {
  const A = await shareAssets(rec);
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
  drawCard(c.getContext("2d"), 1080, 1920, A, rec, { state: "won", label: rec.name, glow: 1 });
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.92));
  await save(`${slug(rec)}-winner.jpg`, blob);
}
// The clip: names flash and slow down, then the winner is revealed. About 8 seconds.
const CLIP = { start: 0.6, reveal: 4.8, end: 8.4, fps: 30 };
function flashPlan(names, rec) {
  const list = names && names.length ? names : Array.from({ length: Math.min(rec.poolTickets || 1, 400) }, (_, i) => "#" + (i + 1));
  const plan = []; let t = CLIP.start, last = -1;
  while (t < CLIP.reveal) {
    let i = randomBelow(list.length); if (i === last && list.length > 1) i = (i + 1) % list.length; last = i;
    plan.push({ t, name: list[i] });
    const p = (t - CLIP.start) / (CLIP.reveal - CLIP.start); t += 0.06 + 0.42 * p * p * p;
  }
  return plan;
}
function clipFrame(ctx, W, H, A, rec, plan, t) {
  if (t < CLIP.start) return drawCard(ctx, W, H, A, rec, { state: "roll", label: "Get ready" });
  if (t < CLIP.reveal) { let cur = plan[0]; for (const p of plan) { if (p.t <= t) cur = p; else break; } return drawCard(ctx, W, H, A, rec, { state: "roll", label: cur.name }); }
  return drawCard(ctx, W, H, A, rec, { state: "won", label: rec.name, glow: Math.min(1, (t - CLIP.reveal) / 0.6) });
}
async function winnerClip(rec, names, onProgress) {
  const A = await shareAssets(rec), plan = flashPlan(names, rec);
  const type = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4"].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (type) {
    const W = 720, H = 1280, c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d"); clipFrame(ctx, W, H, A, rec, plan, 0);
    const stream = c.captureStream(CLIP.fps), mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5e6 }), chunks = [];
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => mr.onstop = r);
    mr.start(250);
    const t0 = performance.now();
    await new Promise(res => {
      const iv = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        clipFrame(ctx, W, H, A, rec, plan, Math.min(t, CLIP.end));
        onProgress && onProgress(Math.min(1, t / CLIP.end));
        if (t >= CLIP.end) { clearInterval(iv); res(); }
      }, 1000 / CLIP.fps);
    });
    mr.stop(); await done; stream.getTracks().forEach(tr => tr.stop());
    return save(`${slug(rec)}-drawing.mp4`, new Blob(chunks, { type: "video/mp4" }));
  }
  // browsers that can't record MP4 (e.g. Firefox) get an animated GIF instead
  const { GIFEncoder, quantize, applyPalette } = await import("https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js");
  const W = 360, H = 640, c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true }), gif = GIFEncoder();
  const times = [0]; plan.forEach(p => times.push(p.t)); for (let t = CLIP.reveal; t < CLIP.reveal + 0.6; t += 0.1) times.push(t); times.push(CLIP.reveal + 0.6);
  for (let i = 0; i < times.length; i++) {
    clipFrame(ctx, W, H, A, rec, plan, times[i] + 0.001);
    const { data } = ctx.getImageData(0, 0, W, H), pal = quantize(data, 256);
    const delay = i < times.length - 1 ? Math.max(40, Math.round((times[i + 1] - times[i]) * 1000)) : 3500;
    gif.writeFrame(applyPalette(data, pal), W, H, { palette: pal, delay });
    onProgress && onProgress((i + 1) / times.length);
    if (i % 5 === 0) await new Promise(r => setTimeout(r));
  }
  gif.finish();
  return save(`${slug(rec)}-drawing.gif`, new Blob([gif.bytes()], { type: "image/gif" }));
}
// long label on wide screens, short one on upright phones
const twoLabels = (long, short) => [el("span", { class: "lbl-l", text: long }), el("span", { class: "lbl-s", text: short })];
function shareButtons(rec, names, onStage) {
  const pic = el("button", { class: "btn", type: "button" }, ...twoLabels("Download winner picture", "Winner picture"));
  const clip = el("button", { class: "btn", type: "button" }, ...twoLabels("Download drawing clip", "Drawing clip"));
  pic.addEventListener("click", async () => { pic.disabled = true; try { await winnerPicture(rec); } catch { toast("Couldn't make the picture here."); } pic.disabled = false; });
  clip.addEventListener("click", async () => {
    clip.disabled = true;
    try { await winnerClip(rec, names, p => clip.textContent = `Making clip… ${Math.round(p * 100)}%`); }
    catch { toast("Couldn't make the clip in this browser. Try Chrome or Safari."); }
    clip.replaceChildren(...twoLabels("Download drawing clip", "Drawing clip")); clip.disabled = false;
  });
  return [pic, clip];
}
async function namesForNight(night) {
  if (stage.rec && stage.rec.night === night && stage.names && stage.names.length) return stage.names;
  if (!S.processed || S.source === "sample" && !S.practice.length) return [];
  const pool = await buildPool(night);
  return [...new Set(pool.entries.map(e => (e.private || S.flags.short) ? shortName(e.name) : e.name))];
}

/* ---------- Operator side of the stage ---------- */
function openStageReady() {
  const N = NIGHTS[S.selected - 1];
  stageFrame(N.n, { operator: true, subtitle: `${fmt(S.pool.total)} tickets · ${fmt(S.pool.entries.length)} people` });
  $("stPractice").checked = S.source === "sample"; $("stPractice").disabled = S.source === "sample";
  $("stShort").checked = S.flags.short;
  $("stShow").checked = S.flags.showPractice;
  $("stShowWrap").hidden = !$("stPractice").checked;
  $("stMeta").replaceChildren("List fingerprint ", el("span", { class: "fp", text: S.pool.fp }));
  operatorControls("ready");
  $("stControls").querySelector("button")?.focus();
}
async function openStage() {
  if (!S.pool || !S.pool.total) return;
  try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch {}
  openStageReady();
  // tell the live view which prize is up, unless this is practice
  const rehearsal = S.source === "sample";
  if ((!rehearsal || S.flags.showPractice) && SIGNER) {
    const night = S.selected;
    const r = await publishState(s => { s.live = { phase: "ready", night, at: Date.now(), practice: rehearsal || undefined }; }, { expectStage: true });
    if (!r.ok) { renderChips(); toast("The live view couldn't be reached. You can still draw here. " + publishError(r.code)); }
  }
}
function operatorControls(mode) {
  const c = $("stControls"); c.replaceChildren();
  if (mode === "ready") c.append(el("button", { class: "btn gold", type: "button", onclick: runDraw, text: "Draw the winner" }));
  if (mode === "busy") c.append(el("span", { style: "color:var(--stage-muted)", text: "Sending to the live view…" }));
  if (mode === "done") c.append(
    ...shareButtons(stage.rec, stage.names, true),
    el("button", { class: "btn", type: "button", onclick: () => operatorControls("void") }, ...twoLabels("Void and redraw…", "Void…")),
    el("button", { class: "btn gold", type: "button", onclick: closeStage, text: "Done" }));
  if (mode === "void") {
    const sel = el("select", { id: "voidReason", "aria-label": "Reason for voiding" }, ...["Winner couldn't be reached", "Winner isn't eligible", "Drawn from the wrong list", "Other"].map(r => el("option", { value: r, text: r })));
    c.append(el("span", { style: "color:var(--stage-muted)", text: "Void this result because" }), sel,
      el("button", { class: "btn", type: "button", onclick: () => operatorControls("done"), text: "Keep the winner" }),
      el("button", { class: "btn gold", type: "button", onclick: () => voidAndRedraw(sel.value), text: "Void it" }));
  }
}
async function voidAndRedraw(reason) {
  const rec = stage.rec; if (!rec) return;
  operatorControls("busy");
  if (rec.practice) { rec.status = "void"; rec.voidReason = reason; }
  else if (rec.localOnly) { const l = S.localDraws.find(d => d.id === rec.id); if (l) { l.status = "void"; l.voidReason = reason; } store.set("localDraws", S.localDraws); }
  else {
    const r = await publishState(s => { const x = s.results.find(d => d.id === rec.id); if (x) { x.status = "void"; x.voidReason = reason; } s.live = { phase: "ready", night: rec.night, at: Date.now() }; }, { expectStage: true });
    if (!r.ok) { toast(publishError(r.code)); operatorControls("done"); return; }
    rec.status = "void"; rec.voidReason = reason;
  }
  toast("Result voided. It stays in the log.");
  S.pool = await buildPool(S.selected); // the same frozen list as the first draw
  openStageReady();
}
async function runDraw() {
  const pool = S.pool; if (!pool || !pool.total || stage.rolling) return;
  audio(); updateSoundBtn();
  $("stControls").replaceChildren();
  const ticket = randomBelow(pool.total) + 1;
  const { entry: winner, part } = ticketOwner(pool, ticket);
  const practice = $("stPractice").checked;
  const display = (winner.private || S.flags.short) ? shortName(winner.name) : winner.name;
  const rec = { id: `n${pool.night}-${Date.now().toString(36)}`, night: pool.night, prize: pool.prize, name: display, keyHash: winner.keyHash,
    ticket, held: winner.count, seller: part.seller || "", pkg: part.line,
    poolTickets: pool.total, poolEntrants: pool.entries.length, fp: pool.fp, drawnAt: new Date().toISOString(),
    status: "drawn", file: S.source === "sample" ? "sample data" : S.fileName };
  stage.rec = rec;
  // names as shown on screen (never emails or phones), each with its number of tickets
  const showName = e => (e.private || S.flags.short) ? shortName(e.name) : e.name;
  const tickets = ticketsFromPool(pool, showName);
  const entries = { names: pool.entries.map(showName), counts: pool.entries.map(e => e.count) };
  const rollMs = rollTime(pool.total);
  if (practice) {
    rec.practice = true; S.practice.push(rec);
    const revealAt = Date.now() + LEAD_MS + rollMs;
    const show = playReveal(rec, revealAt, true, tickets, rollMs);
    if (S.flags.showPractice && SIGNER) {
      const r = await publishState(s => { s.live = { phase: "drawn", night: rec.night, id: rec.id, revealAt, rollMs, at: Date.now(), entries, practice: true, rec }; }, { expectStage: true });
      if (!r.ok) toast("The live page couldn't be reached, so this rehearsal is on your screen only.");
    }
    await show; return;
  }
  const revealAt = Date.now() + LEAD_MS + rollMs;
  const show = playReveal(rec, revealAt, true, tickets, rollMs);
  // save the result into the page; everyone watching reloads and flashes the same names until the same moment
  const r = await publishState(s => { s.results.push(rec); s.live = { phase: "drawn", night: rec.night, id: rec.id, revealAt, rollMs, at: Date.now(), entries }; }, { expectStage: true, pending: rec });
  if (!r.ok) {
    rec.localOnly = true; S.localDraws.push(rec); store.set("localDraws", S.localDraws);
    toast("Couldn't reach the live view, so this result is saved in this browser only. " + publishError(r.code));
  }
  await show;
}

/* ===================================================================
   Boot
   =================================================================== */
function clearHash() { try { if (location.hash) history.replaceState(null, "", location.pathname + location.search); } catch {} }
let MEM = { mode: null, authed: null };
function wantsDesk() { return location.hash === "#run" || MEM.mode === "run" || session.get("mode") === "run"; }
async function authed() {
  if (SIGNER) return true;
  const k = session.get("key", null);
  if (k) { try { await useSigner(unb64(k)); return true; } catch { session.del("key"); } }
  return false;
}
function mount(html) {
  const app = $("app"); app.innerHTML = html + STAGE_HTML;
  $("soundBtn").addEventListener("click", toggleSound);
  // on the organizer's draw screen the sound switch sits in the top bar, clear of the Draw and Done buttons
  if (document.documentElement.dataset.view === "desk") document.querySelector(".stage-top .row").prepend($("soundBtn"));
  setTimeout(updateSoundBtn);
}
function setView(v) { document.documentElement.dataset.view = v; }
let shownKey = null;
// The watch page follows the live state as it arrives: dashboard, draw screen, then back.
function applyWatch() {
  if (document.documentElement.dataset.view !== "watch") return;
  const L = STATE.live, now = Date.now();
  const rec = L && L.phase === "drawn" ? ((STATE.results || []).find(r => r.id === L.id && r.status !== "void") || (L.practice ? L.rec : null)) : null;
  const key = L ? `${L.phase}:${L.id || L.night}:${L.at}` : "none";
  if (rec && now < L.revealAt + HOLD_MS) {
    if (shownKey === key) return;
    shownKey = key; holdBack = rec.id; renderWatch();
    const id = rec.id;
    (async () => {
      const show = playReveal(rec, L.revealAt, false, () => ticketList(id), L.rollMs || REVEAL_MS);
      if (L.practice) markRehearsal();
      await show;
      if (L.practice) markRehearsal();
      if (shownKey !== key) return;
      stage.timer = setTimeout(() => { if (shownKey === key) { holdBack = null; showDashboard(); } }, Math.max(0, L.revealAt + HOLD_MS - Date.now()));
    })();
    return;
  }
  if (L && L.phase === "ready" && now - L.at < 6 * 60 * 60e3 && (L.practice || !winnerOf(L.night))) {
    if (shownKey === key) return;
    shownKey = key; clearTimeout(stage.timer);
    stageFrame(L.night, { operator: false, subtitle: L.practice ? "Rehearsal: no prize is being drawn." : "The drawing is about to begin." });
    if (L.practice) markRehearsal();
    $("stName").textContent = "Going live"; $("stName").className = "st-name waiting";
    $("stCount").textContent = "Names will start in a moment. Keep this page open.";
    return;
  }
  if (stage.rolling) return;
  shownKey = key;
  if (!$("stage").hidden) { clearTimeout(stage.timer); holdBack = null; showDashboard(); } else renderWatch();
}
async function bootWatch() {
  document.title = "TGA Chanukah Raffle";
  setView("watch");
  mount(WATCH_HTML);
  $("orgLink").addEventListener("click", e => { e.preventDefault(); MEM.mode = "run"; session.set("mode", "run"); boot(); });
  shownKey = null;
  renderWatch();
  applyWatch();
}
async function bootGate() {
  setView("gate");
  mount(GATE_HTML);
  $("gateBack").addEventListener("click", e => { e.preventDefault(); MEM.mode = null; session.del("mode"); clearHash(); boot(); });
  $("gateForm").addEventListener("submit", async e => {
    e.preventDefault();
    const pw = normPw($("gatePw").value); $("gateErr").textContent = "Checking…";
    let pkcs8 = null;
    try { pkcs8 = await unlock(pw); } catch {}
    if (pkcs8) { await useSigner(pkcs8); session.set("key", b64(pkcs8)); MEM.mode = "run"; session.set("mode", "run"); boot(); }
    else { $("gateErr").textContent = "That password isn't right. Check with the person who runs the raffle."; $("gatePw").select(); }
  });
  $("gatePw").focus();
}
async function bootDesk() {
  document.title = "TGA Raffle Draw Desk";
  setView("desk");
  mount(DESK_HTML);
  $("fileInput").addEventListener("change", e => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ""; });
  const drop = $("drop");
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  $("loadSample").addEventListener("click", () => { loadTable(sampleData(), "", "sample"); toast("Sample data loaded. Draws are practice only."); });
  $("campaignSel").addEventListener("change", e => { S.campaign = e.target.value; S.selected = null; stashDesk(); refresh(); });
  $("dlWorkbook").addEventListener("click", workbook);
  $("dlResults").addEventListener("click", () => {
    const csv = resultsAoa().map(r => r.map(v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
    save("TGA-raffle-results.csv", csv);
  });
  $("copyList").addEventListener("click", () => {
    const pool = S.pool; if (!pool) return;
    const tsv = [["First ticket", "Last ticket", "Tickets", "Name", "Email", "Phone", "Sold by"].join("\t"), ...pool.entries.map(e => [e.from, e.to, e.count, e.name, e.email, e.phone, sellersOf(e)].join("\t"))].join("\n");
    navigator.clipboard.writeText(tsv).then(() => toast("Copied. Paste into a blank Excel sheet."), () => toast("Copy was blocked here. Use the download instead."));
  });
  $("poolSearch").addEventListener("input", renderPoolTable);
  $("onlyNew").addEventListener("change", e => { S.flags.onlyNew = e.target.checked; renderPoolTable(); });
  $("oneWin").checked = S.flags.oneWin;
  $("oneWin").addEventListener("change", e => { S.flags.oneWin = e.target.checked; store.set("oneWin", S.flags.oneWin); stashDesk(); renderPool(); });
  $("perTicket").addEventListener("change", e => { S.flags.perTicket = e.target.checked; });
  $("openStage").addEventListener("click", openStage);
  $("stClose").addEventListener("click", closeStage);
  $("stShort").addEventListener("change", e => { S.flags.short = e.target.checked; });
  $("stShow").addEventListener("change", e => { S.flags.showPractice = e.target.checked; store.set("showPractice", S.flags.showPractice); stashDesk(); });
  $("stPractice").addEventListener("change", e => { $("stShowWrap").hidden = !e.target.checked; });
  $("testLive").addEventListener("click", async () => {
    const r = await publishState(s => { s.live = { phase: "test", at: Date.now() }; });
    toast(r.ok ? "Test sent. Open the live link on another device to see it." : publishError(r.code));
  });
  $("clearLive").addEventListener("click", async () => {
    const r = await publishState(s => { s.live = null; });
    toast(r.ok ? "Live screen cleared. Viewers see the schedule and winners." : publishError(r.code));
  });
  $("viewLive").addEventListener("click", () => { MEM.mode = null; session.del("mode"); clearHash(); boot(); });
  $("signOut").addEventListener("click", () => { SIGNER = null; MEM.mode = null; session.del("key"); session.del("mode"); session.del("desk"); clearHash(); boot(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("stage").hidden) closeStage(); });

  // Bring back the file and settings from before the page reloaded
  const saved = session.get("desk", null);
  if (saved && saved.rows && saved.rows.length) {
    Object.assign(S, { header: saved.header, rows: saved.rows, map: saved.map, campaign: saved.campaign, fileName: saved.fileName, source: "file", selected: saved.selected });
    Object.assign(S.flags, saved.flags || {});
    $("oneWin").checked = S.flags.oneWin;
    await refresh();
  } else {
    Object.assign(S.flags, session.get("sampleFlags", {}));
    await loadTable(sampleData(), "", "sample");
  }

}
function publishError(code) {
  if (code === "locked") return "Sign in with the organizer password first.";
  if (code === "rate_limited") return "Too many updates in a short time. Wait a minute and try again.";
  if (code === "too_large") return "That update was too big to send. Tell Claude.";
  return "Couldn't reach the live view. Check the internet connection and try again.";
}
async function boot() {
  // stop anything the previous view still had running
  clearTimeout(stage.timer); stage.rolling = false; holdBack = null;
  delete document.documentElement.dataset.stage; document.body.style.overflow = "";
  $("app")?.replaceChildren();
  if (wantsDesk()) { (await authed()) ? await bootDesk() : await bootGate(); }
  else await bootWatch();
}
window.addEventListener("hashchange", () => { if (location.hash === "#run") { MEM.mode = "run"; session.set("mode", "run"); } boot(); });

listeners.add(() => {
  const v = document.documentElement.dataset.view;
  if (v === "watch") applyWatch();
  else if (v === "desk" && $("stage").hidden) refresh();
  else if (v === "desk") renderPubState();
});
setInterval(() => { if ($("modeChips")) renderChips(); }, 5000);
document.addEventListener("pointerdown", unlockAudio, { capture: true });
(async () => {
  startFeed();
  await boot();
})();
})();
