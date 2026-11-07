'use strict';

import { $, el, toast, avatarTint, initialOf } from './ui.js';
import { cardEl, cardBack } from './cards.js';
import { api } from './api.js';
import { store } from './store.js';

const STREET_LABELS = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };
const SEAT_COUNT = 8;

const els = {
  panel: $('#table-panel'),
  stage: $('#table-stage'),
  seats: $('#table-seats'),
  board: $('#table-board'),
  pot: $('#table-pot'),
  street: $('#table-street'),
  result: $('#hand-result'),
  bar: $('#action-bar'),
  status: $('#action-status'),
  timerFill: $('#action-timer-fill'),
  buttons: $('#action-buttons'),
  fold: $('#btn-fold'),
  check: $('#btn-check'),
  call: $('#btn-call'),
  raise: $('#btn-raise'),
  raiseRow: $('#raise-row'),
  slider: $('#raise-slider'),
  raiseValue: $('#raise-value'),
  raiseCancel: $('#btn-raise-cancel'),
  raiseConfirm: $('#btn-raise-confirm'),
};

const seatNodes = new Map(); // playerId -> { root, cards, avatar, bet, name, chips, tags, action }

let last = null;
let receivedAt = 0;
let heroSeat = 0;
let submitting = false;
let ticker = null;
let resultTimerEl = null;
let bestByWinner = new Map(); // 每位赢家自己的最佳五张（用于高亮其底牌）
let boardBest = new Set(); // 公共牌中参与赢家组合的牌

// ---------- 小工具 ----------

function fmt(n) {
  return Number(n || 0).toLocaleString('zh-CN');
}

function rule(text, extra = '') {
  return el('span', { className: `tag${extra ? ` ${extra}` : ''}`, textContent: text });
}

// 座位在牌桌上的位置：自己永远在正下方，其余按座位顺序顺时针排开
function seatPosition(seat) {
  const idx = (seat - heroSeat + SEAT_COUNT) % SEAT_COUNT;
  const angle = ((90 + idx * 45) * Math.PI) / 180;
  return {
    x: 50 + 36.5 * Math.cos(angle),
    y: 52 + 31 * Math.sin(angle),
  };
}

// ---------- 初始化 ----------

export function initTable() {
  els.fold.addEventListener('click', () => send('fold'));
  els.check.addEventListener('click', () => send('check'));
  els.call.addEventListener('click', () => send('call'));
  els.raise.addEventListener('click', openRaise);
  els.raiseCancel.addEventListener('click', closeRaise);
  els.raiseConfirm.addEventListener('click', confirmRaise);
  els.slider.addEventListener('input', updateRaiseLabel);

  if (!ticker) ticker = setInterval(tick, 250);
}

// ---------- 主渲染 ----------

export function renderTable(state) {
  last = state;
  receivedAt = Date.now();
  heroSeat = state.you ? state.you.seat : 0;

  const winning = winningCards(state);
  bestByWinner = winning.byWinner;
  boardBest = winning.board;
  renderSeats(state);
  renderCenter(state);
  renderActionBar(state);
  renderResult(state);
  tick();
}

function renderSeats(state) {
  const occupied = (state.players || []).filter((p) => p && !p.empty);
  const seen = new Set();

  for (const p of occupied) {
    let node = seatNodes.get(p.id);
    if (!node) {
      node = buildSeat();
      seatNodes.set(p.id, node);
      els.seats.append(node.root);
    }
    updateSeat(node, p, state);
    seen.add(p.id);
  }

  for (const [id, node] of seatNodes) {
    if (seen.has(id)) continue;
    node.root.remove();
    seatNodes.delete(id);
  }
}

function buildSeat() {
  const root = el('div', { className: 'seat' });
  const cards = el('div', { className: 'seat-cards' });
  const avatarWrap = el('div', { className: 'seat-avatar-wrap' });
  const avatar = el('div', { className: 'seat-avatar' });
  const bet = el('div', { className: 'seat-bet', hidden: true });
  const name = el('div', { className: 'seat-name' });
  const chips = el('div', { className: 'seat-chips' });
  const tags = el('div', { className: 'seat-tags' });
  const action = el('div', { className: 'seat-action' });

  avatarWrap.append(avatar, bet);
  root.append(cards, avatarWrap, name, chips, tags, action);

  return { root, cards, avatarWrap, avatar, bet, name, chips, tags, action };
}

