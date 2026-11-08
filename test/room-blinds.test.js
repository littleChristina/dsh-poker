'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const { publicState } = require('../server/view');

function setup(opts = {}) {
  const now = { t: opts.t != null ? opts.t : 1000000 };
  const hub = { broadcast() {}, event() {} };
  const room = new Room('TEST', hub, { now: () => now.t, dealDelay: 0 });
  const a = room.addPlayer('甲');
  const b = room.addPlayer('乙');
  room.setReady(b.id, true);
  if (opts.config) room.updateConfig(a.id, opts.config);
  return { room, a, b, now };
}

test('默认关闭升盲：永远是 10/20', (t) => {
  const { room, now } = setup();
  t.after(() => room.destroy());
  assert.equal(room.blindLevel, 1);
  assert.deepEqual(room._levelBlinds(1), { smallBlind: 10, bigBlind: 20 });
  assert.deepEqual(room._levelBlinds(2), { smallBlind: 15, bigBlind: 30 });
  now.t += 100 * 60 * 1000;
  room.completedHands = 5;
  room._refreshBlinds();
  assert.equal(room.blindLevel, 1);
  assert.deepEqual(room.currentBlinds, { smallBlind: 10, bigBlind: 20 });
});

test('hands 模式：每 2 手升一级，第 3 手用新盲注', (t) => {
  const { room } = setup({ config: { blindUpMode: 'hands', blindUpEveryHands: 2, blindFactor: 2 } });
  t.after(() => room.destroy());
  room.buttonSeat = room.players[0].seat;
  room._startHand(true);
  assert.equal(room.hand.smallBlind, 10);
  assert.equal(room.hand.bigBlind, 20);

  room.completedHands = 1;
  room._refreshBlinds();
  assert.equal(room.blindLevel, 1);
  assert.deepEqual(room.currentBlinds, { smallBlind: 10, bigBlind: 20 });

  room.completedHands = 2;
  room._refreshBlinds();
  assert.equal(room.blindLevel, 2);
  assert.deepEqual(room.currentBlinds, { smallBlind: 20, bigBlind: 40 });
  assert.ok(room.log.some((l) => l.includes('盲注升级：20 / 40（第 2 级）')));

  // 下一手确实使用新盲注
  room._startHand(false);
  assert.equal(room.hand.smallBlind, 20);
  assert.equal(room.hand.bigBlind, 40);
});

test('time 模式：每 10 分钟升一级，跨越多个间隔会连升', (t) => {
  const { room, now } = setup({ config: { blindUpMode: 'time', blindUpEveryMinutes: 10 } });
  t.after(() => room.destroy());
  const start = now.t;
  room.gameStartedAt = start;

  now.t = start + 9 * 60 * 1000 + 59 * 1000;
  room._refreshBlinds();
  assert.equal(room.blindLevel, 1);

  now.t = start + 10 * 60 * 1000;
  room._refreshBlinds();
  assert.equal(room.blindLevel, 2);
  assert.deepEqual(room.currentBlinds, { smallBlind: 15, bigBlind: 30 });

  now.t = start + 31 * 60 * 1000;
  room._refreshBlinds();
  assert.equal(room.blindLevel, 4);
  assert.deepEqual(room.currentBlinds, { smallBlind: 40, bigBlind: 80 });
  assert.ok(room.log.some((l) => l.includes('连升 2 级')));
});

test('start() 会重置升盲状态并记录开局时间', (t) => {
  const { room, a } = setup({ config: { blindUpMode: 'hands', blindUpEveryHands: 3 } });
  t.after(() => room.destroy());
  room.start(a.id);
  assert.equal(room.completedHands, 0);
  assert.equal(room.blindLevel, 1);
  assert.deepEqual(room.currentBlinds, { smallBlind: 10, bigBlind: 20 });
  assert.equal(room.gameStartedAt, 1000000);
  assert.ok(room.log.some((l) => l.includes('升盲模式：每 3 手升一级')));
});

