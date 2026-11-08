'use strict';

// 升盲规则：手数 / 时间 二选一，按级数计算盲注。
// 只做纯计算，不碰房间状态，方便单元测试和以后复用。

const MODES = ['off', 'hands', 'time'];
const FACTORS = [1.25, 1.5, 2];
const MAX_BIG_BLIND = 200000;
const MAX_SMALL_BLIND = Math.floor(MAX_BIG_BLIND / 2);

const DEFAULT_BLIND_CONFIG = {
  mode: 'off', // off | hands | time
  everyHands: 10, // 仅 hands 模式
  everyMinutes: 10, // 仅 time 模式
  factor: 1.5,
};

function roundTo5(n) {
  return Math.round(n / 5) * 5;
}

// 第 level 级的盲注（level 从 1 开始；第 1 级就是开局盲注）
function blindsForLevel(baseSmallBlind, factor, level) {
  let sb = Math.max(1, Math.floor(Number(baseSmallBlind) || 1));
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  const f = Number(factor) > 0 ? Number(factor) : 1.5;
  for (let i = 1; i < lv; i++) {
    const next = Math.max(sb + 1, roundTo5(sb * f));
    sb = Math.min(next, Math.max(sb, MAX_SMALL_BLIND));
    if (sb >= MAX_SMALL_BLIND) break;
  }
  return { level: lv, smallBlind: sb, bigBlind: sb * 2 };
}

// 接下来 count 级（用于设置面板预览），从当前级开始
function blindSchedule(baseSmallBlind, factor, level, count = 3) {
  const out = [];
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  for (let i = 0; i < count; i++) out.push(blindsForLevel(baseSmallBlind, factor, lv + i));
  return out;
}

// hands 模式：已完成的整手牌数 → 当前级数
function levelForHands(completedHands, everyHands) {
  const done = Math.max(0, Math.floor(Number(completedHands) || 0));
  const every = Math.max(1, Math.floor(Number(everyHands) || 1));
  return Math.floor(done / every) + 1;
}

// time 模式：已进行毫秒数 → 当前级数
function levelForTime(elapsedMs, everyMinutes) {
  const ms = Math.max(0, Number(elapsedMs) || 0);
  const interval = Math.max(1, Number(everyMinutes) || 1) * 60 * 1000;
  return Math.floor(ms / interval) + 1;
}

function normalizeBlindConfig(cfg = {}) {
  return {
    mode: cfg.mode != null ? cfg.mode : DEFAULT_BLIND_CONFIG.mode,
    everyHands: cfg.everyHands != null ? Number(cfg.everyHands) : DEFAULT_BLIND_CONFIG.everyHands,
    everyMinutes: cfg.everyMinutes != null ? Number(cfg.everyMinutes) : DEFAULT_BLIND_CONFIG.everyMinutes,
    factor: cfg.factor != null ? Number(cfg.factor) : DEFAULT_BLIND_CONFIG.factor,
  };
}

// 校验并补默认值；非法时抛中文错误（和房间设置其他校验一致）
function validateBlindConfig(cfg = {}) {
  const next = normalizeBlindConfig(cfg);
  if (!MODES.includes(next.mode)) throw new Error('升盲模式无效');
  if (!FACTORS.includes(next.factor)) throw new Error('升盲倍率只能是 1.25、1.5 或 2');
  if (next.mode === 'hands') {
    if (!Number.isInteger(next.everyHands) || next.everyHands < 1 || next.everyHands > 50) {
      throw new Error('升盲手数必须是 1~50 之间的整数');
    }
  }
  if (next.mode === 'time') {
    if (!Number.isInteger(next.everyMinutes) || next.everyMinutes < 1 || next.everyMinutes > 120) {
      throw new Error('升盲时间必须是 1~120 分钟之间的整数');
    }
  }
  return next;
}

module.exports = {
  MODES,
  FACTORS,
  MAX_BIG_BLIND,
  DEFAULT_BLIND_CONFIG,
  roundTo5,
  blindsForLevel,
  blindSchedule,
  levelForHands,
  levelForTime,
  normalizeBlindConfig,
  validateBlindConfig,
};
