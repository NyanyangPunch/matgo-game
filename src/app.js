const KIND_LABELS = {
  bright: "광",
  ribbon: "띠",
  animal: "열",
  junk: "피",
  bonus: "쌍",
};

const MONTH_ART = ["송", "매", "벚", "흑", "난", "목", "홍", "공", "국", "단", "오", "비"];
const PLAYER = "player";
const CPU = "cpu";

const CARD_BLUEPRINTS = [
  ["bright", "송학"], ["ribbon", "홍단"], ["junk", "피"], ["junk", "피"],
  ["animal", "매조"], ["ribbon", "홍단"], ["junk", "피"], ["junk", "피"],
  ["bright", "벚꽃"], ["ribbon", "홍단"], ["junk", "피"], ["junk", "피"],
  ["animal", "흑싸리"], ["ribbon", "초단"], ["junk", "피"], ["junk", "피"],
  ["animal", "난초"], ["ribbon", "초단"], ["junk", "피"], ["junk", "쌍피", 2],
  ["animal", "목단"], ["ribbon", "청단"], ["junk", "피"], ["junk", "피"],
  ["animal", "멧돼지"], ["ribbon", "초단"], ["junk", "피"], ["junk", "피"],
  ["bright", "공산"], ["animal", "기러기"], ["junk", "피"], ["junk", "피"],
  ["animal", "술잔"], ["ribbon", "청단"], ["junk", "피"], ["junk", "쌍피", 2],
  ["animal", "사슴"], ["ribbon", "청단"], ["junk", "피"], ["junk", "피"],
  ["bright", "오동"], ["junk", "피"], ["junk", "피"], ["junk", "쌍피", 2],
  ["bright", "비광"], ["animal", "제비"], ["ribbon", "비띠"], ["junk", "쌍피", 2],
];

function createDeck() {
  return CARD_BLUEPRINTS.map(([kind, name, pi = kind === "junk" ? 1 : 0], index) => {
    const month = Math.floor(index / 4) + 1;
    return {
      id: `${month}-${index % 4}`,
      month,
      kind,
      name,
      pi,
      art: MONTH_ART[month - 1],
    };
  });
}

function describeCard(card) {
  return `${card.month}월 ${card.name}`;
}

function scoreCaptured(cards) {
  const bright = cards.filter((card) => card.kind === "bright");
  const ribbons = cards.filter((card) => card.kind === "ribbon");
  const animals = cards.filter((card) => card.kind === "animal");
  const pi = cards.reduce((sum, card) => sum + (card.pi || 0), 0);
  const hasRainBright = bright.some((card) => card.month === 12);
  const godori = [2, 4, 8].every((month) =>
    animals.some((card) => card.month === month),
  );

  const detail = [];
  let total = 0;

  if (bright.length === 3) {
    const points = hasRainBright ? 2 : 3;
    total += points;
    detail.push(`광 ${bright.length}장 ${points}점`);
  } else if (bright.length === 4) {
    total += 4;
    detail.push("광 4장 4점");
  } else if (bright.length === 5) {
    total += 15;
    detail.push("광 5장 15점");
  }

  if (ribbons.length >= 5) {
    const points = ribbons.length - 4;
    total += points;
    detail.push(`띠 ${ribbons.length}장 ${points}점`);
  }

  const red = [1, 2, 3].every((month) =>
    ribbons.some((card) => card.month === month),
  );
  const blue = [6, 9, 10].every((month) =>
    ribbons.some((card) => card.month === month),
  );
  const grass = [4, 5, 7].every((month) =>
    ribbons.some((card) => card.month === month),
  );

  if (red) total += pushDetail(detail, "홍단 3점", 3);
  if (blue) total += pushDetail(detail, "청단 3점", 3);
  if (grass) total += pushDetail(detail, "초단 3점", 3);

  if (animals.length >= 5) {
    const points = animals.length - 4;
    total += points;
    detail.push(`열끗 ${animals.length}장 ${points}점`);
  }
  if (godori) total += pushDetail(detail, "고도리 5점", 5);

  if (pi >= 10) {
    const points = pi - 9;
    total += points;
    detail.push(`피 ${pi}장 ${points}점`);
  }

  return {
    total,
    bright: bright.length,
    ribbons: ribbons.length,
    animals: animals.length,
    pi,
    detail,
  };
}

function pushDetail(detail, label, points) {
  detail.push(label);
  return points;
}

