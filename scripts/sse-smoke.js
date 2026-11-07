'use strict';

// 手动冒烟测试：需要先启动服务（node server/index.js）
const base = process.env.BASE || 'http://localhost:3000';

async function main() {
  const r = await fetch(base + '/api/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'SSE测试' }),
  });
  const j = await r.json();
  const es = await fetch(base + '/api/events?token=' + j.token);
  console.log('SSE 状态', es.status, es.headers.get('content-type'));
  const rd = es.body.getReader();
  const { value } = await rd.read();
  const text = new TextDecoder().decode(value);
  console.log('首包包含 state:', text.includes('"state"'), '长度', text.length);
  const payload = JSON.parse(text.split('data: ')[1]);
  console.log('房间码', payload.state.code, '座位', payload.state.you.seat);

  // 测试错误路径
  const bad = await fetch(base + '/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'ZZZZ', name: 'x' }),
  });
  console.log('错误房间码 →', bad.status, (await bad.json()).error);

  // 测试断线/重连
  await rd.cancel();
  await new Promise((r) => setTimeout(r, 300));
  const s1 = await (await fetch(base + '/api/state?token=' + j.token)).json();
  console.log('断开后 connected =', s1.state.you.connected);
  const es2 = await fetch(base + '/api/events?token=' + j.token);
  const rd2 = es2.body.getReader();
  const pkt = JSON.parse(new TextDecoder().decode((await rd2.read()).value).split('data: ')[1]);
  console.log('重连后 connected =', pkt.state.you.connected, '状态码', es2.status);
  await rd2.cancel();

  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
