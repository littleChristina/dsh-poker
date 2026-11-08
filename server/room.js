'use strict';

const crypto = require('crypto');
const { Hand, SEATS } = require('./game/hand');
const { blindsForLevel, levelForHands, levelForTime, validateBlindConfig } = require('./game/blinds');
const logger = require('./util/logger');

const DEFAULT_CONFIG = {
  smallBlind: 10,
  bigBlind: 20,
  startingChips: 2000,
  actionTimeout: 30,
  blindUpMode: 'off', // off | hands | time
  blindUpEveryHands: 10,
  blindUpEveryMinutes: 10,
  blindFactor: 1.5,
};

const NEXT_HAND_DELAY = 9000; // 结算展示（赢家最佳五张）时长
const MAX_LOG = 120;

function randomId() {
  return 'p' + crypto.randomBytes(5).toString('hex');
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

class Room {
  constructor(code, hub, opts = {}) {
    this.code = code;
    this.hub = hub;
    // 可注入时钟，方便测试时间升盲（默认真实时间）
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    // 测试用：缩短发牌动画等待
    this._dealDelay = typeof opts.dealDelay === 'number' ? opts.dealDelay : undefined;
    this.createdAt = Date.now();
    this.hostId = null;
    this.config = { ...DEFAULT_CONFIG };
    this.players = []; // 按座位排序
    this.phase = 'waiting'; // waiting | playing | handover
    this.hand = null;
    this.handNo = 0;
    this.buttonSeat = null;
    this.result = null;
    this.gameOver = false;
    this.log = [];
    this.nextHandAt = null;
    this._nextTimer = null;
    this.lastActivity = Date.now();
    // 升盲状态
    this.gameStartedAt = null;
    this.completedHands = 0;
    this.blindLevel = 1;
    this.currentBlinds = {
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
    };
  }

  // ---------- 玩家管理 ----------

  findSeat() {
    for (let s = 0; s < SEATS; s++) {
      if (!this.players.some((p) => p.seat === s)) return s;
    }
    return null;
  }

  addPlayer(name) {
    const seat = this.findSeat();
    if (seat == null) throw new Error('房间已满');
    const clean = String(name || '').trim().slice(0, 12) || '玩家';
    const p = {
      id: randomId(),
      token: randomToken(),
      name: clean,
      seat,
      chips: this.config.startingChips,
      connected: true,
      ready: false,
      leaving: false,
      joinedAt: Date.now(),
    };
    this.players.push(p);
    this.players.sort((a, b) => a.seat - b.seat);
    if (!this.hostId) this.hostId = p.id;
    this.lastActivity = Date.now();
    this.pushLog(`${p.name} 加入了房间`);
    return p;
  }

  findByToken(token) {
    return this.players.find((p) => p.token === token) || null;
  }

  findById(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  setConnected(playerId, val) {
    const p = this.findById(playerId);
    if (!p) return;
    if (p.connected === val) return;
    p.connected = val;
    this.lastActivity = Date.now();
    if (!val) {
      this.pushLog(`${p.name} 的连接断开了`);
      if (this.phase === 'playing' && this.hand) this.hand.hurry(3000);
      else this.broadcast();
    } else {
      this.pushLog(`${p.name} 重新连接`);
      this.broadcast();
    }
  }

  setReady(playerId, val) {
    const p = this.findById(playerId);
    if (!p) throw new Error('玩家不存在');
    if (this.phase !== 'waiting') throw new Error('牌局进行中');
    p.ready = !!val;
    this.lastActivity = Date.now();
    this.broadcast();
  }

  updateConfig(playerId, cfg) {
    if (playerId !== this.hostId) throw new Error('只有房主可以修改设置');
    if (this.phase !== 'waiting') throw new Error('牌局进行中不能修改设置');
    const next = { ...this.config };
    const num = (v, min, max, name) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        throw new Error(`${name}必须是 ${min}~${max} 之间的整数`);
      }
      return n;
    };
    if (cfg.smallBlind != null) next.smallBlind = num(cfg.smallBlind, 1, 100000, '小盲');
    if (cfg.bigBlind != null) next.bigBlind = num(cfg.bigBlind, 2, 200000, '大盲');
    if (cfg.startingChips != null) next.startingChips = num(cfg.startingChips, 100, 1000000, '初始筹码');
    if (cfg.actionTimeout != null) next.actionTimeout = num(cfg.actionTimeout, 5, 120, '思考时间');
    if (
      cfg.blindUpMode != null ||
      cfg.blindUpEveryHands != null ||
      cfg.blindUpEveryMinutes != null ||
      cfg.blindFactor != null
    ) {
      const bc = validateBlindConfig({
        mode: cfg.blindUpMode != null ? cfg.blindUpMode : next.blindUpMode,
        everyHands: cfg.blindUpEveryHands != null ? cfg.blindUpEveryHands : next.blindUpEveryHands,
        everyMinutes: cfg.blindUpEveryMinutes != null ? cfg.blindUpEveryMinutes : next.blindUpEveryMinutes,
        factor: cfg.blindFactor != null ? cfg.blindFactor : next.blindFactor,
      });
      next.blindUpMode = bc.mode;
      next.blindUpEveryHands = bc.everyHands;
      next.blindUpEveryMinutes = bc.everyMinutes;
      next.blindFactor = bc.factor;
    }
    if (next.bigBlind <= next.smallBlind) throw new Error('大盲必须大于小盲');
    if (next.startingChips < next.bigBlind * 10) throw new Error('初始筹码至少为大盲的 10 倍');
    this.config = next;
    for (const p of this.players) {
      if (this.phase === 'waiting' && !this.gameOver) p.chips = next.startingChips;
    }
    this.lastActivity = Date.now();
    this.broadcast();
  }

  // ---------- 开始 / 下一手 ----------

  start(playerId) {
    if (playerId !== this.hostId) throw new Error('只有房主可以开始游戏');
    if (this.phase !== 'waiting') throw new Error('牌局已经开始了');
    if (this.players.length < 2) throw new Error('至少需要 2 名玩家');
    for (const p of this.players) {
      if (p.id !== this.hostId && !p.ready) throw new Error(`${p.name} 还没有准备`);
    }
    for (const p of this.players) {
      p.chips = this.config.startingChips;
      p.ready = false;
      p.leaving = false;
    }
    this.gameOver = false;
    this.result = null;
    this.handNo = 0;
    this.completedHands = 0;
    this.blindLevel = 1;
    this.currentBlinds = {
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
    };
    this.gameStartedAt = this.now();
    const startIdx = crypto.randomInt(this.players.length);
    this.buttonSeat = this.players[startIdx].seat;
    this.pushLog('游戏开始！');
    if (this.config.blindUpMode === 'hands') {
      this.pushLog(`升盲模式：每 ${this.config.blindUpEveryHands} 手升一级（×${this.config.blindFactor}）`);
    } else if (this.config.blindUpMode === 'time') {
      this.pushLog(`升盲模式：每 ${this.config.blindUpEveryMinutes} 分钟升一级（×${this.config.blindFactor}）`);
    }
    this._startHand(true);
  }

  _startHand(first) {
    clearTimeout(this._nextTimer);
    this._nextTimer = null;
    this.nextHandAt = null;

    // 移除中途离开和筹码耗尽的玩家
    const before = this.players.length;
    this.players = this.players.filter((p) => {
      if (p.leaving) {
        this.pushLog(`${p.name} 离开了牌桌`);
        return false;
      }
      if (p.chips <= 0) {
        this.pushLog(`${p.name} 筹码耗尽，离开牌桌`);
        return false;
      }
      return true;
    });
    if (this.players.length !== before && !this.findById(this.hostId)) {
      this.hostId = this.players.length ? this.players[0].id : null;
      if (this.hostId) this.pushLog(`${this.findById(this.hostId).name} 成为新房主`);
    }

    if (this.players.length < 2) {
      this.phase = 'waiting';
      this.gameOver = true;
      this.hand = null;
      this.result = null;
      this.pushLog('人数不足，牌局结束');
      this.broadcast();
      return;
    }

    this._refreshBlinds();
    if (!first) this._advanceButton();
    this.handNo += 1;
    this.result = null;
    this.phase = 'playing';
    if (this.hand) this.hand.destroy(); // 防御：旧手若还有定时器，一并清掉
    this.hand = new Hand({
      players: this.players.map((p) => ({ id: p.id, seat: p.seat, name: p.name, chips: p.chips })),
      buttonSeat: this.buttonSeat,
      smallBlind: this.currentBlinds.smallBlind,
      bigBlind: this.currentBlinds.bigBlind,
      handNo: this.handNo,
      actionTimeout: this.config.actionTimeout,
      dealDelay: this._dealDelay,
      onUpdate: () => this.broadcast(),
      onEnd: (res) => this._onHandEnd(res),
      onEvent: (text) => this.pushLog(text),
      isDisconnected: (id) => {
        const pl = this.findById(id);
        return pl ? !pl.connected : true;
      },
    });
    this.lastActivity = Date.now();
    this.pushLog(`—— 第 ${this.handNo} 手开始 ——`);
    this.hand.start();
    this.broadcast();
    logger.info(`[房间 ${this.code}] 第 ${this.handNo} 手开始，${this.players.length} 人`);
  }

  // ---------- 升盲 ----------

  // 当前应处的级数（hands 按已完成手数，time 按开局到现在的时间）
  _currentLevel(now = this.now()) {
    const c = this.config;
    if (c.blindUpMode === 'hands') {
      return levelForHands(this.completedHands, c.blindUpEveryHands);
    }
    if (c.blindUpMode === 'time') {
      if (!this.gameStartedAt) return 1;
      return levelForTime(now - this.gameStartedAt, c.blindUpEveryMinutes);
    }
    return 1;
  }

  // 某一级的盲注；第 1 级保留房间设置里的原始大小盲
  _levelBlinds(level) {
    const c = this.config;
    if (level <= 1) return { smallBlind: c.smallBlind, bigBlind: c.bigBlind };
    const b = blindsForLevel(c.smallBlind, c.blindFactor, level);
    return { smallBlind: b.smallBlind, bigBlind: b.bigBlind };
  }

  // 在发下一手前调用：计算并应用当前级数，升级时写日志
  _refreshBlinds(now = this.now()) {
    const level = this._currentLevel(now);
    const b = this._levelBlinds(level);
    if (level > this.blindLevel) {
      const up = level - this.blindLevel;
      this.pushLog(
        `盲注升级：${b.smallBlind} / ${b.bigBlind}（第 ${level} 级${up > 1 ? `，连升 ${up} 级` : ''}）`
      );
    }
    this.blindLevel = level;
    this.currentBlinds = b;
  }

  _advanceButton() {
    const seats = this.players.map((p) => p.seat).sort((a, b) => a - b);
    if (!seats.length) return;
    const next = seats.find((s) => s > this.buttonSeat);
    this.buttonSeat = next == null ? seats[0] : next;
  }

  _onHandEnd(result) {
    this.completedHands += 1;
    // 把本手结束后的筹码同步回房间玩家
    if (this.hand) {
      for (const hp of this.hand.players) {
        const p = this.findById(hp.id);
        if (p) p.chips = hp.chips;
      }
    }
    this.result = result;
    this.phase = 'handover';
    this.pushLog('—— 本手结束 ——');

    const alive = this.players.filter((p) => !p.leaving && p.chips > 0);
    if (alive.length < 2) {
      this.gameOver = true;
      this.phase = 'waiting';
      this.nextHandAt = null;
      this.pushLog('牌局结束，回到等待区');
      this.broadcast();
      return;
    }

    this.nextHandAt = Date.now() + NEXT_HAND_DELAY;
    this.broadcast();
    this._nextTimer = setTimeout(() => {
      if (this.phase === 'handover') this._startHand(false);
    }, NEXT_HAND_DELAY);
  }

  // ---------- 操作 ----------

  act(playerId, action, amount) {
    if (this.phase !== 'playing' || !this.hand) throw new Error('现在没有进行中的牌局');
    this.hand.act(playerId, action, amount);
    this.lastActivity = Date.now();
  }

  leave(playerId) {
    const p = this.findById(playerId);
    if (!p) return;
    this.lastActivity = Date.now();
    if (this.phase === 'playing' && this.hand) {
      p.leaving = true;
      p.connected = false;
      this.hand.forceFold(playerId);
      this.broadcast();
    } else {
      this.pushLog(`${p.name} 离开了房间`);
      this.hub.event(this, 'left', { playerId });
      this.players = this.players.filter((x) => x.id !== playerId);
      if (this.hostId === playerId) {
        this.hostId = this.players.length ? this.players[0].id : null;
        if (this.hostId) this.pushLog(`${this.findById(this.hostId).name} 成为新房主`);
      }
      this.broadcast();
    }
  }

  // ---------- 工具 ----------

  pushLog(text) {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${text}`;
    this.log.push(line);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  broadcast() {
    this.hub.broadcast(this);
  }

  isIdle(now) {
    return this.players.length === 0 && now - this.lastActivity > 10 * 60 * 1000;
  }

  destroy() {
    clearTimeout(this._nextTimer);
    if (this.hand) this.hand.destroy();
  }
}

module.exports = { Room, DEFAULT_CONFIG, SEATS };
