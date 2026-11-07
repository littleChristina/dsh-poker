'use strict';

// 牌面渲染：把 0..51 的牌变成 DOM 元素
// card = suit * 13 + rank，rank 0=2 .. 12=A，suit 0=♠ 1=♥ 2=♦ 3=♣

const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_LABELS = ['♠', '♥', '♦', '♣'];
const RED_SUITS = new Set([1, 2]);

export function rankLabel(card) {
  return RANK_LABELS[card % 13];
}

export function suitLabel(card) {
  return SUIT_LABELS[(card / 13) | 0];
}

export function cardEl(card, opts = {}) {
  const { small = false, dim = false, back = false } = opts;
  const node = document.createElement('div');

  if (back) {
    node.className = `card back${small ? ' small' : ''}`;
    return node;
  }

  const suit = (card / 13) | 0;
  const classes = ['card'];
  if (small) classes.push('small');
  if (dim) classes.push('dim');
  if (RED_SUITS.has(suit)) classes.push('red');
  node.className = classes.join(' ');
  node.dataset.card = String(card);

  const rank = document.createElement('span');
  rank.className = 'r';
  rank.textContent = rankLabel(card);

  const suitEl = document.createElement('span');
  suitEl.className = 's';
  suitEl.textContent = SUIT_LABELS[suit];

  node.append(rank, suitEl);
  return node;
}

export function cardBack(opts = {}) {
  return cardEl(0, { ...opts, back: true });
}
