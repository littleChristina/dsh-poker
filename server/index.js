'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const logger = require('./util/logger');
const { listAddresses } = require('./net');
const { createHub } = require('./hub');
const { publicState } = require('./view');
const { RoomManager } = require('./rooms');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const hub = createHub({
  serialize: (room, playerId) => publicState(room, playerId),
  onDisconnect: (room, playerId) => room.setConnected(playerId, false),
});
const rooms = new RoomManager(hub);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 100) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        reject(new Error('请求格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function auth(token) {
  const found = rooms.findByToken(token);
  if (!found) return null;
  return found;
}

function stateOf(room, playerId) {
  return publicState(room, playerId);
}

// ---------- API ----------

const api = {
  async create(req, res) {
    const body = await readBody(req);
    const room = rooms.create();
    const player = room.addPlayer(body.name);
    logger.info(`玩家 ${player.name} 创建房间 ${room.code}`);
    sendJson(res, 200, {
      code: room.code,
      token: player.token,
      playerId: player.id,
      state: stateOf(room, player.id),
    });
  },

  async join(req, res) {
    const body = await readBody(req);
    const room = rooms.get(body.code);
    if (!room) return sendJson(res, 404, { error: '房间不存在，请检查房间码' });
    if (room.players.length >= 8) return sendJson(res, 400, { error: '房间已满' });
    if (room.findByToken(body.token)) return sendJson(res, 400, { error: '你已经在房间里了' });
    const player = room.addPlayer(body.name);
    sendJson(res, 200, {
      code: room.code,
      token: player.token,
      playerId: player.id,
      state: stateOf(room, player.id),
    });
  },

  async rejoin(req, res) {
    const body = await readBody(req);
    const found = rooms.findByToken(body.token);
    if (!found) return sendJson(res, 404, { error: '登录信息已失效，请重新加入' });
    found.player.connected = true;
    sendJson(res, 200, {
      code: found.room.code,
      token: found.player.token,
      playerId: found.player.id,
      state: stateOf(found.room, found.player.id),
    });
  },

  async ready(req, res) {
    const body = await readBody(req);
    const found = auth(body.token);
    if (!found) return sendJson(res, 401, { error: '登录已失效' });
    found.room.setReady(found.player.id, body.ready);
    sendJson(res, 200, { ok: true });
  },

  async start(req, res) {
    const body = await readBody(req);
    const found = auth(body.token);
    if (!found) return sendJson(res, 401, { error: '登录已失效' });
    found.room.start(found.player.id);
    sendJson(res, 200, { ok: true });
  },

  async action(req, res) {
    const body = await readBody(req);
    const found = auth(body.token);
    if (!found) return sendJson(res, 401, { error: '登录已失效' });
    found.room.act(found.player.id, body.action, body.amount);
    sendJson(res, 200, { ok: true });
  },

  async config(req, res) {
    const body = await readBody(req);
    const found = auth(body.token);
    if (!found) return sendJson(res, 401, { error: '登录已失效' });
    found.room.updateConfig(found.player.id, body.config || {});
    sendJson(res, 200, { ok: true });
  },

  async leave(req, res) {
    const body = await readBody(req);
    const found = auth(body.token);
    if (!found) return sendJson(res, 401, { error: '登录已失效' });
    hub.detach(body.token, null, false);
    found.room.leave(found.player.id);
    sendJson(res, 200, { ok: true });
  },
};

// ---------- 静态文件 ----------

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('页面不存在');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
      'Content-Length': st.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------- 服务器 ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/info') {
      const addresses = listAddresses();
      return sendJson(res, 200, {
        port: PORT,
        addresses,
        rooms: rooms.rooms.size,
        uptime: process.uptime(),
      });
    }

    if (pathname === '/api/events') {
      const found = rooms.findByToken(url.searchParams.get('token'));
      if (!found) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('登录已失效');
      }
      found.room.setConnected(found.player.id, true);
      hub.attach(found.room, found.player.id, res, found.player.token);
      return;
    }

    if (pathname === '/api/state') {
      const found = rooms.findByToken(url.searchParams.get('token'));
      if (!found) return sendJson(res, 401, { error: '登录已失效' });
      return sendJson(res, 200, { state: stateOf(found.room, found.player.id) });
    }

    if (pathname.startsWith('/api/')) {
      const name = pathname.slice(5);
      const handler = api[name];
      if (!handler) return sendJson(res, 404, { error: '接口不存在' });
      if (req.method !== 'POST') return sendJson(res, 405, { error: '请求方法错误' });
      return await handler(req, res);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end('Method Not Allowed');
    }
    return serveStatic(req, res, pathname);
  } catch (err) {
    const msg = err && err.message ? err.message : '服务器错误';
    if (!msg.includes('房间') && !msg.includes('准备')) logger.warn(`请求失败 ${pathname}: ${msg}`);
    if (!res.headersSent) sendJson(res, 400, { error: msg });
    else res.end();
  }
});

server.timeout = 0;
server.requestTimeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  const addrs = listAddresses();
  const lines = [];
  lines.push('');
  lines.push('  ♠ ♥ ♦ ♣  德州扑克 · 局域网版');
  lines.push('  ' + '-'.repeat(46));
  lines.push(`  本机：   http://localhost:${PORT}`);
  if (!addrs.length) {
    lines.push('  局域网： 未找到可用网卡地址');
  } else {
    for (const a of addrs) {
      lines.push(`  局域网： http://${a.address}:${PORT}   (${a.name}${a.virtual ? ' · 虚拟网卡' : ''})`);
    }
  }
  lines.push('  ' + '-'.repeat(46));
  lines.push(`  日志文件：${logger.file}`);
  lines.push('');
  console.log(lines.join('\n'));
  logger.info(`服务已启动，端口 ${PORT}`);
});

process.on('SIGINT', () => {
  logger.info('收到退出信号，正在关闭');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});
