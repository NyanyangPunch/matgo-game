import { createDeck, describeCard } from "./cards.js";
import { scoreCaptured } from "./scoring.js";

const PLAYER = "player";
const CPU = "cpu";

export function createGame() {
  const deck = shuffle(createDeck());
  const state = {
    hands: { player: [], cpu: [] },
    field: [],
    deck: [],
    captured: { player: [], cpu: [] },
    turn: PLAYER,
    selected: null,
    pendingChoice: null,
    gameOver: false,
    winner: null,
    message: "당신의 차례입니다. 손패를 골라주세요.",
    logs: [],
  };

  for (let i = 0; i < 10; i += 1) {
    state.hands.player.push(deck.pop());
    state.hands.cpu.push(deck.pop());
  }
  for (let i = 0; i < 8; i += 1) {
    state.field.push(deck.pop());
  }
  state.deck = deck;
  state.logs.push("새 판을 시작했습니다.");
  return state;
}

export function playPlayerCard(state, cardId) {
  if (state.gameOver || state.turn !== PLAYER || state.pendingChoice) return state;
  const handCard = state.hands.player.find((card) => card.id === cardId);
  if (!handCard) return state;
  return playCard(state, PLAYER, handCard);
}

export function resolveChoice(state, fieldCardId) {
  const pending = state.pendingChoice;
  if (!pending || state.gameOver) return state;

  const target = state.field.find((card) => card.id === fieldCardId);
  if (!target || target.month !== pending.played.month) return state;

  state.pendingChoice = null;
  captureSpecific(state, pending.owner, pending.played, target);
  drawAndResolve(state, pending.owner);
  finishTurn(state, pending.owner);
  return state;
}

export function cpuTurn(state) {
  if (state.gameOver || state.turn !== CPU || state.pendingChoice) return state;
  const card = chooseCpuCard(state);
  playCard(state, CPU, card);

  if (state.pendingChoice) {
    const candidates = state.field.filter(
      (fieldCard) => fieldCard.month === state.pendingChoice.played.month,
    );
    const target = candidates.sort(compareCardValue).at(-1);
    resolveChoice(state, target.id);
  }

  return state;
}

export function declareStop(state) {
  if (!state.gameOver && state.turn === PLAYER && canDeclare(state, PLAYER)) {
    endGame(state, PLAYER, "스톱을 선언했습니다.");
  }
  return state;
}

export function declareGo(state) {
  if (!state.gameOver && state.turn === PLAYER && canDeclare(state, PLAYER)) {
    state.logs.unshift("당신이 고를 선언했습니다.");
    state.message = "고를 선언했습니다. 계속 진행하세요.";
  }
  return state;
}

export function canDeclare(state, owner) {
  return scoreCaptured(state.captured[owner]).total >= 7;
}

function playCard(state, owner, card) {
  removeById(state.hands[owner], card.id);
  const label = owner === PLAYER ? "당신" : "컴퓨터";
  state.logs.unshift(`${label}: ${describeCard(card)} 냈습니다.`);

  const matches = state.field.filter((fieldCard) => fieldCard.month === card.month);
  if (matches.length === 0) {
    state.field.push(card);
    drawAndResolve(state, owner);
    finishTurn(state, owner);
  } else if (matches.length === 1) {
    captureSpecific(state, owner, card, matches[0]);
    drawAndResolve(state, owner);
    finishTurn(state, owner);
  } else if (matches.length === 2) {
    state.pendingChoice = { owner, played: card };
    state.message =
      owner === PLAYER
        ? "같은 월 카드가 2장 있습니다. 먹을 카드를 선택하세요."
        : "컴퓨터가 먹을 카드를 고르는 중입니다.";
  } else {
    captureMany(state, owner, [card, ...matches]);
    drawAndResolve(state, owner);
    finishTurn(state, owner);
  }

  return state;
}

function drawAndResolve(state, owner) {
  if (state.deck.length === 0) return;
  const drawn = state.deck.pop();
  const label = owner === PLAYER ? "당신" : "컴퓨터";
  state.logs.unshift(`${label}: 더미에서 ${describeCard(drawn)} 뒤집었습니다.`);

  const matches = state.field.filter((fieldCard) => fieldCard.month === drawn.month);
  if (matches.length === 0) {
    state.field.push(drawn);
  } else {
    captureMany(state, owner, [drawn, ...matches]);
  }
}

function captureSpecific(state, owner, played, target) {
  removeById(state.field, target.id);
  captureMany(state, owner, [played, target]);
}

function captureMany(state, owner, cards) {
  for (const card of cards) {
    removeById(state.field, card.id);
  }
  state.captured[owner].push(...cards);
  const label = owner === PLAYER ? "당신" : "컴퓨터";
  state.logs.unshift(`${label}: ${cards.map(describeCard).join(", ")} 획득.`);
}

function finishTurn(state, owner) {
  if (state.gameOver) return;

  const score = scoreCaptured(state.captured[owner]).total;
  if (owner === CPU && score >= 7) {
    endGame(state, CPU, "컴퓨터가 스톱을 선언했습니다.");
    return;
  }

  if (state.hands.player.length === 0 || state.hands.cpu.length === 0) {
    const playerScore = scoreCaptured(state.captured.player).total;
    const cpuScore = scoreCaptured(state.captured.cpu).total;
    if (playerScore === cpuScore) {
      state.gameOver = true;
      state.winner = "draw";
      state.message = "동점으로 판이 끝났습니다.";
      state.logs.unshift("동점으로 종료되었습니다.");
    } else {
      endGame(
        state,
        playerScore > cpuScore ? PLAYER : CPU,
        "손패를 모두 사용해서 판이 끝났습니다.",
      );
    }
    return;
  }

  state.turn = owner === PLAYER ? CPU : PLAYER;
  state.message =
    state.turn === PLAYER
      ? "당신의 차례입니다. 손패를 골라주세요."
      : "컴퓨터가 생각하는 중입니다.";
}

function endGame(state, winner, reason) {
  state.gameOver = true;
  state.winner = winner;
  const label = winner === PLAYER ? "당신의 승리" : "컴퓨터의 승리";
  state.message = `${label}! ${reason}`;
  state.logs.unshift(`${label}: ${reason}`);
}

function chooseCpuCard(state) {
  return [...state.hands.cpu].sort((a, b) => {
    const aMatches = state.field.filter((card) => card.month === a.month).length;
    const bMatches = state.field.filter((card) => card.month === b.month).length;
    if (aMatches !== bMatches) return bMatches - aMatches;
    return compareCardValue(a, b);
  })[0];
}

function compareCardValue(a, b) {
  return cardValue(a) - cardValue(b);
}

function cardValue(card) {
  if (card.kind === "bright") return 5;
  if (card.kind === "animal") return 4;
  if (card.kind === "ribbon") return 3;
  if (card.pi === 2) return 2;
  return 1;
}

function removeById(cards, id) {
  const index = cards.findIndex((card) => card.id === id);
  if (index >= 0) cards.splice(index, 1);
}

function shuffle(cards) {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
