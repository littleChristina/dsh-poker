'use strict';

const { rankOf, suitOf } = require('./cards');

// 牌型等级：数字越大越强
const CAT = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
};

const CAT_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];

// 用 15 进制把 (牌型, 5 个关键点数) 压成一个可比较的整数
function encode(cat, vals) {
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (vals[i] || 0);
  return score;
}

// 传入 5 个互不相同的点数（升序），返回顺子最大点数；A2345 返回 3（5 高）
function straightHigh(ranksAsc) {
  if (ranksAsc.length !== 5) return -1;
  if (ranksAsc[0] === 0 && ranksAsc[1] === 1 && ranksAsc[2] === 2 && ranksAsc[3] === 3 && ranksAsc[4] === 12) {
    return 3;
  }
  for (let i = 1; i < 5; i++) {
    if (ranksAsc[i] !== ranksAsc[i - 1] + 1) return -1;
  }
  return ranksAsc[4];
}

function evaluate5(cards) {
  if (cards.length !== 5) throw new Error('evaluate5 需要正好 5 张牌');
  const ranksDesc = cards.map(rankOf).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const isFlush = suits.every((s) => s === suits[0]);
  const uniqueAsc = [...new Set(ranksDesc)].sort((a, b) => a - b);
  const sHigh = straightHigh(uniqueAsc);

  if (isFlush && sHigh >= 0) {
    return { cat: CAT.STRAIGHT_FLUSH, vals: [sHigh, 0, 0, 0, 0], score: encode(CAT.STRAIGHT_FLUSH, [sHigh]) };
  }

  const counts = new Map();
  for (const r of ranksDesc) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()]
    .map(([r, n]) => ({ r, n }))
    .sort((a, b) => b.n - a.n || b.r - a.r);

  const quads = groups.filter((g) => g.n === 4);
  const trips = groups.filter((g) => g.n === 3);
  const pairs = groups.filter((g) => g.n === 2);

  if (quads.length) {
    const kicker = ranksDesc.find((r) => r !== quads[0].r);
    const vals = [quads[0].r, kicker, 0, 0, 0];
    return { cat: CAT.QUADS, vals, score: encode(CAT.QUADS, vals) };
  }

  if (trips.length && (pairs.length || trips.length > 1)) {
    const tripRank = trips[0].r;
    const pairRank = pairs.length ? pairs[0].r : trips[1].r;
    const vals = [tripRank, pairRank, 0, 0, 0];
    return { cat: CAT.FULL_HOUSE, vals, score: encode(CAT.FULL_HOUSE, vals) };
  }

  if (isFlush) {
    const vals = ranksDesc.slice(0, 5);
    return { cat: CAT.FLUSH, vals, score: encode(CAT.FLUSH, vals) };
  }

  if (sHigh >= 0) {
    const vals = [sHigh, 0, 0, 0, 0];
    return { cat: CAT.STRAIGHT, vals, score: encode(CAT.STRAIGHT, vals) };
  }

  if (trips.length) {
    const kickers = ranksDesc.filter((r) => r !== trips[0].r).slice(0, 2);
    const vals = [trips[0].r, ...kickers];
    return { cat: CAT.TRIPS, vals, score: encode(CAT.TRIPS, vals) };
  }

  if (pairs.length === 2) {
    const [p1, p2] = pairs.map((p) => p.r);
    const kicker = ranksDesc.find((r) => r !== p1 && r !== p2);
    const vals = [p1, p2, kicker, 0, 0];
    return { cat: CAT.TWO_PAIR, vals, score: encode(CAT.TWO_PAIR, vals) };
  }

  if (pairs.length === 1) {
    const pairRank = pairs[0].r;
    const kickers = ranksDesc.filter((r) => r !== pairRank).slice(0, 3);
    const vals = [pairRank, ...kickers];
    return { cat: CAT.PAIR, vals, score: encode(CAT.PAIR, vals) };
  }

  const vals = ranksDesc.slice(0, 5);
  return { cat: CAT.HIGH_CARD, vals, score: encode(CAT.HIGH_CARD, vals) };
}

function combinations5(cards) {
  const out = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return out;
}

function evaluate7(cards) {
  if (cards.length !== 7) throw new Error('evaluate7 需要正好 7 张牌');
  let best = null;
  for (const combo of combinations5(cards)) {
    const ev = evaluate5(combo);
    if (!best || ev.score > best.score) {
      best = { cat: ev.cat, vals: ev.vals, score: ev.score, cards: combo };
    }
  }
  return best;
}

function handName(ev) {
  if (!ev) return '';
  if (ev.cat === CAT.STRAIGHT_FLUSH && ev.vals[0] === 12) return '皇家同花顺';
  if (ev.cat === CAT.STRAIGHT_FLUSH && ev.vals[0] === 3) return '同花顺（A2345）';
  return CAT_NAMES[ev.cat];
}

module.exports = { CAT, CAT_NAMES, evaluate5, evaluate7, handName, combinations5 };
