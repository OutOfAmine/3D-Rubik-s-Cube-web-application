/**
 * Rubik's Cube model and layer-by-layer solver.
 * Pure logic: no DOM, no Three.js. Runs in the browser and in Node.
 *
 * State = array of 26 cubies `{p:[x,y,z], s:[{n:[nx,ny,nz], f:'U'}], id:'DFR'}`
 * where `p` is the grid position (each coordinate in {-1,0,1}), `s` the stickers with
 * their current outward normal `n` and home face `f`, and `id` the sorted home faces.
 * Orientation: U yellow (+y), D white (-y), F orange (+z), B red (-z), L green (-x), R blue (+x).
 * Moves use Singmaster notation: U D L R F B (+ M E S slices), suffix `'` inverse, `2` half turn.
 */

export const FACES = ['U','D','F','B','L','R'];
export const NORMAL = {U:[0,1,0], D:[0,-1,0], F:[0,0,1], B:[0,0,-1], L:[-1,0,0], R:[1,0,0]};
export const COLORS = {U:0xffd500, D:0xf4f4f4, F:0xff6a00, B:0xc8102e, L:0x00a651, R:0x0051ba};
const FACE_OF = {}; for (const f of FACES) FACE_OF[NORMAL[f].join()] = f;
// letter -> [axis, layer, dir]; dir = sign of right-hand rotation for the plain (clockwise) move
export const MOVE_DEF = {R:[0,1,-1], L:[0,-1,1], M:[0,0,1], U:[1,1,-1], D:[1,-1,1], E:[1,0,1], F:[2,1,-1], B:[2,-1,1], S:[2,0,-1]};

// state = array of 26 cubies {p:[x,y,z], s:[{n:[nx,ny,nz], f:'U'}], id:'DFR'}
export function solvedState(){
  const st = [];
  for (let x=-1;x<=1;x++) for (let y=-1;y<=1;y++) for (let z=-1;z<=1;z++){
    if (!x && !y && !z) continue;
    const p=[x,y,z], s=[];
    p.forEach((v,i)=>{ if (v){ const n=[0,0,0]; n[i]=v; s.push({n, f:FACE_OF[n.join()]}); } });
    st.push({p, s, id:s.map(k=>k.f).sort().join('')});
  }
  return st;
}
export const clone = st => st.map(c => ({p:c.p.slice(), s:c.s.map(k=>({n:k.n.slice(), f:k.f})), id:c.id}));
// rotate integer vector 90° about axis a (0,1,2); d=+1 right-hand, -1 left-hand
function rotV(v,a,d){ const b=(a+1)%3, c=(a+2)%3, r=v.slice(); r[b]=-d*v[c]; r[c]=d*v[b]; return r; }
export function applyMove(st,m){
  for (let t=0; t<(m.turns||1); t++)
    for (const c of st) if (c.p[m.a]===m.l){ c.p=rotV(c.p,m.a,m.d); for (const k of c.s) k.n=rotV(k.n,m.a,m.d); }
}
export function parseToken(tok){
  const [a,l,d] = MOVE_DEF[tok[0]]; const suf = tok.slice(1);
  return {a, l, d: suf==="'" ? -d : d, turns: suf==='2' ? 2 : 1};
}
export const parse = alg => alg.trim().split(/\s+/).filter(Boolean).map(parseToken);
export function moveName(m){
  for (const k in MOVE_DEF){ const [a,l,d]=MOVE_DEF[k]; if (a===m.a && l===m.l) return k + (m.turns===2 ? '2' : d===m.d ? '' : "'"); }
}
export const applyAlg = (st,ms) => { for (const m of ms) applyMove(st,m); };
const undoAlg  = (st,ms) => { for (let i=ms.length-1;i>=0;i--) applyMove(st,{...ms[i], d:-ms[i].d}); };
const find = (st,id) => st.find(c=>c.id===id);
const stickerOk = k => { const N=NORMAL[k.f]; return k.n[0]===N[0] && k.n[1]===N[1] && k.n[2]===N[2]; };
export const solvedPiece = (st,id) => find(st,id).s.every(stickerOk);
const allSolved = (st,ids) => ids.every(id=>solvedPiece(st,id));
export const isSolved = st => st.every(c=>c.s.every(stickerOk));
const sid = s => s.split('').sort().join('');