function updateSeat(node, p, state) {
  const { x, y } = seatPosition(p.seat);
  node.root.style.left = `${x}%`;
  node.root.style.top = `${y}%`;

  const isTurn = !!(state.you && state.phase === 'playing' && state.actorId === p.id);
  node.root.classList.toggle('is-hero', !!p.isYou);
  node.root.classList.toggle('is-turn', isTurn);
  node.root.classList.toggle('is-folded', !!p.folded);
  node.root.classList.toggle('is-allin', !!p.allIn);
  node.root.classList.toggle('is-winner', (p.won || 0) > 0);

  node.avatar.textContent = initialOf(p.name);
  node.avatar.className = `seat-avatar ${avatarTint(p.name)}`;
  node.name.textContent = p.isYou ? `${p.name}（你）` : p.name;
  node.chips.textContent = fmt(p.chips);
  node.action.textContent = p.lastAction || '';

  if (p.bet > 0) {
    node.bet.hidden = false;
    node.bet.textContent = fmt(p.bet);
  } else {
    node.bet.hidden = true;
    node.bet.textContent = '';
  }

  node.cards.innerHTML = '';
  const myBest = bestByWinner.get(p.id);
  if (Array.isArray(p.cards) && p.cards.length === 2) {
    for (const card of p.cards) {
      const cardNode = cardEl(card, { small: !p.isYou });
      if (myBest && myBest.has(card)) cardNode.classList.add('best');
      node.cards.append(cardNode);
    }
  } else if (!p.folded) {
    node.cards.append(cardBack({ small: !p.isYou }), cardBack({ small: !p.isYou }));
  }

  node.tags.innerHTML = '';
  if (p.isDealer) node.tags.append(rule('D', 'dealer'));
  if (p.isSmallBlind) node.tags.append(rule('SB'));
  if (p.isBigBlind) node.tags.append(rule('BB'));
  if (p.handName) node.tags.append(rule(p.handName));
  if (p.won > 0) node.tags.append(rule(`+${fmt(p.won)}`, 'win'));
  node.tags.hidden = node.tags.childElementCount === 0;
}

function renderCenter(state) {
  els.pot.textContent = fmt(state.pot);
  els.street.textContent = streetLabel(state);

  els.board.innerHTML = '';
  const board = Array.isArray(state.board) ? state.board : [];
  for (let i = 0; i < 5; i++) {
    if (i < board.length) {
      const card = cardEl(board[i]);
      if (boardBest.has(board[i])) card.classList.add('best');
      els.board.append(card);
    } else {
      els.board.append(el('div', { className: 'card empty' }));
    }
  }
}

function streetLabel(state) {
  if (state.phase === 'handover') {
    return state.result && state.result.reason === 'fold' ? '本手结束' : '摊牌';
  }
  return STREET_LABELS[state.street] || '翻牌前';
}

// 每位赢家实际用来赢下本手的 5 张牌（可能包含底牌与公共牌）
function winningCards(state) {
  const byWinner = new Map();
  const board = new Set();
  const result = state.result;
  if (!result || !Array.isArray(result.reveals)) return { byWinner, board };
  if (result.reason !== 'showdown') return { byWinner, board };

  const winnerIds = new Set();
  for (const pot of result.pots || []) {
    for (const id of pot.winnerIds || []) winnerIds.add(id);
  }
  const boardCards = new Set(Array.isArray(result.board) ? result.board : []);

  for (const reveal of result.reveals) {
    if (!winnerIds.has(reveal.id)) continue;
    if (!Array.isArray(reveal.bestCards) || reveal.bestCards.length !== 5) continue;
    const set = new Set(reveal.bestCards);
    byWinner.set(reveal.id, set);
    for (const card of reveal.bestCards) if (boardCards.has(card)) board.add(card);
  }
  return { byWinner, board };
}

