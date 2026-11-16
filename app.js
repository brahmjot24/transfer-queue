// Transfer Queue — app logic. Data lives in Firebase (see fb.js).
import { db, auth, configured } from "./fb.js";

const DEFAULT_CALLERS = ["Arjon", "Nilo", "Frank"];
let CALLERS = DEFAULT_CALLERS.slice(); // live list of calling-agent lists, kept in the database
// The starting team, used once: the very first time anyone signs in, the app creates
// these people. Everyone signs in by typing exactly this first + last name.
const TEAM = [
  { name: "Jon Salvagna", role: "admin" },
  { name: "Chantelle Ferreira", role: "manager" },
  { name: "Delcia Salvagna", role: "manager" },
  { name: "Arjon Fernandez", role: "caller", list: "Arjon" },
  { name: "Nilo Salabit", role: "caller", list: "Nilo" },
  { name: "Frank Gomez", role: "caller", list: "Frank" },
  { name: "Amanda Saad", role: "agent" }, { name: "Allan Bell", role: "agent" }, { name: "Brahm Singh", role: "agent" },
  { name: "Nora Youkhanis", role: "agent" }, { name: "Rohina Pasani", role: "agent" }, { name: "Jim Recto", role: "agent" },
  { name: "Jon Amello", role: "agent" }, { name: "Krisha Karuna", role: "agent" }, { name: "Paulina Soria", role: "agent" },
  { name: "Tom Coukos", role: "agent" }, { name: "Warren Mutai", role: "agent" }
];
const ADMIN = TEAM.find(p => p.role === "admin").name;
const SEED_AGENTS = TEAM.filter(p => p.role === "agent").map(p => p.name);
const TZ = "America/Toronto";
const PIN_LEN = 6;
const EMAIL_DOMAIN = "users.transferqueue.example.com"; // hidden sign-in IDs; never emailed

const root = document.getElementById("root");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const fmtTime = t => t ? new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) : "";
const fmtDate = d => { try { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd, 12)).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }); } catch (e) { return d; } };
const rid = () => { const a = new Uint32Array(3); crypto.getRandomValues(a); return Array.from(a, x => x.toString(36)).join(""); };
const rand = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const shuffleArr = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const nice = n => String(n).trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const slugify = n => String(n).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";
const emailFor = (slug, ver) => slug + ".v" + ver + "@" + EMAIL_DOMAIN;
const pw = pin => "tqPIN-" + pin;
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };

const S = {
  dir: {}, dirLoaded: false, booted: null, user: undefined, me: null, settingUp: false,
  meta: undefined, lists: {}, listsLoaded: false, log: null, adminLog: null,
  tab: "board", stale: false, err: null, pin: null, modal: null, form: {}, busy: false,
  prevPos: {}, primed: false, autoTriedFor: null, flash: false, settings: false, changePin: null,
  loginErr: "", loginBusy: false
};
Object.assign(S.form, ls.get("tq_lastname", {}));
let memberSubs = [], logSubs = [], logDate = null;

/* ---------- alert prefs ---------- */
const DEFAULT_PREFS = { banner: true, chime: true, browser: false, title: true, vibrate: false, onDeck: true };
const prefKey = () => "tq_prefs_" + (S.me ? S.me.slug : "");
const prefs = () => Object.assign({}, DEFAULT_PREFS, ls.get(prefKey(), {}));
let actx = null;
function unlockAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) { } }
function chime(kind) {
  try {
    unlockAudio(); if (!actx) return; const notes = kind === "next" ? [784, 1047, 1319] : [659, 784]; let t = actx.currentTime + .02;
    notes.forEach(f => { const o = actx.createOscillator(), g = actx.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.25, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + .45); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .5); t += .16; });
  } catch (e) { }
}
const notifyState = () => { try { return typeof Notification === "undefined" ? "unsupported" : Notification.permission; } catch (e) { return "unsupported"; } };
function fireAlert(kind, caller) {
  const p = prefs();
  const title = kind === "next" ? "You're NEXT on " + caller + "'s list" : "You're on deck (#2) on " + caller + "'s list";
  const body = kind === "next" ? "Make sure RingCentral shows you green — a transfer is coming." : "Get ready — you're up after one more call.";
  if (p.chime) chime(kind);
  if (p.vibrate) { try { navigator.vibrate && navigator.vibrate(kind === "next" ? [200, 100, 200] : [150]); } catch (e) { } }
  if (p.browser && notifyState() === "granted") { try { new Notification(title, { body, tag: "tq-" + caller }); } catch (e) { } }
  if (p.banner) { S.flash = true; setTimeout(() => { S.flash = false; }, 3500); }
  toast((kind === "next" ? "🟢 " : "🟡 ") + title);
}

/* ---------- derived ---------- */
const isAdmin = () => S.me && S.me.role === "admin";
const myList = () => S.me && (S.me.list || S.me.name);
const isManager = () => S.me && S.me.role === "manager";
const ROLE_LABEL = { admin: "Managing Director", manager: "Manager", caller: "Calling agent", agent: "Mortgage agent" };
const offMap = () => (S.meta && S.meta.off) || {};
const entries = c => (S.lists[c] && S.lists[c].entries) || [];
const activeOrder = c => { const off = offMap(); return entries(c).filter(e => !off[e.name]); };
const posOf = (name, c) => { const i = activeOrder(c).findIndex(e => e.name === name); return i < 0 ? 0 : i + 1; };
const roster = () => (S.meta && S.meta.roster) || [];
const isToday = () => S.meta && S.meta.date === today();
const dirList = role => Object.values(S.dir).filter(d => d.role === role).sort((a, b) => a.name.localeCompare(b.name));
function events() {
  const out = [];
  const add = (L, coll) => { const ev = (L && L.events) || {}; Object.keys(ev).forEach(k => out.push(Object.assign({ id: k, coll }, ev[k]))); };
  add(S.log, "logs"); if (isAdmin()) add(S.adminLog, "adminLogs");
  return out.filter(e => e.t).sort((a, b) => b.t - a.t);
}
function stats() {
  const st = {}; roster().forEach(n => st[n] = { t: 0, s: 0, by: {} });
  events().forEach(e => {
    if (e.undone || !e.name || (e.type !== "transfer" && e.type !== "skip")) return; const r = st[e.name] || (st[e.name] = { t: 0, s: 0, by: {} });
    if (e.type === "transfer") { r.t++; r.by[e.caller] = (r.by[e.caller] || 0) + 1; } else r.s++;
  });
  return st;
}
function checkAlerts() {
  if (!S.me || S.me.role !== "agent" || !S.listsLoaded || S.meta === undefined) return;
  const p = prefs(), now = {};
  CALLERS.forEach(c => now[c] = posOf(S.me.name, c));
  if (S.primed) CALLERS.forEach(c => {
    const o = S.prevPos[c] || 0, n = now[c];
    if (n === 1 && o !== 1) fireAlert("next", c);
    else if (p.onDeck && n === 2 && (o === 0 || o > 2)) fireAlert("deck", c);
  });
  S.prevPos = now; S.primed = true;
}

