'use strict';

// 与服务器通信的最小封装：所有接口都返回 JSON，失败时抛出带中文消息的 Error。

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (_) {
    throw new Error('连接服务器失败，请确认服务已经开启');
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // 非 JSON 响应（例如 502 页面），交给下面统一报错
  }

  if (!res.ok) {
    const msg = (data && data.error) || `请求失败（${res.status}）`;
    throw new Error(msg);
  }
  return data || {};
}

function post(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

export const api = {
  create: (name, spectatorCards = false) => post('/api/create', { name, spectatorCards }),
  join: (code, name) => post('/api/join', { code, name }),
  rejoin: (token) => post('/api/rejoin', { token }),
  ready: (token, ready) => post('/api/ready', { token, ready }),
  start: (token) => post('/api/start', { token }),
  action: (token, action, amount) => post('/api/action', { token, action, amount }),
  config: (token, config) => post('/api/config', { token, config }),
  leave: (token) => post('/api/leave', { token }),
  info: () => request('/api/info'),
};
