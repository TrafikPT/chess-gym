/* ---------- the opening being trained (switchable) ---------- */
let DATA = null, N = [], P = {}, L = [], BYKEY = {}, nodeLesson = {}, lessonSets = [];
let ME = "b", OPPC = "w", MEN = "Black", OPP = "White", orient = "b";
function useOpening(d) {
  DATA = d; N = d.nodes; P = d.principles; L = d.lessons;
  BYKEY = {}; N.forEach((n, i) => BYKEY[n.k] = i);
  nodeLesson = {}; L.forEach((l, li) => l.nodes.forEach(i => { if (nodeLesson[i] === undefined) nodeLesson[i] = li; }));
  lessonSets = L.map(l => new Set(l.nodes));
  ME = d.side; OPPC = ME === "b" ? "w" : "b"; MEN = ME === "b" ? "Black" : "White"; OPP = ME === "b" ? "White" : "Black"; orient = ME;
  for (const k in subCache) delete subCache[k];
  lastPath = null; lastReviewed = null; forced = null;      // nothing carries over from the other opening
  useMyGames(); replySeen = {};
  resetArmed = false; $("bReset").textContent = "Reset my progress in this opening";
}
const FILES = "abcdefgh";
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// move labels: the learner's move at a node, and an opponent move with its number
function moveLbl(no, san, side) { return `${no}${side === "b" ? "…" : "."}${esc(san)}`; }
function lmNo(no, san) { return moveLbl(no, san, ME); }
function oppLbl(no, san) { return moveLbl(no, san, OPPC); }
function isMine(p) { return (p === p.toUpperCase()) === (ME === "w"); }

/* ---------- problems: never fail silently (a banner for the parent, details in the console) ---------- */
function reportProblem(msg, err) {
  if (err) console.error(err);
  const el = $("problem"); if (!el) return;
  el.hidden = false; el.textContent = msg + (err && err.message ? ` (${err.message})` : "");
}
window.addEventListener("error", e => reportProblem("Something went wrong on this page. Reload it if anything looks stuck.", e.error || { message: e.message }));
window.addEventListener("unhandledrejection", e => reportProblem("Something went wrong on this page. Reload it if anything looks stuck.", e.reason));

/* ---------- memory: browser storage always, plus the viewer's private store when available ---------- */
const STORE = "modern-drill-v2";
const HIST_MAX = 200;         // puzzle history kept per player
let S = { n: {}, les: {}, lines: 0, best: 0, req: [] };
try {
  const raw = localStorage.getItem(STORE);
  if (raw) {
    try { S = Object.assign(S, JSON.parse(raw)); }
    catch (e) {   // keep the unreadable copy instead of overwriting it on the next save
      try { localStorage.setItem(STORE + ":corrupt:" + Date.now(), raw); } catch (e2) {}
      reportProblem("Saved progress in this browser couldn't be read; a copy was kept.", e);
    }
  }
} catch (e) {}
let remote = null, writing = false, dirty = false, timer = null, sharedDb = null;
// requested lines also live in a shared "requests" collection so Claude can read them without a copy-paste
function reqId(line) { let h = 2166136261; for (const c of line) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return "r" + h.toString(16); }
async function pushReq(r) {
  if (!sharedDb) return;
  try { await sharedDb.doc("requests/" + reqId(r.line)).set({ line: r.line, t: r.t }); r.synced = true; save(); } catch (e) { console.error(e); }
}
function save() {
  const pl = S.players && S.players[S.player];
  if (pl) pl.u = Date.now();           // last change to the active player: settles settings when two devices merge
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { console.error(e); }
  if (!remote) return;
  dirty = true; clearTimeout(timer); timer = setTimeout(flush, 1200);
}
async function flush() {
  if (!remote || writing || !dirty) return;
  writing = true; dirty = false;
  try { await remote.set(JSON.parse(JSON.stringify(S))); setSync(true); }
  catch (e) {
    if (e && (e.code === "invalid_argument" || e.code === "revoked" || e.code === "not_granted")) {
      remote = null; setSync(false);
      reportProblem("Progress is no longer being saved to your Claude account (it is still saved in this browser).", e);
    } else { dirty = true; console.error(e); }
  }
  writing = false;
  if (dirty) timer = setTimeout(flush, 2000);
}
// leaving the page: write now instead of waiting for the timer
addEventListener("pagehide", () => { clearTimeout(timer); flush(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { clearTimeout(timer); flush(); } });
function setSync(ok) {
  $("sync").textContent = ok ? "Saved to your Claude account, so it follows you across devices and Claude can read it to plan your next session." : "Saved in this browser only.";
}
// one player's profile from two devices: keep all progress from both, settings from the copy changed last
function blankPlayer(p) {
  return !(p.hist || []).length && !p.stars && !Object.keys(p.stages || {}).length && !Object.keys(p.school || {}).length && !Object.keys(p.bots || {}).length;
}
function maxMap(a = {}, b = {}) { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = Math.max(o[k] || 0, v || 0); return o; }
function mergePlayer(a, b) {
  if (!a) return b; if (!b) return a;
  // a fresh default profile (e.g. "Son" on a new device) never wins over a real one
  const newer = blankPlayer(a) !== blankPlayer(b) ? (blankPlayer(a) ? b : a) : (b.u || 0) > (a.u || 0) ? b : a;
  const out = Object.assign({}, newer === a ? b : a, newer);
  const lastT = p => { const h = p.hist || []; return h.length ? h[h.length - 1].t || 0 : 0; };
  const rated = lastT(a) === lastT(b) ? newer : lastT(a) > lastT(b) ? a : b;    // rating from the latest puzzle
  out.rating = rated.rating; out.n = rated.n;
  const seen = new Set();
  out.hist = [...(a.hist || []), ...(b.hist || [])].sort((x, y) => (x.t || 0) - (y.t || 0))
    .filter(x => { const k = x.id + "@" + x.t; if (seen.has(k)) return false; seen.add(k); return true; }).slice(-HIST_MAX);
  out.done = maxMap(a.done, b.done);
  out.stages = maxMap(a.stages, b.stages);
  for (const k of ["stars", "trophies"]) out[k] = Math.max(a[k] || 0, b[k] || 0);
  out.school = {};
  for (const pc of new Set([...Object.keys(a.school || {}), ...Object.keys(b.school || {})])) {
    const x = (a.school || {})[pc] || [], y = (b.school || {})[pc] || [];
    out.school[pc] = Array.from({ length: Math.max(x.length, y.length) }, (_, i) => Math.max(x[i] || 0, y[i] || 0));
  }
  out.bots = {};
  for (const id of new Set([...Object.keys(a.bots || {}), ...Object.keys(b.bots || {})])) out.bots[id] = maxMap((a.bots || {})[id], (b.bots || {})[id]);
  out.again = {};      // missed puzzles to redo: per puzzle the later-scheduled copy (each miss or re-solve moves `due` on)
  for (const [id, x] of [...Object.entries(a.again || {}), ...Object.entries(b.again || {})]) {
    const y = out.again[id];
    if (!y || x.due > y.due || (x.due === y.due && x.n > y.n)) out.again[id] = x;
  }
  out.gateFree = maxMap(a.gateFree, b.gateFree);         // stages the child was already past when they came (kids.js stageMigrate)
  out.pathV = Math.max(a.pathV || 0, b.pathV || 0);
  // stages either copy has seen (stageMigrate decided whether each was free; a blank copy brings nothing)
  out.gatesSeen = { ...(blankPlayer(a) ? {} : a.gatesSeen || {}), ...(blankPlayer(b) ? {} : b.gatesSeen || {}) };
  out.u = Math.max(a.u || 0, b.u || 0);
  return out;
}
function merge(o) {
  if (!o || typeof o !== "object") return;
  for (const [k, r] of Object.entries(o.n || {})) if (!S.n[k] || (r.t || 0) > (S.n[k].t || 0)) S.n[k] = r;
  for (const [k, r] of Object.entries(o.les || {})) S.les[k] = Object.assign({}, S.les[k] || {}, r, { done: !!(r.done || S.les[k]?.done), walk: !!(r.walk || S.les[k]?.walk) });
  S.lines = Math.max(S.lines || 0, o.lines || 0); S.best = Math.max(S.best || 0, o.best || 0);
  if (o.players) {
    S.players = S.players || {};
    for (const [id, p] of Object.entries(o.players)) S.players[id] = mergePlayer(S.players[id], p);
    for (const k of ["player", "sonSeeded"]) if (o[k] !== undefined && (S[k] === undefined || S.fresh)) S[k] = o[k];
    S.pzv = Math.max(S.pzv || 0, o.pzv || 0);
  }
  delete S.fresh;
  S.seenGames = Object.assign({}, o.seenGames || {}, S.seenGames || {});      // games you opened in the Game list
  const seenReq = new Set((S.req || []).map(r => r.line)); S.req = S.req || [];
  (o.req || []).forEach(r => { if (!seenReq.has(r.line)) S.req.push(r); });
}
(async () => {
  try {
    if (!window.claude || !window.claude.use) return;
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    if (!db || !user) return;
    const uid = await user.id();
    if (!uid) return;
    const ref = db.doc("data/users/" + uid + "/drill");
    const snap = await ref.get();
    if (snap.exists) merge(snap.data());
    sharedDb = db;
    try {   // shared request list is the source of truth: Claude removes lines once they're added to the repertoire
      const qs = await db.collection("requests").get();
      const shared = qs.docs.map(d => d.data()).filter(x => x && x.line).map(x => ({ line: x.line, t: x.t || 0, synced: true }));
      const have = new Set(shared.map(x => x.line));
      const pending = (S.req || []).filter(x => !x.synced && !have.has(x.line));
      S.req = [...shared, ...pending];
      pending.forEach(pushReq);
    } catch (e) { console.error(e); }
    remote = ref; dirty = true; await flush();
  } catch (e) { reportProblem("Couldn't reach your Claude account; progress is saved in this browser only.", e); return; }
  // redraw with the merged progress (errors here are page bugs, not sync failures)
  if (DATA) { refreshPanels(); if (mode === "lessons" && !lesson) showLessonList(); }
  if (window.onGymStore) window.onGymStore();
})();
function rec(i) { const k = N[i].k; return S.n[k] || (S.n[k] = { ok: 0, bad: 0, streak: 0, last: null, t: 0, wrong: {} }); }
function recOf(i) { return S.n[N[i].k]; }

/* ---------- board ---------- */
function parseFen(fen) {
  const b = {};
  fen.split(" ")[0].split("/").forEach((row, r) => {
    let f = 0;
    for (const ch of row) { if (/\d/.test(ch)) { f += +ch; continue; } b[FILES[f] + (8 - r)] = ch; f++; }
  });
  return b;
}
function applyMove(b, uci) {
  const n = { ...b }, from = uci.slice(0, 2), to = uci.slice(2, 4), pc = n[from];
  delete n[from];
  if (pc === "p" && from[0] !== to[0] && !b[to]) delete n[to[0] + (+to[1] + 1)];
  if (pc === "P" && from[0] !== to[0] && !b[to]) delete n[to[0] + (+to[1] - 1)];
  n[to] = uci.length > 4 ? (pc === pc.toLowerCase() ? uci[4] : uci[4].toUpperCase()) : pc;
  if (pc === "k" && from === "e8" && to === "g8") { n.f8 = n.h8; delete n.h8; }
  if (pc === "k" && from === "e8" && to === "c8") { n.d8 = n.a8; delete n.a8; }
  if (pc === "K" && from === "e1" && to === "g1") { n.f1 = n.h1; delete n.h1; }
  if (pc === "K" && from === "e1" && to === "c1") { n.d1 = n.a1; delete n.a1; }
  return n;
}
function epdAfter(fen, uci) {   // EPD after a move, matching python-chess Board.epd()
  const parts = fen.split(" "), before = parseFen(fen), b = applyMove(before, uci), rows = [], white = parts[1] === "w";
  for (let r = 8; r >= 1; r--) {
    let s = "", e = 0;
    for (let f = 0; f < 8; f++) { const p = b[FILES[f] + r]; if (p) { if (e) { s += e; e = 0; } s += p; } else e++; }
    if (e) s += e; rows.push(s);
  }
  let c = parts[2] === "-" ? "" : parts[2];
  const from = uci.slice(0, 2), to = uci.slice(2, 4), pc = before[from];
  if (from === "e8") c = c.replace(/[kq]/g, ""); if (from === "e1") c = c.replace(/[KQ]/g, "");
  if (from === "h8" || to === "h8") c = c.replace("k", ""); if (from === "a8" || to === "a8") c = c.replace("q", "");
  if (from === "h1" || to === "h1") c = c.replace("K", ""); if (from === "a1" || to === "a1") c = c.replace("Q", "");
  let ep = "-";
  const dbl = white ? pc === "P" && from[1] === "2" && to[1] === "4" : pc === "p" && from[1] === "7" && to[1] === "5";
  if (dbl) {
    const f = FILES.indexOf(to[0]), enemy = white ? "p" : "P";
    if ([f - 1, f + 1].some(x => x >= 0 && x < 8 && b[FILES[x] + to[1]] === enemy)) ep = to[0] + (white ? "3" : "6");
  }
  return `${rows.join("/")} ${white ? "b" : "w"} ${c || "-"} ${ep}`;
}
function sqXY(sq, o = orient) { const f = FILES.indexOf(sq[0]), r = +sq[1]; return o === "b" ? [7 - f, r - 1] : [f, 8 - r]; }
function sqOf(col, row, o = orient) { return o === "b" ? FILES[7 - col] + (row + 1) : FILES[col] + (8 - row); }
let drag = null;
function renderBoard(pos, { hl = [], sel = null, tgts = [], arrows = [], el = null, o = orient, marks = {} } = {}) {
  let html = "";
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const sq = sqOf(col, row, o), f = FILES.indexOf(sq[0]), r = +sq[1], p = pos[sq];
    let cls = `sq ${(f + r) % 2 === 1 ? "l" : "d"}`;
    if (hl.includes(sq)) cls += " hl";
    if (sel === sq) cls += " sel";
    if (tgts.includes(sq)) cls += " tgt" + (p ? " occ" : "");
    let st = "";
    if (marks[sq]) { const [mc, md] = String(marks[sq]).split(":"); cls += " " + mc; if (md) st = ` style="--d:${0.4 + md * 0.35}s"`; }
    let inner = "";
    if (p) {
      const w = p === p.toUpperCase();
      inner += `<span class="pc ${w ? "w" : "b"}${p.toUpperCase()}${drag && drag.from === sq && drag.moved ? " lift" : ""}"></span>`;
    }
    if (col === 7) inner += `<span class="coord r">${r}</span>`;
    if (row === 7) inner += `<span class="coord f">${FILES[f]}</span>`;
    html += `<div class="${cls}"${st}>${inner}</div>`;
  }
  const root = el || $("board");
  root.querySelector(".squares").innerHTML = html;
  root.querySelector(".arrows").innerHTML = arrows.map(([u, c], i) =>
    `<g class="arr"${c === "cover" || c === "escape" ? ` style="animation-delay:${0.4 + i * 0.35}s"` : ""}>${arrowPath(u, c, o)}</g>`).join("");
}
// Lichess (chessground) arrow style: thick round-capped line with a triangular head; a square is 1 unit
const BRUSH = { green: "#15781B", red: "#882020", blue: "#003088", cover: "#d4552f", escape: "#1f9d55" };
// head drawn per arrow (a shared <marker> breaks when the first board defining it is hidden)
function arrowPath(uci, brush, o = orient) {
  const [x1, y1] = sqXY(uci.slice(0, 2), o), [x2, y2] = sqXY(uci.slice(2, 4), o);
  const ax = x1 + .5, ay = y1 + .5, bx = x2 + .5, by = y2 + .5, len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len, uy = (by - ay) / len, px = -uy, py = ux, sw = (brush === "cover" || brush === "escape" ? 6 : 10) / 64;
  const ex = bx - ux * sw, ey = by - uy * sw;                 // line end (chessground margin)
  const bx0 = ex - ux * 2.05 * sw, by0 = ey - uy * 2.05 * sw;  // head base centre
  const tx = ex + ux * .95 * sw, ty = ey + uy * .95 * sw;      // head tip
  const hw = 2 * sw, c = BRUSH[brush];
  return `<line x1="${ax}" y1="${ay}" x2="${bx0}" y2="${by0}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>` +
    `<polygon points="${bx0 + px * hw},${by0 + py * hw} ${tx},${ty} ${bx0 - px * hw},${by0 - py * hw}" fill="${c}"/>`;
}

/* ---------- line state ---------- */
let mode = "lessons";
let cur = null, pos = parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
let hist = [], path = [], lastPath = null, forced = null;
let phase = "idle";          // idle | white | black | fail | done
let sel = null, lastMove = [], arrowsNow = [], hintShown = false, streak = 0;
let scope = null;            // Set of node ids the line may use, or null
let lesson = null;           // {li, phase: 'intro'|'walk'|'test'|'done', got:Set, misses:[]}
let review = null;           // {queue:[ids], single:bool, round, target, seenAt: {node: round it was last answered}}
const REVIEW_COOL = 3;       // a position answered in Review isn't asked again (picked or on the way) for 3 more items
let filter = "all";
try { filter = localStorage.getItem(STORE + ":filter") || "all"; } catch (e) {}
const FIRST = { e2e4: "1.e4", d2d4: "1.d4", c2c4: "1.c4", g1f3: "1.Nf3" };

function getWM() { return wiPar === "root" ? DATA.roots.map(e => [e[0], e[1], e[4]]) : (wiPar === null ? [] : N[wiPar].wm); }
function legalList() { return phase === "play" ? poLegal() : phase === "black" ? N[cur].mv.map(m => m[0]) : phase === "whatif" ? getWM().map(w => w[0]) : []; }
function draw() {
  const tg = sel ? legalList().filter(u => u.startsWith(sel)).map(u => u.slice(2, 4)) : [];
  renderBoard(pos, { hl: lastMove, sel, tgts: tg, arrows: arrowsNow });
  $("board").classList.toggle("mine", phase === "black" || phase === "whatif" || phase === "play");
}
function renderMoves() {
  if (!hist.length) { $("moves").innerHTML = `<span class="fam">The line appears here.</span>`; return; }
  const at = frames.length ? frames[fi].h : hist.length, base = frames.length ? frames[0].h : 0;
  $("moves").innerHTML = hist.map((h, i) =>
    (h.side === "w" ? `<span class="n">${h.no}.</span>` : i === 0 ? `<span class="n">${h.no}…</span>` : "") +
    `<span class="m ${h.cls || ""}${i === at - 1 ? " last" : ""}${i >= at ? " fut" : ""}${i >= base - 1 ? " nav" : ""}" data-h="${i + 1}">${esc(h.san)}</span>`).join("");
  $("moves").querySelectorAll(".m.nav").forEach(el => el.onclick = () => {
    const k = frames.findIndex(f => f.h === +el.dataset.h);
    if (k >= 0 && !(lesson && lesson.phase === "walk")) goFrame(k);
  });
}
function tally() { $("tally").innerHTML = `<span>streak <b>${streak}</b></span><span>best <b>${S.best}</b></span><span>lines <b>${S.lines}</b></span>`; }
function setState(t, cls = "") { $("state").textContent = t; $("state").className = "state " + cls; }
function setCard(cls, html) { $("card").className = "card " + cls; $("card").innerHTML = html; }
function pchip(p) { return P[p] ? `<span class="pchip" title="${esc(P[p][1])}">${esc(P[p][0])}</span>` : ""; }
function moveNo(i) { return +N[i].fen.split(" ")[5]; }
function histFromPre(pre) { return pre.map((san, i) => ({ san, side: i % 2 ? "b" : "w", no: Math.floor(i / 2) + 1 })); }

/* ---------- choosing White's moves ---------- */
const subCache = {};
function subtree(id) {
  if (subCache[id]) return subCache[id];
  const seen = new Set(), st = [id];
  while (st.length) { const x = st.pop(); if (seen.has(x)) continue; seen.add(x); N[x].next.forEach(e => st.push(e[4])); }
  return (subCache[id] = [...seen]);
}
function due(i) {
  if (lesson && lesson.phase === "test") return lesson.got.has(i) ? 0.05 : (recOf(i)?.last === "bad" ? 4 : 1.5);
  const r = recOf(i);
  if (!r) return 1;
  return r.last === "bad" ? 3 : Math.pow(0.55, r.streak);
}
function weightOf(e, depth) {
  let ids = subtree(e[4]);
  if (scope) ids = ids.filter(x => scope.has(x));
  if (!ids.length) return 0.01;
  const need = ids.reduce((s, x) => s + due(x), 0) / ids.length;
  let w = Math.sqrt(Math.max(e[2], 0.3)) * (0.12 + need);
  if (lastPath && lastPath[depth] === e[0] && !(lesson && lesson.phase === "test")) w *= 0.35;
  return w;
}
function pick(edges, depth) {
  if (lesson && lesson.phase === "walk") return edges.reduce((a, b) => (b[2] > a[2] ? b : a));   // walkthrough: most common move
  if (forced && forced[depth]) { const f = edges.find(x => x[0] === forced[depth]); if (f) return f; }
  const ws = edges.map(e => weightOf(e, depth));
  let x = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < edges.length; i++) { x -= ws[i]; if (x <= 0) return edges[i]; }
  return edges[edges.length - 1];
}
function inScope(edges) { return scope ? edges.filter(e => scope.has(e[4])) : edges; }

/* ---------- starting lines ---------- */
function resetLine() {
  frames = []; fi = 0; wiPar = null; clearTimeout(whiteTimer); shownSt = null; $("struct").hidden = true; timedStop(); poStop();
  hist = []; path = []; hintShown = false; arrowsNow = []; sel = null; lastMove = [];
  document.querySelector(".ghost")?.remove(); drag = null;
}
function startFromRoot(replay = false) {           // free play
  if (ME === "w") {
    const again = replay && path.length ? [...path] : null;
    startAt(DATA.start, `<span class="who">Free play</span><span>You're White. Play your repertoire from move one.</span>`);
    forced = again;                                  // startAt clears it; set it after so Replay repeats Black's replies
    return;
  }
  forced = replay && path.length ? [...path] : null;
  if (!replay && path.length) lastPath = [...path];
  resetLine();
  pos = parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  setState("White to move"); setCard("", `<p class="sub">White is choosing a first move…</p>`);
  $("idea").innerHTML = "";
  pushFrame("white", { wmOf: "root", resume: "root" });
  renderMoves(); draw();
  let edges = DATA.roots.filter(e => filter === "all" || (filter === "other" ? !FIRST[e[0]] : e[0] === filter));
  if (!edges.length) edges = DATA.roots;
  playWhite(edges, 0);
}
function startAt(i, ideaHtml) {                     // start mid-tree at node i (Black to move)
  forced = null;
  if (path.length) lastPath = [...path];
  resetLine();
  cur = i; pos = parseFen(N[i].fen); hist = histFromPre(N[i].pre);
  lastMove = N[i].lu ? [N[i].lu.slice(0, 2), N[i].lu.slice(2, 4)] : [];
  $("idea").innerHTML = ideaHtml || "";
  beginBlack();
}
// free play: replies already shown at each position; stepping back and replaying your move shows a new one
let replySeen = {}, replayAgain = false;
function playWhite(edges, depth, key) {
  phase = "white"; wiPar = null;
  let seenNote = "";
  if (key !== undefined && mode === "free") {
    const seen = replySeen[key] = replySeen[key] || new Set(), total = edges.length;
    if (replayAgain && total > 1) {
      const fresh = edges.filter(e => !seen.has(e[0]));
      if (fresh.length) { edges = fresh; seenNote = `A different reply: ${seen.size + 1} of the ${total} ${OPP} replies in your repertoire here.`; }
      else { seen.clear(); seenNote = `You've seen all ${total} ${OPP} replies in your repertoire here, so they start over.`; }
    } else if (replayAgain) seenNote = `This is the only ${OPP} reply in your repertoire here.`;
  }
  replayAgain = false;
  const e = pick(edges, depth);
  if (key !== undefined && replySeen[key]) replySeen[key].add(e[0]);
  path[depth] = e[0];
  const delay = matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 420;
  whiteTimer = setTimeout(() => {
    const to = N[e[4]], no = +to.fen.split(" ")[5] - (ME === "w" ? 1 : 0);
    pos = parseFen(to.fen); lastMove = [e[0].slice(0, 2), e[0].slice(2, 4)]; arrowsNow = [];
    if (depth === 0 && e[5]) e[5].forEach(([san, side, n]) => hist.push({ san, side, no: n }));
    hist.push({ san: e[1], side: OPPC, no });
    $("idea").innerHTML = `<span class="who">${OPP} played <b>${oppLbl(no, e[1])}</b></span>${e[3] ? `<span>${esc(e[3])}</span>` : ""}${seenNote ? `<span class="tiny">${esc(seenNote)}</span>` : ""}`;
    cur = e[4];
    beginBlack();
  }, delay);
}
let whiteTimer = null, frames = [], fi = 0, wiPar = null;
// one frame per ply of the current line: what the board showed and whose turn it was
function pushFrame(kind, extra = {}) {
  frames.push(Object.assign({ kind, pos, lastMove, h: hist.length, cur, arrows: arrowsNow.slice(), idea: $("idea").innerHTML,
    card: [$("card").className, $("card").innerHTML], state: [$("state").textContent, $("state").className] }, extra));
  fi = frames.length - 1;
}
function snapFrame() {   // refresh the live frame's stored card after it changed
  const f = frames[fi]; if (!f) return;
  f.card = [$("card").className, $("card").innerHTML]; f.state = [$("state").textContent, $("state").className]; f.arrows = arrowsNow.slice(); f.idea = $("idea").innerHTML;
}
function wireCard() {
  wireTwins();
  const b = $("bBack"); if (b) b.onclick = back;
  const po = $("bPlayOut"); if (po) po.onclick = () => startPlayout(+po.dataset.node);
  const so = $("bStartOver"); if (so) so.onclick = next;                       // a new line (free play: from move 1)
  const rh = $("bReplayHere"); if (rh) rh.onclick = () => startFromRoot(true);
  $("card").querySelectorAll("[data-wi]").forEach(x => x.onclick = () => whatIfMove(x.dataset.wi));
}
function goFrame(k) {
  if (k < 0 || k >= frames.length) return;
  clearTimeout(whiteTimer); drag = null; sel = null; document.querySelector(".ghost")?.remove(); timedStop(); altWait = null;
  fi = k;
  const f = frames[k], live = k === frames.length - 1;
  pos = f.pos; lastMove = f.lastMove; cur = f.cur; arrowsNow = live ? f.arrows : [];
  $("idea").innerHTML = f.idea;
  if (f.kind === "black") {
    phase = "black"; hintShown = !live;
    showStruct(N[cur].stb, N[cur].sbi);
    if (live) { $("card").className = f.card[0]; $("card").innerHTML = f.card[1]; setState(...f.state); }
    else { setState("Your move again"); setCard("", `<p class="sub">You've stepped back. Play a move to try it (it won't count toward your progress), or press → to go forward.</p>`); }
  } else if (f.kind === "white") {
    phase = "whatif"; wiPar = f.wmOf;
    const inRep = getWM().filter(w => w[2] >= 0), no = wiPar === "root" ? 1 : moveNo(wiPar) + (ME === "b" ? 1 : 0);
    setState(`${OPP} to move`);
    setCard("alt", `<div class="head"><span class="tag alt">Your choice for ${OPP}</span></div>
      <p class="text">Play any ${OPP} move to test a variation. If it's in your repertoire the line continues; if not, it's saved to <b>Lines to investigate</b>.${live && f.resume !== undefined ? " Or press → to let White choose." : ""}</p>
      ${inRep.length ? `<p class="sub">In your repertoire here: ${inRep.map(w => `<button class="chip" data-wi="${w[0]}">${oppLbl(no, w[1])}</button>`).join(" ")}</p>` : ""}`);
  } else {
    phase = live ? f.phase || "done" : "view";
    if (live) { $("card").className = f.card[0]; $("card").innerHTML = f.card[1]; setState(...f.state); }
    else { setState("Looking back"); setCard("", `<p class="sub">Press → to go forward, or ← to go back further.</p>`); }
  }
  wireCard(); renderMoves(); draw(); syncControls();
}
function back() { if (!(lesson && lesson.phase === "walk") && fi > 0) goFrame(fi - 1); }
function forward() {
  if (phase === "alt") return altContinue();
  if (lesson && lesson.phase === "walk") return;
  if (fi < frames.length - 1) return goFrame(fi + 1);
  const f = frames[fi];                                   // at the live end: let White continue if it was cut short
  if (f && f.kind === "white" && f.resume !== undefined && phase === "whatif") continueFrom(f.resume, f.via || null);
}
function beginBlack() {
  if (reviewAutoplay()) return;
  phase = "black"; hintShown = false; sel = null;
  showStruct(N[cur].stb, N[cur].sbi);
  const n = N[cur];
  if (lesson && lesson.phase === "walk") {
    arrowsNow = [[n.m, "green"]];
    setState("Play the arrow move");
    setCard("pass", `<div class="head"><span class="tag pass">Learn</span><span class="mvname">${lmNo(moveNo(cur), n.s)}</span>${pchip(n.p)}</div><p class="text">${esc(n.why)}</p>`);
  } else {
    arrowsNow = [];
    setState("Your move");
    if (!$("card").classList.contains("pass") && !$("card").classList.contains("alt")) setCard("", `<p class="sub">Find the move to learn. Sound alternatives count too.</p>`);
  }
  pushFrame("black");
  renderMoves(); draw(); refreshBar();
  timedStart();
}