/* ---------- helpers ---------- */
function toast(msg) { const t = document.getElementById("toast"); t.innerHTML = '<div class="toast">' + esc(msg) + '</div>'; clearTimeout(toast._t); toast._t = setTimeout(() => { t.innerHTML = ""; }, 4200); }
function errText(e) {
  const c = (e && e.code) || "";
  if (c === "permission-denied") return "You don't have permission to do that.";
  if (c === "unavailable") return "No connection — check your internet.";
  if (c === "resource-exhausted") return "The free daily limit was reached. It resets at 3 AM Toronto time.";
  return (e && e.message) || c || "Something went wrong";
}
async function guard(fn) {
  if (S.busy) return; S.busy = true; render();
  try { await fn(); } catch (e) { console.error(e); toast("Couldn't save — " + errText(e)); }
  finally { S.busy = false; render(); }
}
async function logEvent(ev, date) {
  date = date || (S.meta && S.meta.date) || today();
  const coll = isAdmin() && !ev.auto ? "adminLogs" : "logs";
  const id = Date.now().toString(36) + rid().slice(0, 5);
  await db.merge(coll + "/" + date, { date, events: { [id]: Object.assign({ t: Date.now(), by: S.me ? S.me.name : "?" }, ev) } });
  return { coll, id };
}
function ensureLogs() {
  const d = S.meta && S.meta.date; if (!d || d === logDate || !S.me) return;
  logSubs.forEach(u => u()); logSubs = []; logDate = d; S.log = null; S.adminLog = null;
  logSubs.push(db.listen("logs/" + d, s => { S.log = s.exists ? s.data : { events: {} }; render(); }, e => console.warn(e)));
  if (isAdmin()) logSubs.push(db.listen("adminLogs/" + d, s => { S.adminLog = s.exists ? s.data : { events: {} }; render(); }, e => console.warn(e)));
}

/* ---------- shuffle ---------- */
function buildLists(rost, extras, prevStart, CALLERS) {
  const base = []; rost.forEach(n => { base.push(n); for (let i = 0; i < (extras[n] || 0); i++) base.push(n); });
  const prevFirsts = new Set(prevStart ? CALLERS.map(c => prevStart[c] && prevStart[c][0]).filter(Boolean) : []);
  let best = null, bs = Infinity;
  for (let k = 0; k < 600; k++) {
    const L = {}; let sc = 0;
    CALLERS.forEach(c => {
      const l = shuffleArr(base); L[c] = l; const p = prevStart && prevStart[c];
      if (p) l.forEach((n, i) => { if (p[i] === n) sc += 3; });
      for (let i = 1; i < l.length; i++) if (l[i] === l[i - 1]) sc += 6;
      if (prevFirsts.has(l[0])) sc += 4;
    });
    const f = CALLERS.map(c => L[c][0]); sc += (f.length - new Set(f).size) * 5;
    if (sc < bs) { bs = sc; best = L; } if (sc === 0) break;
  }
  return best;
}
async function doShuffle(by, onlyIfStale) {
  const d = today();
  const res = await db.tx(async t => {
    const ms = await t.get("meta/board"); const m = ms.exists ? ms.data : {};
    if (onlyIfStale && m.date === d) return null;
    const rost = m.roster || [];
    const cl = (m.callers && m.callers.length) ? m.callers : DEFAULT_CALLERS;
    const sameDay = m.date === d; const prevStart = sameDay ? (m.prevStartOrder || null) : (m.startOrder || null);
    const L = buildLists(rost, m.extras || {}, prevStart, cl);
    const days = Array.from(new Set((m.days || []).concat([d]))).sort();
    const now = Date.now();
    t.set("meta/board", Object.assign({}, m, {
      date: d, roster: rost, off: sameDay ? (m.off || {}) : {}, extras: m.extras || {}, autoShuffle: m.autoShuffle !== false,
      callers: cl, startOrder: L, prevStartOrder: prevStart, shuffledAt: now, shuffledBy: by, days: days.slice(-30)
    }));
    cl.forEach(c => t.set("lists/" + c, { date: d, entries: L[c].map(n => ({ id: rid(), name: n })), prev: null, updatedAt: now, updatedBy: by }));
    return { drop: days.slice(0, -30) };
  });
  if (!res) return false;
  await logEvent({ type: "shuffle", auto: !!onlyIfStale, by: onlyIfStale ? "Automatic" : by }, d);
  for (const x of res.drop) { try { await db.del("logs/" + x); } catch (e) { } if (isAdmin()) { try { await db.del("adminLogs/" + x); } catch (e) { } } }
  return true;
}
async function maybeAutoShuffle() {
  if (!S.me || S.me.role === "agent" || !S.meta) return;
  const d = today(); if (S.meta.date === d || S.meta.autoShuffle === false || S.autoTriedFor === d) return;
  S.autoTriedFor = d;
  try { if (await doShuffle(S.me.name, true)) toast("Today's lists were shuffled automatically."); } catch (e) { console.warn(e); }
}

/* ---------- list actions ---------- */
async function writeList(c, newEntries, prev) {
  const cur = S.lists[c] || {};
  await db.set("lists/" + c, { date: cur.date || (S.meta && S.meta.date) || today(), entries: newEntries, prev: prev || null, updatedAt: Date.now(), updatedBy: S.me.name });
}
function doTransfer(c, id) {
  const list = entries(c), off = offMap(), idx = list.findIndex(e => e.id === id); if (idx < 0) return;
  const target = list[idx], above = list.slice(0, idx).filter(e => !off[e.name]);
  const run = () => guard(async () => {
    const aboveIds = new Set(above.map(e => e.id));
    const rest = list.filter(e => e.id !== id && !aboveIds.has(e.id));
    const evs = [];
    for (const e of above) evs.push(await logEvent({ type: "skip", caller: c, name: e.name, note: "passed over for " + target.name }));
    evs.push(await logEvent({ type: "transfer", caller: c, name: target.name }));
    await writeList(c, rest.concat(above, [target]), { entries: list, label: "Transfer → " + target.name, events: evs });
    toast("✓ Transferred to " + target.name + " — moved to the bottom of " + c + "'s list");
  });
  if (above.length) {
    S.modal = {
      title: "Transfer to " + target.name + "?", ok: "Transfer & skip " + above.length, okCls: "green", run,
      html: "<p><b>" + above.map(e => esc(e.name)).join(", ") + "</b> " + (above.length > 1 ? "are" : "is") + " ahead of " + esc(target.name) + " and will be marked <b>skipped</b> and moved down the list.</p><p class='muted'>Use this when the person ahead isn't green in RingCentral.</p>"
    }; render();
  } else run();
}
function doSkip(c, id) {
  const list = entries(c), t = list.find(e => e.id === id); if (!t) return;
  guard(async () => {
    const ev = await logEvent({ type: "skip", caller: c, name: t.name, note: "offline" });
    await writeList(c, list.filter(e => e.id !== id).concat([t]), { entries: list, label: "Skip " + t.name, events: [ev] });
    toast(t.name + " skipped (offline) — moved down " + c + "'s list");
  });
}
function doUndo(c) {
  const L = S.lists[c]; if (!L || !L.prev) return; const p = L.prev;
  guard(async () => {
    await writeList(c, p.entries, null);
    for (const e of (p.events || [])) { try { await db.merge(e.coll + "/" + S.meta.date, { events: { [e.id]: { undone: true } } }); } catch (x) { } }
    await logEvent({ type: "undo", caller: c, note: p.label });
    toast("Undone: " + p.label);
  });
}
function doOff(name) {
  const cur = !!offMap()[name];
  guard(async () => {
    await db.merge("meta/board", { off: { [name]: !cur } }); await logEvent({ type: cur ? "on" : "off", name });
    toast(cur ? name + " is back in rotation" : name + " marked off today — skipped automatically on all lists");
  });
}
function doMove(c, id, dir) {
  const list = entries(c).slice(), i = list.findIndex(e => e.id === id), j = i + dir; if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  guard(async () => { await writeList(c, list, { entries: entries(c), label: "Move " + list[j].name, events: [] }); });
}
function doRemoveEntry(c, id) {
  const list = entries(c), e = list.find(x => x.id === id); if (!e) return;
  S.modal = {
    title: "Remove " + e.name + " from " + c + "'s list?", ok: "Remove spot", okCls: "dark", html: "<p>This removes one spot for today only. The next shuffle uses the team roster again.</p>",
    run: () => guard(async () => { await writeList(c, list.filter(x => x.id !== id), { entries: list, label: "Remove " + e.name, events: [] }); await logEvent({ type: "admin", caller: c, name: e.name, note: "spot removed" }); })
  }; render();
}
function doAddSpot() {
  const name = S.form.spotName, where = S.form.spotPos || "random", lists = CALLERS.filter(c => S.form["spot_" + c] !== false);
  if (!name) { toast("Pick an agent first"); return; } if (!lists.length) { toast("Pick at least one list"); return; }
  guard(async () => {
    for (const c of lists) {
      const list = entries(c).slice(), e = { id: rid(), name, extra: true };
      if (where === "top") list.unshift(e); else if (where === "bottom") list.push(e); else {
        let k = 0; for (let t = 0; t < 40; t++) { k = rand(list.length + 1); const a = list[k - 1], b = list[k]; if ((!a || a.name !== name) && (!b || b.name !== name)) break; }
        list.splice(k, 0, e);
      }
      await writeList(c, list, { entries: entries(c), label: "Extra spot " + name, events: [] });
    }
    await logEvent({ type: "admin", name, note: "extra spot added (" + where + ") on " + lists.join(", ") });
    toast("Extra spot for " + name + " added to " + lists.join(", "));
  });
}
function doExtra(name, delta) {
  const cur = ((S.meta.extras || {})[name]) || 0, v = Math.max(0, Math.min(3, cur + delta)); if (v === cur) return;
  guard(async () => { await db.merge("meta/board", { extras: { [name]: v } }); });
}
function askShuffle() {
  const re = isToday();
  S.modal = {
    title: re ? "Reshuffle today's lists?" : "Shuffle today's lists?", ok: re ? "Reshuffle now" : "Shuffle now", okCls: "green",
    html: "<p>Each calling agent gets a <b>different random order</b> of the " + roster().length + " mortgage agents" + (Object.values((S.meta && S.meta.extras) || {}).some(v => v > 0) ? " (plus standing extra spots)" : "") + ". The app avoids giving anyone the same position they had last time.</p>" + (re ? "<p><b>Heads up:</b> this resets today's order for every calling agent. Today's activity is kept.</p>" : ""),
    run: () => guard(async () => { await doShuffle(S.me.name, false); toast("Lists shuffled for " + fmtDate(today())); })
  }; render();
}

