'use strict';

// 本地会话：昵称长期保存；房间码 / token 用于刷新或断线后自动回到房间。

const KEY = 'dsh-poker.session';

const mem = {
  nickname: '',
  code: '',
  token: '',
  playerId: '',
  state: null, // 最近一次服务器快照，仅内存
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (typeof saved.nickname === 'string') mem.nickname = saved.nickname;
      if (typeof saved.code === 'string') mem.code = saved.code;
      if (typeof saved.token === 'string') mem.token = saved.token;
      if (typeof saved.playerId === 'string') mem.playerId = saved.playerId;
    }
  } catch (_) {
    // 忽略损坏的本地数据
  }
  return mem;
}

function persist() {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        nickname: mem.nickname,
        code: mem.code,
        token: mem.token,
        playerId: mem.playerId,
      })
    );
  } catch (_) {
    // 隐私模式等情况下写不进去，不影响游戏
  }
}

function save(patch) {
  Object.assign(mem, patch);
  persist();
  return mem;
}

// 离开房间：清掉房间信息，保留昵称
function clearSession() {
  mem.code = '';
  mem.token = '';
  mem.playerId = '';
  mem.state = null;
  persist();
}

export const store = { KEY, load, save, clearSession, get: () => mem };