/* ---------- judging ---------- */
function judge(uci) {
  const n = N[cur], m = n.mv.find(x => x[0] === uci);
  if (!m) return null;
  if (uci === n.m) return { kind: "main", san: m[1] };
  if (n.wrong[uci]) return { kind: "fail", san: m[1], text: n.wrong[uci] };
  if (n.also[uci]) return { kind: "alt", san: m[1], text: n.also[uci] };
  if (m[3]) return { kind: "alt", san: m[1], text: m[2] <= 15 ? "The engine rates it as highly as the main move." : `Sound: the engine rates it only ${(m[2] / 100).toFixed(1)} pawns below its top choice.` };
  return { kind: "fail", san: m[1], text: m[4] || `This hands ${OPP} the initiative.` };
}
function playerMove(uci) {
  if (phase !== "black") return;
  const v = judge(uci);
  if (!v) return;
  timedStop();
  if (review) review.seenAt[cur] = review.round;
  replayAgain = frames.length && fi < frames.length - 1;          // you stepped back and are playing this position again
  if (replayAgain) { hist = hist.slice(0, frames[fi].h); frames = frames.slice(0, fi + 1); }
  const n = N[cur], id = cur, no = moveNo(id);
  sel = null;
  if (lesson && lesson.phase === "walk" && v.kind !== "main") {
    setCard("alt", `<div class="head"><span class="tag alt">Walkthrough</span></div><p class="text">In the walkthrough, play the green arrow: <b>${lmNo(no, n.s)}</b>. The test comes next.</p><p class="sub">${esc(n.why)}</p>`);
    draw(); return;
  }
  const r = rec(id);
  if (v.kind === "fail") return showFail(id, v, uci);
  if (!(lesson && lesson.phase === "walk")) {
    if (!hintShown) { r.ok++; r.streak++; r.last = "ok"; r.t = Date.now(); }
    streak++; S.best = Math.max(S.best, streak);
    if (lesson && lesson.phase === "test" && !hintShown && lessonSets[lesson.li].has(id)) lesson.got.add(id);
  }
  save();
  let from = cur, note = "", via = null;
  if (v.kind === "main") {
    showStruct(n.st, n.sai);
    hist.push({ san: v.san, side: ME, no, cls: "me" });
    pos = applyMove(pos, uci);
    lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
    if (!(lesson && lesson.phase === "walk")) {
      setState("Right", "pass");
      setCard("pass", `<div class="head"><span class="tag pass">Right</span><span class="mvname">${lmNo(no, v.san)}</span>${pchip(n.p)}</div><p class="text">${esc(n.why)}</p>${contrastHtml(id)}`);
      wireTwins();
    }
  } else {
    const tr = DATA.posts[epdAfter(n.fen, uci)];
    if (tr !== undefined && tr !== cur && N[tr].next.length && (!scope || scope.has(tr))) {
      from = tr; hist.push({ san: v.san, side: ME, no, cls: "me a" });
      pos = applyMove(pos, uci); lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
      note = `<p class="sub">It transposes to a line in the repertoire, so we carry on from there.</p>`;
    } else if ((via = ((n.tr || {})[uci] || []).find(t => !scope || scope.has(t[2])))) {
      hist.push({ san: v.san, side: ME, no, cls: "me a" });
      pos = applyMove(pos, uci); lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
      note = `<p class="sub">${OPP} can bring this back into your repertoire with ${esc(via[1])}, so we follow that line.</p>`;
    } else {
      hist.push({ san: v.san, side: ME, no, cls: "me a" });            // your move stays on the board until you continue
      pos = applyMove(pos, uci); lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
      note = `<p class="sub">We continue with the move to learn, <b>${lmNo(no, n.s)}</b>: ${esc(n.why)}</p>`;
    }
    const replace = from === cur && !via;
    setState("Playable", "alt");
    setCard("alt", `<div class="head"><span class="tag alt">Playable</span><span class="mvname">${lmNo(no, v.san)} ${lossTag(n, uci)}</span></div><p class="text">${esc(v.text)}</p>
      ${engineCompare(n, uci, no, v.san)}${note}
      <div class="controls"><button class="btn primary" id="bAltGo">${replace ? `Continue with ${lmNo(no, n.s)}` : "Continue"} ▶</button></div>`);
    // pause here: you see your move (blue) and the move to learn (green); → or the button carries on
    arrowsNow = replace ? [[uci, "blue"], [n.m, "green"]] : [];
    phase = "alt"; altWait = { from, via, id, replace };
    $("bAltGo").onclick = altContinue;
    tally(); renderMoves(); draw(); refreshBar();
    return;
  }
  arrowsNow = [];
  pushFrame("white", { wmOf: from, resume: from });
  tally(); renderMoves(); draw(); refreshBar();
  continueFrom(from, via);
}
// a playable move: carry on (with the move to learn instead of yours, unless yours transposes into the repertoire)
let altWait = null;
function altContinue() {
  const a = altWait; if (!a || phase !== "alt") return;
  altWait = null;
  const n = N[a.id];
  if (a.replace) {
    hist.pop(); hist.push({ san: n.s, side: ME, no: moveNo(a.id), cls: "me" });
    pos = applyMove(parseFen(n.fen), n.m); lastMove = [n.m.slice(0, 2), n.m.slice(2, 4)];
  }
  arrowsNow = [];
  if (a.via) pushFrame("view", { phase: "white" });
  else pushFrame("white", { wmOf: a.from, resume: a.from });
  renderMoves(); draw();
  continueFrom(a.from, a.via);
}
// the engine's verdict on the final position (stored by the build: after the move to learn, from your side)
function evalLine(n) {
  if (n.ev === null || n.ev === undefined) return "";
  const cp = n.ev, fmt = x => Math.abs(x) >= 9000 ? "mate" : (x > 0 ? "+" : x < 0 ? "−" : "") + (Math.abs(x) / 100).toFixed(2);
  const verdict = Math.abs(cp) >= 9000 ? (cp > 0 ? "a forced mate for you" : "a forced mate against you")
    : cp >= 150 ? "clearly better for you" : cp >= 50 ? "a pleasant edge for you" : cp > -50 ? "about equal" : cp > -150 ? `a small edge for ${OPP}` : `clearly better for ${OPP}`;
  const white = ME === "w" ? cp : -cp;
  return `<p class="sub eng">Engine: <b>${fmt(cp)}</b> for you, ${verdict}${ME === "b" ? ` (${fmt(white)} in White's terms)` : ""}.</p>`;
}
// right after a playable or wrong move (and the move to learn): the engine's loss against its best move, "(−0.3)" or
// "(best)" (depth 12, from the build)
function lossTag(n, uci) {
  const r = (n.mv || []).find(x => x[0] === uci);
  if (!r || r[2] === null || r[2] === undefined) return "";
  return `<span class="evd" title="Engine: difference to its best move, in pawns">(${r[2] <= 0 ? "best" : "−" + (r[2] / 100).toFixed(r[2] < 5 ? 2 : 1)})</span>`;
}
// how much the engine prefers the move to learn over the move you played (the build's depth-12 check)
function engineCompare(n, uci, no, san) {
  const loss = u => { const r = (n.mv || []).find(x => x[0] === u); return r ? r[2] : null; };
  const mine = loss(uci), main = loss(n.m);
  if (mine === null || main === null) return "";
  const d = mine - main, p = x => (Math.abs(x) / 100).toFixed(2);
  const text = d > 5 ? `${lmNo(no, san)} is <b>${p(d)}</b> pawns worse than ${lmNo(no, n.s)}.`
    : d < -5 ? `the engine even rates ${lmNo(no, san)} <b>${p(d)}</b> pawns better than the move to learn.`
    : `practically equal to ${lmNo(no, n.s)}.`;
  return `<p class="sub eng">Engine: ${text}</p>`;
}
// a wrong answer (or, with timed answers, no answer in time: v.san and uci are null)
function showFail(id, v, uci) {
  const n = N[id], no = moveNo(id), r = rec(id);
  timedStop();
  if (review) review.seenAt[id] = review.round;        // (a timed-out answer too)
  r.bad++; r.streak = 0; r.last = "bad"; r.t = Date.now(); r.wrong = r.wrong || {};
  if (v.san) r.wrong[v.san] = (r.wrong[v.san] || 0) + 1;
  save();
  phase = "fail"; streak = 0;
  if (lesson) lesson.misses.push(id);
  if (v.san) hist.push({ san: v.san, side: ME, no, cls: "me x" });
  arrowsNow = uci ? [[uci, "red"], [n.m, "green"]] : [[n.m, "green"]]; lastMove = [];
  setState(v.san ? "Not this one" : "Too slow", "fail");
  setCard("fail", `<div class="head"><span class="tag fail">${v.san ? "Wrong" : "Time"}</span>${v.san ? `<span class="mvname">${lmNo(no, v.san)} ${lossTag(n, uci)}</span>` : ""}</div>
      <p class="text">${esc(v.text)}</p>
      <div class="plan"><span class="lbl">The move to learn: <span class="mvname" style="font-size:14px;color:var(--pass)">${lmNo(no, n.s)} ${lossTag(n, n.m)}</span></span>
      <div class="head">${pchip(n.p)}</div><p class="text">${esc(n.why)}</p></div>
      <p class="sub">Saved to your notebook. ${review ? "It stays in Review until you get it right." : "Review will bring it back."}</p>
      <div class="controls"><button class="btn" id="bBack">← Take back and retry</button></div>${contrastHtml(id)}`);
  wireCard();
  $("bNext").textContent = review ? "Next position" : "Next line";
  pushFrame("view", { phase: "fail" });
  renderMoves(); draw(); tally(); refreshPanels();
}
// Review, on the way through a line: a position answered a moment ago (not the one being reviewed) isn't asked again;
// its move to learn is played for you and the line goes on
function reviewAutoplay() {
  if (!review || review.single || cur === review.target || !reviewCool(cur) || lesson) return false;
  const n = N[cur], id = cur;
  hist.push({ san: n.s, side: ME, no: moveNo(id), cls: "me" });
  pos = applyMove(pos, n.m); lastMove = [n.m.slice(0, 2), n.m.slice(2, 4)]; arrowsNow = [];
  setCard("", `<p class="sub">You answered <b>${lmNo(moveNo(id), n.s)}</b> a moment ago in this review, so it's played for you.</p>`);
  pushFrame("white", { wmOf: id, resume: id });
  renderMoves(); draw();
  continueFrom(id, null);
  return true;
}
function continueFrom(from, via) {
  if (from === "root") {
    let edges = DATA.roots.filter(e => filter === "all" || (filter === "other" ? !FIRST[e[0]] : e[0] === filter));
    return playWhite(edges.length ? edges : DATA.roots, 0, "root");
  }
  if (via) return playWhite([[via[0], via[1], 1, "A transposition: this reaches a position from your repertoire.", via[2]]], path.length);
  const all = N[from].next, edges = inScope(all);
  if (!all.length) return finishLine(from, null);
  if (!edges.length) return finishLine(from, all);
  playWhite(edges, path.length, from);
}
function finishLine(i, exits) {
  phase = "done"; S.lines++; save();
  const n = N[i];
  let extra;
  if (exits) {
    const names = [...new Set(exits.map(e => nodeLesson[e[4]]).filter(x => x !== undefined && (!lesson || x !== lesson.li)))].map(x => `<b>${esc(L[x].title)}</b>`);
    extra = `<div class="plan"><span class="lbl">From here</span><p class="text">${OPP} now picks a system${names.length ? ": " + names.join(", ") : ""}. ${names.length ? "Each has its own lesson." : ""}</p></div>`;
  } else extra = `<div class="plan"><span class="lbl">Your plan from here</span><p class="text">${esc(n.plan || "")}</p>${evalLine(n)}
    ${n.plan && !(lesson && lesson.phase === "walk") ? `<div class="controls"><button class="btn" id="bPlayOut" data-node="${i}">▶ Play it out against the engine</button></div>` : ""}</div>`;
  const cls = $("card").className.includes("alt") ? "alt" : "done";
  $("card").className = "card " + cls;
  $("card").innerHTML = $("card").innerHTML.replace('class="tag pass">Right', 'class="tag done">Line complete') + extra;
  setState("Line complete", "pass");
  if (lesson && lesson.phase === "walk") {
    S.les[L[lesson.li].id] = Object.assign(S.les[L[lesson.li].id] || {}, { walk: true }); save();
    $("card").innerHTML = `<div class="head"><span class="tag done">Walkthrough done</span></div><p class="text">That's the main line of <b>${esc(L[lesson.li].title)}</b>.</p>${extra}<p class="sub">Now the test: ${OPP} will vary its moves until you've answered every position in this lesson.</p>`;
    $("bNext").textContent = "Start the test";
  } else if (lesson && lesson.phase === "test" && lesson.got.size >= lessonSets[lesson.li].size) {
    return lessonDone();
  } else $("bNext").textContent = review ? "Next position" : "Next line";
  const f = frames[fi];
  if (f && f.kind === "white" && !(lesson && lesson.phase === "walk")) {
    phase = "whatif"; wiPar = f.wmOf;
    $("card").insertAdjacentHTML("beforeend", `<p class="sub">Want to take this line further? Play a ${OPP} move on the board: if it's in your repertoire the line continues, if not it's saved for Claude to add.</p>`);
    draw();
  }
  if (f) { f.resume = undefined; snapFrame(); }
  wireCard(); tally(); refreshPanels();
}

/* ---------- lessons ---------- */
function mastery(li) {
  const ids = L[li].nodes; let s = 0, b = 0;
  ids.forEach(i => { const r = recOf(i); if (r?.last === "ok") s++; else if (r?.last === "bad") b++; });
  return { s, b, t: ids.length };
}
function recommended() {
  const i = L.findIndex(l => !S.les[l.id]?.done);
  if (i >= 0) return i;
  let best = 0, bv = 2;
  L.forEach((l, li) => { const m = mastery(li), v = m.s / m.t - m.b / m.t; if (v < bv) { bv = v; best = li; } });
  return best;
}
function showLessonList() {
  lesson = null; scope = null; review = null; phase = "idle";
  $("lessonbar").hidden = true;
  const ri = recommended();
  const l0 = L[ri];
  const st = N[l0.starts[0]];
  resetLine(); pos = parseFen(st.fen); hist = histFromPre(st.pre); lastMove = st.lu ? [st.lu.slice(0, 2), st.lu.slice(2, 4)] : [];
  $("idea").innerHTML = `<span class="who">Lesson preview</span><span>${esc(l0.idea)}</span>`;
  setState("Pick a lesson");
  const groups = [...new Set(L.map(l => l.group))];
  const rows = groups.map(g => `<div class="lgroup"><span class="gname">${esc(g)}</span>` + L.map((l, li) => {
    if (l.group !== g) return "";
    const m = mastery(li), done = S.les[l.id]?.done;
    const status = m.b ? `<span class="st fix">${m.b} to fix</span>` : done ? `<span class="st done">done</span>` : "";
    return `<div class="lrow${li === ri ? " rec" : ""}"><span class="nm">${esc(l.title)}</span>
      <span class="meta"><span class="mini"><i style="width:${100 * m.s / m.t}%"></i></span>${m.s}/${m.t} solid ${status}</span>
      <button class="btn${li === ri ? " primary" : ""}" data-li="${li}">${done ? "Redo" : m.s ? "Continue" : "Start"}</button></div>`;
  }).join("") + `</div>`).join("");
  setCard("", `<div class="recbox"><span class="lbl">Suggested next</span><h3>${esc(l0.title)}</h3><p class="sub">${esc(l0.plan)}</p>
    <div class="controls"><button class="btn primary" data-li="${ri}">Start this lesson</button></div></div><div class="llist">${rows}</div>`);
  $("card").querySelectorAll("[data-li]").forEach(b => b.onclick = () => openLesson(+b.dataset.li));
  syncControls(); renderMoves(); draw();
}
function openLesson(li) {
  lesson = { li, phase: "intro", got: new Set(), misses: [] };
  scope = lessonSets[li]; review = null;
  const l = L[li], st = N[l.starts[0]];
  resetLine(); pos = parseFen(st.fen); hist = histFromPre(st.pre); lastMove = st.lu ? [st.lu.slice(0, 2), st.lu.slice(2, 4)] : [];
  phase = "idle";
  const principles = {};
  l.nodes.forEach(i => principles[N[i].p] = (principles[N[i].p] || 0) + 1);
  const top = Object.entries(principles).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => pchip(p)).join(" ");
  $("idea").innerHTML = `<span class="who">${OPP}'s idea</span><span>${esc(l.idea)}</span>`;
  setState(l.title);
  setCard("done", `<div class="head"><span class="tag done">Lesson</span></div>
    <p class="text"><b>Your plan.</b> ${esc(l.plan)}</p>
    <div class="head">${top}</div>
    <p class="sub">First a walkthrough of the main line with the reasons, then a test across all ${l.nodes.length} positions in this lesson. A miss ends the line and goes to your notebook.</p>
    <div class="controls"><button class="btn primary" id="goWalk">Start the walkthrough</button><button class="btn" id="goTest">Skip to the test</button></div>
    ${modelsHtml(l)}`);
  $("goWalk").onclick = () => { lesson.phase = "walk"; lessonLine(); };
  $("goTest").onclick = () => { lesson.phase = "test"; lessonLine(); };
  syncControls(); renderMoves(); draw(); refreshBar();
}
// master games that reached this lesson's line (model_games.py): the plan shown in real games, not just asserted
function modelsHtml(l) {
  const m = l.models; if (!m || !m.games.length) return "";
  const n = N[m.node], where = `${esc(n.line)} ${lmNo(moveNo(m.node), n.s)}`;
  const then = m.freq.length ? `<p class="sub">From there, the ${MEN} player went on with ${m.freq.map(([s, c]) =>
    `<b>${ME === "b" ? "…" : ""}${esc(s)}</b> (${c} of ${m.games.length})`).join(", ")}.</p>` : "";
  const games = m.games.map(g => `<li><a href="https://lichess.org/${encodeURIComponent(g.id)}" target="_blank" rel="noopener">${esc(g.white)} – ${esc(g.black)}</a>
    <span class="tiny">${g.year || ""} · ${esc(g.result)}</span></li>`).join("");
  return `<div class="models"><span class="lbl">Model games</span>
    <p class="sub">Master games that reached ${where} (${m.total.toLocaleString()} in the database).</p>${then}<ul>${games}</ul></div>`;
}
function lessonLine() {
  const l = L[lesson.li];
  let start;
  if (lesson.phase === "walk") start = l.starts[0];
  else {
    const ws = l.starts.map(s => subtree(s).filter(x => scope.has(x)).reduce((a, x) => a + due(x), 0) + 0.01);
    let x = Math.random() * ws.reduce((a, b) => a + b, 0); start = l.starts[l.starts.length - 1];
    for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) { start = l.starts[i]; break; } }
  }
  if (lesson.phase === "walk") forced = null;
  startAt(start, `<span class="who">${esc(l.title)}</span><span>${esc(l.idea)}</span>`);
  $("bNext").textContent = "Next line"; syncControls();
}
function lessonDone() {
  const l = L[lesson.li];
  S.les[l.id] = Object.assign(S.les[l.id] || {}, { done: true, walk: true, t: Date.now() }); save();
  lesson.phase = "done"; phase = "done";
  const miss = [...new Set(lesson.misses)];
  const nx = recommended();
  setState("Lesson complete", "pass");
  setCard("done", `<div class="head"><span class="tag done">Lesson complete</span><span class="mvname">${esc(l.title)}</span></div>
    <p class="text">You've answered all ${lessonSets[lesson.li].size} positions${miss.length ? `, with ${miss.length} miss${miss.length === 1 ? "" : "es"} along the way` : " without a miss"}.</p>
    ${miss.length ? `<p class="sub">Those positions are in your notebook and in Review.</p>` : ""}
    <div class="plan"><span class="lbl">Remember</span><p class="text">${esc(l.plan)}</p></div>
    <div class="controls"><button class="btn primary" id="goNextL">Next lesson: ${esc(L[nx].title)}</button><button class="btn" id="goList">All lessons</button></div>`);
  $("goNextL").onclick = () => openLesson(nx);
  $("goList").onclick = showLessonList;
  refreshBar(); refreshPanels(); syncControls();
}
function refreshBar() {
  if (!lesson) { $("lessonbar").hidden = true; return; }
  $("lessonbar").hidden = false;
  const tot = lessonSets[lesson.li].size, got = lesson.got.size;
  $("lbTitle").textContent = L[lesson.li].title;
  $("lbPhase").textContent = lesson.phase === "walk" ? "walkthrough" : lesson.phase === "intro" ? "intro" : `${Math.min(got, tot)}/${tot} positions`;
  $("lbFill").style.width = (lesson.phase === "test" || lesson.phase === "done" ? 100 * Math.min(got, tot) / tot : 0) + "%";
}

/* ---------- review ---------- */
function reviewQueue() {
  const bad = i => (recOf(i)?.bad || 0) + (MYG[i] ? MYG[i].n : 0), t = i => recOf(i)?.t || 0;
  return N.map((n, i) => i).filter(i => recOf(i)?.last === "bad" || myGamesDue(i))
    .sort((a, b) => (bad(b) - bad(a)) || (t(b) - t(a)));
}
function startReview(single) {
  lesson = null; scope = null;
  const q = single !== undefined ? [single] : reviewQueue();
  review = { queue: q, single: single !== undefined, round: 0, target: null, seenAt: {} };
  $("lessonbar").hidden = true;
  nextReview();
}
let lastReviewed = null;
// pick at random, weighted to your most-missed positions, avoiding the lesson you just saw so each answer is real recall
// Positions answered in the last REVIEW_COOL items (picked, or met on the way through a line) wait, unless nothing else is left
function reviewCool(i) { return !!review && review.seenAt[i] !== undefined && review.round - review.seenAt[i] < REVIEW_COOL; }
function pickReview(q) {
  if (q.length < 2) return q;
  const lastL = lastReviewed === null ? -1 : nodeLesson[lastReviewed];
  const warm = q.filter(i => i !== lastReviewed && !reviewCool(i));
  const ws = q.map(i => i === lastReviewed || (warm.length && reviewCool(i)) ? 0 : (1 + (recOf(i)?.bad || 0) + Math.min(5, MYG[i]?.n || 0)) * (nodeLesson[i] === lastL ? 0.1 : 1));
  let x = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let k = 0; k < q.length; k++) { x -= ws[k]; if (x <= 0) return [q[k], ...q.filter((_, j) => j !== k)]; }
  return q;
}
function nextReview() {
  let q = review.single ? review.queue : pickReview(reviewQueue());
  if (!q.length || (review.single && review.done && recOf(q[0])?.last !== "bad" && !myGamesDue(q[0]))) {
    phase = "idle"; resetLine(); renderMoves(); draw();
    setState(review.single ? "Done" : "Nothing to review", "pass");
    setCard("done", `<p class="text">${review.single ? "That position is done." : "No missed positions right now. Lessons or free play will find new ones."}</p>
      <div class="controls"><button class="btn primary" id="goL">Back to lessons</button></div>`);
    $("goL").onclick = () => setMode("lessons");
    syncControls(); return;
  }
  if (review.single) review.done = true;
  const i = q[0], r = recOf(i);
  lastReviewed = i; review.round++; review.target = i;
  const wrong = r && r.wrong ? Object.keys(r.wrong) : [];
  startAt(i, r?.bad ? `<span class="who">From your notebook</span><span>You missed this ${r.bad}×${wrong.length ? ` (you played ${wrong.map(w => (ME === "b" ? "…" : "") + esc(w)).join(", ")})` : ""}. ${myGamesNote(i)} What's the move here?</span>`
    : `<span class="who">From your games</span><span>${myGamesNote(i)} What's the move to learn?</span>`);
  setCard("", `<p class="sub">${q.length} position${q.length === 1 ? "" : "s"} to fix. Get this one right and the line continues from there.</p>`);
  snapFrame();
  $("bNext").textContent = "Next position"; syncControls();
}

/* ---------- modes & controls ---------- */
function setMode(m) {
  mode = m; markTabs();
  $("filters").hidden = m !== "free" || ME !== "b";
  $("ideasView").hidden = m !== "ideas";
  $("mineView").hidden = m !== "mine"; $("gamesView").hidden = m !== "games";
  $("oTrainer").hidden = m === "ideas" || m === "mine" || m === "games";
  if (m === "ideas" || m === "mine" || m === "games") {
    lesson = null; scope = null; review = null; resetLine(); phase = "idle";
    if (m === "mine") renderMine(); if (m === "games") renderGames();
    syncControls(); return;
  }
  lesson = null; scope = null; review = null;
  if (m === "lessons") showLessonList();
  else if (m === "review") startReview();
  else { $("lessonbar").hidden = true; startFromRoot(); }
  syncControls();
}
function syncControls() {
  $("bReplay").hidden = mode !== "free";
  $("bLeave").hidden = !(mode === "lessons" && lesson);
  $("bNext").hidden = (mode === "lessons" && (!lesson || lesson.phase === "intro" || lesson.phase === "done"));
  $("bHint").hidden = !!(lesson && lesson.phase === "walk");
  $("bPlan").hidden = mode === "lessons" && (!lesson || lesson.phase === "intro");
}
function next() {
  if (mode === "free") return startFromRoot();
  if (mode === "review") return nextReview();
  if (lesson) {
    if (lesson.phase === "walk" && phase === "done") lesson.phase = "test";
    if (lesson.phase === "walk" || lesson.phase === "test") lessonLine();
  }
}
let shownSt = null;
function showStruct(id, idx) {
  const el = $("struct");
  if (!id || !DATA.structs[id]) { el.hidden = true; shownSt = null; return; }
  const sig = id + ":" + (idx || []).join(",");
  const changed = shownSt !== null && shownSt.split(":")[0] !== id, first = shownSt === null;
  if (shownSt === sig) return;
  const [name, desc, all] = DATA.structs[id];
  const ideas = idx ? idx.map(i => all[i]) : all;
  el.hidden = false;
  el.innerHTML = `<div class="top"><span class="lbl">Structure</span><span class="nm">${esc(name)}</span>${changed ? `<span class="new">just changed</span>` : ""}</div>
    <span class="d">${esc(desc)} Use that opening's ideas:</span><ul>${ideas.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
  if (changed || first) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  shownSt = sig;
}
function contrastHtml(i) {
  const c = N[i].cmp || [];
  if (!c.length) return "";
  return c.slice(0, 2).map(([j, diff]) => `<div class="plan"><span class="lbl">Looks similar, different answer</span>
    <p class="sub"><span class="mvname" style="font-size:13px">${esc(N[j].line)}</span>: there the move is <b>${lmNo(moveNo(j), N[j].s)}</b>.</p>
    <p class="text">${esc(diff)}</p><div class="controls"><button class="btn" data-twin="${j}">Practice the twin</button></div></div>`).join("");
}
function wireTwins() {
  $("card").querySelectorAll("[data-twin]").forEach(b => b.onclick = () => practiceNode(+b.dataset.twin));
}
function sanLine(sans) { return sans.map((x, i) => (i % 2 ? "" : (i / 2 + 1) + ".") + x).join(" "); }
function whatIfMove(uci) {
  const w = getWM().find(x => x[0] === uci);
  if (!w) return;
  const root = wiPar === "root", p = root ? null : N[wiPar], no = root ? 1 : moveNo(wiPar) + (ME === "b" ? 1 : 0);
  hist = hist.slice(0, frames[fi].h); frames = frames.slice(0, fi + 1);   // branch off here
  clearTimeout(whiteTimer);
  if (w[2] >= 0) {
    const t = w[2], li = nodeLesson[t];
    let switched = "";
    if (lesson && lesson.phase !== "walk") {
      if (lessonSets[lesson.li].has(t)) scope = lessonSets[lesson.li];
      else if (li !== undefined) {
        lesson = { li, phase: "test", got: new Set(), misses: [] }; scope = lessonSets[li];
        switched = ` It transposes into the lesson <b>${esc(L[li].title)}</b>, so you're now practising that one.`;
        refreshBar();
      } else scope = null;
    } else scope = null;
    hist.push({ san: w[1], side: OPPC, no });
    cur = t; pos = parseFen(N[t].fen); lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
    $("idea").innerHTML = `<span class="who">You chose <b>${oppLbl(no, w[1])}</b></span><span>That's in your repertoire${li !== undefined ? ` (lesson: ${esc(L[li].title)})` : ""}.${switched || " Carry on from here."}</span>`;
    setCard("", `<p class="sub">Find the move to learn after ${oppLbl(no, w[1])}.</p>`);
    beginBlack();
  } else {
    const line = `[${DATA.name}] ` + sanLine(root ? [w[1]] : [...p.pre, p.s, w[1]]);
    S.req = S.req || [];
    if (!S.req.some(r => r.line === line)) { const r = { line, t: Date.now() }; S.req.push(r); pushReq(r); }
    save();
    pos = applyMove(pos, uci); lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
    hist.push({ san: w[1], side: OPPC, no }); phase = "done";
    $("idea").innerHTML = `<span class="who">You chose <b>${oppLbl(no, w[1])}</b></span><span>Not in your repertoire yet.</span>`;
    setState("Not covered yet", "alt");
    setCard("alt", `<div class="head"><span class="tag alt">Saved</span><span class="mvname">${oppLbl(no, w[1])}</span></div>
      <p class="text">This line isn't in your repertoire yet, so there's no move to learn here. It's saved under <b>Lines to investigate</b> in your notebook.</p>
      <p class="sub">Next time you're in Claude Code, just ask Claude to add the lines you requested: it reads this list itself.</p>
      <div class="controls"><button class="btn primary" id="bStartOver">↺ Start over</button><button class="btn" id="bBack">← Take back</button>
        ${mode === "free" ? `<button class="btn" id="bReplayHere">Replay this line</button>` : ""}</div>`);
    pushFrame("view", { phase: "done" });
    wireCard();
    renderMoves(); draw(); refreshPanels();
  }
  syncControls();
}
// what the page knows about the position on the board
function posNode() {
  if (phase === "black" || phase === "fail") return { n: cur, black: true };
  if (phase === "whatif" && wiPar !== null && wiPar !== "root") return { n: wiPar, black: false };
  if (cur !== null) return { n: cur, black: false };
  return null;
}
function heading(i) {   // follow the most common continuation to the end of the line
  let x = i;
  for (let k = 0; k < 12 && N[x].next.length; k++) x = N[x].next.reduce((a, b) => (b[2] > a[2] ? b : a))[4];
  return x;
}
function plan() {
  const pn = posNode(); if (!pn) return;
  const n = N[pn.n], end = N[heading(pn.n)], li = nodeLesson[pn.n];
  if (pn.black && phase === "black") hintShown = true;
  const stId = pn.black ? n.stb : n.st, stIdx = pn.black ? n.sbi : n.sai;
  const st = stId ? DATA.structs[stId] : null;
  const white = $("idea").querySelector("span:not(.who)")?.textContent || "";
  const parts = [];
  if (white) parts.push(`<div class="plan"><span class="lbl">What ${OPP} is doing</span><p class="text">${esc(white)}</p></div>`);
  if (st) parts.push(`<div class="plan"><span class="lbl">Your structure: ${esc(st[0])}</span><ul style="margin:0;padding-left:18px">${stIdx.map(k => `<li>${esc(st[2][k])}</li>`).join("")}</ul></div>`);
  if (end && end.plan && end !== n) parts.push(`<div class="plan"><span class="lbl">Where the main line is heading</span><p class="text">${esc(end.plan)}</p></div>`);
  else if (n.plan) parts.push(`<div class="plan"><span class="lbl">Your plan</span><p class="text">${esc(n.plan)}</p></div>`);
  if (li !== undefined) parts.push(`<div class="plan"><span class="lbl">The big picture (${esc(L[li].title)})</span><p class="text">${esc(L[li].plan)}</p></div>`);
  setCard("", `<div class="head"><span class="tag" style="background:var(--alt)">Plan here</span></div>${parts.join("") || `<p class="sub">No notes for this position yet.</p>`}
    ${pn.black && phase === "black" ? `<p class="sub">You looked at the plan, so this answer won't count as solid.</p>` : ""}
    <div class="controls" id="askRow" hidden><button class="btn primary" id="bAsk">Ask Claude about this position</button></div><div id="askOut" class="text" style="white-space:pre-wrap"></div>`);
  if (sampleFn) { $("askRow").hidden = false; $("bAsk").onclick = () => askClaude(pn); }
  wireCard();
}
let sampleFn = null;
(async () => { try { if (window.claude?.use) sampleFn = await window.claude.use("sample"); } catch (e) {} })();
function pieceList(side) {
  const names = { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "" };
  const out = [];
  for (const [sq, p] of Object.entries(pos)) if ((p === p.toUpperCase()) === (side === "w")) out.push(names[p.toLowerCase()] + sq);
  const order = "KQRBN";
  return out.sort((a, b) => (order.indexOf(a[0]) + 1 || 9) - (order.indexOf(b[0]) + 1 || 9)).join(", ");
}
async function askClaude(pn) {
  const n = N[pn.n], out = $("askOut"), btn = $("bAsk");
  btn.disabled = true; out.textContent = "Thinking…";
  const sans = hist.slice(0, frames.length ? frames[fi].h : hist.length).map(h => h.san);
  const stId = pn.black ? n.stb : n.st, st = stId ? DATA.structs[stId] : null, stIdx = pn.black ? n.sbi : n.sai;
  const facts = [
    `Moves so far: ${sanLine(sans)}`,
    `Side to move: ${pn.black ? MEN : OPP} (the learner plays ${MEN}).`,
    `White pieces: ${pieceList("w")}`, `Black pieces: ${pieceList("b")}`,
  ];
  if (pn.black) {
    const top = n.mv.slice().sort((a, b) => a[2] - b[2]).slice(0, 4).map(m => `${m[1]} (${m[2] === 0 ? "best" : "-" + (m[2] / 100).toFixed(1)})`).join(", ");
    facts.push(`Repertoire move for ${MEN} here: ${n.s}. Reason given: ${n.why}`, `Engine's top moves for ${MEN} (pawns lost vs best): ${top}`);
  } else {
    facts.push(`${MEN}'s last move in the repertoire: ${n.s}. Reason given: ${n.why}`);
    const reps = n.next.map(e => `${e[1]} (${Math.round(e[2])}% at 1800-2000)`).join(", ");
    if (reps) facts.push(`${OPP}'s common replies here: ${reps}`);
  }
  if (st) facts.push(`Pawn structure family: ${st[0]}. Notes: ${stIdx.map(k => st[2][k]).join(" ")}`);
  const prompt = `You are a chess coach helping a 1900-rated club player who plays the ${DATA.name} (${DATA.blurb}) and wants to understand plans, not memorise lines.

Position facts (trust these exactly; they come from the board and Stockfish):
${facts.join("\n")}

Explain, in at most 170 words of plain English, the plan for ${MEN} in this position and the positional considerations to keep in mind: which pawn breaks matter, where the pieces belong, what ${OPP} is aiming for and how to counter it. Rules: only name squares and pieces that match the piece lists above; do not claim a piece is attacked, defended, loose or trapped unless it is certain from the lists; keep any concrete line to at most 3 moves; write "White" or "Black" rather than he/she. If ${MEN} is to move, do not give away the repertoire move directly: describe the idea instead. No headings or bullet symbols; two or three short paragraphs.`;
  try {
    const r = await sampleFn(prompt, { onText: ({ text }) => { out.textContent = text; } });
    out.textContent = r.text;
  } catch (e) {
    out.textContent = e && e.text ? e.text : (e && e.code === "not_granted" ? "Asking Claude isn't allowed on this page for you." : e && e.code === "rate_limited" ? "Too many questions right now; try again in a minute." : "Claude couldn't answer right now.");
  }
  btn.disabled = false;
}
function hint() {
  if (phase !== "black" || (lesson && lesson.phase === "walk")) return;
  timedStop();
  hintShown = true;
  const n = N[cur];
  setCard("", `<div class="head"><span class="tag" style="background:var(--hint)">Hint</span>${pchip(n.p)}</div><p class="sub">${esc(P[n.p] ? P[n.p][1] : "")}</p><p class="sub">A hinted answer doesn't count as solid.</p>`);
}
$("bNext").onclick = next;
$("bHint").onclick = hint;
$("bReplay").onclick = () => startFromRoot(true);
$("bLeave").onclick = showLessonList;
$("bPlan").onclick = plan;
document.querySelectorAll(".tab").forEach(t => t.onclick = () => setMode(t.dataset.mode));
document.addEventListener("keydown", ev => {
  if (ev.target.closest("input, textarea")) return;
  const k = ev.key.toLowerCase();
  if (window.SECTION !== "opening" || mode === "ideas" || mode === "mine" || mode === "games") return;
  if (ev.key === "ArrowRight") { ev.preventDefault(); forward(); }
  else if (ev.key === "ArrowLeft") { ev.preventDefault(); back(); }
  else if ((ev.key === "ArrowDown" || k === "n") && !$("bNext").hidden) { ev.preventDefault(); next(); }
  else if (k === "h") hint();
  else if (k === "p") plan();
});

/* ---------- input ---------- */
// the square under a pointer event on a board element (null outside the board); shared by every board
function squareAt(ev, el, o) {
  const r = el.getBoundingClientRect();
  const col = Math.floor((ev.clientX - r.left) / r.width * 8), row = Math.floor((ev.clientY - r.top) / r.height * 8);
  return col < 0 || col > 7 || row < 0 || row > 7 ? null : sqOf(col, row, o);
}
function sqAt(ev) { return squareAt(ev, $("board"), orient); }
function tryMove(from, to) {
  if (!from || !to || from === to) return false;
  const cand = legalList().filter(u => u.slice(0, 4) === from + to);
  if (!cand.length) return false;
  const u = cand.find(x => x.length === 4 || x[4] === "q") || cand[0];
  sel = null;
  if (phase === "whatif") whatIfMove(u); else if (phase === "play") poMove(u); else playerMove(u);
  return true;
}
$("board").addEventListener("pointerdown", ev => {
  if (phase !== "black" && phase !== "whatif" && phase !== "play") return;
  const sq = sqAt(ev); if (!sq) return;
  const p = pos[sq], mine = x => phase === "whatif" ? !isMine(x) : isMine(x);
  if (sel && sel !== sq && legalList().some(u => u.startsWith(sel + sq))) { tryMove(sel, sq); return; }
  if (p && mine(p)) { sel = sq; drag = { from: sq, moved: false, x: ev.clientX, y: ev.clientY }; $("board").setPointerCapture(ev.pointerId); draw(); }
  else { sel = null; draw(); }
});
$("board").addEventListener("pointermove", ev => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 6) return;
  const r = $("board").getBoundingClientRect();
  if (!drag.moved) { drag.moved = true; draw(); }
  let g = document.querySelector(".ghost");
  if (!g) { const pc = pos[drag.from]; g = document.createElement("span"); g.className = "pc ghost " + (pc === pc.toUpperCase() ? "w" : "b") + pc.toUpperCase(); $("board").appendChild(g); }
  g.style.left = (ev.clientX - r.left) + "px"; g.style.top = (ev.clientY - r.top) + "px";
});
$("board").addEventListener("pointerup", ev => {
  if (!drag) return;
  const d = drag; drag = null; document.querySelector(".ghost")?.remove();
  if (d.moved && !tryMove(d.from, sqAt(ev))) draw();
});
$("board").addEventListener("pointercancel", () => { drag = null; document.querySelector(".ghost")?.remove(); draw(); });