// Iterative-deepening DFS over a menu of algorithms. On success the moves are left applied to st.
function search(st, menu, goal, maxDepth){
  const items = menu.map(a => { const m=parse(a); return {a, m, k: m.length===1 ? m[0].a*3+m[0].l : undefined}; });
  const path = [];
  const dfs = (depth, lastK) => {
    if (depth===0) return goal();
    for (const it of items){
      if (it.k!==undefined && it.k===lastK) continue; // don't turn same face twice in a row
      applyAlg(st,it.m); path.push(it.a);
      if (dfs(depth-1, it.k)) return true;
      path.pop(); undoAlg(st,it.m);
    }
    return false;
  };
  for (let d=0; d<=maxDepth; d++) if (dfs(d,null)) return path;
  return null;
}

// merge consecutive same-face moves (R R -> R2, R R' -> nothing)
function simplify(tokens){
  const out=[];
  for (const t of tokens){
    const f=t[0], q = t[1]==='2' ? 2 : t[1]==="'" ? 3 : 1;
    const last=out[out.length-1];
    if (last && last.f===f){ out.pop(); const n=(last.q+q)%4; if (n) out.push({f,q:n}); }
    else out.push({f,q});
  }
  return out.map(o => o.f + (o.q===2 ? '2' : o.q===3 ? "'" : ''));
}

const U_PRE = ['', 'U ', 'U2 ', "U' "];
const yMap = {F:'L', L:'B', B:'R', R:'F'};
function mapAlg(alg,j){ let s=alg; for (let i=0;i<j;i++) s=s.replace(/[FLBR]/g, c=>yMap[c]); return s; }
function menuOf(algs, slots){
  const out=[]; for (const p of U_PRE) for (const a of algs) for (let j=0;j<(slots?4:1);j++) out.push(p+mapAlg(a,j)); return out;
}

export const STAGES = [
  ['White cross', 'Put the four white edges on the bottom face so each one also matches the side center next to it.'],
  ['White corners', 'Insert the four white corners between their matching centers. Each corner is brought above its slot and dropped in with a short trigger like R U R\'.'],
  ['Middle layer edges', 'The four edges without yellow go from the top layer into the middle layer using the right-hand (U R U\' R\' U\' F\' U F) or left-hand insert.'],
  ['Yellow cross', 'Flip the top edges so yellow faces up, using F R U R\' U\' F\' from the dot, L or line pattern.'],
  ['Yellow face', 'Twist the top corners so the whole top is yellow with the Sune (R U R\' U R U2 R\') and its mirror.'],
  ['Position top corners', 'Cycle the top corners into place with an A-perm; the side colors of each corner now line up.'],
  ['Position top edges', 'Cycle the last edges with a U-perm, then a final top turn finishes the cube.'],
];

