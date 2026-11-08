'use strict';

// 牌桌 / 行动条冒烟：两个 AI 玩家自动打牌，检查结算数据、底牌可见性、自动下一手与升盲
// 用法：先启动服务，再运行 node scripts/table-smoke.js
const BASE = process.env.BASE || 'http://localhost:3000';

let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(cond, msg) {
  if (cond) console.log('  ok  ', msg);
  else {
    failed += 1;
    console.error('  FAIL', msg);
  }
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function stateOf(token) {
  const res = await fetch(`${BASE}/api/state?token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  return (await res.json()).state;
}

async function waitForTurn(tokens, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const token of tokens) {
      const state = await stateOf(token);
      if (!state) continue;
      if (state.phase !== 'playing') return { state, token, done: true };
      if (state.you && state.you.legal) return { state, token, done: false };
    }
    await sleep(150);
  }
  throw new Error('等待行动超时');
}

async function playHand(tokens, { raiseChance = 0.15 } = {}) {
  let turn = await waitForTurn(tokens);
  let steps = 0;

  while (!turn.done && steps < 120) {
    steps += 1;
    const { state, token } = turn;
    const legal = state.you.legal;
    let action;
    let amount;

    if (legal.raise && Math.random() < raiseChance) {
      action = 'raise';
      amount = legal.raise.allInOnly ? legal.raise.max : legal.raise.min;
    } else if (legal.check) {
      action = 'check';
    } else if (legal.call > 0) {
      action = 'call';
    } else {
      action = 'fold';
    }

    const res = await post('/api/action', { token, action, amount });
    if (res.status !== 200) throw new Error(`动作失败：${res.data.error || res.status}`);

    turn = await waitForTurn(tokens);
  }

  if (turn.done) return turn.state;
  throw new Error('动作轮次过多');
}

function chipsSum(state) {
  return state.players.filter((p) => !p.empty).reduce((sum, p) => sum + p.chips, 0);
}

(async () => {
  console.log('创建房间');
  const host = await post('/api/create', { name: '甲' });
  const code = host.data.code;
  const ta = host.data.token;
  const guest = await post('/api/join', { code, name: '乙' });
  const tb = guest.data.token;
  ok(host.status === 200 && guest.status === 200, '两人就座');

  await post('/api/ready', { token: tb, ready: true });
  const start = await post('/api/start', { token: ta });
  ok(start.status === 200, '开始牌局');

  const tokens = [ta, tb];
  const state = await playHand(tokens);

  console.log('一手牌打完');
  ok(state.phase === 'handover', '进入本手结算');
  ok(!!state.result, '带有 result');
  ok(Object.keys(state.result.winnings || {}).length > 0, '有赢家');
  ok(state.result.board.length === 5, '河牌发出 5 张公共牌');
  ok(Array.isArray(state.result.reveals) && state.result.reveals.length >= 1, '摊牌有亮牌记录');
  ok(state.result.reveals.every((r) => r.cards && r.cards.length === 2 && r.handName), '亮牌带牌型名');
  ok(
    state.result.reveals.every((r) => Array.isArray(r.bestCards) && r.bestCards.length === 5),
    '每位亮牌者都有获胜的 5 张牌'
  );
  ok(
    state.result.reveals.every((r) => r.bestCards.every((c) => r.cards.includes(c) || state.result.board.includes(c))),
    '获胜 5 张牌来自底牌或公共牌'
  );
  ok(
    state.nextHandIn != null && state.nextHandIn >= 8000,
    `结算展示时长约 9 秒（剩 ${Math.round(state.nextHandIn / 1000)} 秒）`
  );

  const me = state.you;
  ok(me.cards === null || me.cards.length === 2, '自己的底牌可见');
  const revealed = state.players.filter((p) => !p.empty && p.cards);
  ok(revealed.length >= 2, '摊牌后至少两人亮牌');

  const total = chipsSum(state);
  ok(total === 4000, `筹码守恒（${total} / 4000）`);

  console.log('再来一手：弃牌结束');
  // 等下一手自动开始
  let next = null;
  const waitStart = Date.now();
  while (Date.now() - waitStart < 15000) {
    const s = await stateOf(ta);
    if (s && s.phase === 'playing' && s.handNo === state.handNo + 1) {
      next = s;
      break;
    }
    await sleep(200);
  }
  ok(!!next, '下一手自动开始');

  if (next) {
    const turn = await waitForTurn(tokens);
    const legal = turn.state.you.legal;
    // 当前行动者直接弃牌，另一人赢得底池
    await post('/api/action', { token: turn.token, action: 'fold' });
    const ended = await playHand(tokens);
    ok(ended.phase === 'handover' && ended.result.reason === 'fold', '弃牌结束，result.reason = fold');
    ok(chipsSum(ended) === 4000, `弃牌后筹码守恒（${chipsSum(ended)} / 4000）`);
  }

  console.log('升盲冒烟：按手数升盲');
  const host2 = await post('/api/create', { name: '升盲甲' });
  const guest2 = await post('/api/join', { code: host2.data.code, name: '升盲乙' });
  const t2 = [host2.data.token, guest2.data.token];

  await post('/api/ready', { token: guest2.data.token, ready: true });
  const cfgRes = await post('/api/config', {
    token: host2.data.token,
    config: { blindUpMode: 'hands', blindUpEveryHands: 1, blindFactor: 1.5 },
  });
  ok(cfgRes.status === 200, '设置「每手升盲」，倍率 1.5');
  await post('/api/start', { token: host2.data.token });

  const s0 = await stateOf(host2.data.token);
  ok(s0.blinds.level === 1 && s0.blinds.smallBlind === 10, '第 1 手盲注 10 / 20');
  ok(s0.nextBlinds.smallBlind === 15 && s0.nextBlinds.bigBlind === 30, '预告下一手 15 / 30');
  ok(s0.blindUp.mode === 'hands' && s0.blindUp.handsUntilUpgrade === 1, '升盲进度：再 1 手升级');

  const done1 = await playHand(t2);
  ok(done1.phase === 'handover', '升盲房第 1 手结束');

  let second = null;
  const secondStart = Date.now();
  while (Date.now() - secondStart < 15000) {
    const s = await stateOf(host2.data.token);
    if (s && s.phase === 'playing' && s.handNo === done1.handNo + 1) {
      second = s;
      break;
    }
    await sleep(200);
  }
  ok(!!second, '第 2 手自动开始');

  if (second) {
    ok(second.blinds.level === 2 && second.blinds.smallBlind === 15, '第 2 手盲注升到 15 / 30');
    const sb = second.players.find((p) => p.isSmallBlind);
    ok(!!sb && sb.bet === 15, `小盲实际下了 15（实际 ${sb ? sb.bet : '—'}）`);
  }

  // 收尾：当前行动者弃牌结束这手，然后离开
  const turn2 = await waitForTurn(t2);
  await post('/api/action', { token: turn2.token, action: 'fold' });
  await playHand(t2);
  await post('/api/leave', { token: guest2.data.token });
  await post('/api/leave', { token: host2.data.token });

  console.log('清理');
  await post('/api/leave', { token: tb });
  await post('/api/leave', { token: ta });

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('冒烟脚本异常：', err.message);
  process.exit(1);
});
