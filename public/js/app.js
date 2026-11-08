'use strict';

import { api } from './api.js';
import { store } from './store.js';
import { $, $$, el, toast, avatarTint, initialOf, copyText } from './ui.js';
import { initTable, renderTable } from './table.js';

const screenEls = {
  lobby: $('#screen-lobby'),
  room: $('#screen-room'),
};

const els = {
  // 大厅
  nickname: $('#nickname'),
  joinCode: $('#join-code'),
  tabs: $$('.tab'),
  btnCreate: $('#btn-create'),
  btnJoin: $('#btn-join'),
  lobbyError: $('#lobby-error'),
  lanAddr: $('#lan-addr'),
  // 房间
  roomCodeBox: $('#room-code-box'),
  roomCode: $('#room-code'),
  roomTitle: $('#room-title'),
  roomRules: $('#room-rules'),
  roomCount: $('#room-count'),
  roomNote: $('#room-note'),
  waitingPanel: $('#waiting-panel'),
  tablePanel: $('#table-panel'),
  playerList: $('#player-list'),
  conn: $('#conn-state'),
  connText: $('#conn-state .conn-text'),
  btnInvite: $('#btn-invite'),
  btnLeave: $('#btn-leave'),
  waitingActions: $('#waiting-actions'),
  readySummary: $('#ready-summary'),
  btnReady: $('#btn-ready'),
  btnStart: $('#btn-start'),
  btnSettings: $('#btn-settings'),
  settingsPanel: $('#settings-panel'),
  cfgSmall: $('#cfg-small'),
  cfgBig: $('#cfg-big'),
  cfgChips: $('#cfg-chips'),
  cfgTimeout: $('#cfg-timeout'),
  cfgBlindMode: $('#cfg-blind-mode'),
  cfgBlindHands: $('#cfg-blind-hands'),
  cfgBlindMinutes: $('#cfg-blind-minutes'),
  cfgBlindFactor: $('#cfg-blind-factor'),
  cfgHandsField: $('#cfg-hands-field'),
  cfgMinutesField: $('#cfg-minutes-field'),
  blindPreview: $('#blind-preview'),
  btnSaveConfig: $('#btn-save-config'),
  btnCancelConfig: $('#btn-cancel-config'),
  settingsError: $('#settings-error'),
};

let source = null; // EventSource：房间状态推送
let snapshot = null; // 最近一次服务器快照
let busy = false; // 防止重复提交

// ---------- 通用界面 ----------

function showScreen(name) {
  for (const [key, node] of Object.entries(screenEls)) {
    const active = key === name;
    node.classList.toggle('is-active', active);
    node.hidden = !active;
  }
}

function showError(text) {
  els.lobbyError.textContent = text || '';
  els.lobbyError.hidden = !text;
}

function setConn(kind, text) {
  els.conn.classList.toggle('is-ok', kind === 'ok');
  els.conn.classList.toggle('is-bad', kind === 'bad');
  els.connText.textContent = text;
}

function setBusy(value) {
  busy = value;
  els.btnCreate.disabled = value;
  els.btnJoin.disabled = value || els.joinCode.value.length !== 4;
}

// ---------- 大厅 ----------

function switchTab(name) {
  for (const tab of els.tabs) tab.classList.toggle('is-active', tab.dataset.tab === name);
  for (const body of $$('[data-tab-body]')) body.hidden = body.dataset.tabBody !== name;
  showError('');
  if (name === 'join') els.joinCode.focus();
}

function readNickname() {
  const name = els.nickname.value.trim();
  if (!name) {
    showError('先填一个昵称吧');
    els.nickname.focus();
    return null;
  }
  if (name.length > 12) {
    showError('昵称最多 12 个字');
    return null;
  }
  showError('');
  store.save({ nickname: name });
  return name;
}

async function createRoom() {
  if (busy) return;
  const name = readNickname();
  if (!name) return;
  setBusy(true);
  try {
    const res = await api.create(name);
    enterRoom(res);
    toast(`房间 ${res.code} 创建成功，把房间码发给朋友吧`);
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(false);
  }
}

async function joinRoom() {
  if (busy) return;
  const name = readNickname();
  if (!name) return;
  const code = els.joinCode.value.trim().toUpperCase();
  if (code.length !== 4) {
    showError('房间码是 4 位字母数字');
    els.joinCode.focus();
    return;
  }
  setBusy(true);
  try {
    const res = await api.join(code, name);
    enterRoom(res);
    toast(`已加入房间 ${res.code}`);
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(false);
  }
}

