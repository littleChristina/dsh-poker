'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Hand } = require('../server/game/hand');

const V = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, T: 8, J: 9, Q: 10, K: 11, A: 12 };
const S = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };
const card = (t) => S[t[1]] * 13 + V[t[0]];
const parse = (s) => s.split(' ').map(card);
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// 发牌顺序：每人第一张（按座位）→ 每人第二张 → 翻牌 3 张 → 转牌 → 河牌
function makeHand(players, buttonSeat, dealSeq, opts = {}) {
  let resolveEnd;
  const ended = new Promise((r) => (resolveEnd = r));
  const hand = new Hand({
    players,
    buttonSeat,
    smallBlind: opts.smallBlind || 10,
    bigBlind: opts.bigBlind || 20,
    handNo: 1,
    dealDelay: 0,
    actionTimeout: 30,
    deck: dealSeq.slice().reverse(),
    onEnd: (r) => resolveEnd(r),
  });
  hand.start();
  return { hand, ended };
}

test('单挑：按钮位是小盲，翻前小盲先说话，翻后大盲先说话', async () => {
  const { hand, ended } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 1000 },
      { id: 'b', seat: 4, name: 'B', chips: 1000 },
    ],
    4,
    parse('A♠ K♦ A♥ Q♦ 2♣ 7♦ 9♥ J♣ 4♠')
  );

  assert.equal(hand.smallBlindSeat, 4);
  assert.equal(hand.bigBlindSeat, 0);
  assert.equal(hand.actor.id, 'b');
  assert.equal(hand.currentBet, 20);
  assert.equal(hand.legalFor('b').call, 10);

  hand.act('b', 'call');
  assert.equal(hand.legalFor('a').check, true);
  hand.act('a', 'check');

  await tick(15);
  assert.equal(hand.street, 'flop');
  assert.equal(hand.board.length, 3);
  assert.equal(hand.actor.id, 'a', '翻后由大盲先行动');

  hand.act('a', 'check');
  hand.act('b', 'check');
  await tick(15);
  assert.equal(hand.street, 'turn');
  hand.act('a', 'check');
  hand.act('b', 'check');
  await tick(15);
  assert.equal(hand.street, 'river');
  hand.act('a', 'check');
  hand.act('b', 'check');

  const result = await ended;
  assert.equal(result.reason, 'showdown');
  assert.equal(result.winnings.a, 40);
  assert.equal(result.net.a, 20);
  assert.equal(result.net.b, -20);
});

test('公共牌皇家同花顺：两人平分底池', async () => {
  const { hand, ended } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 1000 },
      { id: 'b', seat: 4, name: 'B', chips: 1000 },
    ],
    4,
    parse('2♥ 4♣ 3♥ 5♣ A♠ K♠ Q♠ J♠ T♠')
  );

  hand.act('b', 'call');
  hand.act('a', 'check');
  await tick(15);
  hand.act('a', 'check');
  hand.act('b', 'check');
  await tick(15);
  hand.act('a', 'check');
  hand.act('b', 'check');
  await tick(15);
  hand.act('a', 'check');
  hand.act('b', 'check');

  const result = await ended;
  assert.equal(result.pots.length, 1);
  assert.equal(result.pots[0].amount, 40);
  assert.deepEqual(result.pots[0].winnerIds.sort(), ['a', 'b']);
  assert.equal(result.pots[0].handName, '皇家同花顺');
  assert.equal(result.winnings.a, 20);
  assert.equal(result.winnings.b, 20);
});

test('平局：奇数底池平分，零头给按钮下家且不丢筹码', async () => {
  const { hand, ended } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 101 },
      { id: 'b', seat: 1, name: 'B', chips: 1000 },
      { id: 'c', seat: 2, name: 'C', chips: 1000 },
    ],
    0,
    parse('2♥ 3♦ 4♣ 5♥ 6♦ 7♣ T♠ J♠ Q♠ K♠ A♠'),
    { smallBlind: 5, bigBlind: 10 }
  );

  hand.act('a', 'raise', 101);
  hand.act('b', 'fold');
  hand.act('c', 'call');

  const result = await ended;
  assert.equal(result.reason, 'showdown');
  assert.equal(result.pots.length, 1);
  assert.equal(result.pots[0].amount, 207);
  assert.deepEqual(result.pots[0].winnerIds.slice().sort(), ['a', 'c']);

  // 207 = 103 + 104，零头给按钮下家 c（按钮后顺序 b → c → a）
  assert.equal(result.winnings.c, 104);
  assert.equal(result.winnings.a, 103);
  assert.equal(hand.players.reduce((s, p) => s + p.chips, 0), 2101);
});