/* ---------- team (admin) ---------- */
function doAddPerson() {
  const name = nice(S.form.newName || ""), role = S.form.newRole || "agent";
  if (!/\S+\s+\S+/.test(name)) { toast("Type a first and last name"); return; }
  let slug = slugify(name);
  if (S.dir[slug]) { toast(name + " is already in the app"); return; }
  const email = emailFor(slug, 1), extra = {};
  if (role === "caller") {
    const parts = name.split(" "); let key = parts[0].replace(/[^\p{L}\p{N}-]/gu, "") || "List";
    if (CALLERS.includes(key)) key = key + parts[parts.length - 1][0];
    let k2 = key, n = 2; while (CALLERS.includes(k2)) k2 = key + (n++); extra.list = k2;
  }
  guard(async () => {
    const ops = [
      { op: "set", path: "directory/" + slug, data: Object.assign({ name, role, ver: 1, email, pinSet: false }, extra) },
      { op: "set", path: "access/" + email, data: Object.assign({ slug, name, role }, extra) }
    ];
    if (role === "agent") ops.push({ op: "merge", path: "meta/board", data: { roster: roster().concat([name]) } });
    if (role === "caller") ops.push({ op: "merge", path: "meta/board", data: { callers: CALLERS.concat([extra.list]) } });
    await db.batch(ops);
    if (role === "agent") for (const c of CALLERS) { const list = entries(c); await writeList(c, list.concat([{ id: rid(), name }]), { entries: list, label: "Add " + name, events: [] }); }
    if (role === "caller") {
      const base = []; roster().forEach(nm => { base.push(nm); for (let i = 0; i < ((S.meta.extras || {})[nm] || 0); i++) base.push(nm); });
      await db.set("lists/" + extra.list, { date: (S.meta && S.meta.date) || today(), entries: shuffleArr(base).map(nm => ({ id: rid(), name: nm })), prev: null, updatedAt: Date.now(), updatedBy: S.me.name });
    }
    await logEvent({ type: "admin", name, note: "added as " + ROLE_LABEL[role].toLowerCase() + (extra.list ? " (new list: " + extra.list + ")" : "") });
    S.form.newName = ""; toast(name + " added as " + ROLE_LABEL[role].toLowerCase() + ". They create their own PIN the first time they sign in.");
  });
}
function doRemovePerson(slug) {
  const d = S.dir[slug]; if (!d || d.role === "admin") return;
  const what = d.role === "agent" ? "They'll be taken off the roster and every list right away." : d.role === "caller" ? "Their list (" + esc(d.list || "") + ") will be removed too." : "They'll lose access to the app.";
  S.modal = {
    title: "Remove " + d.name + "?", ok: "Remove " + d.name, okCls: "dark",
    html: "<p>" + what + " You can add them back later (they'll create a new PIN).</p>",
    run: () => guard(async () => {
      const ops = [{ op: "delete", path: "directory/" + slug }, { op: "delete", path: "access/" + d.email }];
      if (d.role === "agent") { const ex = Object.assign({}, (S.meta.extras || {})); delete ex[d.name]; ops.push({ op: "set", path: "meta/board", data: Object.assign({}, S.meta, { roster: roster().filter(n => n !== d.name), extras: ex }) }); }
      if (d.role === "caller" && d.list) { ops.push({ op: "set", path: "meta/board", data: Object.assign({}, S.meta, { callers: CALLERS.filter(c => c !== d.list) }) }); ops.push({ op: "delete", path: "lists/" + d.list }); }
      await db.batch(ops);
      if (d.role === "agent") for (const c of CALLERS) { const list = entries(c); await writeList(c, list.filter(e => e.name !== d.name), { entries: list, label: "Remove " + d.name, events: [] }); }
      await logEvent({ type: "admin", name: d.name, note: "removed (" + ROLE_LABEL[d.role].toLowerCase() + ")" });
    })
  }; render();
}
function doResetPin(slug) {
  const d = S.dir[slug]; if (!d) return;
  S.modal = {
    title: "Reset " + d.name + "'s PIN?", ok: "Reset PIN", okCls: "dark",
    html: "<p>" + esc(d.name) + " will be signed out on every device and asked to create a new PIN the next time they pick their name.</p>",
    run: () => guard(async () => {
      const ver = (d.ver || 1) + 1, email = emailFor(slug, ver);
      await db.batch([
        { op: "delete", path: "access/" + d.email },
        { op: "set", path: "directory/" + slug, data: Object.assign({}, d, { ver, email, pinSet: false }) },
        { op: "set", path: "access/" + email, data: { slug, name: d.name, role: d.role } }
      ]);
      await logEvent({ type: "admin", name: d.name, note: "PIN reset" });
      toast(d.name + "'s PIN was reset");
    })
  }; render();
}

