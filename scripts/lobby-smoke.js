'use strict';

// 大厅 API 冒烟：创建 / 加入 / 准备 / 设置 / 开始
// 用法：先启动服务，再运行 node scripts/lobby-smoke.js
const BASE = process.env.BASE || 'http://localhost:3000';

let failed = 0;

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

async function get(path) {
  const res = await fetch(BASE + path);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

(async () => {
  console.log('创建 / 加入');
  const host = await post('/api/create', { name: '房主甲' });
  ok(host.status === 200 && host.data.code, '创建房间');
  const code = host.data.code;
  const ta = host.data.token;

  const guest = await post('/api/join', { code, name: '朋友乙' });
  ok(guest.status === 200, '朋友加入房间');
  const tb = guest.data.token;

  console.log('开始游戏前的校验');
  let r = await post('/api/start', { token: ta });
  ok(r.status === 400 && /还没有准备/.test(r.data.error || ''), '没准备时房主不能开始');

  r = await post('/api/ready', { token: tb, ready: true });
  ok(r.status === 200, '朋友准备');

  let s = await get(`/api/state?token=${ta}`);
  ok(s.data.state.players.filter((p) => !p.empty).length === 2, '两人在座');
  ok(s.data.state.players.some((p) => p.isYou && p.isHost), '房主标记正确');

  console.log('设置');
  r = await post('/api/config', { token: ta, config: { smallBlind: 5, bigBlind: 10, startingChips: 1000, actionTimeout: 20 } });
  ok(r.status === 200, '房主修改设置');
  r = await post('/api/config', { token: ta, config: { smallBlind: 100, bigBlind: 50 } });
  ok(r.status === 400 && /大盲必须大于小盲/.test(r.data.error || ''), '非法设置被拒绝');
  r = await post('/api/config', { token: tb, config: { smallBlind: 5 } });
  ok(r.status === 400 && /只有房主/.test(r.data.error || ''), '非房主不能改设置');

  s = await get(`/api/state?token=${ta}`);
  ok(s.data.state.config.bigBlind === 10, '设置已生效');
  ok(s.data.state.players.every((p) => p.empty || p.chips === 1000), '等待区筹码同步为新初始值');

  console.log('开始游戏');
  r = await post('/api/start', { token: ta });
  ok(r.status === 200, '房主开始游戏');
  s = await get(`/api/state?token=${ta}`);
  const st = s.data.state;
  ok(st.phase === 'playing' || st.phase === 'handover', '进入牌局');
  ok(st.board.length >= 0 && st.pot >= 15, '盲注进入底池');
  ok(st.players.filter((p) => !p.empty && p.cards).length >= 1, '至少一名玩家看到自己的底牌');
  ok(st.players.filter((p) => !p.empty).every((p) => p.cards === null || p.isYou), '别人看不到我的底牌');

  console.log('清理');
  await post('/api/leave', { token: tb });
  await post('/api/leave', { token: ta });

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('冒烟脚本异常：', err.message);
  process.exit(1);
});
