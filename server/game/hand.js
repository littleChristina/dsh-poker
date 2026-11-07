'use strict';

const { createDeck, shuffle, cardText } = require('./cards');
const { evaluate7, handName } = require('./evaluator');
const { buildPots } = require('./pots');

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const STREET_NAMES = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };
const SEATS = 8;

class Hand {
  constructor(opts) {
    this.players = opts.players
      .map((p) => ({
        id: p.id,
        seat: p.seat,
        name: p.name,
        startChips: p.chips,
        chips: p.chips,
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        cards: [],
        lastAction: null,
        hasActed: false,
        canRaise: true,
      }))
      .sort((a, b) => a.seat - b.seat);

    this.buttonSeat = opts.buttonSeat;
    this.smallBlind = opts.smallBlind;
    this.bigBlind = opts.bigBlind;
    this.handNo = opts.handNo || 1;
    this.deck = opts.deck ? opts.deck.slice() : shuffle(createDeck(), opts.rng || Math.random);
    this.actionTimeoutMs = (opts.actionTimeout || 30) * 1000;
    this.dealDelay = opts.dealDelay == null ? 800 : opts.dealDelay;

    this.onUpdate = opts.onUpdate || (() => {});
    this.onEnd = opts.onEnd || (() => {});
    this.onEvent = opts.onEvent || (() => {});
    this.isDisconnected = opts.isDisconnected || (() => false);

    this.board = [];
    this.street = 'preflop';
    this.currentBet = 0;
    this.lastRaiseSize = this.bigBlind;
    this.buttonSeat = opts.buttonSeat;
    this.smallBlindSeat = null;
    this.bigBlindSeat = null;
    this.actor = null;
    this.deadline = null;
    this.done = false;
    this.result = null;
    this.dealing = false;
    this.turnTimer = null;
    this.pendingTimer = null;
    this.startedAt = Date.now();
  }

  // ---------- 生命周期 ----------

  start() {
    this._postBlinds();
    this.onEvent(`—— 第 ${this.handNo} 手，盲注 ${this.smallBlind}/${this.bigBlind} ——`);
    for (let round = 0; round < 2; round++) {
      for (const p of this.players) p.cards.push(this.deck.pop());
    }
    this.street = 'preflop';
    this.currentBet = this.bigBlind;
    this.lastRaiseSize = this.bigBlind;
    for (const p of this.players) {
      p.hasActed = false;
      p.canRaise = true;
    }
    this.actor = this._firstPreflopActor();
    if (this.actor) this._armTimer();
    else this._completeBettingRound();
    this.onUpdate();
  }

  destroy() {
    clearTimeout(this.turnTimer);
    clearTimeout(this.pendingTimer);
  }

  // ---------- 盲注 ----------

  _postBlinds() {
    const sbSeat = this._sbSeat();
    const bbSeat = this._bbSeat();
    const sb = this._bySeat(sbSeat);
    const bb = this._bySeat(bbSeat);
    this.smallBlindSeat = sbSeat;
    this.bigBlindSeat = bbSeat;
    this._payBlind(sb, this.smallBlind);
    this._payBlind(bb, this.bigBlind);
    sb.lastAction = sb.allIn ? `小盲全下 ${sb.bet}` : `小盲 ${sb.bet}`;
    bb.lastAction = bb.allIn ? `大盲全下 ${bb.bet}` : `大盲 ${bb.bet}`;
    this.onEvent(`${sb.name} 小盲 ${sb.bet}${sb.allIn ? '（全下）' : ''}`);
    this.onEvent(`${bb.name} 大盲 ${bb.bet}${bb.allIn ? '（全下）' : ''}`);
  }

  _payBlind(p, want) {
    const amt = Math.min(want, p.chips);
    p.chips -= amt;
    p.bet += amt;
    p.totalBet += amt;
    if (p.chips === 0) p.allIn = true;
  }

  _sbSeat() {
    if (this.players.length === 2) return this.buttonSeat; // 单挑：按钮位就是小盲
    return this._nextSeat(this.buttonSeat);
  }

  _bbSeat() {
    if (this.players.length === 2) return this._nextSeat(this.buttonSeat);
    return this._nextSeat(this._sbSeat());
  }

  // ---------- 行动顺序 ----------

