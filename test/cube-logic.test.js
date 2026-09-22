import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  solvedState, applyAlg, parse, isSolved, solve, solveDetailed,
  randomScramble, moveName, parseToken, STAGES,
} from '../src/cube-logic.js';

const scrambled = alg => { const st = solvedState(); applyAlg(st, parse(alg)); return st; };

test('solved state has 26 cubies and is solved', () => {
  const st = solvedState();
  assert.equal(st.length, 26);
  assert.ok(isSolved(st));
});

test('a move followed by its inverse restores the cube', () => {
  for (const f of 'UDLRFB') assert.ok(isSolved(scrambled(`${f} ${f}'`)), f);
  assert.ok(isSolved(scrambled('R2 R2')));
});

test('sexy move has order 6', () => {
  const st = scrambled("R U R' U'");
  assert.ok(!isSolved(st));
  applyAlg(st, parse("R U R' U' ".repeat(5)));
  assert.ok(isSolved(st));
});

test('moveName round-trips every token', () => {
  for (const tok of ['U', "U'", 'U2', 'R', "L'", 'F2', 'M', 'E', "S'"]) assert.equal(moveName(parseToken(tok)), tok);
});

test('randomScramble never repeats a face twice in a row', () => {
  for (let i = 0; i < 50; i++) {
    const toks = randomScramble(20);
    assert.equal(toks.length, 20);
    for (let j = 1; j < toks.length; j++) assert.notEqual(toks[j][0], toks[j - 1][0]);
  }
});

test('solver solves 100 random scrambles', () => {
  for (let i = 0; i < 100; i++) {
    const st = scrambled(randomScramble(25).join(' '));
    const sol = solve(st);
    applyAlg(st, parse(sol.join(' ')));
    assert.ok(isSolved(st), `scramble ${i} not solved`);
    assert.ok(sol.length < 200, `solution too long: ${sol.length}`);
  }
});

test('solveDetailed reports all stages and concatenates to the full solution', () => {
  const r = solveDetailed(scrambled("F R U' B2 L D F' R2 U L' D2 B"));
  assert.equal(r.stages.length, STAGES.length);
  assert.deepEqual(r.tokens, r.stages.flatMap(s => s.moves));
  assert.ok(r.stages[0].moves.length > 0, 'cross stage should have moves for this scramble');
});

test('solving a solved cube yields no moves', () => {
  assert.deepEqual(solve(solvedState()), []);
});