/* ---------- panels ---------- */
function renderFilters() {
  const groups = [["all", "All"], ["e2e4", "1.e4"], ["d2d4", "1.d4"], ["c2c4", "1.c4"], ["g1f3", "1.Nf3"], ["other", "Other"]];
  const share = k => DATA.roots.filter(e => k === "all" || (k === "other" ? !FIRST[e[0]] : e[0] === k)).reduce((s, e) => s + e[2], 0);
  $("filters").innerHTML = `<span class="lbl">White opens with</span>` + groups.map(([k, l]) =>
    `<button class="chip" data-k="${k}" aria-pressed="${filter === k}">${l}${k === "all" ? "" : `<span class="pct">${Math.round(share(k))}%</span>`}</button>`).join("");
  $("filters").querySelectorAll(".chip").forEach(b => b.onclick = () => {
    filter = b.dataset.k; try { localStorage.setItem(STORE + ":filter", filter); } catch (e) {}
    renderFilters(); lastPath = null; startFromRoot();
  });
}
function renderNotebook() {
  const q = reviewQueue();
  $("revCount").hidden = !q.length; $("revCount").textContent = q.length;
  const byP = {};
  N.forEach((n, i) => { const r = recOf(i); if (r?.last === "bad") (byP[n.p] = byP[n.p] || []).push(i); });
  const ideas = Object.entries(byP).sort((a, b) => b[1].length - a[1].length);
  $("nbIdeas").innerHTML = ideas.length ? ideas.map(([p, ids]) => `<div class="idea-c"><div class="t"><h3>${esc(P[p]?.[0] || p)}</h3><span class="n">${ids.length} to fix</span></div><p>${esc(P[p]?.[1] || "")}</p></div>`).join("")
    : `<div class="empty">Nothing yet. The principles behind the moves you miss will collect here.</div>`;
  $("misses").innerHTML = q.length ? q.slice(0, 40).map(i => {
    const n = N[i], r = recOf(i), no = moveNo(i);
    const tried = Object.assign({}, ...(MYG[i] ? MYG[i].played.map(m => ({ [m.played]: m.n })) : []), (r && r.wrong) || {});   // here and in your games
    const w = Object.entries(tried).sort((a, b) => b[1] - a[1]).map(([s, c]) => `${ME === "b" ? "…" : ""}${esc(s)}${c > 1 ? ` (${c}×)` : ""}`).join(", ");
    return `<div class="miss"><span class="ln">${esc(n.line)}</span>
      <span class="what">${w ? `<span>You played <span class="bad">${w}</span></span>` : ""}<span>Learn <span class="good">${lmNo(no, n.s)}</span></span>${pchip(n.p)}</span>
      <button class="btn" data-i="${i}">Practice</button></div>`;
  }).join("") : `<div class="empty">No missed positions. When you miss one, it shows up here with what you played and the move to learn.</div>`;
  $("misses").querySelectorAll("[data-i]").forEach(b => b.onclick = () => practiceNode(+b.dataset.i));
}
function renderReqs() {
  const rq = S.req || [];
  $("reqs").innerHTML = rq.length ? rq.map((r, i) => `<div class="miss"><span class="ln">${esc(r.line)}</span><span class="what">waiting for analysis</span><button class="btn" data-rm="${i}">Remove</button></div>`).join("") +
    `<div class="controls"><button class="btn" id="bCopyReq">Copy the list</button><span class="tiny" id="copyMsg"></span></div>`
    : `<div class="empty">Nothing yet. Step back with ← to ${OPP}'s turn and play a ${OPP} move; if it isn't covered, it lands here.</div>`;
  $("reqs").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    const [r] = S.req.splice(+b.dataset.rm, 1); save(); renderReqs();
    if (sharedDb && r) sharedDb.doc("requests/" + reqId(r.line)).delete().catch(() => {});
  });
  const cb = $("bCopyReq");
  if (cb) cb.onclick = () => {
    const txt = "Please analyse these lines for my chess gym and add them to the repertoire (each line is tagged with its opening):\n" + rq.map(r => "- " + r.line).join("\n");
    navigator.clipboard.writeText(txt).then(() => { $("copyMsg").textContent = "Copied."; })
      .catch(() => { $("copyMsg").textContent = "Couldn't copy automatically; select the lines above instead."; });
  };
}
function renderPrinciples() {
  const by = {};
  N.forEach((n, i) => (by[n.p] = by[n.p] || []).push(i));
  $("plist").innerHTML = Object.entries(P).map(([k, [t, rule]]) => {
    const ids = by[k] || [];
    const ok = ids.reduce((s, x) => s + (recOf(x)?.ok || 0), 0), bad = ids.reduce((s, x) => s + (recOf(x)?.bad || 0), 0);
    return { t, rule, n: ids.length, ok, bad, ex: ids.length ? `${N[ids[0]].line} ${N[ids[0]].s}` : "" };
  }).sort((a, b) => b.n - a.n).map(r => `<div class="pr"><div class="t"><h3>${esc(r.t)}</h3><span class="rec">${r.ok} ✓ · <span class="${r.bad ? "bad" : ""}">${r.bad} ✗</span></span></div>
    <p>${esc(r.rule)}</p><span class="ex">${r.n} position${r.n === 1 ? "" : "s"} · e.g. ${esc(r.ex)}</span></div>`).join("");
}
function miniBoard(fen, uci) {
  const pos = parseFen(fen); let html = "";
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const sq = sqOf(col, row), f = FILES.indexOf(sq[0]), r = +sq[1], p = pos[sq];
    html += `<div class="sq ${(f + r) % 2 === 1 ? "l" : "d"}">${p ? `<span class="pc ${p === p.toUpperCase() ? "w" : "b"}${p.toUpperCase()}"></span>` : ""}</div>`;
  }
  return `<div class="board mini" role="img" aria-label="Example position"><div class="squares">${html}</div><svg class="arrows" viewBox="0 0 8 8" preserveAspectRatio="none">${arrowPath(uci, "green")}</svg></div>`;
}
function renderIdeas() {
  const groups = [...new Set(DATA.ideas.map(x => x.group))];
  $("ideas2").innerHTML = groups.map(g => `<div class="igroup"><h2>${esc(g)}</h2>` + DATA.ideas.filter(x => x.group === g).map(it => {
    const first = it.ex[0];
    return `<div class="icard"><div class="txt"><h3>${esc(it.title)}</h3><p class="sig"><b>When</b>${esc(it.signal)}</p>
      ${it.body.map(p => `<p>${esc(p)}</p>`).join("")}
      <div class="exs">${it.ex.map(i => `<div class="ex"><span class="ln">${esc(N[i].line)} <b>${lmNo(moveNo(i), N[i].s)}</b></span><button class="btn" data-practice="${i}">Practice</button></div>`).join("")}</div></div>
      ${first !== undefined ? `<div>${miniBoard(N[first].fen, N[first].m)}<p class="minicap">${lmNo(moveNo(first), N[first].s)} in the first example</p></div>` : ""}</div>`;
  }).join("") + `</div>`).join("");
  const order = N.map((n, i) => i).sort((a, b) => moveNo(a) - moveNo(b));
  $("ideas2").innerHTML += `<div class="igroup"><h2>Pawn structures you'll reach</h2><p class="lede">When a line turns into one of these, the strip under the board names it. Borrow the ideas of the opening it comes from.</p>` +
    Object.entries(DATA.structs).map(([id, [name, desc, ideas]]) => {
      const ex = order.filter(i => N[i].stb === id).slice(0, 3);
      const first = ex[0];
      return `<div class="icard"><div class="txt"><h3>${esc(name)}</h3><p class="sig"><b>When</b>${esc(desc)}</p>
        <ul style="margin:0;padding-left:18px;display:grid;gap:4px">${ideas.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
        <div class="exs">${ex.map(i => `<div class="ex"><span class="ln">${esc(N[i].line)} <b>${lmNo(moveNo(i), N[i].s)}</b></span><button class="btn" data-practice="${i}">Practice</button></div>`).join("")}</div></div>
        ${first !== undefined ? `<div>${miniBoard(N[first].fen, N[first].m)}<p class="minicap">${lmNo(moveNo(first), N[first].s)} in the first example</p></div>` : ""}</div>`;
    }).join("") + `</div>`;
  $("ideas2").querySelectorAll("[data-practice]").forEach(b => b.onclick = () => practiceNode(+b.dataset.practice));
}
function practiceNode(i) {
  mode = "review"; markTabs();
  $("filters").hidden = true; $("ideasView").hidden = true; $("oTrainer").hidden = false;
  startReview(i);
  $("board").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
}
function markTabs() { ["lessons", "review", "free", "ideas", "mine", "games"].forEach(x => $("t" + x[0].toUpperCase() + x.slice(1)).setAttribute("aria-selected", x === mode)); }
function refreshPanels() { renderNotebook(); renderReqs(); renderPrinciples(); tally(); }
let resetArmed = false;
// erases only this opening's positions and lessons: puzzle players, the kids' progress and the other opening stay
$("bReset").onclick = () => {
  if (!resetArmed) { resetArmed = true; $("bReset").textContent = `Click again to erase your ${DATA.name} progress`; return; }
  N.forEach(n => { delete S.n[n.k]; }); L.forEach(l => { delete S.les[l.id]; });
  save(); resetArmed = false; streak = 0;
  $("bReset").textContent = `${DATA.name} progress erased`; refreshPanels(); setMode(mode);
};
new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

function openOpening(d, sub) {
  useOpening(d);
  renderFilters(); refreshPanels(); renderIdeas();
  $("struct").hidden = true;
  setMode(["lessons", "review", "free", "ideas"].includes(sub) ? sub : "lessons");
}


/* ================= puzzles ================= */
// data: GYM.puzzles = [[lichessId, fen, "uci uci …", rating, "theme theme"], …] sorted by rating.
// The first move in each solution is the opponent's; the solver plays every other move after it.
const PZ_BANDS = [[200, 400], [400, 600], [600, 800], [800, 1000], [1000, 1200], [1200, 1400], [1400, 1600], [1600, 1800],
                  [1800, 2000], [2000, 2200], [2200, 2400], [2400, 2600]];
const THEME = {
  mateIn1: "Mate in 1", mateIn2: "Mate in 2", mateIn3: "Mate in 3", mateIn4: "Mate in 4", mate: "Checkmate",
  backRankMate: "Back-rank mate", smotheredMate: "Smothered mate", anastasiaMate: "Anastasia's mate", arabianMate: "Arabian mate",
  bodenMate: "Boden's mate", doubleBishopMate: "Two-bishop mate", dovetailMate: "Dovetail mate", hookMate: "Hook mate",
  fork: "Fork", pin: "Pin", skewer: "Skewer", hangingPiece: "Hanging piece", trappedPiece: "Trapped piece",
  discoveredAttack: "Discovered attack", doubleCheck: "Double check", deflection: "Deflection", attraction: "Attraction",
  clearance: "Clearance", interference: "Interference", sacrifice: "Sacrifice", promotion: "Promotion", underPromotion: "Under-promotion",
  advancedPawn: "Advanced pawn", exposedKing: "Exposed king", kingsideAttack: "Kingside attack", quietMove: "Quiet move",
  defensiveMove: "Defensive move", giveCheck: "Give check", saveQueen: "Save the queen", savePiece: "Save your piece", safeTake: "Is it safe to take?", safeTakeHard: "Is it safe to take? (harder)", stopMate: "Stop the mate", xRayAttack: "X-ray", zugzwang: "Zugzwang", capturingDefender: "Remove the defender",
  intermezzo: "In-between move", enPassant: "En passant", castling: "Castling",
  endgame: "Endgame", rookEndgame: "Rook endgame", pawnEndgame: "Pawn endgame", queenEndgame: "Queen endgame",
  opening: "Opening", middlegame: "Middlegame", crushing: "Winning", advantage: "Advantage", equality: "Saving the game",
};
let pzCur = null, pzGame = null, pzIdx = 0, pzOrient = "w", pzSel = null, pzLast = [], pzArrows = [], pzState = "idle";
let pzStage = null, pzReplay = false;     // pzReplay: the stage was already finished when opened from the map
// the kids' corner 🧩 tab: rating-matched puzzles, pictures only, for the young player (asked once per opening of the view)
let pzKidNext = false, pzKidRated = false;
function pzKid() { return !!pzPlayers().kid || pzKidRated; }
let pzHinted = false, pzFailed = false, pzScored = false, pzDrag = null, pzTimer = null, pzMarks = {};

/* ---- "why is it mate?": which pieces take away each square around the mated king ---- */
const PNAME = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
function colorOf(p) { return p === p.toUpperCase() ? "w" : "b"; }
function attacksSq(pos, from, to) {
  const p = pos[from], t = p.toLowerCase();
  const fx = FILES.indexOf(from[0]), fy = +from[1], tx = FILES.indexOf(to[0]), ty = +to[1], dx = tx - fx, dy = ty - fy;
  if (!dx && !dy) return false;
  if (t === "p") return Math.abs(dx) === 1 && dy === (colorOf(p) === "w" ? 1 : -1);
  if (t === "n") return (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
  if (t === "k") return Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
  const straight = !dx || !dy, diag = Math.abs(dx) === Math.abs(dy);
  if ((t === "r" && !straight) || (t === "b" && !diag) || (t === "q" && !straight && !diag)) return false;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  for (let x = fx + sx, y = fy + sy; x !== tx || y !== ty; x += sx, y += sy) if (pos[FILES[x] + y]) return false;
  return true;
}
function attackersOf(pos, sq, color) { return Object.keys(pos).filter(f => colorOf(pos[f]) === color && attacksSq(pos, f, sq)); }
// after a wrong answer in a mate puzzle: where the king gets out, and which pieces can take or block
function escapes() {
  const ms = pzGame.moves({ verbose: true }), check = pzGame.in_check();
  const seen = new Set(), kings = ms.filter(m => m.piece === "k" && !seen.has(m.to) && seen.add(m.to));
  const saves = check ? ms.filter(m => m.piece !== "k").slice(0, 3) : [];
  const marks = {}, arrows = [];
  kings.forEach(m => { marks[m.to] = "esc:" + arrows.length; arrows.push([m.from + m.to, "escape"]); });
  saves.forEach(m => arrows.push([m.from + m.to, "green"]));
  const them = pzGame.turn() === "w" ? "White" : "Black", to = kings.map(m => m.to).join(", ");
  let text;
  if (check) text = `Not checkmate: ${to ? `the ${them.toLowerCase()} king escapes to ${to}` : "the king can't move, but"}${saves.length ? `${to ? ", or" : ""} the ${PNAME[saves[0].piece]} on ${saves[0].from} ${saves[0].captured ? "takes" : "blocks on"} ${saves[0].to}` : ""}.`;
  else text = `That isn't even check${to ? `: the ${them.toLowerCase()} king can simply walk to ${to}` : ""}.`;
  return { marks, arrows, text };
}
function whyMate() {
  const pos = parseFen(pzGame.fen()), loser = pzGame.turn(), win = loser === "w" ? "b" : "w";
  const ksq = Object.keys(pos).find(q => pos[q] === (loser === "w" ? "K" : "k"));
  const noK = { ...pos }; delete noK[ksq];
  const checkers = attackersOf(pos, ksq, win);
  const marks = { [ksq]: "mk" }, arrows = checkers.map(a => [a + ksq, "red"]), covers = {}, own = [];
  const kx = FILES.indexOf(ksq[0]), ky = +ksq[1];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const x = kx + dx, y = ky + dy;
    if ((!dx && !dy) || x < 0 || x > 7 || y < 1 || y > 8) continue;
    const q = FILES[x] + y;
    if (pos[q] && colorOf(pos[q]) === loser) { own.push(q); marks[q] = "mo"; continue; }
    const at = attackersOf(noK, q, win);
    if (!at.length) continue;
    const a = at.find(z => checkers.includes(z)) || at[0];     // fewer arrows: prefer the checking piece
    (covers[a] = covers[a] || []).push(q); marks[q] = "mx:" + arrows.length;   // same delay as its arrow
    const sameLine = checkers.includes(a) && (() => {      // a checker covering a square on its own line: the × says enough
      const ax = FILES.indexOf(a[0]), ay = +a[1];
      return Math.sign(x - ax) === Math.sign(kx - ax) && Math.sign(y - ay) === Math.sign(ky - ay) &&
             (x - ax) * (ky - ay) === (y - ay) * (kx - ax);
    })();
    if (!sameLine) arrows.push([a + q, "cover"]);
  }
  const side = win === "w" ? "White" : "Black", them = loser === "w" ? "White" : "Black";
  const who = sq => `The ${side === "White" ? "white" : "black"} ${PNAME[pos[sq].toLowerCase()]} on ${sq}`;
  const lines = [];
  for (const c of checkers) lines.push(`${who(c)} gives check${covers[c] ? ` and covers ${covers[c].join(", ")}` : ""}.`);
  for (const [a, sqs] of Object.entries(covers)) if (!checkers.includes(a)) lines.push(`${who(a)} covers ${sqs.join(", ")}.`);
  if (own.length) lines.push(`${own.join(", ")}: ${own.length === 1 ? "that square is" : "those squares are"} blocked by ${them}'s own pieces.`);
  lines.push(`The king has nowhere to go, and nothing can take the checking piece or block the check, so it's checkmate.`);
  return { marks, arrows, lines };
}

const START_RATING = { me: 2147, son: 200 };      // by player id; other players start where they chose
// Elo step after one puzzle (score 1 = solved): a big K for the first puzzles so the rating finds its level fast
function eloStep(r, n, pr, score) {
  const K = n < 20 ? 40 : n < 60 ? 24 : 16, exp = 1 / (1 + Math.pow(10, (pr - r) / 400));
  return Math.max(100, r + Math.round(K * (score - exp)));
}
function pzPlayers() {
  S.players = S.players || {};
  if (!Object.keys(S.players).length) {
    S.players.me = { name: "You", rating: 2147, n: 0, done: {}, mode: "adaptive", level: 8, goal: false, hist: [] };
    S.player = "me"; S.pzv = 4;
    S.fresh = true;          // defaults on a new device: the account's copy decides who's playing (see merge)
  }
  if ((S.pzv || 0) < 2) {    // v2 added the 200-400 band in front: shift stored levels, start the Son profile at 200
    for (const p of Object.values(S.players)) if (typeof p.level === "number") p.level += 1;
    if (S.players.son) { S.players.son.rating = 200; S.players.son.level = 0; S.players.son.n = 0; }
    S.pzv = 2;
  }
  if ((S.pzv || 0) < 3) {  // v3: your profile back on rating-matched puzzles; pictures-only mode for the young player
    if (S.players.me) S.players.me.mode = "adaptive";
    if (S.players.son) S.players.son.kid = true;
    S.pzv = 3;
  }
  if ((S.pzv || 0) < 4) {  // v4: repair the v2/v3 loop that kept resetting ratings; rebuild each rating from its history
    const start = START_RATING;
    for (const [id, p] of Object.entries(S.players)) {
      p.level = Math.min(Math.max(0, p.level | 0), PZ_BANDS.length - 1);
      if (id === "me" && p.level < 7) p.level = 8;
      if (!(id in start)) continue;
      let r = start[id], n = 0;
      for (const x of p.hist || []) { r = eloStep(r, n, x.pr, x.r); n++; }
      p.rating = r; p.n = n;
    }
    S.pzv = 4;
  }
  if (!S.sonSeeded) {   // a ready-made profile for a beginner: easiest band, goal shown
    S.sonSeeded = true;
    if (!Object.values(S.players).some(p => p.name === "Son"))
      S.players.son = { name: "Son", rating: 200, n: 0, done: {}, mode: "fixed", level: 0, goal: true, kid: true, hist: [] };
  }
  if (!S.players[S.player]) S.player = Object.keys(S.players)[0];
  return S.players[S.player];
}
function pzRenderBar() {
  const pl = pzPlayers();
  $("pzPlayer").innerHTML = Object.entries(S.players).map(([id, p]) =>
    `<button type="button" data-pl="${id}" aria-pressed="${id === S.player}">${esc(p.name)} <small>${Math.round(p.rating)}</small></button>`).join("");
  $("pzPlayer").querySelectorAll("[data-pl]").forEach(b => b.onclick = () => { S.player = b.dataset.pl; save(); pzRenderBar(); pzNext(); });
  const mode = pzKidRated ? "adaptive" : pl.mode;      // the 🧩 tab always matches the rating
  document.querySelectorAll("[data-pm]").forEach(b => b.setAttribute("aria-pressed", b.dataset.pm === mode));
  $("pzLevel").hidden = mode !== "fixed";
  $("pzMine").hidden = !myPuzzles().length || !!pl.kid;
  $("pzLevel").innerHTML = PZ_BANDS.map(([lo, hi], i) => `<option value="${i}"${i === pl.level ? " selected" : ""}>${lo}–${hi}</option>`).join("");
  $("pzGoal").checked = !!pl.goal;
  $("pzKid").checked = !!pl.kid;
  $("puzzleView").classList.toggle("kid", pzKid());
  $("pzSound").textContent = soundOn() ? "🔊" : "🔇";
  $("pzStars").hidden = !pzKid(); $("pzStars").innerHTML = `⭐ <b>${pl.stars || 0}</b>`;
  renderStageBar();
  $("pzName").textContent = pl.name + (mode === "mine" ? ` · ${myPuzzles().length} puzzles from your own games (no rating change)` : mode === "fixed" ? ` · fixed level ${PZ_BANDS[pl.level][0]}–${PZ_BANDS[pl.level][1]}, not matched to the rating` : " · puzzles matched to this rating");
  $("pzRating").textContent = Math.round(pl.rating);
  const h = (pl.hist || []).slice(-30);
  $("pzHist").innerHTML = h.length ? `<span class="lbl">Last ${h.length}</span>` + h.map(x => `<i class="${x.r ? "ok" : "bad"}" title="${x.pr}${x.r ? " solved" : " missed"}"></i>`).join("")
    : `<span class="lbl">Your results will show here.</span>`;
  const solved = Object.values(pl.done || {}).filter(v => v === 1).length, tried = Object.keys(pl.done || {}).length;
  $("pzTally").innerHTML = `<span>solved <b>${solved}</b></span><span>tried <b>${tried}</b></span>`;
}
/* ---- mistakes come back: a missed puzzle is due a day later, until it's solved cleanly in two later sessions ---- */
// pl.again = {puzzleId: {due (ms), n (clean re-solves)}}; n = 2 is kept as "done" so a merge with an older copy can't revive it
const AGAIN_WAIT = [864e5, 3 * 864e5], AGAIN_KEEP = 90 * 864e5;   // wait after a miss / after the first clean re-solve
let againRows = null;
function againNote(pl, id, clean, now = Date.now()) {
  const a = pl.again = pl.again || {}, x = a[id];
  for (const [k, y] of Object.entries(a)) if (y.n >= 2 && y.due < now - AGAIN_KEEP) delete a[k];
  if (!clean) a[id] = { due: now + AGAIN_WAIT[0], n: 0 };
  else if (x && x.n < 2 && x.due <= now) a[id] = x.n ? { due: now, n: 2 } : { due: now + AGAIN_WAIT[1], n: 1 };   // not due: same session, doesn't count
}
function againDue(pl, f, now = Date.now()) {
  againRows = againRows || Object.fromEntries([...GYM.puzzles, ...myPuzzles()].map(p => [p[0], p]));
  return Object.entries(pl.again || {}).filter(([id, x]) => x.n < 2 && x.due <= now && againRows[id] && (!f || f(againRows[id]))).map(([id]) => againRows[id]);
}
// about 1 pick in 3 is a due puzzle while there are any
function againPick(pl, f, r = Math.random()) {
  const d = againDue(pl, f);
  return d.length && r < 1 / 3 ? d[Math.floor(Math.random() * d.length)] : null;
}
/* ---- puzzles from your own games (data/mygames.js, made by mygames.py): their own mode, no rating change ---- */
function myPuzzles() { return (window.GYM && GYM.mygames && GYM.mygames.puzzles) || []; }
function isMyPuzzle(p) { return p[0].startsWith("my-"); }
function myPuzzleSrc(p) { return (GYM.mygames.puzzle_src || {})[p[0]] || {}; }
function myPick(pl) {
  const pool = myPuzzles(), done = pl.done || {};
  const again = againPick(pl, isMyPuzzle); if (again) return again;
  const fresh = pool.filter(p => !(p[0] in done)), missed = pool.filter(p => done[p[0]] === 0);
  const from = fresh.length ? fresh : missed.length ? missed : pool;
  return from[Math.floor(Math.random() * Math.min(from.length, fresh.length ? 40 : from.length))];   // newest games first
}
function pzPick() {
  if (pzStage) return stagePick(pzPlayers());
  const pl = pzPlayers(), P0 = GYM.puzzles, done = pl.done || {};
  if (pl.mode === "mine" && !pzKidRated && myPuzzles().length) return myPick(pl);
  const again = againPick(pl, p => !isMyPuzzle(p)); if (again) return again;   // your games' puzzles come back in their own mode
  let lo, hi;
  if (pl.mode === "fixed" && !pzKidRated) [lo, hi] = PZ_BANDS[pl.level];
  else { lo = pl.rating - 60; hi = pl.rating + 60; }
  // widen the window until a few unseen puzzles are in it (a small set, e.g. the iPad site's, runs out near the rating)
  for (let widen = 0; widen < 12; widen++) {
    const c = P0.filter(p => p[3] >= lo - widen * 50 && p[3] < hi + widen * 50 && !(p[0] in done));
    if (c.length >= 5 || (c.length && widen === 11)) return c[Math.floor(Math.random() * c.length)];
  }
  const c = P0.filter(p => p[3] >= lo && p[3] < hi);   // everything seen: allow repeats
  return c.length ? c[Math.floor(Math.random() * c.length)] : P0[Math.floor(Math.random() * P0.length)];
}
function pzDraw() {
  const tg = pzSel && pzState === "solve" ? pzGame.moves({ square: pzSel, verbose: true }).map(m => m.to) : [];
  renderBoard(parseFen(pzGame.fen()), { el: $("pboard"), o: pzOrient, hl: pzLast, sel: pzSel, tgts: tg, arrows: pzArrows, marks: pzMarks });
  $("pboard").classList.toggle("mine", pzState === "solve");
}
function pzGoalText(p) {
  const t = p[4].split(" "), n = t.find(x => /^mateIn\d$/.test(x));
  if (isMyPuzzle(p)) {
    const s = myPuzzleSrc(p), when = s.date ? ` (${s.speed || "game"}, ${s.date}${s.opp ? `, vs ${s.opp}` : ""})` : "";
    const task = n ? `Find mate in ${n.slice(-1)}.` : "Find the best move.";
    return t.includes("blunder") ? `In your game${when} you played ${s.played || "something else"} here. ${task}`
      : `Your opponent had just blundered in your game${when}, and you played ${s.played || "something else"}. ${task}`;
  }
  if (t.some(x => /^safeTake/.test(x))) return "Is the capture on the blue arrow safe? 👍 if it wins something, 👎 if your piece would be taken back for more.";
  if (t.includes("stopMate")) return "Your opponent threatens checkmate in one (red arrow). Stop it: every move that stops the mate counts.";
  if (n) return `Find mate in ${n.slice(-1)}.`;
  if (t.includes("hangingPiece") && p[5]) return "Take the piece you can win for free.";
  if (t.includes("giveCheck")) return "Give check: attack the king with a piece that stays safe.";
  if (t.includes("saveQueen")) return "Your queen is attacked: get it to safety.";
  if (t.includes("savePiece")) return "One of your pieces is attacked: keep it safe.";
  if (t.includes("promotion") && p[5]) return "Push your pawn to the end and make a new queen.";
  if (t.includes("equality")) return "Find the move that saves the game.";
  if (t.includes("pin")) return "Use a pin: a piece that can't move out of the way without exposing its king.";
  if (t.includes("skewer")) return "Skewer: attack a big piece; when it moves away, take what stood behind it.";
  if (t.includes("discoveredAttack")) return "Discovered attack: move one piece out of the way so the piece behind it attacks.";
  return "Find the best move: it wins material or more.";
}
// the goal as a picture, from the solver's side (targets in the opponent's colour, own pieces in the solver's):
// mate (king in a target, with the number of moves from 2 on), check, save (shield), promote (pawn → queen), fork (🍴),
// pin (📌), skewer (🍢), discovered attack (two arrows from one line), take a piece (+), win something (⚔),
// is it safe to take (⚖ + the piece), stop the mate (own king, shield and #)
function pzGoalHtml() {
  const t = pzCur[4].split(" "), me = pzGame.turn(), them = me === "w" ? "b" : "w";
  const want = pzCur[2].split(" ")[pzIdx] || "", victim = want ? pzGame.get(want.slice(2, 4)) : null;
  if (t.some(x => /^safeTake/.test(x))) {
    const tp = pzCur[7] ? pzGame.get(pzCur[7]) : null;
    return { kind: "safe", html: `<span class="goal scale" title="Is it safe to take?">⚖️${tp ? `<span class="pc ${tp.color}${tp.type.toUpperCase()}"></span>` : ""}</span>` };
  }
  if (t.includes("stopMate")) return { kind: "guard", html: `<span class="goal guard" title="Stop the mate"><span class="pc ${me}K"></span></span>` };
  if (t.includes("giveCheck")) return { kind: "check", html: `<span class="goal check" title="Give check"><span class="pc ${them}K"></span></span>` };
  if (t.includes("saveQueen") || t.includes("savePiece")) {
    const tp = pzCur[7] ? pzGame.get(pzCur[7]) : null, kind = tp ? tp.type.toUpperCase() : "Q";
    return { kind: "save", html: `<span class="goal save" title="Keep this piece safe"><span class="pc ${me}${kind}"></span></span>` };
  }
  if (t.some(x => /^mate/.test(x))) {
    const n = (t.find(x => /^mateIn[2-9]$/.test(x)) || "").slice(6);
    return { kind: "mate", html: `<span class="goal mate${n ? " mn" : ""}"${n ? ` data-n="${n}"` : ""} title="Checkmate${n ? " in " + n : ""}"><span class="pc ${them}K"></span></span>` };
  }
  if (t.includes("promotion") && want[4]) return { kind: "promo", html: `<span class="goal promo" title="Make a queen"><span class="pc ${me}P"></span><b>→</b><span class="pc ${me}Q"></span></span>` };
  if (t.includes("fork")) return { kind: "fork", html: `<span class="goal win" title="Fork">🍴</span>` };
  if (t.includes("pin")) return { kind: "pin", html: `<span class="goal win" title="Pin">📌</span>` };
  if (t.includes("skewer")) return { kind: "skewer", html: `<span class="goal win" title="Skewer">🍢</span>` };
  if (t.includes("discoveredAttack")) return { kind: "disc", html: DISC_ICON.replace('class="goal disc"', 'class="goal disc" title="Discovered attack"') };
  if (victim) return { kind: "take", html: `<span class="goal take" title="Win this piece"><span class="pc ${victim.color}${victim.type.toUpperCase()}"></span></span>` };
  return { kind: "win", html: `<span class="goal win" title="Win something">⚔</span>` };
}
// easy mate in 1: before the move, show which squares round the enemy king your other pieces already cover
function preCover() {
  const pos = parseFen(pzGame.fen()), solver = pzGame.turn(), loser = solver === "w" ? "b" : "w";
  const ksq = Object.keys(pos).find(q => pos[q] === (loser === "w" ? "K" : "k"));
  const mover = (pzCur[2].split(" ")[pzIdx] || "").slice(0, 2);
  const noK = { ...pos }; delete noK[ksq];
  const marks = {}, arrows = [], kx = FILES.indexOf(ksq[0]), ky = +ksq[1];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const x = kx + dx, y = ky + dy;
    if ((!dx && !dy) || x < 0 || x > 7 || y < 1 || y > 8) continue;
    const q = FILES[x] + y;
    if (pos[q] && colorOf(pos[q]) === loser) { marks[q] = "mo"; continue; }
    const at = attackersOf(noK, q, solver).filter(a => a !== mover);
    if (at.length) { marks[q] = "mx:" + arrows.length; arrows.push([at[0] + q, "cover"]); }
    else marks[q] = "esc:" + arrows.length;
  }
  return { marks, arrows };
}
// stop the mate: the threat, drawn before the move (red arrow onto the mate square, your king glowing in danger)
function sgThreat() {
  const pos = parseFen(pzGame.fen()), k = Object.keys(pos).find(q => pos[q] === (pzGame.turn() === "w" ? "K" : "k"));
  return { marks: { [k]: "dg" }, arrows: (pzCur[8] || []).map(u => [u, "red"]) };
}
// the opponent's mates in one right now (after a wrong answer in "stop the mate")
function sgMates() {
  return pzGame.moves({ verbose: true }).filter(m => { pzGame.move(m); const x = pzGame.in_checkmate(); pzGame.undo(); return x; });
}
function pzShowGoal() {
  const pl = pzPlayers(), el = $("pzGoalBadge");
  if (/stopMate/.test(pzCur[4]) && pzIdx === 0) { const th = sgThreat(); pzMarks = th.marks; pzArrows = th.arrows; }   // the task needs it: always shown
  if (!pl.goal) { el.hidden = true; return; }
  const g = pzGoalHtml();
  el.innerHTML = g.html; el.hidden = pzKid();          // pictures only: the goal is in the big panel instead
  const t = pzCur[4].split(" ");
  if (t.includes("mateIn1") && (pzCur[5] || pzCur[3] <= 1000)) { const pc = preCover(); pzMarks = pc.marks; pzArrows = pc.arrows; }
  if (pzKid()) { $("pzKGoal").innerHTML = g.html; $("pzCard").innerHTML = ""; }
  else $("pzCard").insertAdjacentHTML("afterbegin", `<div class="kidgoal small">${g.html}</div>`);
}
function pzNext() {
  clearTimeout(pzTimer);
  if (advanceStage()) return;
  $("pzGoalBadge").hidden = true;
  pzCur = pzPick(); pzIdx = 0; pzHinted = pzFailed = pzScored = pzEscape = false; stageLost = null; pzSel = null; pzArrows = []; pzLast = []; pzMarks = {};
  pzGame = new Chess(pzCur[1]);
  const direct = !!pzCur[5];                             // generated beginner puzzles start with the solver's move
  pzOrient = direct ? pzGame.turn() : (pzGame.turn() === "w" ? "b" : "w");   // Lichess puzzles: the opponent moves first
  pzState = "intro";
  const pl = pzPlayers();
  $("pzState").textContent = `${pzOrient === "w" ? "White" : "Black"} to play`; $("pzState").className = "state";
  $("pzDelta").textContent = "";
  $("pzCard").className = "card";
  $("pzCard").innerHTML = `<p class="text">${pzOrient === "w" ? "White" : "Black"} to move. ${pl.goal || isMyPuzzle(pzCur) ? esc(pzGoalText(pzCur)) : "Find the best continuation."}</p>
    <p class="sub">Puzzle rating is shown when you finish.</p>`;
  // pictures only: a big panel beside the board with "you play" (your king in a ring) and the goal (after the first move)
  $("pzKidPanel").hidden = !pzKid();
  if (pzKid()) { $("pzYou").innerHTML = `<span class="pc ${pzOrient}K"></span>`; $("pzKGoal").innerHTML = ""; $("pzCard").innerHTML = ""; }
  renderStageBar();
  pzDraw();
  if (direct) { pzIdx = 0; pzState = "solve"; pzShowGoal(); sgAsk(); pzDraw(); return; }
  pzTimer = setTimeout(() => { pzPlay(pzCur[2].split(" ")[0]); pzIdx = 1; pzState = "solve"; pzShowGoal(); pzDraw(); }, 650);
}
/* ---- stop the mate: after some defences the opponent still gives the check it threatened (the luft h3, then the
   rook checks anyway); the child then gets out of check with any move that leaves no mate in one (pzEscape) ---- */