// ---------- 进入 / 离开房间 ----------

function enterRoom(res) {
  store.save({ code: res.code, token: res.token, playerId: res.playerId });
  els.roomCode.textContent = res.code;
  snapshot = null;
  showScreen('room');
  setConn('waiting', '连接中…');
  if (res.state) applyState(res.state);
  requestAnimationFrame(() => connectEvents(res.token));
}

function connectEvents(token) {
  closeSource();
  setConn('waiting', '连接中…');

  const current = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source = current;

  current.onopen = () => {
    if (source === current) setConn('ok', '已连接');
  };

  current.onmessage = (ev) => {
    if (source !== current) return;
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    if (msg && msg.type === 'state' && msg.state) {
      setConn('ok', '已连接');
      applyState(msg.state);
    }
  };

  current.onerror = () => {
    if (source === current) setConn('bad', '连接断开，重连中…');
  };
}

function closeSource() {
  if (source) {
    try {
      source.close();
    } catch (_) {}
    source = null;
  }
}

async function leaveRoom() {
  const token = store.get().token;
  const playing = snapshot && snapshot.phase === 'playing';
  if (playing && !window.confirm('这局还没结束，现在离开本手会直接弃牌。确定离开？')) return;

  closeSource();
  if (token) {
    try {
      await api.leave(token);
    } catch (_) {
      // 房间可能已经不存在了，照样回大厅
    }
  }
  store.clearSession();
  snapshot = null;
  els.playerList.innerHTML = '';
  els.roomCount.textContent = '0 / 8';
  els.settingsPanel.hidden = true;
  els.tablePanel.hidden = true;
  els.waitingPanel.hidden = false;
  showScreen('lobby');
  showError('');
  toast('已离开房间');
}

// ---------- 准备 / 开始 / 设置 ----------

async function toggleReady() {
  const token = store.get().token;
  const me = snapshot && snapshot.you;
  if (!token || !me) return;
  els.btnReady.disabled = true;
  try {
    await api.ready(token, !me.ready);
  } catch (err) {
    toast(err.message);
  } finally {
    els.btnReady.disabled = false;
  }
}

async function startGame() {
  const token = store.get().token;
  if (!token) return;
  els.btnStart.disabled = true;
  try {
    await api.start(token);
  } catch (err) {
    toast(err.message);
    els.btnStart.disabled = false;
  }
}

function roundTo5(n) {
  return Math.max(5, Math.round(n / 5) * 5);
}

// 与服务器一致的下一级盲注（预览用，第 1 级始终是设置的原始大小盲）
function nextBlindPair(smallBlind, factor) {
  const sb = Math.max(smallBlind + 1, roundTo5(smallBlind * factor));
  return { sb, bb: Math.min(200000, sb * 2) };
}

function syncBlindFields() {
  const mode = els.cfgBlindMode.value;
  els.cfgHandsField.hidden = mode !== 'hands';
  els.cfgMinutesField.hidden = mode !== 'time';
  updateBlindPreview();
}

function updateBlindPreview() {
  if (!els.blindPreview) return;
  const mode = els.cfgBlindMode.value;
  const small = Math.max(1, Number(els.cfgSmall.value) || 10);
  const factor = Number(els.cfgBlindFactor.value) || 1.5;
  const every =
    Number(mode === 'hands' ? els.cfgBlindHands.value : els.cfgBlindMinutes.value) || 10;

  if (mode === 'off') {
    els.blindPreview.textContent = `整局盲注保持 ${small} / ${small * 2}，不升盲。`;
    return;
  }

  const lv2 = nextBlindPair(small, factor);
  const lv3 = nextBlindPair(lv2.sb, factor);
  const unit = mode === 'hands' ? '手' : '分钟';
  els.blindPreview.textContent =
    `每 ${every} ${unit}升一级（×${factor}）：第 ${every + 1} ${unit}起 ${lv2.sb} / ${lv2.bb}，` +
    `第 ${every * 2 + 1} ${unit}起 ${lv3.sb} / ${lv3.bb}…`;
}

function openSettings() {
  if (!snapshot) return;
  const cfg = snapshot.config || {};
  els.cfgSmall.value = cfg.smallBlind;
  els.cfgBig.value = cfg.bigBlind;
  els.cfgChips.value = cfg.startingChips;
  els.cfgTimeout.value = cfg.actionTimeout;
  els.cfgBlindMode.value = cfg.blindUpMode || 'off';
  els.cfgBlindHands.value = cfg.blindUpEveryHands || 10;
  els.cfgBlindMinutes.value = cfg.blindUpEveryMinutes || 10;
  els.cfgBlindFactor.value = String(cfg.blindFactor || 1.5);
  els.settingsError.hidden = true;
  els.settingsPanel.hidden = false;
  syncBlindFields();
}

