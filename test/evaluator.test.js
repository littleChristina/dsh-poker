'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAT, evaluate5, evaluate7, handName } = require('../server/game/evaluator');

const V = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, T: 8, J: 9, Q: 10, K: 11, A: 12 };
const S = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };
const card = (t) => S[t[1]] * 13 + V[t[0]];
const hand = (s) => s.split(' ').map(card);

test('识别皇家同花顺', () => {
  const ev = evaluate5(hand('T♠ J♠ Q♠ K♠ A♠'));
  assert.equal(ev.cat, CAT.STRAIGHT_FLUSH);
  assert.equal(ev.vals[0], 12);
  assert.equal(handName(ev), '皇家同花顺');
});

test('识别 A2345 同花顺（5 高）', () => {
  const ev = evaluate5(hand('A♥ 2♥ 3♥ 4♥ 5♥'));
  assert.equal(ev.cat, CAT.STRAIGHT_FLUSH);
  assert.equal(ev.vals[0], 3);
  assert.equal(handName(ev), '同花顺（A2345）');
});

test('A2345 作为普通顺子，且小于 23456', () => {
  const wheel = evaluate5(hand('A♠ 2♥ 3♦ 4♣ 5♠'));
  const six = evaluate5(hand('2♠ 3♥ 4♦ 5♣ 6♠'));
  assert.equal(wheel.cat, CAT.STRAIGHT);
  assert.equal(wheel.vals[0], 3);
  assert.ok(six.score > wheel.score);
});

test('四条带踢脚，踢脚决定大小', () => {
  const aceKing = evaluate5(hand('A♠ A♥ A♦ A♣ K♠'));
  const aceQueen = evaluate5(hand('A♠ A♥ A♦ A♣ Q♦'));
  assert.equal(aceKing.cat, CAT.QUADS);
  assert.equal(aceKing.vals[1], 11);
  assert.ok(aceKing.score > aceQueen.score);
});

test('葫芦先比三条再比对子', () => {
  const kings = evaluate5(hand('K♠ K♥ K♦ 2♣ 2♠'));
  const queens = evaluate5(hand('Q♠ Q♥ Q♦ A♣ A♠'));
  assert.equal(kings.cat, CAT.FULL_HOUSE);
  assert.ok(kings.score > queens.score);
});

test('同花按最高牌依次比较', () => {
  const a = evaluate5(hand('A♠ K♠ 9♠ 6♠ 3♠'));
  const b = evaluate5(hand('A♥ K♥ 9♥ 5♥ 4♥'));
  assert.equal(a.cat, CAT.FLUSH);
  assert.ok(a.score > b.score);
});

test('牌型大小顺序：高牌 < 一对 < 两对 < 三条 < 顺子 < 同花 < 葫芦 < 四条 < 同花顺', () => {
  const list = [
    hand('A♠ K♦ 9♣ 5♥ 3♠'),
    hand('A♠ A♦ K♣ 9♥ 3♠'),
    hand('A♠ A♦ K♣ K♥ 3♠'),
    hand('A♠ A♦ A♣ K♥ 3♠'),
    hand('9♠ T♦ J♣ Q♥ K♠'),
    hand('A♠ K♠ 9♠ 5♠ 3♠'),
    hand('K♠ K♦ K♣ 2♥ 2♠'),
    hand('A♠ A♦ A♣ A♥ K♠'),
    hand('9♠ T♠ J♠ Q♠ K♠'),
  ];
  const scores = list.map((c) => evaluate5(c).score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1], `第 ${i} 项应更大`);
});

test('两对与一对的踢脚比较', () => {
  const twoPairA = evaluate5(hand('A♠ A♦ K♣ K♥ Q♠'));
  const twoPairB = evaluate5(hand('A♠ A♦ K♣ K♥ J♠'));
  assert.equal(twoPairA.cat, CAT.TWO_PAIR);
  assert.ok(twoPairA.score > twoPairB.score);
  const pairA = evaluate5(hand('A♠ A♦ K♣ Q♥ 9♠'));
  const pairB = evaluate5(hand('A♠ A♦ K♣ Q♥ 8♠'));
  assert.ok(pairA.score > pairB.score);
});

test('evaluate7 从 7 张里挑最大牌型（同花顺压过四条）', () => {
  const ev = evaluate7(hand('5♠ 6♠ 7♠ 8♠ 9♠ 9♥ 9♦'));
  assert.equal(ev.cat, CAT.STRAIGHT_FLUSH);
  assert.equal(ev.cards.length, 5);
});

test('evaluate7 识别葫芦', () => {
  const ev = evaluate7(hand('A♠ A♥ A♦ K♠ K♥ 2♠ 3♠'));
  assert.equal(ev.cat, CAT.FULL_HOUSE);
  assert.equal(handName(ev), '葫芦');
});

test('牌数不对时抛错', () => {
  assert.throws(() => evaluate5(hand('A♠ K♠ Q♠ J♠')), /正好 5 张/);
  assert.throws(() => evaluate7(hand('A♠ K♠ Q♠ J♠ T♠ 9♠')), /正好 7 张/);
});