// Layer-by-layer solver. White (D) bottom, yellow (U) top.
// Returns {tokens, stages:[{name, desc, moves}]}
export function solveDetailed(state){
  const st = clone(state), done = [], stages = STAGES.map(([name,desc]) => ({name, desc, moves:[]}));
  let cur;
  const step = (menu, goal, depth, label) => {
    const r = search(st, menu, goal, depth);
    if (!r) throw new Error('Solver stuck at ' + label);
    for (const a of r) cur.moves.push(...a.split(/\s+/).filter(Boolean));
  };
  const singles = [...'UDFBLR'].flatMap(f => [f, f+"'", f+'2']);
  const keep = () => allSolved(st, done);

  cur = stages[0]; // cross: bring edge to U layer with white up, then insert with a double turn
  for (const id of ['DF','DR','DB','DL'].map(sid)){
    const c = find(st,id), w = c.s.find(k=>k.f==='D');
    step(singles, () => keep() && (solvedPiece(st,id) || (c.p[1]===1 && w.n[1]===1)), 5, 'cross '+id);
    step(menuOf(['F2','R2','B2','L2']), () => keep() && solvedPiece(st,id), 1, 'cross insert '+id);
    done.push(id);
  }
  cur = stages[1];
  const cornerMenu = [...menuOf(["R U R'", "F' U' F", "R U2 R' U' R U R'"], true), ...[0,1,2,3].map(j=>mapAlg("R U R'",j))];
  for (const id of ['DFR','DFL','DBL','DBR'].map(sid)){ step(cornerMenu, () => keep() && solvedPiece(st,id), 3, 'corner '+id); done.push(id); }
  cur = stages[2];
  const edgeMenu = menuOf(["U R U' R' U' F' U F", "U' L' U L U F U' F'"], true);
  for (const id of ['FR','FL','BL','BR'].map(sid)){ step(edgeMenu, () => keep() && solvedPiece(st,id), 2, 'edge '+id); done.push(id); }
  const uPieces = st.filter(c=>c.id.includes('U'));
  const oriented = c => c.s.find(k=>k.f==='U').n[1]===1;
  cur = stages[3];
  step(menuOf(["F R U R' U' F'", "F U R U' R' F'"]), () => uPieces.filter(c=>c.s.length===2).every(oriented), 3, 'OLL edges');
  cur = stages[4];
  step(menuOf(["R U R' U R U2 R'", "R U2 R' U' R U' R'"]), () => uPieces.every(oriented), 3, 'OLL corners');
  const uCorners = ['UFR','UFL','UBL','UBR'].map(sid);
  const upToAUF = pred => () => U_PRE.some(p => { const t=clone(st); applyAlg(t,parse(p)); return pred(t); });
  cur = stages[5];
  step(menuOf(["R' F R' B2 R F' R' B2 R2", "R B' R F2 R' B R F2 R2"]), upToAUF(t=>allSolved(t,uCorners)), 2, 'PLL corners');
  cur = stages[6];
  step(menuOf(["R U' R U R U R U' R' U' R2", "R2 U R U R' U' R' U' R' U R'"]), upToAUF(isSolved), 2, 'PLL edges');
  for (const p of U_PRE){ const t=clone(st); applyAlg(t,parse(p)); if (isSolved(t)){ applyAlg(st,parse(p)); if (p) cur.moves.push(p.trim()); break; } }
  if (!isSolved(st)) throw new Error('Solver failed');
  for (const s of stages) s.moves = simplify(s.moves);
  return {stages, tokens: stages.flatMap(s=>s.moves)};
}
export const solve = state => solveDetailed(state).tokens;

export function randomScramble(n=20){
  const faces='UDFBLR', toks=[]; let last=-1, last2=-1;
  for (let i=0;i<n;i++){
    let f; do { f=Math.floor(Math.random()*6); }
    while (f===last || ((f>>1)===(last>>1) && (f>>1)===(last2>>1)));
    last2=last; last=f; toks.push(faces[f] + ['',"'",'2'][Math.floor(Math.random()*3)]);
  }
  return toks;
}

// Self-check used by the test-suite and by `index.html?test`.
export function selfTest(n=20){
  const t0=Date.now(); let len=0;
  for (let i=0;i<n;i++){
    const st=solvedState(); applyAlg(st, parse(randomScramble(25).join(' ')));
    const sol=solve(st); applyAlg(st, parse(sol.join(' ')));
    if (!isSolved(st)) throw new Error('selfTest: not solved on iteration '+i);
    len+=sol.length;
  }
  return {ok:true, n, avgMoves: len/n, ms: Date.now()-t0};
}
