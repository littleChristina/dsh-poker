'use strict';

const { SEATS } = require('./game/hand');

// 生成某个玩家视角的房间状态快照（底牌只给本人或摊牌时公开）
function publicState(room, playerId) {
  const now = typeof room.now === 'function' ? room.now() : Date.now();
  const hand = room.hand;
  const handPlayers = new Map(hand ? hand.players.map((p) => [p.id, p]) : []);
  const result = room.result;
  const revealById = new Map(result && result.reveals ? result.reveals.map((r) => [r.id, r]) : []);
  const winnings = result && result.winnings ? result.winnings : {};
  const refunds = result && result.refunds ? result.refunds : {};

  const me = room.findById(playerId);
  const isSpectator = !!(me && me.role === 'spectator');
  const seeAllCards = isSpectator && room.config.spectatorCards === true;

  const seats = [];
  for (let s = 0; s < SEATS; s++) {
    const player = room.players.find((p) => p.seat === s);
    if (!player) {
      seats.push({ seat: s, empty: true });
      continue;
    }
    const hp = handPlayers.get(player.id);
    const reveal = revealById.get(player.id);
    const entry = {
      seat: s,
      empty: false,
      id: player.id,
      name: player.name,
      chips: hp ? hp.chips : player.chips,
      bet: hp ? hp.bet : 0,
      totalBet: hp ? hp.totalBet : 0,
      folded: hp ? hp.folded : false,
      allIn: hp ? hp.allIn : false,
      lastAction: hp ? hp.lastAction : null,
      connected: player.connected,
      ready: player.ready,
      leaving: player.leaving,
      isHost: player.id === room.hostId,
      isYou: player.id === playerId,
      isDealer: !!(hand && hand.buttonSeat === s),
      isSmallBlind: !!(hand && hand.smallBlindSeat === s),
      isBigBlind: !!(hand && hand.bigBlindSeat === s),
      won: Math.max(0, (winnings[player.id] || 0) - (refunds[player.id] || 0)),
      cards: null,
      handName: null,
    };
    if (hp && (player.id === playerId || seeAllCards)) entry.cards = hp.cards.slice();
    if (reveal) {
      entry.cards = reveal.cards.slice();
      entry.handName = reveal.handName;
    }
    seats.push(entry);
  }

  const myHandPlayer = me ? handPlayers.get(me.id) : null;
  let legal = null;
  if (!isSpectator && hand && !hand.done && hand.actor && hand.actor.id === playerId) {
    legal = hand.legalFor(playerId);
  }

  const spectators = room.players
    .filter((p) => p.role === 'spectator')
    .map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.id === room.hostId,
      isYou: p.id === playerId,
    }));

  // 升盲：当前生效级别 + 下一手将生效的盲注 + 升级进度
  const blindUpMode = room.config.blindUpMode;
  const levelNow = room._currentLevel(now);
  const nextLevel = Math.max(room.blindLevel + 1, levelNow);
  const nextB = room._levelBlinds(nextLevel);
  const everyMs = room.config.blindUpEveryMinutes * 60 * 1000;
  const handsUntilUpgrade =
    blindUpMode === 'hands'
      ? Math.max(1, room.config.blindUpEveryHands - (room.completedHands % room.config.blindUpEveryHands))
      : null;
  const levelEndsAt =
    blindUpMode === 'time' && room.gameStartedAt ? room.gameStartedAt + levelNow * everyMs : null;

  return {
    serverTime: now,
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    config: room.config,
    blinds: {
      level: room.blindLevel,
      smallBlind: room.currentBlinds.smallBlind,
      bigBlind: room.currentBlinds.bigBlind,
    },
    nextBlinds: {
      level: nextLevel,
      smallBlind: nextB.smallBlind,
      bigBlind: nextB.bigBlind,
    },
    blindUp: {
      mode: blindUpMode,
      everyHands: room.config.blindUpEveryHands,
      everyMinutes: room.config.blindUpEveryMinutes,
      factor: room.config.blindFactor,
      handsUntilUpgrade,
      levelEndsAt,
    },
    handNo: room.handNo,
    street: hand ? hand.street : null,
    board: hand ? hand.board.slice() : result ? result.board.slice() : [],
    pot: hand ? hand.potTotal() : 0,
    currentBet: hand ? hand.currentBet : 0,
    actorId: hand && !hand.done && hand.actor ? hand.actor.id : null,
    actionTimeout: room.config.actionTimeout * 1000,
    deadlineIn: hand && hand.deadline ? Math.max(0, hand.deadline - now) : 0,
    nextHandIn: room.nextHandAt ? Math.max(0, room.nextHandAt - now) : null,
    gameOver: room.gameOver,
    result,
    spectatorCards: room.config.spectatorCards === true,
    spectators,
    you: me
      ? {
          id: me.id,
          name: me.name,
          role: me.role || 'player',
          seat: me.seat,
          chips: myHandPlayer ? myHandPlayer.chips : me.chips,
          cards: myHandPlayer ? myHandPlayer.cards.slice() : null,
          ready: me.ready,
          isHost: me.id === room.hostId,
          connected: me.connected,
          leaving: me.leaving,
          legal,
        }
      : null,
    players: seats,
    log: room.log.slice(-60),
  };
}

module.exports = { publicState };