async function saveConfig() {
  const token = store.get().token;
  if (!token) return;
  const config = {
    smallBlind: Number(els.cfgSmall.value),
    bigBlind: Number(els.cfgBig.value),
    startingChips: Number(els.cfgChips.value),
    actionTimeout: Number(els.cfgTimeout.value),
    blindUpMode: els.cfgBlindMode.value,
    blindUpEveryHands: Number(els.cfgBlindHands.value),
    blindUpEveryMinutes: Number(els.cfgBlindMinutes.value),
    blindFactor: Number(els.cfgBlindFactor.value),
  };
  els.btnSaveConfig.disabled = true;
  try {
    await api.config(token, config);
    els.settingsPanel.hidden = true;
    toast('房间设置已保存');
  } catch (err) {
    els.settingsError.textContent = err.message;
    els.settingsError.hidden = false;
  } finally {
    els.btnSaveConfig.disabled = false;
  }
}

async function copyInvite() {
  const code = (snapshot && snapshot.code) || store.get().code;
  if (!code) return;
  const addr = (els.lanAddr.textContent || '').trim() || window.location.origin;
  const ok = await copyText(`来打德州扑克！房间码：${code}\n浏览器打开：${addr}`);
  toast(ok ? `邀请信息已复制（房间码 ${code}）` : `房间码 ${code}，请手动告诉朋友`);
}

// ---------- 渲染房间 ----------

function applyState(state) {
  snapshot = state;
  store.get().state = state;
  renderRoom(state);
}

function fmtNumber(n) {
  return Number(n || 0).toLocaleString('zh-CN');
}

function renderRoom(state) {
  const players = (state.players || []).filter((p) => p && !p.empty);
  els.roomCode.textContent = state.code || store.get().code || '----';
  els.roomCount.textContent = `${players.length} / 8`;

  const cfg = state.config || {};
  const blinds = state.blinds || { level: 1, smallBlind: cfg.smallBlind, bigBlind: cfg.bigBlind };
  let rules = `盲注 ${blinds.smallBlind} / ${blinds.bigBlind}`;
  if (blinds.level > 1) rules += `（第 ${blinds.level} 级）`;
  rules += ` · 初始 ${fmtNumber(cfg.startingChips)} · 思考 ${cfg.actionTimeout} 秒`;
  if (cfg.blindUpMode === 'hands') rules += ` · 每 ${cfg.blindUpEveryHands} 手升盲`;
  else if (cfg.blindUpMode === 'time') rules += ` · 每 ${cfg.blindUpEveryMinutes} 分钟升盲`;
  if (state.phase === 'playing' || state.phase === 'handover') rules += ` · 第 ${state.handNo} 手`;
  els.roomRules.textContent = rules;

  if (state.phase === 'playing' || state.phase === 'handover') {
    els.roomTitle.textContent = '牌局进行中';
    els.roomNote.textContent = '';
  } else if (state.gameOver) {
    els.roomTitle.textContent = '牌局结束';
    els.roomNote.textContent = '回到等待区了，房主可以再开一局。';
  } else {
    els.roomTitle.textContent = '等待玩家';
    els.roomNote.textContent = '把房间码发给朋友，人齐后由房主开始。';
  }

  els.playerList.innerHTML = '';
  if (!players.length) {
    els.playerList.append(
      el('li', { className: 'player-row' }, [el('span', { className: 'pname', textContent: '房间里还没有人' })])
    );
  } else {
    for (const p of players) els.playerList.append(playerRow(p));
  }

  const inGame = state.phase === 'playing' || state.phase === 'handover';
  els.waitingPanel.hidden = inGame;
  els.tablePanel.hidden = !inGame;
  if (inGame) renderTable(state);

  renderActions(state);
}

