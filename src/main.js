import { KIND_LABELS } from "./cards.js";
import {
  canDeclare,
  cpuTurn,
  createGame,
  declareGo,
  declareStop,
  playPlayerCard,
  resolveChoice,
} from "./game.js";
import { scoreCaptured } from "./scoring.js";

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