  _nextSeat(seat) {
    for (let i = 1; i <= SEATS; i++) {
      const s = (seat + i) % SEATS;
      if (this.players.some((p) => p.seat === s)) return s;
    }
    return null;
  }

  _firstPreflopActor() {
    const start = this.players.length === 2 ? this.buttonSeat : this._nextSeat(this.bigBlindSeat);
    return this._findActorFrom(start, true);
  }

  _firstPostflopSeat() {
    // 翻牌后：庄家左手边第一个（单挑时就是大盲）
    return this._nextSeat(this.buttonSeat);
  }

  _findActorFrom(seat, includeStart) {
    for (let i = includeStart ? 0 : 1; i < SEATS; i++) {
      const s = (seat + i) % SEATS;
      const p = this.players.find((x) => x.seat === s);
      if (p && this._needsAction(p)) return p;
    }
    return null;
  }

  _needsAction(p) {
    return !p.folded && !p.allIn && p.chips > 0 && (!p.hasActed || p.bet < this.currentBet);
  }

  // ---------- 对外 ----------

  legalFor(playerId) {
    if (this.done) return null;
    const p = this.actor;
    if (!p || p.id !== playerId) return null;
    const need = Math.max(0, this.currentBet - p.bet);
    const maxTo = p.bet + p.chips;
    const minToRaw = this.currentBet + this.lastRaiseSize;
    const minTo = Math.min(minToRaw, maxTo);
    const canRaise = p.canRaise && p.chips > need && maxTo > this.currentBet;
    return {
      fold: true,
      check: need === 0,
      call: need > 0 ? Math.min(need, p.chips) : 0,
      raise: canRaise
        ? { min: minTo, max: maxTo, allInOnly: maxTo < minToRaw }
        : null,
      maxRaiseTo: maxTo,
      minRaiseTo: minToRaw,
    };
  }

  act(playerId, action, amount) {
    if (this.done) throw new Error('本手牌已经结束');
    const p = this.actor;
    if (!p) throw new Error('当前没有等待中的行动');
    if (p.id !== playerId) throw new Error('还没轮到你行动');

    const legal = this.legalFor(playerId);
    if (action === 'raise') {
      if (!legal.raise) throw new Error('当前不能加注');
      const target = Number(amount);
      if (!Number.isInteger(target)) throw new Error('加注金额无效');
      if (target > legal.raise.max) throw new Error('筹码不足');
      if (target <= this.currentBet) throw new Error('加注必须高于当前注额');
      if (target < legal.raise.min && target !== legal.raise.max) {
        throw new Error(`至少加注到 ${legal.raise.min}`);
      }
    } else if (action === 'check') {
      if (!legal.check) throw new Error('面对下注时不能过牌');
    } else if (action === 'call') {
      if (legal.call <= 0) throw new Error('当前无需跟注');
    } else if (action !== 'fold') {
      throw new Error('未知操作');
    }

    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this._apply(p, action, amount);
    this.onEvent(`${p.name} ${p.lastAction}`);
    this._afterAction(p);
  }

  // 玩家离开时强制弃牌（可能不是他的行动回合）
  forceFold(playerId) {
    if (this.done) return;
    const p = this.players.find((x) => x.id === playerId);
    if (!p || p.folded) return;
    const wasActor = !!(this.actor && this.actor.id === playerId);
    p.folded = true;
    p.lastAction = '离开';
    this.onEvent(`${p.name} 离开牌桌，弃牌`);
    if (wasActor) {
      clearTimeout(this.turnTimer);
      this._afterAction(p);
    } else if (this._livePlayers().length <= 1) {
      this._endByFold();
    } else {
      this.onUpdate();
    }
  }

  hurry(ms = 3000) {
    if (!this.actor || this.done) return;
    clearTimeout(this.turnTimer);
    const wait = Math.max(300, Math.min(ms, 5000));
    this.deadline = Date.now() + wait;
    this.turnTimer = setTimeout(() => this._onTurnTimeout(), wait);
    this.onUpdate();
  }

  potTotal() {
    return this.players.reduce((sum, p) => sum + p.totalBet, 0);
  }

  // ---------- 内部 ----------