test('平局：主池三人平分、边池两人平分', async () => {
  const { hand, ended } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 100 },
      { id: 'b', seat: 1, name: 'B', chips: 300 },
      { id: 'c', seat: 2, name: 'C', chips: 300 },
    ],
    0,
    parse('2♥ 3♦ 4♣ 5♥ 6♦ 7♣ T♠ J♠ Q♠ K♠ A♠')
  );

  hand.act('a', 'raise', 100);
  hand.act('b', 'raise', 300);
  hand.act('c', 'call');

  const result = await ended;
  assert.equal(result.reason, 'showdown');
  assert.equal(result.pots.length, 2);
  assert.equal(result.pots[0].amount, 300);
  assert.equal(result.pots[1].amount, 400);
  assert.deepEqual(result.pots[0].winnerIds.slice().sort(), ['a', 'b', 'c']);
  assert.deepEqual(result.pots[1].winnerIds.slice().sort(), ['b', 'c']);
  assert.equal(result.winnings.a, 100);
  assert.equal(result.winnings.b, 300);
  assert.equal(result.winnings.c, 300);
  assert.equal(hand.players.reduce((s, p) => s + p.chips, 0), 700);
});

test('加注校验：最小加注额、过牌、轮次', async () => {
  const { hand } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 1000 },
      { id: 'b', seat: 4, name: 'B', chips: 1000 },
    ],
    0,
    parse('A♠ K♦ A♥ Q♦ 2♣ 7♦ 9♥ J♣ 4♠')
  );

  assert.equal(hand.actor.id, 'a');
  assert.throws(() => hand.act('b', 'fold'), /还没轮到你行动/);
  assert.throws(() => hand.act('a', 'check'), /不能过牌/);
  assert.throws(() => hand.act('a', 'raise', 30), /至少加注到 40/);
  assert.throws(() => hand.act('a', 'raise', 5000), /筹码不足/);

  hand.act('a', 'raise', 40);
  assert.equal(hand.currentBet, 40);
  assert.equal(hand.legalFor('b').raise.min, 60);
  assert.throws(() => hand.act('b', 'raise', 55), /至少加注到 60/);

  hand.act('b', 'call');
  await tick(15);
  assert.equal(hand.street, 'flop');
  assert.equal(hand.currentBet, 0);
  hand.destroy();
});

test('短筹码全下：只允许全下金额，其余玩家可跟注', async () => {
  const { hand, ended } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 30 },
      { id: 'b', seat: 4, name: 'B', chips: 1000 },
    ],
    0,
    parse('A♠ K♦ A♥ Q♦ 2♣ 7♦ 9♥ J♣ 4♠')
  );

  const legal = hand.legalFor('a');
  assert.equal(legal.raise.allInOnly, true);
  assert.equal(legal.raise.min, 30);
  assert.equal(legal.raise.max, 30);

  hand.act('a', 'raise', 30);
  assert.equal(hand.players.find((p) => p.id === 'a').allIn, true);
  assert.equal(hand.legalFor('b').call, 10);
  hand.act('b', 'call');

  const result = await ended;
  assert.equal(result.reason, 'showdown');
  assert.equal(hand.board.length, 5);
});