let pzEscape = false;
function smReply(reply) {
  $("pzState").textContent = "Good, now get out of check"; $("pzState").className = "state pass";
  pzState = "wait"; pzDraw();
  pzTimer = setTimeout(() => {
    pzPlay(reply); pzEscape = true; pzState = "solve";
    const pos = parseFen(pzGame.fen()), k = Object.keys(pos).find(q => pos[q] === (pzGame.turn() === "w" ? "K" : "k"));
    pzArrows = [[reply, "red"]]; pzMarks = { [k]: "mk" }; pzDraw();
  }, 600);
  return true;
}
function smEscapes() { return pzGame.moves({ verbose: true }).filter(m => { pzGame.move(m); const x = !sgMates().length; pzGame.undo(); return x; }); }
/* ---- is it safe to take? a yes/no question: the capture is drawn as a blue arrow, 👍 = take it, 👎 = don't.
   The answer is then played out: the capture, and on a trap the opponent taking back */
let pzAsk = null;
function sgCapture() {     // the capture asked about, onto the pictured square: a winning one ("take" rows), else the biggest piece
  if (/safeTakeHard/.test(pzCur[4])) return pzGame.moves({ verbose: true }).find(m => m.from + m.to === pzCur[8].slice(0, 4));   // the harder level names it
  const caps = pzGame.moves({ verbose: true }).filter(m => m.to === pzCur[7]);
  const ok = caps.filter(m => pzCur[6].includes(m.from + m.to + (m.promotion || "")));
  const pick = / take /.test(pzCur[4]) && ok.length ? ok : caps;
  return pick.sort((a, b) => VALUE[b.piece] - VALUE[a.piece])[0];
}
function sgAsk() {
  if (!/safeTake/.test(pzCur[4]) || pzIdx) return;
  const m = sgCapture(); if (!m) return;
  pzAsk = m.from + m.to + (m.promotion || ""); pzState = "ask"; pzArrows = [[pzAsk, "blue"]]; pzMarks = {};
  $("pzCard").insertAdjacentHTML("beforeend", `${pzKid() ? "" : `<p class="text">Is it safe to take? Y = yes, N = no.</p>`}
    <div class="yesno"><button class="btn big yes" type="button" id="pzYes" aria-label="Yes, take it">👍</button><button class="btn big no" type="button" id="pzNo" aria-label="No, don't take it">👎</button></div>`);
  $("pzYes").onclick = () => sgAnswer(true); $("pzNo").onclick = () => sgAnswer(false);
}
function sgAnswer(yes, shown = false) {
  if (pzState !== "ask") return;
  clearTimeout(pzTimer);
  const safe = / take /.test(pzCur[4]), right = yes === safe, u = pzAsk, to = u.slice(2, 4), me = pzGame.turn();
  pzState = "show";
  if (!right || shown) { pzFailed = true; pzScore(false); if (!shown) { sfx("wrong"); pzBig(false); } }
  $("pzCard").innerHTML = pzKid() ? `<div class="kidcard ${right ? "ok" : "bad"}">${right ? "✓" : "✗"}</div>` : `<p class="text">${right ? "Right" : "Not quite"}: ${safe ? "the capture wins material." : "your piece would be taken back."}</p>`;
  // the capture, then the exchange on that square (the harder level stores Stockfish's line; the first level: on a trap
  // the cheapest piece takes back), then what each side won, as pictures
  const won = [], lost = [], tally = m => { if (m && m.captured) (m.color === me ? won : lost).push((m.color === me ? (me === "w" ? "b" : "w") : me) + m.captured.toUpperCase()); };
  tally(pzPlay(u)); pzArrows = [[u, safe ? "green" : "red"]]; pzMarks = {}; pzDraw();
  let line = pzCur[9];
  if (!Array.isArray(line)) {
    const back = safe ? null : pzGame.moves({ verbose: true }).filter(m => m.to === to).sort((a, b) => VALUE[a.piece] - VALUE[b.piece])[0];
    line = back ? [back.from + back.to] : [];
  }
  let k = 0;
  const step = () => {
    if (k < line.length) {
      const x = line[k++], m = pzPlay(x); tally(m);
      pzArrows = [[x, m && m.color === me ? "green" : "red"]]; pzMarks = {}; pzDraw();
      pzTimer = setTimeout(step, 900); return;
    }
    pzMarks = { [to]: safe ? "esc" : "mk" }; pzDraw();
    pzTimer = setTimeout(() => {
      pzFinish(right && !shown);
      $("pzCard").insertAdjacentHTML("afterbegin", sgTally(won, lost));
    }, 700);
  };
  pzTimer = setTimeout(step, 800);
}
// the exchange as pictures: what you took (+) and what you lost (−)
function sgTally(won, lost) {
  const pcs = a => a.map(c => `<span class="pc ${c}"></span>`).join("");
  return `<div class="swap" aria-label="Pieces won and lost">${won.length ? `<span class="won">+${pcs(won)}</span>` : ""}${lost.length ? `<span class="lost">−${pcs(lost)}</span>` : ""}</div>`;
}
function pzPlay(uci) {
  const m = pzGame.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
  pzLast = m ? [uci.slice(0, 2), uci.slice(2, 4)] : pzLast;
  if (m) sfx("move");
  return m;
}
function pzScore(win) {
  if (pzScored) return;
  pzScored = true;
  const pl = pzPlayers(), pr = pzCur[3];
  pl.done = pl.done || {}; pl.done[pzCur[0]] = win ? 1 : 0;
  againNote(pl, pzCur[0], win && !pzHinted);
  if (isMyPuzzle(pzCur)) {           // your own positions: estimated ratings, so they don't move yours
    $("pzDelta").textContent = "from your game: no rating change"; $("pzDelta").className = "delta"; save(); pzRenderBar(); return;
  }
  kidReward(pl, win);
  if (!win) stageMissPuzzle();
  pl.hist = (pl.hist || []).slice(-(HIST_MAX - 1)); pl.hist.push({ id: pzCur[0], pr, r: win ? 1 : 0, t: Date.now() });
  if (pzHinted) {
    pl.hist[pl.hist.length - 1].h = 1;      // hinted: no rating change (the parent chart skips it)
    $("pzDelta").textContent = "hint used: no rating change"; $("pzDelta").className = "delta"; save(); pzRenderBar(); return;
  }
  const n = pl.n || 0, was = pl.rating;
  pl.rating = eloStep(was, n, pr, win ? 1 : 0); pl.n = n + 1;
  const d = pl.rating - was;
  pl.hist[pl.hist.length - 1].ra = pl.rating;
  $("pzDelta").textContent = (d >= 0 ? "+" : "") + d; $("pzDelta").className = "delta " + (d >= 0 ? "up" : "down");
  save(); pzRenderBar();
}
function pzThemes() {
  const t = pzCur[4].split(" ").filter(x => THEME[x] && !["crushing", "advantage", "middlegame", "opening", "short", "long", "oneMove"].includes(x));
  return t.map(x => `<span class="pchip">${THEME[x]}</span>`).join(" ");
}
function pzBig(ok) {
  const el = $("pzBig"); el.textContent = ok ? "✓" : "✗"; el.className = "bigmark " + (ok ? "ok" : "bad");
  el.hidden = false; void el.offsetWidth; el.classList.add("pop");
  clearTimeout(pzBig.t); pzBig.t = setTimeout(() => { el.hidden = true; }, ok ? 1600 : 1000);
}
function pzFinish(win) {
  pzState = "done"; pzSel = null;
  const kid = pzKid();
  pzScore(win && !pzFailed);
  const src = isMyPuzzle(pzCur) ? myPuzzleSrc(pzCur) : null;
  const link = src && src.game ? `, or <a href="https://lichess.org/${encodeURIComponent(src.game)}#${src.ply || 0}" target="_blank" rel="noopener">see your game</a>`
    : pzCur[5] ? "" : `, or <a href="https://lichess.org/training/${esc(pzCur[0])}" target="_blank" rel="noopener">see it on Lichess</a>`;
  let why = "";
  if (pzGame.in_checkmate() && kid) {        // the "why it's mate" picture is for the child (pictures-only mode) only
    const w = whyMate(); pzMarks = w.marks; pzArrows = w.arrows;
    if (kid) w.lines = [];
    why = `<div class="plan why"><span class="lbl">Why it's checkmate</span>
      <div class="legend"><span><i class="lg mk"></i>king in check</span><span><i class="lg mx"></i>square it can't go to</span>${Object.values(w.marks).includes("mo") ? `<span><i class="lg mo"></i>blocked by its own piece</span>` : ""}</div>
      ${w.lines.map(l => `<p class="text">${esc(l)}</p>`).join("")}</div>`;
  }
  $("pzState").textContent = win && !pzFailed ? "Solved" : "Solution shown";
  $("pzState").className = "state " + (win && !pzFailed ? "pass" : "alt");
  $("pzCard").className = "card " + (win && !pzFailed ? "pass" : "alt");
  $("pzCard").innerHTML = `<div class="head"><span class="tag ${win && !pzFailed ? "pass" : "alt"}">${win && !pzFailed ? "Solved" : "Done"}</span>
      <span class="mvname">puzzle rating ${pzCur[3]}</span></div>
    <div class="head">${pzThemes()}</div>${why}
    <p class="sub">Press → for the next puzzle${link}.</p>`;
  if (kid) {   // pictures only: no reading needed
    $("pzCard").innerHTML = `<div class="kidcard ${win && !pzFailed ? "ok" : "alt"}">${win && !pzFailed ? "✓" : "↻"}</div>
      <button class="btn primary big" id="pzKidNext" aria-label="Next puzzle">▶</button>`;
    $("pzKidNext").onclick = pzNext;
  }
  if (win && !pzFailed) { pzBig(true); sfx("right"); stageStar(); }
  kidAfterPuzzle();
  pzDraw();
}
function pzUserMove(from, to) {
  if (pzState !== "solve") return false;
  const want = pzCur[2].split(" ")[pzIdx];
  const legal = pzGame.moves({ square: from, verbose: true }).filter(m => m.to === to);
  if (!legal.length) return false;
  pzMarks = {}; pzArrows = [];
  const promo = legal[0].promotion ? (want && want.slice(0, 4) === from + to && want[4] ? want[4] : "q") : undefined;
  const m = pzGame.move({ from, to, promotion: promo });
  const uci = from + to + (promo || ""), last = pzIdx === pzCur[2].split(" ").length - 1;
  pzSel = null; pzLast = [from, to];
  const accepted = (pzCur[6] && pzIdx === 0 && pzCur[6].includes(uci)) || (pzEscape && !sgMates().length);
  sfx("move");
  if (uci === want || accepted || (want && uci === want.slice(0, 4) && !want[4]) || (last && pzGame.in_checkmate())) {
    pzIdx++;
    const reply = pzIdx === 1 && pzCur[9] && pzCur[9][uci];
    if (reply) return smReply(reply);
    if (pzIdx >= pzCur[2].split(" ").length) { pzFinish(true); return true; }
    $("pzState").textContent = "Good, keep going"; $("pzState").className = "state pass";
    pzState = "wait"; pzDraw();
    pzTimer = setTimeout(() => { pzPlay(pzCur[2].split(" ")[pzIdx]); pzIdx++; pzState = "solve"; pzDraw(); }, 450);
    return true;
  }
  // wrong: show it, then offer another go (rating already counts it as a miss)
  pzFailed = true; pzScore(false); sfx("wrong");
  pzState = "wrong"; pzArrows = [[uci, "red"]];
  const mateGoal = /mate/i.test(pzCur[4]) && !/stopMate/.test(pzCur[4]) && last;
  const ex = mateGoal ? escapes() : null;
  if (ex) { pzMarks = ex.marks; pzArrows = [...pzArrows, ...ex.arrows]; }
  if (/save(Queen|Piece)/.test(pzCur[4])) {   // show who can take the piece where it now stands
    const pos = parseFen(pzGame.fen()), them = pzGame.turn(), at = from === pzCur[7] ? to : pzCur[7];
    const hunters = attackersOf(pos, at, them);
    if (hunters.length) { pzMarks = { [at]: "mk" }; pzArrows = hunters.map(h => [h + at, "red"]); }
  }
  if (/safeTake|stopMate/.test(pzCur[4])) {   // the piece you moved can now be taken (for less, or unguarded): who takes it
    const pos = parseFen(pzGame.fen()), them = pzGame.turn(), mine = them === "w" ? "b" : "w", hunters = attackersOf(pos, to, them);
    if (hunters.length && (!attackersOf(pos, to, mine).length || hunters.some(h => VALUE[pos[h].toLowerCase()] < VALUE[pos[to].toLowerCase()]))) {
      pzMarks = { [to]: "mk" }; pzArrows = [[uci, "red"], ...hunters.map(h => [h + to, "red"])];
    } else if (/safeTake/.test(pzCur[4]) && pzCur[6].some(u => u.slice(2, 4) === pzCur[7]) && to !== pzCur[7]) {
      pzMarks = { [pzCur[7]]: "esc" };     // a free piece was there to take: it glows green
    }
  }
  if (/stopMate/.test(pzCur[4])) {           // the mate is still there: show it
    const mates = sgMates(), pos = parseFen(pzGame.fen()), k = Object.keys(pos).find(q => pos[q] === (pzGame.turn() === "w" ? "k" : "K"));
    if (mates.length) { pzMarks = { [k]: "mk" }; pzArrows = [[uci, "red"], ...mates.map(m => [m.from + m.to, "red"])]; }
  }
  $("pzState").textContent = "Not the best move"; $("pzState").className = "state fail";
  $("pzCard").className = "card fail";
  $("pzCard").innerHTML = `${ex ? `<p class="text">${esc(ex.text)}</p>` : ""}<p class="text">That isn't it. Press <b>Try again</b> (or ←) to take it back, or <b>Show solution</b>.</p>`;
  pzDraw();
  if (pzKid()) {   // pictures only: let the escape squares play out before taking the move back
    pzBig(false);
    $("pzCard").innerHTML = `<div class="kidcard bad">✗</div>
      <button class="btn primary big" id="pzKidRetry" aria-label="Try again">↻</button>`;
    $("pzKidRetry").onclick = pzRetry;
  }
  return true;
}
function pzRetry() {
  if (pzState === "done" || pzState === "show") return pzRestart();
  if (pzState !== "wrong") return;
  clearTimeout(pzTimer);
  pzGame.undo(); pzArrows = []; pzMarks = {}; pzState = "solve"; pzLast = [];
  $("pzState").textContent = "Try again"; $("pzState").className = "state";
  $("pzCard").className = "card"; $("pzCard").innerHTML = `<p class="text">Your move again. This one already counts as missed.</p>`;
  pzShowGoal();
  pzDraw();
}
// the same puzzle again from its first position (after "Show solution" or a finish): already scored, so no rating change
function pzRestart() {
  clearTimeout(pzTimer);
  pzGame = new Chess(pzCur[1]); pzIdx = 0; pzSel = null; pzArrows = []; pzLast = []; pzMarks = {}; pzEscape = false;
  $("pzGoalBadge").hidden = true; $("pzCard").className = "card";
  $("pzCard").innerHTML = pzKid() ? "" : `<p class="text">Same puzzle again. It already counts, so try it (or watch the solution) as often as you like.</p>`;
  if (pzCur[5]) { pzState = "solve"; pzShowGoal(); sgAsk(); pzDraw(); return; }
  pzState = "intro"; pzDraw();
  pzTimer = setTimeout(() => { pzPlay(pzCur[2].split(" ")[0]); pzIdx = 1; pzState = "solve"; pzShowGoal(); pzDraw(); }, 650);
}
function pzSolution() {
  if (!pzCur || pzState === "done" || pzState === "intro" || pzState === "show") return;
  if (pzState === "ask") return sgAnswer(/ take /.test(pzCur[4]), true);
  clearTimeout(pzTimer);
  if (pzState === "wrong") { pzGame.undo(); pzMarks = {}; }
  pzFailed = true; pzScore(false);
  const rest = pzEscape ? [(m => m.from + m.to + (m.promotion || ""))(smEscapes()[0])] : pzCur[2].split(" ").slice(pzIdx);
  pzState = "show"; pzArrows = [];
  let k = 0;
  const step = () => {
    if (k >= rest.length) { pzArrows = []; return pzFinish(false); }
    pzPlay(rest[k]); pzArrows = [[rest[k], k % 2 ? "red" : "green"]]; k++; pzDraw();
    pzTimer = setTimeout(step, 1400);
  };
  step();
}
function pzHint() {
  if (pzState !== "solve") return;
  pzHinted = true;
  const want = pzEscape ? (m => m.from + m.to)(smEscapes()[0]) : pzCur[2].split(" ")[pzIdx];
  pzSel = want.slice(0, 2);
  $("pzCard").innerHTML = `<p class="text">Move the highlighted piece. ${esc(pzGoalText(pzCur))}</p><p class="sub">With a hint this puzzle won't change your rating.</p>`;
  pzDraw();
}
function pzSqAt(ev) { return squareAt(ev, $("pboard"), pzOrient); }
function pzWire() {
  const bd = $("pboard");
  bd.addEventListener("pointerdown", ev => {
    if (pzState !== "solve") return;
    const sq = pzSqAt(ev); if (!sq) return;
    const p = pzGame.get(sq);
    if (pzSel && pzSel !== sq && pzGame.moves({ square: pzSel, verbose: true }).some(m => m.to === sq)) { pzUserMove(pzSel, sq); return; }
    if (p && p.color === pzGame.turn()) { pzSel = sq; pzDrag = { from: sq, moved: false, x: ev.clientX, y: ev.clientY }; bd.setPointerCapture(ev.pointerId); pzDraw(); }
    else { if (!pzHinted) pzSel = null; pzDraw(); }
  });
  bd.addEventListener("pointermove", ev => {
    if (!pzDrag) return;
    if (!pzDrag.moved && Math.hypot(ev.clientX - pzDrag.x, ev.clientY - pzDrag.y) < 6) return;
    pzDrag.moved = true;
    const r = bd.getBoundingClientRect(), p = pzGame.get(pzDrag.from);
    let g = bd.querySelector(".ghost");
    if (!g) { g = document.createElement("span"); g.className = "pc ghost " + p.color + p.type.toUpperCase(); bd.appendChild(g); }
    g.style.left = (ev.clientX - r.left) + "px"; g.style.top = (ev.clientY - r.top) + "px";
  });
  bd.addEventListener("pointerup", ev => {
    if (!pzDrag) return;
    const d = pzDrag; pzDrag = null; bd.querySelector(".ghost")?.remove();
    if (d.moved && !pzUserMove(d.from, pzSqAt(ev))) pzDraw();
  });
  bd.addEventListener("pointercancel", () => { pzDrag = null; bd.querySelector(".ghost")?.remove(); pzDraw(); });
  $("pzNext").onclick = pzNext; $("pzHint").onclick = pzHint; $("pzSolution").onclick = pzSolution; $("pzRetry").onclick = pzRetry;
  $("pzRename").onclick = () => { $("pzRenameForm").hidden = false; $("pzRenameName").value = pzPlayers().name; $("pzRenameName").focus(); };
  $("pzRenameCancel").onclick = () => { $("pzRenameForm").hidden = true; };
  $("pzRenameForm").addEventListener("submit", ev => {
    ev.preventDefault();
    const name = $("pzRenameName").value.trim(); if (!name) return;
    pzPlayers().name = name; save(); $("pzRenameForm").hidden = true; pzRenderBar();
  });
  document.querySelectorAll("[data-pm]").forEach(b => b.onclick = () => { pzPlayers().mode = b.dataset.pm; pzKidRated = false; save(); pzRenderBar(); pzNext(); });
  $("pzLevel").onchange = () => { pzPlayers().level = +$("pzLevel").value; save(); pzNext(); };
  $("pzGoal").onchange = () => { pzPlayers().goal = $("pzGoal").checked; save(); };
  $("pzKid").onchange = () => { pzPlayers().kid = $("pzKid").checked; save(); pzRenderBar(); };
  $("pzSound").onclick = () => { const pl = pzPlayers(); pl.sound = !soundOn(); save(); pzRenderBar(); if (pl.sound) sfx("right"); };
  $("pzAdd").onclick = () => { $("pzAddForm").hidden = false; $("pzNewName").focus(); };
  $("pzCancel").onclick = () => { $("pzAddForm").hidden = true; };
  $("pzAddForm").addEventListener("submit", ev => {
    ev.preventDefault();
    const name = $("pzNewName").value.trim(); if (!name) return;
    const lvl = +$("pzNewLevel").value, [lo, hi] = PZ_BANDS[lvl];
    const id = "p" + Date.now().toString(36);
    S.players[id] = { name, rating: (lo + hi) / 2, n: 0, done: {}, mode: "fixed", level: lvl, goal: true, kid: lvl <= 1, hist: [] };
    S.player = id; save(); $("pzAddForm").hidden = true; $("pzNewName").value = ""; pzRenderBar(); pzNext();
  });
  $("pzNewLevel").innerHTML = PZ_BANDS.map(([lo, hi], i) => `<option value="${i}"${i === 0 ? " selected" : ""}>${lo}–${hi}${i === 0 ? " (first steps)" : i === 1 ? " (beginner)" : ""}</option>`).join("");
  document.addEventListener("keydown", ev => {
    if (window.SECTION !== "puzzles" || ev.target.closest("input, textarea, select")) return;
    const k = ev.key.toLowerCase();
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") { if (pzState === "done" || pzState === "wrong") { ev.preventDefault(); pzNext(); } }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); pzRetry(); }
    else if (k === "h") pzHint();
    else if (pzState === "ask" && (k === "y" || k === "n")) sgAnswer(k === "y");
  });
}
let pzReady = false;
function openPuzzles(stage) {
  if (stage && stage.eg) return stageGo(stage);      // endgame stages are games in the kids' corner
  const was = pzStage, wasRated = pzKidRated;
  pzStage = stage || null;
  pzReplay = !!pzStage && stageStars(pzPlayers(), pzStage.id) >= needOf(pzStage);
  pzKidRated = !pzStage && pzKidNext; pzKidNext = false;
  if (was !== pzStage || wasRated !== pzKidRated) pzCur = null;
  if (!pzReady) { pzWire(); pzReady = true; }
  pzRenderBar();
  if (!pzCur) pzNext(); else pzDraw();
}


/* ================= kids' corner: sounds, rewards, learning path, piece school, stickers, parent view ================= */

/* ---- sounds (generated with WebAudio; they start after the first tap, as browsers require) ---- */
let actx = null;
function soundOn() { const pl = S.players && S.players[S.player]; return pl ? (pl.sound !== undefined ? pl.sound : !!pl.kid) : false; }
function tone(freq, start, dur, type = "sine", vol = 0.18) {
  const t0 = actx.currentTime + start, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}
function sfx(kind) {
  if (!soundOn()) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    if (kind === "move") tone(520, 0, 0.07, "triangle", 0.07);
    else if (kind === "right") { tone(523, 0, 0.18); tone(659, 0.1, 0.18); tone(784, 0.2, 0.32); }
    else if (kind === "wrong") { tone(220, 0, 0.18, "square", 0.05); tone(165, 0.15, 0.3, "square", 0.05); }
    else if (kind === "trophy") { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.35, "triangle", 0.16)); tone(1047, 0.55, 0.6, "sine", 0.12); }
    else if (kind === "sticker") { [880, 1175, 1397, 1760].forEach((f, i) => tone(f, i * 0.07, 0.25, "sine", 0.1)); }
    else if (kind === "star") tone(1319, 0, 0.18, "sine", 0.08);
  } catch (e) {}
}

/* ---- rewards: stars, 5-in-a-row trophies, a sticker every 10 stars, a 10-puzzle session goal ---- */
const STICKERS = ["🦁", "🐯", "🐼", "🦊", "🐸", "🐙", "🦄", "🐲", "🐬", "🦉", "🐢", "🦋", "🐝", "🦖", "🐧", "🦒", "🐘", "🦜", "🐳", "🦔",
  "🚀", "🚂", "🏎️", "🚁", "⛵", "🎈", "🎸", "⚽", "🏀", "🎨", "🌈", "🌋", "🍕", "🍉", "🍦", "🧁", "👑", "💎", "🏰", "🌟"];
let kidSession = 0;
function kidReward(pl, win) {
  if (!pl.kid) return;
  pl.streak = win ? (pl.streak || 0) + 1 : 0;
  kidSession++;
  if (!win) return;
  pl.stars = (pl.stars || 0) + 1;
  const events = [];
  if (pl.streak % 5 === 0) { pl.trophies = (pl.trophies || 0) + 1; events.push(["🏆", "trophy"]); }
  if (pl.stars % 10 === 0) { const s = STICKERS[(pl.stars / 10 - 1) % STICKERS.length]; events.push([s, "sticker"]); }
  kidEvents = events;
}
let kidEvents = [];
function kidAfterPuzzle() {
  const pl = pzPlayers();
  if (!pl.kid) return;
  $("pzStars").innerHTML = `⭐ <b>${pl.stars || 0}</b>`;
  $("pzStars").classList.remove("bump"); void $("pzStars").offsetWidth; $("pzStars").classList.add("bump");
  let delay = 1400;
  for (const [icon, kind] of kidEvents) { setTimeout(() => celebrate(icon, kind), delay); delay += 2200; }
  kidEvents = [];
  if (kidSession >= 10) { kidSession = 0; setTimeout(() => sessionDone(pl), delay); }
}
// celebrations queue up (one at a time, each ~2 s or until tapped), so a medal never hides a trophy
const celebrations = [];
function celebrate(icon, kind, extra = "") {
  celebrations.push([icon, kind, extra]);
  if ($("kidOverlay").hidden) showCelebration();
}
function showCelebration() {
  const el = $("kidOverlay"), item = celebrations.shift();
  clearTimeout(celebrate.t);
  if (!item) { el.hidden = true; return; }
  const [icon, kind, extra] = item;
  el.innerHTML = `<div class="session"><div class="burst">${icon}</div>${extra}</div>`;
  el.hidden = false; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  sfx(kind === "sticker" ? "sticker" : kind === "quiet" ? "star" : "trophy");
  el.onclick = showCelebration;
  celebrate.t = setTimeout(showCelebration, 2200);
}
function sessionDone(pl) { celebrate("🎉", "trophy", `<div class="big">⭐ ${pl.stars || 0}</div>`); }
// finished the current stage? the next puzzle comes from the next unfinished stage (true: went to an endgame stage).
// A stage picked on the map after it was already finished is a replay (pzReplay): it stays until the child leaves it
function advanceStage() {
  if (!pzStage || pzReplay) return;
  const pl = pzPlayers();
  if (stageStars(pl, pzStage.id) < needOf(pzStage)) return;
  const i = stageCur(pl);
  if (i < 0 || STAGES[i] === pzStage) return;
  celebrate(`<span class="stageicon">${STAGES[i].icon}</span>`, "quiet");
  if (STAGES[i].eg || STAGES[i].gate) { stageGo(STAGES[i]); return true; }     // next up is an endgame or a boss: pzNext stops here
  pzStage = STAGES[i];
}

/* ---- learning path: a stage opens once the one before it is finished; 8 stars finish a stage, a miss costs one ---- */
const STAGE_NEED = 8;
function egIcon(pcs) { return `<span class="goal mate"><span class="pc bK"></span></span><span class="egm">${[...pcs].map(c => `<span class="pc w${c} mini"></span>`).join("")}</span>`; }
// boss gates: one win against that bot, in a game started from the gate (any 🤖 handicap counts), opens the way on;
// the picture is the bot's face
function gateIcon(face) { return `<span class="gate">${face}</span>`; }
// discovered attack: the bishop steps off the line (one arrow) and the rook behind it now hits the queen (the other)
const DISC_ICON = `<span class="goal disc"><span class="pc bQ" style="top:0"></span><span class="pc wB" style="top:33.3%"></span><span class="pc wR" style="top:66.6%"></span>` +
  `<svg viewBox="0 5 2 3" aria-hidden="true">${arrowPath("a2b3", "green", "w")}${arrowPath("a1a3", "green", "w")}</svg></span>`;
