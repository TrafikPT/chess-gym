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
  out.stars = Math.max(a.stars || 0, b.stars || 0);
  if (a.album || b.album) {    // sticker book (album.js): packs are drawn from their number, so the larger count of each is right
    // both copies brought to the current catalogue first (copies, not the stored objects): an old copy can't bring v1 ids back
    const cur = al => albumMigrate(JSON.parse(JSON.stringify(al || {}))), x = cur(a.album), y = cur(b.album);
    out.album = { c: Math.max(x.c || 0, y.c || 0), b: Math.max(x.b || 0, y.b || 0), o: Math.max(x.o || 0, y.o || 0), s: maxMap(x.s, y.s), v: A_VER,
      c0: Math.max(x.c0 || 0, y.c0 || 0), p3: Math.max(x.p3 || 0, y.p3 || 0) };     // the larger c0: never creates packs
  }
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
  // the path was started over (kids.js "Start the path over"): only the copy with the later restart counts for it,
  // so a device or backup from before the restart can't bring the old stars back
  if ((a.pathReset || 0) !== (b.pathReset || 0)) {
    const r = (a.pathReset || 0) > (b.pathReset || 0) ? a : b;
    for (const k of ["stages", "gateFree", "gatesSeen"]) out[k] = { ...(r[k] || {}) };
    out.pathV = r.pathV || 0; out.pathReset = r.pathReset;
  }
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
  $("pzStars").hidden = !pzKid(); $("pzStars").innerHTML = `⭐ <b>${pl.stars || 0}</b>`; aBadge();
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
  if (/save(Queen|Piece)/.test(pzCur[4]) && pzIdx === 0 && pzCur[7]) {   // save your piece: it glows red, a red arrow from each attacker
    const them = pzGame.turn() === "w" ? "b" : "w";
    pzMarks = { [pzCur[7]]: "mk" }; pzArrows = attackersOf(parseFen(pzGame.fen()), pzCur[7], them).map(h => [h + pzCur[7], "red"]);
  }
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
  if (albumTake() && kid) $("pzKidNext").insertAdjacentHTML("beforebegin", aPackChip());     // a pack was earned: shown quietly
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


/* ================= kids' corner: sounds, rewards, learning path, piece school, parent view (the sticker book: album.js) ================= */

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
    else if (kind === "tear") { [900, 640, 420].forEach((f, i) => tone(f, i * 0.05, 0.12, "sawtooth", 0.04)); }
    else if (kind === "flip") tone(1200, 0, 0.06, "triangle", 0.06);
  } catch (e) {}
}

/* ---- rewards: a star per solved puzzle (the count at the top); stickers come in packs from the path (album.js) ---- */
function kidReward(pl, win) {
  if (!pl.kid || !win) return;
  pl.stars = (pl.stars || 0) + 1;
}
function kidAfterPuzzle() {
  const pl = pzPlayers();
  if (!pl.kid) return;
  $("pzStars").innerHTML = `⭐ <b>${pl.stars || 0}</b>`;
  $("pzStars").classList.remove("bump"); void $("pzStars").offsetWidth; $("pzStars").classList.add("bump");
}
// No pop-ups in the kids' corner (no medals, trophies or pictures between stages): the owner wants nothing to
// interrupt the playing. Progress shows on the map, the stage stars and the sticker counters.
// finished the current stage? the next puzzle comes from the next unfinished stage (true: went to an endgame stage).
// A stage picked on the map after it was already finished is a replay (pzReplay): it stays until the child leaves it
function advanceStage() {
  if (!pzStage || pzReplay) return;
  const pl = pzPlayers();
  if (stageStars(pl, pzStage.id) < needOf(pzStage)) return;
  const i = stageCur(pl);
  if (i < 0 || STAGES[i] === pzStage) return;
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
// a win in a game started from a boss gate clears that gate (games from the 🤖 tab don't count) and puts the boss's
// sticker in the book (no pop-up)
function gateWin(pl, botId, from = null) {
  const i = STAGES.indexOf(from);
  if (i < 0 || from.gate !== botId || stageDone(pl, from) || !stageOpen(pl, i)) return null;
  pl.stages = pl.stages || {}; pl.stages[from.id] = needOf(from);
  albumBoss(pl, from.id);
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
  pl.stages[st.id] = had + 1; stageLost = null; albumSolve(pl); save(); renderStageBar();
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

/* ---- helpers for the mini-games: stars, squares, a FEN from a position ---- */
function kidAddStars(n) {
  const pl = pzPlayers(); pl.stars = (pl.stars || 0) + n; save();
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
    albumSolve(pl); kidAddStars(stars); sfx("right");
    $("eDone").innerHTML = `<div class="big">${"⭐".repeat(stars)}</div>
      <div class="row">${albumTake() ? aPackChip() : ""}<button class="btn big" type="button" id="eAgain" aria-label="Play again">↻</button>
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
      <div class="controls"><button class="btn" type="button" id="uRestart">Start the path over</button></div>
    </figure>
    ${albumParents(pl)}
    ${window.GYM_KIDS_ONLY ? `<figure class="chart wide"><figcaption>Back up progress</figcaption>
      <p class="tiny">Progress on this site is saved only in this browser. Add the page to the Home Screen so Safari keeps it, and save a backup file now and then (it goes to Files). Restoring merges: nothing already earned here is lost.</p>
      <div class="controls"><button class="btn" type="button" id="uBackup">Save a backup file</button>
        <label class="btn">Restore from a file<input type="file" id="uRestore" accept="application/json,.json" hidden></label></div>
      <p class="tiny" id="uMsg"></p></figure>` : ""}
    </div>
    <p class="tiny">Stars are earned in pictures-only mode, sticker packs on the learning path. Ratings update after every puzzle (not after hinted ones).</p>`;
  wireTips($("kParents"));
  $("kParents").querySelectorAll("[data-ul]").forEach(b => b.onclick = () => {
    const i = +b.dataset.ul;
    if (!confirm(`Open stage ${i + 1} (${STAGES[i].name})? Stages 1–${i} will count as finished (boss gates as beaten).`)) return;
    pl.stages = pl.stages || {};
    STAGES.slice(0, i).forEach(st => { pl.stages[st.id] = Math.max(stageStars(pl, st.id), needOf(st)); });
    save(); renderParents();
  });
  $("uSchool").onchange = ev => { pl.schoolAll = ev.target.checked; save(); };
  albumParentsWire(pl);
  // back to stage 1, every other stage locked; rating, bot record, piece school and the sticker book stay.
  // pathReset makes the restart win over older copies in mergePlayer
  $("uRestart").onclick = () => {
    if (!confirm(`Start the learning path over for ${pl.name}? All path stars and beaten bosses are cleared and only stage 1 stays open. Puzzle rating, bot games, piece school and the sticker book are kept.`)) return;
    pl.stages = {}; pl.gateFree = {}; pl.gatesSeen = Object.fromEntries(STAGES.map(st => [st.id, 1])); pl.pathV = 2;
    pl.pathReset = Date.now();
    save(); renderParents();
  };
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
  else if (kidTab === "stickers") renderAlbum();
  else renderParents();
  aBadge(); aRenderTray();
}


/* ================= bots for young players ================= */
// Chess bots are built on chess.js with deliberate weaknesses; Pawn Wars uses its own tiny rules engine.
// Weakest first, and the animal grows with the strength so the child can see which bot is harder; lvl = the paw prints
// on its card and the colour of its ring. The ids are the old names, kept for the stored records (rex was a T-rex, gus
// a pig, cat the cat): rex = the mouse, gus = the cat, cat = the wolf. T-Rex and the Dragon search (botSearch) to
// `depth` plies within `ms`. Pawn Pete plays Pawn Wars, a different game: no level.
// slip = the share of moves a bot plays without looking, like the Cat (grab the biggest piece, else any move): that's
// what leaves pieces hanging and lets forks and mates through. Tuned so each bot scores ~60-70% against the one below
// (node bot-vs-bot, 110 games a pair, 2026-10-03: Wolf-Cat 69%, Tiger-Wolf 61%, T-Rex-Tiger 61%, Dragon-T-Rex 63%;
// the Cat beats the Mouse ~98%): a child who has done the path should be able to beat the Dragon. elo = rough guesses.
const BOTS = [
  { id: "rex", face: "🐭", name: "Muddled Mouse", elo: "~100", think: 500, lvl: 1 },
  { id: "gus", face: "🐱", name: "Greedy Cat", elo: "~400", think: 600, lvl: 2 },
  { id: "cat", face: "🐺", name: "Wily Wolf", elo: "~500", think: 700, lvl: 3, slip: 0.35 },
  { id: "tiger", face: "🐯", name: "Tactic Tiger", elo: "~600", think: 400, lvl: 4, slip: 0.1 },
  { id: "dino", face: "🦖", name: "T-Rex", elo: "~700", think: 250, lvl: 5, slip: 0.45, depth: 1, ms: 900 },
  { id: "dragon", face: "🐉", name: "Dragon", elo: "~800", think: 200, lvl: 6, slip: 0.45, depth: 2, ms: 1800 },
  { id: "pete", face: "🐣", name: "Pawn Pete", elo: "Pawn Wars", think: 500, pawns: true },
];
const BOT_RING = ["#3cb371", "#9acd32", "#f2c230", "#f39c34", "#e8542f", "#b3202a"];   // lvl 1–6: green to red
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
let bg = null;   // {bot, game (chess.js) | pw (pawn wars state), me: 'w'|'b', sel, last, over, log, rp, gate}
// gate: the learning-path boss stage this game was started from (a win against the bot clears it)
// log (chess games): every move as {fen before, from, to, me, piece, captured}; rp: the replay after the game {list, k}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function material(g, side) {
  let s = 0;
  for (const row of g.board()) for (const p of row) if (p) s += (p.color === side ? 1 : -1) * VALUE[p.type];
  return s;
}
function mateScore(g) { return g.in_checkmate() ? -1000 : (g.in_draw() || g.in_stalemate()) ? 0 : null; }
// what every bot but the Mouse falls back on when it slips: grab the biggest piece it can take, else any move
function catMove(ms) { return ms.filter(m => m.captured).sort((a, b) => VALUE[b.captured] - VALUE[a.captured])[0] || ms[0]; }
// best capture the side to move can make right now (used by Tactic Tiger to see simple threats)
function bestCaptureGain(g) {
  let best = 0;
  for (const m of g.moves({ verbose: true })) if (m.captured) best = Math.max(best, VALUE[m.captured]);
  return best;
}
function botMove(bot, g) {
  const ms = shuffle(g.moves({ verbose: true })), me = g.turn();
  if (bot.id === "rex") return ms[0];
  // everyone but the Mouse takes a mate in one
  for (const m of ms) { g.move(m); const mate = g.in_checkmate(); g.undo(); if (mate) return m; }
  if (bot.id === "gus" || Math.random() < (bot.slip || 0)) return catMove(ms);   // the Cat, or a slip
  if (bot.depth) return botSearch(bot, g);
  if (bot.id === "cat") {        // takes what's safe to take and doesn't leave the moved piece hanging
    // only the moved piece: an attack on any of its other pieces goes unnoticed (guarding them all, it never hung
    // anything: too hard for a world-2 boss)
    let best = null, bs = -1e9;
    for (const m of ms) {
      g.move(m);
      const hit = g.moves({ verbose: true }).some(r => r.to === m.to);
      const s = (m.captured ? VALUE[m.captured] : 0) - (hit ? VALUE[g.get(m.to).type] * 0.9 : 0) + Math.random() * 0.3;
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

/* ---- T-Rex and the Dragon: alpha-beta over material and piece placement, captures followed to the end ----
   T-Rex looks 1 ply (+ captures): it sees what hangs but not your threats (forks, mates); the Dragon looks 2 plies. */
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
  clearTimeout(botReply.t);   // a restart while the bot was thinking: that reply belongs to the old game
  bg = { bot, me, sel: null, last: [], over: null, log: [], rp: null, gate };
  if (bot.pawns) bg.pw = pwNew();
  else {
    bg.game = new Chess();
    if (pl.botNoQueen) bg.game.remove(me === "w" ? "d8" : "d1");
  }
  $("bPick").hidden = true; $("bGame").hidden = false; $("bOver").hidden = true;
  botDraw();
  if (botTurn() !== me) botReply.t = setTimeout(botReply, bot.think);
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
  $("bRestart").hidden = !!bg.over;   // once it's over, the panel has its own ↻
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
    pl.stars = (pl.stars || 0) + 3; sfx("trophy");
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
  if (bg.pw) bg.pw = pwPlay(bg.pw, pwMoves(bg.pw).find(m => m.from === from && m.to === to));
  else { const fen = bg.game.fen(); botLog(bg.game.move({ from, to, promotion: "q" }), true, fen); }
  bg.sel = null; bg.last = [from, to]; sfx("move");
  if (!botAfterMove()) { botDraw(); botReply.t = setTimeout(botReply, bg.bot.think); }
  return true;
}
// ↻ during a game: start over against the same bot (same gate, colour and no-queen setting); no take-backs in bot
// games, and no question first (no pop-ups)
function botRestart() { if (bg && !bg.rp) botStart(bg.bot.id, bg.gate); }
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
  $("bRestart").hidden = true;
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
    $("bRestart").onclick = botRestart;
    $("bQuit").onclick = () => { bg = null; renderBots(); };
  }
  if (bg) { $("bPick").hidden = true; $("bGame").hidden = false; botDraw(); } else renderBots();
}


/* ================= sticker book: anime-style athletes drawn in SVG, a pack of 5 for every clean path solve ================= */

/* ---- drawing: one chibi athlete (pose, kit, head) on a team backdrop; a sticker is a line of settings ----
   Figure coordinates: viewBox 0 -16 100 136 (head around 50,25, feet at y 107); the card is 120 x 158. */
const A_OL = "#2a1a10", A_OUT = `stroke="${A_OL}" stroke-width="1.1"`;
let aUid = 0;                 // clipPath ids must be unique in the page: the same sticker can be in the book, the tray and the zoom
const aPts = pts => pts.map(p => p.map(v => +v.toFixed(1)).join(",")).join(" ");
function aL(pts, col, w, ol = true) {
  const line = (c, ww) => `<polyline points="${aPts(pts)}" fill="none" stroke="${c}" stroke-width="${ww}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return (ol ? line(A_OL, w + 2.2) : "") + line(col, w);
}
function aC(x, y, r, f, extra = "") { return `<circle cx="${+x.toFixed(1)}" cy="${+y.toFixed(1)}" r="${r}" fill="${f}" ${extra}/>`; }
function aStar(x, y, r, f) {
  return `<polygon points="${aPts([...Array(10)].map((_, i) => { const rr = i % 2 ? r * .42 : r, a = -Math.PI / 2 + i * Math.PI / 5; return [x + rr * Math.cos(a), y + rr * Math.sin(a)]; }))}" fill="${f}"/>`;
}
function aFootball(x, y, r) {
  const pent = [0, 1, 2, 3, 4].map(i => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; return [x + r * .42 * Math.cos(a), y + r * .42 * Math.sin(a)]; });
  return aC(x, y, r, "#fff", `stroke="${A_OL}" stroke-width="1.4"`) + `<polygon points="${aPts(pent)}" fill="${A_OL}"/>` +
    pent.map(([px, py]) => aL([[px, py], [x + (px - x) * 2.35, y + (py - y) * 2.35]], A_OL, 1.1, false)).join("");
}
function aBasketball(x, y, r) {
  return aC(x, y, r, "#f57c00", `stroke="${A_OL}" stroke-width="1.3"`) + aL([[x - r, y], [x + r, y]], "#5d2c00", 1.1, false) + aL([[x, y - r], [x, y + r]], "#5d2c00", 1.1, false) +
    `<path d="M${x - r * .7},${y - r * .7} Q${x - r * .2},${y} ${x - r * .7},${y + r * .7} M${x + r * .7},${y - r * .7} Q${x + r * .2},${y} ${x + r * .7},${y + r * .7}" fill="none" stroke="#5d2c00" stroke-width="1.1"/>`;
}
// anime eye: white, big iris, pupil, two highlights, a thick upper lash (and a flick for long lashes)
function aEye(cx, cy, iris, s = 1, lash = 0) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${4 * s}" ry="${4.9 * s}" fill="#fff"/>` +
    `<ellipse cx="${cx}" cy="${cy + .7 * s}" rx="${3.2 * s}" ry="${4.1 * s}" fill="${iris}"/>` +
    `<ellipse cx="${cx}" cy="${cy + 1.7 * s}" rx="${2.4 * s}" ry="${2.2 * s}" fill="#fff" opacity=".18"/>` +
    `<ellipse cx="${cx}" cy="${cy + .9 * s}" rx="${1.6 * s}" ry="${2.3 * s}" fill="#111"/>` +
    aC(cx - 1.2 * s, cy - 1.3 * s, 1.35 * s, "#fff") + aC(cx + 1.3 * s, cy + 2.2 * s, .6 * s, "#fff") +
    `<path d="M${cx - 4.7 * s},${cy - 2.6 * s} Q${cx},${cy - 7 * s} ${cx + 4.7 * s},${cy - 2.9 * s}" fill="none" stroke="#1a1a1a" stroke-width="${1.9 * s}" stroke-linecap="round"/>` +
    (lash ? `<path d="M${cx + (cx < 50 ? -4.6 : 4.6) * s},${cy - 2.7 * s} l${(cx < 50 ? -2 : 2) * s},${-1.6 * s}" stroke="#1a1a1a" stroke-width="${1.3 * s}" stroke-linecap="round"/>` : "");
}
const aBlush = (y = 34.5, c = "#ff6f6f") => `<path d="M37.5,${y} l1.4,-1.6 M39.5,${y + .3} l1.4,-1.6 M59.1,${y + .3} l1.4,-1.6 M61.1,${y} l1.4,-1.6" stroke="${c}" stroke-width="1" stroke-linecap="round"/>`;
const aWhiskers = y => `<path d="M38,${y} l-8,-1.5 M38,${y + 2.5} l-8,1 M62,${y} l8,-1.5 M62,${y + 2.5} l8,1" stroke="#555" stroke-width=".8" stroke-linecap="round"/>`;
function aMouth(m) {
  if (m === "shout") return `<ellipse cx="50" cy="37" rx="3" ry="3.4" fill="#c0392b" ${A_OUT}/><ellipse cx="50" cy="38.8" rx="1.8" ry="1.1" fill="#ff8a80"/>`;
  return `<path d="M46.8,36 Q50,39.6 53.2,36Z" fill="#c0392b" stroke="${A_OL}" stroke-width=".9" stroke-linejoin="round"/>`;
}

/* heads: a child with a hair style, or an animal (A_ANIMALS gives the animal's limb colour) */
const A_FACE = "M33.5,22 Q33.5,40 50,42 Q66.5,40 66.5,22 Q66.5,8 50,8 Q33.5,8 33.5,22Z";
function aKidHead(o) {
  const h = o.hair, st = o.hs || "spiky", s = [];
  if (st === "spiky") s.push(`<polygon points="50,26 ${aPts([...Array(15)].map((_, i) => { const a = (-205 + i * 230 / 14) * Math.PI / 180, r = i % 2 ? 25 : 17.5; return [50 + r * Math.cos(a), 23 + r * Math.sin(a)]; }))}" fill="${h}" ${A_OUT} stroke-linejoin="round"/>`);
  if (st === "pony") s.push(`<ellipse cx="69" cy="22" rx="6" ry="13" fill="${h}" ${A_OUT} transform="rotate(-28 69 22)"/>`);
  if (st === "curly") s.push(...[...Array(12)].map((_, i) => { const a = (-200 + i * 20) * Math.PI / 180; return aC(50 + 15.5 * Math.cos(a), 21 + 15.5 * Math.sin(a), 5.6, h, A_OUT); }));
  if (st === "neat" || st === "pony" || st === "curly") s.push(aC(50, 21, 17.6, h, st === "curly" ? "" : A_OUT));
  s.push(aC(33.4, 27, 3.2, o.skin, A_OUT), aC(66.6, 27, 3.2, o.skin, A_OUT), `<path d="${A_FACE}" fill="${o.skin}" ${A_OUT}/>`);
  if (st === "spiky") s.push(`<polygon points="32.5,25 34,11 50,5 66,11 67.5,25 63.5,17 60.5,22.5 56.5,14.5 53,21.5 49,14 45,21.5 41,15 37,23" fill="${h}" ${A_OUT} stroke-linejoin="round"/>`);
  else if (st === "neat" || st === "pony") s.push(`<path d="M33,25 Q32,6 50,5 Q68,6 67,25 Q63,15 55,13.5 Q48,19.5 39,17.5 Q35.5,20.5 33,25Z" fill="${h}" ${A_OUT} stroke-linejoin="round"/>`);
  else if (st === "buzz") s.push(`<path d="M34,21 Q34,7 50,7 Q66,7 66,21 Q62,13 50,13 Q38,13 34,21Z" fill="${h}" ${A_OUT}/>`);
  else if (st === "curly") s.push(...[37.5, 42.5, 47.5, 52.5, 57.5, 62.5].map((x, i) => aC(x, 12.5 + (i % 2) * 1.6, 3.9, h, A_OUT)));
  if (st === "pony") s.push(aC(64, 12, 2.4, o.band || "#e91e63", A_OUT));
  if (st !== "buzz") s.push(`<path d="M41,10 Q50,6.5 59,10" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".35"/>`);
  s.push(aEye(43.3, 28.5, o.eyes, 1, o.lash), aEye(56.7, 28.5, o.eyes, 1, o.lash), aBlush(), aMouth(o.mouth));
  return s.join("");
}
const A_ANIMALS = {
  dragon: { skin: "#43a047", head: () => `<polygon points="39,14 32,0 46,10" fill="#ffd54f" ${A_OUT}/><polygon points="61,14 68,0 54,10" fill="#ffd54f" ${A_OUT}/>` +
    `<polygon points="45,10 50,2 55,10" fill="#e53935" ${A_OUT}/>` + aC(50, 24, 17, "#43a047", A_OUT) +
    `<ellipse cx="50" cy="34" rx="10.5" ry="6.5" fill="#a5d6a7" ${A_OUT}/>` + aC(46.5, 32.5, 1.1, "#1b5e20") + aC(53.5, 32.5, 1.1, "#1b5e20") +
    aEye(43, 22.5, "#e65100", 1.05) + aEye(57, 22.5, "#e65100", 1.05) +
    `<path d="M45,37 Q50,40.5 55,37" fill="none" stroke="#1b5e20" stroke-width="1.4" stroke-linecap="round"/><polygon points="47,37.6 48.6,37.9 47.8,39.6" fill="#fff"/>`,
    back: () => `<path d="M42,70 Q20,78 16,62 Q14,56 20,54" fill="none" stroke="${A_OL}" stroke-width="9" stroke-linecap="round"/><path d="M42,70 Q20,78 16,62 Q14,56 20,54" fill="none" stroke="#43a047" stroke-width="7" stroke-linecap="round"/><polygon points="16,49 23,58 11,58" fill="#e53935" ${A_OUT}/>` +
      `<path d="M40,46 L14,30 L20,42 L9,44 L22,52 L16,59 L38,57Z" fill="#2e7d32" ${A_OUT} stroke-linejoin="round"/><path d="M60,46 L86,30 L80,42 L91,44 L78,52 L84,59 L62,57Z" fill="#2e7d32" ${A_OUT} stroke-linejoin="round"/>` },
  panda: { skin: "#222", head: () => aC(37, 11, 6, "#222") + aC(63, 11, 6, "#222") + aC(50, 25, 17, "#fff", A_OUT) +
    `<ellipse cx="43" cy="26" rx="5.6" ry="6.8" fill="#222" transform="rotate(20 43 26)"/><ellipse cx="57" cy="26" rx="5.6" ry="6.8" fill="#222" transform="rotate(-20 57 26)"/>` +
    aEye(43.3, 26.5, "#5d4037", .9) + aEye(56.7, 26.5, "#5d4037", .9) + `<ellipse cx="50" cy="33" rx="2.4" ry="1.7" fill="#222"/>` +
    `<path d="M47,35.5 Q50,38.5 53,35.5" fill="none" stroke="#222" stroke-width="1.3" stroke-linecap="round"/>` + aBlush(35, "#ff8f8f") },
  lion: { skin: "#f4c542", head: () => [...Array(12)].map((_, i) => { const a = i * Math.PI / 6; return aC(50 + 16 * Math.cos(a), 25 + 16 * Math.sin(a), 7, "#d35400", A_OUT); }).join("") +
    aC(50, 25, 16, "#d35400") + aC(38, 12, 4.2, "#f4c542", A_OUT) + aC(62, 12, 4.2, "#f4c542", A_OUT) + aC(50, 26, 13.5, "#f4c542", A_OUT) +
    aEye(44.3, 24.5, "#8d6e00", .85) + aEye(55.7, 24.5, "#8d6e00", .85) + `<polygon points="47.5,30 52.5,30 50,33" fill="#5d4037"/>` +
    `<path d="M50,33 L50,34.5 M46.5,35 Q48.5,37 50,34.5 Q51.5,37 53.5,35" fill="none" stroke="#5d4037" stroke-width="1.3" stroke-linecap="round"/>`,
    back: () => `<path d="M42,72 Q24,80 20,66" fill="none" stroke="${A_OL}" stroke-width="5.2" stroke-linecap="round"/><path d="M42,72 Q24,80 20,66" fill="none" stroke="#f4c542" stroke-width="3" stroke-linecap="round"/>` + aC(19.5, 63.5, 4, "#d35400", A_OUT) },
  tiger: { skin: "#f39c12", head: () => aTigerHead("#f39c12", "stripes"), back: () => aTail("#f39c12", "#222") },
  jaguar: { skin: "#e8b04a", head: () => aTigerHead("#e8b04a", "spots"), back: () => aTail("#e8b04a") },
  cat: { skin: "#f0a04b", head: () => `<polygon points="34,19 35,3 47,11" fill="#f0a04b" ${A_OUT} stroke-linejoin="round"/><polygon points="37,15 37.5,7.5 43,11" fill="#f8bbd0"/>` +
    `<polygon points="66,19 65,3 53,11" fill="#f0a04b" ${A_OUT} stroke-linejoin="round"/><polygon points="63,15 62.5,7.5 57,11" fill="#f8bbd0"/>` +
    `<ellipse cx="50" cy="26" rx="17" ry="15.5" fill="#f0a04b" ${A_OUT}/>` + aL([[47, 11.5], [47.5, 16]], "#c96d1c", 1.8, false) + aL([[50, 11], [50, 16]], "#c96d1c", 1.8, false) + aL([[53, 11.5], [52.5, 16]], "#c96d1c", 1.8, false) +
    `<ellipse cx="50" cy="33" rx="7" ry="5" fill="#fff3e0"/>` + aEye(43, 25, "#43a047", .9) + aEye(57, 25, "#43a047", .9) +
    `<polygon points="48.3,30.5 51.7,30.5 50,32.3" fill="#ec407a"/><path d="M50,32.3 L50,33.5 M47.2,34 Q48.6,35.6 50,33.5 Q51.4,35.6 52.8,34" fill="none" stroke="#5d4037" stroke-width="1" stroke-linecap="round"/>` + aWhiskers(31),
    back: () => aTail("#f0a04b", "#c96d1c") },
  wolf: { skin: "#78909c", head: () => `<polygon points="34,17 34,-2 47,9" fill="#78909c" ${A_OUT} stroke-linejoin="round"/><polygon points="37,13 37,4 43,9" fill="#cfd8dc"/>` +
    `<polygon points="66,17 66,-2 53,9" fill="#78909c" ${A_OUT} stroke-linejoin="round"/><polygon points="63,13 63,4 57,9" fill="#cfd8dc"/>` +
    `<path d="M33,18 Q33,7 50,7 Q67,7 67,18 L71,27 L65,29 Q60,40 50,41 Q40,40 35,29 L29,27Z" fill="#78909c" ${A_OUT} stroke-linejoin="round"/>` +
    `<ellipse cx="50" cy="33" rx="8.5" ry="7.5" fill="#eceff1" ${A_OUT}/><ellipse cx="50" cy="29.5" rx="2.8" ry="1.9" fill="#222"/>` +
    `<path d="M50,31.5 L50,33.5 M46.8,35 Q48.5,36.8 50,33.5 Q51.5,36.8 53.2,35" fill="none" stroke="#37474f" stroke-width="1" stroke-linecap="round"/>` +
    aEye(43, 21.5, "#ffb300", .85) + aEye(57, 21.5, "#ffb300", .85),
    back: () => `<path d="M42,72 Q22,78 18,62" fill="none" stroke="${A_OL}" stroke-width="10" stroke-linecap="round"/><path d="M42,72 Q22,78 18,62" fill="none" stroke="#78909c" stroke-width="8" stroke-linecap="round"/>` + aC(18.5, 62, 3.6, "#eceff1") },
  mouse: { skin: "#b0b0b0", head: () => aC(33, 12, 9, "#b0b0b0", A_OUT) + aC(33, 12, 5.5, "#f8bbd0") + aC(67, 12, 9, "#b0b0b0", A_OUT) + aC(67, 12, 5.5, "#f8bbd0") +
    `<ellipse cx="50" cy="27" rx="15" ry="14" fill="#b0b0b0" ${A_OUT}/>` + aEye(44, 25.5, "#3e2723", .85) + aEye(56, 25.5, "#3e2723", .85) +
    aC(50, 32, 2, "#ec407a", A_OUT) + `<rect x="48.4" y="35" width="3.2" height="2.6" rx=".6" fill="#fff" ${A_OUT}/>` + aWhiskers(32),
    back: () => `<path d="M42,72 Q26,82 18,70 Q12,60 22,58" fill="none" stroke="#f48fb1" stroke-width="2" stroke-linecap="round"/>` },
  trex: { skin: "#7cb342", head: () => `<ellipse cx="50" cy="24" rx="18.5" ry="15.5" fill="#7cb342" ${A_OUT}/>` + aC(44, 11, 2, "#558b2f") + aC(50, 9.5, 2.2, "#558b2f") + aC(56, 11, 2, "#558b2f") +
    `<ellipse cx="50" cy="33" rx="13.5" ry="6.5" fill="#dcedc8" ${A_OUT}/>` + `<path d="M38,32 Q50,38 62,32" fill="none" stroke="${A_OL}" stroke-width="1.2"/>` +
    [41, 45, 49, 53, 57].map(x => `<polygon points="${x},${32.6 + Math.abs(x - 50) * -.12 + 1.6} ${x + 2.4},${33 + 1.8 - Math.abs(x - 50) * .1} ${x + 1.2},${36.2 - Math.abs(x - 50) * .1}" fill="#fff"/>`).join("") +
    aC(46, 28.5, .9, "#33691e") + aC(54, 28.5, .9, "#33691e") + aEye(42, 20, "#ff7043", .85) + aEye(58, 20, "#ff7043", .85),
    back: () => `<path d="M42,74 Q22,84 10,74" fill="none" stroke="${A_OL}" stroke-width="10" stroke-linecap="round"/><path d="M42,74 Q22,84 10,74" fill="none" stroke="#7cb342" stroke-width="8" stroke-linecap="round"/>` },
  chick: { skin: "#ffd54f", head: () => aC(50, 25, 16, "#ffd54f", A_OUT) +
    `<path d="M34,18 Q34,4 50,3 Q66,4 66,18 L62,13.5 L58,18.5 L54,13.5 L50,18.5 L46,13.5 L42,18.5 L38,13.5Z" fill="#fffde7" ${A_OUT} stroke-linejoin="round"/>` +
    aEye(43.5, 25, "#3e2723", .85) + aEye(56.5, 25, "#3e2723", .85) + `<polygon points="46,31 54,31 50,36" fill="#ff9800" ${A_OUT} stroke-linejoin="round"/>` + aBlush(33.5) },
  canary: { skin: "#ffe000", head: () => `<path d="M47,10 Q46,2 50,1 Q49,6 52,9 Q55,3 58,4 Q54,7 54,11" fill="#ffe000" ${A_OUT}/>` + aC(50, 25, 16, "#ffe000", A_OUT) +
    aEye(43.5, 24, "#1b5e20", .85) + aEye(56.5, 24, "#1b5e20", .85) + `<polygon points="46,30.5 54,30.5 50,35.5" fill="#ff9800" ${A_OUT} stroke-linejoin="round"/>` + aBlush(33) },
  eagle: { skin: "#6d4c41", head: () => `<polygon points="35,30 27,34 34,24" fill="#fff" ${A_OUT}/><polygon points="65,30 73,34 66,24" fill="#fff" ${A_OUT}/>` + aC(50, 24, 16.5, "#fff", A_OUT) +
    aEye(43, 23, "#ffb300", .8) + aEye(57, 23, "#ffb300", .8) +
    `<path d="M38,17 L47,20 M62,17 L53,20" stroke="${A_OL}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M44,28.5 Q50,26 56,28.5 Q58.5,34 51.5,39 Q51.5,34.5 44,31Z" fill="#ffb300" ${A_OUT} stroke-linejoin="round"/>` },
  bull: { skin: "#8d6e63", head: () => `<path d="M37,15 Q24,15 22,2 Q29,9 41,9.5Z" fill="#fff3e0" ${A_OUT} stroke-linejoin="round"/><path d="M63,15 Q76,15 78,2 Q71,9 59,9.5Z" fill="#fff3e0" ${A_OUT} stroke-linejoin="round"/>` +
    `<ellipse cx="31" cy="21" rx="6" ry="3" fill="#8d6e63" ${A_OUT} transform="rotate(20 31 21)"/><ellipse cx="69" cy="21" rx="6" ry="3" fill="#8d6e63" ${A_OUT} transform="rotate(-20 69 21)"/>` +
    `<ellipse cx="50" cy="24" rx="16" ry="16.5" fill="#8d6e63" ${A_OUT}/>` + aC(47, 10, 3.2, "#5d4037") + aC(52, 9.5, 3.4, "#5d4037") +
    `<ellipse cx="50" cy="34" rx="10.5" ry="6.5" fill="#f8bbd0" ${A_OUT}/><ellipse cx="46.5" cy="34" rx="1.6" ry="2.3" fill="#5d4037"/><ellipse cx="53.5" cy="34" rx="1.6" ry="2.3" fill="#5d4037"/>` +
    aEye(43, 22.5, "#3e2723", .85) + aEye(57, 22.5, "#3e2723", .85) + `<circle cx="50" cy="40.5" r="2.6" fill="none" stroke="#ffc107" stroke-width="1.4"/>` },
  fox: { skin: "#ef6c00", head: () => `<polygon points="33,18 33,0 47,9" fill="#ef6c00" ${A_OUT} stroke-linejoin="round"/><polygon points="33,6 33,0 38,3.3" fill="#3e2723"/>` +
    `<polygon points="67,18 67,0 53,9" fill="#ef6c00" ${A_OUT} stroke-linejoin="round"/><polygon points="67,6 67,0 62,3.3" fill="#3e2723"/>` +
    `<path d="M32,20 Q33,7 50,7 Q67,7 68,20 Q69,31 50,41 Q31,31 32,20Z" fill="#ef6c00" ${A_OUT}/>` +
    `<path d="M32.5,24 Q42,27 50,40.5 Q58,27 67.5,24 Q66,33 50,41 Q34,33 32.5,24Z" fill="#fff"/>` +
    `<ellipse cx="50" cy="36.5" rx="2.4" ry="1.7" fill="#222"/>` + aEye(43, 22, "#6d4c41", .85) + aEye(57, 22, "#6d4c41", .85),
    back: () => `<path d="M42,72 Q20,80 16,60" fill="none" stroke="${A_OL}" stroke-width="12.5" stroke-linecap="round"/><path d="M42,72 Q20,80 16,60" fill="none" stroke="#ef6c00" stroke-width="10.5" stroke-linecap="round"/>` + aC(16.5, 60, 5, "#fff") },
  penguin: { skin: "#263238", head: () => aC(50, 25, 16.5, "#263238", A_OUT) +
    `<path d="M50,15 Q43,8 38,15 Q33,23 38,32 Q44,40 50,40 Q56,40 62,32 Q67,23 62,15 Q57,8 50,15Z" fill="#fff"/>` +
    aEye(44, 24, "#263238", .85) + aEye(56, 24, "#263238", .85) + `<polygon points="46,30.5 54,30.5 50,35.5" fill="#ff9800" ${A_OUT} stroke-linejoin="round"/>` + aBlush(33.5) },
  bear: { skin: "#8d6e63", head: () => aBearHead("#8d6e63", "#d7ccc8") },
  polar: { skin: "#eceff1", head: () => aBearHead("#f5f5f5", "#e0e0e0") },
  rabbit: { skin: "#f5f5f5", head: () => `<ellipse cx="42" cy="2" rx="4.8" ry="13" fill="#f5f5f5" ${A_OUT} transform="rotate(-10 42 2)"/><ellipse cx="42" cy="3" rx="2.2" ry="9" fill="#f8bbd0" transform="rotate(-10 42 3)"/>` +
    `<ellipse cx="58" cy="2" rx="4.8" ry="13" fill="#f5f5f5" ${A_OUT} transform="rotate(10 58 2)"/><ellipse cx="58" cy="3" rx="2.2" ry="9" fill="#f8bbd0" transform="rotate(10 58 3)"/>` +
    aC(50, 26, 15.5, "#f5f5f5", A_OUT) + aEye(44, 25, "#6d4c41", .85) + aEye(56, 25, "#6d4c41", .85) +
    `<polygon points="48.3,31 51.7,31 50,33" fill="#ec407a"/><rect x="48.4" y="34.4" width="3.2" height="3.2" rx=".6" fill="#fff" ${A_OUT}/>` + aBlush(33.5, "#ff8f8f") },
  monkey: { skin: "#795548", head: () => aC(33, 25, 6, "#795548", A_OUT) + aC(33, 25, 3.5, "#ffcc80") + aC(67, 25, 6, "#795548", A_OUT) + aC(67, 25, 3.5, "#ffcc80") +
    aC(50, 24, 16.5, "#795548", A_OUT) + `<path d="M50,17 Q44,11.5 39,17 Q35,22 38,29 Q41,39 50,40 Q59,39 62,29 Q65,22 61,17 Q56,11.5 50,17Z" fill="#ffcc80" ${A_OUT}/>` +
    aEye(44.3, 24, "#3e2723", .8) + aEye(55.7, 24, "#3e2723", .8) + aC(48.5, 31, .8, "#5d4037") + aC(51.5, 31, .8, "#5d4037") +
    `<path d="M45,34 Q50,38.5 55,34" fill="none" stroke="#5d4037" stroke-width="1.3" stroke-linecap="round"/>`,
    back: () => `<path d="M42,72 Q24,82 16,70 Q10,58 20,58 Q26,60 22,66" fill="none" stroke="${A_OL}" stroke-width="5.2" stroke-linecap="round"/><path d="M42,72 Q24,82 16,70 Q10,58 20,58 Q26,60 22,66" fill="none" stroke="#795548" stroke-width="3" stroke-linecap="round"/>` },
  rooster: { skin: "#263238", head: () => aC(44, 7, 4.5, "#e53935", A_OUT) + aC(50, 4.5, 5, "#e53935", A_OUT) + aC(56, 7, 4.5, "#e53935", A_OUT) +
    aC(50, 24, 16, "#263238", A_OUT) + aC(42, 33, 1.6, "#ffeb3b") + aC(58, 33, 1.6, "#29b6f6") + aC(45, 13, 1.4, "#e53935") + aC(55, 13, 1.4, "#29b6f6") +
    aEye(43.5, 22.5, "#3e2723", .85) + aEye(56.5, 22.5, "#3e2723", .85) +
    `<ellipse cx="50" cy="37" rx="2.6" ry="4" fill="#e53935" ${A_OUT}/><polygon points="45.5,28.5 54.5,28.5 50,33.5" fill="#ffc107" ${A_OUT} stroke-linejoin="round"/>`,
    back: () => `<path d="M40,70 Q18,66 18,48 Q26,58 40,62Z" fill="#263238" ${A_OUT}/><path d="M40,66 Q22,60 26,42 Q30,56 41,60Z" fill="#e53935" ${A_OUT}/>` },
  // France's mascot: a white hen (like Ettie, the hen of the 2019 Women's World Cup in France), a blue-white-red bow
  hen: { skin: "#fff8e1", head: () => aC(46, 9, 4.2, "#e53935", A_OUT) + aC(52.5, 7.5, 4.6, "#e53935", A_OUT) +
    aC(50, 25, 16, "#fff8e1", A_OUT) + aEye(43.5, 23.5, "#3e2723", .85) + aEye(56.5, 23.5, "#3e2723", .85) +
    `<path d="M40.5,19.5 l-2,-2 M42.5,18.6 l-1.2,-2.6 M59.5,19.5 l2,-2 M57.5,18.6 l1.2,-2.6" stroke="${A_OL}" stroke-width=".9" stroke-linecap="round"/>` +
    `<ellipse cx="50" cy="36.5" rx="2.2" ry="3.2" fill="#e53935" ${A_OUT}/><polygon points="46,29 54,29 50,34" fill="#ffa000" ${A_OUT} stroke-linejoin="round"/>` + aBlush(33.5, "#ff8f8f") +
    `<path d="M60,12 L67,8 L67,16Z" fill="#ED2939" ${A_OUT}/><path d="M60,12 L53,8 L53,16Z" fill="#002654" ${A_OUT}/>` + aC(60, 12, 2.2, "#fff", A_OUT),
    back: () => `<path d="M40,70 Q22,68 21,54 Q29,61 40,63Z" fill="#fff8e1" ${A_OUT}/><path d="M40,66 Q27,62 28,50 Q33,59 41,61Z" fill="#ffe0b2" ${A_OUT}/>` },
  // South Korea's: a tiger like Hodori (Seoul 1988) in his sangmo, the farmers' dance hat with its long twirling ribbon (no crown: not the Tactic Tiger)
  hodori: { skin: "#f57c00", head: () => aTigerHead("#f57c00", "stripes") +
    `<path d="M50,1 C60,-15 82,-12 78,0 C75,9 88,13 94,4" fill="none" stroke="${A_OL}" stroke-width="5" stroke-linecap="round"/><path d="M50,1 C60,-15 82,-12 78,0 C75,9 88,13 94,4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` +
    `<ellipse cx="50" cy="10" rx="15" ry="3.6" fill="#212121" ${A_OUT}/><path d="M41,10 Q41,1 50,1 Q59,1 59,10Z" fill="#212121" ${A_OUT}/>` + aC(50, 1, 2.4, "#ffc107", A_OUT),
    back: () => aTail("#f57c00", "#222") },
  // Switzerland's: a Saint Bernard with the little barrel under his chin
  stbernard: { skin: "#b5651d", head: () => `<ellipse cx="33" cy="27" rx="5.5" ry="10" fill="#8d4a17" ${A_OUT} transform="rotate(14 33 27)"/><ellipse cx="67" cy="27" rx="5.5" ry="10" fill="#8d4a17" ${A_OUT} transform="rotate(-14 67 27)"/>` +
    aC(50, 25, 16.5, "#fff", A_OUT) + `<path d="M35,20 Q36,9 46.5,9 L47.5,30 Q40,31 35,24Z M65,20 Q64,9 53.5,9 L52.5,30 Q60,31 65,24Z" fill="#b5651d"/>` +
    aEye(43, 23, "#5d4037", .85) + aEye(57, 23, "#5d4037", .85) + `<ellipse cx="50" cy="33.5" rx="8" ry="5.6" fill="#fff" ${A_OUT}/><ellipse cx="50" cy="30.5" rx="3" ry="2.1" fill="#222"/>` +
    `<path d="M50,32.5 V34.5 M46.5,35.5 Q48.4,37.4 50,34.5 Q51.6,37.4 53.5,35.5" fill="none" stroke="#3e2723" stroke-width="1" stroke-linecap="round"/><ellipse cx="51.6" cy="38.3" rx="1.6" ry="2" fill="#f48fb1"/>` +
    `<path d="M44,42.5 H56" stroke="#c62828" stroke-width="2.2"/><rect x="45" y="43" width="10" height="7.5" rx="2.4" fill="#a1662f" ${A_OUT}/><path d="M47.5,43.2 V50.3 M52.5,43.2 V50.3" stroke="#5d3613" stroke-width="1"/>`,
    back: () => `<path d="M42,72 Q24,80 20,64" fill="none" stroke="${A_OL}" stroke-width="7.2" stroke-linecap="round"/><path d="M42,72 Q24,80 20,64" fill="none" stroke="#b5651d" stroke-width="5" stroke-linecap="round"/>` + aC(20, 63, 3, "#fff") },
  // Cape Verde's "Blue Sharks": a blue shark, white belly, a grin full of (friendly) teeth
  shark: { skin: "#1e88e5", head: () => `<path d="M44,11 Q49,-2 58,-5 Q55,4 57,11Z" fill="#1565c0" ${A_OUT} stroke-linejoin="round"/>` +
    `<ellipse cx="50" cy="25" rx="18" ry="16" fill="#1e88e5" ${A_OUT}/><path d="M33,28 Q50,46 67,28 Q50,35 33,28Z" fill="#eceff1"/>` +
    `<path d="M35.5,20 q-2,3 0,6 M38,19 q-2,3.5 0,7 M64.5,20 q2,3 0,6 M62,19 q2,3.5 0,7" fill="none" stroke="#0d47a1" stroke-width="1" stroke-linecap="round"/>` +
    aEye(44, 21, "#1a237e", .8) + aEye(56, 21, "#1a237e", .8) +
    `<path d="M41,30 Q50,39 59,30 Q50,33 41,30Z" fill="#fff" ${A_OUT} stroke-linejoin="round"/><path d="M44,31.2 l1.3,2.4 l1.3,-2 l1.4,2.4 l1.3,-2.2 l1.3,2.4 l1.3,-2.2 l1.4,2.4 l1.3,-2" fill="none" stroke="${A_OL}" stroke-width=".6"/>`,
    back: () => `<path d="M42,72 Q28,74 22,66 L12,52 Q22,58 24,62 L26,50 Q30,62 42,66Z" fill="#1e88e5" ${A_OUT} stroke-linejoin="round"/>` },
  // Germany's: a black eagle (like Paule), a feather tuft, a big hooked yellow beak, feathered wings
  eagleb: { skin: "#ffc107", head: () => `<path d="M44,10 Q42,0 47,-3 Q48,4 50,7 Q51,-1 56,-3 Q55,5 53,10Z" fill="#212121" ${A_OUT} stroke-linejoin="round"/>` +
    aC(50, 25, 16.5, "#212121", A_OUT) + `<ellipse cx="50" cy="31" rx="10" ry="8" fill="#37474f"/>` +
    aEye(43, 22, "#ffb300", .85) + aEye(57, 22, "#ffb300", .85) +
    `<path d="M43,28 Q50,25.5 57,28 Q60,35 53,41 Q52.5,36.5 50,35 Q46,33 43,31Z" fill="#ffc107" ${A_OUT} stroke-linejoin="round"/><path d="M45.5,31.5 Q50,33 53,36" fill="none" stroke="#e65100" stroke-width=".9"/>`,
    back: () => [-1, 1].map(d => [196, 212, 228, 244].map(a => { const r = a * Math.PI / 180, x = 50 - d * (10 - 16 * Math.cos(r)), y = 50 + 16 * Math.sin(r);
      return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="16" ry="4.6" fill="${a % 32 ? "#212121" : "#37474f"}" ${A_OUT} transform="rotate(${d < 0 ? 180 - a : a} ${x.toFixed(1)} ${y.toFixed(1)})"/>`; }).join("")).join("") },
  // the Netherlands': an orange lion (the KNVB's), a spiky flame-orange mane: England's lion has a round red-brown one
  lionnl: { skin: "#ff9800", head: () => `<polygon points="${aPts([...Array(28)].map((_, i) => { const a = i * Math.PI / 14, r = i % 2 ? 17 : 25; return [50 + r * Math.cos(a), 25 + r * Math.sin(a)]; }))}" fill="#e65100" ${A_OUT} stroke-linejoin="round"/>` +
    aC(38, 12.5, 4.2, "#ffa726", A_OUT) + aC(62, 12.5, 4.2, "#ffa726", A_OUT) + aC(50, 26, 14, "#ffa726", A_OUT) + `<ellipse cx="50" cy="33" rx="7.5" ry="5" fill="#ffe0b2"/>` +
    aEye(44.3, 24.5, "#4e342e", .85) + aEye(55.7, 24.5, "#4e342e", .85) + `<polygon points="47.5,29.5 52.5,29.5 50,32.5" fill="#5d4037"/>` +
    `<path d="M50,32.5 L50,34 M46.5,34.5 Q48.5,36.5 50,34 Q51.5,36.5 53.5,34.5" fill="none" stroke="#5d4037" stroke-width="1.3" stroke-linecap="round"/>` + aBlush(33, "#ff7043"),
    back: () => `<path d="M42,72 Q24,80 20,66" fill="none" stroke="${A_OL}" stroke-width="5.2" stroke-linecap="round"/><path d="M42,72 Q24,80 20,66" fill="none" stroke="#ff9800" stroke-width="3" stroke-linecap="round"/><path d="M20,68 Q12,64 15,56 Q18,60 20,58 Q22,62 26,59 Q27,66 20,68Z" fill="#e65100" ${A_OUT} stroke-linejoin="round"/>` },
};
function aTigerHead(col, marks) {
  return aC(36, 11, 5.5, col, A_OUT) + aC(36, 11, 2.8, "#fff") + aC(64, 11, 5.5, col, A_OUT) + aC(64, 11, 2.8, "#fff") +
    `<ellipse cx="50" cy="25" rx="17" ry="16" fill="${col}" ${A_OUT}/>` +
    (marks === "stripes" ? aL([[46, 10], [47, 15]], "#222", 2, false) + aL([[50, 9], [50, 15]], "#222", 2, false) + aL([[54, 10], [53, 15]], "#222", 2, false) +
      aL([[33.5, 22], [39, 23]], "#222", 1.8, false) + aL([[33.5, 27], [39, 27]], "#222", 1.8, false) + aL([[66.5, 22], [61, 23]], "#222", 1.8, false) + aL([[66.5, 27], [61, 27]], "#222", 1.8, false)
      : [[45, 12], [52, 11], [37, 21], [63, 21], [36, 29], [64, 29]].map(([x, y]) => aC(x, y, 1.7, "none", `stroke="#5d4037" stroke-width="1.2"`)).join("")) +
    `<ellipse cx="50" cy="33" rx="9" ry="6.5" fill="#fff" ${A_OUT}/>` + aEye(43, 23, "#7cb342", .9) + aEye(57, 23, "#7cb342", .9) +
    `<polygon points="47.5,29.5 52.5,29.5 50,32" fill="#ec407a"/><path d="M50,32 L50,33.5 M46.5,34.5 Q48.5,36.5 50,33.5 Q51.5,36.5 53.5,34.5" fill="none" stroke="#5d4037" stroke-width="1.1" stroke-linecap="round"/>`;
}
function aBearHead(col, light) {
  return aC(36, 11, 5.5, col, A_OUT) + aC(36, 11, 3, light) + aC(64, 11, 5.5, col, A_OUT) + aC(64, 11, 3, light) + aC(50, 25, 16.5, col, A_OUT) +
    `<ellipse cx="50" cy="32" rx="7.5" ry="5.5" fill="${light}" ${A_OUT}/><ellipse cx="50" cy="29.8" rx="2.6" ry="1.8" fill="#222"/>` +
    `<path d="M50,31.6 L50,33.4 M47,34.6 Q48.6,36.2 50,33.4 Q51.4,36.2 53,34.6" fill="none" stroke="#3e2723" stroke-width="1" stroke-linecap="round"/>` +
    aEye(43, 23.5, "#3e2723", .8) + aEye(57, 23.5, "#3e2723", .8);
}
function aTail(col, stripe) {
  const d = "M42,72 Q22,80 18,64 Q16,56 22,54";
  return `<path d="${d}" fill="none" stroke="${A_OL}" stroke-width="6.2" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round"/>` +
    (stripe ? `<path d="${d}" fill="none" stroke="${stripe}" stroke-width="4" stroke-dasharray="2.5 5"/>` : "");
}
function aCrown() {
  return `<polygon points="39,3 37,-10 44,-4 50,-14 56,-4 63,-10 61,3" fill="#ffc107" ${A_OUT} stroke-linejoin="round"/>` + aC(50, -2, 1.8, "#e53935") + aC(43.5, -.5, 1.3, "#29b6f6") + aC(56.5, -.5, 1.3, "#29b6f6");
}
function aCup() {
  return `<path d="M44,-12 Q38,-12 39,-7 Q40,-4 44.5,-4.5 M56,-12 Q62,-12 61,-7 Q60,-4 55.5,-4.5" fill="none" stroke="${A_OL}" stroke-width="3.2"/>` +
    `<path d="M44,-12 Q38,-12 39,-7 Q40,-4 44.5,-4.5 M56,-12 Q62,-12 61,-7 Q60,-4 55.5,-4.5" fill="none" stroke="#ffc107" stroke-width="1.6"/>` +
    `<path d="M43,-14 H57 Q57,-3 50,-1.5 Q43,-3 43,-14Z" fill="#ffc107" ${A_OUT}/><rect x="48.5" y="-2" width="3" height="4" fill="#ffb300" ${A_OUT}/>` +
    `<rect x="45" y="1.5" width="10" height="3" rx="1" fill="#ffb300" ${A_OUT}/><path d="M46,-12 Q46,-6 49,-4" fill="none" stroke="#fff" stroke-width="1" opacity=".7"/>`;
}

/* poses: back arm, front arm, back leg, front leg ([shoulder or hip, elbow or knee, hand or foot]), boots [x, y, turn],
   the ball (f = football, b = basketball), dy = a jump (moves the whole figure up), over = arms drawn over the head */
const A_POSES = {
  kick: { ba: [[39, 49], [30, 58], [34, 66]], fa: [[61, 49], [70, 53], [75, 45]], bl: [[45, 78], [43, 91], [42, 103]], bb: [40, 107, 0],
    fl: [[55, 78], [64, 87], [72, 95]], fb: [75, 98, 40], ball: ["f", 87, 103, 8.5] },
  run: { ba: [[39, 49], [31, 57], [25, 52]], fa: [[61, 49], [69, 43], [75, 48]], bl: [[45, 78], [37, 87], [28, 91]], bb: [25, 92, -25],
    fl: [[55, 78], [60, 91], [58, 103]], fb: [61, 107, 0], ball: ["f", 77, 104, 8] },
  header: { dy: -8, ba: [[39, 49], [29, 44], [23, 36]], fa: [[61, 49], [71, 44], [77, 36]], bl: [[45, 78], [40, 90], [44, 101]], bb: [45, 105, 20],
    fl: [[55, 78], [62, 88], [58, 99]], fb: [61, 102, 20], ball: ["f", 71, 3, 7.5] },
  keeper: { ba: [[39, 49], [28, 40], [21, 29]], fa: [[61, 49], [72, 40], [79, 29]], bl: [[45, 78], [38, 90], [35, 103]], bb: [33, 107, 0],
    fl: [[55, 78], [62, 90], [65, 103]], fb: [67, 107, 0], ball: ["f", 86, 6, 7], gloves: 1 },
  cheer: { ba: [[39, 49], [31, 38], [27, 26]], fa: [[61, 49], [69, 38], [73, 26]], bl: [[45, 78], [43, 91], [41, 103]], bb: [39, 107, 0],
    fl: [[55, 78], [57, 91], [59, 103]], fb: [61, 107, 0], ball: ["f", 81, 104, 8], mouth: "shout" },
  lift: { dy: 4, ba: [[39, 49], [28, 30], [44, -6]], fa: [[61, 49], [72, 30], [56, -6]], bl: [[45, 78], [43, 91], [41, 103]], bb: [39, 107, 0],
    fl: [[55, 78], [57, 91], [59, 103]], fb: [61, 107, 0], over: 1, cup: 1, mouth: "shout" },
  dribble: { bball: 1, ba: [[39, 49], [30, 43], [27, 33]], fa: [[61, 49], [69, 60], [73, 71]], bl: [[44, 80], [42, 92], [40, 103]], bb: [38, 107, 0],
    fl: [[56, 80], [58, 92], [60, 103]], fb: [62, 107, 0], ball: ["b", 76, 97, 9.5] },
  shoot: { bball: 1, dy: -6, ba: [[39, 49], [30, 42], [26, 50]], fa: [[61, 49], [71, 34], [68, 18]], bl: [[44, 80], [40, 92], [44, 102]], bb: [44, 105, 15],
    fl: [[56, 80], [60, 92], [56, 102]], fb: [58, 105, 15], ball: ["b", 70, 8, 9.5], over: 1 },
};

function aFigure(o) {
  if (o.pose === "kit") return aKit(o);
  const P = A_POSES[o.pose], an = o.head && A_ANIMALS[o.head], skin = an ? an.skin : o.skin, s = [], top = [];
  const hand = ([x, y]) => P.gloves || o.gloves ? aC(x, y, 5.6, o.gloves || "#ffeb3b", A_OUT) + aL([[x - 2.4, y - 1.2], [x + 2.4, y - 1.2]], A_OL, .8, false) : aC(x, y, 4.4, skin, A_OUT);
  const boot = ([x, y, rot]) => `<ellipse cx="${x}" cy="${y}" rx="7.5" ry="4.2" fill="${o.boots || (P.bball ? "#fff" : "#222")}" ${A_OUT} transform="rotate(${rot} ${x} ${y})"/>`;
  const leg = (pts, b) => { const [, k, f] = pts, m = [k[0] + (f[0] - k[0]) * .45, k[1] + (f[1] - k[1]) * .45], t = [m[0] + (f[0] - m[0]) * .2, m[1] + (f[1] - m[1]) * .2];
    return aL(pts, skin, 9) + aL([m, f], o.socks, 9, false) + (o.sockTrim && !P.bball ? aL([m, t], o.sockTrim, 9, false) : "") + boot(b); };
  const arm = pts => aL(pts, skin, 7.5) + (P.bball ? "" : aL([pts[0], [pts[0][0] + (pts[1][0] - pts[0][0]) * .5, pts[0][1] + (pts[1][1] - pts[0][1]) * .5]], o.shirt, 8.5, false)) + hand(pts[2]);
  if (an && an.back) s.push(an.back());
  (P.over ? top : s).push(arm(P.ba));
  s.push(leg(P.bl, P.bb), leg(P.fl, P.fb));
  s.push(P.bball ? `<path d="M36,65 h28 v19 q0,3 -3,3 h-7 l-4,-6 l-4,6 h-7 q-3,0 -3,-3z" fill="${o.shorts}" ${A_OUT}/>` + aL([[37.6, 68], [37.6, 85]], o.trim, 2, false) + aL([[62.4, 68], [62.4, 85]], o.trim, 2, false)
    : `<path d="M37,66 h26 v12 q0,4 -4,4 h-5 l-4,-5 l-4,5 h-5 q-4,0 -4,-4z" fill="${o.shorts}" ${A_OUT}/>`);
  const id = "aclip" + (++aUid), torso = `x="36" y="41" width="28" height="29" rx="9"`;
  s.push(`<clipPath id="${id}"><rect ${torso}/></clipPath><rect ${torso} fill="${o.shirt}"/>`,
    `<g clip-path="url(#${id})">${o.stripes ? [41, 50, 59].map(x => `<rect x="${x - 2.6}" y="41" width="5.2" height="29" fill="${o.stripes}"/>`).join("") : ""}<path d="M57,41 Q54,56 58,70 H66 V41Z" fill="#000" opacity=".16"/></g>`,
    `<rect ${torso} fill="none" ${A_OUT}/>`);
  s.push(P.bball ? `<path d="M43,41.5 Q50,49 57,41.5" fill="none" stroke="${o.trim}" stroke-width="2.6"/>` : `<path d="M45,41.5 L50,47 L55,41.5" fill="none" stroke="${o.trim}" stroke-width="2.6" stroke-linejoin="round"/>`);
  if (o.star) s.push(aStar(42, 49, 3.6, o.trim));
  if (o.num !== undefined) s.push(`<text x="50" y="64" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="13" fill="${o.trim}" stroke="${o.numStroke || "none"}" stroke-width=".7" paint-order="stroke">${o.num}</text>`);
  (P.over ? top : s).push(arm(P.fa));
  if (P.ball && !P.over) s.push(P.ball[0] === "f" ? aFootball(...P.ball.slice(1)) : aBasketball(...P.ball.slice(1)));
  s.push(an ? an.head() : aKidHead({ ...o, mouth: o.mouth || P.mouth }));
  if (o.crown) s.push(aCrown());
  if (P.cup) s.push(aCup());
  s.push(...top);
  if (P.ball && P.over) s.push(P.ball[0] === "f" ? aFootball(...P.ball.slice(1)) : aBasketball(...P.ball.slice(1)));
  if (o.pose === "keeper") s.push(`<path d="M76,14 l-7,5 M79,17 l-6,4.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>`);
  return `<g transform="translate(0 ${P.dy || 0})">${s.join("")}</g>`;
}
// the team's kit on its own (the first sticker of a team page, like the shiny badge in a football album)
function aKit(o) {
  const id = "aclip" + (++aUid), shirt = "M28,18 L42,12 Q50,19 58,12 L72,18 L88,38 L76,47 L70,40 L70,92 L30,92 L30,40 L24,47 L12,38Z";
  return `<clipPath id="${id}"><path d="${shirt}"/></clipPath><path d="${shirt}" fill="${o.shirt}"/>` +
    `<g clip-path="url(#${id})">${o.stripes ? [36, 50, 64].map(x => `<rect x="${x - 4.5}" y="0" width="9" height="100" fill="${o.stripes}"/>`).join("") : ""}<path d="M60,12 Q56,50 62,92 H90 V0Z" fill="#000" opacity=".14"/>` +
    `<path d="M88,38 L76,47" stroke="${o.trim}" stroke-width="5"/><path d="M12,38 L24,47" stroke="${o.trim}" stroke-width="5"/></g>` +
    `<path d="${shirt}" fill="none" stroke="${A_OL}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M42,12.5 L50,23 L58,12.5" fill="none" stroke="${o.trim}" stroke-width="3.4" stroke-linejoin="round"/>` +
    (o.star ? aStar(39, 35, 5, o.trim) : "") + (A_CREST[o.bd] ? aCrest(o.bd, 62, 34, .17) : "") +
    `<text x="50" y="76" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="32" fill="${o.trim}" stroke="${o.numStroke || "none"}" stroke-width="1.2" paint-order="stroke">${o.num}</text>` +
    aFootball(80, 100, 10);
}

/* the two clubs' crests, simplified drawings in the spirit of the real ones (the owner asked for them like the flags):
   Benfica = the eagle over a red shield with SLB on a wheel, the motto ribbon below; Vitória SC = a white shield with
   the knight (Afonso Henriques: helmet, sword, round shield) under a crown, VSC below. Centre (60, 79) like the flags */
const A_CREST = {}; A_CREST.slb = `
  <circle r="31" fill="#fff"/><circle r="31" fill="none" stroke="#ffc107" stroke-width="2.4"/><circle r="25" fill="none" stroke="#ffc107" stroke-width="1.2"/>
  ${[...Array(16)].map((_, i) => { const a = i * Math.PI / 8; return `<line x1="${(9 * Math.cos(a)).toFixed(1)}" y1="${(9 * Math.sin(a)).toFixed(1)}" x2="${(25 * Math.cos(a)).toFixed(1)}" y2="${(25 * Math.sin(a)).toFixed(1)}" stroke="#bdbdbd" stroke-width="1.2"/>`; }).join("")}
  <path d="M-16,-17 H16 V3 Q16,18 0,25 Q-16,18 -16,3Z" fill="#E30613" stroke="#ffc107" stroke-width="2"/><path d="M-16,-3 H16" stroke="#fff" stroke-width="2"/>
  <text y="13" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="10" fill="#fff">SLB</text>
  <path d="M0,-30 C-10,-42 -26,-40 -38,-50 C-32,-38 -22,-30 -8,-25Z M0,-30 C10,-42 26,-40 38,-50 C32,-38 22,-30 8,-25Z" fill="#ffc107" stroke="#7a5200" stroke-width="1" stroke-linejoin="round"/>
  <path d="M-6,-24 Q0,-17 6,-24 L4,-34 Q0,-37 -4,-34Z" fill="#ffc107" stroke="#7a5200" stroke-width="1"/><circle cy="-38" r="5" fill="#ffc107" stroke="#7a5200" stroke-width="1"/>
  <path d="M3,-39 L8,-37 L3,-35.5Z" fill="#ff8f00"/><circle cx="1" cy="-39.5" r=".9" fill="#222"/>
  <path d="M-34,30 Q0,42 34,30 L36,39 Q0,52 -36,39Z" fill="#fff" stroke="#E30613" stroke-width="1.5"/>`;
A_CREST.vsc = `
  <polygon points="-16,-40 -16,-50 -8,-44 0,-53 8,-44 16,-50 16,-40" fill="#ffc107" stroke="#7a5200" stroke-width="1" stroke-linejoin="round"/>
  <path d="M-27,-37 H27 V5 Q27,29 0,40 Q-27,29 -27,5Z" fill="#fff" stroke="#111" stroke-width="3.5"/>
  <path d="M-23,-33 H23 V5 Q23,26 0,36 Q-23,26 -23,5Z" fill="none" stroke="#ffc107" stroke-width="1.4"/>
  <path d="M-8,-12 Q-8,-27 0,-28 Q8,-27 8,-12Z" fill="#111"/><rect x="-6" y="-21" width="12" height="2.2" fill="#fff"/><path d="M0,-28 Q6,-36 12,-31 Q6,-31 2,-26Z" fill="#111"/>
  <path d="M-10,-10 H10 L12,14 H-12Z" fill="#111"/><path d="M-6,14 L-7,24 M6,14 L7,24" stroke="#111" stroke-width="4" stroke-linecap="round"/>
  <path d="M15,-26 V12" stroke="#111" stroke-width="2.4"/><path d="M10,-17 H20" stroke="#111" stroke-width="2.4"/>
  <circle cx="-14" cy="2" r="7" fill="#fff" stroke="#111" stroke-width="2.4"/><path d="M-14,-4 V8 M-20,2 H-8" stroke="#111" stroke-width="1.6"/>
  <text y="34" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="7" fill="#111">VSC</text>`;
// a crest (drawn around 0,0, about 76 x 105) at x, y, scaled
const aCrest = (team, x, y, sc) => `<g transform="translate(${x} ${y}) scale(${sc})">${A_CREST[team]}</g>`;
/* South Korea's Taegukgi in a w x h box, after the official construction (Wikimedia's SVG, 144 x 96 units): the red-blue
   taegeuk on the diagonal from top left to bottom right, the trigrams across the diagonals: geon ☰ top left, gam ☵ top
   right, ri ☲ bottom left, gon ☷ bottom right. sc scales the units, d = how far the trigrams sit from the centre */
function aKrFlag(w, h, sc, d) {
  const ang = (Math.atan2(h, w) * 180 / Math.PI).toFixed(2), bar = (x, full) => full ? `M${x},-12v24` : `M${x},-12v11M${x},1v11`;
  const tri = (x0, bits) => bits.map((b, i) => bar(x0 + i * 6, b)).join("");
  return `<rect width="${w}" height="${h}" fill="#fff"/><g transform="translate(${w / 2} ${h / 2}) scale(${sc})" fill="none" stroke="#000" stroke-width="4">` +
    `<path transform="rotate(${ang})" d="${tri(-d - 6, [1, 1, 1])}${tri(d - 6, [0, 0, 0])}"/><path transform="rotate(${-ang})" d="${tri(-d - 6, [1, 0, 1])}${tri(d - 6, [0, 1, 0])}"/>` +
    `<g transform="rotate(${ang})" stroke="none"><circle r="24" fill="#cd2e3a"/><path fill="#0047a0" d="M-24,0a24,24 0 1,0 48,0A12,12 0 1,0 0,0a12,12 0 1,1 -24,0"/></g></g>`;
}
// Cape Verde's flag in a w x h box: blue, a white-red-white band below the middle, ten yellow stars in a ring at 3/8 of the length
function aCvFlag(w, h) {
  const star = (x, y, r) => aStar(x, y, r, "#F7D116");
  return `<rect width="${w}" height="${h}" fill="#003893"/><rect y="${h / 2}" width="${w}" height="${h / 4}" fill="#fff"/><rect y="${h * 7 / 12}" width="${w}" height="${h / 12}" fill="#CF2027"/>` +
    [...Array(10)].map((_, i) => { const a = Math.PI / 2 + i * Math.PI / 5; return star(w * 3 / 8 + h / 4 * Math.cos(a), h * 5 / 8 + h / 4 * Math.sin(a), h / 20); }).join("");
}
const aBands = (w, h, cols) => cols.map((c, i) => `<rect y="${(i * h / cols.length).toFixed(2)}" width="${w}" height="${(h / cols.length + .3).toFixed(2)}" fill="${c}"/>`).join("");
const aSwissCross = (w, h, u) => `<rect width="${w}" height="${h}" fill="#DA291C"/><rect x="${w / 2 - 3 * u}" y="${h / 2 - 10 * u}" width="${6 * u}" height="${20 * u}" fill="#fff"/><rect x="${w / 2 - 10 * u}" y="${h / 2 - 3 * u}" width="${20 * u}" height="${6 * u}" fill="#fff"/>`;
/* backdrops (120 x 158): flags, the clubs' colours with their crests, a pitch, a court, the bosses' night sky */
const A_BACK = {
  kr: aKrFlag(120, 158, 1.05, 66),
  ch: aSwissCross(120, 158, 3.75),
  cv: aCvFlag(120, 158),
  de: aBands(120, 158, ["#000", "#DD0000", "#FFCE00"]),
  nl: aBands(120, 158, ["#AE1C28", "#fff", "#21468B"]),
  pt: `<rect width="120" height="158" fill="#DA291C"/><rect width="46" height="158" fill="#046A38"/>`,
  cn: `<rect width="120" height="158" fill="#DE2910"/>${aStar(96, 22, 11, "#FFDE00")}${aStar(78, 10, 3.5, "#FFDE00")}${aStar(112, 42, 3.5, "#FFDE00")}`,
  br: `<rect width="120" height="158" fill="#009C3B"/><polygon points="60,16 114,79 60,142 6,79" fill="#FFDF00"/><circle cx="60" cy="79" r="29" fill="#002776"/>`,
  en: `<rect width="120" height="158" fill="#fff"/><rect x="49" width="22" height="158" fill="#CE1124"/><rect y="68" width="120" height="22" fill="#CE1124"/>`,
  no: `<rect width="120" height="158" fill="#BA0C2F"/><rect x="30" width="26" height="158" fill="#fff"/><rect y="66" width="120" height="26" fill="#fff"/><rect x="36" width="14" height="158" fill="#00205B"/><rect y="72" width="120" height="14" fill="#00205B"/>`,
  jp: `<rect width="120" height="158" fill="#fff"/><circle cx="60" cy="79" r="34" fill="#BC002D"/>`,
  es: `<rect width="120" height="158" fill="#AA151B"/><rect y="40" width="120" height="78" fill="#F1BF00"/>`,
  ar: `<rect width="120" height="158" fill="#74ACDF"/><rect y="53" width="120" height="52" fill="#fff"/><circle cx="60" cy="79" r="11" fill="#F6B40E"/>`,
  fr: `<rect width="120" height="158" fill="#fff"/><rect width="40" height="158" fill="#002654"/><rect x="80" width="40" height="158" fill="#ED2939"/>`,
  it: `<rect width="120" height="158" fill="#fff"/><rect width="40" height="158" fill="#009246"/><rect x="80" width="40" height="158" fill="#CE2B37"/>`,
  slb: `<rect width="120" height="158" fill="#E30613"/><rect y="124" width="120" height="34" fill="#fff"/><g opacity=".9">${aCrest("slb", 60, 74, 1.5)}</g>`,
  vsc: `<rect width="120" height="158" fill="#fff"/><rect width="60" height="158" fill="#111"/><g opacity=".9">${aCrest("vsc", 60, 76, 1.45)}</g>`,
  pitch: `<rect width="120" height="158" fill="#43a047"/>${[0, 2, 4, 6].map(i => `<rect x="${i * 17}" width="17" height="158" fill="#4caf50"/>`).join("")}<rect x="0" y="122" width="120" height="2.5" fill="#fff" opacity=".8"/><circle cx="60" cy="123" r="24" fill="none" stroke="#fff" stroke-width="2.5" opacity=".8"/>`,
  court: `<rect width="120" height="158" fill="#dfa565"/>${[...Array(12)].map((_, i) => `<rect y="${i * 14}" width="120" height="1" fill="#c98b4a"/>`).join("")}<circle cx="60" cy="178" r="62" fill="none" stroke="#fff" stroke-width="2.5" opacity=".8"/>`,
  boss: `<rect width="120" height="158" fill="#2a1450"/><circle cx="60" cy="72" r="70" fill="#4a2380"/><circle cx="60" cy="72" r="42" fill="#6a35a8"/>${[[14, 18], [104, 26], [22, 130], [100, 120], [92, 70], [18, 76]].map(([x, y]) => aStar(x, y, 3.2, "#ffe082")).join("")}`,
};
// action lines behind the figure (anime "focus lines")
const A_RAYS = `<g opacity=".28">${[...Array(36)].map((_, i) => { const a = i * Math.PI / 18, b = a + .035; return `<polygon points="60,72 ${(60 + 130 * Math.cos(a)).toFixed(1)},${(72 + 130 * Math.sin(a)).toFixed(1)} ${(60 + 130 * Math.cos(b)).toFixed(1)},${(72 + 130 * Math.sin(b)).toFixed(1)}" fill="#fff"/>`; }).join("")}</g>`;
const A_MINI_ALIGN = { cn: "xMaxYMin" };     // where a flag's emblem is when it's cut to a small landscape box
const A_CLUB_BG = { slb: "#E30613", vsc: "#fff" };
// a small landscape flag (60 x 40): a slice of the backdrop, or a club's colour with its whole crest
const A_MINI = { es: `<rect width="60" height="40" fill="#AA151B"/><rect y="10" width="60" height="20" fill="#F1BF00"/>`,   // flags whose bands or emblems don't survive the cut
  kr: aKrFlag(60, 40, 40 / 96, 44), ch: aSwissCross(60, 40, 1.35), cv: aCvFlag(60, 40), de: aBands(60, 40, ["#000", "#DD0000", "#FFCE00"]), nl: aBands(60, 40, ["#AE1C28", "#fff", "#21468B"]) };
function aMiniInner(key) {
  if (A_MINI[key]) return A_MINI[key];
  return A_CREST[key] ? `<rect width="60" height="40" fill="${A_CLUB_BG[key]}"/>${key === "vsc" ? `<rect width="30" height="40" fill="#111"/>` : ""}${aCrest(key, 30, 20.5, .36)}`
    : `<svg width="60" height="40" viewBox="0 0 120 158" preserveAspectRatio="${A_MINI_ALIGN[key] || "xMidYMid"} slice">${A_BACK[key]}</svg>`;
}
function aMiniFlag(key, w = 36, h = 24) { return `<svg class="aflag" viewBox="0 0 60 40" width="${w}" height="${h}">${aMiniInner(key)}</svg>`; }
// the whole sticker picture (backdrop + figure), or just the figure as a grey silhouette for an empty slot
function stickerSvg(st, ghost = false) {
  if (st.scene || st.sp || st.fan) return aSceneSvg(st, ghost);
  const fig = `<g transform="translate(2 18.6) scale(1.16)" ${ghost ? "" : `filter="url(#aWhiteEdge)"`}>${aFigure(st)}</g>`;
  if (ghost) return `<svg class="aghost" viewBox="0 0 120 158" aria-hidden="true">${fig}</svg>`;
  return `<svg viewBox="0 0 120 158" aria-hidden="true">${A_BACK[st.bd]}${A_RAYS}${st.mini ? `<svg x="6" y="134" width="27" height="18" viewBox="0 0 60 40">${aMiniInner(st.mini)}</svg><rect x="6" y="134" width="27" height="18" fill="none" stroke="#fff" stroke-width="1.5"/>` : ""}${A_CREST[st.bd] && st.pose !== "kit" ? `<circle cx="19" cy="139" r="15" fill="#fff" opacity=".92"/>${aCrest(st.bd, 19, 139.5, .26)}` : ""}${fig}</svg>`;
}
// the white cut-out edge around the figure: one filter for the whole page
function aDefs() {
  if (document.getElementById("aDefs")) return;
  const d = document.createElement("div"); d.id = "aDefs"; d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  d.innerHTML = `<svg width="0" height="0"><filter id="aWhiteEdge" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.3" result="d"/>
    <feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="edge"/><feMerge><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge></filter></svg>`;
  document.body.appendChild(d);
}
/* scene pieces for the picture pages: a figure placed on the card (default = where stickerSvg puts it; extra drawing in
   figure coordinates on top), the white cut-out edge, a 4-point sparkle, a sky gradient, crowd dots, a small flag */
const aFig = (o, x = 2, y = 18.6, s = 1.16, extra = "", rot = "") => `<g transform="translate(${x} ${y}) scale(${s})${rot ? " " + rot : ""}">${aFigure(o)}${extra}</g>`;
const aEdge = s => `<g filter="url(#aWhiteEdge)">${s}</g>`;
const aSpark = (x, y, r, c = "#fff", cls = "", st = "") =>
  `<path${cls ? ` class="${cls}"` : ""}${st ? ` style="${st}"` : ""} d="M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r}Z" fill="${c}"/>`;
const aVGrad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
function aCrowd(x0, x1, ys, cols, seed, r = 2.4) {
  const R = aRand(seed), out = [];
  ys.forEach((y, j) => { for (let x = x0 + (j % 2) * r; x < x1; x += r * 2.3) {
    const c = cols[Math.floor(R() * cols.length)], sk = A_SKIN[Math.floor(R() * 5)];
    out.push(`<rect x="${(x - r).toFixed(1)}" y="${(y + r * .6).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 1.6).toFixed(1)}" rx="${r * .5}" fill="${c}"/>`, aC(x, y, r * .78, sk));
  } });
  return out.join("");
}
const aFlagAt = (key, x = 6, y = 134) => `<svg x="${x}" y="${y}" width="27" height="18" viewBox="0 0 60 40">${aMiniInner(key)}</svg><rect x="${x}" y="${y}" width="27" height="18" fill="none" stroke="#fff" stroke-width="1.5"/>`;
// a goal net (posts drawn by the caller)
const aNet = (x0, y0, x1, y1, step = 6, op = .7) => `<g opacity="${op}" stroke="#fff" stroke-width=".7">${[...Array(Math.floor((x1 - x0) / step) + 1)].map((_, i) => `<path d="M${x0 + i * step},${y0} V${y1}"/>`).join("")}${[...Array(Math.floor((y1 - y0) / step) + 1)].map((_, i) => `<path d="M${x0},${y0 + i * step} H${x1}"/>`).join("")}</g>`;

/* ---- the picture page (<team>y): 1 the team's landmark, 2+3 one big picture over two slots (the striker shoots | the
   ball flies past the diving keeper; each half is drawn 133.5 wide so the two meet over the gap in the book, and is cut to
   the card elsewhere), 4 a comic action shot, 5 the team photo, 6 a retro card, 7 a night match, 8 the goal party,
   9 a living sticker (CSS: the flag waves, the player bobs and winks, sparkles twinkle). A scene = [backdrop, main, over
   (optional)]: an empty slot shows the main part as a ghost ---- */
const aU = p => p + (++aUid);
const aSky = (a, b) => { const g = aU("asky"); return `<defs>${aVGrad(g, a, b)}</defs><rect width="120" height="158" fill="url(#${g})"/>`; };
const aCloud = (x, y, s = 1) => `<g fill="#fff" opacity=".95" transform="translate(${x} ${y}) scale(${s})"><circle cx="4" cy="6" r="5.5"/><circle cx="11" cy="3" r="7"/><circle cx="19" cy="7" r="5"/><rect y="6" width="23" height="6" rx="3"/></g>`;
const aSun = (x, y, r = 10) => aC(x, y, r, "#ffe082") + aC(x, y, r * .7, "#fff3c4");
const aP = (d, f, x = "") => `<path d="${d}" fill="${f}" ${A_OUT}${x ? " " + x : ""}/>`;
const aR = (x, y, w, h, f, x2 = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" ${A_OUT}${x2 ? " " + x2 : ""}/>`;
const aWaves = (y, c, w, n = 3, W = 120) => `<rect y="${y}" width="${W}" height="${158 - y}" fill="${c}"/>` + [...Array(n)].map((_, i) =>
  `<path d="M${i % 2 * 8 - 10},${y + 7 + i * 9}${" q5,-3 10,0".repeat(W / 10 + 2)}" fill="none" stroke="${w}" stroke-width="1.1" opacity=".7"/>`).join("");
const aMerlons = (x0, x1, y, f, w = 3.4, gap = 2.6) => { let o = ""; for (let x = x0; x + w <= x1 + .1; x += w + gap) o += aR(x.toFixed(1), y - 3.2, w, 3.4, f); return o; };
const aArch = (x, y, w, h, f = "#5d4a2e") => `<path d="M${x},${y + h} V${y + w / 2} A${w / 2},${w / 2} 0 0 1 ${x + w},${y + w / 2} V${y + h}Z" fill="${f}"/>`;
const aFlagPole = (x, y, cols) => `<path d="M${x},${y + 16} V${y}" stroke="${A_OL}" stroke-width="1"/>` + cols.map((c, i) => `<rect x="${x + .5}" y="${y + i * 7 / cols.length}" width="10" height="${7 / cols.length + .1}" fill="${c}"/>`).join("");
// the landmarks: [backdrop, the landmark]
const A_LAND = {
  pt: () => [aSky("#6ec3f4", "#e6f6ff") + aSun(100, 20) + aCloud(4, 14, .9) + aWaves(116, "#3b8fd0", "#bfe3ff", 4),        // Torre de Belém in the Tagus
    `<g transform="translate(23 -6) scale(1.1)">${aR(4, 92, 58, 28, "#efdcb5")}${[5, 12, 19, 26, 33, 40, 47, 54].map(x => aP(`M${x},92 V87.5 Q${x + 2.6},84.5 ${x + 5.2},87.5 V92Z`, "#f3e4c4") + `<path d="M${x + 2.6},87.3 v3.6 M${x + 1.1},89 h3" stroke="#c62828" stroke-width=".9"/>`).join("")}` +
    [10, 22, 34, 46].map(x => aArch(x, 104, 8, 15, "#6d5a3a")).join("") + aR(16, 36, 32, 56, "#f3e4c4") +
    [17.5, 23, 28.5, 34, 39.5].map(x => aP(`M${x},36 V31.5 Q${x + 2.3},29 ${x + 4.6},31.5 V36Z`, "#f3e4c4")).join("") +
    [10.5, 46.5].map(x => aR(x, 31, 7, 10, "#efdcb5") + aP(`M${x - .5},31.5 Q${x + 3.5},23 ${x + 7.5},31.5Z`, "#efdcb5") + `<path d="M${x + 3.5},25.5 V21" stroke="${A_OL}" stroke-width="1.1"/>`).join("") +
    aArch(21, 46, 8, 12) + aArch(35, 46, 8, 12) + aR(19, 58, 26, 3.4, "#efdcb5") + aArch(25.5, 38, 3, 5) + aArch(35.5, 38, 3, 5) + aArch(28, 68, 8, 16) +
    `<path d="M29,64 h6 v6 q-3,2.5 -6,0Z" fill="#fff" stroke="#c62828" stroke-width=".9"/><path d="M32,64.5 v5 M29.8,66.8 h4.4" stroke="#c62828" stroke-width="1"/></g>`],
  slb: () => {      // Ponte 25 de Abril at sunset, Cristo Rei on the Almada hill
    const cy = x => x < 38 ? 32 + (38 - x) * 1.1 : x > 92 ? 32 + (x - 92) * 1.1 : 32 + 46 * (1 - ((x - 65) / 27) ** 2);
    const tower = x => `<g>${aR(x - 5, 30, 3.4, 84, "#c62828")}${aR(x + 1.6, 30, 3.4, 84, "#c62828")}${[34, 52, 72].map(y => aR(x - 5, y, 10, 2.6, "#b71c1c")).join("")}</g>`;
    return [aSky("#ff8a65", "#ffe0b2") + aSun(98, 64, 12) + aWaves(110, "#1e6fa8", "#90caf9", 5) +
      `<path d="M78,110 V100 h6 v-6 h7 v4 h8 v-8 h6 v6 h9 v14Z" fill="#e8b28a" ${A_OUT}/>${[81, 87, 95, 102, 110].map(x => `<rect x="${x}" y="103" width="2" height="2.4" fill="#8d4a2b"/>`).join("")}` +
      aP("M-4,112 Q8,64 34,70 Q46,80 52,112Z", "#689f38"),
      aR(12.6, 46, 4.8, 22, "#eceff1") + `<path d="M15,47 V36 M9.5,40 H20.5" stroke="${A_OL}" stroke-width="3.6" stroke-linecap="round"/><path d="M15,47 V36 M9.5,40 H20.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` + aC(15, 34, 2.2, "#fff", A_OUT) +
      tower(38) + tower(92) + aR(-2, 94, 124, 5, "#c62828") + `<path d="M0,99${[...Array(24)].map((_, i) => ` L${i * 5 + 2.5},${i % 2 ? 99 : 104}`).join("")} L120,99" fill="none" stroke="#b71c1c" stroke-width="1.2"/><path d="M-2,104 H122" stroke="#b71c1c" stroke-width="1.6"/>` +
      `<g stroke="#ef9a9a" stroke-width=".7">${[...Array(29)].map((_, i) => i * 4 + 4).filter(x => Math.abs(x - 38) > 3 && Math.abs(x - 92) > 3).map(x => `<path d="M${x},${cy(x).toFixed(1)} V94"/>`).join("")}</g>` +
      `<path d="M-4,${cy(-4).toFixed(1)} L38,32 Q65,124 92,32 L124,${cy(124).toFixed(1)}" fill="none" stroke="${A_OL}" stroke-width="2.6"/><path d="M-4,${cy(-4).toFixed(1)} L38,32 Q65,124 92,32 L124,${cy(124).toFixed(1)}" fill="none" stroke="#e53935" stroke-width="1.4"/>`];
  },
  vsc: () => {      // Guimarães castle on its hill (the keep in the middle, square towers on the wall)
    const st = "#cfc3a5", tw = (x, y, w) => aR(x, y, w, 112 - y, st) + aMerlons(x, x + w, y, st) + `<rect x="${x + w / 2 - 1}" y="${y + 8}" width="2" height="5" fill="#5d4a2e"/>`;
    return [aSky("#64b5f6", "#e3f2fd") + aCloud(76, 12) + aCloud(8, 30, .7) + aP("M-5,158 V112 Q30,98 60,104 Q92,96 125,110 V158Z", "#7cb342") + aP("M-5,158 V128 Q40,118 125,132 V158Z", "#689f38"),
      aR(12, 72, 96, 40, st) + aMerlons(12, 108, 72, st) + tw(10, 58, 16) + tw(94, 60, 16) + tw(30, 64, 12) + tw(78, 64, 12) +
      aR(49, 28, 22, 84, "#d7cbad") + aMerlons(49, 71, 28, "#d7cbad") + `<rect x="57" y="40" width="2" height="7" fill="#5d4a2e"/><rect x="62" y="40" width="2" height="7" fill="#5d4a2e"/><rect x="58.5" y="60" width="3" height="8" fill="#5d4a2e"/>` +
      aFlagPole(60, 6, ["#046A38", "#DA291C"]) + aArch(54, 96, 12, 16)];
  },
  cv: () => [aSky("#4fc3f7", "#e1f5fe") + aCloud(84, 14, .8) + aWaves(124, "#1565c0", "#90caf9", 3),        // Pico do Fogo
    aP("M-6,126 L50,36 Q62,30 74,36 L126,126Z", "#6d4c41") + aP("M50,36 Q62,30 74,36 L70,40 Q62,36 54,40Z", "#4e342e") +
    `<path d="M56,44 L36,92 M64,42 L60,100 M70,44 L90,96" stroke="#8d6e63" stroke-width="3" opacity=".6"/>` +
    aP("M-6,126 V108 Q16,98 34,106 Q60,96 84,104 Q104,98 126,106 V126Z", "#7cb342") +
    [[22, 108], [30, 111], [86, 106], [95, 109]].map(([x, y]) => aR(x, y, 6, 5, "#fff") + `<path d="M${x - .5},${y} L${x + 3},${y - 3} L${x + 6.5},${y}Z" fill="#e57373" ${A_OUT}/>`).join("") +
    aC(62, 26, 5, "#cfd8dc") + aC(67, 19, 6, "#eceff1") + aC(73, 11, 5, "#f5f5f5")],
  es: () => {       // the Sagrada Família: the four bell towers of the Nativity façade and the tall middle tower with its star
    const sp = (x, top, w = 6) => aP(`M${x - w},100 L${x - w + 1},${top + 18} Q${x},${top} ${x + w - 1},${top + 18} L${x + w},100Z`, "#d9b382") +
      [0, 1, 2, 3].map(i => aC(x, top + 24 + i * 9, 1.1, "#6d4c41")).join("") + aC(x, top + 2, 2.6, ["#e53935", "#fdd835", "#43a047"][Math.round(x) % 3], A_OUT);
    return [aSky("#81d4fa", "#fff3e0") + aCloud(90, 18, .8) + `<rect y="128" width="120" height="30" fill="#e0c9a6"/>`,
      sp(60, 6, 7) + `<g transform="translate(60 6)">${aStar(0, 0, 5, "#fdd835")}</g>` + sp(30, 40) + sp(90, 40) + sp(43, 26) + sp(77, 26) +
      aR(16, 92, 88, 36, "#cfa572") + aArch(52, 102, 16, 26, "#6d4c41") + aArch(24, 108, 9, 20, "#6d4c41") + aArch(87, 108, 9, 20, "#6d4c41") +
      `<path d="M16,96 H104" stroke="#8d6e4a" stroke-width="1"/>` + [30, 43, 77, 90].map(x => aC(x, 98, 2.2, "#a5d6a7", A_OUT)).join("")];
  },
  fr: () => {       // the Eiffel Tower over the Champ de Mars
    const L = y => y > 96 ? 22 + (132 - y) * .62 : y > 66 ? 44 + (96 - y) * .2 : 50 + (66 - y) * .14, R = y => 120 - L(y);
    const X = (y0, y1) => `<path d="M${L(y0).toFixed(1)},${y0} L${R(y1).toFixed(1)},${y1} M${R(y0).toFixed(1)},${y0} L${L(y1).toFixed(1)},${y1}" />`;
    return [aSky("#90caf9", "#fce4ec") + aCloud(6, 20, .8) + aCloud(86, 34, .7) + `<rect y="128" width="120" height="30" fill="#7cb342"/><path d="M60,128 L44,158 H76Z" fill="#e0c9a6"/>`,
      aP(`M22,132 Q34,118 ${L(96).toFixed(1)},96 L${L(66)},66 L56,22 L57,12 L63,12 L64,22 L${R(66)},66 L${R(96).toFixed(1)},96 Q86,118 98,132 L84,132 Q72,110 60,110 Q48,110 36,132Z`, "#a1887f") +
      `<g stroke="#5d4037" stroke-width=".8" opacity=".75">${X(66, 81)}${X(81, 96)}${X(22, 44)}${X(44, 66)}</g>` +
      aR(34, 93, 52, 4.4, "#8d6e63") + aR(46, 63, 28, 3.4, "#8d6e63") + aR(54, 20, 12, 3, "#8d6e63") + `<path d="M60,12 V2" stroke="${A_OL}" stroke-width="1.4"/>`];
  },
  it: () => {       // the Colosseum: three rows of arches and the attic, broken off on the right
    const st = "#e6c99a", row = (y, h, x1) => aR(8, y, x1 - 8, h, st) + [...Array(Math.floor((x1 - 12) / 11))].map((_, i) => aArch(11 + i * 11, y + 3, 6.4, h - 4, "#7a5a3a")).join("");
    return [aSky("#ffcc80", "#fff8e1") + aSun(96, 22, 9) + `<rect y="126" width="120" height="32" fill="#d7c4a0"/>`,
      `<path d="M8,128 V44 H72 L76,58 H90 L94,80 H104 L108,104 H112 V128Z" fill="${st}" ${A_OUT}/>` + aR(8, 44, 64, 14, st) +
      [...Array(6)].map((_, i) => `<rect x="${12 + i * 10}" y="48" width="4" height="5" fill="#7a5a3a"/>`).join("") + row(58, 22, 92) + row(80, 24, 106) + row(104, 24, 112) +
      `<path d="M8,58 H92 M8,80 H106 M8,104 H112" stroke="#b08d5a" stroke-width="1.4"/><rect x="72" y="44" width="40" height="84" fill="#000" opacity=".08"/>`];
  },
  de: () => {       // the Brandenburg Gate with the quadriga
    const sd = "#e8d5a8", cols = [12, 28, 44, 70, 86, 102];
    return [aSky("#90caf9", "#eceff1") + aCloud(4, 10, .8) + aCloud(92, 26, .6) + `<rect y="126" width="120" height="32" fill="#b0bec5"/>${[132, 140, 150].map(y => `<path d="M0,${y} H120" stroke="#90a4ae" stroke-width=".8"/>`).join("")}`,
      aR(8, 64, 104, 60, "#8d7b5a") + cols.map(x => aR(x, 64, 6, 56, sd) + aR(x - 1.5, 118, 9, 4, sd)).join("") + aR(5, 120, 110, 6, sd) +
      aR(4, 52, 112, 12, sd) + `<path d="M6,57 H114" stroke="#b39b6c" stroke-width="1"/>` + aR(30, 42, 60, 10, sd) + aR(24, 40, 72, 3, sd) +
      `<g fill="#4f8a7a" ${A_OUT}>${[38, 49, 60, 71].map((x, i) => `<path d="M${x},40 v-7 q2,-6 6,-7 l2,-3 l1,4 q-3,2 -3,6 v7Z" transform="translate(${i % 2 ? 1 : 0} 0)"/>`).join("")}` +
      `<path d="M52,40 Q51,34 57,33 H63 Q69,34 68,40Z"/><path d="M58,33 V20 Q60,17 62,20 V33Z"/></g>` +
      `<path d="M60,19 V8" stroke="${A_OL}" stroke-width="1.2"/>` + aC(60, 8, 3, "none", `stroke="#4f8a7a" stroke-width="1.6"`)];
  },
  nl: () => {       // a windmill by a canal, rows of tulips
    const rows = [["#e53935", 112, 5], ["#fdd835", 121, 6.5], ["#ec407a", 131, 8], ["#ff7043", 143, 10]];
    const tulips = rows.map(([c, y, s]) => `<rect y="${y - s * .3}" width="120" height="${s * 1.4}" fill="#558b2f"/>` + [...Array(Math.ceil(120 / s) + 1)].map((_, i) => {
      const x = i * s + (y % 2) * s / 2; return `<path d="M${(x - s * .35).toFixed(1)},${y - s * .5} L${(x - s * .2).toFixed(1)},${(y - s * .2).toFixed(1)} L${x},${y - s * .55} L${(x + s * .2).toFixed(1)},${(y - s * .2).toFixed(1)} L${(x + s * .35).toFixed(1)},${y - s * .5} Q${(x + s * .35).toFixed(1)},${y + s * .2} ${x},${y + s * .2} Q${(x - s * .35).toFixed(1)},${y + s * .2} ${(x - s * .35).toFixed(1)},${y - s * .5}Z" fill="${c}" stroke="${A_OL}" stroke-width=".5"/>`; }).join("")).join("");
    const sail = a => `<g transform="rotate(${a} 60 46)"><rect x="57" y="4" width="7" height="40" fill="#fff8e1" ${A_OUT}/><path d="M57,12 h7 M57,20 h7 M57,28 h7 M57,36 h7 M60.5,4 V44" stroke="#8d6e63" stroke-width=".7"/></g>`;
    return [aSky("#81d4fa", "#e1f5fe") + aCloud(6, 12, .8) + `<rect y="92" width="120" height="20" fill="#9ccc65"/><rect y="100" width="120" height="7" fill="#42a5f5"/>`,
      aP("M47,104 L52,52 H68 L73,104Z", "#6d4c41") + aP("M50,54 Q50,40 60,38 Q70,40 70,54Z", "#4e342e") + aR(44, 78, 32, 3, "#3e2723") +
      aArch(56, 90, 8, 14, "#3e2723") + aR(57.5, 62, 5, 6, "#fff8e1") + [20, 110, 200, 290].map(sail).join("") + aC(60, 46, 2.8, "#3e2723", A_OUT) + tulips];
  },
  ch: () => [aSky("#1e88e5", "#bbdefb") + aCloud(84, 70, .7),       // the Matterhorn above a meadow and a chalet
    aP("M6,124 L44,64 L52,34 L60,22 L66,30 L72,46 L84,58 L116,124Z", "#78909c") + `<path d="M60,22 L66,30 L72,46 L84,58 L116,124 H80 L70,70 L64,44Z" fill="#546e7a"/>` +
    `<path d="M52,34 L60,22 L66,30 L64,40 L58,36 L54,46 L50,44Z M44,64 L48,58 L54,70 L46,74Z M70,46 L72,46 L80,56 L74,58Z" fill="#fff"/>` +
    aP("M-5,158 V118 Q30,106 60,114 Q92,108 125,116 V158Z", "#7cb342") +
    [[12, 116], [22, 112]].map(([x, y]) => `<path d="M${x},${y - 18} L${x - 6},${y} H${x + 6}Z" fill="#2e7d32" ${A_OUT}/>`).join("") +
    aR(86, 108, 22, 14, "#a1662f") + aP("M82,110 L97,98 L112,110Z", "#6d4c41") + aR(90, 112, 5, 5, "#fff8e1") + aR(99, 112, 5, 5, "#fff8e1") +
    aR(95.5, 100, 7, 5, "#DA291C") + `<path d="M99,101 v3 M97.5,102.5 h3" stroke="#fff" stroke-width="1.2"/>`],
  en: () => [aSky("#90a4ae", "#eceff1") + aCloud(76, 12) + aCloud(4, 34, .7) + aWaves(126, "#546e7a", "#b0bec5", 3),      // Elizabeth Tower (Big Ben) by the Thames
    aR(64, 96, 56, 30, "#c8a96a") + [68, 80, 92, 104, 116].map(x => aP(`M${x - 2},96 L${x},88 L${x + 2},96Z`, "#c8a96a") + `<rect x="${x - 4}" y="102" width="2" height="10" fill="#8d6e4a"/>`).join("") +
    aR(34, 56, 20, 70, "#c8a96a") + `<path d="M39,60 V124 M44,60 V124 M49,60 V124" stroke="#a1844f" stroke-width=".8"/>` + aR(32, 38, 24, 18, "#d4b77a") +
    aC(44, 47, 7.6, "#fff8e1", A_OUT) + `<path d="M44,47 V42 M44,47 L47.5,48.5" stroke="${A_OL}" stroke-width="1.2" stroke-linecap="round"/>` +
    aR(34, 28, 20, 10, "#c8a96a") + [37, 42, 47].map(x => aArch(x, 30, 3.6, 7, "#5d4a2e")).join("") + aP("M33,28 L44,8 L55,28Z", "#455a64") + `<path d="M44,8 V2" stroke="${A_OL}" stroke-width="1.2"/>`],
  no: () => [aSky("#64b5f6", "#e3f2fd") + aP("M30,104 L50,62 L62,74 L74,56 L94,104Z", "#90a4ae") + `<path d="M50,62 L44,74 L52,70 L56,72Z M74,56 L68,68 L76,64 L80,66Z" fill="#fff"/>` +        // a fjord, a stave church on the shore
    aP("M-5,40 Q14,44 24,72 Q34,96 48,108 H-5Z", "#5d6d4e") + aP("M125,30 Q100,40 92,70 Q84,96 70,108 H125Z", "#4e5d42") + aWaves(104, "#1565c0", "#90caf9", 2) +
    aP("M-5,158 V126 Q40,116 70,124 Q100,118 125,124 V158Z", "#689f38"),
    aR(48, 104, 24, 20, "#5d4037") + aP("M42,106 L60,92 L78,106Z", "#3e2723") + aR(52, 88, 16, 8, "#5d4037") + aP("M47,90 L60,78 L73,90Z", "#3e2723") +
    aR(55, 72, 10, 8, "#5d4037") + aP("M52,74 L60,56 L68,74Z", "#3e2723") + `<path d="M60,56 V50" stroke="${A_OL}" stroke-width="1.2"/>` +
    [[42, 106, -1], [78, 106, 1], [47, 90, -1], [73, 90, 1], [52, 74, -1], [68, 74, 1]].map(([x, y, d]) => `<path d="M${x},${y} q${-3 * d},-1 ${-3 * d},-5 q${2 * d},0 ${2 * d},2" fill="none" stroke="${A_OL}" stroke-width="1.4" stroke-linecap="round"/>`).join("") +
    aArch(57, 112, 6, 12, "#2a1a10")],
  br: () => [aSky("#4fc3f7", "#e1f5fe") + aCloud(80, 10, .8) + aWaves(120, "#0277bd", "#81d4fa", 3) +       // Christ the Redeemer on Corcovado, the Sugarloaf
    aP("M60,122 Q66,96 76,96 Q86,98 88,122Z", "#2e7d32") + aP("M78,122 Q82,70 98,66 Q114,68 118,122Z", "#388e3c") +
    `<path d="M76,96 L98,67" stroke="${A_OL}" stroke-width=".6"/><rect x="85" y="80" width="4" height="3" fill="#e53935"/>`,
    aP("M-5,124 L18,96 L40,80 L52,80 L64,98 L84,124Z", "#2e7d32") + `<g transform="translate(46 80) scale(1.5) translate(-35 -63)">${aR(32, 56, 6, 7, "#cfd8dc")}` +
    aP("M33,57 L31.5,34 L18,31 V28.5 L50,28.5 V31 L36.5,34 L35,57Z", "#eceff1") + aC(34.5, 25.5, 3, "#eceff1", A_OUT) + `</g>`],
  ar: () => [aSky("#74ACDF", "#e3f2fd") + aSun(98, 22, 8) + aCloud(6, 16, .7) +       // the Obelisco on the Avenida 9 de Julio, jacarandas
    [[0, 84, 16], [14, 90, 14], [88, 88, 14], [102, 80, 18]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${114 - y}" fill="#b0bec5"/>` +
      [...Array(Math.floor((110 - y) / 7))].map((_, j) => `<path d="M${x + 3},${y + 5 + j * 7} H${x + w - 3}" stroke="#eceff1" stroke-width="2" stroke-dasharray="2 2"/>`).join("")).join("") +
    `<path d="M-2,158 L52,114 H68 L122,158Z" fill="#78909c"/><path d="M60,118 V158" stroke="#fff" stroke-width="1.6" stroke-dasharray="5 5"/><rect y="112" width="120" height="4" fill="#9e9e9e"/>` +
    [[6, 1], [22, .8], [98, .8], [114, 1]].map(([x, k]) => `<path d="M${x},116 V${108 - 4 * k}" stroke="#5d4037" stroke-width="${2.4 * k}"/>` +
      `<g transform="translate(${x} ${102 - 4 * k}) scale(${k})">${aC(-5, 2, 5.5, "#9575cd", A_OUT)}${aC(5, 2, 5.5, "#9575cd", A_OUT)}${aC(0, -3, 6.5, "#9575cd", A_OUT)}${aC(1, -4, 2.6, "#b39ddb")}${aC(-4, 2, 2, "#b39ddb")}</g>`).join(""),
    aP("M53,120 L56,26 L60,14 L64,26 L67,120Z", "#f5f5f5") + `<path d="M60,14 L64,26 L67,120 H61Z" fill="#000" opacity=".1"/><rect x="58.5" y="30" width="3" height="4" fill="#455a64"/>` + aR(50, 118, 20, 4, "#e0e0e0")],
  cn: () => {       // the Great Wall over green hills, three watchtowers
    const d = "M-6,124 C14,108 28,96 46,100 S70,70 86,74 S112,96 126,84";
    return [aSky("#81d4fa", "#fffde7") + aCloud(84, 12, .8) + aP("M-5,100 Q30,60 60,84 Q90,50 125,78 V158 H-5Z", "#81c784") + aP("M-5,130 Q30,104 70,118 Q100,104 125,112 V158 H-5Z", "#43a047"),
      `<path d="${d}" fill="none" stroke="${A_OL}" stroke-width="10.4" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#d7ccc8" stroke-width="8"/>` +
      `<path d="${d}" fill="none" stroke="#a1887f" stroke-width="2.6" stroke-dasharray="2.5 2.5" transform="translate(0 -4.6)"/>` +
      [[20, 112], [60, 85], [104, 82]].map(([x, y]) => aR(x - 6, y - 14, 12, 14, "#bcaaa4") + aMerlons(x - 6, x + 6, y - 14, "#bcaaa4", 2.4, 2) + aArch(x - 2, y - 9, 4, 6, "#5d4037")).join("")];
  },
  jp: () => {       // Mt Fuji, a five-storey pagoda, cherry blossom
    const roof = (y, w) => aP(`M${30 - w},${y} Q${30 - w + 3},${y - 1} ${30 - w + 4},${y - 5} H${30 + w - 4} Q${30 + w - 3},${y - 1} ${30 + w},${y}Z`, "#37474f");
    return [aSky("#ffe0b2", "#fff8e1") + aP("M-5,118 L46,48 Q60,40 74,48 L125,118Z", "#5c7cae") + `<path d="M36,62 L46,48 Q60,40 74,48 L84,62 L78,59 L72,65 L66,58 L60,64 L54,58 L48,65 L42,59Z" fill="#fff"/>` +
      `<rect y="114" width="120" height="44" fill="#558b2f"/>` + `<path d="M126,10 Q100,16 84,30" fill="none" stroke="#5d4037" stroke-width="2.4"/>` +
      [[96, 14], [104, 20], [88, 26], [112, 12], [92, 32]].map(([x, y]) => aC(x, y, 5, "#f8bbd0") + aC(x + 1, y - 1, 2, "#fce4ec")).join(""),
      [0, 1, 2, 3, 4].map(i => aR(30 - 9 + i, 108 - i * 15, 18 - 2 * i, 12, "#e53935") + roof(108 - i * 15, 19 - i * 2)).join("") + aR(18, 118, 24, 6, "#9e9e9e") +
      `<path d="M30,44 V26" stroke="${A_OL}" stroke-width="1.6"/>` + [30, 34, 38].map(y => `<path d="M27.5,${y} h5" stroke="#ffb300" stroke-width="1.2"/>`).join("")];
  },
  kr: () => [aSky("#4fc3f7", "#e1f5fe") + aCloud(6, 18, .8) + aCloud(88, 40, .6) +        // N Seoul Tower on Namsan, a palace roof below
    aP("M-5,130 Q60,82 125,130 V158 H-5Z", "#43a047") + [[0, 126, 10], [12, 122, 8], [100, 120, 10], [112, 126, 8]].map(([x, y, w]) => aR(x, y, w, 34, "#b0bec5")).join(""),
    aR(57, 46, 6, 56, "#eceff1") + aR(55, 98, 10, 8, "#cfd8dc") + `<ellipse cx="60" cy="44" rx="13" ry="5" fill="#90a4ae" ${A_OUT}/><ellipse cx="60" cy="38" rx="11" ry="6" fill="#eceff1" ${A_OUT}/>` +
    `<rect x="50" y="35" width="20" height="3" fill="#4fc3f7"/>` + aR(58.5, 14, 3, 18, "#eceff1") + `<path d="M58.5,18 h3 M58.5,24 h3" stroke="#e53935" stroke-width="2.4"/><path d="M60,14 V6" stroke="${A_OL}" stroke-width="1"/>` +
    aR(78, 136, 34, 14, "#c62828") + [80, 92, 104].map(x => `<rect x="${x}" y="138" width="6" height="12" fill="#5d4037"/>`).join("") +
    aP("M72,138 Q76,134 78,128 H112 Q114,134 118,138Z", "#37474f") + `<path d="M78,131 H112" stroke="#26a69a" stroke-width="1.4"/>`],
};
// one figure in a scene, the white cut-out edge around it
const aYFig = (o, x, y, s, rot = "", extra = "") => aEdge(aFig(o, x, y, s, extra, rot));
const aKitOf = t => ({ ...A_TEAMS[t].kit });
// a corner flag (the club's crest on its colours)
const aYFlag = (t, x = 6, y = 134) => aFlagAt(t, x, y);
const A_KEEP2 = { shirt: "#7e57c2", trim: "#fff", shorts: "#4527a0", socks: "#7e57c2", gloves: "#fff" };     // the other team's keeper
/* per team: crowd / confetti colours, the night match's glow, the retro card's year (only where sure; the comment says what it is) */
const A_YT = {
  pt: ["#DA291C #046A38 #FFE900", "#69f0ae", 1966],      // World Cup: third place
  slb: ["#E30613 #fff #ffc107", "#ff5252", 1904],        // Benfica founded
  vsc: ["#fff #111 #ffc107", "#ffd740", 1922],           // Vitória SC founded
  cv: ["#003893 #fff #CF2027 #F7D116", "#40c4ff", 2013],  // first Africa Cup of Nations (quarter-finals)
  es: ["#C60B1E #FFC400", "#ffd740", 1964],              // European champions
  fr: ["#002654 #fff #ED2939", "#40c4ff", 1998],         // World Cup
  it: ["#2F7DE1 #fff #009246 #CE2B37", "#40c4ff", 1934],  // first World Cup
  de: ["#000 #DD0000 #FFCE00", "#ffd740", 1954],         // first World Cup
  nl: ["#F36C21 #fff #21468B", "#ffab40", 1988],         // European champions
  ch: ["#DA291C #fff", "#ff5252", 1954],                 // hosted the World Cup
  en: ["#fff #CE1124 #1D2A5C", "#ff5252", 1966],         // World Cup
  no: ["#BA0C2F #fff #00205B", "#40c4ff", 0],
  br: ["#FFDC02 #009C3B #002776", "#eeff41", 1958],      // first World Cup
  ar: ["#74ACDF #fff #F6B40E", "#80d8ff", 1978],         // first World Cup
  cn: ["#DE2910 #FFDE00", "#ffd740", 0],
  jp: ["#1B3A8C #fff #BC002D", "#40c4ff", 0],
  kr: ["#E4002B #fff #0047a0 #111", "#ff4081", 2002],     // World Cup semi-finalists as co-hosts
};
const aYCols = t => A_YT[t][0].split(" ");
const aPitch = (y, W = 120, step = 24) => `<rect y="${y}" width="${W}" height="${158 - y}" fill="#43a047"/>${[...Array(Math.ceil(W / step / 2))].map((_, i) => `<rect x="${i * step * 2}" y="${y}" width="${step}" height="${158 - y}" fill="#4caf50"/>`).join("")}`;
const aBoards = (y, W, cols, w = 24) => [...Array(Math.ceil(W / w))].map((_, i) => `<rect x="${i * w}" y="${y}" width="${w}" height="9" fill="${cols[i % cols.length]}" ${A_OUT}/>`).join("");
function aConfetti(n, cols, seed) {
  const R = aRand(seed);
  return [...Array(n)].map(() => { const x = R() * 120, y = R() * 128, a = R() * 180, c = cols[Math.floor(R() * cols.length)];
    return R() < .7 ? `<rect x="${(x - 1.8).toFixed(1)}" y="${(y - 1).toFixed(1)}" width="3.6" height="2" fill="${c}" transform="rotate(${a.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>` : aC(x, y, 1.3, c); }).join("");
}
Object.assign(A_POSES, {
  photo: { ba: [[39, 49], [33, 59], [33, 69]], fa: [[61, 49], [67, 59], [67, 69]], bl: [[45, 78], [44, 91], [43, 103]], bb: [41, 107, 0], fl: [[55, 78], [56, 91], [57, 103]], fb: [59, 107, 0] },
  strike: { ...A_POSES.kick, ball: undefined }, hooray: { ...A_POSES.cheer, ball: undefined } });
const A_YSCENES = {
  land: t => A_LAND[t](),
  // the big picture, 267 wide: the left half shows 0-133.5, the right half 133.5-267
  two: (t, half) => {
    const cols = aYCols(t), look = aLook(t, 0);
    const back = `<rect width="267" height="62" fill="#263238"/>${aCrowd(0, 270, [8, 18, 28, 38, 48], [...cols, "#fff"], 11 + t.length, 2.6)}${aBoards(56, 267, [...cols, "#ffeb3b"])}` +
      aPitch(65, 267, 22) + `<path d="M0,126 H267" stroke="#fff" stroke-width="2.2" opacity=".85"/>` + aNet(166, 58, 254, 124);
    const main = [`<path d="M162,126 V56 H258 V126" fill="none" stroke="${A_OL}" stroke-width="5.4"/><path d="M162,126 V56 H258 V126" fill="none" stroke="#fff" stroke-width="3.4"/>` +
      `<path d="M100,124 Q140,70 176,74" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55" stroke-dasharray="1 7"/><path d="M134,92 Q156,76 172,74" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>` +
      aYFig({ ...aKitOf(t), pose: "strike", num: 9, hs: "spiky", ...look }, 10, 20, 1.12) +
      aEdge(aFootball(180, 74, 8)) + aYFig({ ...A_KEEP2, pose: "keeper", num: 1, hs: "neat", ...aLook(t, 4) }, 188, 50, .78, "rotate(68 50 60)") +
      aSpark(166, 64, 5) + aSpark(196, 44, 4)];
    return [`<g transform="translate(${half ? -133.5 : 0} 0)">${back}</g>`, `<g transform="translate(${half ? -133.5 : 0} 0)">${main}</g>`];
  },
  comic: t => {       // a bicycle kick: halftone, a burst, speed lines
    const ht = aU("aht"), k = aKitOf(t), rgb = h => [1, 3, 5].map(i => parseInt(h.length < 5 ? h[1 + (i >> 1)].repeat(2) : h.slice(i, i + 2), 16));
    const far = c => rgb(c).reduce((s, v, i) => s + Math.abs(v - rgb(k.stripes || k.shirt)[i]) + Math.abs(v - rgb(k.shirt)[i]), 0);
    const bg = ["#4fc3f7", "#ff8a80", "#b9f6ca", "#ffd180", "#ea80fc"].reduce((a, c) => far(c) > far(a) ? c : a);
    const burst = (cx, cy, r1, r2, n, f, x = "") => `<polygon points="${aPts([...Array(n * 2)].map((_, i) => { const r = i % 2 ? r2 : r1, a = i * Math.PI / n + .2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }))}" fill="${f}" ${x} stroke-linejoin="round"/>`;
    return [`<defs><pattern id="${ht}" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.3" fill="#000" opacity=".25"/><circle cx="4.5" cy="4.5" r="1.3" fill="#000" opacity=".25"/></pattern></defs>` +
      `<rect width="120" height="158" fill="${bg}"/><rect width="120" height="158" fill="url(#${ht})"/>` + burst(84, 32, 50, 30, 14, "#fff", `stroke="${A_OL}" stroke-width="1.4"`) + burst(84, 32, 30, 18, 12, "#ffeb3b") +
      [[-6, 150, 58, 92], [4, 158, 64, 100], [-6, 134, 48, 84], [20, 160, 74, 108], [-6, 118, 40, 78]].map(([a, b, c, d]) => `<path d="M${a},${b} L${c},${d}" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".9"/>`).join("") +
      `<rect y="140" width="120" height="18" fill="#43a047"/>${[...Array(16)].map((_, i) => `<path d="M${i * 8 + 2},141 l2,-5 l2,5" fill="#2e7d32"/>`).join("")}` + aYFlag(t),
      aYFig({ ...k, pose: "kick", hs: "curly", num: 7, ...aLook(t, 6) }, 112, 22, 1, "scale(-1 1) rotate(195 50 60)") +
      `<path d="M70,66 Q94,62 98,46" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M64,74 Q92,72 104,52" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>` +
      `<path d="M100,10 l4,-6 M108,16 l7,-3 M110,28 l7,1" stroke="${A_OL}" stroke-width="2" stroke-linecap="round"/>`];
  },
  photo: t => {       // the team photo: three players, the captain lifting the cup
    const k = aKitOf(t), cols = aYCols(t);
    return [`<rect width="120" height="158" fill="#263238"/>${aCrowd(0, 124, [6, 15, 24, 33, 42], cols, 5 + t.length, 2.3)}${aBoards(48, 120, cols.length > 1 ? cols : [cols[0], "#fff"])}` +
      aPitch(57, 120, 24) + aSpark(14, 12, 5) + aSpark(96, 20, 6) + aSpark(60, 8, 3.5) + aYFlag(t),
      aYFig({ ...k, pose: "photo", num: 4, hs: "buzz", ...aLook(t, 2) }, 0, 40, .53) + aYFig({ ...k, pose: "photo", num: 8, hs: "pony", lash: 1, ...aLook(t, 3) }, 64, 40, .53) +
      aYFig({ ...k, pose: "lift", num: 10, hs: "spiky", ...aLook(t, 4) }, 27, 58, .62) + aEdge(aFootball(100, 132, 7.5))];
  },
  retro: t => {       // an old card: sepia, a laced collar and a laced ball, a year when there's one to tell
    const sp = aU("asep"), vg = aU("avg"), k = aKitOf(t), yr = A_YT[t][2];
    const extra = `<path d="M42,41 L50,47.5 L58,41 L57,46 L50,51 L43,46Z" fill="#fff" ${A_OUT}/><path d="M48.6,47.8 l2.8,1.6 M51.4,47.8 l-2.8,1.6" stroke="${A_OL}" stroke-width=".7"/>` +
      aC(77, 104, 8.3, "#8d5524", A_OUT) + `<path d="M70,101 Q77,98 84,101 M70,107 Q77,110 84,107 M77,96 V112" fill="none" stroke="#5d3613" stroke-width=".9"/><path d="M75.5,99.5 h3 M75.5,101.5 h3 M75.5,103.5 h3" stroke="#f3e6c8" stroke-width=".7"/>`;
    const filt = `<defs><filter id="${sp}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".39 .77 .19 0 0  .35 .69 .17 0 0  .27 .53 .13 0 0  0 0 0 1 0"/></filter>` +
      `<radialGradient id="${vg}" cx=".5" cy=".5" r=".72"><stop offset=".55" stop-color="#3b2208" stop-opacity="0"/><stop offset="1" stop-color="#3b2208" stop-opacity=".6"/></radialGradient></defs>`;
    const label = yr ? `<text x="60" y="144" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="11" fill="#5a4020" letter-spacing="1">${yr}</text>`
      : [48, 60, 72].map(x => aStar(x, 140, 3.4, "#8a6d3b")).join("");
    return [filt + `<g filter="url(#${sp})"><rect width="120" height="158" fill="#cfd8dc"/><path d="M0,30 L20,18 H100 L120,30 V58 H0Z" fill="#6d4c41" ${A_OUT}/>` +
      [...Array(5)].map((_, i) => `<path d="M0,${36 + i * 5} H120" stroke="#4e342e" stroke-width="1"/>`).join("") + aCrowd(4, 118, [34, 44], ["#5d4037", "#3e2723", "#795548"], 9, 2.2) +
      `<rect y="58" width="120" height="100" fill="#689f38"/>${[...Array(9)].map((_, i) => `<ellipse cx="${(i * 37) % 113 + 6}" cy="${70 + (i * 23) % 60}" rx="7" ry="2" fill="#8d6e63" opacity=".55"/>`).join("")}</g>`,
      `<g filter="url(#${sp})">${aYFig({ ...k, stripes: k.stripes, boots: "#4e342e", pose: "run", hs: "neat", ...aLook(t, 1) }, 2, 14, 1.12, "", extra)}</g>`,
      `<g filter="url(#${sp})"><rect width="120" height="158" fill="url(#${vg})"/><path d="M18,20 l14,40 M90,30 l-6,30 M30,120 l30,6" stroke="#fff" stroke-width=".5" opacity=".35"/>` +
      `<rect x="3.5" y="3.5" width="113" height="151" rx="4" fill="none" stroke="#f3e6c8" stroke-width="7"/>` +
      `<path d="M20,133 H100 L96,140 L100,147 H20 L24,140Z" fill="#f3e6c8" stroke="#8a6d3b" stroke-width="1"/>${label}</g>` + `<path d="M0,0 L9,0 L0,9Z M120,158 L111,158 L120,149Z" fill="#fff" opacity=".7"/>`];
  },
  night: t => {       // floodlights in the dark, a glowing player and a comet ball
    const gl = aU("agl"), tr = aU("atr"), bm = aU("abm"), c = A_YT[t][1];
    return [`<defs><filter id="${gl}" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="d"/>` +
      `<feFlood flood-color="${c}"/><feComposite in2="d" operator="in"/><feGaussianBlur stdDeviation="2.6" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
      `<linearGradient id="${tr}" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffff8d" stop-opacity="0"/><stop offset="1" stop-color="#ffff8d" stop-opacity=".95"/></linearGradient>` +
      `<linearGradient id="${bm}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e1f5fe" stop-opacity=".45"/><stop offset="1" stop-color="#e1f5fe" stop-opacity="0"/></linearGradient></defs>` +
      `<rect width="120" height="158" fill="#070b24"/>${[[14, 30], [30, 12], [98, 52], [108, 76], [20, 70], [48, 40], [76, 62]].map(([x, y]) => aC(x, y, .9, "#fff")).join("")}` +
      `<polygon points="0,0 14,0 70,150 20,158" fill="url(#${bm})"/><polygon points="120,0 108,0 54,150 104,158" fill="url(#${bm})" opacity=".7"/>` +
      `<rect y="118" width="120" height="40" fill="#0b3d1f"/><path d="M0,124 H120" stroke="${c}" stroke-width="1.2" opacity=".6"/><ellipse cx="60" cy="146" rx="30" ry="9" fill="none" stroke="${c}" stroke-width="1.2" opacity=".5"/>` +
      `<polygon points="122,-14 128,-4 88,18 81,10" fill="url(#${tr})"/>` + aYFlag(t),
      `<g filter="url(#${gl})">${aFig({ ...aKitOf(t), pose: "header", num: 10, hs: "spiky", ...aLook(t, 5), boots: c })}</g>` +
      aC(84.4, 12.8, 13, "#ffff8d", `opacity=".25"`) + aSpark(102, 26, 4, "#ffff8d") + aSpark(68, 6, 3, "#ffff8d")];
  },
  party: t => {       // the goal party: the ball in the net, confetti in the team's colours
    const cols = aYCols(t), conf = [...cols, "#ff5252", "#69f0ae", "#e040fb", "#ffeb3b"];
    return [`<rect width="120" height="158" fill="#1a237e"/>${aCrowd(0, 124, [8, 18, 28], cols, 4 + t.length, 2.4)}` +
      `<g opacity=".6">${[...Array(16)].map((_, i) => `<path d="M${-60 + i * 12},34 L${i * 12},126 M${i * 12},34 L${-60 + i * 12},126" stroke="#fff" stroke-width=".7"/>`).join("")}</g>` +
      `<path d="M0,34 H120" stroke="#fff" stroke-width="3"/><rect y="124" width="120" height="34" fill="#43a047"/><path d="M0,126 H120" stroke="#fff" stroke-width="2"/>` +
      aEdge(aFootball(100, 116, 8)) + aConfetti(55, conf, 21 + t.length) +
      [["M4,10 q8,6 4,14 t4,14", conf[0]], ["M110,4 q-8,6 -4,14 t-4,14", conf[1]], ["M30,4 q6,8 0,14", conf[2]], ["M92,40 q-6,8 0,16", conf[3]]].map(([d, c]) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`).join("") + aYFlag(t),
      aYFig({ ...aKitOf(t), pose: "hooray", num: 10, hs: "curly", ...aLook(t, 6) }, 2, 18.6, 1.16) + aConfetti(10, conf, 5 + t.length)];
  },
  live: t => {        // the living sticker: the flag waves, the player bobs and winks, sparkles twinkle (CSS lv-…)
    const look = aLook(t, 1), s = .95, ox = 4, oy = 30, x0 = 76, y0 = 8, ex = ox + 56.7 * s, ey = oy + 28.5 * s, flag = aMiniInner(t);
    const strips = [...Array(11)].map((_, i) => `<g class="lv-wave" style="animation-delay:-${(i * .14).toFixed(2)}s"><svg x="${x0 + i * 3}" y="${y0}" width="3.1" height="22" viewBox="${(i * 60 / 11).toFixed(2)} 0 ${(60 / 11 + .1).toFixed(2)} 40" preserveAspectRatio="none">${flag}</svg></g>`).join("");
    return [aSky("#81d4fa", "#e1f5fe") + aCloud(6, 8, .7) + `<rect y="96" width="120" height="10" fill="#263238"/>${aCrowd(0, 124, [99], aYCols(t), 3 + t.length, 2)}` + aPitch(106, 120, 24) +
      `<path d="M0,128 H120" stroke="#fff" stroke-width="1.6" opacity=".8"/>`,
      `<path d="M${x0 - .6},96 L${x0 + .8},${y0 - 2}" stroke="${A_OL}" stroke-width="3"/><path d="M${x0 - .6},96 L${x0 + .8},${y0 - 2}" stroke="#d7ccc8" stroke-width="1.6"/>${aC(x0 + .8, y0 - 3, 2, "#ffc107", A_OUT)}` +
      `<g class="lv-bob">${aYFig({ ...aKitOf(t), pose: "cheer", num: 9, hs: "spiky", ...look }, ox, oy, s)}` +
      `<g class="lv-wink"><ellipse cx="${ex.toFixed(1)}" cy="${(ey + .4).toFixed(1)}" rx="${(4.5 * s).toFixed(2)}" ry="${(5.5 * s).toFixed(2)}" fill="${look.skin}"/><path d="M${(ex - 4).toFixed(1)},${(ey + 1.2).toFixed(1)} Q${ex.toFixed(1)},${(ey - 3).toFixed(1)} ${(ex + 4).toFixed(1)},${(ey + 1.2).toFixed(1)}" fill="none" stroke="#1a1a1a" stroke-width="1.9" stroke-linecap="round"/></g></g>` +
      strips + `<rect x="${x0}" y="${y0}" width="33" height="22" fill="none" stroke="${A_OL}" stroke-width=".6" opacity=".4"/>` +
      aSpark(14, 22, 5, "#fff", "lv-tw") + aSpark(104, 48, 4, "#fff", "lv-tw", "animation-delay:-.6s") + aSpark(24, 90, 4, "#fff", "lv-tw", "animation-delay:-1.2s")];
  },
};
// the nine stickers of a picture page, in grid order (2 and 3 = the two halves, side by side in the top row)
const A_YPAGE = [{ scene: "land" }, { scene: "two", half: "l" }, { scene: "two", half: "r" }, { scene: "comic" }, { scene: "photo" }, { scene: "retro" },
  { scene: "night" }, { scene: "party" }, { scene: "live" }];
function aSceneSvg(st, ghost) {
  const [back, main, top = ""] = st.fan ? FAN[st.fan][st.fi][2]() : st.sp ? A_SPECIALS[st.sp]() : A_YSCENES[st.scene](st.team, st.half === "r"), w = st.half ? 133.5 : 120;
  const fl = st.scene === "land" ? aYFlag(st.team) : "";
  return `<svg${ghost ? ` class="aghost"` : ""} viewBox="0 0 ${w} 158" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${ghost ? main : back + main + top + fl}</svg>`;
}

/* ---- the special page (sp, first in the book; the owner's choice from lab/special_ideas.html, 2026-10-03): chess pieces
   and friends that belong to no team. Earned from packs like every other sticker. A sticker = [backdrop, main] like the
   picture pages; the ball buddy is the page's one living sticker (it bobs) ---- */
const aAt = (x, y, sc, inner, rot = "") => `<g transform="translate(${x} ${y}) scale(${sc})${rot ? " " + rot : ""}">${inner}</g>`;
const aGoldCrown = (y, w = 9) => `<polygon points="${-w},${y} ${-w - 1},${y - 8} ${-w / 2},${y - 4} 0,${y - 10} ${w / 2},${y - 4} ${w + 1},${y - 8} ${w},${y}" fill="#ffc107" ${A_OUT} stroke-linejoin="round"/>` +
  aC(0, y - 2.6, 1.3, "#e53935") + aC(-w + 2.6, y - 2, 1, "#29b6f6") + aC(w - 2.6, y - 2, 1, "#29b6f6");
// a chess piece with a face, drawn around 0,0 (base at y 19): kind r / k / q, mood happy / brave, crown, captain's armband
function aPiece(kind, col, mood, o = {}) {
  const s = [`<path d="M-11,13 H11 L13,19 H-13Z" fill="${col}" ${A_OUT}/>`];
  let fy = 1;
  if (kind === "r") s.push(`<path d="M-8,14 L-7,-6 H7 L8,14Z" fill="${col}" ${A_OUT}/><path d="M-10,-6 V-16 H-6 V-12 H-2 V-16 H2 V-12 H6 V-16 H10 V-6Z" fill="${col}" ${A_OUT} stroke-linejoin="round"/>`);
  else {
    s.push(`<path d="M-8,14 L-6,-2 H6 L8,14Z" fill="${col}" ${A_OUT}/>`, `<ellipse cx="0" cy="-2" rx="7.5" ry="2.4" fill="${col}" ${A_OUT}/>`, aC(0, -8, 8, col, A_OUT)); fy = -8;
    if (o.crown) s.push(aGoldCrown(-14) + (kind === "k" ? `<path d="M0,-24 V-30 M-2.6,-27.5 H2.6" stroke="${A_OL}" stroke-width="2.8"/><path d="M0,-24 V-30 M-2.6,-27.5 H2.6" stroke="#ffc107" stroke-width="1.4"/>` : aC(0, -25.5, 1.8, "#fff", A_OUT)));
  }
  if (o.armband) s.push(`<rect x="-7" y="3.5" width="14" height="5" fill="#ffc107" ${A_OUT}/><text x="0" y="7.6" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="4.4" fill="#5d4037">C</text>`);
  s.push(aEye(-3.4, fy, "#3e2723", .5) + aEye(3.4, fy, "#3e2723", .5) + (mood === "brave"
    ? `<path d="M-6,${fy - 4.2} L-1.2,${fy - 2.6} M6,${fy - 4.2} L1.2,${fy - 2.6}" stroke="${A_OL}" stroke-width="1.2" stroke-linecap="round"/><path d="M-2.5,${fy + 4.6} H2.5" stroke="${A_OL}" stroke-width="1" stroke-linecap="round"/>`
    : `<path d="M-2.6,${fy + 3.6} Q0,${fy + 6.4} 2.6,${fy + 3.6}" fill="none" stroke="${A_OL}" stroke-width="1" stroke-linecap="round"/>` +
      `<ellipse cx="-5.6" cy="${fy + 2.8}" rx="1.4" ry=".8" fill="#ff8a80" opacity=".8"/><ellipse cx="5.6" cy="${fy + 2.8}" rx="1.4" ry=".8" fill="#ff8a80" opacity=".8"/>`));
  return s.join("");
}
A_ANIMALS.robot = { skin: "#b0bec5", head: () => `<path d="M50,9 V1" stroke="${A_OL}" stroke-width="2"/>` + aC(50, 0, 2.6, "#e53935", A_OUT) +
  aC(30, 25, 3.6, "#90a4ae", A_OUT) + aC(70, 25, 3.6, "#90a4ae", A_OUT) +
  `<rect x="31" y="9" width="38" height="32" rx="7" fill="#cfd8dc" ${A_OUT}/><rect x="35.5" y="14" width="29" height="21" rx="4" fill="#263238"/>` +
  `<rect x="40" y="19" width="6" height="7" rx="2" fill="#40c4ff"/><rect x="54" y="19" width="6" height="7" rx="2" fill="#40c4ff"/>` +
  `<path d="M44,29.5 Q50,33.5 56,29.5" fill="none" stroke="#40c4ff" stroke-width="1.6" stroke-linecap="round"/>` + aC(42, 21, .9, "#fff") + aC(56, 21, .9, "#fff") +
  `<path d="M34,11.5 Q40,10 46,11" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".7"/>` };
const aPent = (x, y, r, rot, f, x2 = "") => `<polygon points="${aPts([0, 1, 2, 3, 4].map(i => { const a = rot + i * 2 * Math.PI / 5; return [x + r * Math.cos(a), y + r * Math.sin(a)]; }))}" fill="${f}" ${x2}/>`;
const aRadial = (id, a, b, cy = ".42") => `<defs><radialGradient id="${id}" cx=".5" cy="${cy}" r=".75"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs><rect width="120" height="158" fill="url(#${id})"/>${A_RAYS}`;
const aGloveAt = (x, y, r = 7) => aC(x, y, r, "#ffeb3b", A_OUT) + aL([[x - r * .43, y - r * .21], [x + r * .43, y - r * .21]], A_OL, .8, false);
const aPlinth = g => `<rect x="26" y="124" width="68" height="20" rx="2" fill="#4e342e" ${A_OUT}/><rect x="44" y="128" width="32" height="11" rx="1.5" fill="${g}" ${A_OUT}/>${aStar(60, 133.5, 3.6, "#7a5200")}`;
const A_SPECIALS = {
  rook: () => [A_BACK.pitch + A_RAYS + aNet(12, 22, 108, 112, 8, .55) +          // the rook in goal, gloves out, saves the shot
    `<path d="M112,28 l6,-4 M113,36 h6 M110,44 l6,3" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>` + aSpark(96, 26, 4, "#ffeb3b") + aSpark(112, 52, 3, "#ffeb3b"),
    `<path d="M8,118 V18 H112 V118" fill="none" stroke="${A_OL}" stroke-width="5.4"/><path d="M8,118 V18 H112 V118" fill="none" stroke="#fff" stroke-width="3.6"/>` +
    aEdge(aL([[44, 82], [30, 70], [20, 54]], "#f5ecd7", 6) + aGloveAt(20, 52) + aL([[76, 82], [92, 66], [100, 50]], "#f5ecd7", 6) + aGloveAt(100, 48) +
      aAt(60, 92, 2.4, aPiece("r", "#f5ecd7", "brave") + `<text x="0" y="12.5" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="7" fill="#e53935" stroke="#fff" stroke-width=".5" paint-order="stroke">1</text>`) +
      aFootball(104, 36, 7.5))],
  buddy: () => {      // the ball buddy: winks, a thumbs-up, bobs (the living sticker)
    const cp = aU("abc");
    return [A_BACK.pitch + A_RAYS + `<ellipse cx="60" cy="134" rx="26" ry="4.5" fill="#000" opacity=".2"/>` +
      [[6, 56], [2, 70], [6, 84]].map(([x, y]) => `<path d="M${x},${y} H${x + 14}" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>`).join(""),
      `<defs><clipPath id="${cp}"><circle cx="60" cy="70" r="31"/></clipPath></defs><g class="lv-bob">` + aEdge(
        aL([[50, 98], [46, 112], [42, 124]], "#fff", 3.4) + `<ellipse cx="40" cy="126" rx="8" ry="4.4" fill="#e53935" ${A_OUT}/>` +
        aL([[70, 98], [76, 110], [80, 122]], "#fff", 3.4) + `<ellipse cx="83" cy="124" rx="8" ry="4.4" fill="#e53935" ${A_OUT} transform="rotate(-18 83 124)"/>` +
        aL([[31, 76], [20, 72], [14, 60]], "#fff", 3.4) + aC(14, 57, 5.4, "#fff", A_OUT) +
        aL([[89, 76], [99, 70], [103, 58]], "#fff", 3.4) + aC(103, 55, 5.4, "#fff", A_OUT) + `<path d="M103,49.5 v-4" stroke="${A_OL}" stroke-width="3.4" stroke-linecap="round"/><path d="M103,49.5 v-4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>` +
        aC(60, 70, 31, "#fff") + `<g clip-path="url(#${cp})">${[[60, 36, 11, Math.PI / 2], [28, 62, 11, 0], [92, 62, 11, Math.PI], [40, 100, 10, -Math.PI / 4], [80, 100, 10, Math.PI * 1.25]].map(p => aPent(...p, "#263238")).join("")}` +
        `<path d="M74,44 A31,31 0 0 1 82,96 A36,36 0 0 0 74,44Z" fill="#000" opacity=".08"/></g>` + aC(60, 70, 31, "none", `stroke="${A_OL}" stroke-width="1.6"`) +
        aEye(50, 68, "#1e88e5", 1.3) + `<path d="M64.5,69 Q70,62.5 75.5,69" fill="none" stroke="#1a1a1a" stroke-width="2.3" stroke-linecap="round"/>` +
        `<path d="M50,80 Q60,92 70,80Z" fill="#c0392b" stroke="${A_OL}" stroke-width="1" stroke-linejoin="round"/><ellipse cx="60" cy="85.5" rx="4.2" ry="2" fill="#ff8a80"/>` +
        `<g transform="translate(10 42)">${aBlush(34.5)}</g>`) + `</g>`];
  },
  referee: () => {    // black kit, a whistle, the yellow card in one hand and the red one in the other
    const look = { skin: A_SKIN[1], hair: A_HAIR.dark, eyes: A_EYES.brown }, crd = (x, c, r) => `<rect x="${x - 5.5}" y="9" width="11" height="15" rx="1.4" fill="${c}" ${A_OUT} transform="rotate(${r} ${x} 26)"/>` + aC(x, 26, 4.4, look.skin, A_OUT);
    const extra = crd(27, "#ffeb3b", -14) + crd(73, "#e53935", 14) + `<path d="M44.5,42 Q47,39 49,38.5 M55.5,42 Q54,39.5 53,38.8" fill="none" stroke="#eceff1" stroke-width="1"/>` +
      `<rect x="47" y="35.4" width="10" height="4.6" rx="2.2" fill="#b0bec5" ${A_OUT}/>` + aC(56.5, 39, 3.2, "#b0bec5", A_OUT) + aC(56.5, 39, 1.1, "#546e7a") +
      `<path d="M63,33 l5,-3 M64.5,37.5 h6 M63,42 l5,3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`;
    return [A_BACK.pitch + A_RAYS, aEdge(aFig({ shirt: "#212121", trim: "#fff", shorts: "#212121", socks: "#212121", pose: "cheer", hs: "neat", ...look, star: 1 }, 2, 18.6, 1.16, extra)) + aEdge(aFootball(100, 142, 7))];
  },
  royals: () => [aRadial(aU("arp"), "#8e24aa", "#3a0a4f", ".4") + `<path d="M40,104 H80 L112,158 H8Z" fill="#c62828"/><path d="M40,104 H80 L112,158 H8Z" fill="none" stroke="#ffc107" stroke-width="2"/>` +       // King & Queen: the captain pair
    aSpark(14, 22, 5) + aSpark(106, 30, 6) + aSpark(62, 14, 3.5) + aSpark(108, 84, 3.5),
    aEdge(aAt(38, 96, 2.25, aPiece("k", "#f5ecd7", "happy", { crown: 1, armband: 1 })) + aAt(84, 101, 2.05, aPiece("q", "#f5ecd7", "happy", { crown: 1 })) + aFootball(61, 140, 7))],
  rocket: () => {     // a football with a flame trail and stars
    const R = aRand(19), g = aU("ark"), flame = (w, c) => `<path d="M${76 - 20 * w},${56 - 14 * w} C${52 - 10 * w},84 30,116 0,158 C34,132 ${64 + 8 * w},100 ${90 + 14 * w},${70 + 18 * w}Z" fill="${c}"/>`;
    return [`<defs>${aVGrad(g, "#1a0638", "#4a148c")}</defs><rect width="120" height="158" fill="url(#${g})"/>` + [...Array(26)].map(() => aC(R() * 120, R() * 158, R() < .2 ? 1.1 : .6, "#fff")).join("") +
      [[18, 60, 70, 20], [40, 120, 96, 84], [8, 96, 40, 70]].map(([a, b, c, d]) => `<path d="M${a},${b} L${c},${d}" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>`).join("") +
      aStar(102, 108, 6, "#ffeb3b") + aStar(18, 30, 5, "#ffeb3b") + aSpark(108, 20, 5) + aSpark(50, 22, 3.5) + aSpark(110, 138, 4, "#fff59d"),
      flame(1, "#e53935") + flame(.7, "#ff9800") + flame(.4, "#ffeb3b") + aEdge(`<g transform="translate(78 54) scale(2.4) rotate(20) translate(-78 -54)">${aFootball(78, 54, 9)}</g>`)];
  },
  octopus: () => {    // the octopus keeper: eight arms, two gloves (the sea world)
    const g = aU("asea"), C = "#ab47bc", D = "#7b1fa2";
    const ten = d => `<path d="${d}" fill="none" stroke="${A_OL}" stroke-width="9.4" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${C}" stroke-width="7.2" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#f8bbd0" stroke-width="2.2" stroke-linecap="round" stroke-dasharray=".1 5" transform="translate(0 1.6)"/>`;
    return [`<defs>${aVGrad(g, "#4fc3f7", "#01579b")}</defs><rect width="120" height="158" fill="url(#${g})"/>` +
      [[10, 30], [50, 66], [86, 100]].map(([a, c]) => `<polygon points="${a},0 ${a + 12},0 ${c + 8},140 ${c},140" fill="#fff" opacity=".08"/>`).join("") +
      [[12, 30, 3], [18, 20, 2], [104, 40, 3.5], [98, 28, 2], [108, 18, 1.6], [28, 44, 1.6]].map(([x, y, r]) => aC(x, y, r, "none", `stroke="#e1f5fe" stroke-width="1" opacity=".8"`)).join("") +
      aNet(22, 34, 98, 118, 9.5, .55) + `<path d="M20,120 V32 H100 V120" fill="none" stroke="#fff" stroke-width="3" opacity=".85"/>` +
      `<path d="M0,128 Q30,120 60,126 Q90,132 120,124 V158 H0Z" fill="#f3d9a4"/>` + aStar(104, 144, 6, "#ff7043") + `<path d="M14,146 q4,-7 8,0Z" fill="#f48fb1" ${A_OUT}/>` +
      `<path d="M6,128 q-4,-10 2,-18 q6,-8 0,-18 M114,126 q4,-10 -2,-18 q-6,-8 0,-18" fill="none" stroke="#2e7d32" stroke-width="3" stroke-linecap="round"/>`,
      aEdge(["M46,82 Q30,74 24,54", "M74,82 Q90,74 96,54", "M44,88 Q24,94 16,82 Q12,74 20,72", "M76,88 Q96,94 104,82 Q108,74 100,72", "M50,94 Q40,114 26,118 Q18,120 20,112",
        "M70,94 Q80,114 94,118 Q102,120 100,112", "M56,96 Q54,116 44,126 Q40,130 46,132", "M64,96 Q66,116 76,126 Q80,130 74,132"].map(ten).join("") + aGloveAt(24, 51, 6) + aGloveAt(96, 51, 6) +
        `<ellipse cx="60" cy="62" rx="27" ry="30" fill="${C}" ${A_OUT}/><path d="M36,80 Q60,96 84,80 L84,86 Q60,102 36,86Z" fill="#ffeb3b" ${A_OUT}/>` +
        `<text x="60" y="94" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="9" fill="#111">1</text>` +
        aC(48, 44, 4, D, `opacity=".45"`) + aC(72, 40, 3, D, `opacity=".45"`) + aC(66, 50, 2.2, D, `opacity=".45"`) + `<path d="M42,38 Q50,32 56,36" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".5"/>` +
        aEye(50, 64, "#00897b", 1.25) + aEye(70, 64, "#00897b", 1.25) + `<g transform="translate(10 37)">${aBlush(34.5)}${aMouth()}</g>`) + aEdge(aFootball(16, 140, 7.5))];
  },
  robot: () => {      // a robot footballer on a neon pitch
    const g = aU("arb");
    return [`<defs>${aVGrad(g, "#0d1b4a", "#1a237e")}</defs><rect width="120" height="158" fill="url(#${g})"/>` +
      `<g stroke="#00e5ff" stroke-width=".8" opacity=".55">${[...Array(9)].map((_, i) => `<path d="M${60 + (i - 4) * 6},96 L${60 + (i - 4) * 34},158"/>`).join("")}${[96, 102, 110, 121, 136, 156].map(y => `<path d="M0,${y} H120"/>`).join("")}</g>` +
      [[14, 20], [30, 44], [98, 16], [106, 60], [20, 76], [86, 40]].map(([x, y]) => `<rect x="${x}" y="${y}" width="3" height="3" fill="#00e5ff" opacity=".7"/>`).join("") +
      `<path d="M4,30 H20 V40 H30 M116,70 H100 V80 H92" fill="none" stroke="#00e5ff" stroke-width="1" opacity=".5"/>`,
      aEdge(aFig({ shirt: "#ff7043", trim: "#263238", shorts: "#263238", socks: "#ff7043", boots: "#263238", head: "robot", pose: "run", num: 8 }))];
  },
  goldball: () => {   // a shining gold football on a stand (not a real award)
    const gg = aU("agg"), cp = aU("agc");
    return [aRadial(aU("agb"), "#c62828", "#3e0a0a") + aC(60, 62, 44, "#ffe082", `opacity=".18"`) +
      aSpark(22, 26, 7) + aSpark(98, 22, 6) + aSpark(100, 96, 5, "#fff3c4") + aSpark(18, 92, 4.5, "#fff3c4") + aSpark(84, 40, 3.5),
      `<defs><radialGradient id="${gg}" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#fffde7"/><stop offset=".35" stop-color="#ffd54f"/><stop offset=".8" stop-color="#ffb300"/><stop offset="1" stop-color="#a87100"/></radialGradient>` +
      `<clipPath id="${cp}"><circle cx="60" cy="62" r="32"/></clipPath></defs>` +
      `<path d="M44,104 H76 L72,96 H48Z" fill="#212121" ${A_OUT}/><path d="M50,96 Q60,92 70,96" fill="none" stroke="${A_OL}" stroke-width="1"/>` +
      `<path d="M40,104 H80 L84,128 H36Z" fill="#212121" ${A_OUT}/><rect x="30" y="128" width="60" height="9" rx="2" fill="#424242" ${A_OUT}/>` +
      `<rect x="46" y="110" width="28" height="11" rx="1.5" fill="#ffc107" ${A_OUT}/>${aStar(60, 115.5, 3.6, "#7a5200")}` +
      aEdge(aC(60, 62, 32, `url(#${gg})`) + `<g clip-path="url(#${cp})">${[[60, 62, 11, -Math.PI / 2], [60, 26, 10, Math.PI / 2], [27, 52, 10, 0], [93, 52, 10, Math.PI], [38, 94, 10, -Math.PI / 4], [82, 94, 10, Math.PI * 1.25]].map(p => aPent(...p, "#b8860b", `stroke="#7a5200" stroke-width="1"`)).join("")}</g>` +
        aC(60, 62, 32, "none", `stroke="#7a5200" stroke-width="1.6"`) + `<path d="M40,48 Q46,36 58,34" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" opacity=".8"/>`)];
  },
  goldboot: () => {   // a gold football boot on a plinth (not a real award)
    const g = aU("agbt"), boot = "M30,50 Q27,72 26,90 Q25,99 34,99 H97 Q107,99 107,91 Q107,82 95,79 Q80,75 70,68 Q62,62 61,50 Q46,45 30,50Z";
    return [aRadial(aU("abg"), "#2e7d32", "#0b2e13", ".45") + aSpark(18, 26, 6) + aSpark(102, 30, 7) + aSpark(100, 112, 4.5) + aSpark(16, 104, 4) + aSpark(78, 16, 3, "#fff3c4"),
      `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".3" stop-color="#ffd54f"/><stop offset=".65" stop-color="#ffb300"/><stop offset="1" stop-color="#9a6500"/></linearGradient></defs>` +
      `<g transform="translate(60 72) rotate(-12) translate(-64 -74)">` + [33, 45, 77, 90, 100].map(x => `<rect x="${x - 2.5}" y="98" width="5" height="6.5" rx="1.5" fill="#b8860b" ${A_OUT}/>`).join("") +
      `<path d="${boot}" fill="url(#${g})" stroke="${A_OL}" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M26,93 H106" stroke="#b8860b" stroke-width="4"/><path d="M26,96.5 Q26,99 34,99 H97 Q106,99 106.5,95" fill="none" stroke="${A_OL}" stroke-width="1.2"/>` +
      `<path d="M30,50 Q46,45 61,50 Q56,55 46,55 Q36,55 30,50Z" fill="#7a5200" ${A_OUT}/><path d="M33,84 Q52,70 78,80 L74,86 Q52,78 35,90Z" fill="#fff3c4" opacity=".8"/>` +
      [[60, 57], [63, 62], [67, 66.5]].map(([x, y]) => `<path d="M${x - 4},${y + 1.5} L${x + 4},${y - 2.5}" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`).join("") +
      `<path d="M33,58 Q32,72 33,82" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".75"/></g>` +
      `<path d="M36,116 H84 L90,124 H30Z" fill="#ffc107" ${A_OUT} stroke-linejoin="round"/>` + aPlinth("#ffc107")];
  },
};
// the special page, in the owner's order (S11, S1, S3, S6, S19, S9, S15, S14, S4 of the lab); ids sp1…sp9 by slot
const A_SP_ORDER = ["rook", "buddy", "referee", "royals", "rocket", "octopus", "robot", "goldball", "goldboot"];
/* ---- the catalogue, by team: each of the 12 teams has a football page (the kit + 8 players, one the team's mascot)
   and a "friends" page (5 basketball players and 4 animal friends in the team's kit); Portugal's section holds Portugal,
   Benfica and Vitória SC. Then the bosses' page. Ids are page id + slot: progress is stored by id, numbers can move.
   Album v2 (2026-10-03) moved the old basketball (bba, bbb) and animal (ana, anb) pages into the teams: `old` = the
   sticker's v1 id, albumMigrate carries its copies over ---- */
const A_SKIN = ["#f8dcc4", "#f2c29b", "#e0ac7e", "#b67a4b", "#8a5530", "#f5d6b4"];
const A_HAIR = { black: "#1b1b1b", dark: "#3b2314", brown: "#6b3e1f", blond: "#e3b84f", light: "#f3dc8c", red: "#b5501f" };
const A_EYES = { brown: "#6b3e1f", dark: "#3b2a1a", blue: "#3a7bd5", green: "#4a9a5a" };
const A_TEAMS = {
  pt: { kit: { shirt: "#DA291C", trim: "#0B8A4A", numStroke: "#fff", shorts: "#046A38", socks: "#DA291C" }, gk: { shirt: "#fdd835", trim: "#111", shorts: "#111", socks: "#fdd835" }, mascot: "rooster",
    looks: "1 dark brown|2 black dark|1 brown brown|1 dark green|3 black dark|0 brown brown|2 dark brown" },
  slb: { kit: { shirt: "#E30613", trim: "#fff", shorts: "#fff", socks: "#E30613" }, gk: { shirt: "#212121", trim: "#ffc107", shorts: "#212121", socks: "#212121" }, mascot: "eagle",
    looks: "2 dark brown|1 brown green|4 black dark|1 dark brown|0 blond blue|2 black brown|1 brown brown" },
  vsc: { kit: { shirt: "#fff", trim: "#111", shorts: "#111", socks: "#fff" }, gk: { shirt: "#ff9800", trim: "#111", shorts: "#ff9800", socks: "#ff9800" }, mascot: "penguin",
    looks: "1 brown brown|1 black dark|2 dark brown|0 brown green|3 black dark|1 dark brown|0 blond blue" },
  cn: { kit: { shirt: "#DE2910", trim: "#FFDE00", shorts: "#DE2910", socks: "#DE2910", star: 1 }, gk: { shirt: "#00897b", trim: "#fff", shorts: "#00897b", socks: "#00897b" }, mascot: "panda",
    looks: "5 black dark|5 black dark|5 dark dark|5 black dark|5 black brown|5 dark dark|5 black dark" },
  br: { kit: { shirt: "#FFDC02", trim: "#009C3B", shorts: "#002776", socks: "#fff" }, gk: { shirt: "#263238", trim: "#FFDC02", shorts: "#263238", socks: "#263238" }, mascot: "canary",
    looks: "3 black dark|2 dark brown|4 black dark|1 dark brown|3 black dark|2 brown brown|4 black dark" },
  es: { kit: { shirt: "#C60B1E", trim: "#FFC400", shorts: "#1D2A5C", socks: "#1D2A5C" }, gk: { shirt: "#7cb342", trim: "#111", shorts: "#7cb342", socks: "#7cb342" }, mascot: "bull",
    looks: "1 dark brown|2 black dark|1 brown green|1 dark brown|3 black dark|0 brown brown|1 dark brown" },
  ar: { kit: { shirt: "#fff", stripes: "#74ACDF", trim: "#111", numStroke: "#fff", shorts: "#111", socks: "#fff" }, gk: { shirt: "#6a1b9a", trim: "#fff", shorts: "#6a1b9a", socks: "#6a1b9a" }, mascot: "jaguar",
    looks: "1 brown brown|1 dark brown|2 black dark|1 dark brown|0 brown green|1 black dark|2 dark brown" },
  en: { kit: { shirt: "#fff", trim: "#1D2A5C", shorts: "#1D2A5C", socks: "#fff" }, gk: { shirt: "#fbc02d", trim: "#1D2A5C", shorts: "#fbc02d", socks: "#fbc02d" }, mascot: "lion",
    looks: "0 blond blue|1 brown brown|4 black dark|0 red green|3 black dark|0 blond blue|1 dark brown" },
  no: { kit: { shirt: "#BA0C2F", trim: "#fff", shorts: "#fff", socks: "#00205B" }, gk: { shirt: "#212121", trim: "#fff", shorts: "#212121", socks: "#212121" }, mascot: "polar",
    looks: "0 light blue|0 blond blue|1 brown green|0 light blue|2 black dark|0 blond blue|0 red green" },
  jp: { kit: { shirt: "#1B3A8C", trim: "#fff", shorts: "#fff", socks: "#1B3A8C" }, gk: { shirt: "#ef6c00", trim: "#111", shorts: "#ef6c00", socks: "#ef6c00" }, mascot: "fox",
    looks: "5 black dark|5 black dark|5 dark brown|5 black dark|5 black dark|5 brown brown|5 black dark" },
  fr: { kit: { shirt: "#14254F", trim: "#fff", numStroke: "#ED2939", shorts: "#fff", socks: "#ED2939" }, gk: { shirt: "#ec407a", trim: "#fff", shorts: "#ec407a", socks: "#ec407a" }, mascot: "hen",
    looks: "1 brown brown|4 black dark|0 blond blue|3 black dark|1 dark green|2 dark brown|0 red green" },
  it: { kit: { shirt: "#2F7DE1", trim: "#fff", shorts: "#fff", socks: "#2F7DE1" }, gk: { shirt: "#2e7d32", trim: "#fff", shorts: "#2e7d32", socks: "#2e7d32" }, mascot: "wolf",
    looks: "1 dark brown|2 black dark|1 brown green|0 dark brown|3 black dark|2 brown brown|0 blond blue" },
  kr: { kit: { shirt: "#E4002B", trim: "#fff", numStroke: "#111", shorts: "#111", socks: "#E4002B" }, gk: { shirt: "#26a69a", trim: "#111", shorts: "#26a69a", socks: "#26a69a" }, mascot: "hodori",
    looks: "5 black dark|5 black dark|5 dark brown|5 black dark|5 black dark|1 black dark|5 dark dark" },
  ch: { kit: { shirt: "#DA291C", trim: "#fff", shorts: "#DA291C", socks: "#DA291C", sockTrim: "#fff" }, gk: { shirt: "#fbc02d", trim: "#111", shorts: "#fbc02d", socks: "#fbc02d" }, mascot: "stbernard",
    looks: "0 brown blue|1 dark brown|3 black dark|0 blond blue|2 dark brown|0 light green|4 black dark" },
  cv: { kit: { shirt: "#003893", trim: "#fff", numStroke: "#CF2027", shorts: "#003893", socks: "#003893", sockTrim: "#CF2027" }, gk: { shirt: "#ff9800", trim: "#111", shorts: "#ff9800", socks: "#ff9800" }, mascot: "shark",
    looks: "4 black dark|3 black dark|4 black dark|2 dark brown|3 black brown|4 black dark|1 dark green" },
  de: { kit: { shirt: "#fff", trim: "#111", numStroke: "#FFCE00", shorts: "#111", socks: "#fff" }, gk: { shirt: "#43a047", trim: "#fff", shorts: "#43a047", socks: "#43a047" }, mascot: "eagleb",
    looks: "0 blond blue|1 brown brown|3 black dark|0 light blue|1 dark green|4 black dark|0 brown blue" },
  nl: { kit: { shirt: "#F36C21", trim: "#fff", numStroke: "#21468B", shorts: "#fff", socks: "#F36C21" }, gk: { shirt: "#00acc1", trim: "#111", shorts: "#00acc1", socks: "#00acc1" }, mascot: "lionnl",
    looks: "0 blond blue|4 black dark|1 brown brown|0 light blue|3 black dark|0 blond green|1 dark brown" },
};
// a team page: the kit, then eight players (two of them women: ponytail, long lashes), the last the team's mascot
const A_SLOTS = [
  { pose: "kit", num: 10 },
  { pose: "kick", num: 9, hs: "spiky" }, { pose: "keeper", num: 1, hs: "neat", gk: 1 }, { pose: "header", num: 4, hs: "buzz" },
  { pose: "run", num: 8, hs: "pony", lash: 1 }, { pose: "cheer", num: 10, hs: "spiky" }, { pose: "kick", num: 11, hs: "pony", lash: 1 },
  { pose: "lift", num: 5, hs: "curly" }, { pose: "cheer", num: 12, mascot: 1 },
];
function aLook(team, i) {
  const [sk, h, e] = A_TEAMS[team].looks.split("|")[i].split(" ");
  return { skin: A_SKIN[+sk], hair: A_HAIR[h], eyes: A_EYES[e] };
}
// the sections of the book (a flag each; Portugal's holds the two Portuguese clubs), every team = 3 pages (football, friends, pictures)
// (Cape Verde beside Portugal, then Europe, South America, Asia)
const A_SECTIONS = [["pt", "slb", "vsc"], ["cv"], ["es"], ["fr"], ["it"], ["de"], ["nl"], ["ch"], ["en"], ["no"], ["br"], ["ar"], ["cn"], ["jp"], ["kr"]];
/* the theme pages after the teams (the owner, 2026-10-03: heroes, Octonauts, Peppa, Paw Patrol, Hot Wheels; faithful
   versions, family use): page id, the drawings' key in FAN, icon, section (the two hero pages share one frame). The
   drawings are js/fan/<key>.js (built after this file, drafted in lab/fan_ideas.html): FAN.<key> = 9 rows
   [name, what, draw], draw() = [backdrop, character] like the picture pages; read only when a sticker is drawn */
const FAN = {};
const A_FAN = [["mv", "marvel", "🕷️", "hero"], ["dc", "dc", "🦇", "hero"], ["oct", "octonauts", "🐙", "oct"], ["pig", "peppa", "🐷", "pig"],
  ["paw", "pawpatrol", "🐾", "paw"], ["hw", "hotwheels", "🏎️", "hw"]];
const A_PAGES = [
  { id: "sp", icon: "🌟", sec: "sp" },
  ...A_SECTIONS.flatMap(ts => ts.flatMap(t => [{ id: t, team: t, sec: ts[0] }, { id: t + "x", team: t, sec: ts[0], friends: 1 }, { id: t + "y", team: t, sec: ts[0], pics: 1 }])),
  ...A_FAN.map(([id, fan, icon, sec]) => ({ id, fan, icon, sec })),
  { id: "boss", icon: "👑", sec: "boss" },
];
/* a team's friends page: 5 basketball players "b pose lookSlot number" (look slots 3 and 5 are the women) and 4 animal
   friends "a animal pose number", laid out like a chequerboard; ":old" = the sticker's id before album v2 */
const A_FRIENDS = {
  pt: "b dribble 0 7:bba1|a chick dribble 3:anb7|b shoot 4 4:bbb3|a lion kick 9|b shoot 3 11|a polar keeper 1|b dribble 5 23|a jaguar header 17|b dribble 2 15",
  slb: "b shoot 5 14:bba6|a rooster shoot 6:anb8|b dribble 3 21:bbb7|a tiger run 18|b dribble 0 7|a bear keeper 1|b shoot 2 10|a rabbit cheer 4|b shoot 6 30",
  vsc: "b shoot 2 9:bbb1|a bull shoot 7:anb6|b dribble 4 10:bbb9|a fox kick 11|b dribble 3 5|a canary header 2|b shoot 5 8|a mouse cheer 20|b dribble 1 12",
  cn: "b shoot 1 11:bba2|a tiger kick 1:ana1|b dribble 3 15:bbb2|a dragon kick 9:ana9|b dribble 5 6|a rabbit run 8|b shoot 0 9|a monkey shoot 3|b shoot 4 14",
  br: "b dribble 2 10:bba3|a monkey kick 6:ana6|b shoot 5 12:bbb5|a jaguar dribble 18:anb9|b shoot 3 7|a eagle header 3|b dribble 0 4|a chick cheer 20|b dribble 6 11",
  es: "b shoot 3 5:bba4|a bear lift 7:ana7|b dribble 0 9:bbb4|a eagle dribble 14:anb5|b dribble 5 13|a mouse run 8|b shoot 2 6|a wolf keeper 1|b shoot 4 23",
  ar: "b dribble 4 6:bba5|a trex dribble 12:anb3|b shoot 6 7:bbb8|a penguin shoot 13:anb4|b shoot 3 5|a polar run 4|b dribble 5 10|a canary cheer 21|b shoot 1 9",
  en: "b shoot 0 23:bba8|a mouse run 4:ana4|b dribble 3 8|a fox run 8:ana8|b shoot 5 11|a dragon header 6|b dribble 2 4|a panda keeper 1|b dribble 4 7",
  no: "b dribble 1 13:bba9|a wolf header 3:ana3|b shoot 3 9|a fox cheer 7|b dribble 5 6|a penguin keeper 1|b shoot 0 12|a trex kick 19|b shoot 2 5",
  jp: "b dribble 6 8:bba7|a cat cheer 2:ana2|b shoot 1 3:bbb6|a panda dribble 10:anb1|b shoot 3 11|a monkey run 5|b dribble 5 7|a tiger lift 9|b dribble 0 14",
  fr: "b dribble 0 9|a rabbit keeper 5:ana5|b shoot 3 5|a cat kick 10|b dribble 5 11|a bear shoot 4|b shoot 1 7|a rooster run 17|b dribble 4 23",
  it: "b shoot 2 6|a lion shoot 11:anb2|b dribble 3 8|a bull run 4|b shoot 5 13|a eagle kick 9|b dribble 0 10|a cat header 7|b shoot 4 7",
  kr: "b shoot 0 7|a rabbit kick 11|b dribble 3 10|a panda header 5|b shoot 5 13|a fox keeper 1|b dribble 1 9|a monkey run 17|b shoot 4 6",
  ch: "b dribble 2 10|a cat run 8|b shoot 3 4|a polar kick 9|b dribble 5 14|a bear keeper 1|b shoot 0 23|a mouse cheer 11|b dribble 6 7",
  cv: "b shoot 1 12|a penguin kick 7|b dribble 3 9|a monkey header 10|b shoot 5 5|a chick run 4|b dribble 0 11|a bull keeper 1|b shoot 2 8",
  de: "b dribble 0 5|a wolf kick 13|b shoot 3 14|a fox header 7|b dribble 5 8|a bear run 10|b shoot 4 6|a rabbit keeper 1|b dribble 2 9",
  nl: "b shoot 2 14|a mouse kick 10|b dribble 3 7|a rooster run 9|b shoot 5 11|a cat keeper 1|b dribble 0 4|a penguin cheer 8|b shoot 6 3",
};
const A_BB_HAIR = ["spiky", "neat", "buzz", "pony", "spiky", "pony", "curly"];      // by look slot, as on the football page
// the bosses of the learning path: a crown, the bot's ring colour on a black kit; only beating that boss gives it
const A_BOSSES = [["gate1", "cat", "kick", 2], ["gate2", "wolf", "header", 3], ["gate4", "chick", "cheer", 0], ["gate3", "tiger", "keeper", 4], ["gate5", "trex", "lift", 5], ["gate6", "dragon", "kick", 6]];
const STK = (() => {
  const out = [], add = (pg, o) => out.push({ ...o, id: pg.id + (out.filter(s => s.page === pg).length + 1), page: pg, n: out.length + 1 });
  for (const pg of A_PAGES) {
    const T = A_TEAMS[pg.team];
    if (pg.friends) A_FRIENDS[pg.team].split("|").forEach(row => {
      const [spec, old] = row.split(":"), f = spec.split(" "), k = T.kit;
      const kit = { shirt: k.shirt, stripes: k.stripes, trim: k.trim, numStroke: k.numStroke, old };
      if (f[0] === "b") add(pg, { bd: "court", mini: pg.team, pose: f[1], num: +f[3], hs: A_BB_HAIR[+f[2]], lash: f[2] === "3" || f[2] === "5" ? 1 : 0,
        ...aLook(pg.team, +f[2]), ...kit, shorts: k.shirt, socks: "#fff" });
      else add(pg, { bd: A_POSES[f[2]].bball ? "court" : "pitch", mini: pg.team, head: f[1], pose: f[2], num: +f[3], ...kit,
        shorts: A_POSES[f[2]].bball ? k.shirt : k.shorts, socks: A_POSES[f[2]].bball ? "#fff" : k.socks });
    });
    else if (pg.pics) A_YPAGE.forEach(o => add(pg, { ...o, team: pg.team }));
    else if (pg.id === "sp") A_SP_ORDER.forEach(k => add(pg, { sp: k }));
    else if (pg.fan) for (let fi = 0; fi < 9; fi++) add(pg, { fan: pg.fan, fi });
    else if (pg.team) A_SLOTS.forEach((sl, i) => {
      const kit = sl.gk ? { ...T.gk, gloves: "#fff" } : T.kit;
      add(pg, { bd: pg.team, ...kit, ...sl, ...(sl.mascot ? { head: T.mascot } : i ? aLook(pg.team, i - 1) : {}), gk: undefined, mascot: undefined });
    });
    else A_BOSSES.forEach(([gate, head, pose, lvl]) =>
      add(pg, { bd: "boss", head, pose, boss: gate, crown: 1, num: 1, shirt: "#212121", trim: lvl ? BOT_RING[lvl - 1] : "#fff", shorts: "#212121", socks: "#212121" }));
  }
  return out;
})();
// album v1 id → v2 id of the stickers that moved (the old basketball and animal pages)
const A_VER = 3, A_MOVED = Object.fromEntries(STK.filter(st => st.old).map(st => [st.old, st.id]));
/* bring an album up to A_VER (in place, once: guarded by a.v; running it again changes nothing). v2: a moved sticker keeps
   its copies. v3 (2026-10-03, packs of 5 for every solve): c0 = the solves the old rule (a pack of 3 per 5) already paid
   for, p3 = the packs earned until then (incl. gifts), which stay packs of 3: the switch gives no packs for past solves */
function albumMigrate(a) {
  if (!a || (a.v || 1) >= A_VER) return a;
  const s = a.s || (a.s = {});
  if ((a.v || 1) < 2) for (const [o, n] of Object.entries(A_MOVED)) if (o in s) { s[n] = Math.max(s[n] || 0, s[o] || 0); delete s[o]; }
  a.c0 = a.c || 0; a.p3 = Math.floor(a.c0 / OLD_EVERY) + (a.b || 0);
  a.v = A_VER;
  return a;
}

/* ---- progress: pl.album = { c: clean path solves, b: extra packs (the old stickers, a parent's gift), o: packs opened,
   s: { sticker id: copies }, v: catalogue version, c0 / p3: see albumMigrate }. Packs are drawn from a seed (the pack's number),
   so two devices that open the same pack get the same stickers and mergePlayer can take the larger of each count ---- */
// the owner (2026-10-03): "5 stickers per solve" = a pack of 5 for every clean solve after the switch (before: 3 per 5 solves)
const PACK_EVERY = 1, PACK_SIZE = 5, OLD_EVERY = 5, OLD_SIZE = 3, OLD_PACKS_MAX = 10;
function albumOf(pl) {
  // first time: one pack per sticker of the old "a sticker every 10 stars" row, at most OLD_PACKS_MAX
  if (!pl.album) pl.album = { c: 0, b: Math.min(OLD_PACKS_MAX, Math.floor((pl.stars || 0) / 10)), o: 0, s: {}, v: A_VER, c0: 0, p3: 0 };
  return albumMigrate(pl.album);
}
// a boss's sticker: owned once that gate is beaten (also for gates beaten before the sticker book existed)
function stkOwned(pl, st) { const n = albumOf(pl).s[st.id] || 0; return st.boss ? (n || stageStars(pl, st.boss) >= 1 ? 1 : 0) : n; }
function stkTier(st, copies) { return st.boss ? 3 : copies >= 5 ? 3 : copies >= 3 ? 2 : copies >= 2 ? 1 : 0; }
function packsEarned(a) { const c0 = a.c0 || 0; return Math.floor(c0 / OLD_EVERY) + Math.floor(Math.max(0, a.c - c0) / PACK_EVERY); }
function packsWaiting(pl) { const a = albumOf(pl); return Math.max(0, packsEarned(a) + a.b - a.o); }
// a clean solve on the learning path (stageStar, an endgame win): every PACK_EVERY of them is a pack.
// No pop-up, no sound (the owner: packs must never pull the child away from playing): the counters go up, and a small
// pack shows beside the ▶ of that puzzle or endgame (albumTake); the packs are opened in the 📖 tab
let albumJust = false;
function albumSolve(pl) {
  const a = albumOf(pl);
  a.c++;
  if ((a.c - (a.c0 || 0)) % PACK_EVERY === 0) albumJust = true;
  aBadge();
}
function albumTake() { const j = albumJust; albumJust = false; return j; }
// the small pack shown in a puzzle card / beside an endgame's ↻ ▶: tapping it opens the book, like the counters at the top
function aPackChip() { return `<button type="button" class="apchip" aria-label="A new sticker pack: open the sticker book">${aPackSvg()}</button>`; }
document.addEventListener("click", ev => { if (ev.target.closest && ev.target.closest(".apchip")) albumGo(ev); });
// to the 📖 tab (from the kids' corner or a kid puzzle; the same on the iPad site)
function albumGo(ev) {
  if (ev && ev.stopPropagation) ev.stopPropagation();
  if (window.SECTION === "kids") { kidTab = "stickers"; openKids(); } else go("kids", "stickers");
}
function aRand(seed) {      // mulberry32
  let t = seed >>> 0;
  return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
// open the next pack: PACK_SIZE different stickers (OLD_SIZE for a pack earned before the switch, albumMigrate), one of them new while any is missing (bosses only come from bosses)
function packOpen(pl) {
  if (packsWaiting(pl) <= 0) return null;
  const a = albumOf(pl), R = aRand(a.o * 7919 + 104729), size = a.o < (a.p3 || 0) ? OLD_SIZE : PACK_SIZE;
  a.o++;
  const pool = STK.filter(st => !st.boss), missing = pool.filter(st => !a.s[st.id]), pick = [];
  if (missing.length) pick.push(missing[Math.floor(R() * missing.length)]);
  while (pick.length < size) { const st = pool[Math.floor(R() * pool.length)]; if (!pick.includes(st)) pick.push(st); }
  for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
  const got = pick.map(st => { const was = a.s[st.id] || 0; a.s[st.id] = was + 1; return { st, was }; });
  save(); aBadge();
  return got;
}
// a boss gate beaten (kids.js gateWin): its sticker goes into the book (no pop-up: the medal is enough there)
function albumBoss(pl, gateId) {
  const st = STK.find(x => x.boss === gateId); if (!st) return;
  albumOf(pl).s[st.id] = 1;
}

/* ---- pictures: a sticker card (tier frame, number), the pack, the back of a sticker ---- */
function stickerCard(st, copies, cls = "") {
  const t = stkTier(st, copies);
  return `<div class="stk t${t}${cls ? " " + cls : ""}" data-st="${st.id}"><div class="sin">${stickerSvg(st)}<span class="sno">${st.n}</span>${t ? `<span class="spip">${"◆".repeat(t)}</span>` : ""}</div></div>`;
}
const A_PACK_TOP = `<polygon points="4,14 4,6 10,2 16,6 22,2 28,6 34,2 40,6 46,2 52,6 58,2 64,6 70,2 76,6 76,14" fill="#0d47a1" stroke="#ffc107" stroke-width="1.5"/>`;
function aPackSvg(part = "all") {
  const body = `<rect x="4" y="13" width="72" height="90" rx="3" fill="#1565c0" stroke="#ffc107" stroke-width="2"/>
    <polygon points="4,40 76,22 76,34 4,52" fill="#fff" opacity=".18"/><polygon points="4,96 76,78 76,82 4,100" fill="#fff" opacity=".12"/>
    ${aStar(16, 26, 5, "#ffc107")}${aStar(64, 92, 5, "#ffc107")}<circle cx="40" cy="58" r="21" fill="#ffc107"/><circle cx="40" cy="58" r="18" fill="#0d47a1"/>
    <g transform="translate(40 58) scale(1.6) translate(-40 -58)">${aFootball(40, 58, 9)}</g>${aBasketball(60, 76, 7)}
    <polygon points="4,103 76,103 76,108 70,112 64,108 58,112 52,108 46,112 40,108 34,112 28,108 22,112 16,108 10,112 4,108" fill="#0d47a1" stroke="#ffc107" stroke-width="1.5"/>`;
  return `<svg class="apacksvg" viewBox="0 0 80 114" aria-hidden="true">${part !== "top" ? body : ""}${part !== "body" ? A_PACK_TOP : ""}</svg>`;
}
const A_CARD_BACK = `<svg viewBox="0 0 120 158" aria-hidden="true"><rect width="120" height="158" fill="#1565c0"/>${[...Array(24)].map((_, i) => aStar(10 + (i % 4) * 33 + (Math.floor(i / 4) % 2) * 16, 12 + Math.floor(i / 4) * 27, 3.5, "#42a5f5")).join("")}
  <circle cx="60" cy="79" r="30" fill="#ffc107"/><circle cx="60" cy="79" r="26" fill="#0d47a1"/><g transform="translate(60 79) scale(2) translate(-60 -79)">${aFootball(60, 79, 9)}</g></svg>`;
// a page's picture: the team's flag (crest for a club); its friends page = the flag with a basketball and a paw on it,
// its picture page = the flag with a little framed picture (sky, sun, hills) and a gold sparkle
const A_PAW = `<ellipse cx="10" cy="13" rx="5" ry="4.2" fill="#4e342e"/>${[[4.2, 7.6], [8, 4.6], [12, 4.6], [15.8, 7.6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.1" fill="#4e342e"/>`).join("")}`;
const A_PIC_ICON = `<svg class="abdg l" viewBox="0 0 20 20"><rect x="1.5" y="3" width="17" height="14" rx="1.5" fill="#fff" stroke="#4e342e" stroke-width="1.4"/><rect x="3.5" y="5" width="13" height="10" fill="#81d4fa"/>` +
  `<circle cx="13" cy="8" r="1.8" fill="#ffca28"/><path d="M3.5,15 L8,9.5 L11,13 L13,11 L16.5,15Z" fill="#43a047"/></svg>`;
const A_SPARK_ICON = `<svg class="abdg r" viewBox="0 0 20 20">${aC(10, 10, 9.6, "#fff")}${aSpark(10, 10, 8, "#ffb300")}${aSpark(15.5, 4.5, 2.6, "#ffb300")}</svg>`;
// (small = the page buttons, where a friends page sits beside its team's flag: the paw and the ball alone)
function aPageIcon(pg, w = 40, h = 27, small = false) {
  if (!pg.team) return `<span class="aemo">${pg.icon}</span>`;
  if (!pg.friends && !pg.pics) return aMiniFlag(pg.team, w, h);
  const paw = pg.pics ? A_PIC_ICON : `<svg class="abdg l" viewBox="0 0 20 20">${aC(10, 10, 9.6, "#fff")}<g transform="translate(1.2 1.6) scale(.88)">${A_PAW}</g></svg>`;
  const ball = pg.pics ? A_SPARK_ICON : `<svg class="abdg r" viewBox="0 0 20 20">${aBasketball(10, 10, 8.6)}</svg>`;
  if (small) return `<span class="aico f" style="height:${h}px">${paw}${ball}</span>`;
  return `<span class="aico" style="width:${w}px;height:${h}px">${aMiniFlag(pg.team, w, h)}${paw}${ball}</span>`;
}

/* ---- the book (kids' 📖 tab): one page at a time, ◀ ▶ or a swipe to turn, the pages' pictures below to jump;
   packs waiting at the top. Opening one: tap the pack (it tears by itself after a moment), three stickers turn over,
   then wait in a tray at the bottom; tapping one turns to its page and it flies into its slot ---- */
let albumPage = 0, albumTray = [], albumHold = {}, albumTrayPl = null, albumPreview = null;
// copies to show: a sticker still in the tray shows its slot as before (albumHold) until it lands
function aCopies(pl, st) {
  if (albumPreview) return albumPreview[st.id] || 0;
  return st.id in albumHold ? albumHold[st.id] : stkOwned(pl, st);
}
// packs waiting: the red count on the 📖 tab, and a small pack + count at the top right (kids' bar, kid puzzles)
function aBadge() {
  if (!$("kAlbumBadge") || !S.players) return;
  const n = packsWaiting(pzPlayers());
  $("kAlbumBadge").hidden = !n; $("kAlbumBadge").textContent = n;
  for (const [id, show] of [["kPacksTop", true], ["pzPacks", typeof pzKid === "function" && pzKid()]]) {
    const el = $(id); if (!el) continue;
    const had = +(el.dataset.n || 0);
    el.hidden = !n || !show; el.dataset.n = n; el.innerHTML = `${aPackSvg()}<b>${n}</b>`;
    if (!el.onclick) { el.onclick = albumGo; el.setAttribute("role", "button"); el.tabIndex = 0; el.setAttribute("aria-label", "Sticker packs waiting: open the sticker book"); }
    if (n > had && had >= 0 && el.dataset.seen) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
    el.dataset.seen = 1;
  }
}
function renderAlbum() {
  const pl = pzPlayers();
  aDefs();
  if (albumTrayPl !== S.player) { albumTray = []; albumHold = {}; albumTrayPl = S.player; }
  $("kStickers").innerHTML = `${albumPreview ? `<div class="apreview"><span>Preview of the whole book with made-up copies: nothing is saved.</span>
      <button class="btn" type="button" id="aPrevOff">Close the preview</button></div>` : ""}
    <div class="atop" id="aTop"></div>
    <div class="abook"><button class="btn big apg" type="button" id="aPrev" aria-label="Previous page">◀</button>
      <div class="apage" id="aPage"></div>
      <button class="btn big apg" type="button" id="aNext" aria-label="Next page">▶</button></div>
    <div class="anav" id="aNav" role="group" aria-label="Pages"></div>`;
  if (!$("aTray")) { const t = document.createElement("div"); t.className = "atray"; t.id = "aTray"; $("kidsView").appendChild(t); }
  if (albumPreview) $("aPrevOff").onclick = () => { albumPreview = null; renderAlbum(); };
  $("aPrev").onclick = () => aTurn(albumPage - 1);
  $("aNext").onclick = () => aTurn(albumPage + 1);
  let down = null;
  $("aPage").onpointerdown = ev => { down = { x: ev.clientX, y: ev.clientY }; };
  $("aPage").onpointerup = ev => {
    if (!down) return;
    const dx = ev.clientX - down.x, dy = ev.clientY - down.y; down = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return aTurn(albumPage + (dx < 0 ? 1 : -1));
    const slot = ev.target.closest(".aslot.got");
    if (slot && Math.abs(dx) < 12 && Math.abs(dy) < 12) aZoom(STK.find(st => st.id === slot.dataset.st));
  };
  aRenderTop(); aRenderPage(); aRenderTray();
  const bar = document.querySelector(".kidbar");      // the book is sized for the screen below the tabs: bring them to the top
  if (bar && bar.getBoundingClientRect().top > 8 && !window.GYM_KIDS_ONLY) bar.scrollIntoView({ block: "start", behavior: "smooth" });
}
function aRenderTop() {
  const pl = pzPlayers(), a = albumOf(pl), n = albumPreview ? 0 : packsWaiting(pl), have = STK.filter(st => aCopies(pl, st)).length;
  $("aTop").innerHTML = `${albumPreview ? "" : `<button type="button" class="apack ${n ? "ready" : "wait"}" id="aPack" aria-label="${n ? "Open a sticker pack" : "Next pack"}">${aPackSvg()}${n ? `<b>${n}</b>` : ""}</button>
      ${n || PACK_EVERY < 2 ? "" : `<span class="adots" aria-label="Clean solves towards the next pack">${[...Array(PACK_EVERY)].map((_, i) => `<i class="${i < a.c % PACK_EVERY ? "on" : ""}"></i>`).join("")}</span>`}`}
    <span class="atotal">📖 <span class="abar"><i style="width:${100 * have / STK.length}%"></i></span> <b>${have}</b><small>/${STK.length}</small></span>`;
  // a pack opens while the tray is empty (5 stickers to stick first: the tray holds one pack)
  if ($("aPack")) $("aPack").onclick = () => { if (packsWaiting(pzPlayers()) && !albumTray.length) aOpenPack(); else { $("aPack").classList.remove("nope"); void $("aPack").offsetWidth; $("aPack").classList.add("nope"); } };
}
function aRenderPage() {
  const pl = pzPlayers(), pg = A_PAGES[albumPage], sts = STK.filter(st => st.page === pg), have = sts.filter(st => aCopies(pl, st)).length;
  $("aPage").className = "apage" + (have === sts.length ? " full" : "");
  $("aPage").innerHTML = `<div class="ahead">${pg.sec !== pg.team && pg.team ? `<span class="asec">${aMiniFlag(pg.sec, 36, 24)}</span>` : ""}${aPageIcon(pg, 48, 32)}<span class="abar"><i style="width:${100 * have / sts.length}%"></i></span><b>${have}</b><small>/${sts.length}</small></div>
    <div class="agrid">${sts.map(st => { const c = aCopies(pl, st);
      return `<div class="aslot${c ? " got" : ""}${st.half ? " h" + st.half : ""}" data-st="${st.id}">${c ? stickerCard(st, c) : `${stickerSvg(st, true)}<span class="anum">${st.n}</span>`}</div>`; }).join("")}</div>`;
  $("aPrev").disabled = albumPage === 0; $("aNext").disabled = albumPage === A_PAGES.length - 1;
  // the pages' pictures, grouped by section (a team's two pages, Portugal's six) in one frame each
  const btn = (p, i) => {
    const s = STK.filter(st => st.page === p), h = s.filter(st => aCopies(pl, st)).length;
    return `<button type="button" data-pg="${i}" aria-pressed="${i === albumPage}" class="${h === s.length ? "full" : ""}" aria-label="Page ${i + 1}">${aPageIcon(p, 27, 18, true)}<i><b style="width:${100 * h / s.length}%"></b></i></button>`;
  };
  $("aNav").innerHTML = [...new Set(A_PAGES.map(p => p.sec))].map(sec => `<div class="agrp${pg.sec === sec ? " on" : ""}" data-sec="${sec}">${
    A_PAGES.map((p, i) => p.sec === sec ? btn(p, i) : "").join("")}</div>`).join("");
  $("aNav").querySelectorAll("[data-pg]").forEach(b => b.onclick = () => aTurn(+b.dataset.pg));
}
function aRenderTray() {
  const t = $("aTray"); if (!t) return;
  t.hidden = !albumTray.length || window.SECTION !== "kids" || kidTab !== "stickers";
  t.innerHTML = albumTray.map((g, i) => `<button type="button" class="aitem" data-i="${i}" style="--i:${i}" aria-label="Stick it in">${stickerCard(g.st, g.was + 1)}</button>`).join("");
  t.querySelectorAll("[data-i]").forEach(b => b.onclick = () => aStick(albumTray[+b.dataset.i], b));
}
function aTurn(i, then) {
  if (i < 0 || i >= A_PAGES.length || aTurn.busy) return;
  if (i === albumPage) return then && then();
  const el = $("aPage"), dir = i > albumPage ? "l" : "r";
  aTurn.busy = true; sfx("flip");
  el.classList.add("out-" + dir);
  setTimeout(() => {
    albumPage = i; aRenderPage(); el.classList.add("in-" + dir);
    setTimeout(() => { el.classList.remove("in-" + dir); aTurn.busy = false; if (then) then(); }, 230);
  }, 200);
}
function aOpenPack() {
  const ov = $("aOverlay");
  if (albumPreview || !ov.hidden || albumTray.length) return;
  const got = packOpen(pzPlayers()); if (!got) return;
  for (const g of got) if (!(g.st.id in albumHold)) albumHold[g.st.id] = g.was;
  aRenderTop();
  ov.innerHTML = `<div class="apackbig" id="aTear"><span class="ptop">${aPackSvg("top")}</span><span class="pbody">${aPackSvg("body")}</span></div><div class="areveal" id="aReveal"></div>`;
  ov.hidden = false;
  let torn = false, done = false;
  const toTray = () => {
    if (done) return; done = true; clearTimeout(toTray.t);
    ov.hidden = true; ov.onclick = null; ov.innerHTML = "";
    albumTray.push(...got); aRenderTray();
  };
  const tear = () => {
    if (torn) return; torn = true; clearTimeout(tear.t); sfx("tear");
    $("aTear").classList.add("torn");
    setTimeout(() => {
      $("aTear").hidden = true;
      // a new sticker: a sparkle badge; a copy: pips towards the next tier, and when it reaches one, the frame turns into it
      $("aReveal").innerHTML = got.map((g, i) => {
        const c = g.was + 1, up = g.was && stkTier(g.st, c) > stkTier(g.st, g.was);
        return `<div class="aflip${g.was ? " dup" : " new"}" style="--i:${i}" data-st="${g.st.id}"><div class="aback">${A_CARD_BACK}</div><div class="afront">${stickerCard(g.st, up ? g.was : c)}` +
          `${g.was ? aPips(c) : `<span class="amark anew">${A_NEW}</span>`}</div></div>`;
      }).join("");
      got.forEach((g, i) => setTimeout(() => sfx(g.was ? "flip" : "sticker"), 350 + i * 450));
      got.forEach((g, i) => {
        if (!g.was || stkTier(g.st, g.was + 1) <= stkTier(g.st, g.was)) return;
        setTimeout(() => { const el = $("aReveal") && $("aReveal").querySelector(`.aflip[data-st="${g.st.id}"] .stk`); if (el) el.outerHTML = stickerCard(g.st, g.was + 1, "tup"); }, 950 + i * 450);
      });
      const shown = 350 + got.length * 450 + 300;
      setTimeout(() => { if (!done) ov.onclick = toTray; }, shown);
      toTray.t = setTimeout(toTray, shown + 1800);
    }, 500);
  };
  ov.onclick = tear;
  tear.t = setTimeout(tear, 2500);
}
// pack opening: the "new" badge (a gold burst with a sparkle), and a copy's pips: one per copy up to the next tier's
// count (2 silver, 3 gold, 5 holo), filled in the tier each copy reached, the empty ones ringed in the next tier's colour
const A_NEW_PTS = [...Array(24)].map((_, i) => { const a = i * Math.PI / 12, r = i % 2 ? 31 : 48; return (r * Math.sin(a)).toFixed(1) + "," + (-r * Math.cos(a)).toFixed(1); }).join(" ");
const A_NEW = `<svg viewBox="-50 -50 100 100" aria-hidden="true"><polygon points="${A_NEW_PTS}" fill="#ffca28" stroke="#e65100" stroke-width="3" stroke-linejoin="round"/>
  <path d="M0,-27 Q4,-4 27,0 Q4,4 0,27 Q-4,4 -27,0 Q-4,-4 0,-27Z" fill="#fff"/><path d="M19,-29 Q20.5,-22 27,-21 Q20.5,-20 19,-13 Q17.5,-20 11,-21 Q17.5,-22 19,-29Z" fill="#fff"/></svg>`;
function aPips(c) {
  const next = [2, 3, 5].find(x => x > c), n = next || 5;
  return `<span class="apips" aria-label="${c} copies">${[...Array(n)].map((_, k) => k < c ? `<i class="p${stkTier({}, k + 1)}${k === c - 1 ? " nw" : ""}"></i>` : `<i class="e${stkTier({}, n)}"></i>`).join("")}</span>`;
}
// a sticker from the tray flies into its slot (turning to its page first)
function aStick(g, el) {
  if (!g || g.fly) return;
  g.fly = true;
  const land = () => {
    const slot = $("aPage").querySelector(`.aslot[data-st="${g.st.id}"]`), from = el.getBoundingClientRect(), to = slot.getBoundingClientRect();
    const f = document.createElement("div");
    f.className = "afly"; f.style.cssText = `left:${from.left}px;top:${from.top}px;--cw:${from.width}px`;
    f.innerHTML = stickerCard(g.st, g.was + 1);
    document.body.appendChild(f); el.style.visibility = "hidden";
    void f.offsetWidth;
    f.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})`;
    setTimeout(() => {
      f.remove();
      albumTray.splice(albumTray.indexOf(g), 1);
      const more = albumTray.filter(x => x.st === g.st);        // the same sticker from a later pack still waiting
      if (more.length) albumHold[g.st.id] = Math.min(...more.map(x => x.was)); else delete albumHold[g.st.id];
      aRenderPage(); aRenderTop(); aRenderTray(); sfx("sticker");
      const c = $("aPage").querySelector(`.aslot[data-st="${g.st.id}"] .stk`); if (c) c.classList.add("land");
    }, 700);
  };
  const pi = A_PAGES.indexOf(g.st.page);
  if (pi === albumPage) land(); else if (!aTurn.busy) aTurn(pi, land); else g.fly = false;
}
// a sticker in the book, big, with its ladder: plain, silver, gold, holo (the ones reached lit)
function aZoom(st) {
  const ov = $("aOverlay"), c = aCopies(pzPlayers(), st), t = stkTier(st, c);
  ov.innerHTML = `<div class="azoom">${stickerCard(st, c)}<div class="aladder">${[0, 1, 2, 3].map(k => `<i class="l${k}${k <= t ? " on" : ""}"></i>`).join("")}<b>×${c}</b></div></div>`;
  ov.hidden = false; sfx("flip");
  ov.onclick = () => { ov.hidden = true; ov.onclick = null; ov.innerHTML = ""; };
}

/* ---- parents: the numbers, a pack as a gift, a preview of the whole book; test buttons on a copy opened from disk ---- */
function albumParents(pl) {
  const a = albumOf(pl), have = STK.filter(st => stkOwned(pl, st)).length, local = location.protocol === "file:";
  return `<figure class="chart wide"><figcaption>Sticker book</figcaption>
    <p class="tiny">A pack of ${PACK_SIZE} stickers for every ${PACK_EVERY > 1 ? PACK_EVERY + " clean solves" : "clean solve"} on the learning path (puzzles, endgames and the review stop, replays too), and each boss's own sticker when it's beaten.
      Every pack holds at least one sticker missing from the book until it's full. Copies turn a sticker silver (2), gold (3), then holo (5).</p>
    <div class="tiles"><div class="tile"><span class="lbl">Stickers</span><b>${have}/${STK.length}</b></div>
      <div class="tile"><span class="lbl">Packs opened</span><b>${a.o}</b></div><div class="tile"><span class="lbl">Packs waiting</span><b>${packsWaiting(pl)}</b></div>
      <div class="tile"><span class="lbl">Next pack in</span><b>${PACK_EVERY - (a.c - (a.c0 || 0)) % PACK_EVERY} solve${PACK_EVERY - (a.c - (a.c0 || 0)) % PACK_EVERY > 1 ? "s" : ""}</b></div></div>
    <div class="controls"><button class="btn" type="button" id="aGift">Give a pack</button><button class="btn" type="button" id="aPrevBtn">Preview the whole book</button>
      ${local ? `<button class="btn" type="button" id="aTest10">Test: +10 packs</button><button class="btn" type="button" id="aTestEmpty">Test: empty the book</button>` : ""}</div>
    ${local ? `<p class="tiny">The test buttons only show on a copy opened from disk, whose progress stays in this browser.</p>` : ""}</figure>`;
}
function albumParentsWire(pl) {
  const back = () => { save(); aBadge(); renderParents(); };
  $("aGift").onclick = () => { if (confirm(`Give ${pl.name} a sticker pack?`)) { albumOf(pl).b++; back(); } };
  $("aPrevBtn").onclick = () => {
    const R = aRand(7);
    albumPreview = Object.fromEntries(STK.map(st => [st.id, st.boss ? 1 : [1, 1, 1, 2, 2, 3, 4, 5][Math.floor(R() * 8)]]));
    kidTab = "stickers"; openKids();
  };
  if ($("aTest10")) $("aTest10").onclick = () => { albumOf(pl).b += 10; back(); };
  if ($("aTestEmpty")) $("aTestEmpty").onclick = () => {
    if (!confirm("Empty the sticker book in this browser?")) return;
    pl.album = { c: 0, b: 0, o: 0, s: {}, v: A_VER, c0: 0, p3: 0 }; albumTray = []; albumHold = {}; back();
  };
}

/* Sticker book theme page: Heroes 1 (Marvel), nine chibi superheroes in the album's anime style; sets FAN.marvel = [[name, what, draw], ...] */
(() => {
  "use strict";
  /* ---------- small drawing helpers (card coordinates 120 x 158 unless said otherwise) ---------- */
  const OL = A_OL;
  const U = p => `fm${p}${++aUid}`;
  const f1 = v => +(+v).toFixed(1);
  const P = (d, f, w = 1.2, x = "") => `<path d="${d}" fill="${f}" stroke="${OL}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${x}/>`;
  const Pn = (d, f, x = "") => `<path d="${d}" fill="${f}" ${x}/>`;
  const E = (cx, cy, rx, ry, f, w = 1.2, x = "") => `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="${f}" stroke="${OL}" stroke-width="${w}" ${x}/>`;
  const En = (cx, cy, rx, ry, f, x = "") => `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="${f}" ${x}/>`;
  const C = (x, y, r, f, w = 1.2, ex = "") => aC(x, y, r, f, `stroke="${OL}" stroke-width="${w}" ${ex}`);
  const S = (d, c, w, x = "") => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${x}/>`;
  const SO = (d, c, w) => S(d, OL, w + 2.2) + S(d, c, w);          // an outlined stroke
  const back = (a, b) => { const id = U("bg"); return `<defs>${aVGrad(id, a, b)}</defs><rect width="120" height="158" fill="url(#${id})"/>`; };
  const clip = (shape, inner) => { const id = U("c"); return `<defs><clipPath id="${id}">${shape}</clipPath></defs><g clip-path="url(#${id})">${inner}</g>`; };
  const clipD = (d, inner) => clip(`<path d="${d}"/>`, inner);
  const shadow = (x, y, rx, ry = 4.5) => En(x, y, rx, ry, "#000", `opacity=".22"`);
  // a figure-coordinate head (centre 50,24, as aKidHead) placed on the card
  const head = (svg, x = 60, y = 44, s = 1.45, rot = 0) => `<g transform="translate(${f1(x - 50 * s)} ${f1(y - 24 * s)}) scale(${s})${rot ? ` rotate(${rot} 50 24)` : ""}">${svg}</g>`;
  // a limb: outlined polyline, the last segment in another colour (glove, boot), then a hand / foot
  function limb(p, c, w, end, tip) {
    let s = aL(p, c, w);
    if (end) s += aL(p.slice(-2), end, w);
    return s + (tip || "");
  }
  const fist = (x, y, r, c, rot = 0) => E(x, y, r, r * .9, c, 1.2, rot ? `transform="rotate(${rot} ${x} ${y})"` : "") + Pn(`M${f1(x - r * .5)},${f1(y - r * .5)} q${f1(r * .4)},${f1(-r * .3)} ${f1(r * .8)},0`, "none", `stroke="#fff" stroke-width=".8" opacity=".45" stroke-linecap="round"`);
  const boot = (x, y, c, dir = 1, rx = 7, ry = 4.4) => E(x + dir * 1.5, y, rx, ry, c, 1.2) + En(x + dir * 1.5, y + ry * .55, rx * .85, ry * .35, "#000", `opacity=".18"`);
  // a coloured glow around whatever is drawn inside (used behind a character or a fist)
  function glow(svg, col, r = 2, blur = 3) {
    const id = U("gl");
    return `<defs><filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feMorphology in="SourceAlpha" operator="dilate" radius="${r}" result="m"/><feGaussianBlur in="m" stdDeviation="${blur}" result="b"/><feFlood flood-color="${col}"/><feComposite in2="b" operator="in"/></filter></defs><g filter="url(#${id})">${svg}</g>`;
  }
  // a skyline of buildings standing on y = base
  function city(seed, base, cols, win, hMin, hMax, wp = .5, op = 1) {
    const R = aRand(seed); let x = -3, s = "";
    while (x < 122) {
      const w = 11 + Math.floor(R() * 12), h = hMin + R() * (hMax - hMin), c = cols[Math.floor(R() * cols.length)], top = base - h;
      s += `<rect x="${x}" y="${f1(top)}" width="${w}" height="${f1(h + 2)}" fill="${c}"/>`;
      for (let wy = top + 4; wy < base - 3; wy += 6) for (let wx = x + 2.5; wx < x + w - 3; wx += 4.5) if (R() < wp) s += `<rect x="${f1(wx)}" y="${f1(wy)}" width="2.2" height="3" fill="${win}"/>`;
      x += w + 1;
    }
    return `<g opacity="${op}">${s}</g>`;
  }
  const stars = (seed, n, y0, y1, c = "#fff") => { const R = aRand(seed); return [...Array(n)].map(() => aC(R() * 120, y0 + R() * (y1 - y0), .4 + R() * .8, c, `opacity="${f1(.5 + R() * .5)}"`)).join(""); };
  const cloud = (x, y, s, c, op = 1) => `<g opacity="${op}" fill="${c}">${[[0, 0, 9], [10, -4, 10], [21, 0, 8], [9, 4, 9]].map(([a, b, r]) => `<circle cx="${f1(x + a * s)}" cy="${f1(y + b * s)}" r="${f1(r * s)}"/>`).join("")}</g>`;
  const bolt = (pts, w = 2.2) => S(aPtsD(pts), "#fff59d", w + 3, `opacity=".45"`) + S(aPtsD(pts), "#fffde7", w);
  const aPtsD = pts => "M" + pts.map(p => p.map(f1).join(",")).join(" L");

  /* ---------- spider pieces ---------- */
  // a spider web (radial lines + sagging rings) centred at cx, cy
  function web(cx, cy, col, w = .7, n = 12, rs = [5, 10, 15, 20, 26, 33, 41], a0 = .26) {
    const pt = (a, r) => `${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`;
    let d = "";
    for (let i = 0; i < n; i++) d += `M${cx},${cy} L${pt(a0 + i * 2 * Math.PI / n, 60)} `;
    rs.forEach(r => { for (let i = 0; i < n; i++) { const a = a0 + i * 2 * Math.PI / n, b = a + 2 * Math.PI / n; d += `M${pt(a, r)} Q${pt((a + b) / 2, r * .82)} ${pt(b, r)} `; } });
    return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
  }
  function spider(x, y, s, c, lw = .95) {
    const L = [[[1.2, -1.6], [3.6, -4.8], [4.4, -9]], [[1.4, -.6], [5, -2.4], [7.6, -5.4]], [[1.4, .8], [5, 2.4], [7.6, 6]], [[1.2, 1.9], [3.6, 5.4], [4.4, 10]]];
    let d = "";
    [-1, 1].forEach(k => L.forEach(l => { d += "M" + l.map(([a, b]) => `${f1(x + k * a * s)},${f1(y + b * s)}`).join(" L") + " "; }));
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${f1(lw * s)}" stroke-linecap="round" stroke-linejoin="round"/>` + En(x, y + 1.6 * s, 1.6 * s, 3.2 * s, c) + aC(x, y - 2 * s, 1.25 * s, c);
  }
  // the mask: an egg head with web lines and the big white lenses (figure coordinates)
  const SH = "M33,24 Q33,6 50,6 Q67,6 67,24 Q67,38 50,43 Q33,38 33,24Z";
  const SEYE = "M48.3,33 Q40,34.5 37,28 Q34.8,21 39.3,19 Q44.5,17.6 47,23.5 Q48.9,28 48.3,33Z";
  function spideyHead(fill, webc, shadeOp = .16) {
    const eye = fl => `<g${fl ? ` transform="translate(100 0) scale(-1 1)"` : ""}>${P(SEYE, "#fff", 2.4)}${Pn("M44.6,24 Q46,27 46.4,30.6", "none", `stroke="#cfe3f1" stroke-width="1.6" stroke-linecap="round"`)}${Pn("M38.6,22.5 Q40.5,20 43.2,20.6", "none", `stroke="#fff" stroke-width="1" opacity=".9"`)}</g>`;
    return Pn(SH, fill) + clipD(SH, web(50, 29.5, webc) + En(63, 27, 10, 20, "#000", `opacity="${shadeOp}"`) + Pn("M37,14 Q42,8 50,8", "none", `stroke="#fff" stroke-width="2" opacity=".35" stroke-linecap="round"`)) +
      P(SH, "none", 1.3) + eye(0) + eye(1);
  }
  const TORSO = "M46,70 Q60,66 74,70 Q77,86 72,104 L48,104 Q43,86 46,70Z";
  const shadeOn = (d, x0, op = .16) => clipD(d, `<rect x="${x0}" y="0" width="80" height="158" fill="#000" opacity="${op}"/>`);

  /* ---------- 1 Spider-Man: shooting a web line ("thwip") while he swings over the skyscrapers ---------- */
  // the web-shooter hand, drawn fingers up around 0,0 and turned by rot: index, pinky and thumb out, middle and ring
  // fingers folded onto the palm (the trigger)
  function thwip(x, y, rot, c, s = 1) {
    const fing = (x0, y0, x1, y1, w) => SO(`M${x0},${y0} L${x1},${y1}`, c, w);
    return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">` +
      fing(-3, -1.5, -4.6, -11.5, 3.2) + fing(3.3, -1.5, 5.4, -10, 2.8) + fing(-4, 2.4, -10.4, -.6, 3.2) +
      E(0, .6, 5.6, 5.4, c, 1.2) +
      E(-.9, -4.1, 1.9, 1.7, c, 1) + E(2.4, -4, 1.9, 1.7, c, 1) +
      Pn("M-3,-1 Q-.4,.6 2.2,-.4", "none", `stroke="${OL}" stroke-width=".8" stroke-linecap="round"`) + `</g>`;
  }
  function spiderman() {
    const R = "#d6222c", B = "#1e4bb0";
    const bg = back("#49b8f5", "#d6f0ff") + A_RAYS + cloud(8, 40, .9, "#fff", .85) + cloud(60, 12, .7, "#fff", .7) +
      city(7, 158, ["#6f8fb5", "#83a3c6", "#5f7fa6", "#90aecb"], "#d8ecff", 34, 96, .55) + aSpark(14, 120, 4) + aSpark(108, 116, 3);
    const chestRed = "M47,70 Q60,66 73,70 L71,95 Q60,100 49,95Z";
    // the web line he is shooting: from the hand up to the corner, a little splat where it sticks
    const line = S("M94,33 L128,-14", "#fff", 2.4) + S("M94,33 L128,-14", "#90a4ae", .8, `opacity=".7"`);
    const body =
      // legs (blue, red boots) tucked up for the swing
      limb([[67, 101], [80, 108], [78, 125]], B, 9.5, R, boot(79, 128, R, 1)) +
      limb([[53, 101], [43, 114], [47, 132]], B, 9.5, R, boot(46, 135, R, -1)) +
      // torso: blue sides, red chest with web lines, black spider, red belt
      P(TORSO, B, 1.3) + clipD(chestRed, Pn(chestRed, R) + web(60, 84, "#3a0d10", .55, 12, [5, 10, 15, 20, 26])) +
      P(chestRed, "none", 1) + P("M48.5,97 Q60,101 71.5,97 L71.8,102 Q60,106 48.2,102Z", R, 1) + spider(60, 82, 1.2, "#141414") + shadeOn(TORSO, 66) +
      // the left arm out for balance (open hand), the right one up shooting the web
      limb([[48, 75], [36, 86], [25, 92]], R, 8.5, null,
        SO("M21,93 L14.5,96", R, 2.8) + SO("M20.5,90.5 L14,90", R, 2.8) + SO("M21,88.6 L16,85", R, 2.8) + SO("M23,96 L19.5,101", R, 2.8) + E(23, 92, 5.2, 5, R)) +
      limb([[72, 75], [83, 62], [88, 48]], R, 8.5) + line + thwip(90, 41, 30, R, 1.35) +
      head(spideyHead(R, "#3a0d10"), 57, 46, 1.55, -8);
    return [bg, aEdge(`<g transform="translate(66 96) scale(1.1) translate(-60 -92)">${body}</g>`)];
  }

  /* ---------- 2 Miles Morales: crouched on a rooftop before a huge moon, night city ---------- */
  function miles() {
    const K = "#17171d", R = "#e3262d";
    const bg = back("#2a1a6e", "#a2489e") + stars(21, 26, 0, 80) +
      // a huge glowing moon right behind him, so the black suit stands out
      C(60, 78, 56, "#ff8fd0", 0, `opacity=".22"`) + C(60, 78, 46, "#ffc4e6", 0, `opacity=".35"`) + C(60, 78, 38, "#fff0d6", 0) + C(74, 66, 6, "#f3dcc0", 0) + C(46, 96, 4.5, "#f3dcc0", 0) + C(70, 104, 3, "#f3dcc0", 0) +
      city(3, 140, ["#3b2a78", "#4a3590", "#33246a"], "#ffd54f", 18, 46, .45) +
      // Spider-Verse glitch squares
      [[8, 60, "#ff2e88"], [104, 52, "#26e0ff"], [14, 72, "#26e0ff"], [99, 88, "#ff2e88"], [30, 42, "#ffeb3b"]].map(([x, y, c]) => `<rect x="${x}" y="${y}" width="5" height="5" fill="${c}" opacity=".75"/><rect x="${x + 6}" y="${y + 3}" width="2.5" height="2.5" fill="${c}" opacity=".6"/>`).join("") +
      `<rect x="0" y="138" width="120" height="20" fill="#120d2a"/><rect x="0" y="138" width="120" height="2.5" fill="#3a2d6e"/>`;
    const shoe = (x, y, dir) => E(x, y, 8, 4.6, K, 1.2) + Pn(`M${x - 7.5},${y + 1.5} Q${x},${y + 6} ${x + 7.5},${y + 1.5} L${x + 7.8},${y + 3} Q${x},${y + 7.4} ${x - 7.8},${y + 3}Z`, R) + S(`M${x - 2 * dir},${y - 3.6} l${4 * dir},1.6`, "#fff", 1);
    const tor = "M47,78 Q60,74 73,78 Q76,92 71,108 L49,108 Q44,92 47,78Z";
    const body =
      // crouch: knees out wide, feet planted
      limb([[54, 106], [34, 112], [30, 132]], K, 9.5, null, shoe(28, 135, -1)) +
      limb([[66, 106], [86, 110], [92, 132]], K, 9.5, null, shoe(94, 135, 1)) +
      // web lines on the legs
      S("M38,111 L33,128 M86,112 L90,128", R, .6, `opacity=".9"`) +
      P(tor, K, 1.3) + clipD(tor, web(60, 90, R, .6, 12, [5, 10, 15, 20, 26])) + spider(60, 91, 1.5, R, 1.1) + shadeOn(tor, 66, .2) +
      // one hand down on the roof, one up behind with a web shooter
      limb([[48, 82], [46, 104], [50, 130]], K, 8, null, E(50, 132, 6, 4, K) + S("M46,133 Q50,135 54,133", R, 1)) +
      limb([[72, 82], [88, 74], [100, 60]], K, 8, null, fist(102, 57, 5.2, K) + S("M99,62 l3,-3", R, 1)) +
      head(spideyHead(K, R, .28), 60, 50, 1.4, 6);
    // bigger, with a cyan rim light around the black suit
    const fig = `<g transform="translate(60 139) scale(1.13) translate(-60 -139)">${body}</g>`;
    return [bg + aSpark(18, 44, 3, "#fff") + aSpark(112, 104, 2.5, "#26e0ff") + glow(fig, "#5ff3ff", 1.6, 1.6), aEdge(fig)];
  }

  /* ---------- 3 Iron Man: flying, a repulsor blast from the palm ---------- */
  const IH = "M33,25 Q33,6 50,6 Q67,6 67,25 L66.5,34 Q60,42.5 50,44 Q40,42.5 33.5,34Z";
  const IPLATE = "M37,21.5 Q50,16.5 63,21.5 L62.6,32.5 L57,39.6 Q50,41.6 43,39.6 L37.4,32.5Z";
  function ironHead() {
    const slit = fl => `<g${fl ? ` transform="translate(100 0) scale(-1 1)"` : ""}>${Pn("M38.8,25.4 L47.2,27.4 L46.6,30.1 L39.8,28.9Z", "#7ff6ff", `stroke="#7ff6ff" stroke-width="2.4" opacity=".45" stroke-linejoin="round"`)}${P("M38.8,25.4 L47.2,27.4 L46.6,30.1 L39.8,28.9Z", "#f2ffff", .7)}</g>`;
    return Pn(IH, "#c8102e") + clipD(IH, En(64, 26, 9, 22, "#000", `opacity=".18"`) + Pn("M36,14 Q42,8 50,8", "none", `stroke="#fff" stroke-width="2" opacity=".4" stroke-linecap="round"`)) + P(IH, "none", 1.3) +
      P(IPLATE, "#f4c22b", 1) + clipD(IPLATE, En(62, 30, 6, 14, "#b8860b", `opacity=".35"`)) +
      S("M50,17.5 V22", "#c58f00", .7) + S("M44.5,36.4 H55.5", "#7a5a00", 1) + S("M41,38.4 L37.6,33 M59,38.4 L62.4,33", "#c58f00", .6) + slit(0) + slit(1) +
      C(33.6, 27, 3, "#f4c22b", 1) + C(66.4, 27, 3, "#f4c22b", 1);
  }
  function blast(x, y, r) {
    return C(x, y, r * 1.9, "#7ff6ff", 0, `opacity=".25"`) + C(x, y, r * 1.3, "#b8fbff", 0, `opacity=".55"`) + C(x, y, r * .8, "#fff", 0) +
      [...Array(8)].map((_, i) => { const a = i * Math.PI / 4 + .2; return S(`M${f1(x + r * 1.1 * Math.cos(a))},${f1(y + r * 1.1 * Math.sin(a))} L${f1(x + r * 2.2 * Math.cos(a))},${f1(y + r * 2.2 * Math.sin(a))}`, "#e0ffff", 1.1, `opacity=".9"`); }).join("");
  }
  function ironman() {
    const Rd = "#c8102e", G = "#f4c22b";
    const bg = back("#ff8a3d", "#ffe0a3") + A_RAYS + cloud(4, 120, 1.3, "#fff", .8) + cloud(76, 132, 1.1, "#fff", .7) + cloud(70, 24, .7, "#ffd6b0", .8) +
      [[6, 40, 30], [10, 56, 22], [4, 72, 26]].map(([x, y, l]) => S(`M${x},${y} h${l}`, "#fff", 1.6, `opacity=".75"`)).join("");
    const jet = (x, y) => Pn(`M${x - 4.5},${y} Q${x},${y + 22} ${x + 4.5},${y}Z`, "#7ff6ff", `opacity=".55"`) + Pn(`M${x - 2.6},${y} Q${x},${y + 13} ${x + 2.6},${y}Z`, "#fff");
    const tor = TORSO;
    const body =
      jet(41, 140) + jet(56, 139) +
      limb([[54, 101], [48, 118], [42, 134]], G, 9, Rd, boot(42, 137, Rd, -1, 6, 4)) +
      limb([[66, 101], [62, 118], [57, 133]], G, 9, Rd, boot(57, 136, Rd, 0, 6, 4)) +
      P(tor, Rd, 1.3) + P("M48.5,90 L60,99 L71.5,90 L72,104 L48,104Z", G, 1) + S("M54,74 L60,86 L66,74", "#8e0b20", .9) + shadeOn(tor, 66) +
      // arc reactor
      C(60, 81, 9, "#7ff6ff", 0, `opacity=".35"`) + C(60, 81, 5.6, "#90a4ae", 1.1) + C(60, 81, 3.8, "#e8ffff", .6) + C(60, 81, 1.6, "#fff", 0) +
      // shoulders
      E(47, 74, 5.5, 4.5, G, 1.1) + E(73, 74, 5.5, 4.5, G, 1.1) +
      limb([[48, 76], [39, 88], [31, 97]], Rd, 8, G, fist(30, 99, 5, Rd)) +
      limb([[72, 76], [84, 68], [95, 61]], Rd, 8, G, fist(97, 60, 5.2, Rd)) +
      head(ironHead(), 60, 44, 1.45, 4);
    return [bg, `<g transform="translate(57 90) scale(1.15) rotate(14) translate(-60 -90)">` + aEdge(body) + blast(97, 60, 6) + blast(30, 100, 3.6) + `</g>`];
  }

  /* ---------- 4 Hulk: fists up, the ground cracking under his feet ---------- */
  function hulk() {
    const G = "#5fb532", Gd = "#3f8a1f", Pu = "#6b3fa6";
    const bg = back("#ffb347", "#ffe8b0") + A_RAYS + city(15, 136, ["#d9905a", "#c97f4d", "#e2a06c"], "#ffe0a0", 20, 54, .3, .7) +
      Pn("M0,132 L120,132 L120,158 L0,158Z", "#9b7653") + Pn("M0,132 L120,132 L120,136 L0,136Z", "#7d5a3c") +
      S("M60,140 L46,148 L40,158 M60,140 L74,150 L78,158 M60,140 L60,158 M46,148 L30,150 M74,150 L94,147 L108,152 M30,150 L12,147", "#3e2a1a", 1.5) +
      [[14, 118, 4, 20], [104, 114, 3.4, -30], [24, 104, 2.6, 40], [96, 98, 2.4, 10], [8, 136, 3, 0], [113, 134, 3.6, 0]].map(([x, y, r, a]) => P(`M${x - r},${y} L${x - r * .4},${y - r} L${x + r},${y - r * .6} L${x + r * .8},${y + r * .7} L${x - r * .2},${y + r}Z`, "#a9845f", 1, `transform="rotate(${a} ${x} ${y})"`)).join("");
    const face = `<path d="${A_FACE}" fill="${G}" stroke="${OL}" stroke-width="1.1"/>`;
    const hhead =
      C(33.4, 27, 3.4, G, 1.1) + C(66.6, 27, 3.4, G, 1.1) + face + clipD(A_FACE, En(62, 28, 8, 18, "#000", `opacity=".14"`)) +
      // messy black hair
      P("M33,27 L31.5,15 L35,9 L33,4 L41,6 L45,1 L50,5 L56,0.5 L59,5.5 L66,3 L65.5,9 L69.5,13 L67,27 L64,19 L60.5,22 L58,15 L54,20 L50,13.5 L46.5,20 L42,15 L39.5,22 L36.5,18Z", "#141414", 1.1) +
      aEye(43.3, 28.8, "#3a8f1e", .95) + aEye(56.7, 28.8, "#3a8f1e", .95) +
      // angry brows
      P("M37,22.5 L48.5,24.8 L48,27 L37.5,25.2Z", "#1d3a10", .6) + P("M63,22.5 L51.5,24.8 L52,27 L62.5,25.2Z", "#1d3a10", .6) +
      // roaring mouth with teeth
      P("M43.5,35 Q50,33.4 56.5,35 Q56,41.2 50,41.2 Q44,41.2 43.5,35Z", "#7a1d1d", 1) + Pn("M44.4,35.3 Q50,34 55.6,35.3 L55.3,36.9 Q50,36 44.7,36.9Z", "#fff") + En(50, 39.6, 3, 1.2, "#e57373");
    const tor = "M30,66 Q60,57 90,66 Q95,86 84,106 L36,106 Q25,86 30,66Z";
    const kn = (x, y) => S(`M${x - 4},${y - 3} q2,2 0,4 M${x},${y - 4} q2,2 0,4.5 M${x + 4},${y - 3} q2,2 0,4`, Gd, .8);
    const body =
      // legs, feet
      limb([[47, 116], [43, 132]], G, 15, null, E(39, 138, 10, 5.4, G, 1.2) + S("M33,138 v2 M37,139 v2 M41,139 v2", Gd, .7)) +
      limb([[73, 116], [77, 132]], G, 15, null, E(81, 138, 10, 5.4, G, 1.2) + S("M79,139 v2 M83,139 v2 M87,138 v2", Gd, .7)) +
      // torso with muscles
      P(tor, G, 1.4) + S("M44,77 Q52,85 60,78 Q68,85 76,77", Gd, 1.1) + S("M60,80 V102 M53,90 H67 M54,97 H66", Gd, .9) + shadeOn(tor, 68, .14) +
      // torn purple shorts
      P("M35,101 L85,101 L89,124 L82,120 L78,126 L72,119 L66,123 L62,113 L58,113 L54,123 L48,119 L42,126 L38,120 L31,124Z", Pu, 1.2) + S("M60,102 V112", "#47257a", .9) + S("M40,104 L80,104", "#8e63c8", .9, `opacity=".7"`) +
      // huge arms flexed, fists up beside the head (clear of the number corner)
      limb([[34, 71], [13, 72], [19, 56]], G, 15, null, C(20, 50, 10.5, G, 1.3) + kn(20, 46)) +
      limb([[86, 71], [107, 72], [101, 56]], G, 15, null, C(100, 50, 10.5, G, 1.3) + kn(100, 46)) +
      S("M18,68 q6,-6 13,-3 M102,68 q-6,-6 -13,-3", Gd, .9) +
      head(hhead, 60, 38, 1.38);
    return [bg + aSpark(98, 18, 3.4) + aSpark(8, 92, 2.6), aEdge(body)];
  }

  /* ---------- 5 Captain America: the round shield up ---------- */
  function shield(x, y, r) {
    const st = aStar(x, y, r * .3, "#fff").replace("/>", ` stroke="${OL}" stroke-width=".8" stroke-linejoin="round"/>`);
    return `<g transform="rotate(-10 ${x} ${y})">` + E(x, y, r, r, "#d62b2b", 1.5) + E(x, y, r * .78, r * .78, "#f5f5f5", .9) + E(x, y, r * .57, r * .57, "#d62b2b", .9) + E(x, y, r * .37, r * .37, "#1f3f99", .9) + st +
      Pn(`M${x - r * .7},${y - r * .5} A${r * .86},${r * .86} 0 0 1 ${x + r * .1},${y - r * .85}`, "none", `stroke="#fff" stroke-width="1.6" opacity=".55" stroke-linecap="round"`) + `</g>`;
  }
  function capHead() {
    const BL = "#2347a8";
    const cowl = "M32,24 Q32,4.5 50,4.5 Q68,4.5 68,24 Q68,33 65.5,39 Q63,33.5 58,34.3 L50,36.4 L42,34.3 Q37,33.5 34.5,39 Q32,33 32,24Z";
    const wing = fl => `<g${fl ? ` transform="translate(100 0) scale(-1 1)"` : ""}>${P("M34,27 Q27,24 24,9 Q27,12.5 29,13.5 Q27,9 28,5 Q30.5,10 32.5,12 Q32,8.5 33.5,6.5 Q35,13 35,19Z", "#fff", .9) + S("M30,17 Q31.5,20 33.5,22 M31.5,13.5 Q33,17 34.2,18.5", "#b0bec5", .6)}</g>`;
    return aKidHead({ skin: A_SKIN[1], hair: "#6b3e1f", hs: "buzz", eyes: "#3a7bd5", mouth: "smile" }) +
      P(cowl, BL, 1.1) + clipD(cowl, En(63, 22, 7, 18, "#000", `opacity=".18"`)) +
      E(43.3, 28.4, 5.4, 5.7, A_SKIN[1], .9) + E(56.7, 28.4, 5.4, 5.7, A_SKIN[1], .9) + aEye(43.3, 28.8, "#3a7bd5", .85) + aEye(56.7, 28.8, "#3a7bd5", .85) +
      S("M46.6,15.5 L50,8.5 L53.4,15.5 M47.8,13 H52.2", OL, 3.6) + S("M46.6,15.5 L50,8.5 L53.4,15.5 M47.8,13 H52.2", "#fff", 1.7) + wing(0) + wing(1) +
      Pn("M45.5,38.6 Q50,40.2 54.5,38.6", "none", `stroke="${OL}" stroke-width=".9" stroke-linecap="round"`);
  }
  function captain() {
    const BL = "#2347a8", Rd = "#d62b2b";
    const bg = back("#1d3b8f", "#7fb4ff") + A_RAYS + [[12, 20, 4], [104, 16, 3.4], [100, 96, 3], [18, 64, 2.6], [108, 54, 2.6], [10, 112, 3]].map(([x, y, r]) => aStar(x, y, r, "#fff")).join("") +
      [0, 1, 2, 3, 4, 5].map(i => `<rect x="0" y="${134 + i * 4}" width="120" height="4" fill="${i % 2 ? "#fff" : "#d62b2b"}" opacity=".85"/>`).join("");
    const tor = TORSO;
    const body =
      limb([[67, 101], [75, 118], [80, 132]], BL, 9, Rd, boot(81, 136, Rd, 1)) +
      limb([[53, 101], [48, 119], [44, 133]], BL, 9, Rd, boot(43, 137, Rd, -1)) +
      P(tor, BL, 1.3) + clipD(tor, [52, 56, 60, 64, 68].map((x, i) => `<rect x="${x}" y="88" width="4" height="14" fill="${i % 2 ? "#fff" : Rd}"/>`).join("")) +
      S("M47.5,88 H72.5", OL, 1) + aStar(60, 79, 7.2, "#fff").replace("/>", ` stroke="${OL}" stroke-width=".9" stroke-linejoin="round"/>`) +
      P("M48,100 Q60,103 72,100 L72.3,104.5 Q60,107 47.7,104.5Z", "#8d5a2b", 1) + shadeOn(tor, 66) +
      limb([[72, 75], [85, 66], [91, 51]], BL, 8, Rd, fist(92, 48, 5.6, Rd)) +
      limb([[48, 75], [37, 86], [33, 97]], BL, 8, Rd, fist(33, 99, 5, Rd)) +
      shield(31, 100, 22) +
      head(capHead(), 61, 44, 1.45, -3);
    return [bg + aSpark(108, 40, 3.4) + aSpark(28, 146, 3, "#ffeb3b"), aEdge(`<g transform="translate(9 7)">${body}</g>`)];
  }

  /* ---------- 6 Black Panther: claws out, purple kinetic glow, Wakanda at night ---------- */
  function pantherHead() {
    const K = "#1d1d26", Si = "#c7ccd6";
    const eye = fl => `<g${fl ? ` transform="translate(100 0) scale(-1 1)"` : ""}>${P("M36.6,23 L47.8,26.4 Q44.6,30.6 39,28.6Z", "#f4f7ff", 1)}${S("M35.5,21.4 L48.4,25", Si, .7)}</g>`;
    const ear = fl => `<g${fl ? ` transform="translate(100 0) scale(-1 1)"` : ""}>${P("M34,15.5 L36,2.5 L45,8.6Z", K, 1.1)}${Pn("M36.5,12 L37.4,5.6 L42,9Z", Si, `opacity=".55"`)}</g>`;
    return ear(0) + ear(1) + Pn(SH, K) + clipD(SH, En(62, 26, 9, 22, "#000", `opacity=".25"`) + Pn("M37,14 Q42,8 50,8", "none", `stroke="#fff" stroke-width="2" opacity=".25" stroke-linecap="round"`)) + P(SH, "none", 1.3) +
      S("M50,7.5 V19 M50,19 L46,22.5 M50,19 L54,22.5 M37,31 Q43,38 50,39 Q57,38 63,31 M50,31 V36", Si, .75) + S("M42,12 L45.5,17 M58,12 L54.5,17", Si, .7) +
      eye(0) + eye(1);
  }
  function panther() {
    const K = "#1d1d26", Si = "#c7ccd6", Pu = "#b44dff";
    const bg = back("#1b0b38", "#6a2fa3") + stars(9, 22, 0, 70, "#e6d0ff") + C(26, 28, 11, "#f3e5ff", 0, `opacity=".9"`) +
      Pn("M0,118 L14,96 L26,110 L40,86 L56,108 L70,92 L84,110 L100,90 L120,108 L120,158 L0,158Z", "#3a1766") +
      [[8, 92, 7, 46], [30, 104, 6, 36], [88, 98, 8, 42], [106, 108, 6, 30]].map(([x, y, w, h]) => Pn(`M${x},${y + h} V${y + 8} Q${x + w / 2},${y - 6} ${x + w},${y + 8} V${y + h}Z`, "#2a0f4d") + `<rect x="${x + w / 2 - .8}" y="${y + 6}" width="1.6" height="${h - 12}" fill="#c77dff" opacity=".7"/>`).join("") +
      `<rect x="0" y="140" width="120" height="18" fill="#1a0a33"/>`;
    // three bold white claws per hand, curving out and down
    const claws = (x, y, dir) => [-5, 0, 5].map(d => P(`M${x + dir * 2.5},${y + d - 2.3} Q${x + dir * 11},${y + d * 1.25 - 3} ${x + dir * 15.5},${y + d * 1.5 + 2.6} Q${x + dir * 9.5},${y + d * 1.2 + 1.2} ${x + dir * 2.5},${y + d + 2.3}Z`, "#fff", 1.1)).join("");
    const tor = TORSO;
    // the silver fang necklace: a bold band and seven big fangs
    const nk = t => [47 + 26 * t, 70.5 + 7 * Math.sin(Math.PI * t)];
    const necklace = SO("M" + [...Array(9)].map((_, i) => nk(i / 8).map(f1).join(",")).join(" L"), Si, 1.6) +
      [...Array(7)].map((_, i) => { const [x, y] = nk((i + .5) / 7); return P(`M${f1(x - 2.2)},${f1(y)} L${f1(x)},${f1(y + 6)} L${f1(x + 2.2)},${f1(y)}Z`, "#e9edf3", .8); }).join("");
    const body =
      limb([[53, 101], [42, 118], [37, 134]], K, 9, null, boot(35, 137, K, -1)) +
      limb([[67, 101], [78, 118], [83, 134]], K, 9, null, boot(85, 137, K, 1)) +
      S("M44,112 l-3,6 M76,112 l3,6", Pu, 1, `opacity=".9"`) +
      P(tor, K, 1.3) + clipD(tor, S("M47,84 L60,96 L73,84 M50,92 L60,102 L70,92 M60,74 V96", Si, .55, `opacity=".55"`) + S("M45,80 L60,92 L75,80", Pu, 1.1, `opacity=".9"`)) + necklace + shadeOn(tor, 66, .2) +
      S("M48,100 H72", Si, 1.4) +
      limb([[48, 75], [35, 82], [22, 75]], K, 8, null, claws(20, 74, -1) + E(20, 74, 5, 4.6, K)) +
      limb([[72, 75], [85, 82], [98, 75]], K, 8, null, claws(100, 74, 1) + E(100, 74, 5, 4.6, K)) +
      S("M30,80 l6,-1 M90,80 l-6,-1", Pu, 1) +
      head(pantherHead(), 60, 44, 1.45);
    return [bg + aSpark(12, 56, 3, "#e1b3ff") + aSpark(108, 50, 3.4, "#e1b3ff") + aSpark(60, 150, 2.6, "#e1b3ff") + glow(body, Pu, 2.5, 3.2), aEdge(body)];
  }

  /* ---------- 7 Thor: Mjolnir raised, lightning, stormy sky ---------- */
  function thor() {
    const Ar = "#3a4250", Si = "#cfd8dc", Rc = "#c62828";
    const bg = back("#1c2436", "#55678c") + cloud(-8, 22, 1.2, "#2a3348") + cloud(60, 14, 1.3, "#313b52") + cloud(30, 40, .9, "#3b4661", .9) +
      bolt([[16, 48], [24, 64], [18, 68], [28, 90]], 1.6) + bolt([[108, 70], [100, 86], [106, 90], [96, 112]], 1.4) +
      Pn("M0,140 L120,140 L120,158 L0,158Z", "#2b3245");
    const hammer = (x, y) => SO(`M${x},${y + 30} V${y + 6}`, "#8d5a2b", 2.6) + S(`M${x - 1.6},${y + 26} l3.2,-2 M${x - 1.6},${y + 21} l3.2,-2 M${x - 1.6},${y + 16} l3.2,-2`, "#5d3a1a", .7) +
      SO(`M${x},${y + 30} q-3,4 -1,7`, "#8d5a2b", .9) +
      P(`M${x - 12},${y - 6} L${x + 12},${y - 6} L${x + 12},${y + 7} L${x - 12},${y + 7}Z`, "#9aa5ad", 1.3) + Pn(`M${x - 12},${y - 6} L${x + 12},${y - 6} L${x + 12},${y - 2} L${x - 12},${y - 2}Z`, "#fff", `opacity=".35"`) +
      Pn(`M${x + 4},${y - 6} L${x + 12},${y - 6} L${x + 12},${y + 7} L${x + 4},${y + 7}Z`, "#000", `opacity=".15"`) + S(`M${x - 12},${y + .5} H${x + 12}`, "#6d777e", .7) + P(`M${x - 12},${y - 6} L${x + 12},${y - 6} L${x + 12},${y + 7} L${x - 12},${y + 7}Z`, "none", 1.3);
    const hair = "M31,20 Q28,40 30,56 Q36,60 40,52 L42,42 L58,42 L60,52 Q64,60 70,56 Q72,40 69,20Z";
    const thead = P(hair, "#f0c64a", 1.1) + S("M33,40 q-1,8 1,14 M67,40 q1,8 -1,14", "#c99a26", .8) +
      aKidHead({ skin: A_SKIN[0], hair: "#f0c64a", hs: "neat", eyes: "#2f7fd8", mouth: "smile" }) +
      // a short neat beard along the jaw line (MCU), well below a big happy grin
      P("M35.2,30 Q36.5,41.5 50,43.8 Q63.5,41.5 64.8,30 Q63,37.6 57,40 Q50,41.8 43,40 Q37,37.6 35.2,30Z", "#d9aa38", .8) +
      P("M44.6,35 Q50,35.8 55.4,35 Q54.6,39.6 50,39.8 Q45.4,39.6 44.6,35Z", "#b5332a", .9) + Pn("M45.3,35.5 Q50,36.2 54.7,35.5 L54.4,36.7 Q50,37.3 45.6,36.7Z", "#fff") + En(50, 38.8, 2.4, .9, "#ff8a80");
    const tor = TORSO;
    const cape = P("M47,72 Q30,96 10,140 Q26,134 36,142 Q46,134 56,140 L60,98Z", Rc, 1.3) + S("M28,112 Q30,124 34,138 M46,108 Q46,124 48,138", "#8e1b1b", 1) +
      P("M73,72 Q86,96 98,136 Q88,132 80,138 L70,98Z", Rc, 1.3);
    const body =
      cape +
      limb([[53, 101], [49, 119], [46, 133]], "#2b2f38", 9, "#141414", boot(45, 137, "#141414", -1)) +
      limb([[67, 101], [73, 118], [76, 133]], "#2b2f38", 9, "#141414", boot(78, 137, "#141414", 1)) +
      P(tor, Ar, 1.3) + [78, 87, 96].map(y => [54.5, 65.5].map(x => C(x, y, 3.4, Si, 1) + C(x, y, 1.6, "#9aa5ad", .6)).join("")).join("") + shadeOn(tor, 66) +
      E(47, 74, 5.5, 4.6, Si, 1.1) + E(73, 74, 5.5, 4.6, Si, 1.1) +
      limb([[48, 76], [38, 88], [42, 99]], A_SKIN[0], 7.5, Si, fist(43, 101, 5, A_SKIN[0])) +
      head(thead, 58, 46, 1.42, -4) +
      limb([[72, 76], [86, 66], [91, 50]], A_SKIN[0], 7.5, Si) + hammer(92, 22) + fist(92, 50, 5.4, A_SKIN[0]);
    // the lightning Mjolnir calls down sits behind the hammer head
    return [bg + bolt([[92, 14], [86, 6], [94, 3], [88, -4]], 1.8) + bolt([[100, 18], [110, 10], [106, 6], [118, 0]], 1.5) + bolt([[82, 18], [74, 10], [78, 6], [70, 0]], 1.3) +
      aSpark(108, 30, 3, "#fffde7") + aSpark(76, 30, 2.4, "#fffde7"), aEdge(body)];
  }

  /* ---------- 8 Captain Marvel: flying up with glowing fists, space ---------- */
  function marvel() {
    const BL = "#1f3c94", Rd = "#d32f2f", Go = "#ffcc33";
    const bg = back("#0e0b2e", "#4b2380") + stars(5, 40, 0, 158) + C(98, 128, 18, "#5c6bc0", 0) + clipD("M80,128 A18,18 0 0 0 116,128 A18,18 0 0 0 80,128Z", En(104, 122, 14, 16, "#8c9eff", `opacity=".5"`)) +
      E(98, 128, 28, 5, "none", 0, `stroke="#ffcc80" stroke-width="1.5" opacity=".8" transform="rotate(-18 98 128)"`) +
      C(60, 70, 46, Go, 0, `opacity=".12"`) + C(60, 70, 30, Go, 0, `opacity=".12"`);
    const hairB = "M31,20 Q29,38 32,46 Q40,48 44,42 L56,42 Q60,48 68,46 Q71,38 69,20Z";
    const mhead = P(hairB, "#f2cf5b", 1.1) + aKidHead({ skin: A_SKIN[0], hair: "#f2cf5b", hs: "neat", eyes: "#3a7bd5", mouth: "smile", lash: 1 });
    const glowFist = (x, y) => C(x, y, 11, "#ffd54f", 0, `opacity=".35"`) + C(x, y, 7.5, "#ffe082", 0, `opacity=".6"`) + fist(x, y, 5.2, Rd) + aSpark(x, y, 9, "#fff8e1");
    const tor = TORSO;
    const top = "M46,70 Q60,66 74,70 L75,84 Q60,90 45,84Z";
    const body =
      limb([[54, 101], [50, 119], [46, 135]], BL, 9, Rd, boot(46, 138, Rd, -1, 6.4)) +
      limb([[66, 101], [70, 115], [62, 128]], BL, 9, Rd, boot(61, 131, Rd, -1, 6.4)) +
      S("M51,104 L47,121 M65,104 L68,114", Rd, 2.2) +
      P(tor, BL, 1.3) + clipD(tor, Pn(top, Rd)) + S("M45.3,84 Q60,90 74.7,84", Go, 1.6) + S("M54,90 L60,104 L66,90", Go, 1.2) +
      aStar(60, 79, 7.5, Go).replace("/>", ` stroke="${OL}" stroke-width=".9" stroke-linejoin="round"/>`) +
      P("M48,99 Q60,102 72,99 L72.3,104 Q60,107 47.7,104Z", Go, 1) + shadeOn(tor, 66) +
      limb([[48, 75], [38, 88], [30, 98]], BL, 8, Rd, glowFist(28, 100)) +
      limb([[72, 75], [86, 62], [96, 44]], BL, 8, Rd, glowFist(98, 40)) +
      head(mhead, 59, 45, 1.42, -6);
    return [bg + S("M44,152 L48,142 M58,156 L60,146 M34,148 L40,138", "#ffe082", 1.6, `opacity=".8"`) + aSpark(16, 50, 3.4, "#fff") + aSpark(112, 70, 2.6, "#ffe082") +
      `<g transform="translate(7 5) rotate(-8 60 90)">` + glow(body, Go, 2.5, 3.5) + `</g>`, `<g transform="translate(7 5) rotate(-8 60 90)">` + aEdge(body) + `</g>`];
  }

  /* ---------- 9 Ant-Man: tiny, riding a giant friendly ant through giant grass ---------- */
  function antHelmet() {
    const Si = "#c9d1d8", Rd = "#e8352a";
    const AH = "M32,24 Q32,5 50,5 Q68,5 68,24 Q68,38 50,43 Q32,38 32,24Z";
    const lens = x => E(x, 24.5, 6.4, 7.4, Rd, 1.2) + En(x - 1.8, 21.5, 2, 2.8, "#fff", `opacity=".8"`) + En(x + 1.6, 28, 1.6, 1.8, "#ffab91", `opacity=".8"`);
    return SO("M38,9 L31,-3", Si, 1.4) + C(30.5, -4, 2, Si, 1) + SO("M62,9 L69,-3", Si, 1.4) + C(69.5, -4, 2, Si, 1) +
      Pn(AH, Si) + clipD(AH, En(63, 25, 9, 22, "#000", `opacity=".16"`) + Pn("M37,14 Q42,8 50,8", "none", `stroke="#fff" stroke-width="2" opacity=".6" stroke-linecap="round"`) + Pn("M46,4 L54,4 L53,17 L47,17Z", "#2a2f36")) + P(AH, "none", 1.3) +
      P("M38,15 Q50,11 62,15 L62,19 Q50,16 38,19Z", "#2a2f36", .9) +
      lens(42.6) + lens(57.4) +
      P("M42,33.5 Q50,30.5 58,33.5 Q57.5,41 50,42 Q42.5,41 42,33.5Z", "#7d8891", 1) + S("M46,34 V40 M50,33 V41 M54,34 V40", "#4c565e", .8);
  }
  function antman() {
    const Rd = "#d62828", K = "#1c1c22", Si = "#c9d1d8", A = "#6b4430", Ad = "#3e2619", Al = "#8d5c40";
    const blade = (x, h, lean, c, w = 7) => P(`M${x - w},158 Q${x - w * .3 + lean * .5},${158 - h * .6} ${x + lean},${158 - h} Q${x + w * .4 + lean * .5},${158 - h * .55} ${x + w},158Z`, c, 1);
    // a dew drop as big as his head hanging from a blade of grass: everything around him is giant
    const drop = (x, y, r) => P(`M${x},${y - r * 1.7} Q${x + r * .35},${y - r * .9} ${x + r},${y} A${r},${r} 0 0 1 ${x - r},${y} Q${x - r * .35},${y - r * .9} ${x},${y - r * 1.7}Z`, "#bfeaff", 1, `opacity=".95"`) +
      En(x - r * .38, y - r * .15, r * .22, r * .38, "#fff") + En(x + r * .3, y + r * .45, r * .3, r * .14, "#fff", `opacity=".7"`);
    const bg = back("#7fd4ff", "#e7f8ff") + A_RAYS + C(28, 50, 8, "#fff59d", 0) +
      blade(6, 150, 10, "#58b04a", 8) + blade(30, 128, -14, "#6cc35a") + blade(106, 156, -22, "#4fa543", 9) + blade(118, 112, -10, "#6cc35a") +
      blade(64, 92, 14, "#79c967", 6) + drop(85, 24, 7.5) + blade(-4, 74, 10, "#4c9c3e", 9) + blade(124, 64, -8, "#4c9c3e", 9) +
      `<rect x="0" y="146" width="120" height="12" fill="#6d4c2f"/>` + [8, 30, 52, 74, 96, 114].map((x, i) => En(x, 149 + (i % 2) * 4, 3, 1.4, "#5a3d25")).join("") +
      aSpark(12, 58, 3) + aSpark(110, 44, 2.6);
    // the giant ant (facing right, smiling): six legs, abdomen, waist, thorax, a big round head
    const legs = [[56, 116, 40, 128, 34, 148], [62, 118, 58, 132, 54, 149], [68, 117, 80, 130, 84, 149], [52, 114, 30, 122, 18, 146], [64, 119, 70, 134, 68, 150], [72, 114, 92, 126, 100, 146]];
    const AB = "M2,110 A22,17 0 0 0 46,110 A22,17 0 0 0 2,110Z", HD = "M74,97 A20,18 0 0 0 114,97 A20,18 0 0 0 74,97Z";
    const ant =
      legs.map(([a, b, c, d, e, f]) => aL([[a, b], [c, d], [e, f]], Ad, 3)).join("") +
      Pn(AB, A) + clipD(AB, En(26, 120, 22, 8, "#000", `opacity=".2"`) + S("M10,101 Q20,95 32,96", "#fff", 2.2, `opacity=".3"`) + S("M16,95 Q13,110 17,125 M28,93 Q26,110 28,127", Ad, 1.1)) + P(AB, "none", 1.4) +
      E(49, 113, 5.5, 4.6, A, 1.2) + E(62, 110, 13, 10, A, 1.4) + En(60, 106, 7, 3, Al, `opacity=".7"`) +
      SO("M86,82 Q82,64 74,54", Ad, 1.6) + C(73, 52.5, 3, Ad, 1) + SO("M100,81 Q106,62 114,56", Ad, 1.6) + C(115, 54.5, 3, Ad, 1) +
      Pn(HD, A) + clipD(HD, En(100, 106, 18, 9, "#000", `opacity=".16"`) + S("M80,90 Q86,83 94,82", "#fff", 2, `opacity=".3"`)) + P(HD, "none", 1.4) +
      aEye(87, 96, "#3b2a1a", 1.15) + aEye(102, 96, "#3b2a1a", 1.15) +
      P("M88,105 Q94.5,112 101,105 Q94.5,107 88,105Z", "#c0392b", 1) +
      S("M80,103 l1.6,-1.8 M82.4,103.4 l1.6,-1.8 M105.6,103.4 l1.6,-1.8 M108,103 l1.6,-1.8", "#ff8a80", 1);
    // Ant-Man riding on the ant's back, waving: much smaller than the ant
    const tor = "M50,72 Q60,69 70,72 Q72,84 69,96 L51,96 Q48,84 50,72Z";
    const man =
      limb([[56, 94], [48, 102], [47, 114]], Rd, 7.5, K, E(46, 116, 5, 3.4, K)) +
      P(tor, Rd, 1.2) + clipD(tor, Pn("M50,72 L55,72 L54,96 L50,96Z", K) + Pn("M70,72 L65,72 L66,96 L70,96Z", K) + S("M60,72 V92", K, 2)) +
      P("M50.5,90 Q60,93 69.5,90 L69.8,95 Q60,98 50.2,95Z", Si, .9) + C(60, 93.4, 2.6, "#ff5252", .8) + shadeOn(tor, 64) +
      limb([[68, 76], [76, 86], [82, 96]], Rd, 6.5, K, fist(83, 98, 4, K)) +
      limb([[52, 76], [42, 66], [38, 54]], Rd, 6.5, K, fist(37, 51, 4.6, K)) +
      head(antHelmet(), 60, 52, 1.2, -6);
    return [bg, aEdge(shadow(60, 148, 50, 2.6) + ant + `<g transform="translate(20 34) scale(.7)">${man}</g>`)];
  }

  FAN.marvel = [
    ["Spider-Man", "red and blue suit, web lines, big white lenses; swinging over the skyscrapers, the web-shooter hand shooting a web", spiderman],
    ["Miles Morales", "black suit with red web lines and red spider, a cyan rim light; crouched on a rooftop before a huge glowing moon", miles],
    ["Iron Man", "red and gold armour, glowing arc reactor and eye slits; flying, repulsor blast", ironman],
    ["Hulk", "huge and green, messy black hair, torn purple shorts; flexing both fists, the ground cracking", hulk],
    ["Captain America", "winged helmet with the A, star and stripes; the round shield up", captain],
    ["Black Panther", "cat-ear mask, bold silver fang necklace, white claws out; purple kinetic glow over Wakanda", panther],
    ["Thor", "red cape, silver discs, blond hair, short beard and a big grin; Mjolnir raised with lightning, stormy sky", thor],
    ["Captain Marvel", "red and blue suit, gold star; flying up with glowing fists in space", marvel],
    ["Ant-Man", "silver helmet with antennae and red lenses; tiny, riding a giant friendly ant past a giant dew drop in giant grass", antman],
  ];
})();

/* Sticker book theme page "Heroes 2 (DC)": nine chibi superheroes in the album's anime style (FAN.dc rows: name, what, draw) */
(() => {
  "use strict";
  const OL = A_OL, O = A_OUT;
  const U = p => `dc${p}${++aUid}`;
  const P = (d, f, extra = "") => `<path d="${d}" fill="${f}" ${O} stroke-linejoin="round" ${extra}/>`;
  const place = (svg, x, y, s, rot = "") => `<g transform="translate(${x} ${y}) scale(${s})${rot ? ` rotate(${rot})` : ""}">${svg}</g>`;
  const shadow = (x = 60, y = 143, rx = 30) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="4.5" fill="#000" opacity=".22"/>`;
  const sparks = (pts, c = "#fff") => pts.map(([x, y, r]) => aSpark(x, y, r, c)).join("");
  const back = (id, a, b) => `<defs>${aVGrad(id, a, b)}</defs><rect width="120" height="158" fill="url(#${id})"/>`;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  /* ---------- body: a chibi hero in figure coordinates (as aFigure: head ~50,25, feet ~107) ---------- */
  // o: pose {ba, fa, bl, fl: 3 points each, bb, fb: [x, y, rot] boots}, skin, suit, sleeve, legs, glove (+ gloveAt 0..1 from
  // the elbow), boot (+ bootAt from the knee), cuff (bracelet), torso ("m"/"f"), shade, hips (svg), chest (svg), belt,
  // capeBack (svg, drawn first), behind (svg after the cape), head (svg), top (svg), frontOver (front arm after the head),
  // grip (svg drawn just before the front fist: a staff held in it)
  function hero(o) {
    const p = o.pose, s = [], skin = o.skin;
    const arm = pts => {
      let r = aL(pts, o.sleeve || o.suit, 7.6);
      if (o.sleeveTo !== undefined) r += aL([pts[0], lerp(pts[0], pts[1], o.sleeveTo)], o.suit, 7.6, false);
      if (o.glove) r += aL([lerp(pts[1], pts[2], o.gloveAt ?? .2), pts[2]], o.glove, 7.6, false);
      if (o.cuff) { const a = lerp(pts[1], pts[2], .45), b = lerp(pts[1], pts[2], .8); r += aL([a, b], OL, 8.6, false) + aL([a, b], o.cuff, 6.8, false) + aL([a, b], "#fff", 1.4, false); }
      return r;
    };
    const fist = (pts, grip = "") => grip + aC(pts[2][0], pts[2][1], 4.7, o.glove || skin, O) + aL([[pts[2][0] - 2.2, pts[2][1] - 1.4], [pts[2][0] + 2.2, pts[2][1] - 1.4]], OL, .7, false) +
      (o.ring && pts === p.fa ? aC(pts[2][0] + 1.8, pts[2][1] + 1.4, 1.9, "#00e676", `stroke="#fff" stroke-width=".8"`) : "");
    // o.bootShape: a shaped boot instead of the oval foot (heel, toe along +x before the foot's rotation b[2]), with a flared
    // cuff at the boot's top that has a V notch in front (Superman, Supergirl)
    const shoe = (b, c) => `<g transform="translate(${b[0]} ${b[1]}) rotate(${b[2]})">` +
      P("M-5.4,-4.2 L3,-4.2 Q10.4,-3.8 11,.4 Q11.2,4 7.2,4 H-4.6 Q-7.4,4 -7.4,1.4 L-7,-1.4 Q-6.8,-4.2 -5.4,-4.2Z", c) +
      `<path d="M-7.2,1.6 H-2.6 V4 M3,-3.6 Q8.6,-3 9.6,.2" fill="none" stroke="${OL}" stroke-width=".8" opacity=".55"/><path d="M-4,-2.6 H2.6" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".35"/></g>`;
    const cuffBand = (k, f, t, c) => {
      const L = Math.hypot(f[0] - k[0], f[1] - k[1]), d = [(f[0] - k[0]) / L, (f[1] - k[1]) / L], n = [-d[1], d[0]], a = lerp(k, f, t);
      const at = (u, v) => [a[0] + d[0] * u + n[0] * v, a[1] + d[1] * u + n[1] * v];
      return `<polygon points="${aPts([at(-1.4, 6), at(3.4, 5), at(3.4, -5), at(-1.4, -6), at(.8, 0)])}" fill="${c}" ${O} stroke-linejoin="round"/>` +
        `<path d="M${aPts([at(2.2, 4.2), at(2.2, -4.2)]).replace(" ", " L")}" stroke="#000" stroke-width="1.2" opacity=".15"/>`;
    };
    const leg = (pts, b) => { const [, k, f] = pts, ba = o.bootAt ?? .1;
      let r = aL(pts, o.legs || o.suit, 9);
      if (o.boot) r += aL([lerp(k, f, ba), f], o.boot, 9, false) + (o.bootTop ? `<polyline points="${aPts([lerp(k, f, ba + .02), lerp(k, f, ba + .13)])}" fill="none" stroke="${o.bootTop}" stroke-width="9"/>` : "");
      if (o.bootShape) return r + shoe(b, o.boot) + aL([lerp(k, f, ba + .1), f], o.boot, 9, false) + cuffBand(k, f, ba, o.boot);
      return r + `<ellipse cx="${b[0]}" cy="${b[1]}" rx="${b[3] || 6.4}" ry="3.9" fill="${o.boot || o.legs || o.suit}" ${O} transform="rotate(${b[2]} ${b[0]} ${b[1]})"/>`; };
    if (o.capeBack) s.push(o.capeBack);
    if (o.behind) s.push(o.behind);
    s.push(arm(p.ba), fist(p.ba, o.gripBack || ""));
    s.push(leg(p.bl, p.bb), leg(p.fl, p.fb));
    s.push(o.hips || P("M38,64 h24 v8 q0,3 -3,3 h-6 l-3,-3 l-3,3 h-6 q-3,0 -3,-3z", o.trunks || o.suit));
    const id = U("t"), torso = o.torso === "f" ? "M37.5,47 Q37.5,41 43,41 H57 Q62.5,41 62.5,47 Q59.5,56 60.5,68 H39.5 Q40.5,56 37.5,47Z" : "M36,47 Q36,41 42,41 H58 Q64,41 64,47 L62,68 H38Z";
    s.push(`<clipPath id="${id}"><path d="${torso}"/></clipPath><path d="${torso}" fill="${o.suit}"/>`,
      `<g clip-path="url(#${id})">${o.chestFill || ""}<path d="M56,41 Q53,55 57,70 H66 V41Z" fill="#000" opacity="${o.shade ?? .15}"/></g>`, `<path d="${torso}" fill="none" ${O}/>`);
    if (o.belt) s.push(P("M38,63.5 H62 V68 H38Z", o.belt) + (o.buckle || ""));
    if (o.chest) s.push(o.chest);
    if (!o.frontOver) s.push(arm(p.fa), fist(p.fa, o.grip || ""));
    s.push(o.head);
    if (o.frontOver) s.push(arm(p.fa), fist(p.fa, o.grip || ""));
    if (o.top) s.push(o.top);
    return s.join("");
  }

  /* ---------- heads ---------- */
  const face = skin => aC(33.4, 27, 3.2, skin, O) + aC(66.6, 27, 3.2, skin, O) + `<path d="${A_FACE}" fill="${skin}" ${O}/>`;
  const eyes = (c, lash = 0, s = 1, y = 28.5) => aEye(43.3, y, c, s, lash) + aEye(56.7, y, c, s, lash);
  const smile = (y = 36.2) => `<path d="M46.6,${y} Q50,${y + 3.8} 53.4,${y}Z" fill="#c0392b" stroke="${OL}" stroke-width=".9" stroke-linejoin="round"/>`;
  const grin = (y = 36) => `<path d="M45.8,${y} Q50,${y + 4.6} 54.2,${y}Z" fill="#c0392b" stroke="${OL}" stroke-width=".9" stroke-linejoin="round"/><path d="M46.6,${y + .4} H53.4 L53,${y + 1.5} H47Z" fill="#fff"/>`;
  const shine = (x = 50, y = 9) => `<path d="M${x - 8},${y + 2} Q${x},${y - 1.5} ${x + 8},${y + 2}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".35"/>`;
  // white mask lenses (Batman, Robin): canonical white, rounded below and only a slight slant: confident, not cross
  const lenses = (y = 0, sc = 1) => `<g transform="translate(50 ${28 + y}) scale(${sc}) translate(-50 -28)">` +
    P("M38,26.4 Q42.6,24.4 47.8,26.8 Q47.6,32 42.8,32 Q38.2,31.8 38,26.4Z", "#fff") + P("M62,26.4 Q57.4,24.4 52.2,26.8 Q52.4,32 57.2,32 Q61.8,31.8 62,26.4Z", "#fff") +
    `<path d="M40,26.6 Q42.6,26 45,27" fill="none" stroke="#cfd8dc" stroke-width=".9" stroke-linecap="round"/><path d="M60,26.6 Q57.4,26 55,27" fill="none" stroke="#cfd8dc" stroke-width=".9" stroke-linecap="round"/></g>`;
  // a confident lopsided grin (Batman, Robin)
  const cocky = (y = 36.4) => `<g transform="rotate(-6 50 ${y})"><path d="M45.4,${y} Q50,${y + 4.8} 54.8,${y - .6} Q50,${y + 1.2} 45.4,${y}Z" fill="#c0392b" stroke="${OL}" stroke-width=".9" stroke-linejoin="round"/>` +
    `<path d="M46.6,${y + .5} Q50,${y + 1.5} 53.8,${y - .1} L53.2,${y + 1.2} Q50,${y + 2.6} 47.2,${y + 1.4}Z" fill="#fff"/></g>`;
  const neatHair = h => aC(50, 21, 17.6, h, O);
  const fringe = h => P("M33,25 Q32,6 50,5 Q68,6 67,25 Q63,15 55,13.5 Q48,19.5 39,17.5 Q35.5,20.5 33,25Z", h);
  // the bat cowl (Batman, Batgirl): covers the head down to the nose, pointed ears
  const cowl = (c, ear = 1) => P(`M32.6,41 Q30.2,26 32.8,15.5 L${34.6 - ear},${-2 * ear + 1} L41,9.2 Q50,6.8 59,9.2 L${65.4 + ear},${-2 * ear + 1} L67.2,15.5 Q69.8,26 67.4,41 L62.4,40 Q63,34.6 61,32.2 Q56,31.4 50,34.6 Q44,31.4 39,32.2 Q37,34.6 37.6,40Z`, c) +
    `<path d="M40,11.5 Q50,8.5 60,11.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".22"/>`;

  /* ---------- emblems ---------- */
  const BAT = "M-12,-1 Q-9,-4.2 -5,-4 Q-3.4,-2 -2,-4 L-1.3,-6 L-.6,-3.8 H.6 L1.3,-6 L2,-4 Q3.4,-2 5,-4 Q9,-4.2 12,-1 Q9.2,-.2 8.4,3 Q6.4,1 4.2,2.6 Q2.2,2 0,5.6 Q-2.2,2 -4.2,2.6 Q-6.4,1 -8.4,3 Q-9.2,-.2 -12,-1Z";
  const bat = (x, y, s, c = "#111") => `<path d="${BAT}" fill="${c}" transform="translate(${x} ${y}) scale(${s})"/>`;
  const batOval = (x, y, s = 1) => `<ellipse cx="${x}" cy="${y}" rx="${9 * s}" ry="${5.6 * s}" fill="#ffd600" stroke="${OL}" stroke-width="1"/>` + bat(x, y, .62 * s);
  const sShield = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-9.5,-6.5 H9.5 L13,-2 L0,11 L-13,-2Z" fill="#ffd600" stroke="#d50000" stroke-width="1.9" stroke-linejoin="round"/>` +
    `<path d="M-9.5,-6.5 H9.5 L13,-2 L0,11 L-13,-2Z" fill="none" stroke="${OL}" stroke-width=".6" stroke-linejoin="round" transform="scale(1.1)"/>` +
    `<path d="M6.6,-3.6 H-3.4 Q-7,-3.6 -6.4,-.8 Q-6,1 -2.6,1.2 H2.6 Q4.2,1.4 3,3 L-.2,6 L-2.4,3.8 H-5 L0,8.2 L5.4,3.4 Q8,.4 5,-1.2 H-1.4 Q-2.6,-1.4 -1.2,-2 H5.2Z" fill="#d50000"/></g>`;
  const BOLT = "M2,-9 L-5,1 H-.5 L-3,9 L5,-1.6 H.4Z";
  const flashEmblem = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">${aC(0, 0, 8, "#fff", `stroke="#ffc107" stroke-width="1.8"`)}${aC(0, 0, 9.1, "none", `stroke="${OL}" stroke-width=".7"`)}<path d="${BOLT}" fill="#ffc107" stroke="${OL}" stroke-width=".6" stroke-linejoin="round" transform="scale(.95)"/></g>`;
  const lanternSym = (x, y, s = 1, c = "#00c853") => `<g transform="translate(${x} ${y}) scale(${s})" fill="${c}">` +
    `<circle r="4.6" fill="none" stroke="${c}" stroke-width="2.4"/><rect x="-6" y="-8.6" width="12" height="2.4"/><rect x="-6" y="6.2" width="12" height="2.4"/></g>`;

  /* ---------- backdrops ---------- */
  function city(seed, base, win, y0 = 112) {      // building silhouettes with lit windows
    const R = aRand(seed), out = [];
    for (let x = -4; x < 124;) { const w = 12 + R() * 14, h = 20 + R() * 46, top = y0 - h;
      out.push(`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${(160 - top).toFixed(1)}" fill="${base}"/>`);
      for (let wy = top + 4; wy < 154; wy += 6) for (let wx = x + 3; wx < x + w - 4; wx += 5) if (R() < .35) out.push(`<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="2.2" height="3" fill="${win}"/>`);
      x += w + 1; }
    return out.join("");
  }
  const stars = (seed, n, y1 = 158, c = "#fff") => { const R = aRand(seed); return [...Array(n)].map(() => aC(R() * 120, R() * y1, .4 + R() * .8, c, `opacity="${(.5 + R() * .5).toFixed(2)}"`)).join(""); };
  const cloud = (x, y, s, c = "#fff", op = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${c}" opacity="${op}">${aC(0, 0, 8, c)}${aC(9, -3, 10, c)}${aC(19, 1, 7, c)}<rect x="-6" y="0" width="30" height="7" rx="3.5"/></g>`;

  /* ---------- 1 Batman ---------- */
  function batman() {
    const g = U("g"), suit = "#8a96a3", dk = "#262a35";
    const cape = P("M41,42 Q29,50 15,62 L9,104 Q17,97 24,106 Q31,98 38,108 Q44,100 50,108 Q56,100 62,108 Q69,98 76,106 Q83,97 91,104 L85,62 Q71,50 59,42Z", dk) +
      `<path d="M50,46 V104 M30,56 L22,102 M70,56 L78,102" stroke="#3a4050" stroke-width="1.6" fill="none"/>`;
    const fig = hero({
      pose: { ba: [[39, 47], [28, 54], [19, 61]], fa: [[61, 47], [72, 54], [81, 61]], bl: [[45, 72], [41, 88], [39, 102]], bb: [36, 106, 0, 7], fl: [[55, 72], [59, 88], [61, 102]], fb: [64, 106, 0, 7] },
      skin: A_SKIN[0], suit, legs: suit, glove: dk, gloveAt: 0, boot: dk, bootAt: .25, trunks: dk, capeBack: cape,
      belt: "#ffc400", buckle: [41, 46, 54, 59].map(x => `<rect x="${x - 1.8}" y="64.2" width="3.6" height="3.2" rx=".6" fill="#e0a800" stroke="${OL}" stroke-width=".6"/>`).join(""),
      chest: batOval(50, 51, 1.05) + `<path d="M36.5,45 Q40,43 41,42 M63.5,45 Q60,43 59,42" stroke="${dk}" stroke-width="3" fill="none"/>`,
      head: face(A_SKIN[0]) + cowl(dk) + lenses(-1.4) + cocky(37) + `<path d="M47,34.6 Q50,35.6 53,34.6" fill="none" stroke="#c99a7a" stroke-width=".8"/>`,
    });
    return [back(g, "#0b1640", "#29407a") + stars(11, 30, 70) +
      `<path d="M124,158 L84,26 L112,26 Z" fill="#fff59d" opacity=".16"/>` + aC(98, 24, 15, "#fff59d", `opacity=".35"`) + aC(98, 24, 12.5, "#ffee58", `stroke="#fff9c4" stroke-width="1.4"`) + bat(98, 24.5, .92) +
      city(5, "#141c3a", "#ffd54f", 96) + shadow(60, 142, 34) + sparks([[16, 50, 2.6], [108, 48, 2]]),
      aEdge(place(fig, 4, 19, 1.12))];
  }

  /* ---------- 2 Superman ---------- */
  function superman() {
    const g = U("g"), blue = "#1e5bd8", red = "#e01e2b";
    const cape = P("M40,43 Q31,70 24,104 Q32,98 38,108 Q45,99 52,110 Q58,99 65,106 Q70,96 76,100 Q68,72 60,43Z", red) +
      `<path d="M44,52 Q40,80 38,104 M56,52 Q60,80 64,102" stroke="#a5121c" stroke-width="1.6" fill="none"/>`;
    const fig = hero({
      pose: { ba: [[39, 47], [33, 58], [32, 68]], fa: [[61, 46], [70, 32], [75, 15]], bl: [[46, 72], [45, 87], [44, 98]], bb: [44, 103, 85], fl: [[54, 72], [58, 83], [57, 94]], fb: [57.6, 99, 75] },
      skin: A_SKIN[1], suit: blue, legs: blue, boot: red, bootAt: .4, bootShape: 1, trunks: red, capeBack: cape, belt: "#ffd600", frontOver: 1,
      chest: sShield(50, 51, .95) + P("M37,44 Q38,41 43,41 L41,47Z", red) + P("M63,44 Q62,41 57,41 L59,47Z", red),
      head: `<g transform="rotate(-18 50 40)">` + neatHair("#141414") + face(A_SKIN[1]) + fringe("#141414") + `<path d="M48,13 q-4,3 -1,6 q3,2 0,5" fill="none" stroke="#141414" stroke-width="2.2" stroke-linecap="round"/>` + shine(46, 8) +
        eyes("#2a6fdb") + aBlush() + grin() + `</g>` });
    return [back(g, "#2f8ff0", "#bfe6ff") + aC(98, 22, 30, "#fff", `opacity=".25"`) +
      cloud(6, 132, 1.4) + cloud(70, 142, 1.6) + cloud(84, 30, .9, "#fff", .9) + cloud(-4, 46, .8, "#fff", .8) +
      [[10, 112], [16, 122], [6, 100], [24, 130]].map(([x, y], i) => `<path d="M${x},${y} l${-10 + i},${12 - i}" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`).join("") +
      sparks([[104, 70, 3.4], [40, 22, 2.6]]),
      aEdge(place(fig, -6, 9, 1.25, "16 50 60"))];
  }

  /* ---------- 3 Wonder Woman ---------- */
  function wonderWoman() {
    const g = U("g"), red = "#d81e2c", blue = "#1d3fa0", gold = "#f6c21c", skin = A_SKIN[2];
    const hair = P("M33,18 Q26,40 28,62 Q34,58 37,64 Q40,54 41,44 L59,44 Q60,54 63,64 Q66,58 72,62 Q74,40 67,18Z", "#1b1b2a");
    const loop = `cx="58" cy="-3" rx="23" ry="7.4" fill="none"`;
    const lasso = `<ellipse ${loop} stroke="#ffeb3b" stroke-width="6" opacity=".35"/>` +
      `<ellipse ${loop} stroke="${OL}" stroke-width="3.6"/><ellipse ${loop} stroke="${gold}" stroke-width="2.2"/>` +
      `<path d="M27,25 Q27,8 36.4,.6" fill="none" stroke="${OL}" stroke-width="3.6"/><path d="M27,25 Q27,8 36.4,.6" fill="none" stroke="${gold}" stroke-width="2.2"/>` +
      `<path d="M27,28 Q14,44 18,70 Q20,86 12,100" fill="none" stroke="${OL}" stroke-width="3.6"/><path d="M27,28 Q14,44 18,70 Q20,86 12,100" fill="none" stroke="${gold}" stroke-width="2.2"/>` +
      `<ellipse ${loop} stroke="#fff" stroke-width=".7" stroke-dasharray="2 3"/>`;
    const skirt = P("M38.5,63 H61.5 L66,79 Q50,82 34,79Z", blue) + [[42, 70], [50, 74], [58, 70], [45, 77], [56, 77]].map(([x, y]) => aStar(x, y, 2.3, "#fff")).join("");
    const fig = hero({
      pose: { ba: [[39, 47], [31, 37], [27, 26]], fa: [[61, 47], [72, 50], [72, 38]], bl: [[45, 76], [40, 90], [37, 102]], bb: [35, 106, 0, 6.6], fl: [[55, 76], [60, 90], [63, 102]], fb: [65, 106, 0, 6.6] },
      skin, suit: red, sleeve: skin, legs: skin, cuff: "#cfd8dc", boot: red, bootAt: 0, bootTop: "#fff", torso: "f", hips: skirt, frontOver: 1,
      chestFill: `<rect x="30" y="38" width="40" height="5" fill="${skin}"/>`, behind: hair,
      chest: P("M37.6,44.5 L42.4,52 L46,46.6 L50,52.6 L54,46.6 L57.6,52 L62.4,44.5 L59.4,45.2 L57.4,48.6 L54,43.6 L50,49.6 L46,43.6 L42.6,48.6 L40.6,45.2Z", gold) +
        P("M38.5,62.6 H61.5 V66.2 H38.5Z", gold),
      head: face(skin) + fringe("#1b1b2a") + P("M35,17 Q50,9.5 65,17 L64,19.6 Q50,13 36,19.6Z", gold) + aStar(50, 14.4, 3.6, red) + shine(42, 8) +
        eyes("#3a7bd5", 1) + aBlush() + smile(),
      gripBack: lasso });
    return [back(g, "#ff9a5a", "#ffe0a3") + A_RAYS +
      `<rect x="0" y="110" width="120" height="48" fill="#4fb3d9"/><path d="M0,112 Q15,108 30,112 T60,112 T90,112 T120,112" stroke="#fff" stroke-width="1.4" fill="none" opacity=".7"/>` +
      [6, 102].map(x => `<rect x="${x}" y="40" width="12" height="76" fill="#fff8e7" ${O}/><rect x="${x - 3}" y="34" width="18" height="7" fill="#fff8e7" ${O}/><rect x="${x - 3}" y="112" width="18" height="6" fill="#fff8e7" ${O}/>` +
        [3, 6, 9].map(d => `<path d="M${x + d},44 V110" stroke="#e5d6b8" stroke-width="1.1"/>`).join("")).join("") +
      shadow(60, 143, 28) + sparks([[24, 46, 3, "#fffde7"], [106, 20, 2.4, "#fffde7"]]),
      aEdge(place(fig, 6, 22, 1.12))];
  }

  /* ---------- 4 The Flash ---------- */
  function flash() {
    const g = U("g"), red = "#e3141e", gold = "#ffc107";
    const ears = side => `<g transform="translate(50 0) scale(${side} 1) translate(-50 0)">` + P("M33.4,25 L21,17 L26,19 L19,10 L29,16.4 L28,12.6 L34,19.4Z", gold) + `</g>`;
    const trail = aL([[34, 52], [14, 46], [6, 54], [-14, 44]], gold, 3.4) + aL([[30, 66], [10, 62], [2, 72], [-16, 66]], gold, 3.4) + aL([[24, 84], [8, 80], [0, 88], [-14, 84]], gold, 2.6);
    const fig = hero({
      pose: { ba: [[39, 47], [30, 55], [23, 49]], fa: [[61, 47], [69, 41], [76, 47]], bl: [[45, 72], [36, 82], [26, 85]], bb: [24, 87, -30, 7], fl: [[55, 72], [61, 86], [58, 100]], fb: [61, 104, 0, 7] },
      skin: A_SKIN[0], suit: red, legs: red, glove: red, boot: gold, bootAt: .35, trunks: red, belt: gold, behind: trail,
      buckle: `<path d="M48,63.8 L52,63.8 L49.6,66 H52.4 L48.4,69.4 L49.6,66.6 H47Z" fill="#fff59d"/>`,
      chest: flashEmblem(50, 51, 1.05),
      head: face(A_SKIN[0]) + P("M32.6,40 Q30.2,24 33.4,14 Q38,5 50,5 Q62,5 66.6,14 Q69.8,24 67.4,40 L62.6,39 Q63,35.4 61.4,33.6 Q56,33 50,35.4 Q44,33 38.6,33.6 Q37,35.4 37.4,39Z", red) +
        shine(46, 8) + ears(1) + ears(-1) + eyes("#2a6fdb") + grin(36.6) });
    const streaks = [[4, 30, 40], [0, 52, 30], [10, 92, 26], [0, 118, 44], [60, 134, 50], [70, 20, 40]].map(([x, y, w]) =>
      `<path d="M${x},${y} h${w}" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>`).join("");
    const zig = (x, y, s, r) => `<path d="${BOLT}" fill="${gold}" stroke="#fff59d" stroke-width=".6" transform="translate(${x} ${y}) scale(${s}) rotate(${r})"/>`;
    return [back(g, "#2a0d4a", "#7b1f3a") + `<g opacity=".25">${A_RAYS}</g>` + streaks + zig(104, 112, 1.4, 20) + zig(100, 22, 1.1, 10) +
      `<rect x="0" y="136" width="120" height="22" fill="#3b1530"/><path d="M0,146 H120" stroke="#ffc107" stroke-width="1.6" stroke-dasharray="8 6"/>` +
      sparks([[96, 70, 3, "#fff59d"]]),
      aEdge(place(fig, 14, 20, 1.1, "10 50 60"))];
  }

  /* ---------- 5 Aquaman ---------- */
  function aquaman() {
    const g = U("g"), org = "#f39c12", grn = "#1e9e4a", gold = "#f6c21c", skin = A_SKIN[2], hair = "#e8b443";
    const scales = [...Array(6)].map((_, r) => [...Array(7)].map((_, c) => `<path d="M${33 + c * 5 + (r % 2) * 2.5},${43 + r * 4.4} q2.5,3 5,0" fill="none" stroke="#c46a00" stroke-width=".8"/>`).join("")).join("");
    const hairBack = P("M32,16 Q22,36 26,60 Q31,56 34,62 Q37,52 38,44 L62,44 Q63,52 66,62 Q69,56 74,60 Q78,36 68,16Z", hair);
    const shaft = `<path d="M76,110 V2" stroke="${OL}" stroke-width="4.4" stroke-linecap="round"/><path d="M76,110 V2" stroke="${gold}" stroke-width="2.4" stroke-linecap="round"/>`;
    const prongs = P("M66,-6 L66,5 Q66,9 70,9 H82 Q86,9 86,5 L86,-6 L83.6,-2 V5 H78.2 V-12 L76,-17 L73.8,-12 V5 H68.4 V-2Z", gold) + `<path d="M70,11 H82" stroke="${OL}" stroke-width="2"/>`;
    const fig = hero({
      pose: { ba: [[39, 47], [30, 39], [26, 29]], fa: [[61, 47], [70, 54], [76, 52]], bl: [[45, 72], [42, 88], [40, 102]], bb: [38, 106, 0, 7], fl: [[55, 72], [58, 88], [60, 102]], fb: [63, 106, 0, 7] },
      skin, suit: org, sleeve: org, glove: grn, gloveAt: 0, legs: grn, boot: grn, trunks: grn, chestFill: scales, behind: hairBack + shaft,
      belt: gold, buckle: P("M46.4,62.4 H53.6 V69 H46.4Z", gold) + `<path d="M48,68 L50,63.6 L52,68 M48.8,66.4 H51.2" stroke="${OL}" stroke-width=".9" fill="none"/>`,
      head: neatHair(hair) + face(skin) +
        P("M33.6,27 Q34,41 50,43.6 Q66,41 66.4,27 Q64,36 59,37 Q55,34.6 50,35.4 Q45,34.6 41,37 Q36,36 33.6,27Z", "#d9a032") +
        fringe(hair) + shine(46, 8) + eyes("#1e88e5", 0, .95, 27.8) + `<path d="M46.4,37.4 Q50,40 53.6,37.4Z" fill="#c0392b" stroke="${OL}" stroke-width=".8"/>`,
      top: prongs });
    const fish = (x, y, s, c, flip = 1) => `<g transform="translate(${x} ${y}) scale(${s * flip} ${s})"><path d="M-7,0 Q0,-6 7,0 Q0,6 -7,0Z M7,0 L12,-4 L12,4Z" fill="${c}" ${O}/>${aC(-3.4, -.8, 1, "#111")}</g>`;
    const R = aRand(55), bub = [...Array(12)].map(() => aC(R() * 120, 20 + R() * 120, .8 + R() * 1.8, "none", `stroke="#e0f7fa" stroke-width=".8" opacity=".8"`)).join("");
    return [back(g, "#28c3d4", "#0b3d7a") + `<g opacity=".18">${[10, 40, 70, 100].map(x => `<polygon points="${x},0 ${x + 12},0 ${x + 30},158 ${x + 10},158" fill="#fff"/>`).join("")}</g>` +
      `<path d="M0,8 Q10,4 20,8 T40,8 T60,8 T80,8 T100,8 T120,8 V0 H0Z" fill="#9be7f0" opacity=".7"/>` + bub +
      fish(14, 52, 1, "#ff7043") + fish(104, 80, .9, "#ffd54f", -1) + fish(16, 92, .7, "#ffd54f") + fish(102, 40, .7, "#ff7043", -1) +
      [8, 20, 96, 110].map((x, i) => `<path d="M${x},160 Q${x - 6},${140 - i * 3} ${x + 2},${128 - i * 4} Q${x + 8},${116 - i * 3} ${x},${104 + i * 2}" fill="none" stroke="#2e7d32" stroke-width="3" stroke-linecap="round"/>`).join("") +
      `<path d="M0,150 Q30,140 60,148 T120,146 V158 H0Z" fill="#e8c27a"/>` +
      shadow(60, 143, 28) + sparks([[28, 44, 2.4]]),
      aEdge(place(fig, 4, 25, 1.1))];
  }

  /* ---------- 6 Robin ---------- */
  function robin() {
    const g = U("g"), red = "#e0202b", grn = "#2e9b3e", yel = "#ffcc00";
    const cape = P("M42,42 Q28,56 10,88 Q20,86 24,94 Q30,86 36,92 Q40,80 46,64Z", yel) + P("M42,42 Q34,52 26,70 Q32,66 40,68 Q43,56 46,50Z", "#1b1b1b");
    const staff = `<path d="M90,8 L50,76" stroke="${OL}" stroke-width="4.6" stroke-linecap="round"/><path d="M90,8 L50,76" stroke="#8d6e63" stroke-width="2.6" stroke-linecap="round"/>` +
      `<path d="M88.4,10.8 L86,15 M52.4,72 L54.8,68" stroke="#cfd8dc" stroke-width="2.6"/>`;
    const fig = hero({
      pose: { ba: [[39, 47], [29, 52], [21, 46]], fa: [[61, 47], [71, 44], [74.5, 33]], bl: [[45, 72], [35, 79], [31, 92]], bb: [29, 96, 10, 6.6], fl: [[55, 72], [65, 81], [62, 94]], fb: [65, 98, 0, 6.6] },
      skin: A_SKIN[1], suit: red, sleeve: grn, glove: grn, gloveAt: .1, legs: grn, boot: "#1b1b1b", bootAt: .3, trunks: grn, capeBack: cape, belt: yel,
      buckle: [43, 50, 57].map(x => `<rect x="${x - 1.6}" y="64.3" width="3.2" height="3" rx=".5" fill="#ffe082" stroke="${OL}" stroke-width=".5"/>`).join(""),
      chest: `<path d="M46,41.5 L50,46 L54,41.5" fill="none" stroke="#1b1b1b" stroke-width="1.6"/>` + aC(54.8, 52, 4.8, yel, O) +
        `<text x="54.8" y="54.9" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="7.8" fill="#111">R</text>`,
      grip: staff, frontOver: 0,
      head: aKidHead({ skin: A_SKIN[1], hair: "#141414", hs: "spiky", eyes: "#333", mouth: "" }).split("<ellipse cx=\"43.3\"")[0] +
        P("M33.6,26 Q37,22 44,24 Q50,25.6 56,24 Q63,22 66.4,26 Q66,33 59,33.4 Q53,33 50,30.6 Q47,33 41,33.4 Q34,33 33.6,26Z", "#141414") + lenses(-.4, .82) + aBlush() + cocky(36.6) });
    return [back(g, "#ff8a3d", "#ffd27a") + aC(92, 34, 18, "#fff3c4", `opacity=".7"`) +
      `<path d="M0,96 L20,90 L22,70 L36,70 L38,88 L60,84 L62,64 L74,58 L86,64 L88,90 L120,88 V158 H0Z" fill="#7e3f8f" opacity=".55"/>` +
      `<rect x="0" y="126" width="120" height="32" fill="#4a2340"/><rect x="0" y="124" width="120" height="4" fill="#6d3a5f"/>` + cloud(4, 26, .8, "#ffe9b0", .8) +
      shadow(56, 140, 26) + sparks([[14, 54, 2.6], [106, 74, 2.2]]),
      aEdge(place(fig, 6, 26, 1.1))];
  }

  /* ---------- 7 Supergirl ---------- */
  // flying to the left (Superman flies up to the right): the whole body tilted, fist ahead, cape and hair streaming behind
  function supergirl() {
    const g = U("g"), blue = "#2266e0", red = "#e01e2b", capeRed = "#c4141f", hair = "#f3cf5a", hairDk = "#c99a1e", skin = A_SKIN[0];
    const cape = P("M41,43 Q30,64 30,88 Q30,102 22,114 Q31,111 35,118 Q41,109 48,116 Q52,106 59,110 Q63,99 70,99 Q64,86 63,70 Q62,55 59,43Z", capeRed) +
      `<path d="M45,52 Q38,78 35,106 M55,52 Q59,76 60,100" stroke="#8e0d16" stroke-width="1.6" fill="none"/>`;
    const hairBack = P("M33,18 Q24,40 30,62 Q30,76 38,86 Q40,78 44,80 Q42,68 44,56 Q48,62 52,74 Q54,64 56,58 Q60,66 66,72 Q68,60 64,48 Q72,36 67,18Z", hair) +
      `<path d="M36,30 Q32,50 38,74 M44,36 Q42,52 47,66 M62,32 Q64,44 61,56" fill="none" stroke="${hairDk}" stroke-width="1.1" stroke-linecap="round"/>`;
    const skirt = P("M38.5,63 H61.5 L65,76 Q50,79 35,76Z", red) + P("M38.5,62.4 H61.5 V65.6 H38.5Z", "#ffd600");
    const fig = hero({
      pose: { ba: [[39, 47], [28, 36], [21, 21]], fa: [[61, 46], [68, 56], [63, 64]], bl: [[46, 74], [45, 88], [44, 99]], bb: [44, 104, 88], fl: [[54, 74], [62, 84], [58, 95]], fb: [58.4, 100, 80] },
      skin, suit: blue, sleeve: blue, legs: skin, boot: red, bootAt: .15, bootShape: 1, torso: "f", hips: skirt, capeBack: cape, behind: hairBack, frontOver: 1,
      chest: sShield(50, 50, .82) + P("M37,44 Q38,41 43,41 L41,47Z", red) + P("M63,44 Q62,41 57,41 L59,47Z", red),
      head: `<g transform="rotate(22 50 40)">` + face(skin) + P("M33,26 Q31,6 50,5 Q69,6 67,26 Q64,16 57,13.6 Q50,18 44,14.6 Q38,16 33,26Z", hair) + shine(46, 8) +
        eyes("#3a7bd5", 1) + aBlush() + grin() + `</g>` });
    const wind = [[66, 96, 30], [80, 110, 26], [58, 120, 22], [90, 84, 20]].map(([x, y, w]) =>
      `<path d="M${x},${y} l${w * .8},${w * .6}" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".75"/>`).join("");
    return [back(g, "#7e57c2", "#ffb3a7") + stars(7, 14, 50) + aC(96, 120, 22, "#ffe082", `opacity=".8"`) + aC(96, 120, 16, "#fff3c4") +
      cloud(-6, 136, 1.6, "#fff") + cloud(60, 142, 1.8, "#fff") + cloud(82, 40, .8, "#fff", .7) + wind + sparks([[50, 22, 3], [108, 62, 2.6], [12, 112, 2]]),
      aEdge(place(fig, 13, 23, 1.08, "-45 50 60"))];
  }

  /* ---------- 8 Batgirl ---------- */
  function batgirl() {
    const g = U("g"), pur = "#6a3fb5", dk = "#241640", lining = "#4a2d80", yel = "#ffd600", hair = "#e2561f", skin = A_SKIN[0];
    // the cape: dark, with scalloped bat-wing edges, flaring down to the left
    const cape = P("M41,42 Q28,52 14,68 Q20,72 17,81 Q26,79 27,88 Q33,83 37,91 Q41,77 46,62Z", dk) +
      `<path d="M40,46 Q30,58 21,72 M43,52 Q37,66 32,82" fill="none" stroke="${lining}" stroke-width="2.4" stroke-linecap="round"/>`;
    // the hair: a long red ponytail-like flow from under the back of the cowl, with strands and a highlight
    const hairBack = P("M38,23 Q27,22 21,30 Q16,38 8,42 Q13,45 9,51 Q17,51 21,47 Q19,56 13,63 Q25,62 29,52 Q32,45 40,39Z", hair) +
      `<path d="M35,27 Q26,29 21,37 Q17,43 12,47 M37,33 Q30,37 27,45 Q24,53 18,59" fill="none" stroke="#a83a12" stroke-width="1.1" stroke-linecap="round"/>` +
      `<path d="M34,24.6 Q27,25 23.4,30.4" fill="none" stroke="#ffb08a" stroke-width="1.8" stroke-linecap="round"/>`;
    const batarang = `<path d="${BAT}" fill="${yel}" stroke="${OL}" stroke-width="1.4" stroke-linejoin="round" transform="translate(88 27) scale(.72) rotate(-20)"/>` +
      `<path d="M74,30 l6,-3 M76,24 l5,-2.4" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>`;
    const fig = hero({
      pose: { ba: [[39, 47], [30, 55], [24, 63]], fa: [[61, 47], [70, 41], [77, 35]], bl: [[45, 72], [37, 80], [30, 90]], bb: [27, 93, 30, 6.6], fl: [[55, 72], [62, 86], [60, 100]], fb: [63, 104, 0, 6.6] },
      skin, suit: pur, legs: pur, glove: yel, gloveAt: .3, boot: yel, bootAt: .4, trunks: pur, torso: "f", capeBack: cape + hairBack, belt: yel,
      chest: bat(50, 51, .8, yel) + `<path d="${BAT}" fill="none" stroke="${OL}" stroke-width="1" transform="translate(50 51) scale(.8)"/>`,
      head: face(skin) + cowl(dk, .6) + P("M33.4,34 Q30,40 27.6,45 Q32.4,44.6 35,40Z", hair) + eyes("#2e8b57", 1, .92, 28.2) + aBlush(35.5) + smile(36.8),
      top: batarang });
    return [back(g, "#1a1040", "#5a2d82") + stars(21, 36, 90) + aC(64, 50, 34, "#fff8e1", `opacity=".25"`) + aC(64, 50, 28, "#fff3c4") + aC(54, 40, 4, "#f0e2a8") + aC(76, 62, 5, "#f0e2a8") +
      city(9, "#120a2a", "#b39ddb", 112) + shadow(50, 138, 24) + sparks([[14, 46, 2.6], [108, 92, 2.2]]),
      aEdge(place(fig, 10, 24, 1.1))];
  }

  /* ---------- 9 Green Lantern ---------- */
  // the ring's construct: a giant glowing fist (back of the hand, four curled fingers with knuckles, the thumb across), pointing +x
  function lanternFist(id) {
    const hand = "M-15,-12 Q-15,-17 -10,-17 H5 Q10,-17 10,-12 V12 Q10,17 5,17 H-10 Q-15,17 -15,12Z",
      wrist = "M-27,-9 H-13 V9 H-27Z",
      fingers = [-17, -8.5, 0, 8.5].map(y => `M5,${y + 4.25} Q5,${y} 9,${y} H12.6 Q17,${y} 17,${y + 4.25} Q17,${y + 8.5} 12.6,${y + 8.5} H9 Q5,${y + 8.5} 5,${y + 4.25}Z`),
      thumb = "M-6,-14 Q-4,-22 4,-21 L9,-20 Q13.6,-19 13,-15 Q12.4,-11.6 8.4,-12 L2,-12.4 Q-2,-12 -6,-14Z";
    const all = [wrist, hand, ...fingers, thumb].map(d => `<path d="${d}"/>`).join("");
    return `<defs><filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3"/></filter></defs>` +
      `<g filter="url(#${id})" fill="#00e676" stroke="#00e676" stroke-width="6" opacity=".75">${all}</g>` +
      `<g fill="#1de987" stroke="#e8fff1" stroke-width="1.3" stroke-linejoin="round">${all}</g>` +
      `<path d="M-13,-5 H-27 M-13,4 H-27" stroke="#00b248" stroke-width="1"/>` +
      [-17, -8.5, 0, 8.5].map(y => `<path d="M14.6,${y + 2} Q16,${y + 4.25} 14.6,${y + 6.5}" fill="none" stroke="#00a046" stroke-width="1.1" stroke-linecap="round"/>`).join("") +
      `<path d="M-11,-9 Q-11,-13.6 -6,-14 M-11,-4 V7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".75"/><path d="M3,-18.4 H9" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>`;
  }
  function greenLantern() {
    const g = U("g"), grn = "#18b84a", dk = "#141a1c", glow = "#69f0ae";
    const chestFill = `<path d="M30,38 H70 V47 Q60,49 56,52 Q53,47 50,47 Q47,47 44,52 Q40,49 30,47Z" fill="${dk}"/><rect x="30" y="38" width="9" height="34" fill="${dk}"/><rect x="61" y="38" width="9" height="34" fill="${dk}"/>`;
    const fa = [[61, 47], [68, 40], [72, 32]], tx = -4, ty = 15, sc = 1.17;
    const fig = hero({
      pose: { ba: [[39, 47], [31, 56], [28, 66]], fa, bl: [[45, 72], [41, 88], [38, 102]], bb: [36, 106, 0, 7], fl: [[55, 72], [59, 88], [62, 102]], fb: [64, 106, 0, 7] },
      skin: A_SKIN[1], suit: grn, sleeve: dk, glove: "#fff", gloveAt: .3, legs: dk, boot: grn, bootAt: .3, trunks: grn, chestFill, ring: 1, frontOver: 1,
      chest: aC(50, 54, 6.6, "#fff", O) + lanternSym(50, 54, .62, grn),
      head: aKidHead({ skin: A_SKIN[1], hair: "#5a3418", hs: "neat", eyes: "#6b3e1f", mouth: "" }).split("<ellipse cx=\"43.3\"")[0] +
        P("M33.4,26 Q37,21.6 44,23.6 Q50,25.2 56,23.6 Q63,21.6 66.6,26 Q66.4,33 59,33.6 Q53,33.2 50,30.8 Q47,33.2 41,33.6 Q33.6,33 33.4,26Z", grn) +
        eyes("#6b3e1f", 0, .82, 28.6) + aBlush(35.6) + grin(36.6),
      top: aC(fa[2][0] + 1.8, fa[2][1] + 1.4, 7, glow, `opacity=".45"`) + aC(fa[2][0] + 1.8, fa[2][1] + 1.4, 3.6, "#e8fff1", `opacity=".85"`) });
    const ring = [tx + sc * (fa[2][0] + 1.8), ty + sc * (fa[2][1] + 1.4)], fx = 99, fy = 23, ang = -70, fs = .98;
    const wr = [fx + 24 * fs * Math.cos(ang * Math.PI / 180 + Math.PI), fy + 24 * fs * Math.sin(ang * Math.PI / 180 + Math.PI)];   // the fist's wrist end
    const beam = `<path d="M${ring[0].toFixed(1)},${ring[1].toFixed(1)} L${wr[0].toFixed(1)},${wr[1].toFixed(1)}" stroke="${glow}" stroke-width="8" opacity=".35" stroke-linecap="round"/>` +
      `<path d="M${ring[0].toFixed(1)},${ring[1].toFixed(1)} L${wr[0].toFixed(1)},${wr[1].toFixed(1)}" stroke="#e8fff1" stroke-width="2.4" opacity=".9" stroke-linecap="round"/>`;
    return [back(g, "#06121a", "#0d3b2a") + stars(31, 50) + aC(18, 124, 13, "#3949ab", O) + `<path d="M5,122 Q18,116 31,122" stroke="#7986cb" stroke-width="2" fill="none"/>` +
      aC(56, 74, 50, "#00e676", `opacity=".1"`) + sparks([[108, 70, 3, glow], [64, 8, 2.4, glow], [14, 50, 2.4]]),
      aEdge(place(fig, tx, ty, sc)) + beam + `<g transform="translate(${fx} ${fy}) rotate(${ang}) scale(${fs})">${lanternFist(U("f"))}</g>`];
  }

  FAN.dc = [
    ["Batman", "Grey suit, black cowl with pointed ears and white lenses, a confident grin, bat cape spread wide; Gotham at night with the bat-signal", batman],
    ["Superman", "Big and flying up to the right, fist forward, red cape and red boots with cuffs, the S shield, the black curl", superman],
    ["Wonder Woman", "Tiara with the red star, gold W eagle, starry skirt, silver bracelets, glowing golden lasso", wonderWoman],
    ["The Flash", "All red with lightning ears, the bolt emblem, running in a burst of lightning", flash],
    ["Aquaman", "Orange scale shirt, green gloves and legs, long blond hair and beard, golden trident under the sea", aquaman],
    ["Robin", "Red tunic with the R, green sleeves, yellow cape, domino mask, a cheeky grin, bo staff, on a rooftop at sunset", robin],
    ["Supergirl", "Flying to the left, fist ahead, cape and long blond hair streaming behind: blue top with the S shield, red skirt and boots", supergirl],
    ["Batgirl", "Purple suit with the yellow bat, cowl with ears, a long red ponytail flowing over a dark cape, throwing a batarang under the moon", batgirl],
    ["Green Lantern", "Green and black suit, mask, lantern emblem, the ring beams out a giant glowing green fist", greenLantern],
  ];
})();

/* Sticker book theme page: Octonauts: the crew, Tunip and the Gup-A in the show's round, soft look on underwater backdrops; sets FAN.octonauts */
(() => {
  "use strict";
  const U = p => p + (++aUid);
  const OL = A_OL, NAVY = "#24366f", NAVY2 = "#1a2852", SUIT = "#4fc3f7";   // every crew uniform: navy, light-blue collar and belt, the badge
  const f1 = v => +(+v).toFixed(1);

  /* ---------- the sea ---------- */
  const bubble = (x, y, r) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="#fff" fill-opacity=".18" stroke="#fff" stroke-opacity=".75" stroke-width="${r > 2.5 ? .9 : .6}"/>` +
    aC(x - r * .35, y - r * .35, Math.max(.4, f1(r * .28)), "#fff", `opacity=".9"`);
  function bubbles(seed, n, x0 = 0, x1 = 120, y0 = 4, y1 = 120, rmax = 3.6) {
    const R = aRand(seed); let s = "";
    for (let i = 0; i < n; i++) s += bubble(x0 + R() * (x1 - x0), y0 + R() * (y1 - y0), 1 + R() * (rmax - 1));
    return s;
  }
  function fish(x, y, sc, c, flip = false, stripe = "") {
    return `<g transform="translate(${x} ${y}) scale(${flip ? -sc : sc} ${sc})"><path d="M-8,0 Q-2,-6 6,0 Q-2,6 -8,0Z" fill="${c}"/>` +
      `<path d="M-7,0 L-12,-4 L-11,0 L-12,4Z" fill="${c}"/>${stripe ? `<path d="M-1,-4 Q-3,0 -1,4" stroke="${stripe}" stroke-width="1.4" fill="none"/>` : ""}` +
      aC(2.6, -1, 1, "#fff") + aC(2.8, -1, .5, "#111") + `</g>`;
  }
  const kelp = (x, y, h, c = "#2e9e6a", sway = 5) => {
    let d = `M${x},${y}`;
    for (let i = 1; i <= 4; i++) d += ` Q${x + (i % 2 ? sway : -sway)},${y - h * (i - .5) / 4} ${x},${y - h * i / 4}`;
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>` +
      [...Array(4)].map((_, i) => `<ellipse cx="${x + (i % 2 ? 3.5 : -3.5)}" cy="${f1(y - h * (i + .6) / 4)}" rx="3.6" ry="1.6" fill="${c}" transform="rotate(${i % 2 ? -30 : 30} ${x + (i % 2 ? 3.5 : -3.5)} ${f1(y - h * (i + .6) / 4)})"/>`).join("");
  };
  function coral(x, y, s, c) {
    const br = [[[0, 0], [0, -10], [-5, -16], [-6, -22]], [[0, -10], [5, -15], [6, -23]], [[0, -5], [-7, -9], [-10, -13]], [[0, -5], [7, -6], [10, -10]]];
    return `<g transform="translate(${x} ${y}) scale(${s})">` + br.map(b => `<polyline points="${aPts(b)}" fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`).join("") + `</g>`;
  }
  const fanCoral = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0,0 L-13,-10 Q-12,-22 0,-24 Q12,-22 13,-10Z" fill="${c}"/>` +
    `<path d="M0,0 L-8,-20 M0,0 V-22 M0,0 L8,-20 M0,0 L-12,-13 M0,0 L12,-13 M-11,-16 Q0,-11 11,-16 M-7,-8 Q0,-4 7,-8" stroke="#fff" stroke-width=".9" opacity=".45" fill="none"/>` +
    `<rect x="-1.2" y="-1" width="2.4" height="4" fill="${c}"/></g>`;
  const starfish = (x, y, s, c = "#ff8a50") => `<g transform="translate(${x} ${y}) scale(${s} ${s * .7})"><polygon points="${aPts([...Array(10)].map((_, i) => { const r = i % 2 ? 2.4 : 6, a = -Math.PI / 2 + i * Math.PI / 5; return [r * Math.cos(a), r * Math.sin(a)]; }))}" fill="${c}" stroke-linejoin="round" stroke="${c}" stroke-width="1.4"/></g>`;
  const rock = (x, y, w, h, c = "#7d8fa8") => `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${h}" fill="${c}"/>`;
  // the Octopod, the crew's base: a round white HQ with an orange band of portholes, a glass dome on top with its mast,
  // and curling tube legs like an octopus, each ending in a launch pod (local size about 64 x 62 at s = 1)
  function octopod(x, y, s) {
    const legs = [[-30, 30, -14], [-19, 34, -8], [-7, 36, -3], [7, 36, 3], [19, 34, 8], [30, 30, 14]];
    const cp = U("opod");
    return `<g transform="translate(${x} ${y}) scale(${s})">` +
      legs.map(([px, py, sx]) => `<path d="M${sx},8 Q${f1(px * .8)},${py - 18} ${px},${py}" fill="none" stroke="${OL}" stroke-width="7.6" stroke-linecap="round"/>` +
        `<path d="M${sx},8 Q${f1(px * .8)},${py - 18} ${px},${py}" fill="none" stroke="#dfe6ea" stroke-width="5.4" stroke-linecap="round"/>`).join("") +
      legs.map(([px, py]) => `<ellipse cx="${px}" cy="${py + 1}" rx="6" ry="4.6" fill="#fafafa" ${A_OUT}/><path d="M${px - 5.6},${py + 1} Q${px},${py + 6} ${px + 5.6},${py + 1} Q${px + 5},${py + 5.6} ${px},${py + 5.6} Q${px - 5},${py + 5.6} ${px - 5.6},${py + 1}Z" fill="#f57c1f"/>` +
        aC(px, py, 1.8, "#4fc3f7", `stroke="${OL}" stroke-width=".7"`)).join("") +
      // the dome and its mast, then the round HQ over them
      `<path d="M0,-30 V-40" stroke="${OL}" stroke-width="3"/><path d="M0,-30 V-40" stroke="#cfd8dc" stroke-width="1.6"/>` + aC(0, -41, 2.6, "#ff5a36", A_OUT) +
      `<path d="M-13,-15 Q-13,-31 0,-31 Q13,-31 13,-15Z" fill="#8fe0ff" ${A_OUT}/><path d="M-8,-20 Q-7,-27 -1,-28" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>` +
      `<circle cx="0" cy="0" r="19" fill="#fafafa" ${A_OUT}/><defs><clipPath id="${cp}"><circle cx="0" cy="0" r="19"/></clipPath></defs>` +
      `<g clip-path="url(#${cp})"><path d="M8,-20 Q24,0 6,22 L24,22 L24,-20Z" fill="#cfd8dc"/><rect x="-20" y="-5" width="40" height="11" fill="#f57c1f" stroke="${OL}" stroke-width="1"/>` +
      `<path d="M-20,12 Q0,22 20,12 V22 H-20Z" fill="#b0bec5"/></g>` +
      [-11, 0, 11].map(dx => aC(dx, .5, 3.4, "#8fe0ff", `stroke="${OL}" stroke-width="1"`) + aC(dx - 1, -.6, 1, "#fff")).join("") +
      `<path d="M-13,-8 Q-11,-15 -4,-16" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></g>`;
  }
  // backdrop: gradient water, light shafts, (Octopod), sea floor with coral and kelp, fish, bubbles
  function sea(o = {}) {
    const g = U("osea"), R = aRand(o.seed || 7);
    const fy = o.floor || 140;
    let s = `<defs>${aVGrad(g, o.top || "#5fd0f3", o.bot || "#0f4c9e")}</defs><rect width="120" height="158" fill="url(#${g})"/>`;
    s += `<g opacity=".13" fill="#fff">` + [[6, -10], [40, 30], [78, 74], [104, 112]].map(([a, b]) => `<polygon points="${a},0 ${a + 12},0 ${b + 18},158 ${b},158"/>`).join("") + `</g>`;
    if (o.fish !== false) {
      const fc = o.fishCols || ["#ffd54f", "#ff8a65", "#80deea"];
      for (let i = 0; i < (o.nFish || 3); i++) s += fish(8 + R() * 104, 12 + R() * 70, .5 + R() * .35, fc[i % fc.length], R() < .5, i % 2 ? "#fff" : "");
    }
    s += kelp(o.kelpL ?? 9, fy + 4, o.kelpH || 46, "#2b9a68") + kelp(o.kelpR ?? 112, fy + 4, (o.kelpH || 46) * .8, "#36ad79", 4);
    s += `<path d="M0,${fy} Q20,${fy - 5} 42,${fy - 1} T84,${fy - 1} T120,${fy - 3} V158 H0Z" fill="${o.sand || "#f1d293"}"/>` +
      `<path d="M0,${fy + 6} Q30,${fy + 2} 60,${fy + 7} T120,${fy + 5} V158 H0Z" fill="${o.sand2 || "#e3bd72"}"/>`;
    const cx1 = 14 + R() * 10, cx2 = 96 + R() * 10;
    s += coral(cx1, fy + 2, .7 + R() * .2, o.coralA || "#ff7f8e") + fanCoral(cx2, fy + 1, .65 + R() * .2, o.coralB || "#ba68c8") + rock(30, fy + 3, 6, 3) + rock(86, fy + 5, 5, 2.6, "#8c9db6") + starfish(o.starX ?? 50 + R() * 40, fy + 9, .9);
    s += bubbles((o.seed || 7) * 13 + 1, o.nBub || 9, 2, 118, 6, fy - 6);
    return s;
  }
  const shadow = (x = 60, y = 143, rx = 30) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="4" fill="#06204a" opacity=".3"/>`;

  /* ---------- crew pieces ---------- */
  // the octopus badge: a gold disc with a little orange octopus
  function badge(x, y, r) {
    const k = r / 6;
    return `<g transform="translate(${x} ${y}) scale(${k})">` + aC(0, 0, 6, "#ffd23f", `stroke="${OL}" stroke-width="${f1(1 / k)}"`) +
      `<path d="M-3.2,.6 Q-3.4,-4 0,-4.2 Q3.4,-4 3.2,.6Z" fill="#f26b21"/>` +
      [-2.6, -.9, .9, 2.6].map(dx => `<path d="M${dx * .9},.4 Q${dx * 1.2},2.6 ${dx * 1.45},3.6" stroke="#f26b21" stroke-width="1.2" fill="none" stroke-linecap="round"/>`).join("") +
      aC(-1.2, -1.6, .55, "#fff") + aC(1.2, -1.6, .55, "#fff") + `</g>`;
  }
  // small shiny eyes (the show's dot eyes) and a simple smile
  const dotEye = (x, y, s = 1) => `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(2.5 * s)}" ry="${f1(3.4 * s)}" fill="#1b1b1b"/>` + aC(x - .7 * s, y - 1.3 * s, f1(.95 * s), "#fff");
  const smile = (x, y, w, c = OL, sw = 1.3) => `<path d="M${x - w},${y} Q${x},${y + w * .9} ${x + w},${y}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
  const openSmile = (x, y, w, h) => `<path d="M${x - w},${y} Q${x},${y + h * 2} ${x + w},${y}Z" fill="#b8323b" stroke="${OL}" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="M${x - w * .45},${y + h * .9} Q${x},${y + h * .55} ${x + w * .45},${y + h * .9} Q${x},${y + h * 1.25} ${x - w * .45},${y + h * .9}Z" fill="#ff8a8a"/>`;
  const cheek = (x, y, r = 3.2, c = "#ff9e9e") => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${f1(r * .62)}" fill="${c}" opacity=".7"/>`;
  // the uniform: a round navy body with a coloured collar, the badge, a belt; legs with boots
  function suit(cx, y0, y1, w, accent = SUIT, o = {}) {
    const top = y0, bot = y1, hw = w / 2, cp = U("osu");
    let s = `<path d="M${cx - hw * .78},${top} Q${cx - hw * 1.08},${(top + bot) / 2} ${cx - hw},${bot - 4} Q${cx},${bot + 5} ${cx + hw},${bot - 4} Q${cx + hw * 1.08},${(top + bot) / 2} ${cx + hw * .78},${top}Z" fill="${o.col || NAVY}" ${A_OUT}/>`;
    s += `<defs><clipPath id="${cp}"><path d="M${cx - hw * .78},${top} Q${cx - hw * 1.08},${(top + bot) / 2} ${cx - hw},${bot - 4} Q${cx},${bot + 5} ${cx + hw},${bot - 4} Q${cx + hw * 1.08},${(top + bot) / 2} ${cx + hw * .78},${top}Z"/></clipPath></defs>`;
    s += `<g clip-path="url(#${cp})"><path d="M${cx + hw * .45},${top} Q${cx + hw * 1.1},${(top + bot) / 2} ${cx + hw * .7},${bot + 4} L${cx + hw * 1.3},${bot + 4} L${cx + hw * 1.3},${top}Z" fill="${o.shade || NAVY2}" opacity=".7"/>` +
      (o.belly ? `<ellipse cx="${cx}" cy="${(top + bot) / 2 + 3}" rx="${hw * .55}" ry="${(bot - top) * .42}" fill="${o.belly}"/>` : "") +
      (o.belt !== false ? `<rect x="${cx - hw * 1.2}" y="${bot - 9}" width="${w * 1.2}" height="3.4" fill="${o.beltCol || accent}" stroke="${OL}" stroke-width=".8"/>` : "") + `</g>`;
    s += `<path d="M${cx - hw * .8},${top + .5} Q${cx},${top + 8} ${cx + hw * .8},${top + .5}" fill="none" stroke="${OL}" stroke-width="5.2" stroke-linecap="round"/>` +
      `<path d="M${cx - hw * .8},${top + .5} Q${cx},${top + 8} ${cx + hw * .8},${top + .5}" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`;
    if (o.badge !== false) s += badge(o.bx ?? cx - hw * .38, o.by ?? top + 12, o.br || 4.6);
    return s;
  }
  const boot = (x, y, c = "#1a1a1a", rot = 0) => `<ellipse cx="${x}" cy="${y}" rx="7" ry="4.2" fill="${c}" ${A_OUT} transform="rotate(${rot} ${x} ${y})"/><ellipse cx="${x - 2}" cy="${y - 1.6}" rx="2.6" ry="1" fill="#fff" opacity=".35" transform="rotate(${rot} ${x} ${y})"/>`;
  const leg = (pts, c = NAVY, w = 7) => aL(pts, c, w);
  const paw = (x, y, r, c, extra = "") => aC(x, y, r, c, `${A_OUT} ${extra}`);

  /* ---------- 1 Captain Barnacles: polar bear, captain's hat, pointing ahead ---------- */
  function barnacles() {
    const W = "#fbfcfd", WS = "#dde6ee";
    const body = leg([[50, 120], [47, 133]]) + leg([[67, 120], [70, 133]]) + boot(45, 136, "#1a1a1a", -6) + boot(72, 136, "#1a1a1a", 6) +
      aL([[42, 88], [33, 100], [36, 112]], NAVY, 8) + paw(37, 113, 5.2, W) +              // arm on the hip side
      suit(58, 80, 126, 40) +
      aL([[74, 88], [90, 80], [104, 70]], NAVY, 8) + paw(106, 68.5, 5.6, W) +             // pointing arm
      `<path d="M108,64.5 Q115,60 116.5,62.5 Q116,65.5 110,68" fill="${W}" ${A_OUT} stroke-linejoin="round"/>` +
      `<path d="M101.5,69 q2,-2 4,-1" fill="none" stroke="${OL}" stroke-width=".8"/>`;
    const head =
      aC(33, 34, 8, W, A_OUT) + aC(33, 34, 4.4, "#e8d6d6") + aC(85, 34, 8, W, A_OUT) + aC(85, 34, 4.4, "#e8d6d6") +
      `<ellipse cx="59" cy="54" rx="30" ry="27" fill="${W}" ${A_OUT}/>` +
      `<path d="M78,34 Q92,48 84,70 Q76,79 62,81 Q82,70 78,34Z" fill="${WS}"/>` +
      `<ellipse cx="59" cy="64" rx="13" ry="10" fill="#f1f4f7" stroke="${WS}" stroke-width="1"/>` +
      `<ellipse cx="59" cy="58.6" rx="5.4" ry="3.7" fill="#1b1b1b"/><ellipse cx="57.6" cy="57.5" rx="1.6" ry=".9" fill="#fff" opacity=".7"/>` +
      `<path d="M59,62.2 V65.5" stroke="${OL}" stroke-width="1"/>` + smile(59, 65.5, 5, OL, 1.3) +
      dotEye(48.5, 51.5, 1.1) + dotEye(69.5, 51.5, 1.1) + `<path d="M44.5,44.5 Q48.5,42 52.5,44" stroke="${OL}" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M65.5,44 Q69.5,42 73.5,44.5" stroke="${OL}" stroke-width="1.3" fill="none" stroke-linecap="round"/>` +
      cheek(42, 60) + cheek(76, 60) +
      // captain's hat: navy crown, white band, black peak, the badge in front
      `<path d="M35,36 Q33,16 59,13 Q85,16 83,36 Q59,30 35,36Z" fill="${NAVY}" ${A_OUT}/>` +
      `<path d="M70,15 Q83,18 83,36 Q78,33.5 73,33 Q76,22 70,15Z" fill="${NAVY2}"/>` +
      `<path d="M35.5,33 Q59,26.5 82.5,33 L83,37 Q59,31 35,37Z" fill="#fff" stroke="${OL}" stroke-width=".9"/>` +
      `<path d="M37,37 Q59,30.5 81,37 Q78,43 59,40.5 Q40,43 37,37Z" fill="#141414" ${A_OUT}/>` +
      `<path d="M44,38 Q59,34.5 72,37.5" stroke="#fff" stroke-width=".9" opacity=".35" fill="none"/>` +
      badge(59, 24, 5.8);
    return [sea({ seed: 11, nFish: 2, starX: 92 }) + A_RAYS + shadow(60, 142, 30) + aSpark(108, 52, 4) + aSpark(14, 70, 3) + aSpark(104, 30, 3, "#fffde7"),
      aEdge(body + head)];
  }

  /* ---------- 2 Kwazii: ginger pirate cat, eye patch, gold earring, ear tufts ---------- */
  function kwazii() {
    const O = "#f7931e", OD = "#d86a12", CR = "#ffe3b8";
    const tail = `<path d="M74,118 Q98,124 102,104 Q105,88 96,82" fill="none" stroke="${OL}" stroke-width="9.4" stroke-linecap="round"/>` +
      `<path d="M74,118 Q98,124 102,104 Q105,88 96,82" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M96.5,113 l4,2.5 M101.6,101 l4.2,.4 M100.5,90 l4,-1.6" stroke="${OD}" stroke-width="2.2" stroke-linecap="round"/>`;
    const body = tail + leg([[51, 120], [44, 132]]) + leg([[66, 120], [72, 132]]) + boot(41, 135, "#1a1a1a", -14) + boot(76, 135, "#1a1a1a", 12) +
      aL([[44, 90], [34, 99], [30, 108]], NAVY, 8) + paw(30, 110, 5, O) +
      suit(58, 82, 126, 38) +
      aL([[72, 89], [88, 84], [99, 72]], NAVY, 8) + paw(101, 69, 5.8, O) +              // fist punching up: "Yeow!"
      `<path d="M97.5,66.5 q3,-2 6.5,0 M97.5,69.5 q3,-1.5 7,0" stroke="${OL}" stroke-width=".8" fill="none"/>`;
    const ear = (pts, tuft, inner) => `<polygon points="${pts}" fill="${O}" ${A_OUT} stroke-linejoin="round"/><polygon points="${inner}" fill="#ffb38a"/>` +
      `<path d="${tuft}" fill="${O}" ${A_OUT} stroke-linejoin="round"/>`;
    const head =
      ear("30,46 32,20 52,34", "M32,22 L29,13 L33.5,19 L34,11 L36,21Z", "34,40 34.5,26 46,34") +
      ear("88,46 86,20 66,34", "M86,22 L89,13 L84.5,19 L84,11 L82,21Z", "84,40 83.5,26 72,34") +
      `<ellipse cx="59" cy="56" rx="31" ry="26" fill="${O}" ${A_OUT}/>` +
      `<path d="M47,31 Q52,24 55,31 Q58,22 62,30 Q66,24 70,31" fill="${O}" ${A_OUT} stroke-linejoin="round"/>` +    // head tuft
      `<path d="M52,32 l1.2,7 M59,31 v8 M66,32 l-1.2,7" stroke="${OD}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M28.5,56 h6 M29,61 h5 M89.5,56 h-6 M89,61 h-5" stroke="${OD}" stroke-width="2.2" stroke-linecap="round"/>` +
      `<path d="M80,36 Q93,52 86,70 Q78,80 62,82 Q84,68 80,36Z" fill="${OD}" opacity=".35"/>` +
      `<ellipse cx="59" cy="66" rx="15" ry="10" fill="${CR}"/>` +
      `<path d="M55.5,61 Q59,59.5 62.5,61 Q59,65 55.5,61Z" fill="#e8577a" stroke="${OL}" stroke-width=".9" stroke-linejoin="round"/>` +
      `<path d="M59,63.5 V66 M52,67 Q55.5,70.5 59,66.5 Q62.5,70.5 66,67" fill="none" stroke="${OL}" stroke-width="1.2" stroke-linecap="round"/>` +
      `<path d="M53,67.5 Q59,77 65,67.5Z" fill="#b8323b" stroke="${OL}" stroke-width=".9"/><path d="M55.5,68.5 l1.3,2.6 l1.1,-2.4Z" fill="#fff"/>` +
      `<path d="M44,64 l-12,-2 M44,67 l-12,2 M74,64 l12,-2 M74,67 l12,2" stroke="${OL}" stroke-width=".7" stroke-linecap="round"/>` +
      dotEye(47.5, 52, 1.15) + `<path d="M43,44.5 Q47,42 51.5,44.5" stroke="${OL}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
      // eye patch (his left eye) and its strap
      `<path d="M33,40 Q60,36 87,48" fill="none" stroke="#141414" stroke-width="1.8"/>` +
      `<ellipse cx="70.5" cy="52" rx="7" ry="6.2" fill="#141414" ${A_OUT}/><path d="M66.5,49 Q69,47 72,47.5" stroke="#fff" stroke-width="1" opacity=".35" fill="none"/>` +
      // gold hoop earring in his right ear
      `<circle cx="36" cy="44.5" r="3.6" fill="none" stroke="${OL}" stroke-width="2.6"/><circle cx="36" cy="44.5" r="3.6" fill="none" stroke="#ffcc33" stroke-width="1.6"/>` +
      cheek(41, 63);
    const chest = `<path d="M10,138 l4,-12 h22 l4,12Z" fill="#8d5524" ${A_OUT}/><path d="M12,126 q14,-9 26,0Z" fill="#a0652d" ${A_OUT}/><rect x="22" y="128" width="6" height="5" fill="#ffcc33" stroke="${OL}" stroke-width=".8"/>` +
      aC(16, 124.5, 1.6, "#ffd54f") + aC(33, 124, 1.3, "#ffd54f") + aSpark(24, 120, 3, "#fff59d");
    return [sea({ seed: 23, top: "#4fc3f7", bot: "#14569b", nFish: 3, kelpL: 7, kelpR: 113 }) + chest + shadow(60, 142, 28) + aSpark(104, 44, 4) + aSpark(18, 40, 3.2),
      aEdge(body + head)];
  }

  /* ---------- 3 Peso: little penguin medic with his blue medical bag ---------- */
  function peso() {
    const BK = "#1f2430", BKS = "#3a4152";
    const bag = `<path d="M81,103 Q81,94 91,94 Q101,94 101,103" fill="none" stroke="${OL}" stroke-width="3.4"/><path d="M81,103 Q81,94 91,94 Q101,94 101,103" fill="none" stroke="#1e64c8" stroke-width="1.8"/>` +
      `<rect x="74" y="101" width="34" height="25" rx="6" fill="#3a8ee6" ${A_OUT}/><rect x="74" y="101" width="34" height="6" rx="3" fill="#1e64c8"/>` +
      `<path d="M88,110 h6 v-4 h0 M88,110" fill="none"/><rect x="88.3" y="108" width="5.4" height="15" rx="1" fill="#fff"/><rect x="83.5" y="112.8" width="15" height="5.4" rx="1" fill="#fff"/>`;
    const body = leg([[50, 122], [48, 132]], NAVY, 6.5) + leg([[66, 122], [68, 132]], NAVY, 6.5) +
      `<ellipse cx="45" cy="136" rx="7.5" ry="3.6" fill="#ffa726" ${A_OUT}/><ellipse cx="71" cy="136" rx="7.5" ry="3.6" fill="#ffa726" ${A_OUT}/>` +
      `<path d="M46,93 Q29,93 16,80 Q11,73 18,72 Q30,81 47,85Z" fill="${BK}" ${A_OUT} stroke-linejoin="round"/>` +       // flipper up: waving hello
      `<path d="M20,75 Q30,84 40,87" stroke="${BKS}" stroke-width="1.6" fill="none" stroke-linecap="round"/>` +
      suit(58, 84, 128, 40) +
      `<path d="M74,92 Q84,98 84,108 Q80,110 76,104 Q74,100 72,98Z" fill="${BK}" ${A_OUT}/>` + bag;
    const head =
      `<ellipse cx="58" cy="55" rx="31" ry="30" fill="${BK}" ${A_OUT}/>` +
      `<path d="M36,32 Q46,24 58,26" stroke="${BKS}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
      // the white face: two round lobes meeting in a point at the top (heart-shaped)
      `<path d="M58,40 Q49,30 40,38 Q31,47 35,62 Q40,78 58,80 Q76,78 81,62 Q85,47 76,38 Q67,30 58,40Z" fill="#fff"/>` +
      dotEye(48, 53, 1.1) + dotEye(68, 53, 1.1) +
      `<path d="M43.5,44 Q48,41 52.5,43.5 M63.5,43.5 Q68,41 72.5,44" stroke="${OL}" stroke-width="1.3" fill="none" stroke-linecap="round"/>` +
      `<path d="M51.5,60 Q58,56 64.5,60 Q58,67 51.5,60Z" fill="#ffb300" ${A_OUT} stroke-linejoin="round"/><path d="M52,60.2 Q58,62.5 64,60.2" stroke="${OL}" stroke-width=".8" fill="none"/>` +
      openSmile(58, 69.5, 6, 3) +
      cheek(42, 64, 3.6) + cheek(74, 64, 3.6) +
      "";
    const wave = `<path d="M8,74 Q6,82 10,88 M12,66 Q16,62 22,63" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".9"/>`;
    return [sea({ seed: 37, top: "#7fdcf5", bot: "#1565c0", nFish: 3, fishCols: ["#ffee58", "#f48fb1", "#a5d6a7"] }) + shadow(60, 142, 32) + wave +
      aSpark(104, 30, 3.4, "#fffde7") + aSpark(100, 70, 2.8), aEdge(body + head)];
  }

  /* ---------- 4 Shellington: sea otter scientist with glasses and a magnifying glass ---------- */
  function shellington() {
    const B = "#9a6440", BD = "#6e4329", F = "#ecd2ab";
    const glass = `<path d="M92,96 L101,118" stroke="${OL}" stroke-width="6.6" stroke-linecap="round"/><path d="M92,96 L101,118" stroke="#8d4f20" stroke-width="4.4" stroke-linecap="round"/>` +
      `<circle cx="86" cy="82" r="14" fill="#d9f4ff" fill-opacity=".55" stroke="${OL}" stroke-width="5"/><circle cx="86" cy="82" r="14" fill="none" stroke="#bfc6cc" stroke-width="3"/>` +
      // the starfish he is studying, seen big through the lens
      `<g transform="translate(86 83) rotate(12)"><polygon points="${aPts([...Array(10)].map((_, i) => { const r = i % 2 ? 3.6 : 9, a = -Math.PI / 2 + i * Math.PI / 5; return [r * Math.cos(a), r * Math.sin(a)]; }))}" fill="#ff7043" stroke="${OL}" stroke-width=".9" stroke-linejoin="round"/>` +
      aC(-2, -1, .8, "#fff") + aC(2, -1, .8, "#fff") + aC(0, 2.5, .7, "#ffd54f") + aC(-5, 1, .6, "#ffd54f") + aC(5, 1, .6, "#ffd54f") + `</g>` +
      `<path d="M77,74 Q81,70 86,70" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".85"/>`;
    const tail = `<path d="M70,124 Q90,132 98,140 Q84,142 66,130Z" fill="${BD}" ${A_OUT} stroke-linejoin="round"/>`;
    const body = tail + leg([[49, 122], [46, 133]]) + leg([[64, 122], [67, 133]]) +
      boot(43, 136, "#1a1a1a", -6) + boot(70, 136, "#1a1a1a", 6) +
      aL([[40, 92], [30, 104], [34, 113]], NAVY, 7.5) + paw(35, 114, 4.8, B) +
      suit(56, 84, 128, 38) +
      aL([[71, 92], [83, 103], [93, 105]], NAVY, 7.5) + glass + paw(95, 104.5, 5, B) + `<path d="M92.5,102.5 q3,-1.6 5.6,.4 M92.5,105.5 q3,-1.2 5.8,.6" stroke="${OL}" stroke-width=".8" fill="none"/>`;
    const head =
      aC(33, 40, 6, B, A_OUT) + aC(33, 40, 3, BD) + aC(81, 40, 6, B, A_OUT) + aC(81, 40, 3, BD) +
      `<ellipse cx="57" cy="57" rx="28" ry="27" fill="${B}" ${A_OUT}/>` +
      `<path d="M74,36 Q88,52 80,72 Q72,82 60,84 Q78,70 74,36Z" fill="${BD}" opacity=".4"/>` +
      // pale face around the eyes and the muzzle
      `<path d="M57,44 Q44,42 37,52 Q32,64 40,74 Q48,82 57,82 Q66,82 74,74 Q82,64 77,52 Q70,42 57,44Z" fill="${F}"/>` +
      `<path d="M50,36 q7,-6 14,0" stroke="${BD}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` +
      `<ellipse cx="57" cy="67" rx="11" ry="7.5" fill="#f8e7cc"/>` +
      `<ellipse cx="57" cy="62.4" rx="4.6" ry="3.1" fill="#3b2314"/><ellipse cx="55.8" cy="61.5" rx="1.4" ry=".8" fill="#fff" opacity=".6"/>` +
      `<path d="M57,65.5 V68 M52,68.5 Q54.5,71 57,68 Q59.5,71 62,68.5" fill="none" stroke="${OL}" stroke-width="1.1" stroke-linecap="round"/>` +
      aC(50, 70, .7, BD) + aC(48, 68.4, .7, BD) + aC(64, 70, .7, BD) + aC(66, 68.4, .7, BD) +
      `<path d="M47,68 l-12,-2.5 M47,70.5 l-12,1 M67,68 l12,-2.5 M67,70.5 l12,1" stroke="${OL}" stroke-width=".7" stroke-linecap="round"/>` +
      dotEye(47.5, 54, 1.05) + dotEye(66.5, 54, 1.05) +
      // glasses: two round lenses and a bridge, a light glint
      `<circle cx="47.5" cy="54" r="7" fill="#e3f6ff" fill-opacity=".25" stroke="#2b2b2b" stroke-width="1.6"/><circle cx="66.5" cy="54" r="7" fill="#e3f6ff" fill-opacity=".25" stroke="#2b2b2b" stroke-width="1.6"/>` +
      `<path d="M54.5,53.5 Q57,51.5 59.5,53.5 M40.5,52.5 L35,50 M73.5,52.5 L79,50" stroke="#2b2b2b" stroke-width="1.5" fill="none"/>` +
      `<path d="M43,50.5 l3,-2.6 M62,50.5 l3,-2.6" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".8"/>` + cheek(40, 65, 2.8) + cheek(74, 65, 2.8);
    return [sea({ seed: 51, top: "#6fd6e8", bot: "#0f6aa6", nFish: 2, coralA: "#ff8a65" }) + shadow(58, 142, 30) + aSpark(104, 56, 3.6) + aSpark(14, 48, 3),
      aEdge(body + head)];
  }

  /* ---------- 5 Dashi: dachshund photographer, side view on all fours: long low body, long snout, floppy ear, camera ---------- */
  function dashi() {
    const T = "#cf9050", TD = "#a8692f", E = "#7a4520", M = "#f3d3a4", cp = U("oda");
    const tail = `<path d="M24,100 Q10,94 11,72" fill="none" stroke="${OL}" stroke-width="7.6" stroke-linecap="round"/><path d="M24,100 Q10,94 11,72" fill="none" stroke="${T}" stroke-width="5.4" stroke-linecap="round"/>`;
    const dboot = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="6" ry="3.8" fill="#1a1a1a" ${A_OUT}/><ellipse cx="${x - 1.6}" cy="${y - 1.4}" rx="2.2" ry=".9" fill="#fff" opacity=".35"/>`;
    const B = "M24,96 Q20,87 34,86 L78,84 Q101,83 101,102 Q101,122 83,122 L34,124 Q17,124 17,110 Q17,101 24,96Z";
    const body = tail +
      // far legs (darker), the neck, the long sausage body in the uniform, the near legs
      leg([[42, 116], [43, 127]], NAVY2, 7) + dboot(46, 130) + leg([[92, 114], [93, 127]], NAVY2, 7) + dboot(97, 130) +
      `<path d="M66,94 Q63,70 69,58 L88,58 Q92,78 99,96Z" fill="${T}" ${A_OUT}/>` +
      `<path d="${B}" fill="${NAVY}" ${A_OUT}/><defs><clipPath id="${cp}"><path d="${B}"/></clipPath></defs>` +
      `<g clip-path="url(#${cp})"><path d="M10,113 Q60,119 108,106 V130 H10Z" fill="${NAVY2}" opacity=".75"/>` +
      `<path d="M37,82 Q33,104 37,128" stroke="${OL}" stroke-width="5.4" fill="none"/><path d="M37,82 Q33,104 37,128" stroke="${SUIT}" stroke-width="3.4" fill="none"/></g>` +
      badge(84, 101, 5.2) +
      `<path d="M66,85 Q82,92 99,88" fill="none" stroke="${OL}" stroke-width="5.4" stroke-linecap="round"/><path d="M66,85 Q82,92 99,88" fill="none" stroke="${SUIT}" stroke-width="3.2" stroke-linecap="round"/>` +
      leg([[28, 118], [28, 129]], NAVY, 7.4) + dboot(31, 133) + leg([[79, 118], [79, 129]], NAVY, 7.4) + dboot(82, 133);
    // the camera hanging from its strap on her chest, lens to the front
    const cam = `<path d="M70,80 Q80,93 93,91" fill="none" stroke="${OL}" stroke-width="2.6"/><path d="M70,80 Q80,93 93,91" fill="none" stroke="#c77dff" stroke-width="1.4"/>` +
      `<rect x="91" y="87" width="25" height="18" rx="3.5" fill="#3c4048" ${A_OUT}/><rect x="95" y="83.5" width="8" height="4.5" rx="1.2" fill="#3c4048" ${A_OUT}/>` +
      `<rect x="91" y="91.5" width="25" height="2" fill="#b0bec5" opacity=".5"/><rect x="109" y="89" width="5" height="3" rx="1" fill="#fff59d" stroke="${OL}" stroke-width=".6"/>` +
      aC(102.5, 97, 7, "#24272d", A_OUT) + aC(102.5, 97, 4.8, "#3a6ea8") + aC(102.5, 97, 2.4, "#0f2546") + aC(101, 95.4, 1.3, "#fff");
    const head =
      `<path d="M50,46 Q46,19 70,20 Q89,21 91,36 Q100,40 110,44 Q118,48 116,56 Q113,64 101,64 Q88,67 76,66 Q54,67 50,46Z" fill="${T}" ${A_OUT}/>` +
      `<path d="M84,44 Q98,45 110,48 Q117,52 114,58 Q109,64 98,64 Q86,65 80,59 Q78,50 84,44Z" fill="${M}"/>` +
      `<path d="M60,27 Q69,22 80,24" stroke="${TD}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".7"/>` +
      `<ellipse cx="112.4" cy="48.6" rx="4.4" ry="3.5" fill="#1b1b1b"/><ellipse cx="111.2" cy="47.4" rx="1.5" ry=".9" fill="#fff" opacity=".7"/>` +
      `<path d="M111.5,52 Q111,55 107.5,57.5" fill="none" stroke="${OL}" stroke-width="1.1" stroke-linecap="round"/>` +
      `<path d="M91,57 Q99,65 107.5,57.5 Q99,59.6 91,57Z" fill="#b8323b" stroke="${OL}" stroke-width=".9" stroke-linejoin="round"/><path d="M96,59.6 Q99,62.6 102,59.8Z" fill="#ff8a8a"/>` +
      dotEye(79, 39, 1.35) + `<path d="M74,30 Q79.5,27 85,30" stroke="${OL}" stroke-width="1.4" fill="none" stroke-linecap="round"/>` + cheek(87, 52, 3.4) +
      // the long floppy ear hanging over the back of the head
      `<path d="M64,29 Q49,28 47,46 Q45,68 52,80 Q60,86 65,75 Q69,58 72,40 Q71,31 64,29Z" fill="${E}" ${A_OUT} stroke-linejoin="round"/>` +
      `<path d="M62,38 Q55,52 57,72" stroke="#5e3416" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>`;
    const flash = aC(111, 77, 5, "#fffde7", `opacity=".55"`) + aStar(111, 77, 9, "#fffde7") + aSpark(111, 77, 4.6, "#fff");
    const wag = `<path d="M4,66 Q2,74 5,80 M8,60 Q12,56 17,58" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".85"/>`;
    return [sea({ seed: 67, top: "#82e0f0", bot: "#1a5fb4", nFish: 3, fishCols: ["#ff8a65", "#fff176", "#ce93d8"], coralA: "#ff6f91", coralB: "#ffb74d" }) +
      shadow(60, 137, 44) + wag + flash + aSpark(40, 50, 3.2) + aSpark(100, 20, 2.6), aEdge(body + head + cam)];
  }

  /* ---------- 6 Tweak: white bunny engineer, green overalls, a big wrench ---------- */
  function tweak() {
    const W = "#fbfbfb", WS = "#dfe5ea", G = "#43a047", GD = "#2e7d32";
    // the wrench held up high: open jaw at the top, a ring at the bottom (local coords, jaw at y -26)
    const wrench = `<g transform="translate(25 68) rotate(-16)"><rect x="-3.5" y="-20" width="7" height="38" rx="3" fill="#b0bec5" ${A_OUT}/><rect x="-2" y="-18" width="2" height="34" rx="1" fill="#eceff1"/>` +
      `<path d="M-8,-20 Q-8,-32 0,-34 L0,-26 L3.5,-26 L3.5,-34 Q11,-32 9,-20 Q4,-16 -4,-16Z" fill="#b0bec5" ${A_OUT} stroke-linejoin="round"/>` +
      `<path d="M-7,16 Q-7,26 0,28 Q7,26 7,16 Q4,12 -4,12Z" fill="#b0bec5" ${A_OUT}/>` + aC(0, 20, 3, "#455a64") + `</g>`;
    const body = leg([[50, 122], [48, 133]], G, 7) + leg([[66, 122], [68, 133]], G, 7) + boot(45, 136, "#1a1a1a", -6) + boot(71, 136, "#1a1a1a", 6) +
      suit(58, 84, 128, 40, SUIT, { badge: false, belt: false }) +
      // the green overalls: bib with two straps and a pocket, a tool belt
      `<path d="M44,98 H72 L76,124 Q58,132 40,124Z" fill="${G}" ${A_OUT} stroke-linejoin="round"/>` +
      `<path d="M66,98 H72 L76,124 Q70,127 64,128Z" fill="${GD}" opacity=".6"/>` +
      `<path d="M45,99 L41,86 M71,99 L75,86" stroke="${OL}" stroke-width="4.6" stroke-linecap="round"/><path d="M45,99 L41,86 M71,99 L75,86" stroke="${G}" stroke-width="2.8" stroke-linecap="round"/>` +
      aC(46, 100, 1.8, "#ffd54f", `stroke="${OL}" stroke-width=".6"`) + aC(70, 100, 1.8, "#ffd54f", `stroke="${OL}" stroke-width=".6"`) +
      `<rect x="51" y="103" width="14" height="10" rx="2" fill="${GD}" stroke="${OL}" stroke-width=".8"/>` + badge(58, 108, 3.6) +
      `<rect x="40" y="117" width="36" height="4" fill="#8d6e63" stroke="${OL}" stroke-width=".8"/><rect x="48" y="119" width="5" height="7" rx="1" fill="#6d4c41" stroke="${OL}" stroke-width=".7"/><rect x="63" y="119" width="5" height="7" rx="1" fill="#6d4c41" stroke="${OL}" stroke-width=".7"/>` +
      aL([[74, 92], [86, 100], [96, 94]], NAVY, 7.5) + paw(97, 92, 5, W) +            // a thumbs-up
      `<path d="M95,88 q0,-7 4,-7 q2,0 1.4,5" fill="${W}" ${A_OUT}/>` +
      wrench + aL([[42, 92], [32, 86], [27, 74]], NAVY, 7.5) + paw(26, 71, 5, W);
    const ear = (x, rot) => `<g transform="rotate(${rot} ${x} 40)"><ellipse cx="${x}" cy="24" rx="8.5" ry="19" fill="${W}" ${A_OUT}/><ellipse cx="${x}" cy="26" rx="4.4" ry="13.5" fill="#f8bbd0"/></g>`;
    const head = ear(46, -12) + ear(71, 12) +
      `<ellipse cx="58" cy="60" rx="27" ry="24" fill="${W}" ${A_OUT}/>` +
      `<path d="M74,42 Q88,58 78,76 Q70,84 60,84 Q78,70 74,42Z" fill="${WS}"/>` +
      `<path d="M45,40 Q50,30 56,38 Q58,30 63,38" fill="${W}" ${A_OUT} stroke-linejoin="round"/>` +
      dotEye(48, 57, 1.1) + dotEye(68, 57, 1.1) + `<path d="M44,49.5 Q48,47 52,49 M64,49 Q68,47 72,49.5" stroke="${OL}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
      `<path d="M55,65 Q58,63.5 61,65 Q58,68.5 55,65Z" fill="#f06292" stroke="${OL}" stroke-width=".9" stroke-linejoin="round"/>` +
      `<path d="M58,67.5 V69.5 M52,69.5 Q55,72.5 58,69.5 Q61,72.5 64,69.5" fill="none" stroke="${OL}" stroke-width="1.1" stroke-linecap="round"/>` +
      `<rect x="55.6" y="70.6" width="4.8" height="4.4" rx="1" fill="#fff" ${A_OUT}/><path d="M58,70.8 V75" stroke="${OL}" stroke-width=".6"/>` +
      `<path d="M46,67 l-12,-2 M46,70 l-12,1.5 M70,67 l12,-2 M70,70 l12,1.5" stroke="#8a8a8a" stroke-width=".7" stroke-linecap="round"/>` +
      cheek(41, 66, 3.6, "#ff8fb1") + cheek(75, 66, 3.6, "#ff8fb1") +
      // goggles pushed up on her forehead
      `<path d="M36,46 Q58,38 80,46" stroke="#5d4037" stroke-width="3" fill="none"/>` +
      aC(50, 43.5, 4.6, "#ffca28", A_OUT) + aC(50, 43.5, 2.8, "#80deea") + aC(66, 43.5, 4.6, "#ffca28", A_OUT) + aC(66, 43.5, 2.8, "#80deea") +
      aC(49, 42.5, .9, "#fff") + aC(65, 42.5, .9, "#fff");
    const gear = (x, y, r, c) => `<g transform="translate(${x} ${y})" opacity=".55">${[...Array(8)].map((_, i) => `<rect x="-1.6" y="${-r - 2}" width="3.2" height="4" fill="${c}" transform="rotate(${i * 45})"/>`).join("")}${aC(0, 0, r, c)}${aC(0, 0, r * .4, "#1b5e9a")}</g>`;
    return [sea({ seed: 79, top: "#5fd3e6", bot: "#115b95", nFish: 2, coralA: "#ffb74d", coralB: "#f06292" }) +
      gear(104, 30, 6, "#ffe082") + gear(106, 66, 4.5, "#b2dfdb") + shadow(58, 142, 30) + aSpark(14, 100, 3), aEdge(body + head)];
  }

  /* ---------- 7 Professor Inkling: Dumbo octopus, monocle, ear fins, a book ---------- */
  function inkling() {
    const P = "#f59a7d", PD = "#d9735a", PL = "#ffc2ad";
    const arm = (d) => `<path d="${d}" fill="none" stroke="${OL}" stroke-width="9.6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${P}" stroke-width="7.4" stroke-linecap="round"/>`;
    const tent = [
      "M44,104 Q30,116 22,112 Q16,108 20,104", "M50,108 Q42,126 34,132", "M58,110 Q56,128 50,138", "M66,110 Q70,128 76,136", "M74,106 Q86,122 96,126",
    ].map(arm).join("") + [[20, 104], [34, 132], [50, 138], [76, 136], [96, 126]].map(([x, y]) => aC(x, y, 1.3, PL)).join("");
    const book = `<g transform="rotate(-8 62 104)"><path d="M38,94 Q50,90 62,95 Q74,90 86,94 L86,116 Q74,112 62,117 Q50,112 38,116Z" fill="#8e2a2a" ${A_OUT} stroke-linejoin="round"/>` +
      `<path d="M40,92 Q51,88 62,93 L62,114 Q51,109 40,113Z" fill="#fffaf0" ${A_OUT}/><path d="M84,92 Q73,88 62,93 L62,114 Q73,109 84,113Z" fill="#fffaf0" ${A_OUT}/>` +
      [97, 101, 105].map(y => `<path d="M44,${y - 1} Q51,${y - 3.5} 58,${y}" stroke="#90a4ae" stroke-width=".9" fill="none"/><path d="M66,${y} Q73,${y - 3.5} 80,${y - 1}" stroke="#90a4ae" stroke-width=".9" fill="none"/>`).join("") +
      `<g transform="translate(73 106) scale(.5)">${fish(0, 0, 1, "#4fc3f7")}</g></g>`;
    const body = tent +
      // ear fins
      `<path d="M28,52 Q8,38 10,58 Q12,72 30,68Z" fill="${P}" ${A_OUT} stroke-linejoin="round"/><path d="M26,56 Q14,48 15,59 Q16,66 27,64Z" fill="${PD}" opacity=".5"/>` +
      `<path d="M92,52 Q112,38 110,58 Q108,72 90,68Z" fill="${P}" ${A_OUT} stroke-linejoin="round"/><path d="M94,56 Q106,48 105,59 Q104,66 93,64Z" fill="${PD}" opacity=".5"/>` +
      `<path d="M60,14 Q96,14 96,58 Q96,90 78,104 Q60,114 42,104 Q24,90 24,58 Q24,14 60,14Z" fill="${P}" ${A_OUT}/>` +
      `<path d="M80,22 Q100,48 88,86 Q80,102 64,108 Q86,84 80,22Z" fill="${PD}" opacity=".4"/>` +
      aC(42, 30, 3, PL) + aC(52, 23, 2, PL) + aC(76, 32, 2.4, PL) + aC(36, 44, 1.8, PL) +
      // bushy brows, eyes, the monocle on his left eye with its chain
      `<path d="M37,58 Q44,51 52,56" stroke="${OL}" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M68,56 Q76,51 83,58" stroke="${OL}" stroke-width="3.2" fill="none" stroke-linecap="round"/>` +
      dotEye(45, 66, 1.2) + dotEye(75, 66, 1.2) +
      `<circle cx="75" cy="66" r="8.4" fill="#e3f6ff" fill-opacity=".3" stroke="#f9c74f" stroke-width="2.2"/><circle cx="75" cy="66" r="9.6" fill="none" stroke="${OL}" stroke-width=".8"/>` +
      `<path d="M71,61 l3,-2.4" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>` +
      `<path d="M82,72 Q88,86 80,94" stroke="#f9c74f" stroke-width="1.2" fill="none" stroke-dasharray="1.6 1"/>` +
      smile(60, 80, 6, OL, 1.5) + cheek(38, 76, 3.8, "#ff7f7f") + cheek(82, 78, 3.4, "#ff7f7f") + book;
    const deep = sea({ seed: 91, top: "#3aa7d8", bot: "#0b2f6b", nFish: 2, fishCols: ["#80deea", "#ffd54f"], coralA: "#ff8a80", coralB: "#4db6ac" });
    return [deep + shadow(60, 143, 28) + aSpark(104, 24, 3.4) + aSpark(14, 92, 3), `<g class="lv-bob">${aEdge(body)}</g>`];
  }

  /* ---------- 8 Tunip: a Vegimal, round and turnip-like with a leafy top ---------- */
  function tunip() {
    const C = "#fbf3dc", CS = "#ecdcb4", PU = "#c779c9";
    const leaf = (rot, len, c) => `<g transform="rotate(${rot} 60 46)"><path d="M60,46 Q${60 - len * .38},${46 - len * .55} 60,${46 - len} Q${60 + len * .38},${46 - len * .55} 60,46Z" fill="${c}" ${A_OUT}/><path d="M60,44 V${46 - len * .8}" stroke="#1b5e20" stroke-width=".8" opacity=".6"/></g>`;
    const g = U("otu");
    const body =
      leaf(-38, 30, "#66bb6a") + leaf(38, 30, "#66bb6a") + leaf(-12, 36, "#81c784") + leaf(14, 34, "#4caf50") +
      // feet and arms
      `<ellipse cx="47" cy="134" rx="8" ry="5" fill="${CS}" ${A_OUT}/><ellipse cx="73" cy="134" rx="8" ry="5" fill="${CS}" ${A_OUT}/>` +
      aL([[34, 88], [22, 78], [19, 70]], C, 7.5) + aC(19, 67, 5.4, C, A_OUT) +
      aL([[86, 88], [98, 78], [101, 70]], C, 7.5) + aC(101, 67, 5.4, C, A_OUT) +
      // the turnip body: round, purple on top fading to cream, a little root tip
      `<defs>${aVGrad(g, PU, C).replace(/<stop offset="1"/, '<stop offset=".42" stop-color="' + C + '"/><stop offset="1"')}</defs>`;
    const shape = `M60,48 Q92,48 94,88 Q94,124 60,132 Q26,124 26,88 Q28,48 60,48Z`;
    const b2 = `<path d="${shape}" fill="url(#${g})" ${A_OUT}/>` +
      `<path d="M80,56 Q96,78 88,110 Q80,126 64,130 Q88,104 80,56Z" fill="${CS}" opacity=".55"/>` +
      `<path d="M38,60 Q46,52 54,51" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>` +
      dotEye(49, 88, 1.25) + dotEye(71, 88, 1.25) + openSmile(60, 98, 9, 5) +
      cheek(41, 99, 4.2, "#ff9aa2") + cheek(79, 99, 4.2, "#ff9aa2");
    return [sea({ seed: 103, top: "#8be3f2", bot: "#1d6fc0", nFish: 3, fishCols: ["#ff8a65", "#fff176", "#ef5350"], kelpH: 56 }) +
      shadow(60, 140, 30) + aSpark(16, 44, 3.6) + aSpark(106, 40, 3) + aSpark(108, 104, 3) + aSpark(22, 118, 2.4), `<g class="lv-bob">${aEdge(body + b2)}</g>`];
  }

  /* ---------- 9 Gup-A: the orange fish-shaped sub zooming up out of the Octopod, the Captain in its glass dome ---------- */
  function gupA() {
    const O = "#f57c1f", OL2 = "#ffa24d", OD = "#c85a10", cp = U("ogup");
    // local coordinates: nose to the right, about 142 long
    const hull = "M-54,2 Q-52,-17 -26,-21 Q2,-25 32,-19 Q62,-12 66,4 Q64,20 36,24 Q2,28 -28,22 Q-52,18 -54,2Z";
    const captain = `<g transform="translate(28 -31) rotate(30) scale(.62)">` + aC(-14, -14, 6, "#fafafa", A_OUT) + aC(14, -14, 6, "#fafafa", A_OUT) +
      `<ellipse cx="0" cy="0" rx="19" ry="17" fill="#fafafa" ${A_OUT}/><ellipse cx="0" cy="6" rx="8" ry="6" fill="#f1f4f7"/><ellipse cx="0" cy="3.5" rx="4.4" ry="3" fill="#1b1b1b"/>` +
      dotEye(-7, -3, 1.3) + dotEye(7, -3, 1.3) + smile(0, 8, 3.6, OL, 1.4) + cheek(-11, 5, 3) + cheek(11, 5, 3) +
      `<path d="M-15,-11 Q-15,-27 0,-28 Q15,-27 15,-11 Q0,-15 -15,-11Z" fill="${NAVY}" ${A_OUT}/><path d="M-16,-10 Q0,-15 16,-10 Q13,-6 0,-8 Q-13,-6 -16,-10Z" fill="#141414" ${A_OUT}/>` +
      badge(0, -19, 4) + `</g>`;
    const sub =
      // tail (two lobes), top and bottom fins behind the hull
      `<path d="M-48,0 Q-60,-8 -76,-28 Q-70,-4 -68,2 Q-70,8 -76,32 Q-60,12 -48,6Z" fill="${O}" ${A_OUT} stroke-linejoin="round"/>` +
      `<path d="M-52,-2 L-68,-18 M-52,6 L-68,22" stroke="${OD}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<path d="M-34,-19 Q-30,-40 -6,-38 Q-14,-29 -10,-22Z" fill="${O}" ${A_OUT} stroke-linejoin="round"/><path d="M-27,-22 Q-24,-32 -12,-35" stroke="${OD}" stroke-width="1.4" fill="none"/>` +
      `<path d="M-14,23 Q-18,42 2,43 Q3,33 2,24Z" fill="${O}" ${A_OUT} stroke-linejoin="round"/>` +
      `<path d="${hull}" fill="${O}" ${A_OUT}/><defs><clipPath id="${cp}"><path d="${hull}"/></clipPath></defs>` +
      `<g clip-path="url(#${cp})"><path d="M-80,10 Q0,20 80,0 V40 H-80Z" fill="${OD}" opacity=".45"/><path d="M-42,-12 Q-14,-20 6,-18" stroke="${OL2}" stroke-width="4.4" fill="none" stroke-linecap="round"/></g>` +
      // portholes, the badge, the headlight, a side fin
      [[-36, 0], [-20, -3]].map(([x, y]) => aC(x, y, 5.4, "#bfefff", `stroke="${OL}" stroke-width="2.4"`) + aC(x - 1.6, y - 1.6, 1.5, "#fff")).join("") +
      badge(42, 6, 6.4) + aC(63, 3, 4.2, "#fff59d", A_OUT) + aC(62, 2, 1.4, "#fff") +
      `<path d="M-6,8 Q-20,14 -24,24 Q-8,25 6,13Z" fill="${OL2}" ${A_OUT} stroke-linejoin="round"/><path d="M-8,13 Q-14,17 -17,21" stroke="${OD}" stroke-width="1.2" fill="none"/>` +
      // the Captain in the big glass dome on top
      `<path d="M2,-18 Q2,-52 29,-52 Q56,-50 57,-15 Q30,-10 2,-18Z" fill="#c4eefc"/>` + captain +
      `<path d="M2,-18 Q2,-52 29,-52 Q56,-50 57,-15 Q30,-10 2,-18Z" fill="#9fe3ff" fill-opacity=".3" stroke="${OL}" stroke-width="1.6"/>` +
      `<path d="M2,-18 Q30,-10 57,-15" stroke="#90a4ae" stroke-width="3" fill="none"/><path d="M2,-18 Q30,-10 57,-15" stroke="${OL}" stroke-width=".8" fill="none" transform="translate(0 1.6)"/>` +
      `<path d="M9,-30 Q12,-45 26,-47" stroke="#fff" stroke-width="2.8" fill="none" stroke-linecap="round" opacity=".9"/><path d="M48,-42 Q52,-36 53,-30" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>`;
    const T = "translate(68 80) rotate(-40) scale(.85)";
    // behind: the Octopod it came from, a bubble trail and speed lines along its path
    const trail = `<g transform="${T}">` + [[-84, 8, 4], [-94, -6, 3], [-100, 16, 2.6], [-108, 2, 3.4], [-90, 26, 2]].map(([x, y, r]) => bubble(x, y, r)).join("") +
      [[-40, -46, 20], [-62, -30, 14]].map(([x, y, l]) => `<path d="M${x},${y} h${-l}" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".75"/>`).join("") + `</g>`;
    return [sea({ seed: 131, top: "#4fc8f0", bot: "#0d3f8a", nFish: 2, fishCols: ["#ffee58", "#80cbc4"], nBub: 6, starX: 40 }) + octopod(99, 119, .76) + trail +
      aSpark(104, 24, 3.6) + aSpark(46, 22, 2.8), `<g transform="${T}">${aEdge(sub)}</g>`];
  }

  FAN.octonauts = [
    ["Captain Barnacles", "the polar-bear captain in his peaked cap, pointing the crew ahead", barnacles],
    ["Kwazii", "the ginger pirate cat: eye patch, gold earring, ear tufts, fist up", kwazii],
    ["Peso", "the little penguin medic waving hello, with his blue medical bag", peso],
    ["Shellington", "the sea-otter scientist in glasses, studying a starfish through his magnifier", shellington],
    ["Dashi", "the dachshund photographer on all fours: long low body, floppy ear, camera flashing", dashi],
    ["Tweak", "the white bunny engineer in green overalls with her big wrench", tweak],
    ["Professor Inkling", "the Dumbo octopus with his monocle and a book", inkling],
    ["Tunip", "the little Vegimal: round, turnip-like, leafy top", tunip],
    ["Gup-A", "the orange fish-shaped sub zooming up past the Octopod, the Captain in its glass dome", gupA],
  ];
})();

/* Sticker book theme page "Peppa Pig": 9 stickers in the show's flat style (side-profile heads, dot eyes, stick limbs, green hills) */
(() => {
  "use strict";
  const OL = A_OL, OUT = `stroke="${OL}" stroke-width="1.1" stroke-linejoin="round"`;
  const uid = p => `pp${p}${++aUid}`;
  const PINK = "#f9b3c8", SNOUT = "#f59ab8", CHEEK = "#ef6f98", MOUTH = "#c62a3a";

  /* ---------- backdrop pieces (flat colours, no outlines, as in the show) ---------- */
  function sky(top, bot) { const g = uid("sky"); return `<defs>${aVGrad(g, top, bot)}</defs><rect width="120" height="158" fill="url(#${g})"/>`; }
  const cloud = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#fff"><ellipse cx="0" cy="0" rx="9" ry="5.5"/><ellipse cx="8" cy="-3" rx="7" ry="6"/><ellipse cx="15" cy="1" rx="7" ry="4.5"/><rect x="-6" y="0" width="26" height="4.5" rx="2.2"/></g>`;
  const hill = (d, c) => `<path d="${d}" fill="${c}"/>`;
  const sun = (x, y, r) => `<g fill="#ffd23f">${[...Array(12)].map((_, i) => { const a = i * Math.PI / 6; return `<path d="M${(x + (r + 2) * Math.cos(a - .12)).toFixed(1)},${(y + (r + 2) * Math.sin(a - .12)).toFixed(1)} L${(x + (r + 7) * Math.cos(a)).toFixed(1)},${(y + (r + 7) * Math.sin(a)).toFixed(1)} L${(x + (r + 2) * Math.cos(a + .12)).toFixed(1)},${(y + (r + 2) * Math.sin(a + .12)).toFixed(1)}Z"/>`; }).join("")}</g>${aC(x, y, r, "#ffd23f")}${aC(x - r * .3, y - r * .3, r * .45, "#fff3a8", 'opacity=".7"')}`;
  // Peppa's house: cream walls, red roof, chimney, two windows, door
  const house = (x, y, s = 1, win = "#9fd8f6") => `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<rect x="-9" y="-11" width="3.5" height="7" fill="#c0392b"/><rect x="-10" y="-11" width="18" height="15" fill="#fbe7a1" stroke="#8a6d3b" stroke-width=".6"/>` +
    `<path d="M-13,-10 L-1,-20 L11,-10Z" fill="#e2492f"/><rect x="-7.5" y="-7" width="4.5" height="4" fill="${win}" stroke="#8a6d3b" stroke-width=".5"/>` +
    `<rect x="3" y="-7" width="4.5" height="4" fill="${win}" stroke="#8a6d3b" stroke-width=".5"/><rect x="-2.6" y="-2" width="4.2" height="6" fill="#c2662d"/></g>`;
  const tree = (x, y, s = 1, c = "#3f9a2e") => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-1.4" y="-14" width="2.8" height="14" fill="#8d5a2b"/><ellipse cx="0" cy="-20" rx="7" ry="9" fill="${c}"/></g>`;
  const flower = (x, y, c) => `<path d="M${x},${y} v5" stroke="#2e7d32" stroke-width=".9"/>` + [0, 1, 2, 3, 4].map(i => { const a = i * 1.2566; return aC(x + 1.9 * Math.cos(a), y + 1.9 * Math.sin(a), 1.4, c); }).join("") + aC(x, y, 1.1, "#ffe14d");
  const grassTufts = (pts, c = "#3c8f2a") => pts.map(([x, y]) => `<path d="M${x - 2},${y} l1,-3 l1,3 l1,-3.5 l1,3.5" fill="none" stroke="${c}" stroke-width=".7"/>`).join("");
  const shadow = (x, y, rx) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${rx * .16}" fill="#000" opacity=".18"/>`;

  /* ---------- the characters ---------- */
  // pig head, facing right, origin = middle of the head; o: skin, snout, lash, glasses, stubble, mouth ("smile"|"open"), eyes [[x,y],[x,y]], cap
  function pigHead(o = {}) {
    const sk = o.skin || PINK, sn = o.snout || SNOUT, s = [];
    const E = o.eyes || [[9, -20.5], [17, -19]];
    // ears (behind the head)
    s.push(`<path d="M-15,-19 Q-17,-31 -11,-35 Q-7,-30 -6,-23Z" fill="${sk}" ${OUT}/>`, `<path d="M-6,-23 Q-6,-34 1,-37 Q3,-31 2,-24Z" fill="${sk}" ${OUT}/>`);
    s.push(`<path d="M34,-17 C24,-19 12,-25 -2,-25 C-20,-25 -29,-12 -27,2 C-25,16 -12,22 0,21 C12,20 22,4 34,1Z" fill="${sk}" ${OUT}/>`);
    s.push(`<ellipse cx="34" cy="-8" rx="4.4" ry="9.2" fill="${sn}" ${OUT}/>`, `<ellipse cx="33.4" cy="-11.5" rx="1.1" ry="2" fill="#a2385c"/><ellipse cx="34.6" cy="-4.5" rx="1.1" ry="2" fill="#a2385c"/>`);
    s.push(aC(-5, 4, 5.6, CHEEK, 'opacity=".75"'));
    if (o.stubble) s.push([[-2, 15], [2, 16.5], [6, 15.5], [10, 13.5], [0, 12], [4, 13], [8, 11]].map(([x, y]) => aC(x, y, .55, "#7a4a5a")).join(""));
    if (o.mouth === "open") s.push(`<path d="M3,9 Q14,22 27,5 Q15,12 3,9Z" fill="${MOUTH}" ${OUT}/>`);
    else s.push(`<path d="M3,9 Q14,17 26,5" fill="none" stroke="${OL}" stroke-width="1.2" stroke-linecap="round"/>`);
    E.forEach(([x, y]) => {
      s.push(aC(x, y, 3.4, "#fff", OUT), aC(x + .7, y, 1.7, "#111"));
      if (o.lash) s.push(`<path d="M${x - 2.2},${y - 2.8} l-1,-2.4 M${x},${y - 3.4} v-2.6 M${x + 2.2},${y - 2.8} l1,-2.4" stroke="${OL}" stroke-width=".9" stroke-linecap="round"/>`);
    });
    if (o.glasses) {
      const [[x1, y1], [x2, y2]] = E;
      s.push(`<path d="M${x1 - 5},${y1 + 1} L-12,-12" stroke="${OL}" stroke-width="1.3" stroke-linecap="round"/>`,
        aC(x1, y1, 5, "none", `stroke="${OL}" stroke-width="1.6"`), aC(x2, y2, 5, "none", `stroke="${OL}" stroke-width="1.6"`));
    }
    if (o.cap) s.push(o.cap);
    return s.join("");
  }
  // a figure: neck at (0,0) facing right; limbs are point lists, body and head are drawn over the limbs
  function fig(o) {
    const sk = o.skin || PINK, s = [];
    if (o.back) s.push(o.back);
    (o.legs || []).forEach(L => { s.push(aL(L, sk, o.lw || 1.9)); const [x, y] = L[L.length - 1]; s.push(`<ellipse cx="${x + 2.4}" cy="${y + 1}" rx="4.3" ry="2.4" fill="${o.shoe || "#1d1d1d"}" ${OUT}/>`); });
    (o.arms || []).forEach(A => { s.push(aL(A, sk, o.aw || 1.7)); const [x, y] = A[A.length - 1]; s.push(aC(x, y, 2.3, sk, OUT)); });
    s.push(o.body || "", `<g transform="translate(${(o.head || [2, -20])[0]} ${(o.head || [2, -20])[1]}) scale(${o.hs || 1})">${o.headSvg}</g>`, o.front || "", o.hold != null ? aC(...o.arms[o.hold][o.arms[o.hold].length - 1], 2.3, sk, OUT) : "");
    return `<g transform="translate(${o.x} ${o.y}) scale(${o.s * (o.flip ? -1 : 1)} ${o.s})">${s.join("")}</g>`;
  }
  // dress / top: narrow at the neck, flared, rounded hem, a soft shade on the back side
  function dress(c, top = 8, bot = 22, h = 36, shade = "#000") {
    return `<path d="M${-top},0 Q0,-2.5 ${top},0 L${bot},${h} Q0,${h + 4} ${-bot},${h}Z" fill="${c}" ${OUT}/>` +
      `<path d="M${-top + 1},1 L${-bot + 1.2},${h - .6} Q${-bot + 7},${h + 1.5} ${-bot + 9},${h + 1.6} L${-top + 4},1Z" fill="${shade}" opacity=".12"/>`;
  }
  const curlTail = (x, y, c = PINK) => `<path d="M${x},${y} q-6,1 -6,-4 q0,-4 4,-3 q3,1 1,4" fill="none" stroke="${OL}" stroke-width="3.2" stroke-linecap="round"/><path d="M${x},${y} q-6,1 -6,-4 q0,-4 4,-3 q3,1 1,4" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/>`;

  // sheep head (Suzy), as in the show: a fluffy cloud of white fleece (bumpy outline) round the back and top of the head,
  // and a smaller pig-like face in front of it pointing right, with two eyes on the snout side
  function cloudPath(cx, cy, rx, ry, n, a0 = 0) {
    const P = [...Array(n)].map((_, i) => { const a = a0 + i * 2 * Math.PI / n, k = i % 2 ? .97 : 1.03; return [cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]; });
    return "M" + P.map(([x, y], i) => { const [u, v] = P[(i + 1) % n], r = Math.hypot(u - x, v - y) * .56; return `${i ? "" : `${x.toFixed(1)},${y.toFixed(1)} `}A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${u.toFixed(1)},${v.toFixed(1)}`; }).join(" ") + "Z";
  }
  function sheepHead(o = {}) {
    const s = [];
    s.push(`<path d="${cloudPath(-6, -8, 21, 20, 12, .2)}" fill="#fff" ${OUT} stroke-width="1.3"/>`);
    s.push(`<path d="M-24,-2 Q-22,10 -10,12 Q-18,4 -17,-6 Q-21,-5 -24,-2Z" fill="#dfe6ee" opacity=".8"/>`);
    s.push(`<path d="M-3,-9 C6,-17 19,-16 28,-9 C35,-4 34,7 26,9.5 C15,12.5 0,12 -4,5 C-6,1 -6,-5 -3,-9Z" fill="#fdf7f3" ${OUT}/>`);
    s.push(aC(4, 3.5, 3.4, CHEEK, 'opacity=".55"'));
    s.push(aC(30.5, -3, 1.1, "#7a5a5a"), aC(31.5, 2, 1.1, "#7a5a5a"));
    s.push(o.mouth === "open" ? `<path d="M11,4 Q20,15 28,5 Q19,8 11,4Z" fill="${MOUTH}" ${OUT}/>` : `<path d="M12,5 Q20,10 28,5" fill="none" stroke="${OL}" stroke-width="1.1" stroke-linecap="round"/>`);
    [[11, -8.5], [19, -6.5]].forEach(([x, y]) => s.push(aC(x, y, 3.2, "#fff", OUT), aC(x + .7, y, 1.6, "#111")));
    return s.join("");
  }
  // rabbit head (Rebecca): long ears with pink insides, a short snout with a pink nose and two teeth
  function rabbitHead(o = {}) {
    const fur = o.fur || "#c8956a", s = [];
    s.push(`<path d="M-13,-14 C-26,-30 -24,-56 -17,-58 C-10,-58 -6,-36 -5,-18Z" fill="${fur}" ${OUT}/><path d="M-12,-20 C-20,-32 -19,-50 -16,-52 C-12,-50 -9,-36 -8,-21Z" fill="#f4a9b8"/>`);
    s.push(`<path d="M-4,-19 C-8,-38 -4,-60 3,-61 C10,-60 8,-38 4,-18Z" fill="${fur}" ${OUT}/><path d="M-2,-22 C-5,-38 -2,-54 3,-55 C7,-53 6,-38 2,-22Z" fill="#f4a9b8"/>`);
    s.push(`<path d="M25,-10 C16,-20 4,-22 -6,-21 C-22,-20 -26,-2 -20,10 C-14,18 4,18 14,13 C20,9 27,3 28,-3 C28,-6 27,-8 25,-10Z" fill="${fur}" ${OUT}/>`);
    s.push(`<path d="M-17,0 C-17,-12 -8,-17 0,-17 C-8,-12 -12,-6 -12,4Z" fill="#fff" opacity=".18"/>`);
    s.push(`<ellipse cx="27.5" cy="-5" rx="2.6" ry="2.2" fill="#e8708a" ${OUT}/>`);
    s.push(`<rect x="15" y="9.5" width="3.4" height="4" fill="#fff" ${OUT}/><rect x="18.4" y="9.5" width="3.4" height="4" fill="#fff" ${OUT}/>`);
    s.push(`<path d="M8,7 Q16,12 26,4" fill="none" stroke="${OL}" stroke-width="1.1" stroke-linecap="round"/>`);
    [[6, -14], [14, -12.5]].forEach(([x, y]) => s.push(aC(x, y, 3.2, "#fff", OUT), aC(x + .7, y, 1.6, "#111")));
    return s.join("");
  }
  // dog head (Danny): round head, a longer muzzle with a black nose, floppy dark ears over the head
  function dogHead(o = {}) {
    const fur = o.fur || "#b9814f", ear = o.ear || "#6b3f1d", s = [];
    s.push(`<path d="M33,-10 C24,-13 14,-24 -2,-24 C-20,-24 -27,-10 -25,4 C-22,18 -6,22 6,18 C16,14 24,6 33,3Z" fill="${fur}" ${OUT}/>`);
    s.push(`<ellipse cx="33" cy="-4" rx="4.4" ry="5.4" fill="#1d1d1d" ${OUT}/>`, aC(32, -6.5, 1.2, "#fff", 'opacity=".6"'));
    s.push(o.mouth === "open" ? `<path d="M8,9 Q19,20 30,5 Q19,12 8,9Z" fill="${MOUTH}" ${OUT}/>` : `<path d="M8,10 Q19,15 29,6" fill="none" stroke="${OL}" stroke-width="1.1" stroke-linecap="round"/>`);
    [[7, -18], [15, -16]].forEach(([x, y]) => s.push(aC(x, y, 3.2, "#fff", OUT), aC(x + .7, y, 1.6, "#111")));
    s.push(`<path d="M-17,-21 C-12,-24 -6,-22 -6,-17 C-6,-6 -10,8 -16,12 C-22,14 -25,8 -23,0 C-22,-8 -22,-16 -17,-21Z" fill="${ear}" ${OUT}/>`);
    return s.join("");
  }
  // pony head (Pedro): long nose, a mane, small pointed ears, big round black glasses
  function ponyHead(o = {}) {
    const fur = o.fur || "#d2a06c", mane = o.mane || "#8a5528", s = [];
    s.push(`<path d="M-14,-22 L-12,-36 L-5,-25Z" fill="${fur}" ${OUT}/><path d="M-5,-25 L-1,-38 L4,-25Z" fill="${fur}" ${OUT}/>`);
    s.push(`<path d="M-24,-12 C-30,0 -28,10 -24,18 C-18,12 -14,4 -14,-4Z" fill="${mane}" ${OUT}/>`);
    s.push(`<path d="M35,-5 C31,-13 20,-20 6,-24 C-10,-28 -24,-18 -24,-2 C-24,14 -8,20 6,15 C16,11 26,10 31,9 C37,7 38,1 35,-5Z" fill="${fur}" ${OUT}/>`);
    s.push(`<path d="M-20,-14 C-18,-26 -8,-29 2,-26 C-2,-22 -6,-18 -8,-12 C-12,-16 -16,-14 -20,-14Z" fill="${mane}" ${OUT}/>`);
    s.push(`<ellipse cx="33" cy="1" rx="1.4" ry="2.3" fill="#5a3418" transform="rotate(-20 33 1)"/>`);
    s.push(`<path d="M14,9 Q23,13 31,8" fill="none" stroke="${OL}" stroke-width="1.1" stroke-linecap="round"/>`);
    const E = [[9, -17], [19.5, -14]];
    E.forEach(([x, y]) => s.push(aC(x, y, 3.2, "#fff", OUT), aC(x + .7, y, 1.6, "#111")));
    s.push(`<path d="M${E[0][0] - 5.4},${E[0][1] + 1} L-12,-8" stroke="${OL}" stroke-width="1.4" stroke-linecap="round"/>`,
      ...E.map(([x, y]) => aC(x, y, 5.3, "none", `stroke="${OL}" stroke-width="1.9"`)));
    return s.join("");
  }
  // Mr Dinosaur: George's green toy, standing on George's hand at (0,0), facing right
  const mrDino = () => `<g>` +
    `<path d="M-14,-6 Q-24,-4 -28,2 Q-20,0 -12,-1Z" fill="#43a047" ${OUT}/>` +
    `<path d="M-6,-1 l-1,7 l4,0 l0,-6 M5,-1 l1,7 l4,0 l-1,-6" fill="#43a047" ${OUT}/>` +
    `<path d="M-15,-4 Q-14,-16 0,-16 Q8,-16 10,-22 L12,-30 Q14,-36 22,-35 Q28,-34 28,-29 Q28,-25 20,-24 Q16,-23 15,-18 Q14,-4 8,0 Q0,3 -8,1 Q-14,0 -15,-4Z" fill="#43a047" ${OUT}/>` +
    `<path d="M-10,-14 l2,-5 l3,4 l2,-5 l3,4 l2,-5 l2,4" fill="#2e7d32" ${OUT}/>` +
    `<path d="M-10,-4 Q0,0 9,-3" fill="none" stroke="#a5d6a7" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M21,-29 Q26,-28 28,-29 Q27,-26 21,-27Z" fill="#c62828"/>` + aC(18, -31, 1.2, "#111") + `</g>`;

  /* ---------- the nine stickers: each returns [backdrop, character] (the character part alone = the "find the shape" silhouette) ---------- */
  // 1 Peppa jumping in a muddy puddle, the house on the hill behind
  function peppa() {
    const mud = "#8a5a2e", drops = [[22, 116, -30], [14, 128, -60], [96, 114, 30], [106, 126, 55], [32, 104, -15], [86, 102, 15], [58, 106, 0]];
    const bg = sky("#43b3ef", "#9adcfb") + cloud(8, 22, .9) + cloud(70, 14, .8) +
      hill("M60,92 Q88,48 120,58 V158 H60Z", "#8cd04f") + house(99, 60, 1.05) +
      hill("M0,96 Q34,80 70,96 Q96,108 120,100 V158 H0Z", "#6cbf3d") + hill("M0,126 Q60,114 120,128 V158 H0Z", "#57ad30") +
      grassTufts([[10, 136], [104, 140], [22, 150], [98, 152]]) +
      `<ellipse cx="58" cy="138" rx="46" ry="11" fill="${mud}"/><ellipse cx="58" cy="136.5" rx="38" ry="7" fill="#a06d3a"/>` +
      drops.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="4.4" fill="${mud}" transform="rotate(${r} ${x} ${y})"/>`).join("") +
      `<path d="M30,136 Q26,124 34,118 Q34,128 40,134 Q42,122 48,120 Q46,130 52,134Z M66,134 Q70,122 76,120 Q74,130 80,134 Q86,124 90,120 Q88,130 88,136Z" fill="${mud}"/>`;
    return [bg, aEdge(fig({ x: 64, y: 70, s: 1.12, flip: true, headSvg: pigHead({ mouth: "open" }),
      legs: [[[-6, 35], [-9, 43], [-7, 50]], [[6, 35], [9, 43], [8, 50]]],
      arms: [[[-7, 6], [-18, 6], [-25, -3]], [[7, 6], [17, 9], [27, 4]]],
      back: curlTail(-20, 29), body: dress("#e8262a") }))];
  }
  // 2 George holding Mr Dinosaur up: "Dine-saw!"
  function george() {
    const bg = sky("#3fb0ee", "#a7e1fb") + sun(100, 22, 9) + cloud(10, 30, .8) +
      hill("M0,92 Q30,72 64,90 Q92,104 120,88 V158 H0Z", "#86cc4c") + tree(14, 96, 1) + tree(108, 98, .8, "#4aa636") +
      hill("M0,118 Q56,104 120,118 V158 H0Z", "#5fb437") +
      [[12, 128, "#ff6f91"], [26, 140, "#ffd23f"], [100, 130, "#ff6f91"], [110, 144, "#b388ff"], [92, 148, "#ffd23f"]].map(([x, y, c]) => flower(x, y, c)).join("") +
      shadow(56, 136, 24);
    return [bg, aEdge(fig({ x: 50, y: 80, s: 1.2, headSvg: pigHead({ mouth: "open" }), hs: .92, head: [2, -18], hold: 1,
      legs: [[[-5, 26], [-6, 44]], [[5, 26], [6, 44]]],
      arms: [[[-7, 5], [-17, 7], [-25, -2]], [[7, 5], [17, 13], [27, 16]]],
      back: curlTail(-17, 22), body: dress("#2f6fd6", 7.5, 18, 27),
      front: `<g transform="translate(29 19) scale(.8)">${mrDino()}</g>` }))];
  }
  // 3 Mummy Pig in her orange dress, in the garden
  function mummy() {
    const fence = [...Array(12)].map((_, i) => `<path d="M${i * 11 + 2},118 v-17 l3,-3 l3,3 v17Z" fill="#fff8e7" stroke="#c9b48a" stroke-width=".5"/>`).join("");
    const bg = sky("#4ab6ee", "#bfe8fb") + cloud(6, 18, .9) + cloud(78, 30, .7) +
      hill("M0,104 Q40,80 120,92 V158 H0Z", "#8cd04f") +
      `<rect x="0" y="106" width="120" height="3" fill="#fff8e7"/><rect x="0" y="112" width="120" height="3" fill="#fff8e7"/>` + fence +
      hill("M0,118 H120 V158 H0Z", "#5fb437") +
      [[8, 128, "#ff5c8a"], [18, 136, "#ffd23f"], [104, 126, "#ff5c8a"], [112, 138, "#ffd23f"], [98, 146, "#b388ff"], [10, 148, "#b388ff"]].map(([x, y, c]) => flower(x, y, c)).join("") +
      shadow(66, 145, 28);
    return [bg, aEdge(fig({ x: 68, y: 74, s: 1.15, flip: true, headSvg: pigHead({ lash: 1 }), hs: 1.02,
      legs: [[[-6, 40], [-7, 58]], [[6, 40], [7, 58]]],
      arms: [[[-8, 6], [-19, 18], [-22, 28]], [[8, 6], [19, 16], [24, 24]]],
      back: curlTail(-24, 34), body: dress("#f47b20", 8.5, 24, 42) }))];
  }
  // 4 Daddy Pig: glasses, stubble, big round tummy in a turquoise-green top, the red car behind
  function daddy() {
    const car = `<g transform="translate(16 104)"><path d="M-14,0 V-6 Q-14,-9 -10,-9 L-6,-9 L-3,-16 Q-2,-18 1,-18 L8,-18 Q11,-18 12,-15 L14,-9 Q17,-9 17,-6 V0Z" fill="#e53935"/><path d="M-1,-15.5 h4 v5.5 h-6Z M5,-15.5 h3 l2,5.5 h-5Z" fill="#bfe8fb"/>` +
      aC(-8, 0, 3.4, "#222") + aC(11, 0, 3.4, "#222") + aC(-8, 0, 1.3, "#bbb") + aC(11, 0, 1.3, "#bbb") + `</g>`;
    const bg = sky("#35a9ec", "#a9e0fb") + cloud(70, 16, .9) + cloud(4, 34, .7) +
      hill("M0,88 Q50,66 120,82 V158 H0Z", "#8cd04f") + `<path d="M0,106 Q60,94 120,104 V114 Q60,104 0,116Z" fill="#9e9e9e"/>` + car +
      hill("M0,116 Q60,104 120,114 V158 H0Z", "#5fb437") + grassTufts([[8, 140], [112, 136], [104, 150]]) +
      shadow(60, 146, 32);
    return [bg, aEdge(fig({ x: 56, y: 72, s: 1.06, headSvg: pigHead({ glasses: 1, stubble: 1, eyes: [[7, -20.5], [18, -18.8]] }), hs: 1.1, head: [3, -20],
      legs: [[[-9, 58], [-10, 68]], [[9, 58], [10, 68]]],
      arms: [[[-20, 10], [-36, 22], [-40, 34]], [[20, 10], [36, 20], [42, 30]]],
      body: `<path d="M-10,0 Q0,-3 10,0 C30,8 36,30 30,46 C24,62 -24,62 -30,46 C-36,30 -30,8 -10,0Z" fill="#2aa198" ${OUT}/>` +
        `<path d="M-26,14 C-34,30 -30,50 -16,56 C-24,46 -26,30 -22,16Z" fill="#000" opacity=".12"/><path d="M8,6 C20,10 26,20 26,28" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".25"/>`,
      back: curlTail(-29, 46) }))];
  }
  // 5 Grandpa Pig (sailing cap, indigo shirt) and Granny Pig (magenta dress) face to face in their vegetable garden, big in the card
  function grandparents() {
    const cap = `<g transform="translate(0 -3)"><path d="M-14,-24 Q-14,-36 0,-36 Q14,-36 14,-24Z" fill="#1f2e6e" ${OUT}/><path d="M-15,-24 H15 V-21 H-15Z" fill="#fff" ${OUT}/><path d="M13,-23 Q24,-23 25,-20 Q18,-19 12,-21Z" fill="#111" ${OUT}/>` +
      `<path d="M0,-33 v7 M-2.5,-31 h5 M-3.5,-28 Q0,-24.5 3.5,-28" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></g>`;
    const veg = [[8, 124], [26, 128], [44, 124], [62, 128], [80, 124], [98, 128], [114, 124]].map(([x, y], i) => i % 2 ?
      `<path d="M${x},${y} l-3,-6 M${x},${y} l0,-7 M${x},${y} l3,-6" stroke="#3c9a2a" stroke-width="1.6" stroke-linecap="round"/><path d="M${x - 2},${y} h4 l-2,3Z" fill="#f57c00"/>` :
      `<ellipse cx="${x}" cy="${y - 2}" rx="6" ry="4.5" fill="#7cc243"/><ellipse cx="${x}" cy="${y - 3}" rx="3.4" ry="2.6" fill="#a5d66f"/>`).join("");
    const bg = sky("#45b4ef", "#b5e5fb") + cloud(48, 12, .8) + sun(104, 18, 7) +
      hill("M0,96 Q60,74 120,92 V158 H0Z", "#8cd04f") + tree(10, 100, .9) + tree(111, 98, .9, "#4aa636") +
      hill("M0,112 Q60,104 120,112 V158 H0Z", "#5fb437") +
      `<path d="M0,118 Q60,112 120,118 V132 Q60,126 0,132Z" fill="#8a5a2e"/>` + veg + grassTufts([[60, 150], [10, 152], [112, 150]]) +
      shadow(29, 146, 22) + shadow(92, 146, 20);
    const grandpa = fig({ x: 28, y: 84, s: .98, headSvg: pigHead({ cap, mouth: "open" }), hs: .9, head: [-3, -19],
      legs: [[[-8, 46], [-9, 60]], [[8, 46], [9, 60]]],
      arms: [[[-14, 8], [-26, 18], [-27, 30]], [[14, 8], [25, 16], [29, 26]]],
      body: `<path d="M-9,0 Q0,-3 9,0 C24,8 28,28 22,42 C17,52 -17,52 -22,42 C-28,28 -24,8 -9,0Z" fill="#3949ab" ${OUT}/><path d="M-19,14 C-25,28 -22,42 -12,47 C-17,38 -19,26 -16,16Z" fill="#000" opacity=".14"/>`,
      back: curlTail(-21, 38) });
    const granny = fig({ x: 92, y: 88, s: .98, flip: true, headSvg: pigHead({ lash: 1 }), hs: .88, head: [-3, -19],
      legs: [[[-6, 42], [-7, 58]], [[6, 42], [7, 58]]],
      arms: [[[-8, 6], [-19, 18], [-21, 28]], [[8, 6], [19, 15], [23, 24]]],
      back: curlTail(-23, 36), body: dress("#c2287e", 8.5, 23, 43) });
    return [bg, aEdge(granny + grandpa)];
  }
  // 6 Suzy Sheep waving in her pink dress, a rainbow behind
  function suzy() {
    const bow = ["#ff4b4b", "#ff9a2e", "#ffe03a", "#5fd35f", "#3fa2ff", "#8f6bff"].map((c, i) => `<path d="M${-6 + i * 4},112 A${66 - i * 4},${66 - i * 4} 0 0 1 ${126 - i * 4},112" fill="none" stroke="${c}" stroke-width="4" opacity=".85"/>`).join("");
    const bg = sky("#56bdf0", "#c4ebfc") + bow + cloud(-4, 104, 1.1) + cloud(102, 104, 1) +
      hill("M0,104 Q30,90 60,100 Q90,110 120,98 V158 H0Z", "#86cc4c") + hill("M0,124 Q60,112 120,126 V158 H0Z", "#5fb437") +
      [[10, 132, "#ff8fb1"], [22, 146, "#ffd23f"], [104, 136, "#ff8fb1"], [112, 148, "#ffffff"]].map(([x, y, c]) => flower(x, y, c)).join("") +
      shadow(58, 145, 26);
    return [bg, aEdge(fig({ x: 58, y: 76, s: 1.15, skin: "#fdf7f3", headSvg: sheepHead({ mouth: "open" }), hs: 1.1, head: [3, -18],
      legs: [[[-6, 37], [-7, 58]], [[6, 37], [7, 58]]],
      arms: [[[-7, 6], [-20, 4], [-28, -6]], [[7, 6], [17, 16], [22, 26]]],
      body: dress("#ef5d9c", 8, 22, 38) }))];
  }
  // 7 Rebecca Rabbit with a carrot, her burrow door in the hill
  function rebecca() {
    const carrot = `<g transform="translate(23 22) rotate(-30)"><path d="M-3,0 Q0,-2 3,0 L0,18Z" fill="#ff8a1e" ${OUT}/><path d="M-1.5,5 h2.5 M-1,10 h2" stroke="#c45f0a" stroke-width=".8"/><path d="M0,0 l-4,-7 M0,0 l0,-8 M0,0 l4,-7" stroke="#3c9a2a" stroke-width="2" stroke-linecap="round"/></g>`;
    const bg = sky("#3fb0ee", "#b0e3fb") + cloud(56, 12, .8) +
      hill("M-10,158 V92 Q10,52 50,58 Q70,62 72,100 V158Z", "#7cc243") +
      `<path d="M14,104 Q14,86 28,86 Q42,86 42,104Z" fill="#a0522d"/><path d="M28,86 V104" stroke="#7a3d20" stroke-width=".8"/>` + aC(36, 96, 1.2, "#ffd23f") +
      `<rect x="8" y="76" width="7" height="5" rx="2.5" fill="#bfe8fb" stroke="#7a3d20" stroke-width=".8"/>` +
      hill("M0,112 Q60,100 120,110 V158 H0Z", "#5fb437") + tree(108, 108, 1.1, "#4aa636") + grassTufts([[10, 140], [110, 140], [100, 152]]) +
      shadow(62, 146, 24);
    return [bg, aEdge(fig({ x: 64, y: 88, s: 1.06, flip: true, skin: "#c8956a", headSvg: rabbitHead(), hs: 1, head: [2, -16], hold: 1,
      legs: [[[-6, 36], [-7, 52]], [[6, 36], [7, 52]]],
      arms: [[[-7, 6], [-16, 16], [-24, 20]], [[7, 6], [18, 14], [23, 24]]],
      back: aC(-21, 30, 4.2, "#fff", OUT), body: dress("#5cc4f0", 8, 21, 37), front: carrot }))];
  }
  // 8 Danny Dog at the seaside with a ball
  function danny() {
    const bg = sky("#2fa8ef", "#b8e7fc") + cloud(52, 12, .8) + sun(106, 18, 7) +
      `<rect x="0" y="92" width="120" height="22" fill="#2b8fd8"/><path d="M0,96 q6,-2 12,0 t12,0 t12,0 t12,0 t12,0 t12,0 t12,0 t12,0 t12,0 t12,0" fill="none" stroke="#bfe8fb" stroke-width="1.2"/>` +
      `<path d="M0,112 Q60,104 120,112 V158 H0Z" fill="#f6d78a"/>` +
      `<g transform="translate(14 140)"><path d="M-6,0 L-4,-9 H4 L6,0Z" fill="#e53935"/><path d="M-7,-9 H7 V-11 H-7Z" fill="#e53935"/></g>` +
      [[100, 128], [24, 124]].map(([x, y]) => `<path d="M${x},${y} l3,-2 l3,2 l-1,3 h-4Z" fill="#ff8a65"/>`).join("") +
      shadow(56, 140, 24) + shadow(91, 128, 8);
    return [bg, aEdge(fig({ x: 54, y: 72, s: 1.18, skin: "#b9814f", headSvg: dogHead({ mouth: "open" }), hs: 1, head: [2, -19],
      legs: [[[-5, 27], [-6, 52]], [[5, 27], [6, 52]]],
      arms: [[[-7, 5], [-18, 12], [-24, 4]], [[7, 5], [17, 12], [21, 22]]],
      back: `<path d="M-15,22 q-8,-2 -10,-9" fill="none" stroke="${OL}" stroke-width="4.2" stroke-linecap="round"/><path d="M-15,22 q-8,-2 -10,-9" fill="none" stroke="#b9814f" stroke-width="2" stroke-linecap="round"/>`,
      body: dress("#5b2d8e", 7.5, 18, 28) }) +
      `<g transform="translate(91 118)">${aC(0, 0, 9, "#ffeb3b", OUT)}<path d="M-9,0 A9,9 0 0 0 9,0Z" fill="#e53935"/><path d="M-9,0 H9" stroke="${OL}" stroke-width=".9"/><path d="M0,-9 Q-5,0 0,9" fill="none" stroke="#1e88e5" stroke-width="1.4"/>${aC(0, 0, 9, "none", OUT)}</g>`)];
  }
  // 9 Pedro Pony with his glasses, on the hills at night under the moon
  function pedro() {
    const stars = [[10, 14], [28, 30], [46, 10], [70, 22], [16, 52], [104, 48], [84, 8], [54, 40]].map(([x, y], i) => aSpark(x, y, i % 3 ? 2.2 : 3, "#fff6c2")).join("");
    const bg = sky("#1d2a6b", "#4a5fb0") + stars + aC(98, 22, 11, "#fff3b0") + aC(104, 18, 10, "#2c3b86") +
      hill("M0,96 Q40,74 80,90 Q100,98 120,86 V158 H0Z", "#3c7d3a") + house(22, 86, .9, "#ffe680") +
      hill("M0,118 Q60,106 120,118 V158 H0Z", "#2f6a2e") + grassTufts([[10, 140], [108, 136]], "#24562a") +
      shadow(56, 140, 24);
    return [bg, aEdge(fig({ x: 54, y: 74, s: 1.14, skin: "#d2a06c", headSvg: ponyHead(), hs: 1, head: [2, -18],
      legs: [[[-5, 27], [-6, 52]], [[5, 27], [6, 52]]],
      arms: [[[-7, 5], [-18, 14], [-22, 24]], [[7, 5], [18, 12], [23, 20]]],
      back: `<path d="M-15,20 C-24,20 -28,28 -27,36 C-23,32 -19,28 -14,27Z" fill="#8a5528" ${OUT}/>`,
      body: dress("#f7c51e", 7.5, 18, 28) }))];
  }

  FAN.peppa = [
    ["Peppa Pig", "Red dress, jumping in a muddy puddle, her house on the hill", peppa],
    ["George", "Blue top, holding up Mr Dinosaur", george],
    ["Mummy Pig", "Orange dress, in the garden", mummy],
    ["Daddy Pig", "Glasses, turquoise top, big round tummy, the red car", daddy],
    ["Grandpa and Granny Pig", "Face to face in their vegetable garden: sailing cap and indigo shirt; magenta dress", grandparents],
    ["Suzy Sheep", "Fluffy cloud of white fleece, pink dress, waving, a rainbow", suzy],
    ["Rebecca Rabbit", "Sky-blue dress, a carrot, her burrow door", rebecca],
    ["Danny Dog", "Floppy ears, purple top, at the seaside with a ball", danny],
    ["Pedro Pony", "Glasses, yellow top, the hills at night", pedro],
  ];
})();

/* Sticker book theme page: Paw Patrol (Ryder + 8 pups), drawn with album.js's pieces; sets FAN.pawpatrol = [[name, what, draw], ...];
   draw() returns [backdrop, character] (character = the figure with its props and white cut-out edge, nothing card-wide) */
(() => {
  "use strict";
  const U = p => `pp${p}${++aUid}`;
  const P = (d, f, ex = "") => `<path d="${d}" fill="${f}" ${A_OUT} stroke-linejoin="round" ${ex}/>`;
  const E = (cx, cy, rx, ry, f, ex = A_OUT) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${f}" ${ex}/>`;
  const R = (x, y, w, h, rx, f, ex = A_OUT) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" ${ex}/>`;
  const mir = s => s + `<g transform="scale(-1 1)">${s}</g>`;
  const sky = (a, b) => { const g = U("sky"); return `<defs>${aVGrad(g, a, b)}</defs><rect width="120" height="158" fill="url(#${g})"/>`; };
  const shadow = (x, y, rx) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${rx * .17}" fill="#000" opacity=".2"/>`;
  const cloud = (x, y, s = 1, f = "#fff", op = 1) => `<g opacity="${op}" transform="translate(${x} ${y}) scale(${s})">${aC(0, 0, 6, f)}${aC(7, -3, 7.5, f)}${aC(15, 0, 6, f)}<rect x="-6" y="0" width="27" height="6" rx="3" fill="${f}"/></g>`;
  const sparks = pts => pts.map(([x, y, r, c]) => aSpark(x, y, r, c || "#fff")).join("");
  const shade = (pts, w) => `<polyline points="${aPts(pts)}" fill="none" stroke="#000" stroke-opacity=".2" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

  /* ---- collar tags: a gold-rimmed disc with the pup's job symbol (symbol drawn in a radius-10 box) ---- */
  const SYM = {
    police: ["#1565c0", () => `<path d="M0,-8 L6.5,-5 L6,2 Q5,6.5 0,9 Q-5,6.5 -6,2 L-6.5,-5Z" fill="#ffd54f" stroke="#8d6e00" stroke-width=".8"/>${aStar(0, 0, 3.6, "#1565c0")}`],
    fire: ["#e53935", () => `<path d="M0,-8.5 Q6.5,-2 5.5,3 Q4.5,8 0,8 Q-4.5,8 -5.5,3 Q-6,-1.5 -2,-4.5 Q-2.2,-.5 .5,.5 Q1.8,-3.5 0,-8.5Z" fill="#ffd54f"/><path d="M0,0 Q3,3 2.4,5.2 Q1.6,7 0,7 Q-1.8,7 -2.4,5.2 Q-2.6,2.6 0,0Z" fill="#ff8f00"/>`],
    prop: ["#ec407a", () => [0, 120, 240].map(a => `<ellipse cx="0" cy="-4.6" rx="2.6" ry="4.6" fill="#fff" transform="rotate(${a})"/>`).join("") + aC(0, 0, 2.2, "#ffd54f")],
    shovel: ["#fdd835", () => `<path d="M-1,-8 H1 V1 H-1Z" fill="#6d4c41"/><path d="M-3,-9 H3 V-7.5 H-3Z" fill="#6d4c41"/><path d="M-4.5,1 H4.5 V5 Q4.5,8.5 0,9.5 Q-4.5,8.5 -4.5,5Z" fill="#607d8b" stroke="#37474f" stroke-width=".7"/>`],
    recycle: ["#43a047", () => [0, 120, 240].map(a => `<g transform="rotate(${a})"><path d="M-4.2,-3.5 L1.6,-7 L3.6,-3.6" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><polygon points="1.6,-2.4 6.2,-4.6 3.4,-7.4" fill="#fff"/></g>`).join("")],
    anchor: ["#fb8c00", () => `<circle cx="0" cy="-6" r="2" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M0,-4 V7.5 M-4,-1.5 H4 M-6.5,2.5 Q-6,7.5 0,7.8 Q6,7.5 6.5,2.5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><path d="M-6.5,2.5 l-1.3,1.6 M6.5,2.5 l1.3,1.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`],
    snow: ["#26c6da", () => [0, 60, 120].map(a => `<g transform="rotate(${a})"><path d="M0,-8 V8 M-2.4,-6.6 L0,-4.6 L2.4,-6.6 M-2.4,6.6 L0,4.6 L2.4,6.6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></g>`).join("")],
    compass: ["#689f38", () => `<circle r="7.5" fill="none" stroke="#fff" stroke-width="1"/><polygon points="0,-8 2,0 0,8 -2,0" fill="#fff"/><polygon points="0,-8 2,0 -2,0" fill="#e53935"/><polygon points="-8,0 0,-1.6 8,0 0,1.6" fill="#fff" opacity=".85"/>`],
  };
  const badge = (k, x, y, r) => `<g transform="translate(${x} ${y})">${aC(0, 0, r + 1.4, "#ffc107", `stroke="${A_OL}" stroke-width="1"`)}${aC(0, 0, r, SYM[k][0], `stroke="#b8860b" stroke-width=".5"`)}` +
    `<g transform="scale(${(r / 10.5).toFixed(3)})">${SYM[k][1]()}</g><path d="M${-r * .6},${-r * .55} Q0,${-r * 1.05} ${r * .6},${-r * .55}" fill="none" stroke="#fff" stroke-width=".8" opacity=".55"/></g>`;
  // the Paw Patrol shield: gold rim, red over blue, gold paw print (no lettering)
  const pawPrint = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${c}"><ellipse cx="0" cy="2" rx="3.4" ry="2.8"/>${aC(-3.6, -1.8, 1.3, c)}${aC(-1.3, -3.6, 1.3, c)}${aC(1.3, -3.6, 1.3, c)}${aC(3.6, -1.8, 1.3, c)}</g>`;
  const shield = (x, y, s) => { const c = U("sh");
    return `<g transform="translate(${x} ${y}) scale(${s})"><defs><clipPath id="${c}"><path d="M-9,-10 H9 V0 Q9,8 0,12 Q-9,8 -9,0Z"/></clipPath></defs>` +
      `<path d="M-10.5,-11.5 H10.5 V0 Q10.5,9.5 0,13.8 Q-10.5,9.5 -10.5,0Z" fill="#ffc107" ${A_OUT}/>` +
      `<g clip-path="url(#${c})"><rect x="-10" y="-11" width="20" height="9" fill="#e53935"/><rect x="-10" y="-2" width="20" height="15" fill="#1565c0"/><rect x="-10" y="-3" width="20" height="1.6" fill="#fff"/></g>` +
      pawPrint(0, 5.2, .95, "#ffc107") + aStar(0, -6.5, 2.4, "#fff") + `</g>`; };

  /* ---- a pup: big front-facing head centred at 0,0 (head ~ ±25 x ±21, hat up to y -44) on one of four bodies (o.pose):
       "sit"  front view, sitting (paws at y 68); o.raise {k: -1|1, pts} lifts one front leg; o.hind "hang" = hind legs dangling (flying)
       "biped" front view, standing on the hind legs (feet at y 66); o.arms [{pts}] from the shoulders (±13,20), o.legPts, o.mid (between head and arms)
       "quad" side view on four legs, body behind the head (dir 1 = facing right, the body to the left); o.legs = a QLEGS key;
              o.pack is then drawn on the back (body coordinates, mirrored with it)
     o: fur, light (muzzle/paws), eyes, uni, uniD (collar), badge, ears{back, front}, marks (head), hat, pack, tilt, mouth "open"|"grin",
        headRx, brows, stripe, tail / tailCol / tailPts, front (drawn last) */
  function head(o) {
    const h = [], light = o.light || o.fur, rx = o.headRx || 25;
    if (o.ears && o.ears.back) h.push(o.ears.back);
    h.push(`<path d="M${-rx},2 Q${-rx},-21 0,-21 Q${rx},-21 ${rx},2 Q${rx - 1},18 ${rx - 9},20 Q0,25 ${9 - rx},20 Q${1 - rx},18 ${-rx},2Z" fill="${o.fur}" ${A_OUT}/>`);
    h.push(`<path d="M${-rx + .5},8 l-3.2,2.4 l3.6,1.2 l-2.4,2.8 l4,.4 M${rx - .5},8 l3.2,2.4 l-3.6,1.2 l2.4,2.8 l-4,.4" fill="${o.fur}" stroke="${A_OL}" stroke-width="1" stroke-linejoin="round"/>`);
    if (o.marks) h.push(o.marks);
    h.push(`<path d="M-12.5,10 Q-12,1.5 0,2 Q12,1.5 12.5,10 Q12,19.5 0,20 Q-12,19.5 -12.5,10Z" fill="${light}"/>`);
    h.push(`<path d="M-4.8,4.6 Q0,2.4 4.8,4.6 Q4.4,8.6 0,9.4 Q-4.4,8.6 -4.8,4.6Z" fill="#1a1a1a"/><ellipse cx="-1.4" cy="4.4" rx="1.7" ry=".8" fill="#fff" opacity=".7"/>`);
    if ((o.mouth || "open") === "open") h.push(`<path d="M0,9.4 V11.2" stroke="${A_OL}" stroke-width="1"/><path d="M-6,11.2 Q0,22.5 6,11.2 Q0,13.2 -6,11.2Z" fill="#8e1b1b" stroke="${A_OL}" stroke-width=".9" stroke-linejoin="round"/><path d="M-3.4,17.4 Q0,14 3.4,17.4 Q2.6,19.6 0,19.8 Q-2.6,19.6 -3.4,17.4Z" fill="#ff7c8a"/>`);
    else h.push(`<path d="M0,9.4 V11.6 M-6.2,11 Q-3,14.6 0,11.6 Q3,14.6 6.2,11" fill="none" stroke="${A_OL}" stroke-width="1.1" stroke-linecap="round"/>`);
    h.push(aEye(-10, -3, o.eyes, 1.3), aEye(10, -3, o.eyes, 1.3));
    h.push(`<ellipse cx="-16.5" cy="7" rx="2.4" ry="1.3" fill="#ff8a80" opacity=".55"/><ellipse cx="16.5" cy="7" rx="2.4" ry="1.3" fill="#ff8a80" opacity=".55"/>`);
    if (o.brows) h.push(o.brows);
    if (o.ears && o.ears.front) h.push(o.ears.front);
    if (o.hat) h.push(o.hat);
    return `<g transform="rotate(${o.tilt || 0} 0 12)">${h.join("")}</g>`;
  }
  const collar = o => P("M-15.5,14 Q0,23 15.5,14 L14.6,19.5 Q0,28 -14.6,19.5Z", o.uniD) + badge(o.badge, 0, 28, 6.8);
  const paw = (x, y, r, light) => aC(x, y, r, light, A_OUT);

  // side-view legs: [hip, knee, paw] (dir 1: front legs near x 0, hind legs near x -36)
  const QLEGS = {
    stand: { ff: [[-1, 38], [1, 52], [0, 63]], fn: [[7, 38], [9, 52], [9, 64]], hf: [[-30, 38], [-29, 52], [-31, 63]], hn: [[-39, 36], [-41, 50], [-38, 64]] },
    run: { ff: [[0, 38], [9, 50], [16, 56]], fn: [[6, 36], [16, 43], [25, 41]], hf: [[-34, 38], [-42, 50], [-50, 55]], hn: [[-40, 34], [-49, 43], [-55, 40]] },
    crouch: { ff: [[-1, 38], [5, 50], [3, 60]], fn: [[6, 38], [14, 50], [12, 60]], hf: [[-33, 38], [-40, 50], [-35, 60]], hn: [[-40, 36], [-48, 50], [-42, 60]] },
  };
  function quadBody(o) {
    const fur = o.fur, light = o.light || fur, L = QLEGS[o.legs || "stand"], s = [];
    const leg = (pts, far) => { const e = pts[2], f = E(e[0] + 1.8, e[1] + .3, 5.9, 3.9, light);
      return aL(pts, fur, 7.6) + f + (far ? shade(pts, 7.6) + `<ellipse cx="${e[0] + 1.8}" cy="${e[1] + .3}" rx="5.9" ry="3.9" fill="#000" opacity=".2"/>` : ""); };
    if (o.tail !== false) s.push(aL(o.tailPts || [[-46, 26], [-56, 16], [-55, 3]], o.tailCol || fur, 4.8));
    s.push(leg(L.ff, 1), leg(L.hf, 1), leg(L.hn), leg(L.fn));
    s.push(P("M8,16 Q15,26 12.5,38 Q11,46.5 0,47 L-34,46 Q-48,45 -48,32 Q-47,19 -34,18 L-8,15Z", fur));
    s.push(`<path d="M11.5,41 Q9,46.4 0,46.8 L-30,46 Q-14,43.5 0,43.5 Q8,43 11.5,41Z" fill="${light}"/>`);
    s.push(P("M9,17 Q15,26 13,36.5 Q-10,42 -31,38 Q-34,27 -31,17.4 L-8,15Z", o.uni),
      `<path d="M13,31 Q-10,37 -32.4,33 L-31,38 Q-10,42 13,36.5Z" fill="#000" opacity=".13"/>`);
    if (o.stripe) s.push(`<path d="M13.2,29 Q-10,35 -32.6,31 L-32.7,35 Q-10,39 13,33.4Z" fill="${o.stripe}" stroke="${A_OL}" stroke-width=".7"/>`);
    s.push(E(-38.5, 33, 10.5, 11.5, fur, ""), `<path d="M-38,44 Q-30,42 -28.6,34" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="3" stroke-linecap="round"/>`,
      `<path d="M-29.5,27 Q-26.6,38 -32,43.4" fill="none" stroke="${A_OL}" stroke-width="1.1" stroke-linecap="round"/>`);
    if (o.pack) s.push(o.pack);
    return `<g transform="scale(${o.dir || 1} 1)">${s.join("")}</g>`;
  }
  // limbs of the biped: o.ow = outline width (default aL's 1.1), o.furShade = a soft shade along the lower right of white fur
  const olw = o => o.ow ? `stroke="${A_OL}" stroke-width="${o.ow}"` : A_OUT;
  const limb = (o, pts, w) => {
    if (!o.ow && !o.furShade) return aL(pts, o.fur, w);
    const ln = (q, c, ww, ex = "") => `<polyline points="${aPts(q)}" fill="none" stroke="${c}" stroke-width="${ww}" stroke-linecap="round" stroke-linejoin="round" ${ex}/>`;
    return ln(pts, A_OL, w + 2 * (o.ow || 1.1)) + ln(pts, o.fur, w) +
      (o.furShade ? ln(pts.map(([x, y]) => [x + w * .26, y + w * .14]), o.furShade, +(w * .36).toFixed(1), `opacity=".45"`) : ""); };
  function pup(o) {
    const s = [], pose = o.pose || "sit", light = o.light || o.fur;
    if (pose === "quad") s.push(quadBody(o), collar(o), head(o));
    else if (pose === "biped") {
      if (o.pack) s.push(o.pack);
      if (o.tail !== false) s.push(aL(o.tailPts || [[12, 46], [24, 40], [27, 28]], o.tailCol || o.fur, 4.6));
      for (const [i, pts] of (o.legPts || [[[-8, 44], [-9, 56], [-10, 64]], [[8, 44], [9, 56], [10, 64]]]).entries()) {
        const k = i ? 1 : -1, e = pts[pts.length - 1];
        s.push(limb(o, pts, o.legW || 8.4), E(e[0] + k * 1.6, e[1] + 1.4, 7, 4.3, light, olw(o)),
          `<path d="M${e[0] + k * 1.6 - 2.2},${e[1] - .4} v3.2 M${e[0] + k * 1.6 + 2.2},${e[1] - .4} v3.2" stroke="${A_OL}" stroke-width=".7" stroke-linecap="round"/>`);
      }
      s.push(`<path d="M-14,13 Q-20,32 -15,50 Q0,56 15,50 Q20,32 14,13Z" fill="${o.fur}" ${olw(o)} stroke-linejoin="round"/>`,
        `<path d="M-9,52.5 Q0,55 9,52.5 Q8,47 0,46.5 Q-8,47 -9,52.5Z" fill="${light}"/>`,
        `<path d="M-14.6,14 Q-19.8,30 -17.4,43 Q0,48.5 17.4,43 Q19.8,30 14.6,14Z" fill="${o.uni}" ${olw(o)} stroke-linejoin="round"/>`,
        `<path d="M9.6,16 Q16.5,30 14.6,44.6 Q16.4,44 17.4,43 Q19.8,30 14.6,14Z" fill="#000" opacity=".13"/>`);
      if (o.stripe) s.push(`<path d="M-18.6,37.6 Q0,43.2 18.6,37.6 L17.8,42 Q0,47.6 -17.8,42Z" fill="${o.stripe}" stroke="${A_OL}" stroke-width=".7"/>`);
      s.push(collar(o), head(o));
      if (o.mid) s.push(o.mid);
      for (const a of o.arms || []) { const e = a.pts[a.pts.length - 1]; s.push(limb(o, a.pts, 7.4), aC(e[0], e[1], 5.2, light, olw(o))); }
    } else {
      if (o.pack) s.push(o.pack);
      if (o.tail !== false) s.push(aL([[15, 56], [28, 50], [33, 38]], o.tailCol || o.fur, 4.6));
      if ((o.hind || "sit") === "sit") for (const k of [-1, 1]) s.push(E(k * 18, 53, 10.5, 10, o.fur), E(k * 24, 64.5, 7.6, 4.3, light));
      else for (const k of [-1, 1]) s.push(aL([[k * 12, 52], [k * 15, 66]], o.fur, 6.5), E(k * 15.5, 68, 5.4, 3.6, light));
      s.push(P("M-14,13 Q-23,38 -19,61 Q0,67 19,61 Q23,38 14,13Z", o.uni),
        `<path d="M9,16 Q18,38 15,62 Q18,61.5 19,61 Q23,38 14,13Z" fill="#000" opacity=".13"/>`);
      if (o.stripe) s.push(`<path d="M-21,44 Q0,49 21,44 L21.3,49 Q0,54 -21.3,49Z" fill="${o.stripe}" stroke="${A_OL}" stroke-width=".7"/>`);
      for (const k of [-1, 1]) if (!o.raise || o.raise.k !== k) s.push(aL([[k * 8.5, 36], [k * 9.2, 61]], o.fur, 7.6), E(k * 9.6, 64.3, 6.6, 4.4, light),
        `<path d="M${k * 9.6 - 2},62.6 v3 M${k * 9.6 + 2},62.6 v3" stroke="${A_OL}" stroke-width=".7" stroke-linecap="round"/>`);
      s.push(collar(o), head(o));
      if (o.raise) { const r = o.raise, end = r.pts[r.pts.length - 1]; s.push(aL(r.pts, o.fur, 7.6), paw(end[0], end[1], 5.4, light), r.paw || ""); }
    }
    if (o.front) s.push(o.front);
    return s.join("");
  }
  const tf = (x, y, sc, rot = 0) => `translate(${x} ${y}) scale(${sc}) rotate(${rot})`;
  const place = (svg, x = 60, y = 58, sc = 1.25, rot = 0) => `<g transform="${tf(x, y, sc, rot)}">${svg}</g>`;

  /* ---- ears (left one drawn, mirrored) ---- */
  const earUp = (out, inn) => mir(`<path d="M-8,-17 Q-18,-31 -23,-38 Q-28,-21 -23.5,-4Z" fill="${out}" ${A_OUT} stroke-linejoin="round"/><path d="M-11,-14 Q-18,-26 -21.5,-31 Q-24,-19 -21,-8Z" fill="${inn}"/>`);
  const earFlop = (c, tip) => mir(`<path d="M-14,-18 Q-29,-20 -32,-2 Q-34,13 -27,17 Q-20,15 -20.5,3 Q-20.5,-9 -12,-12Z" fill="${c}" ${A_OUT} stroke-linejoin="round"/>` +
    (tip ? `<path d="M-32.6,4 Q-33.5,13 -27,17 Q-21,15 -20.6,6 Q-26,9 -32.6,4Z" fill="${tip}"/>` : ""));

  /* ---- backdrops ---- */
  const lookout = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">` +
    P("M-9,0 L-5,-62 H5 L9,0Z", "#eceff1") + `<path d="M2,-62 H5 L9,0 H4Z" fill="#000" opacity=".1"/>` +
    P("M-3,-55 H3 V-6 H-3Z", "#90caf9") + shield(0, -30, .45) +
    P("M-14,0 L-12,-6 H12 L14,0Z", "#e53935") +
    P("M-5,-62 L-8,-66 H8 L5,-62Z", "#b0bec5") +
    P("M-11,-66 Q-14,-73 -11,-80 H11 Q14,-73 11,-66Z", "#4fc3f7") + `<path d="M-6,-66 V-80 M0,-66 V-80 M6,-66 V-80" stroke="#fff" stroke-width=".9" opacity=".8"/>` +
    P("M-13,-80 Q0,-84 13,-80 L9,-86 Q0,-89 -9,-86Z", "#eceff1") + P("M-4,-87 Q0,-96 4,-87Z", "#e53935") +
    `<path d="M0,-94 V-101" stroke="${A_OL}" stroke-width="1.2"/>${aC(0, -101.5, 1.5, "#ffd54f", A_OUT)}` +
    `</g>`;
  const bay = (lookX = 92) => sky("#5ec8f2", "#c9f0ff") + A_RAYS + cloud(8, 22, .9) + cloud(80, 14, .7) +
    `<rect y="98" width="120" height="60" fill="#1e88e5"/><path d="M0,104 Q10,102 20,104 T40,104 T60,104 T80,104 T100,104 T120,104" fill="none" stroke="#bbdefb" stroke-width="1.2"/>` +
    `<path d="M-5,112 Q20,90 45,104 Q70,92 95,100 Q112,94 125,98 V158 H-5Z" fill="#7cc142"/><path d="M-5,126 Q30,112 60,124 Q90,114 125,120 V158 H-5Z" fill="#5ea832"/>` +
    lookout(lookX, 104, .95);

  /* ---- 1 Ryder ---- */
  function ryder() {
    const skin = "#f8d3b4", sh = "#1e88e5";
    const pad = `<g transform="translate(79 58) rotate(12)">${R(-8, -11, 16, 21, 3, "#cfd8dc")}${R(-6, -8.5, 12, 14, 1.5, "#263238", "")}` +
      pawPrint(0, -1.5, .9, "#4fc3f7") + aC(0, 7.6, 1.2, "#90a4ae") + `</g>`;
    const body = P("M38,74 L36.5,101 L48.5,101 L50,82 L51.5,101 L63.5,101 L62,74Z", "#283593") +
      `<path d="M50,82 V100" stroke="${A_OL}" stroke-width=".8"/>` +
      P("M34.5,104 Q35,98.5 42,99 Q49.5,99 49.5,104 Q42,106.5 34.5,104Z", "#fff") + P("M50.5,104 Q50.5,99 58,99 Q65,98.5 65.5,104 Q58,106.5 50.5,104Z", "#fff") +
      `<path d="M36,103 H48.5 M51.5,103 H64" stroke="#ff8f00" stroke-width="1.1"/>` +
      aL([[36, 49], [29.5, 62], [32, 73]], sh, 6.4) + aC(32.5, 75.5, 3.7, skin, A_OUT) +
      P("M46,39 H54 V47 H46Z", skin) +
      P("M34,49 Q38,44 46,44 L50,48 L54,44 Q62,44 66,49 L64.5,77 Q50,80 35.5,77Z", sh) +
      P("M35,50 Q38,45.5 45.5,45 L48,64 L47,77.5 Q40,77.6 35.6,76.6Z", "#ff8f00") + P("M65,50 Q62,45.5 54.5,45 L52,64 L53,77.5 Q60,77.6 64.4,76.6Z", "#ff8f00") +
      `<path d="M35.4,57 L46.6,55.6 L46.9,59.4 L35.6,61Z M64.6,57 L53.4,55.6 L53.1,59.4 L64.4,61Z" fill="#fff" stroke="${A_OL}" stroke-width=".7"/>` +
      `<path d="M36,70 L47.4,70 M64,70 L52.6,70" stroke="#fff" stroke-width="2.2"/>` +
      shield(41, 64, .38) +
      aL([[64, 49], [72, 58], [76, 54]], sh, 6.4) + pad + aC(75, 54, 3.7, skin, A_OUT);
    const hd = aKidHead({ skin, hair: "#8a5a32", hs: "spiky", eyes: "#7a5a46", mouth: "smile" });
    const fig = `<g transform="translate(-4 13) scale(1.24)">${body}${hd}</g>`;
    return [bay(98) + shadow(58, 144, 26) + sparks([[14, 46, 3.4], [106, 128, 3], [22, 136, 2.4, "#fff59d"]]), aEdge(fig)];
  }

  /* ---- 2 Chase: standing at attention, saluting; the megaphone pops out of his pup-pack ---- */
  function chase() {
    const fur = "#c27a3c", dark = "#6b3b1d", tan = "#f2c588";
    const hat = P("M-19,-13 Q-23,-27 -15,-34 Q0,-40 15,-34 Q23,-27 19,-13 Q0,-17 -19,-13Z", "#1f5fc2") +
      `<path d="M8,-36 Q19,-31 19,-14 Q15,-16 12,-15.5Q14,-26 8,-36Z" fill="#000" opacity=".15"/>` +
      P("M-19.5,-13 Q0,-17 19.5,-13 L20,-18 Q0,-22 -20,-18Z", "#0d3b80") +
      P("M-17,-13.5 Q0,-18 17,-13.5 Q12,-8.6 0,-8.3 Q-12,-8.6 -17,-13.5Z", "#1a1a1a") + `<path d="M-11,-12 Q0,-14.5 11,-12" stroke="#fff" stroke-width=".9" opacity=".35" fill="none"/>` +
      `<g transform="translate(0 -27) scale(.6)"><path d="M0,-8 L6.5,-5 L6,2 Q5,6.5 0,9 Q-5,6.5 -6,2 L-6.5,-5Z" fill="#ffd54f" stroke="${A_OL}" stroke-width="1"/>${aStar(0, 0, 3.6, "#1565c0")}</g>`;
    const marks = `<path d="M-24,0 Q-24,-20 0,-21 Q24,-20 24,0 Q17,-6 9,-11 Q0,-7 -9,-11 Q-17,-6 -24,0Z" fill="${dark}"/>` +
      `<path d="M-23,3 Q-16,-4 -10,-8 Q-3,-4 0,2 Q3,-4 10,-8 Q16,-4 23,3 Q23,14 16,18 Q0,23 -16,18 Q-23,14 -23,3Z" fill="${fur}"/>`;
    const brows = `<path d="M-15,-11.5 L-6,-9.5 M15,-11.5 L6,-9.5" stroke="${dark}" stroke-width="1.6" stroke-linecap="round"/>`;
    // pup-pack: a blue pack behind the shoulders, a grey arm and a big white-and-blue megaphone over his left shoulder
    const MEG = [27, -6, -38];
    const meg = `<g transform="translate(${MEG[0]} ${MEG[1]}) rotate(${MEG[2]})">` + R(-6, -4, 6, 8, 1.5, "#0d3b80") +
      P("M-1,-4 L14,-10.5 Q16.4,0 14,10.5 L-1,4Z", "#fff") + `<path d="M5,-6.4 L9,-8.1 Q10.4,0 9,8.1 L5,6.4 Q5.8,0 5,-6.4Z" fill="#1f5fc2"/>` +
      `<path d="M-1,1.6 L14.6,6.5 Q14.2,9 14,10.5 L-1,4Z" fill="#000" opacity=".12"/>` +
      E(14.2, 0, 3, 10.5, "#1565c0") + E(14.6, 0, 1.6, 7.6, "#0b2a5c", "") + `</g>`;
    const pack = mir(R(-19, 12, 7, 14, 2.5, "#0d3b80")) + aL([[12, 14], [20, 6], [24, -2]], "#90a4ae", 3.4) + meg;
    const p = pup({ pose: "biped", fur, light: tan, eyes: "#7b4a1e", uni: "#2060c8", uniD: "#0d3b80", badge: "police", tailCol: dark, hat, marks, brows, pack, mouth: "grin",
      ears: { back: earUp(dark, "#f0b27a") }, tilt: -3, tailPts: [[-12, 46], [-24, 41], [-28, 30]],
      arms: [{ pts: [[-13, 20], [-27, 12], [-21.5, -9]] }, { pts: [[13, 20], [17, 31], [16.5, 41]] }] });
    const T = [60, 61, 1.2];
    const sound = `<g transform="${tf(...T)}"><g transform="translate(${MEG[0]} ${MEG[1]}) rotate(${MEG[2]})" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round">` +
      `<path d="M20,-8 Q23.5,0 20,8"/><path d="M25,-11 Q30,0 25,11" opacity=".75"/></g></g>`;
    const town = [[0, 70, 14, "#f8bbd0"], [13, 60, 12, "#fff59d"], [86, 64, 14, "#c5e1a5"], [99, 54, 12, "#b3e5fc"], [110, 68, 12, "#ffccbc"]]
      .map(([x, y, w, c]) => R(x, y, w, 120 - y, 1, c, `stroke="#1a3e7a" stroke-width=".8"`) + [0, 1, 2].map(i => R(x + 3, y + 6 + i * 11, w - 6, 5, .8, "#5c8ad6", "")).join("")).join("");
    const cone = x => `<g transform="translate(${x} 132)">${P("M-5,8 L-1.5,-9 H1.5 L5,8Z", "#ff7043")}<path d="M-3.3,0 H3.3" stroke="#fff" stroke-width="2.2"/>${R(-7, 7, 14, 3, 1, "#e64a19")}</g>`;
    return [sky("#1e5fbf", "#8fd3ff") + A_RAYS + town + `<rect y="118" width="120" height="40" fill="#78909c"/><path d="M0,138 H120" stroke="#fff" stroke-width="2" stroke-dasharray="8 6"/>` +
            shadow(60, 143, 26) + cone(12) + cone(108) + sound + sparks([[16, 66, 3], [106, 98, 3.2]]), aEdge(place(p, ...T))];
  }

  /* ---- 3 Marshall: standing on his hind legs, both paws on the hose nozzle, the water arcing high onto a burning house ---- */
  function marshall() {
    const spot = (x, y, r) => aC(x, y, r, "#1a1a1a");
    const marks = spot(-17, -12, 2.3) + spot(15, -15, 1.8) + spot(-20, 9, 1.6) + spot(19, 6, 2) + spot(-6, -17, 1.4) + spot(22, -4, 1.2);
    const ears = { front: mir(`<path d="M-14,-18 Q-29,-20 -32,-2 Q-34,13 -27,17 Q-20,15 -20.5,3 Q-20.5,-9 -12,-12Z" fill="#fff" ${A_OUT} stroke-linejoin="round"/>`) +
      aC(-28, 2, 2.3, "#1a1a1a") + aC(-25, 11, 1.7, "#1a1a1a") + aC(28.5, -4, 2, "#1a1a1a") + aC(26, 8, 2.4, "#1a1a1a") };
    const hat = E(0, -13, 27, 5.2, "#c62828") + P("M-19,-13 Q-21,-36 0,-37 Q21,-36 19,-13Z", "#e53935") +
      `<path d="M9,-35 Q19,-30 19,-14 L13,-14 Q14,-28 9,-35Z" fill="#000" opacity=".14"/><path d="M-12,-30 Q-6,-35 2,-35" stroke="#fff" stroke-width="1.6" fill="none" opacity=".5" stroke-linecap="round"/>` +
      P("M-26,-12 Q0,-5 26,-12 Q24,-8.5 18,-8.6 Q0,-5 -18,-8.6 Q-24,-8.5 -26,-12Z", "#b71c1c") +
      P("M-7,-17 L-8.5,-38 Q0,-44 8.5,-38 L7,-17 Q0,-14.5 -7,-17Z", "#ffd54f") + `<g transform="translate(0 -28) scale(.55)">${SYM.fire[1]().replace(/#ffd54f/g, "#e53935").replace(/#ff8f00/g, "#ffd54f")}</g>`;
    // pup-pack: two red tanks with yellow caps behind the shoulders; a red hose from the right tank round his side to the nozzle
    const pack = mir(R(-22, 9, 9, 18, 3, "#e53935", `stroke="${A_OL}" stroke-width="1.4"`) + R(-22.6, 8, 10.2, 4, 1.4, "#ffd54f"));
    const NZ = [7, 50, -50];               // nozzle base and angle; the paws grip it 4 and 13 along
    const at = t => [NZ[0] + t * Math.cos(NZ[2] * Math.PI / 180), NZ[1] + t * Math.sin(NZ[2] * Math.PI / 180)];
    const nozzle = `<g transform="translate(${NZ[0]} ${NZ[1]}) rotate(${NZ[2]})">` + `<path d="M2,-4.6 L29,-2.8 L29,2.8 L2,4.6Z" fill="#ffc107" stroke="${A_OL}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M4,-2 L28,-1.2" stroke="#fff" stroke-width="1" opacity=".6"/>` + R(-2, -4.6, 5, 9.2, 1.5, "#9e9e9e") + R(28, -4, 5.5, 8, 1.6, "#e53935", `stroke="${A_OL}" stroke-width="1.4"`) + `</g>`;
    const hose = aL([[19, 22], [28, 38], [24, 56], [10, 58], [5, 53]], "#c62828", 3.8);
    const spots = spot(-11, 58, 1.5) + spot(10.5, 60, 1.3) + spot(-13.6, 50, 1.2) + spot(-29, 33, 1.4);
    const belly = `<path d="M7,44.6 Q15,43.6 18.6,41.6 Q18.6,48 15.6,50.8 Q9,53 4,53.4Z" fill="#9fb3c8" opacity=".5"/>`;
    const p = pup({ pose: "biped", fur: "#fff", light: "#fff", furShade: "#8aa2bd", ow: 1.5, legW: 9.6, eyes: "#2f8ee0", uni: "#e53935", uniD: "#b71c1c", stripe: "#ffd54f",
      badge: "fire", marks, ears, hat, pack, tilt: -4, tailPts: [[-12, 47], [-24, 42], [-30, 32]],
      legPts: [[[-8, 44], [-10, 56], [-12, 64]], [[8, 44], [10, 56], [12, 64]]],
      mid: belly + hose + nozzle + spots,
      arms: [{ pts: [[-13, 21], [-9, 45], at(4)] }, { pts: [[13, 21], [24, 28], at(13)] }] });
    // the water: from the nozzle tip high over the right side of his helmet down onto the fire
    const tip = at(33), W = `M${tip[0].toFixed(1)},${tip[1].toFixed(1)} Q50,-26 56,2`;
    const water = `<g fill="none" stroke-linecap="round"><path d="${W}" stroke="#0288d1" stroke-width="7.6"/><path d="${W}" stroke="#4fc3f7" stroke-width="5.6"/><path d="${W}" stroke="#e1f5fe" stroke-width="2"/></g>` +
      [[56, 8, 2.6], [52, 11, 2], [60, 12, 1.8], [55, 16, 1.5]].map(([x, y, r]) => aC(x, y, r, "#b3e5fc", `stroke="#0288d1" stroke-width=".7"`)).join("");
    const T = [47, 64, 1.18];
    const flame = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-6,4 Q-12,-10 -4,-22 Q-3,-12 2,-10 Q2,-20 8,-26 Q16,-12 8,4Z" fill="#ff7043"/><path d="M-2,4 Q-4,-6 2,-13 Q6,-5 5,4Z" fill="#ffeb3b"/></g>`;
    const house = `<g transform="translate(104 70)">${P("M-12,56 V12 L5,-5 L22,12 V56Z", "#ffe0b2")}${P("M-15,13 L5,-8 L25,13 L21,14 L5,-2 L-11,14Z", "#a1887f")}` +
      R(-6, 22, 10, 11, 1, "#ff8f00") + `<path d="M-1,22 V33 M-6,27.5 H4" stroke="${A_OL}" stroke-width=".8"/>` + R(4, 38, 9, 18, 1, "#8d6e63") + flame(5, -6, 1) + flame(-1, 26, .55) + `</g>`;
    return [sky("#ff8a50", "#ffe082") + A_RAYS + house + `<path d="M0,122 Q60,112 120,122 V158 H0Z" fill="#8d6e63"/><rect y="130" width="120" height="28" fill="#9e9e9e"/>` +
            shadow(47, 142, 28) + sparks([[10, 52, 3], [16, 116, 2.6], [70, 18, 2.4]]),
      aEdge(place(p + water, ...T))];
  }

  /* ---- 4 Skye: flying with her pup-pack wings ---- */
  function skye() {
    const fur = "#e6b980", light = "#fff3e0", brown = "#b07a4a";
    const marks = `<path d="M-6,-21 Q0,-27 7,-21 Q4,-16 0,-15 Q-4,-16 -6,-21Z" fill="${brown}"/>`;
    const ears = { front: earFlop(brown, "#8d5a32") };
    const hat = P("M-21,-11 Q-23,-34 0,-35 Q23,-34 21,-11 Q0,-17 -21,-11Z", "#f06292") +
      `<path d="M9,-33 Q20,-28 20,-12 L14,-13 Q15,-26 9,-33Z" fill="#000" opacity=".12"/>` +
      `<path d="M-21,-19 Q0,-25 21,-19" stroke="#ad1457" stroke-width="2.4" fill="none"/>` +
      mir(aC(-8, -21, 6.6, "#ad1457", A_OUT) + aC(-8, -21, 4.6, "#f8bbd0", A_OUT) + `<path d="M-10.5,-23 Q-8.5,-25 -6,-24" stroke="#fff" stroke-width="1.1" fill="none" stroke-linecap="round"/>`) +
      `<path d="M-4,-36 Q0,-42 4,-36" fill="#fff59d" stroke="${A_OL}" stroke-width="1"/>`;
    const wing = `<path d="M-14,18 L-56,2 Q-60,8 -55,12 L-50,14 Q-54,18 -48,20 L-15,30Z" fill="#f48fb1" ${A_OUT} stroke-linejoin="round"/>` +
      `<path d="M-20,22 L-52,10 M-18,27 L-46,19" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>` +
      R(-30, 22, 10, 7, 3, "#bdbdbd") + `<path d="M-29,29 L-26,37 L-23,29Z" fill="#ffb74d"/>`;
    const p = pup({ fur, light, eyes: "#c2185b", uni: "#f06292", uniD: "#ad1457", badge: "prop", marks, ears, hat, pack: mir(wing), hind: "hang", tilt: 6, mouth: "open",
      raise: { k: 1, pts: [[9, 34], [22, 26], [32, 16]] } });
    return [sky("#4fb3f6", "#d6f1ff") + A_RAYS + cloud(4, 120, 1.3) + cloud(76, 132, 1.5) + cloud(86, 26, .8, "#fff", .85) + cloud(-4, 30, .7, "#fff", .8) +
      `<path d="M8,96 Q18,92 28,96" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/><path d="M4,104 Q14,100 22,104" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>` +
      sparks([[104, 52, 3.4], [14, 64, 2.8], [100, 104, 2.6, "#fff59d"]]), aEdge(place(p, 62, 64, 1.12, -12))];
  }

  /* ---- 5 Rubble: standing, digging with his shovel ---- */
  function rubble() {
    const fur = "#d9a05b", light = "#fff8ec";
    const marks = `<path d="M-4,-21 Q0,-22 4,-21 L6,4 H-6Z" fill="${light}"/>` + `<path d="M-22,10 Q-16,20 -6,21 M22,10 Q16,20 6,21" fill="none" stroke="#a86e32" stroke-width="1" opacity=".7"/>`;
    const ears = { front: mir(`<path d="M-15,-17 Q-26,-22 -30,-12 Q-27,-6 -21,-8 Q-21,-13 -15,-12Z" fill="#a86e32" ${A_OUT} stroke-linejoin="round"/>`) };
    const hat = P("M-20,-12 Q-21,-35 0,-36 Q21,-35 20,-12Z", "#fdd835") + `<path d="M9,-34 Q19,-29 19,-13 L13,-13 Q14,-27 9,-34Z" fill="#000" opacity=".12"/>` +
      P("M-3.4,-35.6 Q0,-37.2 3.4,-35.6 L3.4,-13 H-3.4Z", "#fbc02d") +
      P("M-25,-12 Q0,-18 25,-12 Q26,-7.5 20,-7.8 Q0,-12 -20,-7.8 Q-26,-7.5 -25,-12Z", "#f9a825") +
      `<path d="M-14,-28 Q-9,-33 -4,-33.5" stroke="#fff" stroke-width="1.6" fill="none" opacity=".55" stroke-linecap="round"/>`;
    // the shovel held across the body (both paws on the handle), the blade scooping dirt on the right
    const A = [-24, 33], B = [30, 48], ang = Math.atan2(B[1] - A[1], B[0] - A[0]) * 180 / Math.PI;
    const shovel = `<path d="M${A} L${B}" stroke="${A_OL}" stroke-width="5" stroke-linecap="round"/><path d="M${A} L${B}" stroke="#8d6e63" stroke-width="2.8" stroke-linecap="round"/>` +
      `<g transform="translate(${A}) rotate(${ang.toFixed(1)})">${R(-2, -5, 4, 10, 1.5, "#ffca28")}</g>` +
      `<g transform="translate(${B}) rotate(${ang.toFixed(1)})">${P("M-2,-6.5 H8 Q17,-6 19,0 Q17,6 8,6.5 H-2Z", "#90a4ae")}<path d="M1,-3.5 H12" stroke="#fff" stroke-width="1.2" opacity=".6"/>` +
      `<path d="M3,-6 Q8,-11 14,-6 Q11,-3 3,-6Z" fill="#8d5a2b" stroke="${A_OL}" stroke-width=".8"/></g>`;
    const pack = mir(R(-21, 11, 9, 15, 3, "#fbc02d"));
    const p = pup({ pose: "biped", fur, light, eyes: "#7a4a1e", uni: "#fdd835", uniD: "#f9a825", badge: "shovel", marks, ears, hat, pack, headRx: 27, tail: false, mouth: "open", tilt: 4,
      legPts: [[[-8, 44], [-13, 55], [-15, 64]], [[8, 44], [13, 55], [15, 64]]], mid: shovel,
      arms: [{ pts: [[-13, 20], [-23, 26], [-18.6, 34]] }, { pts: [[13, 20], [21, 32], [20, 44]] }] });
    const dirt = (x, y, w, c) => `<path d="M${x - w},${y} Q${x - w * .5},${y - w * .7} ${x},${y - w * .75} Q${x + w * .55},${y - w * .7} ${x + w},${y}Z" fill="${c}"/>`;
    const crane = `<g opacity=".8"><path d="M18,120 V30 M14,120 V30 M14,30 H86 M18,40 L28,30 M22,30 L14,40" stroke="#ff8f00" stroke-width="2"/><path d="M80,30 V64" stroke="#555" stroke-width="1"/>${R(75, 64, 10, 7, 1, "#ffb300", "")}</g>`;
    const clods = [[108, 96, 2.6], [102, 88, 2], [113, 86, 1.7], [97, 98, 1.6]].map(([x, y, r]) => aC(x, y, r, "#8d5a2b", `stroke="${A_OL}" stroke-width=".6"`)).join("");
    return [sky("#ffb74d", "#fff3c4") + A_RAYS + crane + dirt(18, 128, 28, "#a1683a") + dirt(104, 130, 22, "#b97a45") +
      `<rect y="124" width="120" height="34" fill="#c58b4f"/>` + `<path d="M0,124 H120" stroke="#8d5a2b" stroke-width="1.2"/>` + dirt(102, 134, 16, "#a1683a") +
      shadow(56, 141, 28) + clods + sparks([[108, 54, 3.2], [12, 100, 2.8]]), aEdge(place(p, 54, 62, 1.18))];
  }

  /* ---- 6 Rocky: sitting, wrench up ---- */
  function rocky() {
    const fur = "#9aa5ad", light = "#f3f5f6", dark = "#6f7b84";
    const marks = `<path d="M-24,0 Q-24,-20 -4,-21 Q-9,-12 -16,-6 Q-21,-3 -24,0Z" fill="${dark}" opacity=".6"/>` +
      `<path d="M-6,-20 L-3,-27 L0,-20 L3,-28 L6,-20" fill="${fur}" stroke="${A_OL}" stroke-width="1" stroke-linejoin="round"/>`;
    const ears = { back: `<path d="M-9,-17 Q-20,-30 -26,-34 Q-29,-20 -23.5,-5Z" fill="${dark}" ${A_OUT} stroke-linejoin="round"/>`,
      front: `<path d="M14,-17 Q27,-24 33,-12 Q34,-2 29,4 Q26,-6 20,-10Z" fill="${dark}" ${A_OUT} stroke-linejoin="round"/>` };
    const hat = P("M-19,-12 Q-21,-33 0,-34 Q21,-33 19,-12 Q0,-16 -19,-12Z", "#43a047") + `<path d="M9,-32 Q19,-27 19,-13 L13,-13 Q14,-26 9,-32Z" fill="#000" opacity=".12"/>` +
      P("M-18,-12.5 Q0,-17 18,-12.5 Q13,-7.6 0,-7.4 Q-13,-7.6 -18,-12.5Z", "#2e7d32") + aC(0, -34, 2, "#2e7d32", A_OUT) +
      `<g transform="translate(0 -24) scale(.5)">${aC(0, 0, 9, "#fff")}${SYM.recycle[1]().replace(/#fff/g, "#2e7d32")}</g>`;
    const wrench = `<g transform="translate(-28 7) rotate(-22)">` + R(-2.6, -2, 5.2, 26, 2, "#b0bec5") +
      P("M-7,-10 Q-7,-18 0,-19 L0,-13 L4,-13 L4,-19 Q8,-18 8,-10 Q6,-3 0,-3 Q-6,-3 -7,-10Z", "#b0bec5") + `<path d="M-1,4 V18" stroke="#fff" stroke-width="1" opacity=".7"/></g>` + paw(-26, 17, 5.4, light);
    const pack = mir(R(-22, 10, 10, 15, 3, "#2e7d32"));
    const p = pup({ fur, light, eyes: "#8a5a2e", uni: "#43a047", uniD: "#2e7d32", badge: "recycle", marks, ears, hat, pack, tilt: 6,
      raise: { k: -1, pts: [[-9, 34], [-21, 28], [-26, 17]] } });
    const bin = `<g transform="translate(100 112)">${P("M-11,-14 H11 L9,18 H-9Z", "#2e7d32")}${R(-13, -18, 26, 5, 1.5, "#1b5e20")}` +
      `<g transform="translate(0 2) scale(.75)">${aC(0, 0, 9, "#fff")}${SYM.recycle[1]().replace(/#fff/g, "#2e7d32")}</g></g>`;
    const gear = (x, y, r, c) => `<g transform="translate(${x} ${y})" fill="${c}">${[...Array(8)].map((_, i) => `<rect x="-1.6" y="${-r - 2.4}" width="3.2" height="4" transform="rotate(${i * 45})"/>`).join("")}${aC(0, 0, r, c)}${aC(0, 0, r * .4, "#c8e6c9")}</g>`;
    return [sky("#8bd3f7", "#e3f7ff") + A_RAYS + gear(14, 26, 7, "#a5d6a7") + gear(104, 40, 5, "#a5d6a7") +
      `<path d="M-5,112 Q30,96 60,108 Q90,98 125,108 V158 H-5Z" fill="#66bb6a"/><path d="M-5,130 Q40,120 70,128 Q100,120 125,126 V158 H-5Z" fill="#4caf50"/>` + bin +
      shadow(58, 144, 30) + sparks([[18, 56, 3], [108, 74, 2.6], [12, 128, 2.4, "#fff59d"]]), aEdge(place(p + wrench, 58, 60, 1.2))];
  }

  /* ---- 7 Zuma: surfing a wave ---- */
  function zuma() {
    const fur = "#7a4a26", light = "#c99060";
    const ears = { front: earFlop("#5a3218") };
    const hat = P("M-20,-11 Q-22,-34 0,-35 Q22,-34 20,-11 Q0,-16 -20,-11Z", "#fb8c00") + `<path d="M9,-33 Q19,-28 19,-12 L13,-12 Q14,-26 9,-33Z" fill="#000" opacity=".12"/>` +
      `<path d="M-20,-19 Q0,-25 20,-19" stroke="#e65100" stroke-width="2.2" fill="none"/>` +
      mir(aC(-7.6, -22, 5.6, "#37474f", A_OUT) + aC(-7.6, -22, 3.8, "#4dd0e1", "") + `<path d="M-9.8,-23.6 Q-8,-25.2 -6,-24.6" stroke="#fff" stroke-width="1" fill="none"/>`) +
      `<path d="M-2,-34.6 Q0,-38 2,-34.6" stroke="${A_OL}" stroke-width="1" fill="#ffeb3b"/>`;
    // pup-pack (body coordinates): orange pack with two air tanks and a little propeller
    const pack = R(-30, 3, 20, 11, 3.5, "#ef6c00") + R(-27, -1, 6, 8, 2.5, "#cfd8dc") + R(-19, -1, 6, 8, 2.5, "#cfd8dc") +
      `<g transform="translate(-8 4)">${E(0, -4, 1.6, 4, "#90a4ae")}${E(0, 4, 1.6, 4, "#90a4ae")}${aC(0, 0, 1.6, "#455a64", "")}</g>`;
    const p = pup({ pose: "quad", legs: "crouch", dir: -1, fur, light, eyes: "#8d5524", uni: "#fb8c00", uniD: "#e65100", badge: "anchor", ears, hat, pack, tilt: 6,
      tailPts: [[-46, 26], [-55, 20], [-58, 10]] });
    // surfboard under the paws (nose to the left)
    const board = P("M-30,63 Q-26,58 -14,58.6 L56,60 Q64,61 64,64.5 Q63,68 55,68 L-14,67.4 Q-28,67 -30,63Z", "#ffca28") +
      `<path d="M-24,62.8 L58,64.2" stroke="#e53935" stroke-width="2.4"/><path d="M-14,60 L50,61.2" stroke="#fff" stroke-width="1" opacity=".7"/>`;
    const waves = (y, c, a) => `<path d="M-5,${y} ${[...Array(9)].map((_, i) => `Q${i * 16 + 3},${y - a} ${i * 16 + 11},${y}`).join(" ")} V158 H-5Z" fill="${c}"/>`;
    const curl = `<path d="M60,158 Q72,92 112,62 Q130,56 128,90 Q120,74 108,82 Q86,100 92,158Z" fill="#0277bd"/>` +
      `<path d="M112,62 Q130,56 128,90 Q122,80 112,82 Q104,74 112,62Z" fill="#e1f5fe" stroke="#0288d1" stroke-width=".8"/>` +
      `<path d="M74,140 Q82,104 106,80" stroke="#4fc3f7" stroke-width="2" fill="none" opacity=".8"/>`;
    const splash = [[96, 132, 3], [104, 124, 2.4], [110, 134, 2], [88, 128, 1.8], [20, 136, 2], [12, 128, 1.6]].map(([x, y, r]) => aC(x, y, r, "#e1f5fe", `stroke="#0288d1" stroke-width=".6"`)).join("");
    const foam = `<path d="M14,140 Q30,132 50,138 Q70,132 90,138 Q104,132 116,138 L116,146 H14Z" fill="#e1f5fe" stroke="#81d4fa" stroke-width="1"/>`;
    return [sky("#29b6f6", "#b3e5fc") + A_RAYS + `<circle cx="98" cy="22" r="10" fill="#fff59d"/>` + cloud(6, 52, .7) +
      `<path d="M0,96 Q30,90 60,96 T120,96 V158 H0Z" fill="#039be5"/>` + curl + waves(132, "#0288d1", 5) + waves(146, "#29b6f6", 5) + foam + splash +
      sparks([[14, 74, 3], [108, 36, 2.6]]), aEdge(place(board + p, 52, 70, 1.08, 5))];
  }

  /* ---- 8 Everest: snowboarding downhill ---- */
  function everest() {
    const fur = "#8796a3", light = "#ffffff";
    const marks = `<path d="M-23,4 Q-22,-8 -15,-10 Q-10,-13 -4,-10 Q0,-6 0,-3 Q0,-6 4,-10 Q10,-13 15,-10 Q22,-8 23,4 Q23,14 16,18 Q0,23 -16,18 Q-23,14 -23,4Z" fill="#fff"/>` +
      `<path d="M-3,-21 Q0,-12 3,-21Z" fill="#fff"/>` + aC(-9, -14, 1.6, "#fff") + aC(9, -14, 1.6, "#fff");
    const ears = { back: earUp("#6b7a87", "#f8bbd0") };
    const hat = P("M-20,-11 Q-22,-34 0,-35 Q22,-34 20,-11 Q0,-16 -20,-11Z", "#26c6da") + `<path d="M9,-33 Q19,-28 19,-12 L13,-12 Q14,-26 9,-33Z" fill="#000" opacity=".12"/>` +
      `<path d="M-20,-19 Q0,-25 20,-19" stroke="#7b1fa2" stroke-width="2.4" fill="none"/>` +
      mir(aC(-7.6, -22, 5.8, "#7b1fa2", A_OUT) + aC(-7.6, -22, 3.9, "#b3e5fc", "") + `<path d="M-9.8,-23.6 Q-8,-25.4 -6,-24.8" stroke="#fff" stroke-width="1" fill="none"/>`) +
      `<path d="M-7,-34 Q-2,-41 2,-35 Q5,-40 8,-34" fill="#9c6ad6" stroke="${A_OL}" stroke-width="1" stroke-linejoin="round"/>`;
    const pack = mir(R(-21, 11, 9, 15, 3, "#7b1fa2"));
    const board = P("M-34,66 Q-38,66 -38,69.5 Q-37,73 -32,73 H32 Q37,73 38,69.5 Q38,66 34,66Z", "#7b1fa2") +
      `<path d="M-30,69.6 H30" stroke="#26c6da" stroke-width="2.2"/>` + mir(R(-19, 64, 9, 4, 1.5, "#37474f", ""));
    const p = pup({ pose: "biped", fur, light, eyes: "#6a5acd", uni: "#26c6da", uniD: "#7b1fa2", stripe: "#9c27b0", badge: "snow", marks, ears, hat, pack, tilt: -6, tailCol: "#6b7a87",
      legPts: [[[-8, 44], [-13, 55], [-14, 63]], [[8, 44], [13, 55], [14, 63]]], tailPts: [[-12, 46], [-24, 42], [-28, 32]],
      arms: [{ pts: [[-13, 20], [-26, 18], [-36, 10]] }, { pts: [[13, 20], [25, 25], [35, 22]] }] });
    const flake = (x, y, r) => `<g transform="translate(${x} ${y}) scale(${r / 8})">${SYM.snow[1]()}</g>`;
    const pine = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${P("M0,-28 L10,-10 H5 L13,4 H-13 L-5,-10 H-10Z", "#2e7d5b")}<path d="M-6,-14 L0,-24 L6,-14 M-9,0 L0,-12 L9,0" fill="none" stroke="#fff" stroke-width="1.6" opacity=".8"/>${R(-2, 4, 4, 5, 0, "#6d4c41", "")}</g>`;
    const spray = [[8, 118, 4], [14, 110, 3], [4, 106, 2.4], [20, 120, 3.4], [12, 126, 2.6]].map(([x, y, r]) => aC(x, y, r, "#fff", `stroke="#b3d9f0" stroke-width=".8"`)).join("");
    return [sky("#5c6bc0", "#b3e5fc") + A_RAYS +
      `<path d="M-10,96 L22,40 L38,64 L62,26 L92,72 L104,56 L130,96Z" fill="#cfd8dc"/><path d="M22,40 L30,52 L26,56 L20,50 L14,56Z M62,26 L72,42 L64,40 L58,46 L52,42Z" fill="#fff"/>` +
      pine(10, 100, .8) + pine(110, 108, .9) + `<path d="M-5,96 Q40,98 125,128 V158 H-5Z" fill="#f5fbff"/><path d="M-5,118 Q50,120 125,148" stroke="#cfe8f5" stroke-width="2" fill="none"/>` +
      `<ellipse cx="62" cy="142" rx="34" ry="5" fill="#90a4ae" opacity=".3" transform="rotate(13 62 142)"/>` + spray +
      flake(12, 44, 4) + flake(104, 18, 5) + flake(108, 84, 3.4) + flake(48, 8, 2.6) + sparks([[110, 136, 2.6]]),
      aEdge(place(p + board, 60, 60, 1.12, 13))];
  }

  /* ---- 9 Tracker: standing alert in the jungle, big ears up ---- */
  function tracker() {
    const fur = "#e2b47c", light = "#fff4e2", brown = "#a86b34";
    const marks = `<path d="M-24,2 Q-24,-18 -8,-20 Q-4,-12 -10,-8 Q-18,-6 -24,2Z" fill="${brown}" opacity=".85"/>`;
    const ear = side => `<g transform="scale(${side} 1)"><path d="M-12,-15 Q-24,-38 -36,-47 Q-44,-24 -23,-1Z" fill="${fur}" ${A_OUT} stroke-linejoin="round"/>` +
      `<path d="M-15,-15 Q-25,-33 -34,-41 Q-39,-23 -23,-6Z" fill="#f8b4b4"/></g>`;
    const ears = { back: ear(-1) + ear(1) };
    const hat = E(0, -14, 26, 5.6, "#558b2f") + P("M-16,-14 Q-17,-34 0,-35 Q17,-34 16,-14Z", "#689f38") +
      `<path d="M7,-33 Q15,-28 15,-14 L10,-14 Q11,-27 7,-33Z" fill="#000" opacity=".12"/>` +
      P("M-16.5,-15 Q0,-19 16.5,-15 L16.4,-20 Q0,-24 -16.4,-20Z", "#33691e") +
      P("M-26,-14 Q0,-7 26,-14 Q24,-10 18,-10 Q0,-6 -18,-10 Q-24,-10 -26,-14Z", "#4a7a24") + aC(0, -35, 1.8, "#33691e", A_OUT);
    // pup-pack (body coordinates): green pack with a coiled grappling cable and a flashlight
    const pack = R(-30, 4, 20, 11, 3.5, "#558b2f") + aC(-20, 9.5, 3.6, "none", `stroke="#cfd8dc" stroke-width="2"`) +
      `<g transform="translate(-12 4) rotate(-30)">${R(-2, -9, 4, 9, 1.2, "#37474f")}${E(0, -9.4, 3.2, 1.6, "#fff59d")}</g>`;
    const p = pup({ pose: "quad", legs: "stand", fur, light, eyes: "#6b3e1a", uni: "#7cb342", uniD: "#33691e", badge: "compass", marks, ears, hat, pack, tilt: -7, headRx: 23,
      tailPts: [[-46, 26], [-54, 14], [-50, 2]] });
    const leaf = (x, y, r, s, c) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0,0 Q12,-12 30,0 Q12,12 0,0Z" fill="${c}" stroke="#1b5e20" stroke-width=".8"/><path d="M0,0 H28" stroke="#1b5e20" stroke-width=".7"/></g>`;
    const vine = x => `<path d="M${x},-2 Q${x + 6},30 ${x - 2},60" stroke="#33691e" stroke-width="2" fill="none"/>` + leaf(x + 2, 20, 30, .35, "#7cb342") + leaf(x, 42, 150, .35, "#7cb342");
    return [sky("#2e7d32", "#a5d6a7") + A_RAYS + vine(14) + vine(106) +
      leaf(-6, 118, -30, 1.2, "#43a047") + leaf(126, 116, 210, 1.2, "#388e3c") + leaf(-4, 90, -10, .9, "#66bb6a") + leaf(124, 82, 190, .9, "#66bb6a") +
      `<path d="M-5,128 Q60,118 125,128 V158 H-5Z" fill="#6d4c41"/>` + aC(98, 52, 4, "#ff7043") + aC(18, 104, 3.4, "#ec407a") +
      shadow(56, 140, 34) + `<path d="M104,22 q4,-4 8,0 M106,16 q6,-6 12,0" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>` + sparks([[12, 52, 3], [108, 132, 2.6]]),
      aEdge(place(p, 74, 66, 1.12))];
  }

  FAN.pawpatrol = [
    ["Ryder", "the boy leader in his orange vest with the Paw Patrol shield, pup-pad in hand, the Lookout behind", ryder],
    ["Chase", "police pup standing at attention: blue cap and vest, police badge, saluting, megaphone popping out of his pup-pack, cones on the street", chase],
    ["Marshall", "fire pup on his hind legs, both paws on the hose nozzle: Dalmatian spots, red helmet with gold badge, red vest and pup-pack, the water arcing high onto a burning house", marshall],
    ["Skye", "flying pup: pink helmet with goggles, pink wings out of her pup-pack, in the clouds", skye],
    ["Rubble", "construction bulldog standing and digging: yellow hard hat, shovel scooping dirt, crane behind", rubble],
    ["Rocky", "recycling pup sitting: green cap and vest, recycle badge, holding up a wrench, recycling bin", rocky],
    ["Zuma", "water-rescue Labrador surfing: orange helmet with goggles, anchor badge, crouched on a surfboard on a curling wave", zuma],
    ["Everest", "snow husky snowboarding downhill: teal and purple gear, snowflake badge, paws out for balance, snowy mountains", everest],
    ["Tracker", "jungle chihuahua standing alert on four legs: huge ears up, green jungle hat, compass badge, in the jungle", tracker],
  ];
})();

/* Sticker book theme page: Hot Wheels (9 stickers: the flame logo, 6 classic castings, a loop and a jump), drawn with album.js's pieces.
   Each draw() returns [backdrop, character]: the character (the car with its speed lines, in its aEdge cut-out) carries its own
   gradient defs, since the book also shows it alone as a silhouette. */
(() => {
  "use strict";
  /* ---- shared pieces. Cars are drawn side-on in "car coordinates": nose towards +x, ground (wheel bottoms) at y 0,
     roughly x -62..66, then placed on the card rotated (up a ramp, round a loop) with place() ---- */
  const U = p => `hw${p}${++aUid}`;
  const st = (w = 1.3) => `stroke="${A_OL}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const P = (d, f, w = 1.3, x = "") => `<path d="${d}" fill="${f}" ${st(w)} ${x}/>`;
  const Pn = (d, f, x = "") => `<path d="${d}" fill="${f}" ${x}/>`;
  const place = (s, x, y, a, k, c = [0, 0]) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${k}) translate(${-c[0]} ${-c[1]})">${s}</g>`;
  const grad = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
  // flat paint with one soft shade band (and a light top) for car bodies
  const paint = (id, light, base, shade) => grad(id, [[0, light], [.28, base], [.6, base], [.6, shade], [1, shade]]);
  const chrome = id => grad(id, [[0, "#ffffff"], [.42, "#c3ced6"], [.5, "#6f7f8a"], [.62, "#a9b6bf"], [1, "#f1f4f6"]]);
  const chromeDark = id => grad(id, [[0, "#c9d3da"], [.42, "#8e9ba5"], [.5, "#4c5962"], [.62, "#7d8a94"], [1, "#b4bfc7"]]);
  const glassG = id => grad(id, [[0, "#3f6aa6"], [.55, "#14243d"], [1, "#0b1424"]]);
  const checks = (id, s = 4, a = "#fff", b = "#1a1a1a") => `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${2 * s}" height="${2 * s}"><rect width="${2 * s}" height="${2 * s}" fill="${a}"/><rect width="${s}" height="${s}" fill="${b}"/><rect x="${s}" y="${s}" width="${s}" height="${s}" fill="${b}"/></pattern>`;
  const shine = (d, w = 2.2, op = .8) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`;
  const glint = (x, y, r = 3) => aSpark(x, y, r, "#fff");

  // a chunky toy wheel: fat black tyre, the classic red line, a chrome 5-spoke rim, bold highlights (o.mono = monster-truck treads)
  function wheel(x, y, r, ch, o = {}) {
    const s = [], f = v => +v.toFixed(2);
    if (o.mono) {
      const n = 18;
      s.push(`<polygon points="${aPts([...Array(n * 4)].map((_, i) => { const a = (i / (n * 4)) * 2 * Math.PI, rr = (i % 4 < 2) ? r : r - 2.4; return [x + rr * Math.cos(a), y + rr * Math.sin(a)]; }))}" fill="#222" ${st(1.3)}/>`);
      s.push(aC(x, y, r - 4.5, "#2e2e2e"), `<circle cx="${x}" cy="${y}" r="${r - 4.5}" fill="none" stroke="#141414" stroke-width="1"/>`);
    } else {
      s.push(aC(x, y, r, "#1c1c1c", st(1.4)), `<circle cx="${x}" cy="${y}" r="${f(r - 1.5)}" fill="none" stroke="#3d3d3d" stroke-width="1.2"/>`);
      if (o.red !== false) s.push(`<circle cx="${x}" cy="${y}" r="${f(r * .79)}" fill="none" stroke="#ff2a2a" stroke-width="${f(Math.max(1.5, r * .13))}"/>`);
    }
    const rr = r * (o.mono ? .5 : .6), rim = o.rim || `url(#${ch})`;
    s.push(aC(x, y, rr, rim, st(1)));
    for (let i = 0; i < 5; i++) {
      const a = (o.rot || 0) + i * 2 * Math.PI / 5;
      s.push(`<path d="M${x},${y} L${f(x + rr * .9 * Math.cos(a))},${f(y + rr * .9 * Math.sin(a))}" stroke="${o.spoke || "#5d6c77"}" stroke-width="${f(rr * .32)}" stroke-linecap="round"/>`);
    }
    s.push(aC(x, y, f(rr * .36), o.hub || "#eef2f4", st(.8)));
    // shine on the tyre's shoulder and a glint on the rim
    s.push(`<path d="M${f(x - r * .76)},${f(y - r * .44)} A${f(r * .88)},${f(r * .88)} 0 0 1 ${f(x - r * .14)},${f(y - r * .87)}" fill="none" stroke="#fff" stroke-width="${f(r * .1)}" stroke-linecap="round" opacity=".55"/>`);
    s.push(aSpark(f(x - rr * .5), f(y - rr * .5), f(rr * .55), "#fff"));
    return s.join("");
  }
  // a car body: painted path, things clipped to it (stripes, panels), dark wheel arches, then the outline on top
  function body(d, fill, arches, inside = "") {
    const id = U("cl");
    return `<defs><clipPath id="${id}"><path d="${d}"/></clipPath></defs>` + Pn(d, fill) +
      `<g clip-path="url(#${id})">${inside}${arches.map(([x, y, r]) => aC(x, y, r + 2.4, "#151515", st(1.3))).join("")}</g>` +
      `<path d="${d}" fill="none" ${st(1.6)}/>`;
  }
  const glass = (d, gid, gl = "") => P(d, `url(#${gid})`, 1.2) + gl;
  // speed lines behind the car (car coordinates)
  const speed = (x, ys, col = "#fff", len = 22) => ys.map(([y, l = len, dx = 0]) =>
    `<path d="M${x - dx - l},${y} H${x - dx}" stroke="${col}" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>`).join("");
  // the orange track in car coordinates: the floor behind the wheels and the near rail (both backdrop: the car rides on top)
  function track(x0, x1, tg) {
    const joints = [];
    for (let x = x0 + 30; x < x1; x += 70) joints.push(`<rect x="${x}" y="1" width="7" height="5" rx="1" fill="#5e35b1" ${st(.8)}/>`);
    return `<rect x="${x0}" y="-5" width="${x1 - x0}" height="5" fill="#ffb24a"/><path d="M${x0},-5 H${x1}" stroke="#d9600a" stroke-width="1"/>` +
      `<rect x="${x0}" y="-1.6" width="${x1 - x0}" height="10" fill="url(#${tg})"/><path d="M${x0},-1.6 H${x1} M${x0},8.4 H${x1}" ${st(1.4)}/>` +
      `<path d="M${x0},0 H${x1}" stroke="#fff" stroke-width="1" opacity=".55"/>` + joints.join("");
  }
  const trackG = id => grad(id, [[0, "#ffa23a"], [.45, "#ff7b00"], [1, "#d85a00"]]);
  // a car on the orange track: [the track (backdrop), speed lines + car in the white cut-out (character)]
  const onTrack = (car, sp, defs, [x, y, a, k, c], x0, x1, tg) =>
    [place(track(x0, x1, tg), x, y, a, k, c), `<defs>${defs}</defs>` + place(sp, x, y, a, k, c) + aEdge(place(car, x, y, a, k, c))];
  // a supercharger: ribbed chrome case on a black manifold, a tall flared bug-catcher scoop on top, its black mouth facing forward
  function blower(x, y, k, g, gl = true) {
    const f = `url(#${g})`;
    return `<g transform="translate(${x} ${y}) scale(${k})">` +
      P("M-1,-3 H23 V4 H-1Z", "#2b3035", 1.1) +
      // the case with its ribs and the belt pulley at the front
      P("M0,-16 Q0,-18 2,-18 H20 Q22,-18 22,-16 V-2 H0Z", f, 1.2) +
      `<path d="M1.2,-14.5 H20.8 M1.2,-10.5 H20.8 M1.2,-6.5 H20.8" stroke="#3f4c56" stroke-width="1.5"/>` +
      aC(23.5, -9, 3.6, "#2b3035", st(1)) + aC(23.5, -9, 1.4, "#cfd8dc") +
      // the scoop: flares out towards the top, the mouth is a black slanted opening at the front
      P("M3,-18 L-1,-36 Q-1,-38 1,-38 H22 Q25,-38 25,-35 L19,-18Z", f, 1.3) +
      P("M14,-36.4 H22.4 Q23.8,-36.4 23.4,-34.6 L20.6,-24 Q20,-22.6 18.6,-23.4 L13.2,-27 Q12.4,-27.6 12.6,-28.6 Z", "#121212", .9) +
      `<path d="M0.4,-35.6 H11" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".9"/>` +
      (gl ? shine("M4.2,-32 L6.4,-21.5", 2.4, .95) + shine("M2.8,-15.5 V-3.5", 1.6, .8) + glint(9, -30, 3.6) : "") + `</g>`;
  }
  // exhaust fire out of the back (car coordinates, from x0,y)
  const fire = (x0, y, k = 1) => Pn(`M${x0},${y - 5 * k} Q${x0 - 12 * k},${y - 12 * k} ${x0 - 30 * k},${y - 4 * k} Q${x0 - 18 * k},${y - 1 * k} ${x0 - 27 * k},${y + 6 * k} Q${x0 - 12 * k},${y + 3 * k} ${x0},${y + 4 * k}Z`, "#ff6d00", st(1)) +
    Pn(`M${x0},${y - 2.6 * k} Q${x0 - 10 * k},${y - 6 * k} ${x0 - 18 * k},${y - 1 * k} Q${x0 - 10 * k},${y + 1 * k} ${x0 - 15 * k},${y + 3.5 * k} Q${x0 - 7 * k},${y + 2 * k} ${x0},${y + 2 * k}Z`, "#ffe14d");
  // a waving chequered flag on a pole (top-left corner of the cloth at x,y)
  const flag = (x, y, w, h, pole, cid, left = false) => {
    const dx = left ? -w : w;
    return `<path d="M${x},${y - 2} V${y + pole}" stroke="${A_OL}" stroke-width="3.4" stroke-linecap="round"/><path d="M${x},${y - 2} V${y + pole}" stroke="#cfd8dc" stroke-width="1.8" stroke-linecap="round"/>` +
      aC(x, y - 3, 2, "#ffd21f", st(.8)) +
      P(`M${x},${y} Q${x + dx * .3},${y - 4} ${x + dx * .55},${y} T${x + dx},${y} V${y + h} Q${x + dx * .75},${y + h + 4} ${x + dx * .5},${y + h} T${x},${y + h}Z`, `url(#${cid})`, 1.1);
  };
  const cloud = (x, y, k = 1, op = .95) => `<g opacity="${op}" fill="#fff">${aC(x, y, 6 * k, "#fff")}${aC(x + 7 * k, y - 3 * k, 7 * k, "#fff")}${aC(x + 15 * k, y, 5.5 * k, "#fff")}<rect x="${x - 4 * k}" y="${y}" width="${22 * k}" height="${5 * k}" rx="${2.5 * k}"/></g>`;

  /* ---- the Hot Wheels flame logo, centred on 0,0, about 108 x 62 ---- */
  function hwLogo(rg) {
    const F = "M-50,10 C-50,-9 -37,-20 -17,-20 L1,-20 Q9,-24 13,-35 Q15,-27 17,-21 Q25,-24 29,-32 Q31,-25 31,-19 Q39,-21 44,-29 Q46,-21 44,-15 Q51,-16 57,-22 Q54,-12 49,-3 Q46,15 28,20 L-28,21 C-43,21 -50,18 -50,10Z";
    const gid = U("gl");
    return `<defs><clipPath id="${gid}"><path d="${F}"/></clipPath></defs>` +
      `<path d="${F}" fill="none" stroke="${A_OL}" stroke-width="10.5" stroke-linejoin="round"/><path d="${F}" fill="none" stroke="#ffb300" stroke-width="8" stroke-linejoin="round"/>` +
      `<path d="${F}" fill="none" stroke="#ffe066" stroke-width="3.4" stroke-linejoin="round"/>` +
      `<path d="${F}" fill="url(#${rg})" stroke="#9a0010" stroke-width="1"/>` +
      `<g clip-path="url(#${gid})"><ellipse cx="-8" cy="-22" rx="62" ry="22" fill="#fff" opacity=".2"/></g>` +
      `<text x="-1" y="7.5" transform="skewX(-12)" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="18.5" text-anchor="middle" textLength="88" lengthAdjust="spacingAndGlyphs" fill="#fff" stroke="#6d000d" stroke-width="3" paint-order="stroke" stroke-linejoin="round">Hot Wheels</text>`;
  }

  // 1 the logo as a shiny badge
  function hwBadge() {
    const bg = U("bg"), rg = U("rg"), cg = U("cg"), ck = U("ck"), ring = U("ri"), cl = U("bc");
    return [`<defs>${aVGrad(bg, "#ff9a1f", "#ff5a00")}${checks(ck, 5)}</defs>` +
      `<rect width="120" height="158" fill="url(#${bg})"/>` + A_RAYS +
      `<rect x="0" y="0" width="120" height="13" fill="url(#${ck})"/><rect x="0" y="145" width="120" height="13" fill="url(#${ck})"/>` +
      `<path d="M0,13 H120 M0,145 H120" ${st(1.4)}/>` + aSpark(100, 34, 6) + aSpark(18, 124, 5) + aSpark(104, 120, 3.5) + aSpark(22, 36, 3),
    `<defs>${grad(rg, [[0, "#ff2a2a"], [.55, "#e00018"], [1, "#a8000f"]])}` +
      `<radialGradient id="${cg}" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#3d8bff"/><stop offset=".7" stop-color="#0d47a1"/><stop offset="1" stop-color="#062466"/></radialGradient>` +
      `${chrome(ring)}<clipPath id="${cl}"><circle cx="60" cy="80" r="44"/></clipPath></defs>` +
      aEdge(aC(60, 80, 52, `url(#${ring})`, st(1.6)) + aC(60, 80, 44, `url(#${cg})`, st(1.4)) +
        [...Array(8)].map((_, i) => { const a = i * Math.PI / 4 + Math.PI / 8; return aC(60 + 48 * Math.cos(a), 80 + 48 * Math.sin(a), 1.6, "#78909c", st(.6)); }).join("") +
        `<g clip-path="url(#${cl})" opacity=".35">${[...Array(12)].map((_, i) => { const a = i * Math.PI / 6, b = a + .17; return `<polygon points="60,80 ${(60 + 60 * Math.cos(a)).toFixed(1)},${(80 + 60 * Math.sin(a)).toFixed(1)} ${(60 + 60 * Math.cos(b)).toFixed(1)},${(80 + 60 * Math.sin(b)).toFixed(1)}" fill="#7fb6ff"/>`; }).join("")}</g>` +
        `<path d="M24,66 A40,40 0 0 1 72,38" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".45"/>` +
        place(hwLogo(rg), 61, 82, -10, 1.02))];
  }

  // 2 Twin Mill: low dark-blue body, two chrome blowers with intake scoops side by side out of the long hood, canopy far back
  function twinMill() {
    const bg = U("bg"), pg = U("pt"), ch = U("ch"), cd = U("cd"), gg = U("gs"), tg = U("tr");
    const d = "M62,-8 Q66,-11 65,-17 Q63,-22 55,-23 L14,-26 L-4,-28 L-40,-35 Q-54,-36 -60,-31 L-62,-24 L-61,-13 Q-60,-8 -54,-8Z";
    const car = body(d, `url(#${pg})`, [[-36, -17, 17], [42, -13, 13]],
        Pn("M-62,-16 H66 V-8 H-62Z", "#0a1a45") + `<path d="M58,-18 L10,-20" stroke="#5c8cff" stroke-width="1.4" opacity=".8"/>`) +
      glass("M-4,-28 Q-10,-40 -26,-42 Q-38,-42 -44,-34 L-40,-31 Z", gg, `<path d="M-10,-35 L-18,-39" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`) +
      shine("M54,-21.5 L20,-24.5 M-44,-33.5 L-56,-33") +
      // the far blower (darker chrome), then the near one, side by side
      blower(26, -30, .9, cd, false) + blower(8, -25, .92, ch) +
      // headers into the side pipe
      aL([[16, -22], [14, -14], [10, -11]], "#cfd8dc", 2) + aL([[22, -22], [21, -14], [17, -11]], "#cfd8dc", 2) +
      P("M-22,-13 H24 Q27,-13 27,-10.5 Q27,-8 24,-8 H-22 Q-25,-8 -25,-10.5 Q-25,-13 -22,-13Z", `url(#${ch})`, 1.1) +
      [-14, -4, 6, 16].map(x => `<path d="M${x},-12.6 V-8.4" stroke="#55636d" stroke-width="1"/>`).join("") +
      P("M-62,-29 h4 v4 h-4Z", "#ff3b30", .9) + P("M61,-19 h4 v3 h-4Z", "#fff59d", .8) +
      wheel(-36, -17, 17, ch, { rot: .3 }) + wheel(42, -13, 13, ch, { rot: 1 });
    const sp = speed(-66, [[-36, 26], [-26, 18, 6], [-16, 24]]);
    const [trk, chr] = onTrack(car, sp, `${paint(pg, "#5c8cff", "#1c47c2", "#102a7a")}${chrome(ch)}${chromeDark(cd)}${glassG(gg)}`, [58, 86, -36, .88, [0, -26]], -120, 140, tg);
    return [`<defs>${aVGrad(bg, "#0b1d4d", "#3a1d6e")}${trackG(tg)}</defs>` +
      `<rect width="120" height="158" fill="url(#${bg})"/>` +
      [[14, 44], [96, 22], [30, 128], [104, 140], [82, 60], [46, 16]].map(([x, y], i) => aSpark(x, y, 2 + (i % 3), "#fff")).join("") +
      `<g opacity=".25">${[...Array(7)].map((_, i) => `<path d="M${-20 + i * 26},170 L${60 + i * 26},-20" stroke="#ff7b00" stroke-width="6"/>`).join("")}</g>` + trk, chr];
  }

  // 3 Bone Shaker: black hot rod, chopped cab at the back, chrome engine in the open, skull grille, big rear wheels
  function boneShaker() {
    const bg = U("bg"), pg = U("pt"), ch = U("ch"), gg = U("gs"), tg = U("tr");
    const d = "M-60,-14 L-60,-30 Q-60,-36 -54,-36 L-50,-36 L-48,-55 Q-47,-59 -42,-59 L-18,-59 Q-14,-59 -13,-55 L-10,-36 L-4,-34 L-4,-14Z";
    const skull = `<g transform="translate(38 -36) scale(1.15)">` +
      P("M-12,-2 Q-12,-17 0,-17 Q12,-17 12,-2 Q12,6 8,8 L8,15 L-8,15 L-8,8 Q-12,6 -12,-2Z", "#f4efe2", 1.4) +
      `<ellipse cx="-4.8" cy="-2" rx="3.6" ry="4.2" fill="#1a1a1a"/><ellipse cx="4.8" cy="-2" rx="3.6" ry="4.2" fill="#1a1a1a"/>` +
      aC(-3.8, -3.5, 1.1, "#e53935") + aC(5.8, -3.5, 1.1, "#e53935") +
      Pn("M0,3 L-2,7 H2Z", "#1a1a1a") + `<path d="M-6,10.5 H6 M-4,8.5 V14.5 M0,8.5 V14.5 M4,8.5 V14.5" stroke="#1a1a1a" stroke-width="1"/>` +
      shine("M-8,-9 Q-4,-14 2,-14.5", 1.8, .9) + `</g>`;
    const car = // chassis rail and dropped front axle
      P("M-6,-17 H48 Q53,-17 53,-14 H-6Z", `url(#${ch})`, 1) +
      body(d, `url(#${pg})`, [[-38, -18, 18]],
        `<path d="M-60,-22 H-4" stroke="#d32f2f" stroke-width="2.4"/>`) +
      glass("M-45,-54 L-44,-48 H-16 L-17,-54Z", gg, `<path d="M-38,-53 L-41,-49" stroke="#fff" stroke-width="1.6" opacity=".8"/>`) +
      shine("M-44,-57.5 L-19,-57.5 M-58,-34 L-51,-34") +
      // the engine: block, ribbed valve covers, round air cleaner, headers
      P("M-4,-36 H24 V-18 H-4Z", `url(#${ch})`, 1.2) + P("M-2,-42 H22 V-36 H-2Z", "#d32f2f", 1.1) +
      [2, 7, 12, 17].map(x => `<path d="M${x},-41.5 V-36.5" stroke="#7f0000" stroke-width="1"/>`).join("") +
      P("M3,-50 Q3,-53 10,-53 Q17,-53 17,-50 V-45 Q17,-42 10,-42 Q3,-42 3,-45Z", `url(#${ch})`, 1.1) +
      `<path d="M4,-47.5 H16" stroke="#55636d" stroke-width="1"/>` + glint(7, -49, 2.6) + shine("M-1,-33 V-21", 1.8, .8) +
      [0, 6, 12, 18].map(x => aL([[x + 1, -27], [x - 3, -20], [x - 12, -16]], "#e0e6ea", 1.8)).join("") +
      aL([[-12, -16], [-56, -10]], "#cfd8dc", 2.6) +
      skull + aL([[38, -19], [48, -14], [52, -12]], "#cfd8dc", 2) +
      P("M-62,-31 h3 v5 h-3Z", "#ff3b30", .9) +
      wheel(-38, -18, 18, ch, { rot: .2 }) + wheel(52, -12, 12, ch, { rot: .9 });
    const sp = speed(-66, [[-46, 24], [-32, 16, 6], [-20, 26]]);
    const [trk, chr] = onTrack(car, sp, `${paint(pg, "#5d5d5d", "#232323", "#111")}${chrome(ch)}${glassG(gg)}`, [58, 84, -32, .86, [-2, -30]], -130, 140, tg);
    return [`<defs>${aVGrad(bg, "#4a0d0d", "#c62828")}${trackG(tg)}</defs>` +
      `<rect width="120" height="158" fill="url(#${bg})"/>` + A_RAYS +
      // flames rising from the bottom
      Pn("M0,158 L0,118 Q8,128 10,108 Q18,124 24,100 Q30,122 38,112 Q44,126 52,104 Q58,124 66,114 Q72,128 80,102 Q88,124 94,110 Q102,126 108,104 Q114,120 120,112 L120,158Z", "#ff6d00", st(1.2)) +
      Pn("M0,158 L0,132 Q10,138 14,124 Q22,136 30,122 Q38,138 46,126 Q54,138 62,124 Q70,138 78,126 Q88,140 96,124 Q104,138 112,128 L120,134 L120,158Z", "#ffd21f") +
      aSpark(98, 30, 5) + aSpark(18, 40, 3) + trk, chr];
  }

  // 4 Sharkruiser: a grey-blue shark on wheels: open jaws with teeth, gills, dorsal fin, tail fin, blower on its back
  function sharkruiser() {
    const bg = U("bg"), pg = U("pt"), ch = U("ch"), tg = U("tr");
    const d = "M68,-33 Q56,-48 24,-50 L-20,-48 Q-42,-46 -56,-34 L-60,-30 L-60,-24 L-52,-12 Q-50,-9 -44,-9 L50,-9 Q58,-9 63,-17 L44,-25 Z";
    const car = // tail fin and dorsal fin behind the body
      P("M-52,-36 L-82,-66 Q-74,-46 -70,-30 Q-76,-22 -84,-12 L-54,-22Z", `url(#${pg})`, 1.4) +
      P("M12,-48 Q8,-66 -12,-78 Q-6,-62 -18,-46Z", "#5f7f9e", 1.4) + shine("M7,-56 Q2,-66 -6,-72", 1.6, .6) +
      // blower on its back
      blower(-38, -45, .78, ch) +
      body(d, `url(#${pg})`, [[-34, -14, 14], [38, -13, 13]],
        Pn("M44,-25 Q20,-24 0,-25 Q-30,-26 -62,-27 L-62,0 L70,0 Z", "#eef3f6") +
        `<path d="M44,-25 Q20,-24 0,-25 Q-30,-26 -62,-27" fill="none" stroke="#b9c7d2" stroke-width="1.4"/>`) +
      // mouth: dark inside, teeth on both jaws
      P("M68,-33 L44,-25 L63,-17 Q58,-25 68,-33Z", "#7a1020", 1.1) +
      `<polygon points="${aPts([[64, -31.6], [62, -27], [60, -30.6], [58.5, -26], [56, -29.4], [54.5, -25.5], [52, -28.2], [50.5, -24.8], [48, -27]])}" fill="#fff" ${st(.7)}/>` +
      `<polygon points="${aPts([[61, -18.6], [59, -23], [57.5, -19.8], [55.5, -23.6], [54, -21], [52, -24.6], [50, -22.2]])}" fill="#fff" ${st(.7)}/>` +
      aC(52, -38.5, 2.8, "#111") + aC(51.2, -39.3, 1, "#fff") +
      [30, 25, 20].map(x => `<path d="M${x},-43 Q${x - 3},-36 ${x},-29" fill="none" stroke="#2c4157" stroke-width="1.5" stroke-linecap="round"/>`).join("") +
      shine("M60,-38 Q46,-47 24,-48 L-18,-46.5") + glint(40, -45, 3) +
      // side exhaust stubs
      [-46, -40, -34].map(x => P(`M${x},-23 h4 v-3 h-4Z`, `url(#${ch})`, .8)).join("") +
      wheel(-34, -14, 14, ch, { rot: .5 }) + wheel(38, -13, 13, ch, { rot: 1.2 });
    const sp = speed(-86, [[-54, 18], [-40, 24, 4], [-24, 16, 10]]);
    const [trk, chr] = onTrack(car, sp, `${paint(pg, "#a9c4dc", "#6f8fae", "#4b6a88")}${chrome(ch)}`, [58, 82, -32, .84, [-8, -36]], -130, 140, tg);
    return [`<defs>${aVGrad(bg, "#4fc3f7", "#01579b")}${trackG(tg)}</defs>` +
      `<rect width="120" height="158" fill="url(#${bg})"/>` + A_RAYS +
      // waves and bubbles
      [118, 132, 146].map((y, i) => Pn(`M0,${y} ${[...Array(7)].map((_, k) => `Q${k * 20 + 10 - i * 4},${y - 6} ${k * 20 + 20 - i * 4},${y}`).join(" ")} V158 H0Z`, ["#29b6f6", "#0288d1", "#01579b"][i], `opacity=".85"`)).join("") +
      [[20, 44, 3], [28, 36, 2], [98, 112, 2.6], [104, 100, 1.8], [90, 26, 2.2]].map(([x, y, r]) => aC(x, y, r, "none", `stroke="#fff" stroke-width="1" opacity=".8"`)).join("") +
      aSpark(100, 46, 4) + trk, chr];
  }

  // a surfboard sticking out of the back: inner (pointed) end at 0,0, square tail at x -L, fin under the tail
  function board(x, y, L, w, a, fill, band) {
    const h = w / 2;
    return `<g transform="translate(${x} ${y}) rotate(${a})">` +
      P(`M${-L + 4},${h - 1} Q${-L + 6},${h + 6} ${-L + 10},${h + 7} L${-L + 12},${h - 1}Z`, "#263238", 1) +
      P(`M8,0 C${-L * .2},${-h * 1.3} ${-L * .8},${-h * 1.1} ${-L},${-h * .55} Q${-L - 1.5},0 ${-L},${h * .55} C${-L * .8},${h * 1.1} ${-L * .2},${h * 1.3} 8,0Z`, fill, 1.3) +
      `<path d="M${-L + 2},${-h * .6} V${h * .6} M${-L + 6},${-h * .8} V${h * .8}" stroke="${band}" stroke-width="2.4"/>` +
      shine(`M${-L * .2},${-h * .6} L${-L * .7},${-h * .7}`, 1.4, .7) + `</g>`;
  }

  // 5 Deora II: smooth aqua surf wagon, silver sills, a long wrap-round windscreen, two surfboards out of the back
  function deora() {
    const bg = U("bg"), pg = U("pt"), ch = U("ch"), gg = U("gs"), tg = U("tr"), sg = U("sk");
    const d = "M64,-10 Q68,-14 66,-20 Q62,-26 50,-28 Q30,-34 12,-48 Q4,-54 -10,-54 L-36,-53 Q-48,-52 -54,-44 L-58,-34 Q-60,-22 -60,-14 Q-58,-9 -52,-9 L56,-9 Q61,-9 64,-10Z";
    const car = body(d, `url(#${pg})`, [[-38, -13, 13], [40, -13, 13]],
        P("M-62,-20 H70 V0 H-62Z", `url(#${ch})`, 1.1) + `<path d="M-62,-24 H70" stroke="#0e7c86" stroke-width="1.3"/>`) +
      // the boards slide into the back of the cabin: the windows hide their inner ends
      board(-38, -44, 36, 9, 62, "#ffd21f", "#e53935") + board(-36, -40, 36, 9, 46, "#ff5a36", "#fff") +
      glass("M50,-29 Q30,-35 12,-47 Q4,-52 -8,-52 L-36,-51 Q-46,-50 -51,-42 L-49,-38 L-6,-37 Q20,-33 50,-29Z", gg,
        `<path d="M22,-38 L8,-47 M30,-35 L24,-39" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`) +
      `<path d="M-30,-51.5 V-37.5" stroke="${A_OL}" stroke-width="1.3"/>` +
      shine("M56,-27 Q36,-33 26,-40 M-14,-55 L-36,-54.5") + glint(-20, -55, 3.4) +
      P("M60,-23 Q64,-22 65,-19 L60,-19Z", "#fff59d", .8) + P("M-60,-30 h3 v6 h-3Z", "#ff3b30", .8) +
      wheel(-38, -13, 13, ch, { rot: .6 }) + wheel(40, -13, 13, ch, { rot: .1 });
    const sp = speed(-84, [[-22, 18], [-14, 12, 4], [-6, 20]], "#fff");
    const [trk, chr] = onTrack(car, sp, `${paint(pg, "#7fe8ea", "#19b3bd", "#0f8a93")}${chrome(ch)}${glassG(gg)}`, [60, 92, -24, .8, [-4, -30]], -130, 140, tg);
    return [`<defs>${aVGrad(bg, "#ff8a65", "#ffd180")}${trackG(tg)}${aVGrad(sg, "#ffe0b2", "#ffcc80")}</defs>` +
      `<rect width="120" height="158" fill="url(#${bg})"/>` +
      aC(86, 56, 20, "#ffeb3b", `opacity=".9"`) +
      Pn("M0,66 H120 V100 H0Z", "#26c6da") + `<path d="M40,72 h18 M76,70 h12 M96,82 h16 M8,88 h10 M50,94 h12" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>` +
      Pn("M0,100 Q40,92 120,100 V158 H0Z", `url(#${sg})`) +
      cloud(40, 24, 1) + cloud(92, 14, .7) + aSpark(106, 36, 4) + trk, chr];
  }

  // 6 Rodger Dodger: purple muscle car, orange stripe, a big blower through the hood, raked back
  function rodgerDodger() {
    const bg = U("bg"), pg = U("pt"), ch = U("ch"), gg = U("gs"), tg = U("tr"), ck = U("ck");
    const d = "M64,-12 L65,-23 Q64,-28 58,-28 L14,-31 L-4,-31 Q-10,-42 -16,-45 L-30,-45 Q-46,-42 -56,-37 L-62,-36 L-63,-17 Q-62,-11 -56,-11 L58,-11 Q63,-11 64,-12Z";
    const car = body(d, `url(#${pg})`, [[-38, -17, 17], [42, -13, 13]],
        Pn("M66,-25 L-64,-30 L-64,-24 L66,-20Z", "#ff8f00") + Pn("M66,-23.6 L-64,-28 L-64,-27 L66,-22.8Z", "#ffd21f")) +
      glass("M-5,-32 L-15,-43 L-29,-43 L-46,-38 L-40,-33Z", gg, `<path d="M-12,-38 L-17,-42" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`) +
      `<path d="M-22,-43 V-33" stroke="${A_OL}" stroke-width="1.3"/>` +
      shine("M56,-26.5 L14,-29.5 M-17,-44 L-29,-44") + glint(-8, -37, 3) +
      // spoiler
      P("M-58,-37 L-60,-43 L-50,-43 L-50,-39Z", "#2a1144", 1.1) + P("M-66,-46 H-46 V-43 H-66Z", "#ff8f00", 1.1) +
      // the blower through the hood
      blower(16, -33, 1, ch) +
      // side pipes
      P("M-20,-15 H22 Q25,-15 25,-12.5 Q25,-10 22,-10 H-20 Q-23,-10 -23,-12.5 Q-23,-15 -20,-15Z", `url(#${ch})`, 1.1) +
      P("M60,-26 h4 v3 h-4Z", "#fff59d", .8) + P("M-64,-34 h3 v5 h-3Z", "#ff3b30", .8) +
      wheel(-38, -17, 17, ch, { rot: .7 }) + wheel(42, -13, 13, ch, { rot: .2 });
    const sp = speed(-70, [[-44, 22], [-30, 16, 6], [-18, 26]], "#fff");
    const [trk, chr] = onTrack(car, sp, `${paint(pg, "#c48af5", "#7b2cbf", "#4c1582")}${chrome(ch)}${glassG(gg)}`, [58, 86, -32, .86, [0, -28]], -130, 140, tg);
    return [`<defs>${aVGrad(bg, "#ffb300", "#ff6f00")}${trackG(tg)}${checks(ck, 6, "#fff", "#2a1a10")}</defs>` +
      `<rect width="120" height="158" fill="url(#${bg})"/>` +
      `<g transform="rotate(-24 60 79)" opacity=".9"><rect x="-40" y="22" width="200" height="24" fill="url(#${ck})"/><rect x="-40" y="120" width="200" height="24" fill="url(#${ck})"/></g>` +
      A_RAYS + aSpark(100, 64, 4) + aSpark(16, 80, 3) + trk, chr];
  }

  // 7 Mega-Wrex: a green T-rex on a monster-truck chassis, jaws open, tiny arms, huge treaded tyres
  function megaWrex() {
    const bg = U("bg"), pg = U("pt"), ch = U("ch");
    const torso = "M-46,-46 Q-50,-68 -24,-74 Q2,-80 22,-72 L30,-66 Q34,-54 26,-46 Q0,-40 -46,-46Z";
    const spikes = [[-38, -70], [-26, -75], [-14, -78], [-2, -78], [10, -76], [20, -73]].map(([x, y]) => P(`M${x - 4},${y + 2} L${x},${y - 6} L${x + 4},${y + 1}Z`, "#ff8a00", 1)).join("");
    const car = // tail, chassis, shocks
      P("M-40,-64 Q-64,-70 -86,-82 Q-70,-62 -42,-50Z", `url(#${pg})`, 1.4) +
      P("M-46,-34 H48 V-28 H-46Z", `url(#${ch})`, 1.1) +
      [[-40, -21], [42, -21]].map(([x, y]) => aL([[x - 5, y], [x - 7, -33]], "#ff8a00", 3.2) + aL([[x + 5, y], [x + 7, -33]], "#ff8a00", 3.2)).join("") +
      spikes +
      P("M18,-70 Q28,-86 40,-86 L44,-60 Q32,-54 22,-50Z", `url(#${pg})`, 1.4) +
      P(torso, `url(#${pg})`, 1.5) +
      Pn("M-40,-50 Q-10,-46 24,-50 Q20,-44 -10,-43 Q-34,-44 -40,-50Z", "#c5e1a5") +
      ["M-30,-72 Q-26,-62 -32,-54", "M-16,-76 Q-12,-64 -18,-56", "M-2,-77 Q2,-66 -4,-58"].map(s => `<path d="${s}" fill="none" stroke="#1b5e20" stroke-width="2.2" stroke-linecap="round"/>`).join("") +
      shine("M-40,-66 Q-20,-75 4,-75") +
      // the head: lower jaw, mouth, upper jaw with teeth, eye
      P("M40,-64 L72,-62 Q72,-55 64,-52 Q48,-50 38,-56Z", `url(#${pg})`, 1.4) +
      P("M40,-64 L72,-63 Q60,-68 44,-70Z", "#8b0d1a", 1) +
      P("M28,-80 Q34,-96 56,-92 L76,-82 Q78,-74 74,-70 L42,-68 Q30,-70 28,-80Z", `url(#${pg})`, 1.5) +
      `<polygon points="${aPts([[72, -70], [70, -64.5], [67, -69.6], [65, -64], [62, -69.2], [60, -64], [57, -68.8], [55, -63.6], [52, -68.6], [50, -63.6], [47, -68.4]])}" fill="#fff" ${st(.7)}/>` +
      `<polygon points="${aPts([[70, -62.2], [68, -66.6], [66, -62.3], [63, -66.4], [61, -62.4], [58, -66.2], [56, -62.6], [53, -66], [51, -62.8]])}" fill="#fff" ${st(.7)}/>` +
      `<ellipse cx="48" cy="-81" rx="4.4" ry="3.8" fill="#ffd21f" ${st(1)}/><ellipse cx="49" cy="-81" rx="1.3" ry="3" fill="#111"/>` +
      `<path d="M41,-86 L55,-84" stroke="${A_OL}" stroke-width="2.4" stroke-linecap="round"/>` + aC(72, -80, 1, "#1b5e20") +
      shine("M34,-86 Q42,-92 56,-90", 1.8, .65) +
      // tiny arms
      aL([[28, -56], [35, -54], [37, -49]], "#3fae49", 3) + aL([[37, -49], [39, -47]], "#fff", 1) +
      wheel(-40, -21, 21, ch, { mono: 1, rot: .4 }) + wheel(42, -21, 21, ch, { mono: 1, rot: 1.1 });
    return [`<defs>${aVGrad(bg, "#1a237e", "#7b1fa2")}</defs>` +
      `<rect width="120" height="158" fill="url(#${bg})"/>` +
      // stadium lights
      `<g opacity=".35">${Pn("M8,8 L-10,120 L34,120Z", "#fff59d")}${Pn("M112,8 L86,120 L130,120Z", "#fff59d")}</g>` + aC(8, 8, 6, "#fff9c4", st(1)) + aC(112, 8, 6, "#fff9c4", st(1)) +
      // dirt mound
      Pn("M-4,158 L-4,130 Q30,112 70,118 Q100,122 124,112 L124,158Z", "#8d5524", st(1.3)) +
      Pn("M0,144 Q40,132 120,136 V158 H0Z", "#6d3f17") +
      [[18, 128], [40, 122], [96, 120], [80, 140], [30, 146]].map(([x, y]) => aC(x, y, 1.6, "#5d3412")).join("") +
      [[8, 112], [14, 104], [4, 100]].map(([x, y]) => aC(x, y, 2.2, "#8d5524", st(.8))).join("") + aSpark(60, 24, 4) + aSpark(92, 40, 3),
    `<defs>${paint(pg, "#8be36a", "#3fae49", "#237a31")}${chrome(ch)}</defs>` + aEdge(place(car, 56, 96, -12, .78, [2, -44]))];
  }

  // a generic Hot Wheels racer for the stunt stickers (any colour, with flames and a wing)
  function racer(pg, ch, gg, wing = true) {
    const d = "M62,-10 Q66,-16 62,-20 L40,-25 Q22,-29 8,-33 Q-4,-42 -20,-42 Q-34,-42 -44,-34 L-58,-32 L-62,-30 L-62,-14 Q-60,-9 -54,-9Z";
    return (wing ? P("M-56,-31 L-60,-41 H-50 L-48,-32Z", "#222", 1.1) + P("M-70,-45 H-46 V-40.5 H-70Z", "#222", 1.1) : P("M-60,-32 L-62,-36 H-50 L-48,-33Z", "#222", 1.1)) +
      body(d, `url(#${pg})`, [[-36, -14, 14], [38, -13, 13]],
        Pn("M64,-18 Q44,-24 24,-24 L32,-20 L4,-21 L18,-16 L-8,-15 L12,-12 Q40,-10 62,-11Z", "#ffd21f", st(.9)) + Pn("M60,-16 Q46,-20 32,-20 L38,-17 L20,-16 L32,-13.5 Q48,-12 60,-12.5Z", "#ff7a00")) +
      glass("M6,-33 Q-4,-40 -18,-40 Q-30,-40 -40,-33 Z", gg, `<path d="M-6,-37 L-12,-39" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`) +
      `<path d="M-17,-40 V-33" stroke="${A_OL}" stroke-width="1.3"/>` +
      shine("M58,-20 L40,-24 Q24,-28 10,-32 M-46,-33 L-58,-31") + glint(24, -27, 3.4) +
      P("M60,-20 h3 v3 h-3Z", "#fff59d", .8) +
      wheel(-36, -14, 14, ch, { rot: .5 }) + wheel(38, -13, 13, ch, { rot: 1.4 });
  }

  // 8 loop-the-loop: a big orange loop rising out of the straight, a red racer upside-down round the top, sparks
  function loop() {
    const bg = U("bg"), pg = U("pt"), ch = U("ch"), gg = U("gs"), tg = U("tr");
    const cx = 60, cy = 72, R = 50, ring = (r, c, w, x = "") => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="${w}" ${x}/>`;
    const k = .68, ri = R - 7.4, half = 37 * k, rc = Math.sqrt(ri * ri - half * half) + .6;   // wheels touch the inside of the ring
    const phi = -68, rad = phi * Math.PI / 180, px = cx + rc * Math.cos(rad), py = cy + rc * Math.sin(rad);
    const arc = (r, a0, a1) => `M${(cx + r * Math.cos(a0 * Math.PI / 180)).toFixed(1)},${(cy + r * Math.sin(a0 * Math.PI / 180)).toFixed(1)} A${r},${r} 0 0 1 ${(cx + r * Math.cos(a1 * Math.PI / 180)).toFixed(1)},${(cy + r * Math.sin(a1 * Math.PI / 180)).toFixed(1)}`;
    // the wake: white swooshes behind the car, along the inside of the loop (it drives anticlockwise: up the right, over the top)
    const wake = [[rc - 6, 30, 3], [rc - 13, 22, 2.6], [rc - 20, 14, 2.2]].map(([r, len, w]) => `<path d="${arc(r, phi + 18, phi + 18 + len)}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round"/>`).join("");
    const sparks = [[-42, 2, 7], [-53, -3, 5], [-50, 7, 4.4]].map(([x, y, r]) => aSpark(x, y, r, "#ffe14d")).join("") +
      [[-40, 1, -58, 6], [-40, 1, -56, -5]].map(([a, b, c, e]) => `<path d="M${a},${b} L${c},${e}" stroke="#ffb300" stroke-width="1.6" stroke-linecap="round"/>`).join("");
    const trk = ring(R, A_OL, 17) + ring(R, "#ff7b00", 14) + ring(R - 5.8, "#ffb24a", 2.6) + ring(R + 5.6, "#d35400", 2.4) +
      ring(R, "#fff", 1.4, `stroke-dasharray="5 6" opacity=".7"`) +
      `<path d="${arc(R + 3, 150, 205)}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>` +
      // the straight along the bottom: in from the left, out to the right
      `<rect x="-4" y="${cy + R - 7}" width="128" height="14" fill="url(#${tg})" ${st(1.6)}/>` + `<path d="M-4,${cy + R - 5} H124" stroke="#fff" stroke-width="1.2" opacity=".6"/>` +
      [6, 98].map(x => `<rect x="${x}" y="${cy + R - 1}" width="9" height="5.5" rx="1" fill="#5e35b1" ${st(.8)}/>`).join("") +
      // arrows on the straight: in, round, out
      [16, 86].map(x => P(`M${x},${cy + R - 4} l7,3 l-7,3Z`, "#fff", .8)).join("");
    return [`<defs>${aVGrad(bg, "#29b6f6", "#b3e5fc")}${trackG(tg)}</defs>` +
      `<rect width="120" height="158" fill="url(#${bg})"/>` + A_RAYS + cloud(82, 142, .8) + cloud(98, 8, .5, .8) +
      Pn("M0,130 Q60,122 120,130 V158 H0Z", "#66bb6a", st(1.2)) + Pn("M0,144 Q60,138 120,144 V158 H0Z", "#43a047") +
      trk + aSpark(16, 112, 3.4) + aSpark(104, 104, 3),
    `<defs>${paint(pg, "#ff6b6b", "#e00018", "#9e0010")}${chrome(ch)}${glassG(gg)}</defs>` +
      wake + aEdge(place(sparks + racer(pg, ch, gg, false), px.toFixed(1), py.toFixed(1), phi - 90, k))];
  }

  // 9 the big jump: off one orange ramp, over the canyon, flames out of the exhaust, the chequered flag at the landing
  function jump() {
    const bg = U("bg"), pg = U("pt"), ch = U("ch"), gg = U("gs"), tg = U("tr"), ck = U("ck");
    const car = fire(-70, -22, 1.2) + racer(pg, ch, gg), sp = speed(-100, [[-46, 18], [-34, 12, 4], [-58, 14, 8]], "#fff");
    const ramp = pts => P(pts, `url(#${tg})`, 1.4);
    const at = [62, 66, -18, .8, [-2, -26]];
    return [`<defs>${aVGrad(bg, "#3949ab", "#ff8a65")}${grad(tg, [[0, "#ffa23a"], [1, "#e86400"]])}${checks(ck, 3.2)}</defs>` +
      `<rect width="120" height="158" fill="url(#${bg})"/>` +
      aC(60, 136, 30, "#ffca28", `opacity=".85"`) +
      // canyon
      Pn("M0,124 L18,122 L30,132 L46,128 L60,136 L76,128 L92,132 L106,122 L120,126 V158 H0Z", "#6d3f17", st(1.2)) +
      Pn("M30,158 L40,140 L52,146 L62,140 L74,146 L86,158Z", "#2b1608") +
      // supports, then the ramps: take-off on the left, landing on the right
      `<path d="M8,152 V158 M22,142 V158 M34,133 V158 M92,134 V158 M106,143 V158" stroke="${A_OL}" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="M8,152 V158 M22,142 V158 M34,133 V158 M92,134 V158 M106,143 V158" stroke="#b39ddb" stroke-width="2" stroke-linecap="round"/>` +
      ramp("M-4,154 L38,124 L42,126 L42,132 L-4,160Z") + `<path d="M0,155 L38,127" stroke="#fff" stroke-width="1.2" opacity=".6"/>` +
      ramp("M82,124 L124,150 L124,158 L82,130Z") + `<path d="M84,127 L124,152" stroke="#fff" stroke-width="1.2" opacity=".6"/>` +
      // the dotted flight path
      `<path d="M40,120 Q58,40 86,122" fill="none" stroke="#fff" stroke-width="1.8" stroke-dasharray="2 4" stroke-linecap="round" opacity=".85"/>` +
      flag(110, 104, 14, 10, 34, ck, true) +
      aSpark(104, 24, 5) + aSpark(88, 14, 3) + aSpark(14, 108, 3) + aStar(100, 90, 3, "#fff59d"),
    `<defs>${paint(pg, "#6fa8ff", "#1e5fd6", "#123f99")}${chrome(ch)}${glassG(gg)}</defs>` + place(sp, ...at) + aEdge(place(car, ...at))];
  }

  FAN.hotwheels = [
    ["Hot Wheels", "the red flame logo as a shiny chrome badge on chequered stripes", hwBadge],
    ["Twin Mill", "dark-blue, two chrome blowers with intake scoops side by side on the long hood, racing up the orange track at night", twinMill],
    ["Bone Shaker", "black hot rod with the skull grille, chrome engine and big red-line back wheels, over flames", boneShaker],
    ["Sharkruiser", "the shark car: open jaws, teeth, gills, fin and tail, blower on its back, by the sea", sharkruiser],
    ["Deora II", "the aqua surf wagon with two surfboards sliding out of the back, on the track by the beach", deora],
    ["Rodger Dodger", "purple muscle car, orange stripe, a big chrome blower through the hood, chequered backdrop", rodgerDodger],
    ["Mega-Wrex", "the T-rex monster truck: jaws open, tiny arms, huge tyres, in the arena", megaWrex],
    ["Loop-the-loop", "a big red racer upside-down round the top of the orange loop, sparks flying", loop],
    ["The big jump", "a big blue racer flying over the canyon between two ramps, fire from the exhaust", jump],
  ];
})();

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