// ---------- 行动条 ----------

function renderActionBar(state) {
  const playing = state.phase === 'playing';
  els.bar.hidden = !(playing || state.phase === 'handover');

  if (!playing) {
    els.status.textContent = '本手结束，等待下一手';
    els.buttons.hidden = true;
    els.bar.classList.remove('is-mine');
    closeRaise();
    els.timerFill.style.width = '0%';
    return;
  }

  const me = state.you;
  const legal = me ? me.legal : null;
  const mine = !!(me && legal && state.actorId === me.id);

  els.bar.classList.toggle('is-mine', mine);
  closeRaise();

  if (!mine) {
    els.buttons.hidden = true;
    const actor = (state.players || []).find((p) => p.id === state.actorId);
    els.status.textContent = actor ? `等待 ${actor.name} 行动` : '等待发牌…';
    return;
  }

  els.buttons.hidden = false;
  els.status.textContent = '轮到你行动';

  els.check.hidden = !legal.check;
  els.call.hidden = !(legal.call > 0);
  if (legal.call > 0) {
    const allInCall = me.chips > 0 && legal.call >= me.chips;
    els.call.textContent = allInCall ? `跟注全下 ${fmt(legal.call)}` : `跟注 ${fmt(legal.call)}`;
  }

  els.raise.hidden = !legal.raise;
  if (legal.raise) {
    const r = legal.raise;
    els.raise.textContent = r.allInOnly ? `全下 ${fmt(r.max)}` : '加注';
    els.raise.dataset.min = String(r.min);
    els.raise.dataset.max = String(r.max);
  }
}

// ---------- 加注滑块 ----------

function openRaise() {
  const legal = last && last.you ? last.you.legal : null;
  if (!legal || !legal.raise) return;

  const { min, max, allInOnly } = legal.raise;
  const cfg = last.config || {};
  let step = cfg.bigBlind || 10;
  if (max - min < step) step = 1;

  els.slider.min = String(min);
  els.slider.max = String(max);
  els.slider.step = String(step);
  els.slider.value = String(allInOnly ? max : min);
  els.slider.disabled = min >= max;

  els.raiseRow.hidden = false;
  els.raise.hidden = true;
  updateRaiseLabel();
}

function closeRaise() {
  els.raiseRow.hidden = true;
  els.raise.hidden = false;
}

function updateRaiseLabel() {
  const legal = last && last.you ? last.you.legal : null;
  if (!legal || !legal.raise) return;
  const { min, max } = legal.raise;
  const value = Math.max(min, Math.min(max, Math.round(Number(els.slider.value))));
  const text = value >= max ? `全下 ${fmt(max)}` : `加注到 ${fmt(value)}`;
  els.raiseValue.textContent = text;
  els.raiseConfirm.textContent = text;
}

function confirmRaise() {
  const legal = last && last.you ? last.you.legal : null;
  if (!legal || !legal.raise) {
    closeRaise();
    return;
  }
  const { min, max } = legal.raise;
  const value = Math.max(min, Math.min(max, Math.round(Number(els.slider.value))));
  closeRaise();
  send('raise', value);
}

// ---------- 提交动作 ----------

async function send(action, amount) {
  if (submitting) return;
  const token = store.get().token;
  if (!token) return;

  submitting = true;
  setButtonsDisabled(true);
  try {
    await api.action(token, action, amount);
  } catch (err) {
    toast(err.message);
  } finally {
    submitting = false;
    setButtonsDisabled(false);
  }
}

function setButtonsDisabled(disabled) {
  for (const btn of [els.fold, els.check, els.call, els.raise, els.raiseConfirm]) {
    btn.disabled = disabled;
  }
}

// ---------- 计时器 ----------

