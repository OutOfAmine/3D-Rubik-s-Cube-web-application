/**
 * Rubik's Cube Challenge: Three.js rendering, animation pipeline, input and UI.
 * Cube model and solver live in ./cube-logic.js.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import * as L from './cube-logic.js';
const $ = id => document.getElementById(id);
const canvas = $('c');

// --- renderer / scene / camera ---
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true}); // transparent: the CSS gradient shows through
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
const HOME = new THREE.Vector3(4.8, 4.4, 6.4);
camera.position.copy(HOME);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.minDistance = 5; controls.maxDistance = 18; controls.enablePan = false;
controls.autoRotate = true; controls.autoRotateSpeed = 1.2; // slow idle spin until the player touches the cube

scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0c8, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(5, 9, 6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {near:1, far:30, left:-4, right:4, top:4, bottom:-4});
sun.shadow.radius = 6; sun.shadow.bias = -0.0004;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({opacity:0.2}));
ground.rotation.x = -Math.PI/2; ground.position.y = -2.6; ground.receiveShadow = true;
scene.add(ground);

// --- cubies ---
const state = L.solvedState();
const cubeGroup = new THREE.Group(); scene.add(cubeGroup);
const pivot = new THREE.Group(); scene.add(pivot);          // dummy pivot at origin
const bodyGeo = new RoundedBoxGeometry(0.97, 0.97, 0.97, 4, 0.09);
const bodyMat = new THREE.MeshStandardMaterial({color:0x141414, roughness:0.45, metalness:0.05});
const stickerGeo = new RoundedBoxGeometry(0.82, 0.82, 0.06, 3, 0.1);
const stickerMat = {};
for (const f in L.COLORS) stickerMat[f] = new THREE.MeshPhysicalMaterial({
  color:L.COLORS[f], roughness:0.3, metalness:0, clearcoat:0.7, clearcoatRoughness:0.15, envMapIntensity:0.7});
const Z = new THREE.Vector3(0,0,1);

const cubies = state.map(c => {
  const g = new THREE.Group(); g.position.set(...c.p); g.userData.cubie = c;
  const body = new THREE.Mesh(bodyGeo, bodyMat); body.castShadow = body.receiveShadow = true; g.add(body);
  for (const k of c.s){
    const m = new THREE.Mesh(stickerGeo, stickerMat[k.f]);
    const n = new THREE.Vector3(...k.n);
    m.position.copy(n).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(Z, n);
    m.castShadow = true; g.add(m);
  }
  cubeGroup.add(g); return g;
});

// C[x][y][z] grid of cubie meshes (indices 0..2 == coords -1..1)
const C = [0,1,2].map(() => [0,1,2].map(() => [null,null,null]));
function rebuildGrid(){ for (const g of cubies){ const p=g.userData.cubie.p; C[p[0]+1][p[1]+1][p[2]+1]=g; } }
rebuildGrid(); window.C = C; window.cubeState = state; window.cubeCam = camera;

// --- move queue & animation pipeline ---
const AX = ['x','y','z'];
let queue = [], current = null, solveRun = null;
const history = [];
const game = {active:false, t0:null, moves:0, hints:0, n:0};

function enqueue(move, dur, tag){
  if (tag !== 'solve') cancelSolve();
  if (tag === 'user' || tag === 'hint') hideToast();
  queue.push({move, dur, tag});
}
function startMove(job){
  const {move} = job;
  const members = cubies.filter(g => g.userData.cubie.p[move.a] === move.l);
  for (const g of members) pivot.attach(g);
  current = {...job, members, t0:performance.now(), angle: move.d*(move.turns||1)*Math.PI/2};
}
const _m = new THREE.Matrix4();
function snapQuat(q){
  _m.makeRotationFromQuaternion(q);
  const e=_m.elements; for (let i=0;i<16;i++) e[i]=Math.round(e[i]);
  q.setFromRotationMatrix(_m);
}
function finishMove(){
  const {move, members, angle, tag} = current;
  pivot.rotation[AX[move.a]] = angle; pivot.updateMatrixWorld(true);
  for (const g of members){ cubeGroup.attach(g); g.position.round(); snapQuat(g.quaternion); }
  pivot.rotation.set(0,0,0);
  L.applyMove(state, move); rebuildGrid();
  history.push(L.moveName(move));
  current = null;
  if (tag === 'solve') renderSolution();
  if (game.active){
    if (tag === 'scramble' && !queue.length){ game.t0 = performance.now(); toast('Go! Drag a sticker to turn a layer. 💡 Hint if you get stuck.', 4000); }
    if (tag === 'user' || tag === 'hint'){ game.moves++; if (tag==='hint') game.hints++; updateHud(); if (L.isSolved(state) && !queue.length) win(); }
    if (tag === 'solve'){ endGame(); toast('The helper is solving it. Tap Play for a new challenge.', 3000); }
  } else if (!queue.length && !solveRun && L.isSolved(state) && history.length) toast('✨ Solved!', 2500);
}
const ease = t => t<0.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;

// camera view tween (in spherical coords so the distance stays constant)
let camTween = null; const _sph = new THREE.Spherical();
function tick(now){
  requestAnimationFrame(tick);
  if (!current){
    if (queue.length) startMove(queue.shift());
    else if (solveRun && solveRun.playing && solveRun.i < solveRun.tokens.length) stepSolve();
  }
  if (current){
    const t = Math.min(1, (now-current.t0)/current.dur);
    pivot.rotation[AX[current.move.a]] = current.angle*ease(t);
    if (t >= 1) finishMove();
  }
  if (camTween){
    const k = ease(Math.min(1, (now-camTween.t0)/450)), a=camTween.a, b=camTween.b;
    camera.position.setFromSpherical(_sph.set(a.radius+(b.radius-a.radius)*k, a.phi+(b.phi-a.phi)*k, a.theta+(b.theta-a.theta)*k));
    if (k >= 1) camTween = null;
  }
  if (game.active && game.t0) $('hTime').textContent = fmt(performance.now()-game.t0);
  controls.update();
  renderer.render(scene, camera);
}
function resize(){
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  // fit the cube (diagonal ~5.2) into the band between the top bar (~70px) and the bottom bar (~150px)
  const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  const usable = Math.max(0.35, (innerHeight - 220)/innerHeight);
  const r = Math.max(8, 3.1/(halfFov*camera.aspect), 3.1/(halfFov*usable));
  controls.maxDistance = r + 6;
  controls.target.set(0, -(40/innerHeight)*2*r*halfFov, 0); // band center sits ~40px above screen center
  HOME.setLength(r); if (!camTween) camera.position.setLength(r);
}
addEventListener('resize', resize); resize(); requestAnimationFrame(tick);

// view buttons: rotate camera 90° around the cube, tilt, or go home
$('view').onclick = e => {
  const v = e.target.dataset.v; if (!v) return;
  const a = new THREE.Spherical().setFromVector3(camera.position);
  const b = v === 'home' ? new THREE.Spherical().setFromVector3(HOME) : a.clone();
  if (v === 'left' || v === 'right') b.theta += (v==='left' ? 1 : -1)*Math.PI/2;
  if (v === 'up' || v === 'down') b.phi = THREE.MathUtils.clamp(b.phi + (v==='up' ? -1 : 1)*Math.PI/4, 0.15, Math.PI-0.15);
  b.theta = a.theta + THREE.MathUtils.euclideanModulo(b.theta - a.theta + Math.PI, 2*Math.PI) - Math.PI; // shortest way round
  camTween = {a, b, t0: performance.now()};
};

// --- drag-to-rotate (raycast) ---
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null;
canvas.addEventListener('pointerdown', e => {
  if (current || (e.pointerType==='mouse' && e.button!==0)) return;
  ndc.set(e.clientX/innerWidth*2-1, -(e.clientY/innerHeight)*2+1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(cubeGroup.children, true)[0];
  if (!hit) return;
  let g = hit.object; while (g.parent !== cubeGroup) g = g.parent;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const ai = [0,1,2].reduce((b,i) => Math.abs(n.getComponent(i)) > Math.abs(n.getComponent(b)) ? i : b, 0);
  const N = [0,0,0]; N[ai] = Math.sign(n.getComponent(ai));
  drag = {g, N, ai, x:e.clientX, y:e.clientY, point:hit.point.clone()};
  controls.enabled = false; controls.autoRotate = false;
  e.stopImmediatePropagation();
}, {capture:true});
canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; });

addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX-drag.x, dy = e.clientY-drag.y;
  if (dx*dx+dy*dy < 150) return;
  // pick the tangent direction on the face whose screen projection best matches the drag
  let best = null, bestScore = -Infinity;
  const p0 = drag.point.clone().project(camera);
  for (const i of [0,1,2]) if (i !== drag.ai) for (const s of [1,-1]){
    const t=[0,0,0]; t[i]=s;
    const p1 = drag.point.clone().add(new THREE.Vector3(...t).multiplyScalar(0.5)).project(camera);
    const sx=(p1.x-p0.x)*innerWidth/2, sy=-(p1.y-p0.y)*innerHeight/2;
    const score = (sx*dx+sy*dy)/(Math.hypot(sx,sy)||1);
    if (score > bestScore){ bestScore=score; best=t; }
  }
  // rotation axis = normal x tangent (right-hand +90° about it moves the face point along the tangent)
  const N=drag.N, T=best;
  const a = [N[1]*T[2]-N[2]*T[1], N[2]*T[0]-N[0]*T[2], N[0]*T[1]-N[1]*T[0]];
  const ai = a.findIndex(v => v!==0);
  enqueue({a:ai, l:drag.g.userData.cubie.p[ai], d:a[ai], turns:1}, +$('speed').value, 'user');
  endDrag();
});
addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);
function endDrag(){ drag=null; controls.enabled=true; }

// --- UI ---
const fmt = ms => { const s=Math.floor(ms/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
let toastTimer = 0;
function toast(html, ms){
  const t = $('toast'); t.innerHTML = html; t.hidden = false; clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const hideToast = () => { $('toast').hidden = true; clearTimeout(toastTimer); };
function updateHud(){ $('hMoves').textContent = game.moves; $('hHints').textContent = game.hints; if (!game.t0) $('hTime').textContent = '0:00'; }
const speed = () => +$('speed').value;

// sheet (drawer) with two panes
function openSheet(pane){
  $('sheet').hidden = false;
  $('paneMoves').hidden = pane !== 'moves'; $('paneExplain').hidden = pane !== 'explain';
  $('sheetTitle').textContent = pane === 'moves' ? 'Turn a face' : 'Solution, step by step';
  $('movesBtn').classList.toggle('on', pane === 'moves'); $('explain').classList.toggle('on', pane === 'explain');
}
function closeSheet(){ $('sheet').hidden = true; $('movesBtn').classList.remove('on'); $('explain').classList.remove('on'); }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { closeSheet(); b.closest('dialog')?.close(); });
$('movesBtn').onclick = () => ($('sheet').hidden || $('paneMoves').hidden) ? openSheet('moves') : closeSheet();

for (const f of 'UDLRFB') for (const s of ['', "'"]){
  const b = document.createElement('button'); b.textContent = f+s;
  b.onclick = () => enqueue(L.parseToken(f+s), speed(), 'user');
  $('moves').appendChild(b);
}
function resetCube(){
  queue = []; if (current) finishMove(); cancelSolve(); hideToast();
  const fresh = L.solvedState();
  state.forEach((c,i) => Object.assign(c, fresh[i]));
  cubies.forEach((g,i) => { g.position.set(...state[i].p); g.quaternion.identity(); });
  rebuildGrid(); history.length = 0;
}
function scramble(n){
  for (const t of L.randomScramble(n)) enqueue(L.parseToken(t), 100, 'scramble');
}
$('reset').onclick = () => { endGame(); resetCube(); updateHud(); toast('Cube reset. Tap ▶ Play for a challenge.', 2500); };

// --- challenge: one tap to play ---
const dlg = {
  open: id => { const d=$(id); if (!d.open) (d.showModal ? d.showModal() : d.setAttribute('open','')); },
  close: id => { const d=$(id); d.close ? d.close() : d.removeAttribute('open'); },
};
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) dlg.close(d.id); }));
const difficulty = () => +document.querySelector('.seg .on').dataset.n;
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
  if (game.active) startGame();
});
function startGame(){
  resetCube(); closeSheet();
  Object.assign(game, {active:true, t0:null, moves:0, hints:0, n:difficulty()});
  updateHud(); $('stats').hidden = false; $('play').textContent = '↻ New game';
  controls.autoRotate = false;
  camTween = {a:new THREE.Spherical().setFromVector3(camera.position), b:new THREE.Spherical().setFromVector3(HOME), t0:performance.now()};
  scramble(game.n);
}
function endGame(){ game.active = false; $('play').textContent = '▶ Play'; }
$('play').onclick = startGame;
$('helpBtn').onclick = () => dlg.open('helpDlg');

function win(){
  const ms = performance.now()-game.t0; endGame();
  const label = {5:'easy', 12:'medium', 20:'hard'}[game.n] || game.n+'-move';
  const hints = game.hints ? `${game.hints} hint${game.hints>1?'s':''}` : '';
  $('winTitle').textContent = game.hints ? 'Solved!' : 'Flawless!';
  $('winText').textContent = game.hints ? `You cracked the ${label} scramble with ${hints}.` : `You cracked the ${label} scramble all by yourself!`;
  $('winStats').innerHTML = [[fmt(ms),'time'],[game.moves,'moves'],[game.hints,'hints']].map(([v,k]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('winShare').textContent = 'Share result';
  $('winShare').onclick = async () => {
    const msg = `🧩 I solved a ${label} Rubik's Cube scramble in ${fmt(ms)} with ${game.moves} moves${hints ? ' and '+hints : ''}. Can you beat it?`;
    const url = location.href.split('?')[0];
    try {
      if (navigator.share) await navigator.share({title:"Rubik's Cube Challenge", text:msg, url});
      else { await navigator.clipboard.writeText(`${msg} ${url}`); $('winShare').textContent = 'Copied!'; }
    } catch { /* user cancelled the share sheet */ }
  };
  confetti(); dlg.open('winDlg');
}
$('winAgain').onclick = () => { dlg.close('winDlg'); startGame(); };
function confetti(){
  const colors = Object.values(L.COLORS).map(c => '#'+c.toString(16).padStart(6,'0'));
  for (let i=0;i<90;i++){
    const d = document.createElement('i'); d.className = 'confetti';
    d.style.cssText = `left:${Math.random()*100}vw;background:${colors[i%colors.length]};animation-duration:${1.8+Math.random()*1.6}s;animation-delay:${Math.random()*.6}s`;
    document.body.appendChild(d); setTimeout(() => d.remove(), 4000);
  }
}