function renderActions(state) {
  const waiting = state.phase === 'waiting';
  els.waitingActions.hidden = !waiting;
  els.btnSettings.hidden = !(waiting && state.you && state.you.isHost);
  if (!waiting) {
    els.settingsPanel.hidden = true;
    els.btnReady.hidden = true;
    els.btnStart.hidden = true;
    return;
  }

  const players = (state.players || []).filter((p) => p && !p.empty && !p.leaving);
  const isHost = !!(state.you && state.you.isHost);
  const others = players.filter((p) => p.id !== state.hostId);
  const readyCount = others.filter((p) => p.ready).length;

  if (!others.length) els.readySummary.textContent = '等一位朋友进来';
  else els.readySummary.textContent = `${readyCount} / ${others.length} 人已准备`;

  els.btnReady.hidden = isHost;
  els.btnStart.hidden = !isHost;

  const meReady = !!(state.you && state.you.ready);
  els.btnReady.textContent = meReady ? '取消准备' : '准备';
  els.btnReady.classList.toggle('primary', !meReady);
  els.btnReady.classList.toggle('ghost', meReady);

  const canStart = players.length >= 2 && readyCount === others.length;
  els.btnStart.disabled = !canStart;
  els.btnStart.title = canStart
    ? ''
    : players.length < 2
      ? '至少需要 2 名玩家'
      : '还有玩家没有准备';
}

function playerRow(p) {
  const row = el('li', { className: `player-row${p.isYou ? ' is-you' : ''}` });

  const seat = el('span', { className: 'seat-tag', textContent: String(p.seat + 1), title: '座位号' });

  const avatar = el('span', {
    className: `avatar ${avatarTint(p.name)}`,
    textContent: initialOf(p.name),
  });

  const name = el('span', {
    className: 'pname',
    textContent: `${p.name || '无名氏'}${p.isYou ? '（你）' : ''}`,
  });

  const badges = el('span', { className: 'badges' });
  if (p.isHost) badges.append(el('span', { className: 'badge host', textContent: '房主' }));
  if (p.ready) badges.append(el('span', { className: 'badge ready', textContent: '已准备' }));
  if (!p.connected) badges.append(el('span', { className: 'badge off', textContent: '离线' }));

  const chips = el('span', {
    className: 'pchips',
    textContent: fmtNumber(p.chips),
  });

  row.append(seat, avatar, name, badges, chips);
  return row;
}

// ---------- 局域网地址提示 ----------

async function loadLanAddress() {
  try {
    const info = await api.info();
    const list = Array.isArray(info.addresses) ? info.addresses : [];
    const pick = list.find((a) => !a.virtual) || list[0];
    els.lanAddr.textContent = pick ? `http://${pick.address}:${info.port}` : window.location.origin;
  } catch (_) {
    els.lanAddr.textContent = window.location.origin;
  }
}

// ---------- 启动 ----------

function bind() {
  els.nickname.addEventListener('input', () => store.save({ nickname: els.nickname.value }));

  for (const tab of els.tabs) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }

  els.btnCreate.addEventListener('click', createRoom);
  els.btnJoin.addEventListener('click', joinRoom);

  els.joinCode.addEventListener('input', () => {
    els.joinCode.value = els.joinCode.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4);
    els.btnJoin.disabled = busy || els.joinCode.value.length !== 4;
  });

  els.joinCode.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinRoom();
  });

  els.nickname.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (els.joinCode.closest('[data-tab-body]').hidden) createRoom();
    else joinRoom();
  });

  els.btnLeave.addEventListener('click', leaveRoom);
  els.btnInvite.addEventListener('click', copyInvite);
  els.roomCodeBox.addEventListener('click', copyInvite);
  els.roomCodeBox.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      copyInvite();
    }
  });

  els.btnReady.addEventListener('click', toggleReady);
  els.btnStart.addEventListener('click', startGame);
  els.btnSettings.addEventListener('click', openSettings);
  els.btnCancelConfig.addEventListener('click', () => {
    els.settingsPanel.hidden = true;
  });
  els.btnSaveConfig.addEventListener('click', saveConfig);

  els.cfgBlindMode.addEventListener('change', syncBlindFields);
  els.cfgBlindFactor.addEventListener('change', updateBlindPreview);
  for (const node of [els.cfgSmall, els.cfgBlindHands, els.cfgBlindMinutes]) {
    node.addEventListener('input', updateBlindPreview);
  }
}

async function tryRejoin(token) {
  try {
    const res = await api.rejoin(token);
    enterRoom(res);
    toast(`已回到房间 ${res.code}`);
  } catch (err) {
    store.clearSession();
    showError(err.message);
    showScreen('lobby');
  }
}

function boot() {
  const saved = store.load();
  els.nickname.value = saved.nickname || '';
  els.btnJoin.disabled = true;
  bind();
  initTable();
  loadLanAddress();

  if (saved.token) {
    tryRejoin(saved.token);
  } else {
    showScreen('lobby');
    els.nickname.focus();
  }
}

boot();