// a tactic stage's puzzles: that theme and no other path tactic or mate, short (at most 2 moves to find), rated up to 1100
const TACTIC_THEMES = ["fork", "pin", "skewer", "discoveredAttack"];
function tacticOnly(p, t) {
  const ts = p[4].split(" ");
  return ts.includes(t) && p[3] <= 1100 && p[2].split(" ").length <= 4 && !ts.some(x => x !== t && (TACTIC_THEMES.includes(x) || /^mate/.test(x)));
}
// name: for the parent view only (the child sees the pictures). Seven worlds of four stages and a boss each (the last
// one without a boss), climbing from the sea to space; WORLDS draws them on the map (renderPath)
const STAGES = [
  // 🌊 the sea
  { id: "take", name: "Take a free piece", icon: `<span class="goal take"><span class="pc bQ"></span></span>`, f: p => p[5] && /hangingPiece/.test(p[4]) },
  { id: "saveq", name: "Save the queen", icon: `<span class="goal save"><span class="pc wQ"></span></span>`, f: p => /saveQueen/.test(p[4]) },
  { id: "check", name: "Give check", icon: `<span class="goal check"><span class="pc bK"></span></span>`, f: p => /giveCheck/.test(p[4]) },
  { id: "promo", name: "Make a queen", need: 5, icon: `<span class="goal promo"><span class="pc wP"></span><b>→</b><span class="pc wQ"></span></span>`, f: p => p[5] && /promotion/.test(p[4]) },
  { id: "gate1", name: "Boss: beat Greedy Cat", need: 1, gate: "gus", icon: gateIcon("🐱"), f: () => false },
  // 🌳 the forest
  { id: "savep", name: "Save your pieces", icon: `<span class="goal save"><span class="pc wR"></span></span>`, f: p => /savePiece/.test(p[4]) },
  { id: "mateq", name: "Mate with the queen", icon: `<span class="goal mate"><span class="pc bK"></span></span><span class="pc wQ mini"></span>`, f: p => p[5] && /mateIn1/.test(p[4]) && !/backRank/.test(p[4]) && /[Qq]/.test(p[1].split(" ")[0]) },
  { id: "back", name: "Back-rank mate", icon: `<span class="goal mate"><span class="pc bK"></span></span><span class="pc bP mini"></span>`, f: p => p[5] && /backRankMate/.test(p[4]) },
  { id: "mater", name: "Mate with a rook", icon: `<span class="goal mate"><span class="pc bK"></span></span><span class="pc wR mini"></span>`, f: p => p[5] && /mateIn1/.test(p[4]) && !/backRank/.test(p[4]) && !/[Qq]/.test(p[1].split(" ")[0]) },
  { id: "gate2", name: "Boss: beat Wily Wolf", need: 1, gate: "cat", icon: gateIcon("🐺"), f: () => false },
  // ❄️ the snow: endgames (played in the kids' corner, not puzzles): mate the lone king; the picture shows the pieces
  // you mate with (king + rook, the hardest, comes after the Tiger). Then the first puzzles from real games (Lichess)
  { id: "egqr", name: "Endgame: mate with queen + rook", need: 3, eg: "QR", icon: egIcon("QR"), f: () => false },
  { id: "egrr", name: "Endgame: mate with two rooks", need: 3, eg: "RR", icon: egIcon("RR"), f: () => false },
  { id: "egq", name: "Endgame: mate with king + queen", need: 3, eg: "KQ", icon: egIcon("KQ"), f: () => false },
  { id: "hang", name: "Win the free piece (real games)", icon: `<span class="goal take"><span class="pc bR"></span></span><span class="pc wN mini"></span>`, f: p => !p[5] && /hangingPiece/.test(p[4]) && p[3] <= 800 && !/mate/.test(p[4]) },
  { id: "gate4", name: "Boss: beat Pawn Pete (Pawn Wars)", need: 1, gate: "pete", icon: gateIcon("🐣"), f: () => false },
  // 🏜️ the desert
  { id: "mix", name: "Mixed puzzles", icon: `<span class="goal win">🧩</span>`, f: p => !p[5] && p[3] >= 400 && p[3] < 650 },
  { id: "fork", name: "Forks", icon: `<span class="goal win">🍴</span>`, f: p => !p[5] && /fork/.test(p[4]) && p[3] < 850 },
  // generated by puzzles/safe_gen.py: take only when it wins something / stop a mate in one (the threat is drawn)
  { id: "safe", name: "Is it safe to take?", icon: `<span class="goal scale">⚖️<span class="pc bN"></span></span>`, f: p => p[4].split(" ").includes("safeTake") },
  { id: "stopm", name: "Stop the mate", icon: `<span class="goal guard"><span class="pc wK"></span></span>`, f: p => /stopMate/.test(p[4]) },
  { id: "gate3", name: "Boss: beat Tactic Tiger", need: 1, gate: "tiger", icon: gateIcon("🐯"), f: () => false },
  // 🌋 the lava
  { id: "egr", name: "Endgame: mate with king + rook", need: 3, eg: "KR", icon: egIcon("KR"), f: () => false },
  { id: "mate1", name: "Mate in 1 (real games)", icon: `<span class="goal mate mn" data-n="1"><span class="pc bK"></span></span>`, f: p => !p[5] && /mateIn1/.test(p[4]) && p[3] <= 750 },
  { id: "mate2", name: "Mate in 2", icon: `<span class="goal mate mn" data-n="2"><span class="pc bK"></span></span>`, f: p => !p[5] && /mateIn2/.test(p[4]) && p[3] < 1000 },
  // one tactic each (Lichess, mostly puzzles/themes.json up to 1100; build.py ships them to the iPad site too)
  { id: "pin", name: "Pins", icon: `<span class="goal win">📌</span>`, f: p => !p[5] && tacticOnly(p, "pin") },
  { id: "gate5", name: "Boss: beat T-Rex", need: 1, gate: "dino", icon: gateIcon("🦖"), f: () => false },
  // 🏰 the castle in the clouds
  { id: "skewer", name: "Skewers", icon: `<span class="goal win">🍢</span>`, f: p => !p[5] && tacticOnly(p, "skewer") },
  { id: "disc", name: "Discovered attacks", icon: DISC_ICON, f: p => !p[5] && tacticOnly(p, "discoveredAttack") },
  // the harder ⚖️ (safe_gen.py, safeTakeHard): count attackers and defenders, take with the smaller piece, hidden
  // defenders, a big piece worth taking even though it's defended
  { id: "safe2", name: "Is it safe to take? (harder)", icon: `<span class="goal scale mn" data-n="2">⚖️<span class="pc bR"></span></span>`, f: p => /safeTakeHard/.test(p[4]) },
  // a review stop: puzzles from the stages already finished, missed ones first (reviewPick)
  { id: "review", name: "Review: puzzles from finished stages", review: true, icon: `<span class="goal win">🔁</span>`, f: () => false },
  { id: "gate6", name: "Boss: beat the Dragon", need: 1, gate: "dragon", icon: gateIcon("🐉"), f: () => false },
  // 🚀 space: king-and-pawn games (kids' corner, like the endgames above): catch a running pawn; make a queen with the king's help
  { id: "egcatch", name: "Endgame: catch the pawn with your king", need: 3, eg: "catch", icon: `<span class="goal take"><span class="pc bP"></span></span><span class="egm"><span class="pc wK mini"></span></span>`, f: () => false },
  { id: "egkp", name: "Endgame: king + pawn, make a queen", need: 3, eg: "kp", icon: `<span class="goal promo"><span class="pc wP"></span><b>→</b><span class="pc wQ"></span></span><span class="egm"><span class="pc wK mini"></span></span>`, f: () => false },
];
// the map's worlds, one per boss (in STAGES order): a backdrop (CSS .w-<id>) and things scattered beside the road.
// Emoji up to Unicode 10 only: the iPad's iOS is old
const WORLDS = [
  { id: "sea", icon: "🌊", deco: ["🐚", "🐠", "⛵", "🦀", "🐳", "🐙"] },
  { id: "forest", icon: "🌳", deco: ["🍄", "🌲", "🦔", "🌻", "🐿️", "🌲"] },
  { id: "snow", icon: "❄️", deco: ["⛄", "🏔️", "🐧", "❄️", "🎿", "🏔️"] },
  { id: "desert", icon: "🏜️", deco: ["🌵", "🐪", "🦂", "🌵", "☀️", "🐫"] },
  { id: "lava", icon: "🌋", deco: ["🔥", "🌋", "💥", "🔥", "☄️", "🌋"] },
  { id: "castle", icon: "🏰", deco: ["☁️", "🏰", "🌈", "🦅", "☁️", "🎈"] },
  { id: "space", icon: "🚀", deco: ["🌙", "⭐", "🛸", "🌍", "☄️", "🚀"] },
];
function worldOf(i) { return STAGES.slice(0, i).filter(st => st.gate).length; }
const stagePools = {}, stageLadders = {};
function stagePool(st) { return stagePools[st.id] || (stagePools[st.id] = GYM.puzzles.filter(st.f)); }
function stageLadder(st) { return stageLadders[st.id] || (stageLadders[st.id] = [...stagePool(st)].sort((a, b) => a[3] - b[3])); }
function stageStars(pl, id) { return (pl.stages || {})[id] || 0; }
function needOf(st) { return st.need || STAGE_NEED; }
function stageDone(pl, st) { return stageStars(pl, st.id) >= needOf(st); }
// strict order: a stage opens when every stage before it is finished or "free" (left unfinished behind a finished
// stage when the path changed, see stageMigrate: it doesn't block, but stays on the map to play)
function stageOpen(pl, i) {
  stageMigrate(pl);
  return STAGES.slice(0, i).every(st => stageDone(pl, st) || stageFree(pl, st));
}
// the stage to play next: the first open unfinished one (a free stage behind the child doesn't count)
function stageCur(pl) { return STAGES.findIndex((st, k) => stageOpen(pl, k) && !stageDone(pl, st) && !stageFree(pl, st)); }
// pl.gateFree / pl.gatesSeen: named when only boss gates had them; now they hold every stage
function stageFree(pl, st) { return !!(pl.gateFree || {})[st.id]; }
// The path before the strict order (pl.pathV < 2) let any star open the stages up to it, and solves in the 🧩 / Puzzles
// tabs and wins in the 🤖 tab counted too. Once per player: find the stage the child was on then (the first one
// unfinished and not free, in the old order; a gate not yet seen there was free if everything before it was finished),
// and drop the stars of puzzle stages and gates after it (they came from outside the path; endgame and review stars
// only ever came from the path and stay).
// Then, once per stage the player hasn't seen (pl.gatesSeen; the old order's stages count as seen): a new stage before
// the first unfinished stage he had is free, so the child keeps his place. Stages added later get the same treatment.
const OLD_ORDER = "take saveq check promo gate1 savep back mateq mater gate2 egqr egrr egq egr gate3 fork mix safe stopm gate4 mate2 pin skewer disc gate5 safe2 review egcatch egkp".split(" ");
function stageMigrate(pl) {
  if (!window.GYM || !GYM.puzzles || ((pl.pathV || 0) >= 2 && pl.gatesSeen && STAGES.every(st => pl.gatesSeen[st.id]))) return;
  pl.gateFree = pl.gateFree || {}; pl.gatesSeen = pl.gatesSeen || {}; pl.stages = pl.stages || {};
  if ((pl.pathV || 0) < 2) {
    const byId = Object.fromEntries(STAGES.map(st => [st.id, st])), fin = id => stageStars(pl, id) >= needOf(byId[id]);
    const cur = OLD_ORDER.findIndex((id, k) => {
      if (fin(id) || pl.gateFree[id]) return false;
      if (byId[id].gate && !pl.gatesSeen[id] && OLD_ORDER.slice(0, k).every(x => byId[x].gate || fin(x))) { pl.gateFree[id] = 1; return false; }
      return true;
    });
    if (cur >= 0) for (const id of OLD_ORDER.slice(cur + 1)) if (!byId[id].eg && !byId[id].review) delete pl.stages[id];
    OLD_ORDER.forEach(id => { pl.gatesSeen[id] = 1; });
    pl.pathV = 2;
  }
  const first = STAGES.findIndex(st => pl.gatesSeen[st.id] && !stageDone(pl, st) && !stageFree(pl, st));
  STAGES.forEach((st, i) => {
    if (pl.gatesSeen[st.id]) return;
    if (!stageDone(pl, st) && (first < 0 || i < first)) pl.gateFree[st.id] = 1;
    pl.gatesSeen[st.id] = 1;
  });
  save();
}
// a win in a game started from a boss gate clears that gate (games from the 🤖 tab don't count); a medal, and the
// next world's picture when the boss was the last stage of a world
function gateWin(pl, botId, from = null) {
  const i = STAGES.indexOf(from);
  if (i < 0 || from.gate !== botId || stageDone(pl, from) || !stageOpen(pl, i)) return null;
  pl.stages = pl.stages || {}; pl.stages[from.id] = needOf(from);
  setTimeout(() => celebrate("🏅", "trophy"), 1500);
  if (WORLDS[worldOf(i + 1)] && i + 1 < STAGES.length) setTimeout(() => celebrate(`<span class="wbig">${WORLDS[worldOf(i + 1)].icon}</span>`, "trophy"), 1600);
  return from;
}
function gateNext() {   // ▶ after beating a boss: the next stage to play, or the map
  const pl = pzPlayers(), i = stageCur(pl);
  if (i < 0) { kidTab = "path"; return openKids(); }
  stageGo(STAGES[i]);
}
// Lichess stages get harder as they fill up: the pick comes from the stage's puzzles sorted by rating, at stars / need
// of the way up (at most 85%: the hardest few are left out), so a miss (a star lost) brings easier ones back.
// Generated stages (ratings are guesses: sorting would serve all the "take" questions before the traps) and replays
// of a finished stage pick from all of them
function stagePick(pl) {
  if (pzStage.review) return reviewPick(pl);
  const again = againPick(pl, pzStage.f); if (again) return again;     // a missed puzzle of this stage comes back
  const pool = stageLadder(pzStage), done = pl.done || {}, n = pool.length;
  const rnd = a => a[Math.floor(Math.random() * a.length)];
  if (pzReplay || pool[0][5]) { const fresh = pool.filter(p => !(p[0] in done)); return rnd(fresh.length ? fresh : pool); }
  const at = Math.round(Math.min(stageStars(pl, pzStage.id), needOf(pzStage)) / needOf(pzStage) * .85 * (n - 1));
  for (let w = Math.max(4, Math.round(n * .08)); ; w *= 2) {
    const near = pool.slice(Math.max(0, at - w), at + w + 1), fresh = near.filter(p => !(p[0] in done));
    if (fresh.length || w >= n) return rnd(fresh.length ? fresh : near);
  }
}
// the review stop: puzzles from the puzzle stages the child has finished (all puzzle stages before it if none is),
// half the time one he missed and hasn't yet solved cleanly twice (pl.again, due or not), else a random finished stage
function reviewStages(pl) {
  const upTo = STAGES.findIndex(st => st.review), sts = STAGES.filter((st, k) => !st.eg && !st.gate && !st.review && stagePool(st).length && (upTo < 0 || k < upTo));
  const done = sts.filter(st => stageStars(pl, st.id) >= needOf(st));
  return done.length ? done : sts;
}
function reviewPick(pl, r = Math.random()) {
  const sts = reviewStages(pl), mine = p => sts.some(st => st.f(p)), rnd = a => a[Math.floor(Math.random() * a.length)];
  againDue(pl, null);                                   // builds againRows
  const missed = Object.entries(pl.again || {}).filter(([id, x]) => x.n < 2 && againRows[id] && mine(againRows[id])).map(([id]) => againRows[id]);
  if (missed.length && r < .5) return rnd(missed);
  const pool = stagePool(rnd(sts)), done = pl.done || {}, fresh = pool.filter(p => !(p[0] in done));
  return rnd(fresh.length ? fresh : pool);
}
// stars come only from the path: a clean solve of a puzzle from the open stage (the review stop counts its own)
function stageStar() {
  const pl = pzPlayers(), st = pzStage;
  if (!st || !(st.review || st.f(pzCur))) return;
  pl.stages = pl.stages || {};
  const had = stageStars(pl, st.id);
  pl.stages[st.id] = had + 1; stageLost = null; save(); renderStageBar();
  if (had + 1 === needOf(st) && pl.kid) setTimeout(() => celebrate("🏅", "trophy"), 1500);
}
// a miss on the path costs a star of that stage, while it isn't finished (a replay never takes a finished stage back);
// the star falls off the row of stars (stageLost, until the next puzzle or game: renderStageBar / egDraw)
let stageLost = null;
function stageLose(pl, st) {
  const had = stageStars(pl, st.id);
  if (!had || had >= needOf(st)) return false;
  pl.stages[st.id] = had - 1; stageLost = st.id; save();
  return true;
}
function stageMissPuzzle() {   // pzScore(false): a missed puzzle in a path stage
  if (pzStage && (pzStage.review || pzStage.f(pzCur)) && stageLose(pzPlayers(), pzStage)) renderStageBar();
}
function stageDots(pl, st) {   // ★ per star (and the one just lost, falling off)
  const need = needOf(st), n = Math.min(stageStars(pl, st.id), need), lost = stageLost === st.id;
  return `<span class="dots">${Array.from({ length: need }, (_, i) => `<i class="${i < n ? "on" : lost && i === n ? "lost" : ""}">★</i>`).join("")}</span>`;
}
// open a stage: puzzle stages in the puzzle view, endgame stages as a game in the kids' corner, a gate as a bot game
function stageGo(st) {
  if (st.gate) {
    kidTab = "play"; botStart(st.gate, st);
    return window.SECTION === "kids" ? openKids() : go("kids", "play");
  }
  if (!st.eg) return go("puzzles", { stage: st });
  eg = null; egSt = st; egReplay = stageStars(pzPlayers(), st.id) >= needOf(st);
  if (window.SECTION === "kids") { kidTab = "end"; openKids(); } else go("kids", "end");
}
// a stage picture drawn from the solver's side: the path icons show White's view, so swap the colours for Black
function stageIconFor(st, side) { return side === "b" ? st.icon.replace(/pc ([wb])/g, (m, c) => "pc " + (c === "w" ? "b" : "w")) : st.icon; }
function renderStageBar() {
  const bar = $("pzStageBar");
  if (!pzStage && pzKidRated) {        // the 🧩 tab: the way back to the kids' corner
    bar.hidden = false;
    bar.innerHTML = `<button class="btn big" type="button" id="pzMap" aria-label="Back to the kids' corner">🗺</button><span class="stageicon">🧩</span>`;
    $("pzMap").onclick = () => go("kids", "path");
    return;
  }
  if (!pzStage) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `<button class="btn big" type="button" id="pzMap" aria-label="Back to the map">🗺</button>
    <span class="stageicon">${pzCur && pzGame ? stageIconFor(pzStage, pzOrient) : pzStage.icon}</span>${stageDots(pzPlayers(), pzStage)}`;
  $("pzMap").onclick = () => go("kids", "path");
}
// the map, like a mobile game's: the road winds up from the sea (stage 1, at the bottom) to space, one backdrop per
// world, the stops on the road (a ring fills with the stars, bosses are bigger with a ring in their strength's colour),
// your king hopping on the stop to play. Laid out in pixels for the box's width (redrawn when it changes)
function renderPath() {
  const pl = pzPlayers(), curI = stageCur(pl), box = $("kPath");
  const W = Math.min(900, box.clientWidth || 600), A = Math.min(W * .3, 250), STEP = W >= 700 ? 118 : 108, GAP = 50, PAD = 80;
  const nw = WORLDS.length, curW = curI < 0 ? nw : worldOf(curI);
  const ys = STAGES.map((st, i) => PAD + i * STEP + worldOf(i) * GAP), H = ys[ys.length - 1] + PAD + 70;
  const pts = STAGES.map((st, i) => [st.gate ? W / 2 : W / 2 + A * Math.sin(i * 1.25 + .4), H - ys[i]]);
  const road = ps => ps.map((p, i) => {   // Catmull-Rom through the stops, as cubic curves
    if (!i) return `M${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const a = ps[i - 2] || ps[i - 1], b = ps[i - 1], d = ps[i + 1] || p;
    return `C${(b[0] + (p[0] - a[0]) / 6).toFixed(1)},${(b[1] + (p[1] - a[1]) / 6).toFixed(1)} ${(p[0] - (d[0] - b[0]) / 6).toFixed(1)},${(p[1] - (d[1] - b[1]) / 6).toFixed(1)} ${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  }).join("");
  const bands = WORLDS.map((w, k) => {
    const idx = STAGES.map((_, i) => i).filter(i => worldOf(i) === k); if (!idx.length) return "";
    const lo = k ? ys[idx[0]] - STEP / 2 - GAP / 2 : 0, hi = k < nw - 1 ? ys[idx[idx.length - 1]] + STEP / 2 + GAP / 2 : H;
    const r = rng(k * 7919 + 17), deco = [];
    idx.forEach((i, j) => {         // something beside the road, on the side away from the stop
      const left = pts[i][0] > W / 2, x = left ? W * (.06 + r() * .2) : W * (.74 + r() * .2), y = pts[i][1] + (r() - .5) * STEP * .5;
      if (pts.every(p => Math.hypot(p[0] - x, p[1] - y) > 78)) deco.push(`<span class="deco" style="left:${x.toFixed(0)}px;top:${(y - (H - hi)).toFixed(0)}px;font-size:${(30 + r() * 18).toFixed(0)}px">${w.deco[j % w.deco.length]}</span>`);
    });
    const allDone = idx.every(i => stageDone(pl, STAGES[i]));
    return `<div class="world w-${w.id}${k > curW ? " dim" : ""}" style="top:${(H - hi).toFixed(0)}px;height:${(hi - lo).toFixed(0)}px" aria-hidden="true">
      ${deco.join("")}<span class="wsign${allDone ? " done" : ""}">${w.icon}</span></div>`;
  }).join("");
  const nodes = STAGES.map((st, i) => {
    const need = needOf(st), open = stageOpen(pl, i), n = Math.min(stageStars(pl, st.id), need), done = n >= need, cur = i === curI;
    const bot = st.gate && typeof BOTS !== "undefined" && BOTS.find(b => b.id === st.gate), ring = bot && bot.lvl ? BOT_RING[bot.lvl - 1] : "#8a7fd0";
    return `<button class="node${st.gate ? " boss" : ""}${open ? "" : " locked"}${done ? " done" : ""}${cur ? " cur" : ""}" type="button" data-st="${i}" ${open ? "" : "disabled"}
      style="left:${pts[i][0].toFixed(0)}px;top:${pts[i][1].toFixed(0)}px;--p:${Math.round(100 * n / need)};--ring:${ring}" aria-label="Stage ${i + 1}: ${esc(st.name)}${open ? "" : ", locked"}">
      <span class="ic">${open || st.gate ? st.icon : "🔒"}</span>${open && !st.gate ? stageDots(pl, st) : ""}</button>`;
  }).join("");
  const me = curI >= 0 ? `<span class="me pc wK" style="left:${pts[curI][0].toFixed(0)}px;top:${(pts[curI][1] - (STAGES[curI].gate ? 82 : 70)).toFixed(0)}px" aria-hidden="true"></span>` : "";
  const goal = pts[pts.length - 1];
  const keep = box.querySelector(".mapwrap"), was = keep && keep.dataset.cur === String(curI) ? keep.scrollTop : null;
  box.innerHTML = `<div class="mapwrap" data-cur="${curI}"><div class="map" style="width:${W}px;height:${H.toFixed(0)}px">${bands}
    <svg class="road" width="${W}" height="${H.toFixed(0)}" viewBox="0 0 ${W} ${H.toFixed(0)}" aria-hidden="true">
      <path class="rdo" d="${road(pts)}"/><path class="rd" d="${road(pts)}"/><path class="rdl" d="${road(pts)}"/>
      ${curI !== 0 ? `<path class="rdp" d="${road(curI < 0 ? pts : pts.slice(0, curI + 1))}"/>` : ""}</svg>
    <span class="goalcup${curI < 0 ? " won" : ""}" style="left:${goal[0].toFixed(0)}px;top:${(goal[1] - 92).toFixed(0)}px" aria-hidden="true">🏆</span>
    ${nodes}${me}</div></div>`;
  box.querySelectorAll("[data-st]").forEach(b => b.onclick = () => stageGo(STAGES[+b.dataset.st]));
  // the map scrolls in its own box below the tabs (they stay in sight), opened at the stop to play (or where it was)
  const wrap = box.querySelector(".mapwrap");
  wrap.style.maxHeight = Math.max(360, innerHeight - (wrap.getBoundingClientRect().top + scrollY) - 12) + "px";
  wrap.scrollTop = was !== null ? was : (curI < 0 ? 0 : pts[curI][1] - wrap.clientHeight / 2);
}

/* ---- piece school: move one piece to collect every star (pawn levels: capture the black pawns too) ---- */
const SCHOOL = ["R", "B", "Q", "N", "K", "P"];
const SCHOOL_START = { R: "a1", B: "c1", Q: "d1", N: "b1", K: "e1" };
const PAWN_LEVELS = [
  { start: "e2", stars: ["e4"], enemies: [] },
  { start: "d2", stars: ["e6"], enemies: ["e3"] },
  { start: "c2", stars: ["e6"], enemies: ["d3", "e4"] },
  { start: "a2", stars: ["c8"], enemies: ["b3", "c4"] },
];
function rng(seed) { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
function schoolLevel(pc, li) {
  if (pc === "P") return PAWN_LEVELS[li];
  const r = rng(pc.charCodeAt(0) * 97 + li * 13 + 5), start = SCHOOL_START[pc], stars = new Set();
  const colorOk = sq => pc !== "B" || (FILES.indexOf(sq[0]) + +sq[1]) % 2 === (FILES.indexOf(start[0]) + +start[1]) % 2;
  while (stars.size < li + 1) {
    const sq = FILES[Math.floor(r() * 8)] + (1 + Math.floor(r() * 8));
    if (sq !== start && colorOk(sq)) stars.add(sq);
  }
  return { start, stars: [...stars], enemies: [] };
}
function schoolLevels(pc) { return pc === "P" ? PAWN_LEVELS.length : 5; }
function pieceTargets(pc, from, enemies) {
  const fx = FILES.indexOf(from[0]), fy = +from[1], out = [], on = (x, y) => x >= 0 && x < 8 && y >= 1 && y <= 8;
  const add = (x, y) => on(x, y) && out.push(FILES[x] + y);
  if (pc === "N") {
    [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([a, b]) => add(fx + a, fy + b));
  } else if (pc === "K") {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { if (a || b) add(fx + a, fy + b); }
  } else if (pc === "P") {
    if (on(fx, fy + 1) && !enemies.includes(FILES[fx] + (fy + 1))) {
      add(fx, fy + 1);
      if (fy === 2 && !enemies.includes(FILES[fx] + 4)) add(fx, 4);
    }
    for (const a of [-1, 1]) if (on(fx + a, fy + 1) && enemies.includes(FILES[fx + a] + (fy + 1))) add(fx + a, fy + 1);
  } else {
    const dirs = pc === "R" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : pc === "B" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [a, b] of dirs) for (let k = 1; k < 8 && on(fx + a * k, fy + b * k); k++) {
      const q = FILES[fx + a * k] + (fy + b * k); out.push(q); if (enemies.includes(q)) break;
    }
  }
  return out;
}
function schoolPar(pc, lv) {   // fewest moves to collect everything (breadth-first search over square + collected set)
  const goals = [...lv.stars, ...lv.enemies], full = (1 << goals.length) - 1, seen = new Set(), q = [[lv.start, 0, 0]];
  seen.add(lv.start + ":0");
  while (q.length) {
    const [sq, mask, d] = q.shift();
    if (mask === full) return d;
    const enemiesLeft = lv.enemies.filter((e, i) => !(mask & (1 << (lv.stars.length + i))));
    for (const t of pieceTargets(pc, sq, enemiesLeft)) {
      const gi = goals.indexOf(t), m = gi >= 0 ? mask | (1 << gi) : mask, k = t + ":" + m;
      if (!seen.has(k)) { seen.add(k); q.push([t, m, d + 1]); }
    }
    if (q.length > 50000) break;
  }
  return 99;
}
let sc = null;   // {pc, li, lv, at, got:Set, enemies:[], moves, par, done}
function schoolStart(pc, li) {
  const lv = schoolLevel(pc, li);
  sc = { pc, li, lv, at: lv.start, got: new Set(), enemies: [...lv.enemies], moves: 0, par: schoolPar(pc, lv), done: false, queen: false,
         demo: li === 0 };   // first level of each piece: show how the piece moves until the first move
  schoolDraw();
}
function schoolDraw() {
  const pos = { [sc.at]: sc.queen ? "Q" : sc.pc }, marks = {};
  sc.enemies.forEach(e => pos[e] = "p");
  sc.lv.stars.forEach(s => { if (!sc.got.has(s)) marks[s] = "star"; });
  const piece = sc.queen ? "Q" : sc.pc, tg = sc.done ? [] : pieceTargets(piece, sc.at, sc.enemies);
  // movement picture: one arrow per direction, to the farthest square the piece can reach that way
  let arrows = [];
  if (sc.demo && !sc.moves) {
    const fx = FILES.indexOf(sc.at[0]), fy = +sc.at[1], far = {};
    for (const t of tg) {
      const dx = FILES.indexOf(t[0]) - fx, dy = +t[1] - fy, g = Math.max(Math.abs(dx), Math.abs(dy));
      const dir = "NK".includes(piece) || piece === "P" ? t : Math.sign(dx) + "," + Math.sign(dy);
      if (!far[dir] || g > far[dir][1]) far[dir] = [t, g];
    }
    arrows = Object.values(far).map(([t]) => [sc.at + t, "green"]);
  }
  renderBoard(pos, { el: $("sboard"), o: "w", sel: sc.done ? null : sc.at, tgts: tg, marks, arrows });
  const left = sc.lv.stars.length - sc.got.size;
  $("sGoal").innerHTML = `<span class="pc w${piece}"></span><b>→</b><span class="st">★</span><b>× ${left}</b>
    ${sc.enemies.length ? `<b>+</b><span class="pc bP"></span><b>× ${sc.enemies.length}</b>` : ""}
    <small>Move the ${PNAME[piece.toLowerCase()]} to every star${sc.enemies.length ? " and capture the black pawns" : ""}. The fewer moves, the more ⭐.</small>`;
  const pl = pzPlayers(), prog = (pl.school || {})[sc.pc] || [];
  $("sPieces").innerHTML = SCHOOL.map(p => {
    const got = ((pl.school || {})[p] || []).reduce((a, b) => a + (b || 0), 0), max = schoolLevels(p) * 3;
    return `<button type="button" data-sp="${p}" aria-pressed="${p === sc.pc}" aria-label="${PNAME[p.toLowerCase()]}"><span class="pc w${p}"></span><small>${got}/${max}★</small></button>`;
  }).join("");
  $("sPieces").querySelectorAll("[data-sp]").forEach(b => b.onclick = () => schoolStart(b.dataset.sp, firstOpenLevel(b.dataset.sp)));
  $("sLevels").innerHTML = Array.from({ length: schoolLevels(sc.pc) }, (_, i) => {
    const st = prog[i] || 0, open = i === 0 || pl.schoolAll || (prog[i - 1] || 0) > 0;
    return `<button type="button" data-sl="${i}" aria-pressed="${i === sc.li}" ${open ? "" : "disabled"}>${open ? i + 1 : "🔒"}<small>${"★".repeat(st)}${"☆".repeat(3 - st)}</small></button>`;
  }).join("");
  $("sLevels").querySelectorAll("[data-sl]").forEach(b => b.onclick = () => schoolStart(sc.pc, +b.dataset.sl));
  $("sMoves").innerHTML = `👣 <b>${sc.moves}</b> <span class="par">/ ${sc.par}</span>`;
}
function firstOpenLevel(pc) {
  const prog = (pzPlayers().school || {})[pc] || [];
  for (let i = 0; i < schoolLevels(pc); i++) if (!(prog[i] > 0)) return i;
  return 0;
}
function schoolMove(to) {
  if (!sc || sc.done) return;
  const piece = sc.queen ? "Q" : sc.pc;
  if (!pieceTargets(piece, sc.at, sc.enemies).includes(to)) return;
  sc.at = to; sc.moves++;
  if (sc.enemies.includes(to)) sc.enemies = sc.enemies.filter(e => e !== to);
  if (sc.lv.stars.includes(to) && !sc.got.has(to)) { sc.got.add(to); sfx("star"); } else sfx("move");
  if (sc.pc === "P" && to[1] === "8") sc.queen = true;
  if (sc.got.size === sc.lv.stars.length && !sc.enemies.length) {
    sc.done = true;
    const stars = sc.moves <= sc.par ? 3 : sc.moves <= sc.par + 2 ? 2 : 1;
    const pl = pzPlayers(); pl.school = pl.school || {}; pl.school[sc.pc] = pl.school[sc.pc] || [];
    pl.school[sc.pc][sc.li] = Math.max(pl.school[sc.pc][sc.li] || 0, stars); save();
    sfx("right");
    $("sDone").innerHTML = `<div class="big">${"⭐".repeat(stars)}</div>
      <div class="row"><button class="btn big" type="button" id="sAgain" aria-label="Try again">↻</button>
      <button class="btn primary big" type="button" id="sNext" aria-label="Next">▶</button></div>`;
    $("sDone").hidden = false;
    $("sAgain").onclick = () => { $("sDone").hidden = true; schoolStart(sc.pc, sc.li); };
    $("sNext").onclick = schoolNext;
  }
  schoolDraw();
}

/* ---- helpers for the mini-games: stars (a sticker every 10, as everywhere else), squares, a FEN from a position ---- */
function kidAddStars(n) {
  const pl = pzPlayers(), had = pl.stars || 0; pl.stars = had + n; save();
  if (Math.floor(pl.stars / 10) > Math.floor(had / 10)) celebrate(STICKERS[(Math.floor(pl.stars / 10) - 1) % STICKERS.length], "sticker");
  const el = $("kStarsTop"); el.innerHTML = `⭐ <b>${pl.stars}</b>`; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}
function kidSq(lo = 1, hi = 8, files = FILES) { return files[Math.floor(Math.random() * files.length)] + (lo + Math.floor(Math.random() * (hi - lo + 1))); }
function kidFen(pos, turn) {
  const rows = [];
  for (let r = 8; r >= 1; r--) {
    let s = "", e = 0;
    for (const f of FILES) { const p = pos[f + r]; if (p) { if (e) { s += e; e = 0; } s += p; } else e++; }
    rows.push(s + (e || ""));
  }
  return `${rows.join("/")} ${turn} - - 0 1`;
}

/* ---- first endgames on the path: mate the lone king with king + queen or king + rook; the black king runs away ---- */
const EG_PAR = { QR: [7, 12], RR: [9, 15], KQ: [12, 20], KR: [20, 32] };   // your moves for ⭐⭐⭐ / ⭐⭐ (slower: ⭐)
let eg = null, egSt = null, egReplay = false;   // eg = {st, g (chess.js), sel, last, moves, over, hist: [fen]}; egSt = the endgame stage to open; egReplay: it was finished already
// a start with the black king in the middle, not in check, none of your pieces next to it; White (you) to move.
// pcs = your pieces besides the king ("QR", "RR", "KQ" = the queen, "KR" = the rook)
function egStartFen(pcs) {
  if (pcs === "catch") return cpStartFen();
  if (pcs === "kp") return kpStartFen();
  for (;;) {
    const bk = kidSq(3, 6, "cdef"), pos = { [bk]: "k" }, mine = ["K", ...pcs.replace("K", "")];
    for (const p of mine) { const q = kidSq(); if (!pos[q]) pos[q] = p; }
    const sqs = Object.keys(pos).filter(q => q !== bk);
    if (sqs.length < mine.length || sqs.some(q => attacksSq(pos, q, bk) || attacksSq(pos, bk, q))) continue;
    return kidFen(pos, "w");
  }
}
function egRoom(pos, k) {   // squares the black king on k could step to next
  const noK = { ...pos }; delete noK[k];
  const x = FILES.indexOf(k[0]), y = +k[1];
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if ((!dx && !dy) || x + dx < 0 || x + dx > 7 || y + dy < 1 || y + dy > 8) continue;
    if (!attackersOf(noK, FILES[x + dx] + (y + dy), "w").length) n++;
  }
  return n;
}
// the bot king takes a piece left unguarded, else goes where it has the most room, nearest the middle
function egBotMove(g) {
  const ms = g.moves({ verbose: true }), take = ms.find(m => m.captured);
  if (take) return take;
  let best = null, bs = -1e9;
  for (const m of ms) {
    g.move(m); const room = egRoom(parseFen(g.fen()), m.to); g.undo();
    const s = room * 10 - Math.abs(FILES.indexOf(m.to[0]) - 3.5) - Math.abs(+m.to[1] - 4.5) + Math.random() * .5;
    if (s > bs) { bs = s; best = m; }
  }
  return best;
}
function egStart(st) {
  egSt = st || egSt || STAGES.find(s => s.eg);
  eg = { st: egSt, g: new Chess(egStartFen(egSt.eg)), sel: null, last: [], moves: 0, over: null, hist: [], undos: 0, slip: false };
  stageLost = null;
  $("eDone").hidden = true; egDraw();
}
function egDraw() {
  const g = eg.g, pos = parseFen(g.fen()), mine = !eg.over && g.turn() === "w", marks = {};
  if (g.in_check()) marks[Object.keys(pos).find(q => pos[q] === "k")] = "mk";
  if (mine) for (const q of Object.keys(pos)) {      // your queen/rook (or the pawn you escort) next to the king with no guard
    if ("QRP".includes(pos[q]) && attackersOf(pos, q, "b").length && !attackersOf(pos, q, "w").length) marks[q] = "dg";
  }
  const pawnGoal = eg.st.eg === "catch" ? "p" : eg.st.eg === "kp" ? "P" : null;   // the square the pawn runs to
  if (pawnGoal && !eg.over) {
    const at = Object.keys(pos).find(q => pos[q] === pawnGoal);
    if (at) { const goal = at[0] + (pawnGoal === "p" ? 1 : 8); marks[goal] = marks[goal] || (pawnGoal === "p" ? "dg" : "star"); }
  }
  const tgts = eg.sel && mine ? g.moves({ square: eg.sel, verbose: true }).map(m => m.to) : [];
  renderBoard(pos, { el: $("eboard"), o: "w", hl: eg.last, sel: eg.sel, tgts, marks });
  $("eboard").classList.toggle("mine", mine);
  $("eBar").innerHTML = `<button class="btn big" type="button" id="eMap" aria-label="Back to the map">🗺</button>
    <span class="stageicon">${eg.st.icon}</span>${stageDots(pzPlayers(), eg.st)}`;
  $("eMap").onclick = () => { kidTab = "path"; openKids(); };
  $("eMoves").innerHTML = `👣 <b>${eg.moves}</b>`;
  $("eUndo").disabled = !eg.hist.length || !mine;
  $("eUndo").classList.toggle("nudge", !!eg.slip && mine && !!eg.hist.length);   // the win slipped away: ↶ glows
}
function egUserMove(from, to) {
  const g = eg.g;
  if (eg.over || g.turn() !== "w" || !g.moves({ square: from, verbose: true }).some(m => m.to === to)) return false;
  eg.hist.push(g.fen());
  g.move({ from, to, promotion: "q" }); eg.sel = null; eg.last = [from, to]; eg.moves++; sfx("move");
  if (!egEnd()) { egDraw(); const my = eg; setTimeout(() => { if (eg === my) egReply(); }, 450); }
  return true;
}
function egReply() {
  if (eg.over || eg.g.turn() !== "b") return;
  const kind = eg.st.eg, m = kind === "catch" ? cpBotMove(eg.g) : kind === "kp" ? kpBotMove(eg.g) : egBotMove(eg.g);
  eg.g.move(m); eg.last = [m.from, m.to]; sfx("move");
  if (egEnd()) return;
  if (kind === "catch") eg.slip = !cpCatchable(eg.g.fen());
  else if (kind === "kp") eg.slip = kpkProbe(eg.g.fen()) !== KPK_WIN;
  egDraw();
}
function egUndo() {   // takes back your last move and the king's reply
  if (!eg || !eg.hist.length || eg.over || eg.g.turn() !== "w") return;
  eg.g.load(eg.hist.pop()); eg.moves--; eg.last = []; eg.sel = null; eg.undos++; eg.slip = false; egDraw();
}
// mate (or the pawn caught / a safe new queen in the pawn games): ⭐ and one win for the stage; stalemate, a lost
// piece or a pawn game gone wrong: 🤝 (↻ if the running pawn became a queen) and a star of the stage lost (stageLose),
// then a new position by itself
function egEnd() {
  const g = eg.g, kind = eg.st.eg;
  const res = kind === "catch" ? cpResult(g) : kind === "kp" ? kpResult(g)
    : g.in_checkmate() ? "win" : g.in_stalemate() || g.insufficient_material() ? "draw" : null;
  if (res === "win") {
    eg.over = "win";
    const par = EG_PAR[kind], pl = pzPlayers();
    const stars = par ? (eg.moves <= par[0] ? 3 : eg.moves <= par[1] ? 2 : 1) : eg.undos ? 2 : 3;   // pawn games: ⭐⭐⭐ without take-backs
    pl.stages = pl.stages || {};
    const had = stageStars(pl, eg.st.id); pl.stages[eg.st.id] = had + 1;
    kidAddStars(stars); sfx("right");
    if (had + 1 === needOf(eg.st)) setTimeout(() => celebrate("🏅", "trophy"), 1200);
    $("eDone").innerHTML = `<div class="big">${"⭐".repeat(stars)}</div>
      <div class="row"><button class="btn big" type="button" id="eAgain" aria-label="Play again">↻</button>
      <button class="btn primary big" type="button" id="eNext" aria-label="Next">▶</button></div>`;
    $("eDone").hidden = false;
    $("eAgain").onclick = () => egStart(eg.st);
    $("eNext").onclick = egNext;
  } else if (res) {
    eg.over = "draw";
    if (!egReplay) stageLose(pzPlayers(), eg.st);
    const my = eg;
    setTimeout(() => { if (eg !== my) return; $("eDone").innerHTML = `<div class="burst">${res === "loss" ? "↻" : "🤝"}</div>`; $("eDone").hidden = false; }, 700);
    setTimeout(() => { if (eg === my) egStart(my.st); }, 2800);
  } else return false;
  egDraw();
  return true;
}
// after a win: the same stage again, or the next unfinished stage once this one is done (a replay stays put)
function egNext() {
  const pl = pzPlayers(), i = stageCur(pl);
  if (egReplay || stageStars(pl, eg.st.id) < needOf(eg.st) || i < 0) return egStart(eg.st);
  if (STAGES[i].eg) return egStart(STAGES[i]);
  stageGo(STAGES[i]);
}