test('三人不同筹码：主池与边池分别结算', async () => {
  const { hand, ended } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 100 },
      { id: 'b', seat: 1, name: 'B', chips: 200 },
      { id: 'c', seat: 2, name: 'C', chips: 300 },
    ],
    0,
    parse('A♠ K♠ Q♠ A♥ K♥ Q♥ 2♣ 5♦ 9♠ J♣ 3♦')
  );

  assert.equal(hand.actor.id, 'a');
  hand.act('a', 'raise', 100);
  hand.act('b', 'call');
  hand.act('c', 'call');

  await tick(15);
  assert.equal(hand.street, 'flop');
  assert.equal(hand.actor.id, 'b');
  hand.act('b', 'raise', 100);
  assert.equal(hand.legalFor('c').call, 100);
  hand.act('c', 'call');

  const result = await ended;
  assert.equal(result.reason, 'showdown');
  assert.deepEqual(result.refunds, {});
  assert.equal(result.pots.length, 2);
  assert.equal(result.pots[0].amount, 300);
  assert.deepEqual(result.pots[0].winnerIds, ['a']);
  assert.equal(result.pots[1].amount, 200);
  assert.deepEqual(result.pots[1].winnerIds, ['b']);

  const total = hand.players.reduce((s, p) => s + p.chips, 0);
  assert.equal(total, 600);
});

test('单挑全下：没被跟注的部分退回', async () => {
  const { hand, ended } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 500 },
      { id: 'b', seat: 4, name: 'B', chips: 200 },
    ],
    0,
    parse('A♠ K♠ A♥ K♥ 2♣ 7♦ 9♥ J♣ 4♠')
  );

  hand.act('a', 'raise', 500);
  hand.act('b', 'call');
  const result = await ended;

  assert.equal(result.refunds.a, 300);
  assert.equal(result.winnings.a, 700);
  assert.equal(hand.players.reduce((s, p) => s + p.chips, 0), 700);
});

test('对手弃牌直接结束本手', async () => {
  const { hand, ended } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 500 },
      { id: 'b', seat: 4, name: 'B', chips: 500 },
    ],
    0,
    parse('A♠ K♦ A♥ Q♦ 2♣ 7♦ 9♥ J♣ 4♠')
  );

  hand.act('a', 'raise', 200);
  hand.act('b', 'fold');
  const result = await ended;

  assert.equal(result.reason, 'fold');
  assert.equal(result.winnings.a, 220);
  assert.equal(result.net.a, 20);
  assert.equal(hand.players.reduce((s, p) => s + p.chips, 0), 1000);
});

test('断线加速：超时自动过牌/弃牌', async () => {
  const { hand } = makeHand(
    [
      { id: 'a', seat: 0, name: 'A', chips: 500 },
      { id: 'b', seat: 4, name: 'B', chips: 500 },
    ],
    0,
    parse('A♠ K♦ A♥ Q♦ 2♣ 7♦ 9♥ J♣ 4♠')
  );

  assert.equal(hand.actor.id, 'a');
  hand.hurry(300);
  await tick(450);
  assert.equal(hand.done, true);
  assert.equal(hand.result.reason, 'fold');
});

test('随机合法行动能把整手牌打完，且筹码守恒', async () => {
  const players = [
    { id: 'a', seat: 0, name: 'A', chips: 1000 },
    { id: 'b', seat: 1, name: 'B', chips: 500 },
    { id: 'c', seat: 2, name: 'C', chips: 300 },
    { id: 'd', seat: 5, name: 'D', chips: 2000 },
  ];
  const hand = new Hand({
    players,
    buttonSeat: 2,
    smallBlind: 10,
    bigBlind: 20,
    handNo: 1,
    dealDelay: 0,
    actionTimeout: 30,
  });
  hand.start();

  for (let i = 0; i < 3000 && !hand.done; i++) {
    if (hand.actor) {
      const legal = hand.legalFor(hand.actor.id);
      const r = Math.random();
      if (r < 0.15) hand.act(hand.actor.id, 'fold');
      else if (legal.check) hand.act(hand.actor.id, 'check');
      else if (r < 0.6 || !legal.raise) hand.act(hand.actor.id, 'call');
      else hand.act(hand.actor.id, 'raise', legal.raise.min);
    } else {
      await tick(3);
    }
  }

  assert.equal(hand.done, true, '随机行动应在步数内结束');
  assert.equal(
    hand.players.reduce((s, p) => s + p.chips, 0),
    3800,
    '结束时总筹码应等于开局总筹码'
  );
  const netSum = Object.values(hand.result.net).reduce((s, v) => s + v, 0);
  assert.equal(netSum, 0);
});
