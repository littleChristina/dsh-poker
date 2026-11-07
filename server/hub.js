'use strict';

// SSE 连接管理：每名玩家一条 EventSource 长连接
// token -> { room, playerId, res, token }
function createHub({ serialize, onDisconnect }) {
  const clients = new Map();
  const roomClients = new Map(); // roomCode -> Set(token)

  function send(res, payload) {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (_) {
      /* 对端已断开，交给 close 处理 */
    }
  }

  function attach(room, playerId, res, token) {
    // 同一 token 重连时替换旧连接（不触发"断开"回调，否则会立刻把玩家标记为掉线）
    detach(token, null, false);
    const entry = { room, playerId, res, token };
    clients.set(token, entry);
    if (!roomClients.has(room.code)) roomClients.set(room.code, new Set());
    roomClients.get(room.code).add(token);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');

    const gone = () => {
      if (clients.get(token) === entry) detach(token, res, true);
    };
    res.on('close', gone);
    res.on('error', gone);
    if (res.socket) res.socket.on('close', gone);

    send(res, { type: 'state', state: serialize(room, playerId) });
    return entry;
  }

  function detach(token, res, notify) {
    const entry = clients.get(token);
    if (!entry) return;
    if (res && entry.res !== res) return;
    clients.delete(token);
    const set = roomClients.get(entry.room.code);
    if (set) {
      set.delete(token);
      if (!set.size) roomClients.delete(entry.room.code);
    }
    try {
      entry.res.end();
    } catch (_) {
      /* ignore */
    }
    if (notify && onDisconnect) onDisconnect(entry.room, entry.playerId);
  }

  function broadcast(room) {
    const set = roomClients.get(room.code);
    if (!set) return;
    for (const token of set) {
      const entry = clients.get(token);
      if (!entry) continue;
      send(entry.res, { type: 'state', state: serialize(room, entry.playerId) });
    }
  }

  function event(room, type, payload) {
    const set = roomClients.get(room.code);
    if (!set) return;
    for (const token of set) {
      const entry = clients.get(token);
      if (!entry) continue;
      send(entry.res, { type, ...payload });
    }
  }

  function count(room) {
    const set = roomClients.get(room.code);
    return set ? set.size : 0;
  }

  const heartbeat = setInterval(() => {
    for (const entry of clients.values()) {
      try {
        entry.res.write(': hb\n\n');
      } catch (_) {
        /* ignore */
      }
    }
  }, 15000);
  heartbeat.unref?.();

  return { attach, detach, broadcast, event, count, clients };
}

module.exports = { createHub };