/* ---------- sign-in ---------- */
function authErr(e) {
  const c = (e && e.code) || "";
  if (c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/invalid-login-credentials" || c === "auth/user-not-found") return "Wrong PIN — try again";
  if (c === "auth/too-many-requests") return "Too many tries. Wait a few minutes, or ask " + ADMIN + " to reset your PIN.";
  if (c === "auth/network-request-failed") return "No connection — check your internet";
  if (c === "auth/operation-not-allowed") return "Sign-in isn't switched on yet (setup step 2: enable Email/Password).";
  return "Couldn't sign in (" + (c || "error") + ")";
}
async function pinSubmit() {
  const P = S.pin; if (!P || P.working) return;
  if (P.val.length !== PIN_LEN) { P.err = "PIN must be " + PIN_LEN + " digits"; render(); return; }
  if (P.stage === "create") { P.first = P.val; P.val = ""; P.stage = "confirm"; P.err = ""; render(); return; }
  if (P.stage === "confirm" && P.val !== P.first) { P.stage = "create"; P.val = ""; P.first = ""; P.err = "PINs didn't match — start again"; render(); return; }
  P.working = true; P.err = ""; render();
  try {
    if (P.setup) await runSetup(P, P.val);
    else if (P.stage === "enter") await auth.signIn(P.email, pw(P.val));
    else {
      try { await auth.create(P.email, pw(P.val)); }
      catch (e) {
        if (e && e.code === "auth/email-already-in-use") { Object.assign(P, { stage: "enter", val: "", first: "", working: false, err: "A PIN was already created for this name — enter it." }); render(); return; }
        throw e;
      }
      try { await db.merge("directory/" + P.slug, { pinSet: true }); } catch (e) { console.warn(e); }
    }
    S.pin = null; render();
  } catch (e) { console.warn(e); P.working = false; P.val = ""; if (P.stage === "confirm") { P.stage = "create"; P.first = ""; } P.err = P.setup ? "Setup failed: " + errText(e) : authErr(e); render(); }
}
async function runSetup(P, pin) {
  // First sign-in ever: create this person's account, then the whole team.
  S.settingUp = true;
  try {
    try { await auth.create(P.email, pw(pin)); }
    catch (e) { if (e && e.code === "auth/email-already-in-use") await auth.signIn(P.email, pw(pin)); else throw e; }
    const ops = [];
    TEAM.forEach(p => {
      const slug = slugify(p.name), email = emailFor(slug, 1);
      const extra = p.list ? { list: p.list } : {};
      ops.push({ op: "set", path: "directory/" + slug, data: Object.assign({ name: p.name, role: p.role, ver: 1, email, pinSet: slug === P.slug }, extra) });
      ops.push({ op: "set", path: "access/" + email, data: Object.assign({ slug, name: p.name, role: p.role }, extra) });
    });
    ops.push({ op: "set", path: "meta/board", data: { date: "", callers: DEFAULT_CALLERS.slice(), roster: SEED_AGENTS.slice(), off: {}, extras: {}, autoShuffle: true, days: [], shuffledAt: 0, shuffledBy: "" } });
    ops.push({ op: "set", path: "config/bootstrap", data: { at: Date.now(), by: P.name } });
    try { await db.batch(ops); }
    catch (e) {
      if (!e || e.code !== "permission-denied") throw e;
      // Someone else set the team up a moment earlier; just mark this person's PIN as created.
      try { await db.merge("directory/" + P.slug, { pinSet: true }); } catch (x) { }
    }
  } finally { S.settingUp = false; }
  await resolveMember();
}
async function lookupName() {
  if (S.loginBusy) return;
  const first = (S.form.first || "").trim(), last = (S.form.last || "").trim();
  if (!first || !last) { S.loginErr = "Type your first and last name."; render(); return; }
  const full = (first + " " + last).replace(/\s+/g, " "), slug = slugify(full);
  const notFound = "We couldn't find \u201c" + full + "\u201d. Check the spelling, or ask " + ADMIN + " to add you.";
  S.loginBusy = true; S.loginErr = ""; render();
  try {
    if (!S.booted) {
      const p = TEAM.find(t => slugify(t.name) === slug);
      if (!p) { S.loginErr = notFound; return; }
      S.pin = { setup: true, slug, name: p.name, email: emailFor(slug, 1), stage: "create", val: "", first: "", err: "" };
    } else {
      const d = await db.get("directory/" + slug);
      if (!d.exists) { S.loginErr = notFound; return; }
      S.pin = { slug, name: d.data.name, email: d.data.email, stage: d.data.pinSet ? "enter" : "create", val: "", first: "", err: "" };
    }
    ls.set("tq_lastname", { first, last });
  } catch (e) { console.warn(e); S.loginErr = "Couldn't check your name — " + errText(e); }
  finally { S.loginBusy = false; render(); }
}
async function signOutNow(msg) {
  memberSubs.forEach(u => u()); logSubs.forEach(u => u()); memberSubs = []; logSubs = []; logDate = null;
  Object.assign(S, { loginErr: "", dir: {}, me: null, meta: undefined, lists: {}, listsLoaded: false, log: null, adminLog: null, primed: false, prevPos: {}, tab: "board" });
  document.title = "Transfer Queue";
  try { await auth.signOut(); } catch (e) { }
  if (msg) toast(msg);
  render();
}
async function resolveMember() {
  const u = S.user; if (!u || S.settingUp) return;
  let a;
  try { a = await db.get("access/" + u.email); } catch (e) { a = { exists: false }; }
  if (!a.exists) { await signOutNow("Your sign-in was reset or removed. Pick your name to sign in again."); return; }
  S.me = Object.assign({ email: u.email }, a.data); S.primed = false; S.prevPos = {}; S.tab = "board";
  startMemberSubs(); render();
}
function startMemberSubs() {
  memberSubs.forEach(u => u()); memberSubs = [];
  const timer = setTimeout(() => { if (S.meta === undefined) { S.stale = true; render(); } }, 10000);
  const fail = e => { console.warn(e); if (e && e.code === "permission-denied") signOutNow("Your access changed. Please sign in again."); else { S.stale = true; render(); } };
  memberSubs.push(db.listen("meta/board", s => {
    clearTimeout(timer); S.stale = false; S.meta = s.exists ? s.data : null; CALLERS = (S.meta && S.meta.callers && S.meta.callers.length) ? S.meta.callers.slice() : DEFAULT_CALLERS.slice(); ensureLogs(); render(); checkAlerts(); maybeAutoShuffle();
  }, fail));
  memberSubs.push(db.listenColl("lists", q => { S.lists = {}; q.docs.forEach(d => S.lists[d.id] = d.data); S.listsLoaded = true; render(); checkAlerts(); }, fail));
  if (isAdmin()) memberSubs.push(db.listenColl("directory", q => { const d = {}; q.docs.forEach(x => d[x.id] = x.data); S.dir = d; S.dirLoaded = true; render(); }, e => console.warn(e)));
  memberSubs.push(db.listen("access/" + S.me.email, s => { if (!s.exists) signOutNow("Your PIN was reset. Pick your name to create a new one."); }, () => { }));
}

/* ---------- render ---------- */
let rq = false;
function render() { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; draw(); }); }
function draw() {
  const ae = document.activeElement, fid = ae && ae.id, sel = ae && ae.selectionStart;
  root.innerHTML = view();
  document.getElementById("overlay").innerHTML = overlay();
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { if (sel != null) el.setSelectionRange(sel, sel); } catch (e) { } } }
  updateTitle();
}
function updateTitle() {
  let t = "Transfer Queue";
  if (S.me && S.me.role === "agent" && prefs().title) {
    const p = CALLERS.map(c => [c, posOf(S.me.name, c)]), n = p.filter(x => x[1] === 1).map(x => x[0]), d = p.filter(x => x[1] === 2).map(x => x[0]);
    if (n.length) t = "🟢 YOU'RE NEXT (" + n.join(", ") + ") · Transfer Queue"; else if (d.length) t = "🟡 On deck (" + d.join(", ") + ") · Transfer Queue";
  }
  if (document.title !== t) document.title = t;
}
function header() {
  const st = S.me && S.meta ? (isToday() ? "Shuffled " + fmtTime(S.meta.shuffledAt) + (isAdmin() ? " by " + esc(S.meta.shuffledBy || "—") : "") : "<span style='color:var(--amber)'>Not shuffled yet today</span>") : "";
  const roleLab = S.me ? (ROLE_LABEL[S.me.role] || "") : "";
  const live = S.me && S.meta !== undefined && !S.stale;
  return '<div class="top"><div class="brand"><div class="logo"><i></i></div><div>Transfer Queue<div class="sub">' + esc(fmtDate(today())) + (st ? " · " + st : "") + '</div></div></div><div class="spacer"></div>' +
    (S.me ? '<span class="live ' + (live ? "on" : "") + '"><b></b>' + (live ? "Live" : S.stale ? "Reconnecting…" : "Connecting…") + '</span>' : "") +
    (isAdmin() ? '<button class="btn green" data-act="shuffle"' + (S.busy ? " disabled" : "") + '>🔀 ' + (isToday() ? "Reshuffle" : "Shuffle today") + '</button>' : "") +
    (S.me ? '<button class="btn" data-act="settings">🔔 Alerts</button><span class="chip">' + esc(S.me.name) + ' <small>' + roleLab + '</small><button class="btn xs ghost" data-act="chpin" title="Change my PIN">PIN</button><button class="btn xs ghost" data-act="logout">Sign out</button></span>' : "") + '</div>';
}
function view() {
  if (!configured) return header() + '<div class="notice err">Firebase isn\'t connected yet. Paste your project settings into <b>firebase-config.js</b> (setup guide, step 4).</div>';
  if (S.user === undefined || S.booted === null) return header() + '<div class="empty">Connecting…</div>';
  if (!S.user) return header() + loginView();
  if (!S.me) return header() + '<div class="empty">Signing you in…</div>';
  let pre = "";
  if (S.stale) pre += '<div class="notice warn">Connection is slow — what you see may be out of date.</div>';
  if (S.meta === undefined) return header() + pre + '<div class="empty">Loading the live queue…</div>';
  if (!S.meta) return header() + pre + '<div class="notice info">Waiting for ' + ADMIN + ' to finish setup.</div>';
  if (!isToday()) pre += '<div class="notice warn">Today\'s lists haven\'t been shuffled yet' + (S.meta.date ? ' — you\'re seeing the order from ' + esc(fmtDate(S.meta.date)) + '.' : '.') + (isAdmin() ? ' <button class="btn green sm" data-act="shuffle">Shuffle today</button>' : S.meta.autoShuffle !== false ? " They'll shuffle automatically when a calling agent signs in." : " Waiting for " + ADMIN + ".") + '</div>';
  if (S.me.role === "agent") return header() + pre + agentView();
  if (S.me.role === "caller") return header() + pre + callerView();
  if (S.me.role === "manager") return header() + pre + managerView();
  return header() + pre + adminView();
}
function loginView() {
  const f = S.form;
  return '<div class="setup card"><div class="card-b" style="padding:28px"><h2 style="margin:0 0 6px">Sign in</h2>' +
    '<p class="muted" style="line-height:1.5;margin:0 0 18px">Type your first and last name. First time here? You\'ll create a ' + PIN_LEN + '-digit PIN next. After that you stay signed in on this device.</p>' +
    '<div style="display:flex;flex-direction:column;gap:12px">' +
    '<label class="field">First name<input class="inp" id="f-first" data-f="first" autocomplete="given-name" autocapitalize="words" value="' + esc(f.first || "") + '"></label>' +
    '<label class="field">Last name<input class="inp" id="f-last" data-f="last" autocomplete="family-name" autocapitalize="words" value="' + esc(f.last || "") + '"></label>' +
    '<div class="perr" style="text-align:left">' + esc(S.loginErr) + '</div>' +
    '<button class="btn green big" data-act="lookup"' + (S.loginBusy ? " disabled" : "") + '>' + (S.loginBusy ? "Checking…" : "Continue") + '</button></div></div></div>';
}
function rowHTML(c, e, pos, mode, isMe) {
  const off = offMap()[e.name], cls = ["row"];
  if (!off && pos === 1) cls.push("next"); else if (!off && pos === 2) cls.push("deck"); if (isMe) cls.push("me"); if (off) cls.push("off");
  let tags = ""; if (!off && pos === 1) tags += '<span class="tag g">Next</span>'; else if (!off && pos === 2) tags += '<span class="tag a">On deck</span>';
  if (off) tags += '<span class="tag o">Off today</span>'; if (e.extra && isAdmin()) tags += '<span class="tag x">Extra</span>'; if (isMe) tags += '<span class="tag b">You</span>';
  let acts = ""; const dis = S.busy ? " disabled" : "";
  if (mode !== "view") {
    if (!off) acts += '<button class="btn xs ' + (pos === 1 ? "green" : "") + '" data-act="transfer" data-c="' + c + '" data-id="' + e.id + '" title="Call transferred to this person"' + dis + '>✓ Transfer</button><button class="btn xs redo" data-act="skip" data-c="' + c + '" data-id="' + e.id + '" title="Not green in RingCentral — skip & move down"' + dis + '>Skip</button>';
    acts += '<button class="btn xs ghost" data-act="off" data-name="' + esc(e.name) + '" title="' + (off ? "Put back in rotation" : "Not working today (all lists)") + '"' + dis + '>' + (off ? "Back on" : "Off") + '</button>';
    if (mode === "admin") acts += '<button class="btn xs ghost" data-act="up" data-c="' + c + '" data-id="' + e.id + '" title="Move up"' + dis + '>↑</button><button class="btn xs ghost" data-act="down" data-c="' + c + '" data-id="' + e.id + '" title="Move down"' + dis + '>↓</button><button class="btn xs ghost" data-act="rmspot" data-c="' + c + '" data-id="' + e.id + '" title="Remove this spot"' + dis + '>✕</button>';
  }
  return '<li class="' + cls.join(" ") + '"><span class="pos">' + (off ? "off" : pos) + '</span><span class="nm">' + esc(e.name) + '</span>' + tags + (acts ? '<span class="acts">' + acts + '</span>' : "") + '</li>';
}
function listCard(c, mode, opts) {
  opts = opts || {}; const list = entries(c), off = offMap(); let p = 0; const me = S.me && S.me.role === "agent" ? S.me.name : null;
  const rows = list.map(e => { const isOff = off[e.name]; if (!isOff) p++; return rowHTML(c, e, isOff ? 0 : p, mode, me === e.name); }).join("");
  const L = S.lists[c], dis = S.busy ? " disabled" : "";
  const undo = mode !== "view" && L && L.prev ? '<button class="btn sm" data-act="undo" data-c="' + c + '"' + dis + '>↶ Undo ' + esc(L.prev.label) + '</button>' : "";
  const upd = L && L.updatedAt ? '<span class="sub">updated ' + fmtTime(L.updatedAt) + '</span>' : "";
  let next = "";
  if (opts.nextup) {
    const n = activeOrder(c)[0];
    next = n ? '<div class="nextup"><div class="l">Next up for your transfer</div><div class="n">' + esc(n.name) + '</div><div class="bb"><button class="btn green big" data-act="transfer" data-c="' + c + '" data-id="' + n.id + '"' + dis + '>✓ Transferred to ' + esc(n.name) + '</button><button class="btn redo big" data-act="skip" data-c="' + c + '" data-id="' + n.id + '"' + dis + '>' + esc(n.name) + ' not green — skip</button></div><div class="sub" style="margin-top:10px">If someone further down took the call, press <b>✓ Transfer</b> on their row. Everyone above them is marked skipped and moved down.</div></div>' : '<div class="nextup"><div class="n">No one available</div></div>';
  }
  return '<div class="card"><div class="card-h"><h3>' + esc(c) + (opts.own ? "'s list (yours)" : "'s list") + '</h3>' + upd + '<div class="spacer"></div>' + undo + '</div>' + next + (list.length ? '<ul class="list">' + rows + '</ul>' : '<div class="empty">Empty list</div>') + '</div>';
}
function feedCard(limit) {
  const ev = events().slice(0, limit || 60);
  const line = e => {
    switch (e.type) {
      case "transfer": return "<b>" + esc(e.caller) + "</b> transferred a call to <b>" + esc(e.name) + "</b>";
      case "skip": return "<b>" + esc(e.caller) + "</b> skipped <b>" + esc(e.name) + "</b>" + (e.note ? " <span class='muted'>(" + esc(e.note) + ")</span>" : "");
      case "off": return "<b>" + esc(e.name) + "</b> marked off today <span class='muted'>by " + esc(e.by) + "</span>";
      case "on": return "<b>" + esc(e.name) + "</b> back in rotation <span class='muted'>by " + esc(e.by) + "</span>";
      case "shuffle": return e.auto ? "Lists shuffled automatically" : "Lists shuffled <span class='muted'>by " + esc(e.by) + "</span>";
      case "undo": return "<b>" + esc(e.by) + "</b> undid: " + esc(e.note || "") + (e.caller ? " <span class='muted'>(" + esc(e.caller) + ")</span>" : "");
      default: return "<b>" + esc(e.by) + "</b>: " + esc(e.name || "") + " " + esc(e.note || "");
    }
  };
  return '<div class="card"><div class="card-h"><h3>Today\'s activity</h3>' + (isAdmin() ? '<span class="sub">your own actions are visible only to you</span>' : "") + '</div>' + (ev.length ? '<ul class="feed">' + ev.map(e => '<li class="' + (e.undone ? "undone" : "") + '"><time>' + fmtTime(e.t) + '</time><span>' + line(e) + (isAdmin() && e.coll === "adminLogs" ? ' <span class="tag o">private</span>' : "") + '</span></li>').join("") + '</ul>' : '<div class="empty">No activity yet today.</div>') + '</div>';
}
function agentView() {
  const me = S.me.name, p = prefs(), pos = {}; CALLERS.forEach(c => pos[c] = posOf(me, c));
  const nx = CALLERS.filter(c => pos[c] === 1), dk = CALLERS.filter(c => pos[c] === 2), off = offMap()[me];
  let ban = "";
  if (p.banner && !off) {
    if (nx.length) ban = '<div class="banner next' + (S.flash ? " flash" : "") + '"><div class="bi">🟢</div><div><h2>You\'re NEXT on ' + nx.join(" & ") + '\'s list</h2><p>Stay green in RingCentral — the next transfer from ' + nx.join(" or ") + ' comes to you.</p></div></div>';
    else if (dk.length) ban = '<div class="banner deck' + (S.flash ? " flash" : "") + '"><div class="bi">🟡</div><div><h2>You\'re on deck on ' + dk.join(" & ") + '\'s list</h2><p>One more call and you\'re up. Get ready and make sure you\'re green.</p></div></div>';
  }
  if (off) ban = '<div class="notice warn">You\'re marked <b>off today</b>, so calling agents will pass over you. If you\'re working, ask a calling agent or ' + ADMIN + ' to put you back in rotation.</div>';
  const st = stats()[me] || { t: 0, s: 0 };
  const spots = CALLERS.map(c => {
    const n = pos[c], cls = off ? "" : n === 1 ? "next" : n === 2 ? "deck" : "", ahead = n > 1 ? n - 1 : 0;
    return '<div class="spot ' + cls + '"><div class="lab">' + esc(c) + '</div><div class="val">' + (off ? "—" : n ? "#" + n : "—") + '</div><div class="hint">' + (off ? "Off today" : !n ? "Not on this list" : n === 1 ? "You're next" : ahead + " " + (ahead === 1 ? "person" : "people") + " ahead of you") + '</div></div>';
  }).join("");
  return ban + '<div class="spots">' + spots + '</div><div class="sub mb">Today: <b>' + st.t + '</b> transfer' + (st.t === 1 ? "" : "s") + ' received · <b>' + st.s + '</b> skip' + (st.s === 1 ? "" : "s") + (p.chime && !actx ? ' · <button class="btn xs" data-act="testchime">🔊 Tap to turn on sound</button>' : "") + '</div>' +
    '<div class="grid3 mb">' + CALLERS.map(c => listCard(c, "view")).join("") + '</div>' + feedCard(40);
}
function callerView() {
  const c = myList();
  if (!CALLERS.includes(c)) return '<div class="notice warn">There\'s no list for ' + esc(c) + ' yet.</div>';
  return '<div class="split"><div class="stack">' + listCard(c, "caller", { nextup: true, own: true }) + '</div><div class="stack">' + offCard() + feedCard(40) + CALLERS.filter(x => x !== c).map(o => listCard(o, "view")).join("") + '</div></div>';
}
function offCard() {
  const off = Object.keys(offMap()).filter(n => offMap()[n]);
  return '<div class="card"><div class="card-h"><h3>Not working today</h3><span class="sub">skipped automatically on every list</span></div>' + (off.length ? '<ul class="list">' + off.map(n => '<li class="row"><span class="nm">' + esc(n) + '</span><button class="btn xs" data-act="off" data-name="' + esc(n) + '"' + (S.busy ? " disabled" : "") + '>Back on</button></li>').join("") + '</ul>' : '<div class="empty">Everyone is in rotation. Use <b>Off</b> on a row for anyone not working today.</div>') + '</div>';
}
function adminView() {
  const t = S.tab;
  const tabs = '<div class="tabs">' + [["board", "Live board"], ["team", "Team, people & PINs"], ["stats", "Today's numbers"]].map(x => '<button class="' + (t === x[0] ? "on" : "") + '" data-act="tab" data-t="' + x[0] + '">' + x[1] + '</button>').join("") + '</div>';
  if (t === "team") return tabs + teamView();
  if (t === "stats") return tabs + statsView();
  return tabs + '<div class="grid3 mb">' + CALLERS.map(c => listCard(c, "admin")).join("") + '</div><div class="split"><div>' + feedCard(80) + '</div><div>' + offCard() + '</div></div>';
}
function managerView() {
  const t = S.tab === "stats" ? "stats" : "board";
  const tabs = '<div class="tabs">' + [["board", "Live board"], ["stats", "Today's numbers"]].map(x => '<button class="' + (t === x[0] ? "on" : "") + '" data-act="tab" data-t="' + x[0] + '">' + x[1] + '</button>').join("") + '</div>';
  if (t === "stats") return tabs + statsView();
  return tabs + '<div class="grid3 mb">' + CALLERS.map(c => listCard(c, "caller")).join("") + '</div><div class="split"><div>' + feedCard(80) + '</div><div>' + offCard() + '</div></div>';
}
function teamView() {
  const ex = (S.meta && S.meta.extras) || {}, off = offMap(), dis = S.busy ? " disabled" : "", f = S.form;
  const slugOf = d => Object.keys(S.dir).find(k => S.dir[k] === d);
  const pinCell = d => (d.pinSet ? '<span class="tag g">PIN set</span>' : '<span class="tag o">Not signed in yet</span>') + (d.name !== S.me.name ? ' <button class="btn xs ghost" data-act="resetpin" data-slug="' + slugOf(d) + '"' + dis + '>Reset PIN</button>' : "");
  const agentRows = dirList("agent").map(d => '<tr><td><b>' + esc(d.name) + '</b></td><td><label class="switch"><input type="checkbox" data-act="off" data-name="' + esc(d.name) + '" ' + (off[d.name] ? "" : "checked") + dis + '><i></i></label> <span class="sub">' + (off[d.name] ? "Off today" : "Working") + '</span></td><td><span class="stepper"><button class="btn xs" data-act="extra" data-name="' + esc(d.name) + '" data-d="-1"' + dis + '>−</button><span>' + (ex[d.name] || 0) + '</span><button class="btn xs" data-act="extra" data-name="' + esc(d.name) + '" data-d="1"' + dis + '>+</button></span></td><td>' + pinCell(d) + '</td><td style="text-align:right"><button class="btn xs ghost" data-act="rmperson" data-slug="' + slugOf(d) + '"' + dis + '>Remove</button></td></tr>').join("");
  const staffRows = dirList("admin").concat(dirList("manager"), dirList("caller")).map(d => '<tr><td><b>' + esc(d.name) + '</b></td><td class="sub">' + ROLE_LABEL[d.role] + (d.list ? " · " + esc(d.list) + "'s list" : "") + '</td><td>' + pinCell(d) + '</td><td style="text-align:right">' + (d.role !== "admin" ? '<button class="btn xs ghost" data-act="rmperson" data-slug="' + slugOf(d) + '"' + dis + '>Remove</button>' : "") + '</td></tr>').join("");
  const addSpot = '<div class="card mb"><div class="card-h"><h3>Give someone an extra spot today</h3><span class="sub">e.g. to make up for time off</span></div><div class="card-b"><div class="inline">' +
    '<label class="field">Mortgage agent<select class="inp" id="f-spotName" data-f="spotName"><option value="">Choose…</option>' + roster().map(n => '<option ' + (f.spotName === n ? "selected" : "") + '>' + esc(n) + '</option>').join("") + '</select></label>' +
    '<label class="field">Where<select class="inp" id="f-spotPos" data-f="spotPos">' + [["random", "Random spot"], ["top", "Top (next up)"], ["bottom", "Bottom"]].map(o => '<option value="' + o[0] + '" ' + ((f.spotPos || "random") === o[0] ? "selected" : "") + '>' + o[1] + '</option>').join("") + '</select></label>' +
    '<div class="field">Lists<div style="display:flex;gap:10px;padding:8px 0">' + CALLERS.map(c => '<label style="font-weight:600;color:var(--ink)"><input type="checkbox" data-f="spot_' + c + '" ' + (f["spot_" + c] === false ? "" : "checked") + '> ' + c + '</label>').join("") + '</div></div>' +
    '<button class="btn dark" data-act="addspot"' + dis + '>Add extra spot</button></div></div></div>';
  const team = '<div class="card mb"><div class="card-h"><h3>Mortgage agents</h3><span class="sub">' + dirList("agent").length + ' on the team</span></div><div style="overflow:auto"><table><thead><tr><th>Name</th><th>Today</th><th>Standing extra spots <span title="Added at every shuffle until set back to 0">ⓘ</span></th><th>Sign-in</th><th></th></tr></thead><tbody>' + agentRows + '</tbody></table></div>' +
    '</div>';
  const auto = S.meta && S.meta.autoShuffle !== false;
  const addCard = '<div class="card mb"><div class="card-h"><h3>Add someone new</h3></div><div class="card-b"><div style="display:flex;flex-direction:column;gap:10px">' +
    '<label class="field">First and last name<input class="inp" id="f-newName" data-f="newName" placeholder="e.g. Sam Lee" value="' + esc(f.newName || "") + '"></label>' +
    '<label class="field">Role<select class="inp" id="f-newRole" data-f="newRole">' + [["agent", "Mortgage agent"], ["caller", "Calling agent (gets their own list)"], ["manager", "Manager"]].map(o => '<option value="' + o[0] + '" ' + ((f.newRole || "agent") === o[0] ? "selected" : "") + '>' + o[1] + '</option>').join("") + '</select></label>' +
    '<button class="btn dark" data-act="addperson"' + dis + '>Add person</button><div class="sub">They sign in by typing this name and create their own PIN.</div></div></div></div>';
  const side = addCard + '<div class="card mb"><div class="card-h"><h3>Admin, managers & calling agents</h3></div><div style="overflow:auto"><table><tbody>' + staffRows + '</tbody></table></div></div>' +
    '<div class="card"><div class="card-h"><h3>Settings</h3></div><div class="card-b"><div class="pref"><div><b>Auto-shuffle each morning</b><small>If you haven\'t shuffled by the time the first calling agent signs in, the app shuffles for you. You can always reshuffle.</small></div><label class="switch"><input type="checkbox" data-act="autoshuffle" ' + (auto ? "checked" : "") + dis + '><i></i></label></div></div></div>';
  return '<div class="split"><div>' + addSpot + team + '</div><div>' + side + '</div></div>';
}
function statsView() {
  const st = stats(), names = Object.keys(st).sort((a, b) => st[b].t - st[a].t || a.localeCompare(b));
  const tot = { t: 0, s: 0 }; names.forEach(n => { tot.t += st[n].t; tot.s += st[n].s; });
  const perCaller = {}; CALLERS.forEach(c => perCaller[c] = 0); names.forEach(n => CALLERS.forEach(c => perCaller[c] += (st[n].by[c] || 0)));
  return '<div class="spots">' + CALLERS.map(c => '<div class="spot"><div class="lab">' + c + ' transfers</div><div class="val">' + perCaller[c] + '</div></div>').join("") + '</div>' +
    '<div class="card"><div class="card-h"><h3>Per mortgage agent — ' + esc(fmtDate((S.meta && S.meta.date) || today())) + '</h3><span class="sub">' + tot.t + ' transfers · ' + tot.s + ' skips</span></div><div style="overflow:auto"><table><thead><tr><th>Agent</th><th>Transfers</th>' + CALLERS.map(c => '<th>from ' + c + '</th>').join("") + '<th>Skipped</th></tr></thead><tbody>' +
    names.map(n => '<tr><td><b>' + esc(n) + '</b>' + (offMap()[n] ? ' <span class="tag o">Off</span>' : "") + '</td><td class="num">' + st[n].t + '</td>' + CALLERS.map(c => '<td class="num">' + (st[n].by[c] || 0) + '</td>').join("") + '<td class="num" style="color:' + (st[n].s ? "var(--red)" : "inherit") + '">' + st[n].s + '</td></tr>').join("") + '</tbody></table></div></div>';
}
function pinPad(head, sub, P, okLabel) {
  const dots = Array.from({ length: PIN_LEN }, (_, i) => '<b class="' + (i < P.val.length ? "f" : "") + '"></b>').join("");
  return '<div class="scrim"><div class="modal" style="text-align:center"><h3>' + head + '</h3><p>' + sub + '</p><div class="pinbox">' + dots + '</div><div class="perr">' + esc(P.err || "") + '</div><div class="keys">' +
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => '<button data-act="pk" data-k="' + k + '">' + k + '</button>').join("") + '<button data-act="pk" data-k="del">⌫</button><button data-act="pk" data-k="0">0</button><button data-act="pinok" style="background:var(--navy);color:#fff"' + (P.working ? " disabled" : "") + '>' + (P.working ? "…" : okLabel || "OK") + '</button></div>' +
    '<div class="mfoot" style="justify-content:center"><button class="btn ghost" data-act="pincancel">Cancel</button></div></div></div>';
}
function overlay() {
  if (S.pin) {
    const P = S.pin;
    const head = P.stage === "enter" ? "Enter your PIN" : P.stage === "create" ? "Create your PIN" : "Confirm the PIN";
    const sub = P.stage === "enter" ? "Signing in as <b>" + esc(P.name) + "</b>" : P.stage === "create" ? "Welcome, <b>" + esc(P.name) + "</b>. " + "Pick a " + PIN_LEN + "-digit PIN only you know." : "Type the same " + PIN_LEN + " digits again.";
    return pinPad(head, sub, P);
  }
  if (S.changePin) {
    const C = S.changePin;
    const head = C.stage === "old" ? "Enter your current PIN" : C.stage === "new" ? "Choose a new PIN" : "Confirm the new PIN";
    return pinPad(head, "Changing the PIN for <b>" + esc(S.me.name) + "</b>", C);
  }
  if (S.modal) { const M = S.modal; return '<div class="scrim" data-act="mclose-bg"><div class="modal"><h3>' + esc(M.title) + '</h3>' + M.html + '<div class="mfoot"><button class="btn" data-act="mclose">Cancel</button><button class="btn ' + (M.okCls || "dark") + '" data-act="mok"' + (S.busy ? " disabled" : "") + '>' + esc(M.ok) + '</button></div></div></div>'; }
  if (S.settings) {
    const p = prefs(), ns = notifyState(), isAgent = S.me && S.me.role === "agent";
    const pr = (k, t, s, extra) => '<div class="pref"><div><b>' + t + '</b><small>' + s + '</small>' + (extra || "") + '</div><label class="switch"><input type="checkbox" data-pref="' + k + '" ' + (p[k] ? "checked" : "") + '><i></i></label></div>';
    return '<div class="scrim" data-act="sclose-bg"><div class="modal"><h3>🔔 How should we tell you?</h3><p>' + (isAgent ? "Pick any mix. These settings are saved on this device." : "These alerts are for mortgage agents when they become next.") + '</p>' +
      pr("banner", "Big on-screen banner", "Green bar when you're next, amber when you're on deck.") +
      pr("chime", "Chime sound", "Plays a short tone. Keep this tab open and your volume up.", '<div><button class="btn xs" data-act="testchime" style="margin-top:6px">▶ Test chime</button></div>') +
      pr("browser", "Desktop notification", "Pops up even when you're in another window or app.", '<div style="margin-top:6px">' + (ns === "granted" ? '<span class="tag g">Allowed</span>' : ns === "unsupported" ? '<span class="sub">Not available in this browser.</span>' : ns === "denied" ? '<span class="sub">Blocked — allow notifications for this site in your browser settings.</span>' : '<button class="btn xs" data-act="asknotif">Allow desktop notifications</button>') + '</div>') +
      pr("title", "Flash the browser tab", "Tab title changes to 🟢 YOU'RE NEXT so you can spot it among other tabs.") +
      pr("vibrate", "Vibrate (phones)", "Buzzes on Android phones that support it.") +
      pr("onDeck", "Also alert when I'm #2", "Get a heads-up one call early.") +
      '<div class="mfoot"><button class="btn dark" data-act="sclose">Done</button></div></div></div>';
  }
  return "";
}