// --- help: hint / solve / explain ---
function virtualState(){ const s=L.clone(state); if (current) L.applyMove(s,current.move); for (const j of queue) L.applyMove(s,j.move); return s; }
function plan(){
  const s = virtualState();
  if (L.isSolved(s)){ toast('The cube is already solved. Tap <b>▶ Play</b> to scramble it.', 3000); return null; }
  try { return L.solveDetailed(s); } catch (err){ toast(err.message, 3000); return null; }
}
$('hintBtn').onclick = () => {
  const r = plan(); if (!r) return;
  const stage = r.stages.find(st => st.moves.length), tok = stage.moves[0];
  toast(`<span class="mv">${tok}</span><b>${stage.name}</b> · ${r.tokens.length} moves to go<div class="muted">${stage.desc}</div>
    <div class="row"><button id="doHint" class="cta small">Do it for me</button><button id="closeHint">Got it</button></div>`);
  $('doHint').onclick = () => enqueue(L.parseToken(tok), speed(), 'hint');
  $('closeHint').onclick = hideToast;
};
$('explain').onclick = () => {
  if (!$('sheet').hidden && !$('paneExplain').hidden){ closeSheet(); return; }
  openSheet('explain');
  if (solveRun){ renderSolution(); return; }
  const r = plan();
  if (!r){
    $('sol').innerHTML = '<div class="stage notice">Scramble the cube first (▶ Play), then come back here to see the solution.</div>'
      + L.STAGES.map(([n,d],i) => `<div class="stage"><h4>${i+1}. ${n}</h4><p>${d}</p></div>`).join('');
    setPlaybar(false); return;
  }
  solveRun = {tokens:r.tokens, stages:r.stages, i:0, playing:false}; renderSolution(); setPlaybar(true);
};
$('solve').onclick = () => {
  if (solveRun){ solveRun.playing = true; $('pause').textContent = 'Pause'; openSheet('explain'); renderSolution(); return; }
  const r = plan(); if (!r) return;
  solveRun = {tokens:r.tokens, stages:r.stages, i:0, playing:true};
  openSheet('explain'); renderSolution(); setPlaybar(true);
};
$('playAll').onclick = $('solve').onclick;
function setPlaybar(on){ $('step').disabled = $('pause').disabled = !on; }
function stepSolve(){
  if (!solveRun || solveRun.i >= solveRun.tokens.length) return;
  queue.push({move:L.parseToken(solveRun.tokens[solveRun.i++]), dur:speed(), tag:'solve'});
  renderSolution();
}
$('step').onclick = () => { if (solveRun){ solveRun.playing=false; $('pause').textContent='Play'; if (!current && !queue.length) stepSolve(); } };
$('pause').onclick = () => { if (solveRun){ solveRun.playing=!solveRun.playing; $('pause').textContent = solveRun.playing ? 'Pause' : 'Play'; } };
function renderSolution(){
  const el = $('sol'); el.innerHTML = '';
  if (!solveRun) return;
  const doneCount = solveRun.i - (current && current.tag==='solve' ? 1 : 0) - queue.filter(j=>j.tag==='solve').length;
  const stageCount = solveRun.stages.filter(s=>s.moves.length).length;
  el.insertAdjacentHTML('beforeend', `<p class="tip">${solveRun.tokens.length} moves in ${stageCount} stages, beginner layer-by-layer method. ${doneCount ? doneCount+' done.' : 'Press ▶ Play all or Step.'}</p>`);
  let idx = 0, n = 0;
  for (const st of solveRun.stages){
    if (!st.moves.length) continue;
    n++;
    const first = idx, last = idx + st.moves.length, active = doneCount >= first && doneCount < last;
    const div = document.createElement('div');
    div.className = 'stage' + (active ? ' active' : '');
    div.innerHTML = `<h4>${n}. ${st.name} <small>${doneCount>=last ? '✓ done' : st.moves.length+' moves'}</small></h4><p>${st.desc}</p><div class="chips"></div>`;
    const chips = div.querySelector('.chips');
    st.moves.forEach(t => {
      const c = document.createElement('span');
      c.className = 'chip' + (idx<doneCount ? ' done' : idx===doneCount ? ' now' : ''); c.textContent = t; chips.appendChild(c); idx++;
    });
    el.appendChild(div);
    if (active && doneCount) div.scrollIntoView({block:'nearest', behavior:'smooth'});
  }
  if (doneCount >= solveRun.tokens.length){ toast(`✨ Solved in ${solveRun.tokens.length} moves.`, 3000); cancelSolve(false); }
}
function cancelSolve(clear=true){
  if (!solveRun) return;
  solveRun = null; setPlaybar(false);
  if (clear) $('sol').innerHTML = '';
}

toast('Tap <b>▶ Play</b> to scramble the cube, then drag a sticker to turn a layer.', 6000);
if (location.search.includes('test')) console.log('selfTest', L.selfTest(20)); // eslint-disable-line no-console
