// Keeps a lasting copy of the latest signed raffle state in state.json, and
// re-sends it to ntfy.sh when its 12-hour message cache is running dry.
// Only states signed with the organizer's key are accepted.
import fs from "fs";
import { webcrypto as c } from "crypto";

const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
const enc = s => new TextEncoder().encode(s);
const pub = await c.subtle.importKey("jwk", cfg.pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
async function read(body) {
  const i = body.indexOf("\n");
  if (i < 1) return null;
  try {
    const ok = await c.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, Buffer.from(body.slice(0, i), "base64"), enc(body.slice(i + 1)));
    return ok ? JSON.parse(body.slice(i + 1)) : null;
  } catch { return null; }
}

const cur = fs.existsSync("state.json") ? fs.readFileSync("state.json", "utf8").trim() : "";
const curState = cur ? await read(cur) : null;

const res = await fetch(`https://ntfy.sh/${cfg.topic}/json?poll=1&since=all`);
let best = null, bestBody = null, newest = 0;
for (const line of (await res.text()).split("\n")) {
  if (!line.trim()) continue;
  let m; try { m = JSON.parse(line); } catch { continue; }
  if (m.event !== "message" || !m.message) continue;
  const p = await read(m.message);
  if (!p || p.kind !== "state") continue;
  newest = Math.max(newest, (m.time || 0) * 1000);
  if (!best || p.ver > best.ver) { best = p; bestBody = m.message; }
}

if (best && (!curState || best.ver > curState.ver)) {
  fs.writeFileSync("state.json", bestBody + "\n");
  console.log("Saved newer state", best.ver);
}
const latest = best && (!curState || best.ver >= curState.ver) ? bestBody : cur;
if (latest && Date.now() - newest > 6 * 3600e3) {
  const r = await fetch(`https://ntfy.sh/${cfg.topic}`, { method: "POST", body: latest });
  console.log("Re-sent latest state to ntfy:", r.status);
}