/* ---------- change my PIN ---------- */
async function changePinSubmit() {
  const C = S.changePin; if (!C || C.working) return;
  if (C.val.length !== PIN_LEN) { C.err = "PIN must be " + PIN_LEN + " digits"; render(); return; }
  if (C.stage === "old") { C.old = C.val; C.val = ""; C.stage = "new"; C.err = ""; render(); return; }
  if (C.stage === "new") { C.first = C.val; C.val = ""; C.stage = "confirm"; C.err = ""; render(); return; }
  if (C.val !== C.first) { Object.assign(C, { stage: "new", val: "", first: "", err: "PINs didn't match — try again" }); render(); return; }
  C.working = true; render();
  try { await auth.changePassword(S.me.email, pw(C.old), pw(C.val)); S.changePin = null; toast("PIN changed"); render(); }
  catch (e) { Object.assign(C, { stage: "old", val: "", old: "", first: "", working: false, err: e && (e.code === "auth/invalid-credential" || e.code === "auth/wrong-password") ? "Current PIN was wrong" : authErr(e) }); render(); }
}
function pinTarget() { return S.pin || S.changePin; }
function pinOk() { if (S.pin) pinSubmit(); else if (S.changePin) changePinSubmit(); }

/* ---------- events ---------- */
document.addEventListener("click", ev => {
  unlockAudio();
  const b = ev.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, c = b.dataset.c, id = b.dataset.id, name = b.dataset.name, slug = b.dataset.slug;
  if (b.tagName === "INPUT") return;
  if ((a === "mclose-bg" || a === "sclose-bg") && ev.target !== b) return;
  switch (a) {
    case "lookup": lookupName(); return;
    case "pk": { const P = pinTarget(); if (!P || P.working) return; if (b.dataset.k === "del") P.val = P.val.slice(0, -1); else if (P.val.length < PIN_LEN) P.val += b.dataset.k; P.err = ""; render(); if (P.val.length === PIN_LEN) setTimeout(pinOk, 120); return; }
    case "pinok": pinOk(); return;
    case "pincancel": S.pin = null; S.changePin = null; render(); return;
    case "chpin": S.changePin = { stage: "old", val: "", err: "" }; render(); return;
    case "logout": signOutNow(); return;
    case "settings": S.settings = true; render(); return;
    case "sclose": case "sclose-bg": S.settings = false; render(); return;
    case "mclose": case "mclose-bg": S.modal = null; render(); return;
    case "mok": { const M = S.modal; S.modal = null; render(); if (M && M.run) M.run(); return; }
    case "testchime": unlockAudio(); chime("next"); render(); return;
    case "asknotif": try { Promise.resolve(Notification.requestPermission()).then(() => { if (notifyState() === "granted") { const p = prefs(); p.browser = true; ls.set(prefKey(), p); } render(); }).catch(() => render()); } catch (e) { toast("Desktop notifications aren't available here."); } return;
    case "transfer": doTransfer(c, id); return;
    case "skip": doSkip(c, id); return;
    case "undo": doUndo(c); return;
    case "off": doOff(name); return;
    case "up": doMove(c, id, -1); return;
    case "down": doMove(c, id, 1); return;
    case "rmspot": doRemoveEntry(c, id); return;
    case "shuffle": askShuffle(); return;
    case "tab": S.tab = b.dataset.t; render(); return;
    case "addspot": doAddSpot(); return;
    case "addperson": doAddPerson(); return;
    case "rmperson": doRemovePerson(slug); return;
    case "extra": doExtra(name, Number(b.dataset.d)); return;
    case "resetpin": doResetPin(slug); return;
  }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.dataset.pref) { const p = prefs(); p[t.dataset.pref] = t.checked; ls.set(prefKey(), p); if (t.dataset.pref === "chime" && t.checked) chime("next"); render(); return; }
  if (t.dataset.f) { S.form[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value; return; }
  if (t.dataset.act === "off") { doOff(t.dataset.name); return; }
  if (t.dataset.act === "autoshuffle") { const v = t.checked; guard(async () => { await db.merge("meta/board", { autoShuffle: v }); }); }
});
document.addEventListener("input", ev => { const t = ev.target; if (t.dataset.f && t.type !== "checkbox") S.form[t.dataset.f] = t.value; });
document.addEventListener("keydown", ev => {
  const P = pinTarget();
  if (P) {
    if (P.working) return;
    if (/^[0-9]$/.test(ev.key) && P.val.length < PIN_LEN) { P.val += ev.key; P.err = ""; render(); if (P.val.length === PIN_LEN) setTimeout(pinOk, 120); }
    else if (ev.key === "Backspace") { P.val = P.val.slice(0, -1); render(); }
    else if (ev.key === "Escape") { S.pin = null; S.changePin = null; render(); }
    return;
  }
  if (ev.key === "Escape" && (S.modal || S.settings)) { S.modal = null; S.settings = false; render(); }
  if (ev.key === "Enter" && ev.target.id === "f-newName") { S.form.newName = ev.target.value; doAddPerson(); }
  if (ev.key === "Enter" && (ev.target.id === "f-first" || ev.target.id === "f-last")) { S.form[ev.target.dataset.f] = ev.target.value; lookupName(); }
});

/* ---------- boot ---------- */
render();
if (configured) {
  db.listen("config/bootstrap", s => { S.booted = s.exists; render(); }, e => { console.warn(e); S.booted = true; render(); });
  auth.onChange(u => { S.user = u; if (!u) { S.me = null; render(); return; } resolveMember(); });
  setInterval(() => { render(); maybeAutoShuffle(); }, 60000);
}
