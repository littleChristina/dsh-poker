'use strict';

// 观战功能冒烟测试：需要先启动服务（node server/index.js）。
// 运行：node scripts/spectator-smoke.js

const BASE = 'http://127.0.0.1:3000';
let failed = 0;

function check(name, ok, extra) {
  if (ok) {
    console.log('  ok -', name);
  } else {
    failed += 1;
    console.log('  FAIL -', name, extra === undefined ? '' : JSON.stringify(extra));
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
  return { status: res.status, text: await res.text() };
}

async function stateOf(token) {
  const res = await fetch(BASE + '/api/state?token=' + encodeURIComponent(token));
  const data = await res.json();
  return data.state;
}

(async () => {
  console.log('默认：观战者看不到底牌');
  {
    const host = (await post('/api/create', { name: '房主甲' })).data;
    const guest = (await post('/api/join', { code: host.code, name: '玩家乙' })).data;
    await post('/api/ready', { token: guest.token, ready: true });
    await post('/api/start', { token: host.token });

    const hostState = await stateOf(host.token);
    check('开局后进入 playing', hostState.phase === 'playing', hostState.phase);
    check('房主能看到自己的两张底牌', Array.isArray(hostState.you.cards) && hostState.you.cards.length === 2);
    check('房主看不到对手底牌', hostState.players.every((p) => p.empty || p.isYou || p.cards === null));

    const won = await post('/api/join', { code: host.code, name: '观众丙' });
    check('观战者加入成功', won.status === 200, won);
    const wState = await stateOf(won.data.token);
    check('观战者 role=spectator', wState.you.role === 'spectator', wState.you.role);
    check('观战者无合法操作', wState.you.legal === null);
    check('观战者默认看不到底牌', wState.players.every((p) => p.empty || p.cards === null));
    check('观战列表包含观众', wState.spectators.some((s) => s.name === '观众丙'));

    const act = await post('/api/action', { token: won.data.token, action: 'fold' });
    check('观战者不能行动', act.status === 400 && /观战中不能行动/.test(act.data.error || ''), act.data);

    const ready = await post('/api/ready', { token: won.data.token, ready: true });
    check('观战者不能准备', ready.status === 400 && /观战中不能准备/.test(ready.data.error || ''), ready.data);
  }

  console.log('开关打开：观战者能看到所有人的底牌');
  {
    const host = (await post('/api/create', { name: '房主丁', spectatorCards: true })).data;
    const guest = (await post('/api/join', { code: host.code, name: '玩家戊' })).data;
    await post('/api/ready', { token: guest.token, ready: true });
    await post('/api/start', { token: host.token });
    const won = (await post('/api/join', { code: host.code, name: '观众己' })).data;
    const wState = await stateOf(won.token);
    check('观战者能看到 spectatorCards=true', wState.spectatorCards === true);
    const seated = wState.players.filter((p) => !p.empty);
    check('观战者看到每个在座玩家的两张底牌', seated.length >= 2 && seated.every((p) => Array.isArray(p.cards) && p.cards.length === 2), seated.map((p) => p.cards));
    check('观战者自己没有底牌', wState.you.cards === null);

    const hostState = await stateOf(host.token);
    check('玩家本人不受开关影响', hostState.spectators.length === 1);
  }

  console.log('静态资源包含观战界面');
  {
    const html = await get('/');
    const appJs = await get('/js/app.js');
    const tableJs = await get('/js/table.js');
    check('大厅有观战开关', html.text.includes('create-spectator-cards'));
    check('牌桌有观战标签', html.text.includes('table-watch'));
    check('app.js 提交 spectatorCards', appJs.text.includes('spectatorCards'));
    check('table.js 有观战分支', tableJs.text.includes('观战中'));
  }

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('smoke 运行失败：', err);
  process.exit(1);
});
