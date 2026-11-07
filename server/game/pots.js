'use strict';

// 根据每人本手牌的总投入构建主池 / 边池。
// contribs: [{ id, amount, folded }]
// 返回 { pots: [{ amount, eligible: [id...] }], refunds: Map<id, number> }
// 未被跟注的多余筹码（最高投入者只有一人时超出第二名的部分）原样退回。
function buildPots(contribs) {
  const list = contribs
    .filter((c) => c.amount > 0)
    .map((c) => ({ id: c.id, amount: c.amount, folded: !!c.folded }));

  const refunds = new Map();

  if (list.length) {
    const sorted = [...list].sort((a, b) => b.amount - a.amount);
    const top = sorted[0];
    const second = sorted[1] ? sorted[1].amount : 0;
    const sameTop = list.filter((c) => c.amount === top.amount).length;
    // 只有一个人投入最多时，超出第二名的部分没人跟注，原样退回（即使他已经弃牌）
    if (sameTop === 1 && top.amount > second) {
      refunds.set(top.id, top.amount - second);
      top.amount = second;
    }
  }

  const levels = [...new Set(list.map((c) => c.amount).filter((a) => a > 0))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;

  for (const level of levels) {
    let amount = 0;
    for (const c of list) {
      amount += Math.min(c.amount, level) - Math.min(c.amount, prev);
    }
    const eligible = list.filter((c) => !c.folded && c.amount >= level).map((c) => c.id);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      if (last && sameSet(last.eligible, eligible)) {
        last.amount += amount;
      } else {
        pots.push({ amount, eligible });
      }
    }
    prev = level;
  }

  return { pots, refunds };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

module.exports = { buildPots };