  _apply(p, action, amount) {
    const need = this.currentBet - p.bet;

    if (action === 'fold') {
      p.folded = true;
      p.lastAction = '弃牌';
    } else if (action === 'check') {
      p.lastAction = '过牌';
    } else if (action === 'call') {
      const pay = Math.min(need, p.chips);
      this._pay(p, pay);
      p.lastAction = p.allIn ? `跟注全下 ${pay}` : `跟注 ${pay}`;
    } else if (action === 'raise') {
      const target = Number(amount);
      const raiseBy = target - this.currentBet;
      this._pay(p, target - p.bet);
      this.currentBet = target;
      if (raiseBy >= this.lastRaiseSize) {
        this.lastRaiseSize = raiseBy;
        for (const q of this.players) {
          if (q.id === p.id || q.folded || q.allIn) continue;
          q.hasActed = false;
          q.canRaise = true;
        }
        p.lastAction = p.allIn ? `全下 ${target}` : `加注到 ${target}`;
      } else {
        // 不足最小加注的全下：不重新开放加注权
        for (const q of this.players) {
          if (q.id === p.id || q.folded || q.allIn) continue;
          if (q.hasActed) q.canRaise = false;
        }
        p.lastAction = `全下 ${target}`;
      }
    }

    p.hasActed = true;
    p.canRaise = false;
  }

  _pay(p, amount) {
    const amt = Math.max(0, Math.min(amount, p.chips));
    p.chips -= amt;
    p.bet += amt;
    p.totalBet += amt;
    if (p.chips === 0) p.allIn = true;
    return amt;
  }

  _afterAction(p) {
    this.actor = null;
    this.deadline = null;
    if (this.done) return;
    if (this._livePlayers().length <= 1) {
      this._endByFold();
      return;
    }
    const next = this._findActorFrom(p.seat, false);
    if (next) {
      this.actor = next;
      this._armTimer();
      this.onUpdate();
    } else {
      this._completeBettingRound();
    }
  }

  _completeBettingRound() {
    this.actor = null;
    this.deadline = null;
    clearTimeout(this.turnTimer);
    clearTimeout(this.pendingTimer);
    if (this.street === 'river') {
      this._showdown();
      return;
    }
    this.dealing = true;
    this.onUpdate();
    this.pendingTimer = setTimeout(() => this._dealNextStreet(), this.dealDelay);
  }

  _dealNextStreet() {
    if (this.done) return;
    const idx = STREETS.indexOf(this.street);
    this.street = STREETS[idx + 1];
    const count = this.street === 'flop' ? 3 : 1;
    for (let i = 0; i < count; i++) this.board.push(this.deck.pop());
    this.onEvent(`${STREET_NAMES[this.street]}：${this.board.map(cardText).join(' ')}`);

    this.currentBet = 0;
    this.lastRaiseSize = this.bigBlind;
    for (const p of this.players) {
      p.bet = 0;
      p.hasActed = false;
      p.canRaise = true;
    }

    const canAct = this.players.filter((p) => !p.folded && !p.allIn && p.chips > 0);
    this.dealing = false;

    if (canAct.length >= 2) {
      const actor = this._findActorFrom(this._firstPostflopSeat(), true);
      if (actor) {
        this.actor = actor;
        this._armTimer();
        this.onUpdate();
        return;
      }
    }

    this.onUpdate();
    this.pendingTimer = setTimeout(
      () => (this.street === 'river' ? this._showdown() : this._dealNextStreet()),
      this.dealDelay
    );
  }

  _endByFold() {
    if (this.done) return;
    clearTimeout(this.turnTimer);
    clearTimeout(this.pendingTimer);
    this.actor = null;
    this.deadline = null;
    const live = this._livePlayers();
    if (!live.length) return;
    const winner = live[0];
    const amount = this.potTotal();
    winner.chips += amount;
    this.result = {
      reason: 'fold',
      board: this.board.slice(),
      reveals: [],
      pots: [{ amount, winnerIds: [winner.id], handName: '' }],
      winnings: { [winner.id]: amount },
      refunds: {},
      net: Object.fromEntries(this.players.map((p) => [p.id, p.chips - p.startChips])),
    };
    this.onEvent(`${winner.name} 赢得底池 ${amount}（其余玩家弃牌）`);
    this.done = true;
    this.onUpdate();
    this.onEnd(this.result);
  }

