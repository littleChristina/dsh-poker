'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPots } = require('../server/game/pots');

test('两人投入相同：一个池，无退款', () => {
  const { pots, refunds } = buildPots([
    { id: 'a', amount: 100, folded: false },
    { id: 'b', amount: 100, folded: false },
  ]);
  assert.equal(refunds.size, 0);
  assert.deepEqual(pots, [{ amount: 200, eligible: ['a', 'b'] }]);
});

test('三人不同投入：主池 + 边池，最高未跟注部分退回', () => {
  const { pots, refunds } = buildPots([
    { id: 'a', amount: 100, folded: false },
    { id: 'b', amount: 50, folded: false },
    { id: 'c', amount: 20, folded: false },
  ]);
  assert.equal(refunds.get('a'), 50);
  assert.deepEqual(pots, [
    { amount: 60, eligible: ['a', 'b', 'c'] },
    { amount: 60, eligible: ['a', 'b'] },
  ]);
  const total = pots.reduce((s, p) => s + p.amount, 0) + [...refunds.values()].reduce((s, v) => s + v, 0);
  assert.equal(total, 170);
});

test('弃牌玩家的筹码留在池里但没有资格赢', () => {
  const { pots, refunds } = buildPots([
    { id: 'a', amount: 100, folded: true },
    { id: 'b', amount: 100, folded: false },
    { id: 'c', amount: 100, folded: false },
  ]);
  assert.equal(refunds.size, 0);
  assert.deepEqual(pots, [{ amount: 300, eligible: ['b', 'c'] }]);
});

test('弃牌的最高投入者，未跟注部分也退回，池子不留死钱', () => {
  const { pots, refunds } = buildPots([
    { id: 'a', amount: 100, folded: true },
    { id: 'b', amount: 60, folded: false },
    { id: 'c', amount: 60, folded: false },
  ]);
  assert.equal(refunds.get('a'), 40);
  assert.deepEqual(pots, [{ amount: 180, eligible: ['b', 'c'] }]);
  const total = pots.reduce((s, p) => s + p.amount, 0) + [...refunds.values()].reduce((s, v) => s + v, 0);
  assert.equal(total, 220);
});

test('两人并列最高时没有退款，边池只给有资格的人', () => {
  const { pots, refunds } = buildPots([
    { id: 'a', amount: 30, folded: false },
    { id: 'b', amount: 200, folded: false },
    { id: 'c', amount: 200, folded: false },
  ]);
  assert.equal(refunds.size, 0);
  assert.deepEqual(pots, [
    { amount: 90, eligible: ['a', 'b', 'c'] },
    { amount: 340, eligible: ['b', 'c'] },
  ]);
});

test('没有投入的玩家不出现在任何池子里', () => {
  const { pots } = buildPots([
    { id: 'a', amount: 0, folded: false },
    { id: 'b', amount: 50, folded: false },
    { id: 'c', amount: 50, folded: false },
  ]);
  assert.deepEqual(pots, [{ amount: 100, eligible: ['b', 'c'] }]);
});

test('同一层相邻的池子会合并', () => {
  const { pots } = buildPots([
    { id: 'a', amount: 50, folded: false },
    { id: 'b', amount: 50, folded: false },
  ]);
  assert.equal(pots.length, 1);
});
