'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const { publicState } = require('../server/view');

function setup(opts = {}) {
  const hub = { broadcast() {}, event() {} };
  const room = new Room('SPEC', hub, { dealDelay: 0 });
  const a = room.addPlayer('甲');
  const b = room.addPlayer('乙');
  room.setReady(b.id, true);
  if (opts.spectatorCards != null) room.updateConfig(a.id, { spectatorCards: opts.spectatorCards });
  return { room, a, b };
}

test('等待区加入的是玩家，有座位和筹码', (t) => {
  const { room, b } = setup();
  t.after(() => room.destroy());
  assert.equal(b.role, 'player');
  assert.equal(typeof b.seat, 'number');
  assert.equal(b.chips, room.config.startingChips);
  const state = publicState(room, b.id);
  assert.equal(state.you.role, 'player');
  assert.equal(state.you.seat, b.seat);
});

test('牌局中加入即观战：不占座、不能行动、默认看不到底牌', (t) => {
  const { room, a } = setup();
  t.after(() => room.destroy());
  room.start(a.id);
  assert.ok(room.phase === 'playing' || room.phase === 'handover');

  const watcher = room.addPlayer('观众');
  assert.equal(watcher.role, 'spectator');
  assert.equal(watcher.seat, null);
  assert.equal(watcher.chips, 0);

  const state = publicState(room, watcher.id);
  assert.equal(state.you.role, 'spectator');
  assert.equal(state.you.legal, null);
  assert.equal(state.players.filter((p) => !p.empty).every((p) => p.cards === null), true);
  assert.equal(state.spectators.length, 1);
  assert.equal(state.spectators[0].name, '观众');

  assert.throws(() => room.act(watcher.id, 'fold'), /观战中不能行动/);
  assert.throws(() => room.setReady(watcher.id, true), /观战中不能准备/);
});

test('开关打开后观战者能看到所有人的底牌', (t) => {
  const { room, a } = setup({ spectatorCards: true });
  t.after(() => room.destroy());
  room.start(a.id);
  const watcher = room.addPlayer('观众');
  const state = publicState(room, watcher.id);
  assert.equal(state.spectatorCards, true);
  const occupied = state.players.filter((p) => !p.empty);
  assert.ok(occupied.length >= 2);
  for (const p of occupied) {
    assert.equal(Array.isArray(p.cards), true);
    assert.equal(p.cards.length, 2);
  }
  // 观战者自己的你视角没有底牌
  assert.equal(state.you.cards, null);
});

test('开关可以在等待区由房主修改，非房主不行', (t) => {
  const { room, a, b } = setup();
  t.after(() => room.destroy());
  assert.throws(() => room.updateConfig(b.id, { spectatorCards: true }), /只有房主/);
  room.updateConfig(a.id, { spectatorCards: true });
  assert.equal(room.config.spectatorCards, true);
  room.start(a.id);
  assert.throws(() => room.updateConfig(a.id, { spectatorCards: false }), /牌局进行中/);
});

test('出局者转观战，牌局结束回等待区时恢复玩家并重置筹码', (t) => {
  const { room, a, b } = setup();
  t.after(() => room.destroy());
  room.start(a.id);
  assert.ok(room.hand);

  // 让甲输光、乙赢下本手
  const hpA = room.hand.players.find((p) => p.id === a.id);
  const hpB = room.hand.players.find((p) => p.id === b.id);
  hpA.chips = 0;
  hpB.chips = 4000;
  room._onHandEnd({
    reason: 'fold',
    board: [],
    reveals: [],
    pots: [],
    winnings: {},
    refunds: {},
    net: {},
  });

  assert.equal(room.phase, 'waiting');
  assert.equal(room.gameOver, true);
  assert.equal(a.role, 'player');
  assert.equal(typeof a.seat, 'number');
  assert.equal(a.chips, room.config.startingChips);
  assert.equal(room.spectatorPlayers().length, 0);
  const state = publicState(room, a.id);
  assert.equal(state.you.role, 'player');
});