test('每手结束会累加已完成手数', (t) => {
  const { room } = setup({ config: { blindUpMode: 'hands', blindUpEveryHands: 2 } });
  t.after(() => room.destroy());
  room.phase = 'playing';
  room.hand = {
    players: room.players.map((p) => ({ id: p.id, chips: p.chips })),
    destroy() {},
  };
  room._onHandEnd({ reason: 'fold', board: [], reveals: [], pots: [], winnings: {}, refunds: {}, net: {} });
  assert.equal(room.completedHands, 1);
  assert.equal(room.phase, 'handover');
});

test('状态快照：当前盲注、下一手盲注、升级进度', (t) => {
  const { room, a } = setup({ config: { blindUpMode: 'hands', blindUpEveryHands: 2 } });
  t.after(() => room.destroy());
  room.completedHands = 1;
  room._refreshBlinds();
  const v = publicState(room, a.id);
  assert.equal(v.blindUp.mode, 'hands');
  assert.equal(v.blindUp.handsUntilUpgrade, 1);
  assert.equal(v.blindUp.levelEndsAt, null);
  assert.deepEqual(v.blinds, { level: 1, smallBlind: 10, bigBlind: 20 });
  assert.deepEqual(v.nextBlinds, { level: 2, smallBlind: 15, bigBlind: 30 });
});

test('状态快照 time 模式：给出本级结束时刻', (t) => {
  const { room, a, now } = setup({ config: { blindUpMode: 'time', blindUpEveryMinutes: 10 } });
  t.after(() => room.destroy());
  const start = now.t;
  room.gameStartedAt = start;
  now.t = start + 10 * 60 * 1000;
  room._refreshBlinds();
  const v = publicState(room, a.id);
  assert.equal(v.blindUp.mode, 'time');
  assert.equal(v.blindUp.handsUntilUpgrade, null);
  assert.equal(v.blindUp.levelEndsAt, start + 2 * 10 * 60 * 1000);
  assert.equal(v.blinds.level, 2);
  assert.deepEqual(v.nextBlinds, { level: 3, smallBlind: 25, bigBlind: 50 });
});

test('配置校验：非法模式/倍率/手数/分钟，以及非房主、进行中不可改', (t) => {
  const { room, a, b } = setup();
  t.after(() => room.destroy());
  assert.throws(() => room.updateConfig(b.id, { blindUpMode: 'time' }), /只有房主可以修改设置/);
  assert.throws(() => room.updateConfig(a.id, { blindUpMode: 'both' }), /升盲模式无效/);
  assert.throws(() => room.updateConfig(a.id, { blindFactor: 1.3 }), /升盲倍率/);
  assert.throws(
    () => room.updateConfig(a.id, { blindUpMode: 'hands', blindUpEveryHands: 0 }),
    /升盲手数/
  );
  assert.throws(
    () => room.updateConfig(a.id, { blindUpMode: 'time', blindUpEveryMinutes: 121 }),
    /升盲时间/
  );
  room.updateConfig(a.id, { blindUpMode: 'time', blindUpEveryMinutes: 15, blindFactor: 2 });
  assert.equal(room.config.blindUpMode, 'time');
  assert.equal(room.config.blindUpEveryMinutes, 15);
  assert.equal(room.config.blindFactor, 2);

  room.phase = 'playing';
  assert.throws(() => room.updateConfig(a.id, { blindUpMode: 'off' }), /牌局进行中不能修改设置/);
});

test('关闭升盲时修改其他配置不影响盲注字段', (t) => {
  const { room, a } = setup();
  t.after(() => room.destroy());
  room.updateConfig(a.id, { smallBlind: 20, bigBlind: 40 });
  assert.equal(room.config.blindUpMode, 'off');
  assert.equal(room.config.blindUpEveryHands, 10);
  assert.equal(room.config.blindUpEveryMinutes, 10);
  assert.equal(room.config.blindFactor, 1.5);
  assert.deepEqual(room._levelBlinds(1), { smallBlind: 20, bigBlind: 40 });
});