function createGame() {
  const deck = shuffle(createDeck());
  const state = {
    hands: { player: [], cpu: [] },
    field: [],
    deck: [],
    captured: { player: [], cpu: [] },
    turn: PLAYER,
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

function playPlayerCard(state, cardId) {
  if (state.gameOver || state.turn !== PLAYER || state.pendingChoice) return state;
  const handCard = state.hands.player.find((card) => card.id === cardId);
  if (!handCard) return state;
  return playCard(state, PLAYER, handCard);
}

function resolveChoice(state, fieldCardId) {
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

function cpuTurn(state) {
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

function declareStop(state) {
  if (!state.gameOver && state.turn === PLAYER && canDeclare(state, PLAYER)) {
    endGame(state, PLAYER, "스톱을 선언했습니다.");
  }
  return state;
}

function declareGo(state) {
  if (!state.gameOver && state.turn === PLAYER && canDeclare(state, PLAYER)) {
    state.logs.unshift("당신이 고를 선언했습니다.");
    state.message = "고를 선언했습니다. 계속 진행하세요.";
  }
  return state;
}

function canDeclare(state, owner) {
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
  for (const card of cards) removeById(state.field, card.id);
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

const app = document.querySelector("#app");
let state = createGame();
let cpuTimer = null;

function render() {
  const playerScore = scoreCaptured(state.captured.player);
  const cpuScore = scoreCaptured(state.captured.cpu);
  const playerCanDeclare = canDeclare(state, "player");

  app.innerHTML = `
    <section class="game-layout">
      <div class="table">
        ${renderOpponent()}
        <section class="field-zone">
          <div class="field">
            <div class="row-head">
              <div class="row-title">바닥패 <span class="badge">${state.field.length}</span></div>
            </div>
            <div class="cards">
              ${state.field.length ? state.field.map((card) => renderCard(card, "field")).join("") : `<div class="empty">바닥패 없음</div>`}
            </div>
          </div>
          <aside class="deck-panel">
            <div class="deck-card" aria-hidden="true"></div>
            <div>
              <strong>더미</strong>
              <div class="deck-count">${state.deck.length}장 남음</div>
            </div>
          </aside>
        </section>
        ${renderPlayer()}
      </div>

      <aside class="side-panel">
        <div class="brand">
          <h1>맞고 연습장</h1>
          <button class="new-game" data-action="new">새 판</button>
        </div>
        <div class="status">
          <strong>${escapeHtml(state.message)}</strong>
          <span>${state.gameOver ? "새 판을 눌러 다시 시작할 수 있습니다." : "기본 먹기와 점수 계산을 먼저 구현한 컴퓨터 대전 버전입니다."}</span>
        </div>
        <div class="score-grid">
          ${renderScore("당신", playerScore, state.turn === "player")}
          ${renderScore("컴퓨터", cpuScore, state.turn === "cpu")}
        </div>
        <div class="actions">
          <button class="action go" data-action="go" ${!playerCanDeclare || state.gameOver || state.turn !== "player" ? "disabled" : ""}>고</button>
          <button class="action stop" data-action="stop" ${!playerCanDeclare || state.gameOver || state.turn !== "player" ? "disabled" : ""}>스톱</button>
        </div>
        <div class="log">
          ${state.logs.slice(0, 18).map((entry) => `<div class="log-entry">${escapeHtml(entry)}</div>`).join("")}
        </div>
      </aside>
    </section>
    ${renderChoice()}
  `;

  scheduleCpu();
}

function renderOpponent() {
  const backs = state.hands.cpu
    .map((_, index) => `<div class="card back" title="컴퓨터 패 ${index + 1}"></div>`)
    .join("");
  return `
    <section class="row opponent">
      <div class="row-head">
        <div class="row-title">컴퓨터 손패 <span class="badge">${state.hands.cpu.length}</span></div>
        <div class="row-title">획득 <span class="badge">${state.captured.cpu.length}</span></div>
      </div>
      <div class="cards">${backs}</div>
    </section>
  `;
}

function renderPlayer() {
  return `
    <section class="row">
      <div class="row-head">
        <div class="row-title">내 손패 <span class="badge">${state.hands.player.length}</span></div>
        <div class="row-title">획득 <span class="badge">${state.captured.player.length}</span></div>
      </div>
      <div class="cards">
        ${state.hands.player.map((card) => renderCard(card, "hand")).join("")}
      </div>
    </section>
  `;
}

function renderCard(card, zone) {
  const playable =
    zone === "hand" && state.turn === "player" && !state.pendingChoice && !state.gameOver;
  const choose =
    state.pendingChoice?.owner === "player" &&
    zone === "choice" &&
    card.month === state.pendingChoice.played.month;
  const className = [
    "card",
    playable || choose ? "playable" : "",
    card.kind,
  ].join(" ");
  const action = playable ? `data-card="${card.id}"` : choose ? `data-choice="${card.id}"` : "";

  return `
    <button class="${className}" ${action} title="${card.month}월 ${escapeHtml(card.name)}">
      <span class="month">${card.month}월</span>
      <span class="art">${escapeHtml(card.art)}</span>
      <span class="kind ${card.kind}">${KIND_LABELS[card.kind]}</span>
      <span class="caption">${escapeHtml(card.name)}</span>
    </button>
  `;
}

function renderChoice() {
  if (!state.pendingChoice || state.pendingChoice.owner !== "player") return "";
  const choices = state.field.filter(
    (card) => card.month === state.pendingChoice.played.month,
  );
  return `
    <div class="choice-overlay">
      <div class="choice-box">
        <h2 class="choice-title">먹을 카드 선택</h2>
        <p class="choice-sub">${state.pendingChoice.played.month}월 카드 중 하나를 골라 가져갑니다.</p>
        <div class="choice-cards">
          ${choices.map((card) => renderCard(card, "choice")).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderScore(name, score, active) {
  const detail = score.detail.length ? score.detail : ["아직 점수 없음"];
  return `
    <section class="score-card ${active ? "active" : ""}">
      <div class="score-name">
        <span>${name}</span>
        <span>${active ? "차례" : ""}</span>
      </div>
      <div class="score-main">${score.total}</div>
      <div class="score-detail">
        <span>광 ${score.bright} · 띠 ${score.ribbons} · 열 ${score.animals} · 피 ${score.pi}</span>
        ${detail.slice(0, 4).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </section>
  `;
}

function scheduleCpu() {
  clearTimeout(cpuTimer);
  if (state.turn === "cpu" && !state.gameOver && !state.pendingChoice) {
    cpuTimer = setTimeout(() => {
      cpuTurn(state);
      render();
    }, 700);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.action === "new") {
    state = createGame();
  } else if (button.dataset.action === "go") {
    declareGo(state);
  } else if (button.dataset.action === "stop") {
    declareStop(state);
  } else if (button.dataset.card) {
    playPlayerCard(state, button.dataset.card);
  } else if (button.dataset.choice) {
    resolveChoice(state, button.dataset.choice);
  }

  render();
});

render();