/* ---- catch the pawn: your king against a black pawn running to promote (its king stays far away) ----
   The bot pushes the pawn one square every move; only when your king stands in front of it does its king move
   (towards the pawn). You win by taking the pawn (or the new queen, if your king is right there). */
const CP_MAX = 25;          // your moves before a gentle restart (a blockade with the black king defending)
function cpStartFen() {
  for (let tries = 0; ; tries++) {
    const pf = FILES[Math.floor(Math.random() * 8)], pr = 4 + Math.floor(Math.random() * 4), ps = pf + pr;   // pawn on rank 4–7
    const pos = { [ps]: "p" }, dist = (a, b) => Math.max(Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])), Math.abs(a[1] - b[1]));
    const bk = kidSq(pr, 8);
    if (dist(bk, ps) < 4 || +bk[1] < pr) continue;        // its king far away and not ahead of the pawn: it can't help
    const wk = kidSq(1, 7);
    if (wk === ps || dist(wk, bk) < 2 || dist(wk, ps) < 2) continue;   // no capture at once
    if (dist(wk, pf + 1) > pr) continue;                    // far outside the pawn's "square": can't be caught (quick test)
    pos[bk] = "k"; pos[wk] = "K";
    if (attacksSq(pos, ps, wk)) continue;                  // not in check from the pawn
    const fen = kidFen(pos, "w"), need = cpCatchable(fen, true);
    // catchable, with a few moves to find; mostly with room to spare, sometimes only just (the "square" rule)
    if (need && need >= 2 && (need <= pr - 2 || Math.random() < .3 || tries > 500)) return fen;
  }
}
// the bot: push the pawn (one square, a new queen), else walk the king towards the pawn
function cpBotMove(g) {
  const ms = g.moves({ verbose: true }), push = ms.find(m => m.piece === "p" && !m.captured && Math.abs(m.from[1] - m.to[1]) === 1 && (!m.promotion || m.promotion === "q"));
  if (push) return push;
  const pos = parseFen(g.fen()), ps = Object.keys(pos).find(q => pos[q] === "p");
  const d = sq => ps ? Math.max(Math.abs(FILES.indexOf(sq[0]) - FILES.indexOf(ps[0])), Math.abs(sq[1] - ps[1])) : 0;
  return ms.filter(m => m.piece === "k").sort((a, b) => d(a.to) - d(b.to))[0] || ms[0];
}
function cpCaught(g) { const b = g.fen().split(" ")[0]; return !/[pq]/.test(b); }
// can you still catch it (you to move)? with count: the fewest moves it takes (0 = no). Exhaustive over your king
// moves against the bot's fixed replies, memoised by position.
function cpCatchable(fen, count = false) {
  const g = new Chess(fen), memo = {};
  const win = d => {                                     // white to move: catch within d moves?
    const key = g.fen().split(" ")[0] + d;
    if (key in memo) return memo[key];
    let ok = false;
    for (const m of g.moves({ verbose: true })) {
      g.move(m);
      if (cpCaught(g)) ok = true;
      else if (d > 1 && !/q/.test(g.fen().split(" ")[0]) && !g.game_over()) {   // a new queen left standing: too late
        g.move(cpBotMove(g));
        ok = !g.game_over() && win(d - 1);
        g.undo();
      }
      g.undo();
      if (ok) break;
    }
    return (memo[key] = ok);
  };
  for (let d = 1; d <= 9; d++) if (win(d)) return count ? d : true;
  return count ? 0 : false;
}
function cpResult(g) {
  if (cpCaught(g)) return "win";
  const b = g.fen().split(" ")[0];
  if (/q/.test(b)) return g.turn() === "w" && g.moves({ verbose: true }).some(m => m.captured === "q") ? null : "loss";   // take the new queen now, or it got away
  if (g.game_over() || eg.moves >= CP_MAX) return "draw";
  return null;
}

/* ---- king + pawn: help your pawn to the star and make a queen; the black king defends as well as it can ----
   Exact results from a small king-and-pawn table built in the browser (kpkBuild: every position with White's king
   and pawn against the lone black king, worked back from the promotions, ~0.2 s once). The bot keeps a draw whenever
   your move let one slip (and ↶ glows); otherwise it heads for the square in front of the pawn. */
const KP_MAX = 40, KPK_WIN = 2, KPK_DRAW = 1;
let kpk = null;
function kpkIdx(wk, bk, p, stm) { return ((((p >> 3) - 1) * 4 + (p & 7)) * 4096 + wk * 64 + bk) * 2 + stm; }   // pawn on files a–d, ranks 2–7
function kpkBuild() {
  if (kpk) return kpk;
  const T = new Uint8Array(24 * 4096 * 2), fx = s => s & 7, ry = s => s >> 3;
  const dist = (a, b) => Math.max(Math.abs(fx(a) - fx(b)), Math.abs(ry(a) - ry(b)));
  const pawnHits = (p, s) => ry(s) === ry(p) + 1 && Math.abs(fx(s) - fx(p)) === 1;
  const kSteps = s => { const o = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const x = fx(s) + dx, y = ry(s) + dy; if ((dx || dy) && x >= 0 && x < 8 && y >= 0 && y < 8) o.push(y * 8 + x); } return o; };
  const STEPS = Array.from({ length: 64 }, (_, s) => kSteps(s));
  // after promoting on q (black to move): the queen is safe and black isn't stalemated
  const qHits = (q, wk, s) => {
    const dx = Math.sign(fx(s) - fx(q)), dy = Math.sign(ry(s) - ry(q));
    if (s === q || !(fx(s) === fx(q) || ry(s) === ry(q) || Math.abs(fx(s) - fx(q)) === Math.abs(ry(s) - ry(q)))) return false;
    for (let x = fx(q) + dx, y = ry(q) + dy; x !== fx(s) || y !== ry(s); x += dx, y += dy) if (y * 8 + x === wk) return false;
    return true;
  };
  const promoWins = (wk, bk, q) => {
    if (bk === q || (dist(bk, q) === 1 && dist(wk, q) !== 1)) return false;
    return qHits(q, wk, bk) || STEPS[bk].some(s => s !== wk && dist(s, wk) > 1 && !qHits(q, wk, s));
  };
  for (let p = 8; p < 56; p++) {
    if (fx(p) > 3) continue;
    for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let stm = 0; stm < 2; stm++) {
      const i = kpkIdx(wk, bk, p, stm);
      if (wk === bk || wk === p || bk === p || dist(wk, bk) < 2 || (stm === 0 && pawnHits(p, bk))) { T[i] = 3; continue; }
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (let p = 8; p < 56; p++) {
      if (fx(p) > 3) continue;
      for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) {
        // White to move
        let i = kpkIdx(wk, bk, p, 0);
        if (!T[i]) {
          let win = false, open = false, any = false;
          for (const s of STEPS[wk]) {
            if (s === p || s === bk || dist(s, bk) < 2) continue;
            any = true; const v = T[kpkIdx(s, bk, p, 1)];
            if (v === KPK_WIN) { win = true; break; } if (!v) open = true;
          }
          const up = p + 8;
          if (!win && up !== wk && up !== bk) {
            any = true;
            if (ry(up) === 7) { if (promoWins(wk, bk, up)) win = true; }
            else { const v = T[kpkIdx(wk, bk, up, 1)]; if (v === KPK_WIN) win = true; else if (!v) open = true;
              if (!win && ry(p) === 1 && p + 16 !== wk && p + 16 !== bk) { const v2 = T[kpkIdx(wk, bk, p + 16, 1)]; if (v2 === KPK_WIN) win = true; else if (!v2) open = true; } }
          }
          if (win) { T[i] = KPK_WIN; changed = true; } else if (!open || !any) { T[i] = KPK_DRAW; changed = true; }
        }
        // Black to move
        i = kpkIdx(wk, bk, p, 1);
        if (!T[i]) {
          let draw = false, open = false, any = false;
          for (const s of STEPS[bk]) {
            if (s === wk || dist(s, wk) < 2 || pawnHits(p, s)) continue;
            any = true;
            if (s === p) { draw = true; break; }             // takes the pawn (it isn't guarded: that square is next to the king)
            const v = T[kpkIdx(wk, s, p, 0)];
            if (v === KPK_DRAW) { draw = true; break; } if (!v) open = true;
          }
          if (draw) { T[i] = KPK_DRAW; changed = true; }
          else if (!any) { T[i] = pawnHits(p, bk) ? KPK_WIN : KPK_DRAW; changed = true; }   // mated by the pawn / stalemate
          else if (!open) { T[i] = KPK_WIN; changed = true; }
        }
      }
    }
  }
  for (let i = 0; i < T.length; i++) if (!T[i]) T[i] = KPK_DRAW;
  return (kpk = T);
}
// KPK_WIN / KPK_DRAW for a position with White's king and pawn against Black's king (0 if it isn't one)
function kpkProbe(fen) {
  const pos = parseFen(fen), stm = fen.split(" ")[1] === "w" ? 0 : 1;
  const sqOf2 = pc => { const q = Object.keys(pos).find(x => pos[x] === pc); return q ? (+q[1] - 1) * 8 + FILES.indexOf(q[0]) : -1; };
  let wk = sqOf2("K"), bk = sqOf2("k"), p = sqOf2("P");
  if (wk < 0 || bk < 0 || p < 0 || Object.keys(pos).length !== 3 || p < 8 || p > 55) return 0;
  if ((p & 7) > 3) { wk ^= 7; bk ^= 7; p ^= 7; }        // mirror to files a–d
  const v = kpkBuild()[kpkIdx(wk, bk, p, stm)];
  return v === 3 ? 0 : v;
}
// starts: a won position (you to move) with a b–g pawn on ranks 2–5, your king on a key square in front of it
// (two ranks ahead, or one for a pawn on the 5th), the black king in front too, and more than one winning first move
function kpStartFen() {
  for (let tries = 0; ; tries++) {
    const pf = 1 + Math.floor(Math.random() * 6), pr = 2 + Math.floor(Math.random() * 4);
    const wf = pf + Math.floor(Math.random() * 3) - 1, wr = pr + (pr === 5 && Math.random() < .5 ? 1 : 2);
    const ps = FILES[pf] + pr, wk = FILES[wf] + wr, bk = kidSq(Math.min(8, wr + 1), 8);
    const pos = { [ps]: "P", [wk]: "K", [bk]: "k" };
    if (Object.keys(pos).length < 3 || attacksSq(pos, wk, bk) || attacksSq(pos, ps, bk)) continue;
    const fen = kidFen(pos, "w");
    if (kpkProbe(fen) !== KPK_WIN) continue;
    const g = new Chess(fen), good = g.moves({ verbose: true }).filter(m => { g.move(m); const v = kpkProbe(g.fen()); g.undo(); return v === KPK_WIN; });
    if (good.length >= 2 || tries > 2000) return fen;
  }
}
// the bot keeps a draw if it can (taking the pawn first); else it goes for the square in front of the pawn
function kpBotMove(g) {
  const ms = g.moves({ verbose: true }), take = ms.find(m => m.captured);
  if (take) return take;
  const pos = parseFen(g.fen()), ps = Object.keys(pos).find(q => pos[q] === "P");
  const front = ps ? ps[0] + Math.min(8, +ps[1] + 1) : null;
  const d = sq => front ? Math.max(Math.abs(FILES.indexOf(sq[0]) - FILES.indexOf(front[0])), Math.abs(sq[1] - front[1])) : 0;
  const score = m => { g.move(m); const v = kpkProbe(g.fen()); g.undo(); return (v === KPK_DRAW ? 100 : 0) - d(m.to) + Math.random() * .5; };
  return ms.map(m => [score(m), m]).sort((a, b) => b[0] - a[0])[0][1];
}
function kpResult(g) {
  const b = g.fen().split(" ")[0];
  if (/Q/.test(b)) {
    if (g.in_stalemate()) return "draw";
    return g.turn() === "b" && g.moves({ verbose: true }).some(m => m.captured) ? null : "win";   // a queen the king can't take
  }
  if (!/P/.test(b) || g.game_over() || eg.moves >= KP_MAX) return "draw";
  return null;
}

/* ---- stickers ---- */
function renderStickers() {
  const pl = pzPlayers(), have = Math.floor((pl.stars || 0) / 10);
  $("kStickers").innerHTML = `<div class="kstat"><span>⭐ <b>${pl.stars || 0}</b></span><span>🏆 <b>${pl.trophies || 0}</b></span></div>
    <div class="stickers">${STICKERS.map((s, i) => `<div class="stk${i < have ? " got" : ""}">${i < have ? s : "?"}</div>`).join("")}</div>`;
}