  _showdown() {
    if (this.done) return;
    clearTimeout(this.turnTimer);
    clearTimeout(this.pendingTimer);
    this.actor = null;
    this.deadline = null;

    const live = this._livePlayers();
    const evals = live.map((p) => ({ p, ev: evaluate7(p.cards.concat(this.board)) }));
    const { pots, refunds } = buildPots(
      this.players.map((p) => ({ id: p.id, amount: p.totalBet, folded: p.folded }))
    );
    const order = this._seatOrderFromButton();
    const winnings = {};

    for (const [pid, amt] of refunds) {
      const p = this._byId(pid);
      p.chips += amt;
      winnings[pid] = (winnings[pid] || 0) + amt;
      this.onEvent(`${p.name} 退回未被跟注的 ${amt}`);
    }

    const potResults = [];
    for (const pot of pots) {
      const contenders = evals.filter((e) => pot.eligible.includes(e.p.id));
      if (!contenders.length) continue;
      const best = Math.max(...contenders.map((e) => e.ev.score));
      const winners = contenders
        .filter((e) => e.ev.score === best)
        .sort((a, b) => order.indexOf(a.p.id) - order.indexOf(b.p.id));
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const w of winners) {
        w.p.chips += share;
        winnings[w.p.id] = (winnings[w.p.id] || 0) + share;
      }
      for (let i = 0; i < remainder; i++) {
        const w = winners[i % winners.length];
        w.p.chips += 1;
        winnings[w.p.id] = (winnings[w.p.id] || 0) + 1;
      }
      potResults.push({
        amount: pot.amount,
        winnerIds: winners.map((w) => w.p.id),
        handName: handName(winners[0].ev),
        score: best,
      });
    }

    const reveals = evals.map((e) => ({
      id: e.p.id,
      name: e.p.name,
      seat: e.p.seat,
      cards: e.p.cards.slice(),
      handName: handName(e.ev),
      score: e.ev.score,
      bestCards: e.ev.cards.slice(),
    }));

    this.result = {
      reason: 'showdown',
      board: this.board.slice(),
      reveals,
      pots: potResults,
      winnings,
      refunds: Object.fromEntries(refunds),
      net: Object.fromEntries(this.players.map((p) => [p.id, p.chips - p.startChips])),
    };

    for (const r of reveals) {
      this.onEvent(`${r.name} 亮牌 ${r.cards.map(cardText).join(' ')}（${r.handName}）`);
    }
    for (const pr of potResults) {
      const names = pr.winnerIds.map((id) => this._byId(id).name).join('、');
      const split = pr.winnerIds.length > 1 ? '，平分' : '';
      this.onEvent(`底池 ${pr.amount} → ${names}（${pr.handName}${split}）`);
    }

    this.done = true;
    this.onUpdate();
    this.onEnd(this.result);
  }

  // ---------- 计时 ----------

  _armTimer() {
    clearTimeout(this.turnTimer);
    if (!this.actor) return;
    const short = this.isDisconnected(this.actor.id);
    const ms = short ? Math.min(3000, this.actionTimeoutMs) : this.actionTimeoutMs;
    this.deadline = Date.now() + ms;
    this.turnTimer = setTimeout(() => this._onTurnTimeout(), ms);
  }

  _onTurnTimeout() {
    if (this.done || !this.actor) return;
    const p = this.actor;
    const legal = this.legalFor(p.id);
    this.turnTimer = null;
    if (!legal) return;
    if (legal.check) {
      this._apply(p, 'check');
      this.onEvent(`${p.name} 超时，自动过牌`);
    } else {
      this._apply(p, 'fold');
      this.onEvent(`${p.name} 超时，自动弃牌`);
    }
    this._afterAction(p);
  }

  // ---------- 工具 ----------

  _livePlayers() {
    return this.players.filter((p) => !p.folded);
  }

  _byId(id) {
    return this.players.find((p) => p.id === id);
  }

  _bySeat(seat) {
    return this.players.find((p) => p.seat === seat);
  }

  _seatOrderFromButton() {
    const out = [];
    for (let i = 1; i <= SEATS; i++) {
      const s = (this.buttonSeat + i) % SEATS;
      const p = this.players.find((x) => x.seat === s);
      if (p) out.push(p.id);
    }
    return out;
  }
}

module.exports = { Hand, STREETS, SEATS };
