'use strict';

// 牌用 0..51 的整数表示：rank = c % 13（0=2 ... 12=A），suit = c / 13（0=♠ 1=♥ 2=♦ 3=♣）

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = ['黑桃', '红桃', '方块', '梅花'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck = [];
  for (let c = 0; c < 52; c++) deck.push(c);
  return deck;
}

function shuffle(deck, rand = Math.random) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
  return deck;
}

function rankOf(card) {
  return card % 13;
}

function suitOf(card) {
  return (card / 13) | 0;
}

function cardText(card) {
  return RANKS[rankOf(card)] + SUITS[suitOf(card)];
}

module.exports = { SUITS, SUIT_NAMES, RANKS, createDeck, shuffle, rankOf, suitOf, cardText };