/* ---- parent view ---- */
const THEME_GROUPS = [
  ["Take a free piece", t => /hangingPiece/.test(t)], ["Save the queen", t => /saveQueen/.test(t)], ["Save a piece", t => /savePiece/.test(t)], ["Give check", t => /giveCheck/.test(t)],
  ["Is it safe to take? (harder)", t => /safeTakeHard/.test(t)], ["Is it safe to take?", t => /safeTake/.test(t)], ["Stop the mate", t => /stopMate/.test(t)],
  ["Promote a pawn", t => /promotion/.test(t)], ["Back-rank mate", t => /backRankMate/.test(t)], ["Mate in 1", t => /mateIn1/.test(t)],
  ["Mate in 2+", t => /mateIn[2-9]/.test(t)], ["Forks", t => /fork/.test(t)], ["Pins & skewers", t => /\bpin\b|skewer/.test(t)],
  ["Discovered attacks", t => /discoveredAttack/.test(t)],
  ["Other tactics", t => true],
];
let pzIndex = null;
function renderParents() {
  const pl = pzPlayers(), h = pl.hist || [];
  pzIndex = pzIndex || Object.fromEntries(GYM.puzzles.map(p => [p[0], p[4]]));
  const solved = h.filter(x => x.r).length;
  // rating after each puzzle (older entries without a stored value are replayed from the start rating)
  const series = []; let r = pl.start || START_RATING[S.player] || 200, n = 0;
  for (const x of h) {
    if (x.ra) r = x.ra;
    else if (!x.h) r = eloStep(r, n, x.pr, x.r);
    n++; series.push({ r, t: x.t, ok: x.r, pr: x.pr });
  }
  const groups = THEME_GROUPS.map(([name]) => ({ name, n: 0, ok: 0 }));
  for (const x of h) { const t = pzIndex[x.id] || ""; const gi = THEME_GROUPS.findIndex(([, f]) => f(t)); groups[gi].n++; groups[gi].ok += x.r; }
  const days = [];
  for (let d = 13; d >= 0; d--) {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - d);
    const next = day.getTime() + 864e5, inDay = h.filter(x => x.t >= day.getTime() && x.t < next);
    days.push({ label: day.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }), n: inDay.length, ok: inDay.filter(x => x.r).length });
  }
  const stageDone = STAGES.filter(st => stageStars(pl, st.id) >= needOf(st)).length;
  const school = SCHOOL.reduce((a, p) => a + ((pl.school || {})[p] || []).reduce((x, y) => x + (y || 0), 0), 0);
  $("kParents").innerHTML = `
    <div class="tiles">
      <div class="tile"><span class="lbl">Puzzle rating</span><b>${Math.round(pl.rating)}</b></div>
      <div class="tile"><span class="lbl">Puzzles played</span><b>${h.length}</b></div>
      <div class="tile"><span class="lbl">Solved</span><b>${h.length ? Math.round(100 * solved / h.length) : 0}%</b></div>
      <div class="tile"><span class="lbl">Learning path</span><b>${stageDone}/${STAGES.length}</b></div>
      <div class="tile"><span class="lbl">Piece school stars</span><b>${school}</b></div>
      <div class="tile" title="Missed puzzles come back a day later, until solved cleanly in two later sessions"><span class="lbl">Missed puzzles to redo</span><b>${Object.values(pl.again || {}).filter(x => x.n < 2).length}</b></div>
      <div class="tile"><span class="lbl">Bots beaten</span><b>${BOTS.filter(b => ((pl.bots || {})[b.id] || {}).w).length}/${BOTS.length}</b></div>
    </div>
    <div class="charts">
      <figure class="chart"><figcaption>Rating after each puzzle</figcaption>${lineChart(series)}</figure>
      <figure class="chart"><figcaption>Puzzles per day, last 2 weeks</figcaption>${dayChart(days)}</figure>
      <figure class="chart wide"><figcaption>Solved by theme</figcaption>${themeChart(groups.filter(g => g.n))}</figure>
      <figure class="chart wide"><figcaption>Games against the bots (won · lost · drawn)</figcaption>
        <div class="hbars">${BOTS.map(b => { const r = (pl.bots || {})[b.id] || { w: 0, l: 0, d: 0 }, n = r.w + r.l + r.d;
          return `<div class="hb" data-tip="${esc(b.name)}: ${r.w} won, ${r.l} lost, ${r.d} drawn"><span class="nm">${b.face} ${esc(b.name)}</span>
            <span class="track"><i style="width:${n ? 100 * r.w / n : 0}%"></i></span><span class="v">${r.w} · ${r.l} · ${r.d}</span></div>`; }).join("")}</div></figure>
    <figure class="chart wide unlock"><figcaption>Unlock levels</figcaption>
      <p class="tiny">To continue where ${esc(pl.name)} is on another device. Tap a learning-path stage to open it: every stage before it counts as finished.</p>
      <div class="ustages">${STAGES.map((st, i) => `<button class="btn" type="button" data-ul="${i}" ${stageOpen(pl, i) ? "disabled" : ""}
        title="${esc(st.name)}" aria-label="Open stage ${i + 1}: ${esc(st.name)}"><span class="stageicon">${st.icon}</span><small>${i + 1}</small></button>`).join("")}</div>
      <p class="tiny">${STAGES.map((st, i) => `${i + 1} ${esc(st.name)}${stageStars(pl, st.id) >= needOf(st) ? " ✓" : stageFree(pl, st) ? " (skipped: was already past it)" : ""}`).join(" · ")}</p>
      <label class="tiny"><input type="checkbox" id="uSchool" ${pl.schoolAll ? "checked" : ""}> Open every piece-school level</label>
    </figure>
    ${window.GYM_KIDS_ONLY ? `<figure class="chart wide"><figcaption>Back up progress</figcaption>
      <p class="tiny">Progress on this site is saved only in this browser. Add the page to the Home Screen so Safari keeps it, and save a backup file now and then (it goes to Files). Restoring merges: nothing already earned here is lost.</p>
      <div class="controls"><button class="btn" type="button" id="uBackup">Save a backup file</button>
        <label class="btn">Restore from a file<input type="file" id="uRestore" accept="application/json,.json" hidden></label></div>
      <p class="tiny" id="uMsg"></p></figure>` : ""}
    </div>
    <p class="tiny">Stars, trophies and stickers are earned in pictures-only mode. Ratings update after every puzzle (not after hinted ones).</p>`;
  wireTips($("kParents"));
  $("kParents").querySelectorAll("[data-ul]").forEach(b => b.onclick = () => {
    const i = +b.dataset.ul;
    if (!confirm(`Open stage ${i + 1} (${STAGES[i].name})? Stages 1–${i} will count as finished (boss gates as beaten).`)) return;
    pl.stages = pl.stages || {};
    STAGES.slice(0, i).forEach(st => { pl.stages[st.id] = Math.max(stageStars(pl, st.id), needOf(st)); });
    save(); renderParents();
  });
  $("uSchool").onchange = ev => { pl.schoolAll = ev.target.checked; save(); };
  if (window.GYM_KIDS_ONLY) wireBackup();
}
// standalone site only: the whole saved state as a file, and back (restore = merge, so nothing earned is lost)
function wireBackup() {
  $("uBackup").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: "application/json" }));
    a.download = `chess-gym-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $("uMsg").textContent = "Backup saved.";
  };
  $("uRestore").onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      if (!o || typeof o !== "object" || !o.players) throw new Error("not a Chess Gym backup");
      merge(o); save(); renderParents();
      $("uMsg").textContent = "Restored.";
    } catch (e) { $("uMsg").textContent = "Couldn't restore that file: " + e.message; }
  };
}
function lineChart(s) {
  if (s.length < 2) return `<p class="empty">A rating line appears after a couple of puzzles.</p>`;
  const W = 520, H = 190, L = 40, R = 12, T = 12, B = 24;
  const lo = Math.floor((Math.min(...s.map(x => x.r)) - 20) / 50) * 50, hi = Math.ceil((Math.max(...s.map(x => x.r)) + 20) / 50) * 50;
  const x = i => L + (W - L - R) * i / (s.length - 1), y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks = []; for (let v = lo; v <= hi; v += Math.max(50, Math.round((hi - lo) / 4 / 50) * 50)) ticks.push(v);
  const d = s.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="svgc" role="img" aria-label="Rating went from ${s[0].r} to ${s[s.length - 1].r}">
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`).join("")}
    <path d="${d}" class="ln"/>
    <circle cx="${x(s.length - 1)}" cy="${y(s[s.length - 1].r)}" r="4.5" class="end"/>
    ${s.map((p, i) => `<rect x="${x(i) - (W - L - R) / s.length / 2}" y="${T}" width="${(W - L - R) / s.length}" height="${H - T - B}" class="hit" data-tip="Puzzle ${i + 1}: ${p.ok ? "solved" : "missed"} (rated ${p.pr}) · rating ${p.r}"/>`).join("")}
  </svg>`;
}
function dayChart(days) {
  const W = 520, H = 190, L = 28, R = 8, T = 12, B = 34, max = Math.max(4, ...days.map(d => d.n));
  const bw = (W - L - R) / days.length, y = v => T + (H - T - B) * (1 - v / max);
  return `<svg viewBox="0 0 ${W} ${H}" class="svgc" role="img" aria-label="Puzzles per day over the last 14 days">
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="grid"/>
    <text x="${L - 6}" y="${y(max) + 4}" class="ax" text-anchor="end">${max}</text>
    ${days.map((d, i) => `${d.n ? `<path d="M${L + i * bw + 3},${y(0)} V${y(d.n) + 4} q0,-4 4,-4 H${L + (i + 1) * bw - 7} q4,0 4,4 V${y(0)} Z" class="bar"/>` : ""}
      ${i % 2 === 0 ? `<text x="${L + i * bw + bw / 2}" y="${H - 14}" class="ax" text-anchor="middle">${esc(d.label)}</text>` : ""}
      <rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" class="hit" data-tip="${esc(d.label)}: ${d.n} puzzle${d.n === 1 ? "" : "s"}, ${d.ok} solved"/>`).join("")}
  </svg>`;
}
function themeChart(g) {
  if (!g.length) return `<p class="empty">Nothing played yet.</p>`;
  return `<div class="hbars">${g.map(x => `<div class="hb" data-tip="${esc(x.name)}: ${x.ok} of ${x.n} solved">
    <span class="nm">${esc(x.name)}</span><span class="track"><i style="width:${100 * x.ok / x.n}%"></i></span><span class="v">${Math.round(100 * x.ok / x.n)}% <small>(${x.n})</small></span></div>`).join("")}</div>`;
}
// chart tooltips: follow the mouse; on touch, a tap shows the tip (it stays until the next tap elsewhere)
function wireTips(root) {
  const tip = $("kTip");
  const show = (el, ev) => {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const x = Math.min(ev.clientX + 12, innerWidth - tip.offsetWidth - 8);
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = (ev.clientY + 12) + "px";
  };
  root.querySelectorAll("[data-tip]").forEach(el => {
    el.addEventListener("pointerenter", ev => { if (ev.pointerType === "mouse") show(el, ev); });
    el.addEventListener("pointermove", ev => { if (ev.pointerType === "mouse") show(el, ev); });
    el.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") tip.hidden = true; });
    el.addEventListener("pointerdown", ev => { if (ev.pointerType !== "mouse") { ev.stopPropagation(); show(el, ev); } });
  });
  if (!wireTips.done) { wireTips.done = true; document.addEventListener("pointerdown", () => { tip.hidden = true; }); }
}

/* ---- the kids' corner screen ---- */
let kidTab = "path", kidsWired = false;
// → = next (next level / next piece / rematch), ← = start the level again
function schoolNext() {
  if (!sc || !sc.done) return;
  $("sDone").hidden = true;
  if (sc.li + 1 < schoolLevels(sc.pc)) return schoolStart(sc.pc, sc.li + 1);
  const next = SCHOOL[(SCHOOL.indexOf(sc.pc) + 1) % SCHOOL.length];
  schoolStart(next, firstOpenLevel(next));
}
document.addEventListener("keydown", ev => {
  if (window.SECTION !== "kids" || ev.target.closest("input, textarea, select")) return;
  if (ev.key === "ArrowRight") {
    if (kidTab === "school" && sc && sc.done) { ev.preventDefault(); schoolNext(); }
    else if (kidTab === "play" && bg && bg.rp) { ev.preventDefault(); rpStep(); }
    else if (kidTab === "play" && bg && bg.over) { ev.preventDefault(); botStart(bg.bot.id, bg.gate); }
    else if (kidTab === "end" && eg && eg.over === "win") { ev.preventDefault(); egNext(); }
  } else if (ev.key === "ArrowLeft" && kidTab === "school" && sc) { ev.preventDefault(); $("sDone").hidden = true; schoolStart(sc.pc, sc.li); }
});
function openKids(sub) {
  if (typeof sub === "string") kidTab = sub;
  if (!pzPlayers().kid && !openKids.picked) {        // opening the corner selects a young player's profile
    const kid = Object.keys(S.players).find(id => S.players[id].kid);
    if (kid) { S.player = kid; save(); }
  }
  openKids.picked = true;
  const pl = pzPlayers();
  if (!kidsWired) {
    kidsWired = true;
    document.querySelectorAll("[data-kt]").forEach(b => b.onclick = () => {
      if (b.dataset.kt === "rated") { pzKidNext = true; return go("puzzles"); }     // 🧩: rating-matched puzzles
      kidTab = b.dataset.kt; openKids();
    });
    $("sboard").addEventListener("pointerdown", ev => {
      const sq = squareAt(ev, $("sboard"), "w");
      if (sq) schoolMove(sq);
    });
    $("eboard").addEventListener("pointerdown", ev => {     // tap your piece, then where it goes (as in the bot games)
      const sq = squareAt(ev, $("eboard"), "w");
      if (!eg || eg.over || eg.g.turn() !== "w" || !sq) return;
      if (eg.sel && eg.sel !== sq && egUserMove(eg.sel, sq)) return;
      const p = eg.g.get(sq); eg.sel = p && p.color === "w" ? sq : null; egDraw();
    });
    $("eUndo").onclick = egUndo;
    let resized = null;     // the map is laid out for its width: draw it again after a turn of the iPad
    addEventListener("resize", () => { clearTimeout(resized); resized = setTimeout(() => { if (window.SECTION === "kids" && kidTab === "path") renderPath(); }, 200); });
    $("kSound").onclick = () => { const p = pzPlayers(); p.sound = !soundOn(); save(); openKids(); if (p.sound) sfx("right"); };
  }
  $("kPlayers").innerHTML = Object.entries(S.players).map(([id, p]) =>
    `<button type="button" data-pl="${id}" aria-pressed="${id === S.player}">${esc(p.name)}</button>`).join("");
  $("kPlayers").querySelectorAll("[data-pl]").forEach(b => b.onclick = () => { S.player = b.dataset.pl; save(); sc = null; bg = null; eg = null; openKids(); });
  $("kSound").textContent = soundOn() ? "🔊" : "🔇";
  $("kStarsTop").innerHTML = `⭐ <b>${pl.stars || 0}</b>`;
  document.querySelectorAll("[data-kt]").forEach(b => b.setAttribute("aria-pressed", b.dataset.kt === (kidTab === "end" ? "path" : kidTab)));
  for (const [t, id] of [["path", "kPath"], ["school", "kSchool"], ["play", "kPlay"], ["end", "kEnd"], ["stickers", "kStickers"], ["parents", "kParents"]]) $(id).hidden = t !== kidTab;
  if (kidTab === "path") renderPath();
  else if (kidTab === "end") { if (!eg || eg.st !== egSt) egStart(egSt); else egDraw(); }
  else if (kidTab === "play") openBots();
  else if (kidTab === "school") { if (!sc) schoolStart("R", firstOpenLevel("R")); else schoolDraw(); }
  else if (kidTab === "stickers") renderStickers();
  else renderParents();
}


/* ================= bots for young players ================= */
// Chess bots are built on chess.js with deliberate weaknesses; Pawn Wars uses its own tiny rules engine.
// Weakest first, and the animal grows with the strength so the child can see which bot is harder; lvl = the paw prints
// on its card and the colour of its ring. The ids are the old names, kept for the stored records (rex was a T-rex, gus
// a pig, cat the cat): rex = the mouse, gus = the cat, cat = the wolf. T-Rex and the Dragon search (botSearch) to
// `depth` plies within `ms`. Pawn Pete plays Pawn Wars, a different game: no level.
const BOTS = [
  { id: "rex", face: "🐭", name: "Muddled Mouse", elo: "~100", think: 500, lvl: 1 },
  { id: "gus", face: "🐱", name: "Greedy Cat", elo: "~300", think: 600, lvl: 2 },
  { id: "cat", face: "🐺", name: "Wily Wolf", elo: "~500", think: 700, lvl: 3 },
  { id: "tiger", face: "🐯", name: "Tactic Tiger", elo: "~800", think: 400, lvl: 4 },
  { id: "dino", face: "🦖", name: "T-Rex", elo: "~1000", think: 250, lvl: 5, depth: 2, ms: 900 },
  { id: "dragon", face: "🐉", name: "Dragon", elo: "~1200", think: 200, lvl: 6, depth: 3, ms: 1800 },
  { id: "pete", face: "🐣", name: "Pawn Pete", elo: "Pawn Wars", think: 500, pawns: true },
];
const BOT_RING = ["#3cb371", "#9acd32", "#f2c230", "#f39c34", "#e8542f", "#b3202a"];   // lvl 1–6: green to red
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
let bg = null;   // {bot, game (chess.js) | pw (pawn wars state), me: 'w'|'b', sel, last, over, hist:[fen…], log, rp, gate}
// gate: the learning-path boss stage this game was started from (a win against the bot clears it)
// log (chess games): every move as {fen before, from, to, me, piece, captured}; rp: the replay after the game {list, k}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function material(g, side) {
  let s = 0;
  for (const row of g.board()) for (const p of row) if (p) s += (p.color === side ? 1 : -1) * VALUE[p.type];
  return s;
}
function mateScore(g) { return g.in_checkmate() ? -1000 : (g.in_draw() || g.in_stalemate()) ? 0 : null; }
// best capture the side to move can make right now (used by Careful Cat and Tactic Tiger to see simple threats)
function bestCaptureGain(g) {
  let best = 0;
  for (const m of g.moves({ verbose: true })) if (m.captured) best = Math.max(best, VALUE[m.captured]);
  return best;
}
function botMove(bot, g) {
  if (bot.depth) return botSearch(bot, g);
  const ms = shuffle(g.moves({ verbose: true })), me = g.turn();
  if (bot.id === "rex") return ms[0];
  // everyone but Rex takes a mate in one
  for (const m of ms) { g.move(m); const mate = g.in_checkmate(); g.undo(); if (mate) return m; }
  if (bot.id === "gus") {
    const caps = ms.filter(m => m.captured).sort((a, b) => VALUE[b.captured] - VALUE[a.captured]);
    return caps[0] || ms[0];
  }
  if (bot.id === "cat") {        // takes what's safe to take and doesn't leave the moved piece hanging
    let best = null, bs = -1e9;
    for (const m of ms) {
      g.move(m);
      const s = (m.captured ? VALUE[m.captured] : 0) - bestCaptureGain(g) * 0.9 + Math.random() * 0.3;
      g.undo();
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }
  // Tiger: two plies (its move, your reply) plus the best capture after that
  let best = null, bs = -1e9;
  for (const m of ms) {
    g.move(m);
    let worst = 1e9;
    const ms2 = g.moves({ verbose: true });
    if (!ms2.length) worst = g.in_checkmate() ? 1000 : 0;
    for (const r of ms2) {
      g.move(r);
      const ms_ = mateScore(g);
      const v = ms_ !== null ? ms_ : material(g, me) + bestCaptureGain(g) * 0.8;   // bot to move: mated = -1000
      g.undo();
      if (v < worst) worst = v;
      if (worst <= bs) break;
    }
    g.undo();
    const s = worst + Math.random() * 0.2;
    if (s > bs) { bs = s; best = m; }
  }
  return best;
}

/* ---- T-Rex and the Dragon: alpha-beta over material and piece placement, captures followed to the end ---- */
// centipawns, from the side to move; pieces like the middle, pawns like to advance, the king hides while queens are on
const CP = { p: 100, n: 310, b: 320, r: 500, q: 900, k: 0 };
function botEval(g) {
  const b = g.board(), me = g.turn();
  let s = 0, queens = 0;
  for (const row of b) for (const p of row) if (p && p.type === "q") queens++;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = b[r][f]; if (!p) continue;
    const rank = p.color === "w" ? 7 - r : r, mid = 7 - Math.abs(3.5 - f) - Math.abs(3.5 - r);   // mid: 0 (corner) – 6 (centre)
    let v = CP[p.type];
    if (p.type === "n") v += mid * 6; else if (p.type === "b") v += mid * 3; else if (p.type === "q") v += mid;
    else if (p.type === "p") v += rank * rank * 1.5 + (f > 1 && f < 6 ? rank * 2 : 0);
    else if (p.type === "k") v += queens ? (rank === 0 ? 20 : -rank * 10) : mid * 5;
    s += p.color === me ? v : -v;
  }
  return s;
}
function botOrder(ms) {   // captures first, the biggest victim by the smallest attacker; promotions too
  const k = m => (m.captured ? 10 * CP[m.captured] - CP[m.piece] + 1000 : 0) + (m.promotion ? 800 : 0);
  return ms.sort((a, b) => k(b) - k(a));
}
// iterative deepening to bot.depth while time (bot.ms) lasts; the move is picked at random among those within 12cp
// of the best of the last finished depth, so games vary
function botSearch(bot, g) {
  const MATE = 1e5, t0 = Date.now(), NOISE = 12;
  let nodes = 0, stop = false;
  const quiet = (alpha, beta, d) => {
    const stand = botEval(g);
    if (stand >= beta || d <= 0) return stand;
    let best = stand;              // fail-soft: a bound never passes for a score (the root compares near-equal moves)
    if (stand > alpha) alpha = stand;
    for (const m of botOrder(g.moves({ verbose: true }).filter(m => m.captured || m.promotion))) {
      g.move(m); const v = -quiet(-beta, -alpha, d - 1); g.undo();
      if (v > best) best = v;
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return best;
  };
  const ab = (depth, alpha, beta, ply) => {
    if ((++nodes & 127) === 0 && Date.now() - t0 > bot.ms) stop = true;
    if (stop) return 0;
    const ms = g.moves({ verbose: true });
    if (!ms.length) return g.in_check() ? -MATE + ply : 0;
    if (depth <= 0) return quiet(alpha, beta, 5);
    let best = -Infinity;
    for (const m of botOrder(ms)) {
      g.move(m); const v = -ab(depth - 1, -beta, -alpha, ply + 1); g.undo();
      if (stop) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };
  let root = botOrder(shuffle(g.moves({ verbose: true }))).map(m => ({ m, v: 0 })), done = null;
  for (let d = 1; d <= bot.depth && !stop; d++) {
    let best = -Infinity;
    for (const r of root) {
      g.move(r.m); r.v = -ab(d - 1, -Infinity, -(best - NOISE), 1); g.undo();
      if (stop) break;
      if (r.v > best) best = r.v;
    }
    if (stop && done) break;
    root.sort((a, b) => b.v - a.v);
    done = root.map(r => ({ ...r }));
  }
  const top = done[0].v, near = done.filter(r => r.v > top - NOISE && Math.abs(top) < MATE / 2);
  return (near.length ? near[Math.floor(Math.random() * near.length)] : done[0]).m;
}

/* ---- Pawn Wars: pawns only; first to reach the last rank wins, and a side with no moves loses ---- */
function pwNew() {
  const b = {}; for (const f of FILES) { b[f + "2"] = "P"; b[f + "7"] = "p"; }
  return { b, turn: "w", ep: null };
}
function pwMoves(s, side = s.turn) {
  const out = [], dir = side === "w" ? 1 : -1, start = side === "w" ? 2 : 7, mine = side === "w" ? "P" : "p", theirs = side === "w" ? "p" : "P";
  for (const [sq, p] of Object.entries(s.b)) {
    if (p !== mine) continue;
    const x = FILES.indexOf(sq[0]), y = +sq[1], y1 = y + dir;
    if (y1 < 1 || y1 > 8) continue;
    const one = FILES[x] + y1;
    if (!s.b[one]) {
      out.push({ from: sq, to: one });
      const two = FILES[x] + (y + 2 * dir);
      if (y === start && !s.b[two]) out.push({ from: sq, to: two, dbl: true });
    }
    for (const dx of [-1, 1]) {
      if (x + dx < 0 || x + dx > 7) continue;
      const t = FILES[x + dx] + y1;
      if (s.b[t] === theirs) out.push({ from: sq, to: t, cap: true });
      else if (s.ep === t) out.push({ from: sq, to: t, cap: true, ep: FILES[x + dx] + y });
    }
  }
  return out;
}
function pwPlay(s, m) {
  const b = { ...s.b }, p = b[m.from];
  delete b[m.from]; if (m.ep) delete b[m.ep];
  b[m.to] = p;
  const ep = m.dbl ? m.to[0] + ((+m.from[1] + +m.to[1]) / 2) : null;
  return { b, turn: s.turn === "w" ? "b" : "w", ep };
}
function pwWinner(s) {
  for (const [sq, p] of Object.entries(s.b)) { if (p === "P" && sq[1] === "8") return "w"; if (p === "p" && sq[1] === "1") return "b"; }
  if (!Object.values(s.b).includes("P")) return "b";
  if (!Object.values(s.b).includes("p")) return "w";
  if (!pwMoves(s).length) return s.turn === "w" ? "b" : "w";
  return null;
}
function pwBot(s) {
  const ms = shuffle(pwMoves(s)), side = s.turn;
  for (const m of ms) if (pwWinner(pwPlay(s, m)) === side) return m;              // promote if it can
  const safe = m => { const n = pwPlay(s, m); return !pwMoves(n).some(r => r.to === m.to); };
  const runner = m => { const n = pwPlay(s, m); return !pwMoves(n).some(r => pwWinner(pwPlay(n, r)) === n.turn); };
  const caps = ms.filter(m => m.cap && runner(m));
  if (caps.length) return caps.find(safe) || caps[0];
  return ms.find(m => safe(m) && runner(m)) || ms.find(runner) || ms[0];
}

/* ---- playing a game ---- */
function botStart(id, gate = null) {
  const bot = BOTS.find(b => b.id === id), pl = pzPlayers();
  const me = (pl.botColor || "w");
  bg = { bot, me, sel: null, last: [], over: null, hist: [], log: [], rp: null, gate };
  if (bot.pawns) bg.pw = pwNew();
  else {
    bg.game = new Chess();
    if (pl.botNoQueen) bg.game.remove(me === "w" ? "d8" : "d1");
  }
  $("bPick").hidden = true; $("bGame").hidden = false; $("bOver").hidden = true;
  botDraw();
  if (botTurn() !== me) setTimeout(botReply, bot.think);
}
function botTurn() { return bg.pw ? bg.pw.turn : bg.game.turn(); }
function botPos() { return bg.pw ? bg.pw.b : parseFen(bg.game.fen()); }
function myTargets(sq) {
  if (bg.pw) return pwMoves(bg.pw).filter(m => m.from === sq).map(m => m.to);
  return bg.game.moves({ square: sq, verbose: true }).map(m => m.to);
}
function dangerMarks() {   // your pieces that are attacked and not defended (or attacked by something cheaper)
  const marks = {};
  if (!bg.game) return marks;
  const pos = parseFen(bg.game.fen()), opp = bg.me === "w" ? "b" : "w";
  if (bg.game.in_check()) { const k = Object.keys(pos).find(q => pos[q] === (bg.game.turn() === "w" ? "K" : "k")); marks[k] = "mk"; }
  if (pzPlayers().botDanger === false) return marks;
  for (const [sq, p] of Object.entries(pos)) {
    if (colorOf(p) !== bg.me || p.toLowerCase() === "k") continue;
    const att = attackersOf(pos, sq, opp);
    if (!att.length) continue;
    const def = attackersOf(pos, sq, bg.me).length, cheapest = Math.min(...att.map(a => VALUE[pos[a].toLowerCase()] || 0));
    if (!def || cheapest < VALUE[p.toLowerCase()]) marks[sq] = "dg";
  }
  return marks;
}
function botDraw() {
  if (bg.rp) return rpDraw();
  const tg = bg.sel && !bg.over && botTurn() === bg.me ? myTargets(bg.sel) : [];
  renderBoard(botPos(), { el: $("gboard"), o: bg.me, hl: bg.last, sel: bg.sel, tgts: tg, marks: bg.over ? {} : dangerMarks() });
  $("gboard").classList.toggle("mine", !bg.over && botTurn() === bg.me);
  const mat = bg.pw ? null : material(bg.game, bg.me);
  $("bFace").innerHTML = `<span class="face">${bg.bot.face}</span>${botTurn() !== bg.me && !bg.over ? `<span class="thinking">…</span>` : ""}`
    + (mat === null ? "" : `<span class="bmat ${mat > 0 ? "up" : mat < 0 ? "down" : ""}" aria-label="Material">${mat > 0 ? "+" + mat : mat < 0 ? "−" + -mat : "="}</span>`);
  $("bUndo").disabled = !bg.hist.length || !!bg.over;
}
function botAfterMove() {
  const pl = pzPlayers();
  let res = null;
  if (bg.pw) { const w = pwWinner(bg.pw); if (w) res = w === bg.me ? "win" : "loss"; }
  else if (bg.game.game_over()) res = bg.game.in_checkmate() ? (bg.game.turn() === bg.me ? "loss" : "win") : "draw";
  if (!res) return false;
  bg.over = res;
  pl.bots = pl.bots || {}; const r = pl.bots[bg.bot.id] = pl.bots[bg.bot.id] || { w: 0, l: 0, d: 0 };
  r[res === "win" ? "w" : res === "loss" ? "l" : "d"]++;
  if (res === "win") {
    const had = pl.stars || 0; pl.stars = had + 3; sfx("trophy");
    if (Math.floor(pl.stars / 10) > Math.floor(had / 10)) celebrate(STICKERS[(Math.floor(pl.stars / 10) - 1) % STICKERS.length], "sticker");
    const gate = gateWin(pl, bg.bot.id, bg.gate); if (gate) bg.gate = gate;      // a boss gate on the learning path is beaten
  } else if (res === "loss") sfx("wrong"); else sfx("right");
  save();
  botOverShow();
  botDraw();
  return true;
}
// the game-over panel: result, then ↻ rematch, 🤖 another bot, 🔍 what did you miss? (a ⭐ instead once nothing was missed);
// a boss game from the learning path adds 🗺 back to the map, and ▶ on to the next stage once the boss is beaten
function botOverShow(clean = false) {
  const res = bg.over, beat = bg.gate && stageStars(pzPlayers(), bg.gate.id) >= needOf(bg.gate);
  $("bOver").innerHTML = `<div class="burst">${clean ? "⭐" : res === "win" ? "🏆" : res === "loss" ? bg.bot.face : "🤝"}</div>
    ${res === "win" && !clean ? `<div class="big">⭐ +3</div>` : ""}
    <div class="row">${beat ? `<button class="btn primary big" type="button" id="bGateNext" aria-label="Next stage">▶</button>` : ""}
    <button class="btn${beat ? "" : " primary"} big" type="button" id="bAgain" aria-label="Play again">↻</button>
    ${bg.gate ? `<button class="btn big" type="button" id="bGateMap" aria-label="Back to the map">🗺</button>` : `<button class="btn big" type="button" id="bPickAgain" aria-label="Choose a bot">🤖</button>`}
    ${bg.game && !clean ? `<button class="btn big" type="button" id="bReview" aria-label="What did I miss?">🔍</button>` : ""}</div>`;
  $("bOver").hidden = false;
  $("bAgain").onclick = () => botStart(bg.bot.id, bg.gate);
  if ($("bGateNext")) $("bGateNext").onclick = () => { bg = null; gateNext(); };
  if ($("bGateMap")) $("bGateMap").onclick = () => { bg = null; kidTab = "path"; openKids(); };
  if ($("bPickAgain")) $("bPickAgain").onclick = () => { bg = null; renderBots(); };
  if ($("bReview")) $("bReview").onclick = rpStart;
}
function botReply() {
  if (!bg || bg.over || botTurn() === bg.me) return;
  if (bg.pw) { const m = pwBot(bg.pw); bg.pw = pwPlay(bg.pw, m); bg.last = [m.from, m.to]; }
  else { const m = botMove(bg.bot, bg.game); botLog(m, false); bg.game.move(m); bg.last = [m.from, m.to]; }
  sfx("move");
  if (!botAfterMove()) botDraw();
}
function botUserMove(from, to) {
  if (!bg || bg.over || botTurn() !== bg.me || !myTargets(from).includes(to)) return false;
  bg.hist.push(bg.pw ? JSON.stringify(bg.pw) : bg.game.fen());
  if (bg.pw) bg.pw = pwPlay(bg.pw, pwMoves(bg.pw).find(m => m.from === from && m.to === to));
  else botLog(bg.game.move({ from, to, promotion: "q" }), true, bg.hist[bg.hist.length - 1]);
  bg.sel = null; bg.last = [from, to]; sfx("move");
  if (!botAfterMove()) { botDraw(); setTimeout(botReply, bg.bot.think); }
  return true;
}
function botUndo() {   // takes back your last move and the bot's reply
  if (!bg || !bg.hist.length || bg.over || botTurn() !== bg.me) return;
  const prev = bg.hist.pop();
  if (bg.pw) bg.pw = JSON.parse(prev);
  else { bg.game.load(prev); bg.log.length = Math.max(0, bg.log.map(x => x.fen).lastIndexOf(prev)); }
  bg.last = []; bg.sel = null; botDraw();
}
function botLog(m, me, fen = bg.game.fen()) { bg.log.push({ fen, from: m.from, to: m.to, me, piece: m.piece, captured: m.captured }); }

/* ---- after a game, "what did you miss?": pieces you left hanging that the bot took, free pieces you didn't take ---- */
// a move's material result for its player: what it takes (or a new queen), minus the most the other side can then win
// (a capture it can make, less the piece it loses if you can take back on that square); mate = 100
function rpGain(m) { return /#$/.test(m.san) ? 100 : (m.captured ? VALUE[m.captured] : 0) + (m.promotion ? 8 : 0); }   // the most a move can score
function rpScore(g, m) {
  if (/#$/.test(m.san)) return 100;
  g.move(m);
  let worst = 0;
  for (const r of g.moves({ verbose: true })) {
    if (!r.captured) continue;
    g.move(r); const back = g.moves({ verbose: true }).some(x => x.to === r.to); g.undo();
    worst = Math.max(worst, VALUE[r.captured] - (back ? VALUE[r.piece] : 0));
  }
  g.undo();
  return rpGain(m) - worst;
}
function rpMateNext(g, m) {   // would this move allow a mate in one?
  g.move(m);
  const bad = g.moves({ verbose: true }).some(r => { g.move(r); const x = g.in_checkmate(); g.undo(); return x; });
  g.undo();
  return bad;
}
// your moves that were at least a minor piece worse than the best one, when the bot then took the piece (lost) or
// the better move takes a free piece (free); at most 5, the biggest, in game order.
// Moves are tried best-first by what they could at most win, so most of them never need scoring.
function rpMoments(log) {
  const out = [];
  log.forEach((x, i) => {
    if (!x.me) return;
    const g = new Chess(x.fen), ms = g.moves({ verbose: true }).sort((a, b) => rpGain(b) - rpGain(a));
    const mine = ms.find(m => m.from === x.from && m.to === x.to);
    if (!mine) return;
    const act = rpScore(g, mine);
    if (act >= 100) return;
    let best = null;
    for (const m of ms) {
      if (rpGain(m) < act + 3 || (best && rpGain(m) <= best[0])) break;
      const s = rpScore(g, m);
      if (s >= act + 3 && (!best || s > best[0]) && (s >= 100 || !rpMateNext(g, m))) best = [s, m];
    }
    if (!best) return;
    const reply = log[i + 1];
    let kind = null;
    if (reply && !reply.me && reply.captured) {          // the bot took something: was it a real loss (≥ 3)?
      const h = new Chess(x.fen); h.move({ from: x.from, to: x.to, promotion: "q" }); h.move({ from: reply.from, to: reply.to, promotion: "q" });
      const back = h.moves({ verbose: true }).some(m => m.to === reply.to);
      if (VALUE[reply.captured] - (back ? VALUE[reply.piece] : 0) >= 3) kind = "lost";
    }
    if (!kind && best[1].captured && best[0] >= 3 && best[0] < 100) kind = "free";
    if (!kind) return;
    out.push({ i, kind, fen: x.fen, mine: x.from + x.to, took: kind === "lost" ? reply.from + reply.to : null,
               best: best[1].from + best[1].to, gap: best[0] - act,
               at: kind === "lost" ? (reply.to === x.to ? x.from : reply.to) : best[1].to });
  });
  return out.sort((a, b) => b.gap - a.gap).slice(0, 5).sort((a, b) => a.i - b.i);
}
function rpStart() {
  const list = rpMoments(bg.log || []);
  if (!list.length) { sfx("star"); return botOverShow(true); }     // nothing missed: a happy ⭐
  bg.rp = { list, k: 0 };
  $("bOver").hidden = true; rpDraw();
}
// one moment: the position before your move, red = what happened (your move, and the bot's capture), then green = better
function rpDraw() {
  const r = bg.rp, x = r.list[r.k], red = [[x.mine, "red"], ...(x.took ? [[x.took, "red"]] : [])];
  const marks = { [x.at]: x.kind === "lost" ? "dg" : "esc" };
  renderBoard(parseFen(x.fen), { el: $("gboard"), o: bg.me, marks, arrows: red });
  const my = x; clearTimeout(rpDraw.t);
  rpDraw.t = setTimeout(() => { if (bg && bg.rp && bg.rp.list[bg.rp.k] === my) renderBoard(parseFen(x.fen), { el: $("gboard"), o: bg.me, marks, arrows: [...red, [x.best, "green"]] }); }, 1100);
  $("gboard").classList.remove("mine");
  $("bFace").innerHTML = `<span class="face">🔍</span><span class="dots">${r.list.map((_, i) => `<i class="${i <= r.k ? "on" : ""}">★</i>`).join("")}</span>
    <button class="btn primary big" type="button" id="rpNext" aria-label="Next">▶</button>`;
  $("rpNext").onclick = rpStep;
  $("bUndo").disabled = true;
}
function rpStep() {   // ▶: the next moment; after the last one, back to the game-over panel
  if (!bg || !bg.rp) return;
  if (++bg.rp.k < bg.rp.list.length) return rpDraw();
  bg.rp = null; clearTimeout(rpDraw.t); botOverShow(); botDraw();
}
// a bot's card: its face in a ring of its strength's colour, paw prints for the level, its 🏆 wins. Pawn Wars bots sit
// apart, below a row of pawns, with a white-and-black pawn badge instead of paws: a different game, not the ladder
function botCard(b) {
  const r = (pzPlayers().bots || {})[b.id] || { w: 0, l: 0, d: 0 };
  return `<button type="button" class="bot${r.w ? " beaten" : ""}${b.pawns ? " pw" : ""}" data-bot="${b.id}" aria-label="${b.name}" style="--ring:${b.lvl ? BOT_RING[b.lvl - 1] : "var(--line)"};--lv:${b.lvl || 3}">
    <span class="face">${b.face}</span>
    ${b.lvl ? `<span class="paws" aria-hidden="true">${"🐾".repeat(b.lvl)}</span>` : `<span class="pawnbadge" aria-hidden="true"><span class="pc wP"></span><span class="pc bP"></span></span>`}
    <span class="wins">${r.w ? "🏆".repeat(Math.min(r.w, 3)) : "&nbsp;"}</span></button>`;
}
function renderBots() {
  const pl = pzPlayers();
  $("bPick").hidden = false; $("bGame").hidden = true;
  $("bPick").innerHTML = `<div class="botopts">
      <button type="button" class="opt" id="bColor" aria-label="Play as ${pl.botColor === "b" ? "Black" : "White"}"><span class="pc ${pl.botColor === "b" ? "b" : "w"}K"></span></button>
      <button type="button" class="opt" id="bDanger" aria-pressed="${pl.botDanger !== false}" aria-label="Show my pieces in danger">👁</button>
      <button type="button" class="opt" id="bNoQ" aria-pressed="${!!pl.botNoQueen}" aria-label="Bot plays without its queen"><span class="pc bQ"></span><b>✕</b></button>
    </div>
    <div class="bots">${BOTS.filter(b => !b.pawns).map(botCard).join("")}</div>
    <div class="botsep" aria-hidden="true"><span class="pc wP"></span><span class="pc bP"></span></div>
    <div class="bots pawnbots">${BOTS.filter(b => b.pawns).map(botCard).join("")}</div>`;
  $("bPick").querySelectorAll("[data-bot]").forEach(b => b.onclick = () => botStart(b.dataset.bot));
  $("bColor").onclick = () => { pl.botColor = pl.botColor === "b" ? "w" : "b"; save(); renderBots(); };
  $("bDanger").onclick = () => { pl.botDanger = pl.botDanger === false; save(); renderBots(); };
  $("bNoQ").onclick = () => { pl.botNoQueen = !pl.botNoQueen; save(); renderBots(); };
}
let botsWired = false;
function openBots() {
  if (!botsWired) {
    botsWired = true;
    const bd = $("gboard");
    bd.addEventListener("pointerdown", ev => {
      if (!bg || bg.over || botTurn() !== bg.me) return;
      const sq = squareAt(ev, bd, bg.me); if (!sq) return;
      const p = botPos()[sq];
      if (bg.sel && bg.sel !== sq && botUserMove(bg.sel, sq)) return;
      bg.sel = p && colorOf(p) === bg.me ? sq : null; botDraw();
    });
    $("bUndo").onclick = botUndo;
    $("bQuit").onclick = () => { bg = null; renderBots(); };
  }
  if (bg) { $("bPick").hidden = true; $("bGame").hidden = false; botDraw(); } else renderBots();
}

/* ================= coach: your own games vs the repertoire, timed answers, playing out the plan ================= */

/* ---- your games (data/mygames.js, made offline by mygames.py and resolved to node ids by build.py) ---- */
let MYG = {};             // node index -> {played: [records], n, last (ms)} for positions you got wrong in real games
function myGamesOf(oid) { const g = window.GYM && GYM.mygames; return g && g.openings ? g.openings[oid] : null; }
// sound = what the trainer itself would pass: a listed alternative, or an engine-sound move (mv row ok flag)
function mgSound(m) {
  if (m.kind === "also") return true;
  const row = (N[m.node].mv || []).find(x => x[1] === m.played);
  return !!(row && row[3]) && !(N[m.node].wrong || {})[row[0]];
}
function useMyGames() {   // called by useOpening
  MYG = {};
  if ($("gamesNew")) setTimeout(markGamesTab, 0);           // unseen count on the Game list tab
  const g = myGamesOf(DATA.id); if (!g) return;
  for (const m of g.mine) {
    if (m.node === undefined || mgSound(m)) continue;                  // sound alternatives aren't mistakes
    const x = MYG[m.node] = MYG[m.node] || { played: [], n: 0, last: 0 };
    x.played.push(m); x.n += m.n; x.last = Math.max(x.last, Date.parse(m.last) || 0);
  }
}
// a position you got wrong in a real game stays in Review until you answer it right after that game
function myGamesDue(i) { const x = MYG[i], r = recOf(i); return !!x && !(r && r.last === "ok" && r.t > x.last); }
function myGamesNote(i) {
  const x = MYG[i]; if (!x) return "";
  const p = x.played.slice(0, 3).map(m => `<b>${ME === "b" ? "…" : ""}${esc(m.played)}</b> (${m.n}×)`).join(", ");
  return `In your own games you played ${p} here, last on ${esc(new Date(x.last).toLocaleDateString())}.`;
}
function renderMine() {
  const g = myGamesOf(DATA.id), el = $("mine2");
  if (!g) { el.innerHTML = `<p class="empty">No games analysed yet. In Claude Code, ask to "refresh my games": Claude downloads your Lichess games and compares them with this repertoire.</p>`; return; }
  const all = GYM.mygames, when = d => d ? esc(new Date(d).toLocaleDateString()) : "";
  const pos = i => `${esc(N[i].line)}`;
  const mine = g.mine.filter(m => m.node !== undefined && !mgSound(m)).slice(0, 20);
  const sound = g.mine.filter(m => m.node !== undefined && mgSound(m)).slice(0, 10);
  const theirs = g.theirs.filter(t => t.node !== undefined).slice(0, 20);
  $("mine2").innerHTML = `
    <p class="lede">${g.games} of your games (up to ${when(all.updated)}) reached this repertoire, and stayed in it for ${g.avg_depth} of your moves on average.
      Mistakes below are in your Review until you get them right here.</p>
    <h3>Where you left the repertoire</h3>
    <div class="misses">${mine.map(m => `<div class="miss"><span class="what"><span>${pos(m.node)}</span>
        <span>You played <span class="bad">${ME === "b" ? "…" : ""}${esc(m.played)}</span> ${m.n}×</span><span>Learn <span class="good">${lmNo(moveNo(m.node), N[m.node].s)}</span></span></span>
        <span class="ln">Scored ${Math.round(100 * m.score)}% in those games · last ${when(m.last)} ${m.games.slice(0, 2).map(id => `<a href="https://lichess.org/${encodeURIComponent(id)}" target="_blank" rel="noopener">game</a>`).join(" ")}</span>
        <button class="btn" data-mfix="${m.node}">Practice</button></div>`).join("") || `<p class="empty">None: you played the repertoire moves every time.</p>`}</div>
    ${sound.length ? `<h3>Playable alternatives you chose</h3><p class="tiny">Sound moves, just not the ones this repertoire teaches (engine difference to the move to learn): ${sound.map(m => `${pos(m.node)} <b>${ME === "b" ? "…" : ""}${esc(m.played)}</b> ${m.n}×, ${mgVerdict(m).replace(/^Playable: /, "")}`).join("; ")}.</p>` : ""}
    <h3>Where opponents surprised you</h3>
    <p class="tiny">Moves your opponents played that the repertoire doesn't cover yet. Add one and Claude will analyse it when you ask to "add the lines I requested".</p>
    <div class="misses">${theirs.map((t, k) => `<div class="miss"><span class="what"><span>${pos(t.node)} ${lmNo(moveNo(t.node), N[t.node].s)}</span>
        <span>${OPP} played <span class="bad">${esc(t.san)}</span> ${t.n}×</span></span>
        <span class="ln">You scored ${Math.round(100 * t.score)}% · last ${when(t.last)}</span>
        <button class="btn" data-mreq="${k}">Add to requests</button></div>`).join("") || `<p class="empty">Nothing yet.</p>`}</div>`;
  el.querySelectorAll("[data-mfix]").forEach(b => b.onclick = () => { mode = "review"; markTabs(); showTrainer(); startReview(+b.dataset.mfix); });
  el.querySelectorAll("[data-mreq]").forEach(b => b.onclick = () => {
    const t = theirs[+b.dataset.mreq], n = N[t.node];
    const line = `[${DATA.name}] ` + sanLine([...n.pre, n.s, t.san]);
    if (!(S.req || []).some(r => r.line === line)) { const r = { line, t: Date.now() }; (S.req = S.req || []).push(r); save(); pushReq(r); renderReqs(); }
    b.textContent = "Added"; b.disabled = true;
  });
}
// how the trainer grades a move you played instead of the move to learn, with the engine's difference (depth 12)
function mgVerdict(m) {
  const n = m.node !== undefined ? N[m.node] : null, row = n && (n.mv || []).find(x => x[1] === m.played), main = n && (n.mv || []).find(x => x[0] === n.m);
  const grade = m.kind === "also" || (row && row[3] && !(n.wrong || {})[row[0]]) ? "Playable" : "Wrong";
  if (!row || !main) return grade;
  const d = row[2] - main[2], p = (Math.abs(d) / 100).toFixed(2), learn = lmNo(moveNo(m.node), n.s);
  return `${grade}: ${d > 5 ? `${p} pawns worse than ${learn}` : d < -5 ? `the engine rates it ${p} pawns better than ${learn}` : `about equal to ${learn}`}`;
}
/* ---- the chronological game list: every game in this opening, newest first; opening one marks it seen ---- */
let gamesFilter = "all";
function gamesSeen(id) { return !!(S.seenGames || {})[id]; }
function gamesUnseen() { const g = myGamesOf(DATA.id); return g && g.list ? [...g.list, ...(GYM.mygames.other || [])].filter(x => !gamesSeen(x.id)).length : 0; }
function markGamesTab() { const n = gamesUnseen(); $("gamesNew").hidden = !n; $("gamesNew").textContent = n; }
function renderGames() {
  const g = myGamesOf(DATA.id), el = $("games2");
  gaView = null;
  markGamesTab();
  if (!g || !g.list) { el.innerHTML = `<p class="empty">No games yet. In Claude Code, ask to "refresh my games".</p>`; return; }
  const list = g.list.filter(x => gamesFilter === "all" || (gamesFilter === "unseen" ? !gamesSeen(x.id) : gamesFilter === "mine" ? x.left === "me" : x.left === "opp"));
  const other = (GYM.mygames.other || []).filter(x => gamesFilter === "all" || (gamesFilter === "unseen" && !gamesSeen(x.id)));
  const nAn = g.list.filter(x => x.an).length + (GYM.mygames.other || []).filter(x => x.an).length;
  const res = x => x.score === 1 ? ["w", "1-0"] : x.score === 0 ? ["l", "0-1"] : ["d", "½"];
  const where = x => {
    const no = x.ply ? Math.ceil(x.ply / 2) + (x.ply % 2 ? "." : "…") : "";
    if (x.left === "me") return `you left the repertoire: <span class="bad">${no}${esc(x.played)}</span>, learn <span class="good">${no}${esc(x.learn)}</span> (${mgVerdict(x)})`;
    if (x.left === "opp") return `${OPP} left the repertoire: <span class="bad">${no}${esc(x.played)}</span> (not covered yet)`;
    return x.plies <= 2 * x.depth + 2 ? `the game ended while still in the repertoire (after ${Math.ceil(x.plies / 2)} moves)`
      : `stayed in the repertoire until the prepared line ended (${x.depth} of your moves)`;
  };
  const row = (x, ln) => { const [c, t] = res(x), seen = gamesSeen(x.id);
    return `<div class="grow${seen ? "" : " new"}">
        <span class="res ${c}">${t}</span>
        <span class="who">${seen ? "" : `<span class="dot" title="Not seen yet"></span>`}${esc(x.date)} · ${esc(x.speed)} · vs <b>${esc(x.opp)}</b> (${esc(x.opp_elo)}) · you ${esc(x.my_elo)}${x.color ? ` as ${x.color === "w" ? "White" : "Black"}` : ""}</span>
        <span class="acts">${x.an ? `<button class="btn primary" data-gan="${esc(x.id)}">Analyse</button>` : ""}
          <a class="btn" href="https://lichess.org/${encodeURIComponent(x.id)}${x.ply ? "#" + x.ply : ""}" target="_blank" rel="noopener" data-gopen="${esc(x.id)}">Open game</a>
          ${x.node !== undefined && x.left === "me" ? `<button class="btn" data-gfix="${x.node}">Practice</button>` : ""}
          <button class="btn" data-gseen="${esc(x.id)}">${seen ? "Mark unseen" : "Mark seen"}</button></span>
        <span class="ln">${ln}</span></div>`; };
  const f = (k, t) => `<button type="button" data-gf="${k}" aria-pressed="${gamesFilter === k}">${t}</button>`;
  el.innerHTML = `<div class="head" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div class="seg">${f("all", `All ${g.list.length}`)}${f("unseen", `Unseen ${gamesUnseen()}`)}${f("mine", "You left")}${f("opp", `${OPP} left`)}</div>
      <button class="btn" id="gAllSeen">Mark all as seen</button></div>
    <p class="tiny">${nAn ? `Games from ${gaSinceTxt()} on have a move-by-move analysis: <b>Analyse</b> shows your inaccuracies, mistakes and blunders with the better move.`
      : `Move-by-move analysis starts with games from ${gaSinceTxt()}: from then on, each game gets an <b>Analyse</b> button after "refresh my games".`}</p>
    <div class="glist">${list.slice(0, 300).map(x => row(x, `${esc(x.start)} … · ${where(x)}`)).join("") || `<p class="empty">No games here.</p>`}</div>
    ${gamesFilter === "all" || gamesFilter === "unseen" ? `<h3>Other games (other openings, from ${gaSinceTxt()})</h3>
    <div class="glist" id="gOther">${other.map(x => row(x, `${esc(x.eco)} ${esc(x.opening)} · ${esc(x.start)} …`)).join("") || `<p class="empty">None${gamesFilter === "unseen" ? " unseen" : " yet"}.</p>`}</div>` : ""}`;
  const setSeen = (id, on) => { S.seenGames = S.seenGames || {}; if (on) S.seenGames[id] = Date.now(); else delete S.seenGames[id]; save(); };
  el.querySelectorAll("[data-gf]").forEach(b => b.onclick = () => { gamesFilter = b.dataset.gf; renderGames(); });
  el.querySelectorAll("[data-gopen]").forEach(a => a.addEventListener("click", () => { setSeen(a.dataset.gopen, true); setTimeout(renderGames, 50); }));
  el.querySelectorAll("[data-gseen]").forEach(b => b.onclick = () => { setSeen(b.dataset.gseen, !gamesSeen(b.dataset.gseen)); renderGames(); });
  el.querySelectorAll("[data-gfix]").forEach(b => b.onclick = () => { mode = "review"; markTabs(); showTrainer(); startReview(+b.dataset.gfix); });
  el.querySelectorAll("[data-gan]").forEach(b => b.onclick = () => gaOpen(b.dataset.gan));
  $("gAllSeen").onclick = () => { S.seenGames = S.seenGames || {}; [...g.list, ...(GYM.mygames.other || [])].forEach(x => { S.seenGames[x.id] = S.seenGames[x.id] || Date.now(); }); save(); renderGames(); };
}
function showTrainer() { $("mineView").hidden = true; $("gamesView").hidden = true; $("ideasView").hidden = true; $("oTrainer").hidden = false; }

/* ---- timed answers (blitz pressure): the move must come within S.timed seconds, or it counts as a miss ---- */
let tmRaf = null;
function timedStart() {
  timedStop();
  const secs = S.timed || 0;
  if (!secs || phase !== "black" || (lesson && lesson.phase !== "test")) return;   // not in walkthroughs
  const t0 = performance.now(), ms = secs * 1000;
  $("tbar").hidden = false;
  const tick = now => {
    const left = 1 - (now - t0) / ms;
    $("tbarFill").style.width = Math.max(0, 100 * left) + "%";
    if (left > 0) tmRaf = requestAnimationFrame(tick); else { tmRaf = null; timedOut(); }
  };
  tmRaf = requestAnimationFrame(tick);
}
function timedStop() { if (tmRaf) cancelAnimationFrame(tmRaf); tmRaf = null; const b = $("tbar"); if (b) b.hidden = true; }
function timedOut() {
  if (phase !== "black") return;
  timedStop();
  showFail(cur, { san: null, text: `Time's up (${S.timed} s). In a blitz game this move has to come quicker, so it goes back into Review.` }, null);
}
$("bTimed").value = String(S.timed || 0);
$("bTimed").onchange = () => { S.timed = +$("bTimed").value; save(); if (phase === "black") timedStart(); };

