'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MODES,
  FACTORS,
  DEFAULT_BLIND_CONFIG,
  blindsForLevel,
  blindSchedule,
  levelForHands,
  levelForTime,
  normalizeBlindConfig,
  validateBlindConfig,
} = require('../server/game/blinds');

function pair(b) {
  return [b.smallBlind, b.bigBlind];
}

test('第 1 级就是开局盲注', () => {
  assert.deepEqual(pair(blindsForLevel(10, 1.5, 1)), [10, 20]);
  assert.deepEqual(pair(blindsForLevel(25, 1.5, 1)), [25, 50]);
});

test('1.5 倍升盲序列：10/20 → 15/30 → 25/50 → 40/80 → 60/120 → 90/180', () => {
  const seq = [1, 2, 3, 4, 5, 6].map((lv) => pair(blindsForLevel(10, 1.5, lv)));
  assert.deepEqual(seq, [
    [10, 20],
    [15, 30],
    [25, 50],
    [40, 80],
    [60, 120],
    [90, 180],
  ]);
});

test('2 倍升盲：10/20 → 20/40 → 40/80 → 80/160', () => {
  const seq = [1, 2, 3, 4].map((lv) => pair(blindsForLevel(10, 2, lv)));
  assert.deepEqual(seq, [
    [10, 20],
    [20, 40],
    [40, 80],
    [80, 160],
  ]);
});

test('1.25 倍升盲保持递增且大小盲 2:1', () => {
  let prev = 0;
  for (let lv = 1; lv <= 8; lv++) {
    const b = blindsForLevel(10, 1.25, lv);
    assert.equal(b.bigBlind, b.smallBlind * 2);
    assert.ok(b.smallBlind > prev, `第 ${lv} 级应比上一级大`);
    assert.equal(b.smallBlind % 5, 0);
    prev = b.smallBlind;
  }
});

test('盲注封顶：大盲不超过 200000，继续升级不溢出', () => {
  const a = blindsForLevel(10, 2, 100);
  assert.equal(a.bigBlind, 200000);
  assert.equal(a.smallBlind, 100000);
  const b = blindsForLevel(10, 2, 101);
  assert.deepEqual(pair(b), pair(a));
});

test('level 参数容错：0、负数、小数都按第 1 级处理', () => {
  assert.deepEqual(pair(blindsForLevel(10, 1.5, 0)), [10, 20]);
  assert.deepEqual(pair(blindsForLevel(10, 1.5, -3)), [10, 20]);
  assert.deepEqual(pair(blindsForLevel(10, 1.5, 1.9)), [10, 20]);
});

test('handSchedule 从当前级开始预览 3 级', () => {
  const s = blindSchedule(10, 1.5, 2, 3);
  assert.deepEqual(
    s.map((x) => pair(x)),
    [
      [15, 30],
      [25, 50],
      [40, 80],
    ]
  );
  assert.deepEqual(
    s.map((x) => x.level),
    [2, 3, 4]
  );
});

test('hands 模式级数：每 10 手升一级', () => {
  assert.equal(levelForHands(0, 10), 1);
  assert.equal(levelForHands(9, 10), 1);
  assert.equal(levelForHands(10, 10), 2);
  assert.equal(levelForHands(29, 10), 3);
  assert.equal(levelForHands(30, 10), 4);
});

test('time 模式级数：第 0 分钟为第 1 级，满 10 分钟升第 2 级', () => {
  assert.equal(levelForTime(0, 10), 1);
  assert.equal(levelForTime(599999, 10), 1);
  assert.equal(levelForTime(600000, 10), 2);
  assert.equal(levelForTime(1800000, 10), 4);
  assert.equal(levelForTime(-5, 10), 1);
});

test('默认配置：关闭升盲、每 10 手/10 分钟、1.5 倍', () => {
  assert.deepEqual(normalizeBlindConfig(), DEFAULT_BLIND_CONFIG);
  assert.deepEqual(validateBlindConfig({}), DEFAULT_BLIND_CONFIG);
});

test('validate 接受三种模式与合法参数', () => {
  assert.equal(validateBlindConfig({ mode: 'off' }).mode, 'off');
  assert.equal(validateBlindConfig({ mode: 'hands', everyHands: 5 }).everyHands, 5);
  assert.equal(validateBlindConfig({ mode: 'time', everyMinutes: 15 }).everyMinutes, 15);
  assert.equal(validateBlindConfig({ mode: 'hands', factor: 2 }).factor, 2);
  for (const f of FACTORS) {
    assert.equal(validateBlindConfig({ mode: 'time', factor: f }).factor, f);
  }
  for (const m of MODES) {
    assert.equal(validateBlindConfig({ mode: m }).mode, m);
  }
});

test('validate 拒绝非法模式、倍率、手数、分钟数（中文报错）', () => {
  assert.throws(() => validateBlindConfig({ mode: 'both' }), /升盲模式无效/);
  assert.throws(() => validateBlindConfig({ mode: 'off', factor: 1.3 }), /升盲倍率/);
  assert.throws(() => validateBlindConfig({ mode: 'hands', everyHands: 0 }), /升盲手数/);
  assert.throws(() => validateBlindConfig({ mode: 'hands', everyHands: 51 }), /升盲手数/);
  assert.throws(() => validateBlindConfig({ mode: 'hands', everyHands: 2.5 }), /升盲手数/);
  assert.throws(() => validateBlindConfig({ mode: 'time', everyMinutes: 0 }), /升盲时间/);
  assert.throws(() => validateBlindConfig({ mode: 'time', everyMinutes: 121 }), /升盲时间/);
  // 非当前模式的参数不参与校验
  assert.equal(validateBlindConfig({ mode: 'time', everyHands: 0 }).everyMinutes, 10);
  assert.equal(validateBlindConfig({ mode: 'off', everyHands: 0, everyMinutes: 0 }).mode, 'off');
});