function tick() {
  if (!last) return;

  if (last.phase === 'playing' && last.actorId) {
    const remain = Math.max(0, (last.deadlineIn || 0) - (Date.now() - receivedAt));
    const total = last.actionTimeout || 1;
    els.timerFill.style.width = `${Math.max(0, Math.min(1, remain / total)) * 100}%`;
    if (last.you && last.actorId === last.you.id && last.you.legal) {
      els.status.textContent = `轮到你行动 · ${Math.ceil(remain / 1000)} 秒`;
    }
  } else {
    els.timerFill.style.width = '0%';
  }

  if (last.phase === 'handover' && last.nextHandIn != null && resultTimerEl) {
    const remain = Math.max(0, last.nextHandIn - (Date.now() - receivedAt));
    resultTimerEl.textContent = `下一手 ${Math.ceil(remain / 1000)} 秒后开始`;
  }
}

// ---------- 结算展示 ----------

function renderResult(state) {
  const result = state.result;
  const open = state.phase === 'handover' && !!result;
  els.result.hidden = !open;
  els.result.innerHTML = '';
  resultTimerEl = null;
  if (!open) return;

  const box = el('div', { className: 'result-card' });
  const showdown = result.reason !== 'fold';
  const pots = result.pots || [];
  const splitIds = new Set();
  for (const pot of pots) {
    if ((pot.winnerIds || []).length > 1) {
      for (const id of pot.winnerIds) splitIds.add(id);
    }
  }
  const tie = splitIds.size > 0;

  box.append(
    el('div', {
      className: 'result-title',
      textContent: showdown ? (tie ? '摊牌 · 平分底池' : '摊牌 · 赢家最佳五张') : '其他人都弃牌了',
    })
  );

  const list = el('div', { className: 'result-winners' });
  const wins = Object.entries(result.winnings || {}).filter(([, amount]) => amount > 0);
  const refunds = result.refunds || {};
  const seatById = new Map((state.players || []).map((p) => [p.id, p]));
  const revealById = new Map((result.reveals || []).map((r) => [r.id, r]));

  for (const [id, amount] of wins) {
    const p = seatById.get(id);
    if (!p) continue;
    const refund = refunds[id] || 0;
    const gain = amount - refund;
    if (gain <= 0) continue;

    const reveal = revealById.get(id);
    const row = el('div', { className: 'result-row' });
    row.append(el('span', { className: `avatar tiny ${avatarTint(p.name)}`, textContent: initialOf(p.name) }));
    row.append(el('span', { className: 'result-name', textContent: p.name }));
    if (splitIds.has(id)) row.append(el('span', { className: 'result-split', textContent: '平分' }));
    if (reveal && reveal.handName) {
      row.append(el('span', { className: 'result-hand', textContent: reveal.handName }));
    }
    row.append(el('span', { className: 'result-amount', textContent: `+${fmt(gain)}` }));
    if (refund > 0) {
      row.append(el('span', { className: 'result-refund', textContent: `退回 ${fmt(refund)}` }));
    }

    if (reveal && Array.isArray(reveal.bestCards) && reveal.bestCards.length === 5) {
      const cards = el('div', { className: 'result-cards' });
      for (const card of reveal.bestCards) cards.append(cardEl(card));
      row.append(cards);
    }

    list.append(row);
  }

  for (const [id, refund] of Object.entries(refunds)) {
    if (!(refund > 0)) continue;
    const p = seatById.get(id);
    if (!p) continue;
    const gain = (result.winnings || {})[id] || 0;
    if (gain - refund > 0) continue; // 已经在赢家行里显示
    list.append(
      el('p', { className: 'result-refund-row', textContent: `${p.name} 退回未跟注的 ${fmt(refund)}` })
    );
  }

  if (!list.childElementCount) {
    list.append(el('p', { className: 'result-note', textContent: '本手结束' }));
  }
  box.append(list);

  if (showdown) {
    box.append(
      el('p', {
        className: 'result-note',
        textContent: tie
          ? '平局：桌面高亮的牌是各赢家各自组合用到的牌'
          : '桌面高亮的牌就是赢家的获胜组合',
      })
    );
  }

  const foot = el('p', { className: 'result-foot' });
  resultTimerEl = el('span', { className: 'result-timer', textContent: '下一手即将开始' });
  foot.append(resultTimerEl);
  box.append(foot);

  els.result.append(box);
  tick();
}