/* ---- play out the plan: from a line's last position, against Stockfish (Tactic Tiger if the engine can't load) ---- */
const SF_URL = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
const PO_MOVES = 15, PO_SKILL = 8, PO_SLIP = 120;   // your moves per game, engine skill (0–20, ~club level), a slip in cp
let sfReady = null, sfQueue = Promise.resolve(), po = null;
function sfEngine() {
  if (sfReady) return sfReady;
  sfReady = new Promise((ok, fail) => {
    try {
      const w = new Worker(URL.createObjectURL(new Blob([`importScripts("${SF_URL}")`], { type: "text/javascript" })));
      const wait = window.SF_START_MS ?? 10000;          // tests set 0 (no timeout): headless virtual time jumps ahead
      const to = wait ? setTimeout(() => fail(new Error("the engine didn't start")), wait) : null;
      w.onmessage = e => { if (String(e.data).startsWith("uciok")) { clearTimeout(to); ok(w); } };
      w.onerror = () => { clearTimeout(to); fail(new Error("the engine couldn't load here")); };
      w.postMessage("uci");
    } catch (e) { fail(e); }
  });
  sfReady.catch(e => console.error(e));
  return sfReady;
}
// one search at a time; resolves {best (uci), score (centipawns for the side to move)}
function sfSearch(fen, { depth = 11, skill = 20, movetime = 0 } = {}) {
  const run = () => sfEngine().then(w => new Promise(ok => {
    let score = 0;
    w.onmessage = e => {
      const s = String(e.data), m = s.match(/score (cp|mate) (-?\d+)/);
      if (m) score = m[1] === "cp" ? +m[2] : (+m[2] > 0 ? 10000 : -10000);
      if (s.startsWith("bestmove")) ok({ best: s.split(" ")[1], score });
    };
    w.postMessage(`setoption name Skill Level value ${skill}`);
    w.postMessage("position fen " + fen);
    w.postMessage(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
  }));
  return (sfQueue = sfQueue.then(run, run));
}
const poCp = cp => (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);
function poSan(fen, uci) { const g = new Chess(fen); const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" }); return m ? m.san : uci; }
function startPlayout(i) {
  timedStop(); resetLine();
  const n = N[i], g = new Chess(n.fen); g.move({ from: n.m.slice(0, 2), to: n.m.slice(2, 4), promotion: n.m[4] || "q" });
  po = { id: Date.now(), node: i, g, mine: 0, slips: [], engine: true, before: null, start: null };
  hist = histFromPre([...n.pre, n.s]);
  phase = "wait"; pos = parseFen(g.fen()); lastMove = [n.m.slice(0, 2), n.m.slice(2, 4)];
  $("idea").innerHTML = `<span class="who">Play it out</span><span>${esc(n.plan || "")}</span>`;
  setState("Play it out");
  setCard("done", `<p class="text">Play ${PO_MOVES} moves from here against the engine (club strength), following the plan above. Afterwards you see which of your moves slipped and what was better.</p>
    <div class="controls"><button class="btn" id="poStop">Stop</button></div><p class="sub" id="poMsg">Starting the engine…</p>`);
  $("poStop").onclick = () => poEnd();
  $("bNext").hidden = true;
  renderMoves(); draw();
  const id = po.id;
  sfSearch(g.fen(), { depth: 11 }).then(r => { if (po && po.id === id) { po.start = -r.score; poOpp(); } })
    .catch(() => { if (po && po.id === id) { po.engine = false; $("poMsg").textContent = "The engine couldn't load here, so Tactic Tiger plays and there's no move review."; poOpp(); } });
}
function poBoard(u) {
  const g = po.g;
  hist.push({ san: poSan(g.fen(), u), side: g.turn(), no: +g.fen().split(" ")[5] });
  g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" });
  pos = parseFen(g.fen()); lastMove = [u.slice(0, 2), u.slice(2, 4)];
  sfx("move"); renderMoves(); draw();
}
function poOpp() {
  const id = po.id, g = po.g;
  if (g.game_over() || po.mine >= PO_MOVES) return poEnd();
  phase = "wait"; setState(`${OPP} is thinking…`);
  const reply = po.engine ? sfSearch(g.fen(), { skill: PO_SKILL, movetime: 400 }).then(r => r.best)
    : Promise.resolve().then(() => { const m = botMove(BOTS.find(b => b.id === "tiger") || BOTS[BOTS.length - 1], g); return m.from + m.to + (m.promotion || ""); });
  reply.then(u => {
    if (!po || po.id !== id) return;
    poBoard(u);
    if (g.game_over()) return poEnd();
    phase = "play"; setState(`Your move (${po.mine + 1} of ${PO_MOVES})`); draw();
    if (po.engine) po.before = { fen: g.fen(), r: sfSearch(g.fen(), { depth: 11 }) };   // think along while you think
  });
}
function poMove(u) {
  if (!po || phase !== "play" || !u) return;
  const id = po.id, before = po.before, fen = po.g.fen();
  poBoard(u); po.mine++;
  if (po.engine && before) {
    Promise.all([before.r, sfSearch(po.g.fen(), { depth: 11 })]).then(([b, a]) => {
      if (!po || po.id !== id) return;
      const drop = b.score - (-a.score);
      if (drop >= PO_SLIP && b.best !== u) po.slips.push({ no: +fen.split(" ")[5], played: poSan(fen, u), best: poSan(fen, b.best), drop, fen });
      po.last = -a.score;
    });
  }
  poOpp();
}
function poEnd() {
  if (!po) return;
  const p = po, g = p.g, id = p.id;
  phase = "done"; setState("Play-out finished", "pass");
  const res = g.in_checkmate() ? (g.turn() === ME ? "You got mated." : "You gave mate!") : g.in_draw() ? "It ended in a draw." : "";
  const done = final => {
    if (!po || po.id !== id) return;
    const slips = p.slips.sort((a, b) => b.drop - a.drop).slice(0, 4);
    setCard(slips.length ? "alt" : "pass", `<div class="head"><span class="tag ${slips.length ? "alt" : "pass"}">Play-out</span></div>
      <p class="text">${res} ${p.engine && p.start !== null && final !== null ? `The position went from ${poCp(p.start)} to ${poCp(final)} for you over ${p.mine} moves.` : ""}</p>
      ${p.engine ? (slips.length ? `<div class="plan"><span class="lbl">Where it slipped</span>${slips.map(s =>
        `<p class="text">Move ${s.no}: you played <span class="bad">${esc(s.played)}</span>, better was <span class="good">${esc(s.best)}</span> (${poCp(-s.drop)}).</p>`).join("")}</div>`
        : `<p class="sub">No slips: every move kept the balance.</p>`) : ""}
      <div class="controls"><button class="btn primary" id="poAgain">Play it again</button><button class="btn" id="poBack">Back to the lines</button></div>`);
    $("poAgain").onclick = () => startPlayout(p.node);
    $("poBack").onclick = () => { po = null; syncControls(); next(); };
  };
  if (p.engine) sfSearch(g.fen(), { depth: 11 }).then(r => done(g.turn() === ME ? r.score : -r.score), () => done(null));
  else done(null);
}
function poStop() { po = null; }
function poLegal() { return po && phase === "play" && po.g.turn() === ME ? po.g.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || "")) : []; }

/* ---- move-by-move analysis of your games from GYM.mygames.analysis_since on (mygames.py Part C, lazily loaded
   data/mygames_analysis.js): board + marked move list + eval graph; at a flagged move of yours, a "decision" frame
   shows the position before it with your move (red) and the engine's best (green) ---- */
const GA_MARK = { inaccuracy: "?!", mistake: "?", blunder: "??" };
const GA_CLS = { inaccuracy: "i", mistake: "m", blunder: "b" };
const GA_MATE = 10000;
// gaView = {id, a, fens, mv, byPly, frames: [{k, f}], fi}; gaPositional = "positional only" (tactical flags get
// no mark, no stop and no graph dot)
let gaView = null;
let gaPositional = false;
try { gaPositional = localStorage.getItem("gym:gaPos") === "1"; } catch (e) {}
function gaSince() { const g = window.GYM && GYM.mygames; return (g && g.analysis_since) || "2026-09-27"; }
function gaSinceTxt() { return new Date(gaSince() + "T12:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
function gaWin(cp) { cp = Math.max(-1000, Math.min(1000, cp)); return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); }
function gaEv(cp) { return Math.abs(cp) >= GA_MATE ? (cp > 0 ? "White mates" : "Black mates") : (cp >= 0 ? "+" : "−") + Math.abs(cp / 100).toFixed(1); }
function gaShown(f) { return !!f && (!gaPositional || f.type === "positional"); }
function gaNo(k) { return Math.floor(k / 2) + 1 + (k % 2 ? "…" : "."); }       // "12." / "12…" for ply k
function gaLine(k, sans) { return sans.map((s, i) => (i === 0 || (k + i) % 2 === 0 ? gaNo(k + i) : "") + s).join(" "); }
function gaUci(fen, san) { const g = new Chess(fen), m = g.move(san); return m ? m.from + m.to + (m.promotion || "") : null; }
async function gaOpen(id) {
  const el = $("games2");
  el.innerHTML = `<p class="empty">Loading the analysis…</p>`;
  try { await loadScript("data/mygames_analysis.js"); } catch (e) { console.error(e); }
  const a = window.GYM && GYM.mygamesAnalysis && GYM.mygamesAnalysis[id];
  if (!a) {
    el.innerHTML = `<div class="controls"><button class="btn" id="gaBack">← Back to the list</button></div><p class="empty">This game's analysis couldn't be loaded here.</p>`;
    $("gaBack").onclick = gaClose; return;
  }
  S.seenGames = S.seenGames || {}; if (!S.seenGames[id]) { S.seenGames[id] = Date.now(); save(); }
  markGamesTab();
  const g = new Chess(), fens = [g.fen()], mv = [];
  for (const san of a.san) { const m = g.move(san); if (!m) break; mv.push(m); fens.push(g.fen()); }
  gaView = { id, a, fens, mv, byPly: Object.fromEntries(a.flags.map(f => [f.ply, f])), frames: [], fi: 0 };
  gaFrames(0);
  gaLayout(); gaShow();
}
function gaClose() { gaView = null; renderGames(); }
function gaFrames(k, dec = false) {    // rebuild the frame list (the filter changes it), keep position k
  const v = gaView; v.frames = [];
  for (let i = 0; i <= v.mv.length; i++) {
    const f = i > 0 ? v.byPly[i - 1] : null;
    if (gaShown(f)) v.frames.push({ k: i - 1, f });
    v.frames.push({ k: i, f: null });
  }
  v.fi = Math.max(0, v.frames.findIndex(x => x.k === k && !!x.f === dec));
}
function gaGo(k, dec = false) { const v = gaView; const i = v.frames.findIndex(x => x.k === k && !!x.f === dec); if (i >= 0) { v.fi = i; gaShow(); } }
function gaStep(d) { const v = gaView; if (!v) return; const i = Math.max(0, Math.min(v.frames.length - 1, v.fi + d)); if (i !== v.fi) { v.fi = i; gaShow(); } }
function gaNextFlag(d = 1) {
  const v = gaView; if (!v) return;
  for (let i = v.fi + d; i >= 0 && i < v.frames.length; i += d) if (v.frames[i].f) { v.fi = i; return gaShow(); }
}
function gaLayout() {
  const v = gaView, a = v.a, res = a.score === 1 ? "won" : a.score === 0 ? "lost" : "drew";
  const cnt = c => `<span class="gam ga-${GA_CLS[c]}">${GA_MARK[c]}</span> ${a.n[c] || 0} ${(a.n[c] || 0) === 1 ? c : c === "inaccuracy" ? "inaccuracies" : c + "s"}`;
  const pos = a.flags.filter(f => f.type === "positional").length;
  $("games2").innerHTML = `<div class="gaview">
    <div class="gahead">
      <button class="btn" id="gaBack">← Back to the list</button>
      <div class="gattl"><b>vs ${esc(a.opp)}</b> (${esc(a.opp_elo)}) · ${esc(a.date)} · ${esc(a.speed)} · you ${a.color === "w" ? "White" : "Black"} (${esc(a.my_elo)}), ${res}
        <span class="tiny">${esc(a.eco)} ${esc(a.opening)}</span></div>
      <div class="gasum"><span>Accuracy <b>${a.acc === null || a.acc === undefined ? "–" : Math.round(a.acc) + "%"}</b></span>
        <span>${cnt("inaccuracy")}</span><span>${cnt("mistake")}</span><span>${cnt("blunder")}</span>
        <span class="tiny">${pos} positional, ${a.flags.length - pos} tactical · Stockfish depth ${a.depth}</span></div>
    </div>
    <div class="trainer">
      <div class="boardcol">
        <div class="board" id="gaBoard" aria-label="Analysis board"><div class="squares"></div><svg class="arrows" viewBox="0 0 8 8" preserveAspectRatio="none"></svg></div>
        <div class="gagraph" id="gaGraphBox"><svg id="gaGraph" role="img" aria-label="Evaluation graph (White up, Black down): click to jump"></svg><span class="tiny" id="gaHover">Click the graph to jump to a move.</span></div>
        <div class="controls">
          <button class="btn" id="gaFirst" aria-label="Start">⏮</button><button class="btn" id="gaPrev" aria-label="Back">◀</button>
          <button class="btn" id="gaNext" aria-label="Forward">▶</button><button class="btn" id="gaLast" aria-label="End">⏭</button>
          <button class="btn" id="gaNextErr">Next mistake</button>
          <button class="chip" id="gaPosOnly" aria-pressed="${gaPositional}">Positional only</button>
        </div>
        <span class="keys"><kbd>←</kbd> <kbd>→</kbd> step through the game (it stops before each of your mistakes) · click a move or the graph to jump · <a href="https://lichess.org/${encodeURIComponent(a.id)}" target="_blank" rel="noopener">game on Lichess</a></span>
      </div>
      <div class="side">
        <div class="card" id="gaCard" aria-live="polite"></div>
        <div class="moves gamoves" id="gaMoves"></div>
        <div class="galist" id="gaList"></div>
      </div>
    </div></div>`;
  $("gaBack").onclick = gaClose;
  $("gaFirst").onclick = () => { v.fi = 0; gaShow(); };
  $("gaLast").onclick = () => { v.fi = v.frames.length - 1; gaShow(); };
  $("gaPrev").onclick = () => gaStep(-1);
  $("gaNext").onclick = () => gaStep(1);
  $("gaNextErr").onclick = () => gaNextFlag(1);
  $("gaPosOnly").onclick = () => {
    gaPositional = !gaPositional; try { localStorage.setItem("gym:gaPos", gaPositional ? "1" : "0"); } catch (e) {}
    $("gaPosOnly").setAttribute("aria-pressed", gaPositional);
    const cur = v.frames[v.fi]; gaFrames(cur.k, !!cur.f && gaShown(cur.f)); gaShow();
  };
  const svg = $("gaGraph");
  const kAt = ev => { const r = svg.getBoundingClientRect(), n = v.mv.length; return Math.max(0, Math.min(n, Math.round((ev.clientX - r.left - 6) / Math.max(1, r.width - 12) * n))); };
  svg.onclick = ev => { const k = kAt(ev), f = k > 0 ? v.byPly[k - 1] : null; if (gaShown(f)) gaGo(k - 1, true); else gaGo(k); };   // a flagged move: its decision frame
  svg.onmousemove = ev => { const k = kAt(ev); $("gaHover").textContent = k ? `${gaNo(k - 1)}${v.mv[k - 1].san}: ${gaEv(a.ev[k])}` : `Start: ${gaEv(a.ev[0])}`; };
  svg.onmouseleave = () => { $("gaHover").textContent = "Click the graph to jump to a move."; };
}
function gaShow() {
  const v = gaView; if (!v || !$("gaBoard")) return;
  const a = v.a, fr = v.frames[v.fi], k = fr.k;
  const his = a.color;
  // board
  if (fr.f) {
    const fen = v.fens[k], mine = v.mv[k].from + v.mv[k].to, best = gaUci(fen, fr.f.best);
    renderBoard(parseFen(fen), { el: $("gaBoard"), o: his, hl: k > 0 ? [v.mv[k - 1].from, v.mv[k - 1].to] : [], arrows: [[mine, "red"], ...(best ? [[best, "green"]] : [])] });
  } else {
    renderBoard(parseFen(v.fens[k]), { el: $("gaBoard"), o: his, hl: k > 0 ? [v.mv[k - 1].from, v.mv[k - 1].to] : [] });
  }
  // card
  const f = fr.f || (k > 0 && gaShown(v.byPly[k - 1]) ? v.byPly[k - 1] : null);
  let html;
  if (f) {
    const c = GA_CLS[f.cls], you = `${gaNo(f.ply)}${esc(f.played)}${GA_MARK[f.cls]}`;
    html = `<div class="head"><span class="tag ga-bg-${c}">${esc(f.cls)}</span><span class="tag gatype">${esc(f.type)}</span><span class="tiny">${esc(f.phase)}</span></div>
      <p class="text">${fr.f ? `You are about to play <span class="bad">${you}</span>.` : `You played <span class="bad">${you}</span>.`}
        Better was <span class="good">${gaNo(f.ply)}${esc(f.best)}</span>.</p>
      <p class="sub">Eval ${gaEv(f.before)} → ${gaEv(f.after)} (White's view): ${Math.round(f.lost)}% of your winning chances lost.</p>
      <div class="plan"><span class="lbl">Best line</span><p class="text mono">${esc(gaLine(f.ply, f.line))}</p>
        ${f.second ? `<p class="sub">Engine's second choice: ${gaNo(f.ply)}${esc(f.second)} (${gaEv(f.second_ev)}).</p>` : ""}
        ${f.reply && f.reply.length ? `<p class="sub">After ${esc(f.played)} the engine expects ${esc(gaLine(f.ply + 1, f.reply))}.</p>` : ""}</div>
      ${fr.f ? `<p class="sub">Red: your move. Green: the engine's. Step on to see the game continue.</p>` : `<div class="controls"><button class="btn" id="gaSeeBest">Show the better move</button></div>`}
      ${f.type === "positional" && sampleFn ? `<div class="controls"><button class="btn primary" id="gaExplain">Explain</button></div><div id="gaExplainOut" class="text" style="white-space:pre-wrap"></div>` : ""}`;
  } else if (k === 0) {
    html = `<p class="text">Step through the game with ▶ or <kbd>→</kbd>. It stops before each of your ${gaPositional ? "positional " : ""}mistakes and shows what was better.</p>
      <p class="sub">Marks: <span class="gam ga-i">?!</span> inaccuracy, <span class="gam ga-m">?</span> mistake, <span class="gam ga-b">??</span> blunder (by the winning chances lost, like Lichess).</p>`;
  } else {
    const flag = v.byPly[k - 1];
    html = `<p class="text">${gaNo(k - 1)}${esc(v.mv[k - 1].san)}${flag ? `<span class="gam ga-${GA_CLS[flag.cls]}">${GA_MARK[flag.cls]}</span>` : ""} · eval ${gaEv(a.ev[k])}</p>
      ${flag && !gaShown(flag) ? `<p class="sub">A tactical ${esc(flag.cls)} (hidden by “positional only”): better was ${esc(flag.best)}.</p>` : ""}
      ${k === v.mv.length ? `<p class="sub">End of the game.</p>` : ""}`;
  }
  $("gaCard").className = "card" + (f ? " fail" : "");
  $("gaCard").innerHTML = html;
  if ($("gaSeeBest")) $("gaSeeBest").onclick = () => gaGo(f.ply, true);
  if ($("gaExplain")) $("gaExplain").onclick = () => gaExplain(f);
  // move list
  const cur = fr.f ? k : k - 1;
  $("gaMoves").innerHTML = v.mv.map((m, i) => {
    const fl = v.byPly[i], mine = (i % 2 === 0) === (his === "w");
    return (i % 2 === 0 ? `<span class="n">${i / 2 + 1}.</span> ` : "") +
      `<span class="m nav${mine ? " me" : ""}${i === cur ? " last" : ""}" data-k="${i}">${esc(m.san)}${gaShown(fl) ? `<span class="gam ga-${GA_CLS[fl.cls]}">${GA_MARK[fl.cls]}</span>` : ""}</span>`;
  }).join(" ");
  $("gaMoves").querySelectorAll("[data-k]").forEach(el => el.onclick = () => { const i = +el.dataset.k; gaGo(gaShown(v.byPly[i]) ? i : i + 1, gaShown(v.byPly[i])); });
  const curEl = $("gaMoves").querySelector(".m.last"); if (curEl && curEl.scrollIntoView && $("gaMoves").scrollHeight > $("gaMoves").clientHeight) curEl.scrollIntoView({ block: "nearest" });
  // list of your flagged moves
  const shown = a.flags.filter(gaShown);
  $("gaList").innerHTML = `<h3>Your ${gaPositional ? "positional " : ""}mistakes (${shown.length})</h3>` + (shown.map(x =>
    `<button class="gaitem${fr.f === x ? " on" : ""}" data-gp="${x.ply}"><span class="gam ga-${GA_CLS[x.cls]}">${GA_MARK[x.cls]}</span> ${gaNo(x.ply)}${esc(x.played)} → <b>${esc(x.best)}</b> <span class="tiny">${esc(x.type)}, ${gaEv(x.before)} → ${gaEv(x.after)}</span></button>`).join("")
    || `<p class="empty">${a.flags.length ? "No positional mistakes in this game: the flagged moves were all tactical." : "No inaccuracies, mistakes or blunders: well played."}</p>`);
  $("gaList").querySelectorAll("[data-gp]").forEach(b => b.onclick = () => gaGo(+b.dataset.gp, true));
  gaGraph();
}
function gaGraph() {
  const v = gaView, a = v.a, svg = $("gaGraph"), n = Math.max(1, v.mv.length);
  const W = Math.max(200, Math.round(svg.getBoundingClientRect().width) || 480), H = 90, P = 6;
  const x = k => P + k / n * (W - 2 * P), y = k => H - gaWin(a.ev[k]) / 100 * H;
  const pts = a.ev.slice(0, v.mv.length + 1).map((_, k) => `${x(k).toFixed(1)},${y(k).toFixed(1)}`);
  const fr = v.frames[v.fi], at = fr.f ? fr.k + 1 : fr.k;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
  svg.innerHTML = `<rect class="gabg" x="0" y="0" width="${W}" height="${H}"/>
    <path class="gawhite" d="M${x(0)},${H} L${pts.join(" L")} L${x(v.mv.length)},${H} Z"/>
    <line class="gamid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>
    <polyline class="galine" points="${pts.join(" ")}"/>
    <line class="gacur" x1="${x(at)}" y1="0" x2="${x(at)}" y2="${H}"/>
    ${a.flags.filter(gaShown).map(f => `<circle class="ga-dot ga-f-${GA_CLS[f.cls]}" cx="${x(f.ply + 1)}" cy="${y(f.ply + 1)}" r="4.5"><title>${gaNo(f.ply)}${esc(f.played)}${GA_MARK[f.cls]} (${esc(f.type)})</title></circle>`).join("")}`;
}
document.addEventListener("keydown", ev => {
  if (!gaView || !$("gaBoard") || $("gamesView").hidden || window.SECTION !== "opening" || ev.target.closest("input, textarea, select")) return;
  if (ev.key === "ArrowRight") { ev.preventDefault(); gaStep(1); }
  else if (ev.key === "ArrowLeft") { ev.preventDefault(); gaStep(-1); }
  else if (ev.key === "Home") { ev.preventDefault(); gaView.fi = 0; gaShow(); }
  else if (ev.key === "End") { ev.preventDefault(); gaView.fi = gaView.frames.length - 1; gaShow(); }
});
window.addEventListener("resize", () => { if (gaView && $("gaGraph")) gaGraph(); });

/* ---- "Explain" for a positional mistake: Claude (sample capability) gets only facts computed here from the board ---- */
const GA_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const GA_NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
function gaSide(c) { return c === "w" ? "White" : "Black"; }
// board facts of one position: [[key, text]], the key lets the caller list only what a move changed
function gaFacts(fen) {
  const g = new Chess(fen), bd = g.board(), pcs = { w: [], b: [] };
  bd.forEach((row, r) => row.forEach((p, f) => { if (p) pcs[p.color].push({ t: p.type, sq: FILES[f] + (8 - r), f, r: 8 - r }); }));
  const out = [];
  const pawns = c => pcs[c].filter(p => p.t === "p");
  const files = c => { const s = new Set(); pawns(c).forEach(p => s.add(p.f)); return s; };
  const mat = c => pcs[c].reduce((s, p) => s + (GA_VAL[p.t] || 0), 0);
  for (const c of ["w", "b"]) {
    const cnt = t => pcs[c].filter(p => p.t === t).length;
    const list = ["q", "r", "b", "n"].filter(t => cnt(t)).map(t => `${cnt(t)} ${GA_NAME[t]}${cnt(t) > 1 ? "s" : ""}`);
    out.push([`mat${c}`, `${gaSide(c)} material: ${list.join(", ") || "no pieces"}, ${cnt("p")} pawn${cnt("p") === 1 ? "" : "s"} (${mat(c)} points).`]);
  }
  const bal = mat("w") - mat("b");
  out.push(["bal", bal ? `Material balance: ${gaSide(bal > 0 ? "w" : "b")} is up ${Math.abs(bal)} point${Math.abs(bal) === 1 ? "" : "s"}.` : "Material is level."]);
  for (const c of ["w", "b"]) {
    const bishops = pcs[c].filter(p => p.t === "b");
    if (bishops.length >= 2 && pcs[c === "w" ? "b" : "w"].filter(p => p.t === "b").length < 2) out.push([`bp${c}`, `${gaSide(c)} has the bishop pair.`]);
  }
  for (const c of ["w", "b"]) {
    const o = c === "w" ? "b" : "w", my = pawns(c), their = pawns(o), mf = files(c), dir = c === "w" ? 1 : -1;
    const sq = ps => ps.map(p => p.sq).sort().join(", ");
    out.push([`pw${c}`, `${gaSide(c)} pawns: ${sq(my) || "none"}.`]);
    const isolated = my.filter(p => !mf.has(p.f - 1) && !mf.has(p.f + 1));
    const doubled = [...mf].filter(f => my.filter(p => p.f === f).length > 1).map(f => FILES[f] + "-file");
    const passed = my.filter(p => !their.some(q => Math.abs(q.f - p.f) <= 1 && (q.r - p.r) * dir > 0));
    let islands = 0; for (let f = 0; f < 8; f++) if (mf.has(f) && !mf.has(f - 1)) islands++;
    out.push([`iso${c}`, `${gaSide(c)} isolated pawns: ${sq(isolated) || "none"}.`]);
    out.push([`dbl${c}`, `${gaSide(c)} doubled pawns: ${doubled.join(", ") || "none"}.`]);
    out.push([`pas${c}`, `${gaSide(c)} passed pawns: ${sq(passed) || "none"}.`]);
    out.push([`isl${c}`, `${gaSide(c)} pawn islands: ${islands}.`]);
    const centre = my.filter(p => ["d4", "e4", "d5", "e5"].includes(p.sq));
    out.push([`cen${c}`, `${gaSide(c)} centre pawns (d4/e4/d5/e5): ${sq(centre) || "none"}.`]);
  }
  const wf = files("w"), bf = files("b"), open = [], semiW = [], semiB = [];
  for (let f = 0; f < 8; f++) {
    if (!wf.has(f) && !bf.has(f)) open.push(FILES[f]);
    else if (!wf.has(f)) semiW.push(FILES[f]); else if (!bf.has(f)) semiB.push(FILES[f]);
  }
  out.push(["open", `Open files (no pawns): ${open.join(", ") || "none"}.`]);
  out.push(["semiw", `Half-open files for White (only Black pawns): ${semiW.join(", ") || "none"}.`]);
  out.push(["semib", `Half-open files for Black (only White pawns): ${semiB.join(", ") || "none"}.`]);
  for (const c of ["w", "b"]) {
    const k = pcs[c].find(p => p.t === "k"); if (!k) continue;
    const dir = c === "w" ? 1 : -1;
    const shelter = pawns(c).filter(p => Math.abs(p.f - k.f) <= 1 && (p.r - k.r) * dir > 0 && (p.r - k.r) * dir <= 2);
    const bare = [k.f - 1, k.f, k.f + 1].filter(f => f >= 0 && f < 8 && !files(c).has(f)).map(f => FILES[f]);
    out.push([`king${c}`, `${gaSide(c)} king on ${k.sq}; its own pawns within two squares in front: ${shelter.map(p => p.sq).sort().join(", ") || "none"}; files next to it with no ${gaSide(c)} pawn: ${bare.join(", ") || "none"}.`]);
  }
  for (const c of ["w", "b"]) {       // mobility as if it were that side's turn (en passant ignored)
    const parts = fen.split(" "); parts[1] = c; parts[3] = "-";
    const h = new Chess(); let moves = [];
    if (h.load(parts.join(" "))) moves = h.moves({ verbose: true });
    const by = t => new Set(moves.filter(m => m.piece === t).map(m => m.from + m.to)).size;
    const bits = ["n", "b", "r", "q"].filter(t => pcs[c].some(p => p.t === t)).map(t => `${GA_NAME[t]}s ${by(t)}`);
    out.push([`mob${c}`, `${gaSide(c)} piece mobility (legal moves per piece type, counted with ${gaSide(c)} to move): ${bits.join(", ") || "no pieces"}.`]);
    const home = c === "w" ? { b1: "n", g1: "n", c1: "b", f1: "b" } : { b8: "n", g8: "n", c8: "b", f8: "b" };
    const undev = pcs[c].filter(p => home[p.sq] === p.t).map(p => `${GA_NAME[p.t]} ${p.sq}`);
    out.push([`dev${c}`, `${gaSide(c)} knights/bishops still on their starting squares: ${undev.join(", ") || "none"}.`]);
  }
  out.push(["cas", `Castling rights left: ${fen.split(" ")[2] === "-" ? "none" : fen.split(" ")[2]}.`]);
  if (g.in_check()) out.push(["chk", `${gaSide(g.turn())} is in check.`]);
  return out;
}
function gaChanges(before, after) {
  const b = Object.fromEntries(before);
  return after.filter(([k, t]) => b[k] !== t).map(([, t]) => t);
}
function gaPrompt(f) {
  const v = gaView, a = v.a, fen = v.fens[f.ply], me = gaSide(a.color);
  const after = v.fens[f.ply + 1], g = new Chess(fen); g.move(f.best);
  const fb = gaFacts(fen), fMine = gaFacts(after), fBest = gaFacts(g.fen());
  const ch = (x, what) => { const c = gaChanges(fb, x); return c.length ? c.map(t => "- " + t).join("\n") : `- (no change in these facts after ${what})`; };
  return `You are a chess coach for a club player rated about 1850 on Lichess (blitz and bullet). He wants to understand a positional mistake from one of his own games.

He played ${me}. Game phase: ${f.phase}. Move ${gaNo(f.ply)}
Position before his move (FEN): ${fen}
He played: ${gaNo(f.ply)}${f.played}
Stockfish's best move: ${gaNo(f.ply)}${f.best}. Best line: ${gaLine(f.ply, f.line)}
${f.second ? `Stockfish's second choice: ${gaNo(f.ply)}${f.second} (${gaEv(f.second_ev)}).\n` : ""}Stockfish's expected continuation after his move: ${f.reply && f.reply.length ? gaLine(f.ply + 1, f.reply) : "(none)"}
Evaluation (pawns, White's point of view): ${gaEv(f.before)} with the best move, ${gaEv(f.after)} after his move; he lost ${Math.round(f.lost)}% of his winning chances (classified as: ${f.cls}). Neither the best line nor the continuation after his move wins or loses 2 or more points of material within its first 4 half-moves, neither contains a mate, and the evaluation changed by less than 3 pawns, so this counts as a positional mistake.

Board facts before his move (computed from the board; they are exact):
${fb.map(([, t]) => "- " + t).join("\n")}

What his move ${f.played} changes in these facts:
${ch(fMine, f.played)}

What the best move ${f.best} changes in these facts:
${ch(fBest, f.best)}

Task: in 3 to 4 sentences, explain the positional idea: why ${f.best} is better than ${f.played} here and what he should take away for similar positions. Use only the facts and lines given above. Never claim a tactic, threat, attack, defence, pin, weakness of a particular square or any relation between pieces that the facts above don't state; if the facts don't make the reason certain, say what the engine's line suggests about plans and structure, and say it cautiously. Address him as "you" (he is ${me}); write moves in SAN; plain prose, no headings, no bullet points.`;
}
async function gaExplain(f) {
  const out = $("gaExplainOut"), btn = $("gaExplain");
  if (!sampleFn || !out) return;
  btn.disabled = true; out.textContent = "Thinking…";
  try {
    const r = await sampleFn(gaPrompt(f), { onText: ({ text }) => { out.textContent = text; } });
    out.textContent = r.text;
  } catch (e) {
    out.textContent = e && e.text ? e.text : (e && e.code === "not_granted" ? "Asking Claude isn't allowed on this page for you." : e && e.code === "rate_limited" ? "Too many questions right now; try again in a minute." : "Claude couldn't answer right now.");
  }
  btn.disabled = false;
}


/* ================= sections: puzzles and the openings ================= */
window.SECTION = null;
const loaded = {};
function loadScript(src) {
  return loaded[src] || (loaded[src] = new Promise((ok, fail) => {
    const s = document.createElement("script"); s.src = src; s.onload = ok;
    s.onerror = () => { delete loaded[src]; s.remove(); fail(new Error("couldn't load " + src)); };   // retry next time
    document.head.appendChild(s);
  }));
}
let navSeq = 0;
async function go(sec, sub) {
  const my = ++navSeq, stale = () => my !== navSeq;    // a later click wins over a slow load
  document.querySelectorAll("[data-sec]").forEach(b => b.setAttribute("aria-current", b.dataset.sec === sec ? "page" : "false"));
  $("puzzleView").hidden = sec !== "puzzles";
  $("kidsView").hidden = sec !== "kids";
  $("openingView").hidden = sec === "puzzles" || sec === "kids";
  $("loading").hidden = false; $("loadErr").hidden = true;
  try {
    if (sec === "puzzles") {
      await loadScript("data/puzzles.js");
      if (!window.GYM_KIDS_ONLY) await loadScript("data/mygames.js").catch(() => {});   // "From my games" (optional)
      if (stale()) return;
      if (typeof Chess === "undefined") throw new Error("chess.js missing");
      window.SECTION = "puzzles"; openPuzzles(sub && sub.stage);
    } else if (sec === "kids") {
      await loadScript("data/puzzles.js");
      if (stale()) return;
      window.SECTION = "kids"; openKids(sub);
    } else {
      await loadScript(`data/${sec}.js`);
      await loadScript("data/mygames.js").catch(() => {});      // optional: your own games (mygames.py)
      if (stale()) return;
      window.SECTION = "opening";
      const d = GYM[sec];
      $("openingLede").textContent = d.side === "b"
        ? "You play Black. Lessons walk you through one White system at a time, then test you until every position in it is right. Misses go into your notebook, and Review brings them back."
        : "You play White. Lessons walk you through one Black reply at a time, then test you until every position in it is right. Misses go into your notebook, and Review brings them back.";
      $("openingNote").hidden = d.nodes.length > 20;
      openOpening(d, sub);
    }
    try { localStorage.setItem("gym:sec", sec); } catch (e) {}
  } catch (e) {
    console.error(e);
    if (stale()) return;
    $("loadErr").hidden = false;
    $("loadErr").textContent = "This section didn't load. Reload the page to try again." + (e && e.message ? ` (${e.message})` : "");
  }
  $("loading").hidden = true;
}
document.querySelectorAll("[data-sec]").forEach(b => b.onclick = () => go(b.dataset.sec));
window.onGymStore = () => { if (window.SECTION === "puzzles") pzRenderBar(); if (window.SECTION === "kids") openKids(); };
(function boot() {
  if (window.GYM_KIDS_ONLY) {     // the standalone kids' site: no section menu, no openings
    document.documentElement.classList.add("kidsonly");
    // no zooming on the iPad (a child's pinch or double tap zoomed the board with no way back): Safari ignores
    // user-scalable=no, so block its gesture events and a quick second tap as well
    for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
    document.addEventListener("touchmove", e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    let lastTap = 0;
    document.addEventListener("touchend", e => { const t = Date.now(); if (t - lastTap < 350 && !e.target.closest("input, select")) e.preventDefault(); lastTap = t; }, { passive: false });
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
    return go("kids");
  }
  const h = location.hash.slice(1);
  let sec = "puzzles";
  try { sec = localStorage.getItem("gym:sec") || sec; } catch (e) {}
  if (["puzzles", "modern", "tromp", "kids"].includes(h)) sec = h;
  if (["lessons", "review", "free", "ideas"].includes(h)) return go("modern", h);
  go(sec);
})();
