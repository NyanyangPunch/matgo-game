import { animateNewCaptures, animatePlayedCard } from "./animations.js";
import { request } from "./api.js";
import { CAPTURE_GROUPS, CARD_IMAGES, KIND_LABELS } from "./constants.js";
import {
  clearRoomUrl,
  clearStoredSession,
  getRoomFromUrl,
  inviteUrl,
  loadSession,
  saveSession,
  updateRoomUrl,
} from "./session.js";
import { escapeHtml } from "./utils.js";

const app = document.querySelector("#app");
let state = null;
let busy = false;
let recentCapturedIds = new Set();
let quitGame = false;
let joinCode = "";
let pollTimer = null;
let openRooms = [];
let pendingJoinRoomId = null;
let stakeInput = "0.01";
let roomDialogOpen = false;
let roomPrivate = false;
let roomPassword = "";
let joinPassword = "";

restoreSession().catch((error) => {
  console.error("Failed to restore session", error);
  clearSession(false);
  renderLobby("서버 상태를 확인하는 중입니다. 잠시 후 새로고침을 눌러주세요.");
});

async function restoreSession() {
  renderLobby();
  const roomFromUrl = getRoomFromUrl();
  if (roomFromUrl) {
    joinCode = roomFromUrl;
    const saved = loadSession();
    if (saved?.roomId === roomFromUrl) {
      try {
        state = await request(`/api/state?roomId=${encodeURIComponent(saved.roomId)}&playerId=${encodeURIComponent(saved.playerId)}`);
        saveSession(state);
        updateRoomUrl(state);
        render();
        return;
      } catch {
        clearSession(false);
      }
    }
    pendingJoinRoomId = roomFromUrl;
    renderLobby();
    await loadOpenRooms();
    renderLobby();
    return;
  }

  clearSession(false);
  renderLobby();
  await loadOpenRooms();
  renderLobby();
}

async function createRoom(mode, options = {}) {
  if (busy) return;
  busy = true;
  try {
    state = await request("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        stake: mode === "human" ? stakeInput : undefined,
        private: mode === "human" ? Boolean(options.private) : false,
        password: mode === "human" ? options.password : undefined,
      }),
    });
    quitGame = false;
    if (mode === "human") roomPassword = "";
    saveSession(state);
    updateRoomUrl(state);
    render();
  } catch (error) {
    renderLobby(error.message || "방을 만들지 못했습니다. 서버를 다시 실행해 주세요.");
  } finally {
    busy = false;
  }
}

async function joinRoom(roomId, password = "") {
  const code = String(roomId || "").trim().toUpperCase();
  if (!code || busy) return;
  busy = true;
  try {
    const next = await request("/api/rooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: code, password }),
    });
    state = next;
    quitGame = false;
    saveSession(state);
    updateRoomUrl(state);
    render();
  } catch (error) {
    await loadOpenRooms();
    renderLobby(error.message || "방 입장에 실패했습니다.");
  } finally {
    busy = false;
  }
}

async function leaveCurrentRoom() {
  const room = state?.room;
  if (room) {
    try {
      await request("/api/rooms/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id, playerId: room.playerId }),
      });
    } catch {
      // 이미 사라진 방이어도 로비로 돌아가는 흐름은 유지합니다.
    }
  }
  clearSession();
  await loadOpenRooms();
  renderLobby();
}

async function loadOpenRooms() {
  try {
    const data = await request("/api/rooms");
    openRooms = data.rooms || [];
  } catch {
    openRooms = [];
  }
}

async function sendAction(type, payload = {}) {
  if (busy || !state?.room) return;
  busy = true;
  try {
    const before = state;
    const next = await request("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        roomId: state.room.id,
        playerId: state.room.playerId,
        ...payload,
      }),
    });
    if (await handleRemovedFromRoom(next)) return;
    state = next;
    recentCapturedIds = findNewCapturedIds(before, state);
    saveSession(state);
    render();
    animateNewCaptures(recentCapturedIds);
  } catch (error) {
    clearSession();
    await loadOpenRooms();
    renderLobby(error.message || "방에서 나갔습니다.");
  } finally {
    busy = false;
  }
}

async function refreshState() {
  if (!state?.room || busy) return;
  const before = state;
  const next = await request(`/api/state?roomId=${encodeURIComponent(state.room.id)}&playerId=${encodeURIComponent(state.room.playerId)}`);
  if (await handleRemovedFromRoom(next)) return;
  state = next;
  recentCapturedIds = findNewCapturedIds(before, state);
  saveSession(state);
  if (renderSignature(before) === renderSignature(state)) {
    updateVolatileState();
    return;
  }
  render();
    animateNewCaptures(recentCapturedIds);
}

async function handleRemovedFromRoom(nextState) {
  if (nextState?.room?.mode !== "human" || nextState.room.playerId) return false;
  clearSession();
  await loadOpenRooms();
  renderLobby("시간 안에 응답하지 않아 방에서 나갔습니다.");
  return true;
}

function decisionPromptActive(nextState) {
  return Boolean(
    nextState?.canDeclare &&
    nextState.turn === "player" &&
    !nextState.gameOver &&
    !nextState.pendingChoice,
  );
}

function renderSignature(nextState) {
  if (!nextState) return "";
  const copy = JSON.parse(JSON.stringify(nextState));
  copy.rematchRemaining = null;
  if (decisionPromptActive(copy)) {
    copy.timeRemaining = null;
    copy.turnStartedAt = null;
  }
  return JSON.stringify(copy);
}

function updateVolatileState() {
  const rematchCount = document.querySelector("[data-role='rematch-count']");
  if (rematchCount && state?.gameOver) {
    const remaining = Math.max(0, Number(state.rematchRemaining ?? state.room?.rematchLimit ?? 10));
    rematchCount.textContent = `${remaining}초 안에 새판을 선택하세요`;
  }
}

function renderLobby(error = "") {
  stopPolling();
  app.innerHTML = `
    <section class="lobby-screen">
      <div class="lobby-panel">
        <div class="lobby-heading">
          <h1>맞고 연습장</h1>
          <p>컴퓨터와 연습하거나 공개방을 만들어 1:1 맞고를 시작하세요.</p>
        </div>
        ${error ? `<div class="lobby-error">${escapeHtml(error)}</div>` : ""}
        <div class="lobby-actions">
          <button class="lobby-button practice" data-action="create-practice">컴퓨터와 연습게임</button>
          <button class="lobby-button human" data-action="open-room-dialog">사람과 맞고 방 만들기</button>
        </div>
        <section class="room-list-panel">
          <div class="room-list-head">
            <strong>공개 사람 방</strong>
            <button class="small-button" data-action="refresh-rooms">새로고침</button>
          </div>
          <div class="room-grid">
            ${renderRoomCards()}
          </div>
        </section>
        <div class="join-box secret-room-box">
          <input class="join-input" value="${escapeHtml(joinCode)}" placeholder="방 코드" maxlength="8" data-role="join-code" />
          <input class="join-input" value="${escapeHtml(joinPassword)}" placeholder="암호" maxlength="20" data-role="join-password" />
          <button class="lobby-button join" data-action="join-room">방 코드 입장</button>
        </div>
      </div>
    </section>
    ${renderRoomCreateDialog()}
    ${renderJoinConfirm()}
  `;
}

function renderRoomCreateDialog() {
  if (!roomDialogOpen) return "";
  return `
    <div class="join-confirm-overlay">
      <section class="join-confirm-box room-create-dialog">
        <h2>방 만들기</h2>
        <p>판돈과 공개 여부를 정한 뒤 방을 개설합니다.</p>
        <section class="stake-panel dialog-stake">
          <label for="stake-input">최소 판돈</label>
          <div class="stake-control">
            <input id="stake-input" class="stake-input" type="number" min="0.01" max="100" step="0.01" value="${escapeHtml(stakeInput)}" data-role="stake" />
            <span>SL</span>
          </div>
          <p>0.01SL부터 100SL까지 설정할 수 있습니다.</p>
        </section>
        <div class="privacy-options">
          <label class="${roomPrivate ? "" : "selected"}">
            <input type="radio" name="room-privacy" value="public" data-role="room-privacy" ${roomPrivate ? "" : "checked"} />
            <span>공개방</span>
          </label>
          <label class="${roomPrivate ? "selected" : ""}">
            <input type="radio" name="room-privacy" value="private" data-role="room-privacy" ${roomPrivate ? "checked" : ""} />
            <span>비밀방</span>
          </label>
        </div>
        ${roomPrivate ? `
          <label class="password-field">
            <span>비밀방 암호</span>
            <input class="join-input" type="password" value="${escapeHtml(roomPassword)}" maxlength="20" data-role="room-password" placeholder="암호 입력" />
          </label>
        ` : ""}
        <div class="join-confirm-actions">
          <button class="result-button primary" data-action="create-human-confirmed">방 만들기</button>
          <button class="result-button secondary" data-action="close-room-dialog">취소</button>
        </div>
      </section>
    </div>
  `;
}

function renderRoomCards() {
  const rooms = openRooms.filter((room) => room.open);
  if (!rooms.length) {
    return `<div class="room-empty">아직 열린 방이 없습니다. 사람과 맞고 방을 만들어보세요.</div>`;
  }
  return rooms.map((room, index) => `
    <button class="room-card ${room.private ? "private" : ""}" data-action="confirm-join-room" data-room-id="${escapeHtml(room.id)}">
      <span class="room-card-title">${room.private ? "비밀 맞고 방" : "공개 맞고 방"}</span>
      <strong>${room.private ? "비밀방" : "공개방"} ${index + 1}</strong>
      <span class="room-card-stake">${formatStake(room)}</span>
      <span>${room.private ? "암호 입력 후 입장" : "클릭해서 입장"}</span>
    </button>
  `).join("");
}

function roomById(roomId) {
  return openRooms.find((room) => room.id === roomId);
}

function formatStake(room) {
  if (!room) return "입장 후 확인";
  const amount = room?.stake ?? "0";
  const unit = room?.stakeUnit || "SL";
  if (Number(amount) <= 0) return "연습";
  return `${amount}${unit}`;
}

function formatBalance(amount, unit = "SL") {
  const value = Number(amount ?? 0);
  return `${value.toFixed(2)}${unit}`;
}

function normalizeStakeInput(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0.01";
  const clamped = Math.max(0.01, Math.min(100, amount));
  return clamped.toFixed(2);
}

function renderJoinConfirm() {
  if (!pendingJoinRoomId) return "";
  const room = roomById(pendingJoinRoomId);

  return `
    <div class="join-confirm-overlay">
      <section class="join-confirm-box">
        <h2>방에 입장할까요?</h2>
        <p>${room?.private ? "선택한 비밀방에 암호를 입력하고 입장합니다." : room ? "선택한 공개방에 두 번째 플레이어로 입장합니다." : "초대받은 방에 두 번째 플레이어로 입장합니다."}</p>
        <div class="confirm-stake">최소 판돈 ${escapeHtml(formatStake(room))}</div>
        ${room?.private || !room ? `
          <label class="password-field">
            <span>비밀방 암호</span>
            <input class="join-input" type="password" value="${escapeHtml(joinPassword)}" maxlength="20" data-role="join-password" placeholder="암호 입력" />
          </label>
        ` : ""}
        <div class="join-confirm-actions">
          <button class="result-button primary" data-action="join-confirmed">입장하기</button>
          <button class="result-button secondary" data-action="join-cancel">취소</button>
        </div>
      </section>
    </div>
  `;
}

function render() {
  updatePolling();
  if (quitGame) {
    app.innerHTML = renderQuitScreen();
    return;
  }

  if (!state) {
    loadOpenRooms().then(() => renderLobby()).catch(() => renderLobby());
    renderLobby();
    return;
  }

  const playerScore = state.scores.player;
  const opponentScore = state.scores.cpu;
  const countdownActive = Number(state.startCountdownRemaining || 0) > 0;
  const canAct = state.turn === "player" && !state.gameOver && !state.pendingChoice && state.room.opponentJoined && !countdownActive;
  const opponentName = state.room.mode === "practice" ? "컴퓨터" : "상대";
  const gameActive = state.room.opponentJoined && !state.gameOver;

  app.innerHTML = `
    <section class="game-layout">
      <div class="table">
        ${renderOpponent(opponentName)}
        ${renderCaptured("cpu", `${opponentName}가 딴 패`)}
        <section class="field-zone">
          <div class="field">
            <div class="row-head">
              <div class="row-title">바닥패 <span class="badge">${state.field.length}</span></div>
              ${renderRoomBadge()}
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
        ${renderCaptured("player", "내가 딴 패")}
        ${renderPlayer(canAct)}
      </div>

      <aside class="side-panel">
        <div class="brand">
          <h1>맞고 연습장</h1>
          <button class="new-game ${gameActive ? "danger" : ""}" data-action="${gameActive ? "forfeit" : "leave-room"}">${gameActive ? "경기 포기" : "로비"}</button>
        </div>
        ${renderWalletPanel(opponentName)}
        ${renderRoomPanel()}
        ${renderTurnTimer()}
        ${renderAutoToggle()}
        <div class="status">
          <strong>${escapeHtml(state.message)}</strong>
          <span>${state.room.mode === "practice" ? "컴퓨터와 연습게임 중입니다." : "사람과 1:1 맞고 방입니다."}</span>
        </div>
        <div class="score-grid">
          ${renderScore("나", playerScore, state.turn === "player")}
          ${renderScore(opponentName, opponentScore, state.turn === "cpu")}
        </div>
        <div class="actions">
          <button class="action go" data-action="go" ${!state.canDeclare || state.gameOver || state.turn !== "player" ? "disabled" : ""}>고</button>
          <button class="action stop" data-action="stop" ${!state.canDeclare || state.gameOver || state.turn !== "player" ? "disabled" : ""}>스톱</button>
        </div>
        <button class="refresh-button" data-action="refresh">상태 새로고침</button>
        <div class="log">
          ${state.logs.slice(0, 18).map((entry) => `<div class="log-entry">${escapeHtml(entry)}</div>`).join("")}
        </div>
      </aside>
    </section>
    ${renderWaitingOverlay()}
    ${renderRotateOverlay()}
    ${renderStartCountdownOverlay()}
    ${renderChoice()}
    ${renderDecisionPrompt()}
    ${renderResultOverlay(opponentName)}
  `;
}

function updatePolling() {
  const shouldPoll =
    state?.room &&
    !quitGame &&
    (!state.gameOver || state.room.mode === "human");
  if (shouldPoll) {
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        const stillShouldPoll =
          state?.room &&
          !quitGame &&
          (!state.gameOver || state.room.mode === "human");
        if (!busy && stillShouldPoll) {
          refreshState().catch(() => {});
        }
      }, 1000);
    }
  } else {
    stopPolling();
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function renderRoomBadge() {
  if (!state.room) return "";
  const label = state.room.mode === "practice" ? "연습게임" : state.room.private ? "비밀방" : "공개방";
  return `<div class="room-badge">${label}</div>`;
}

function renderWalletPanel(opponentName) {
  if (!state.room) return "";
  const balances = state.room.balances || {};
  const unit = state.room.stakeUnit || "SL";
  const myBalance = balances.player ? formatBalance(balances.player, unit) : "연동 대기";
  const opponentBalance = balances.cpu ? formatBalance(balances.cpu, unit) : "연동 대기";
  const stakeLabel = state.room.mode === "practice" ? "현재 연습 판돈" : "현재 최소 판돈";
  return `
    <section class="wallet-panel">
      <div class="wallet-head">
        <span>SL 지갑</span>
        <strong>${escapeHtml(formatStake(state.room))}</strong>
      </div>
      <div class="wallet-stake">${stakeLabel}</div>
      <div class="wallet-grid">
        <div>
          <span>내 보유</span>
          <strong>${escapeHtml(myBalance)}</strong>
        </div>
        <div>
          <span>${escapeHtml(opponentName)} 보유</span>
          <strong>${escapeHtml(opponentBalance)}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderRoomPanel() {
  if (!state.room) return "";
  const mode = state.room.mode === "practice" ? "연습게임" : state.room.private ? "비밀 맞고" : "사람과 맞고";
  const seat = state.room.seat === "player" ? "선 플레이어" : "후 플레이어";
  const disconnectNotice =
    state.room.mode === "human" && state.room.opponentJoined && state.room.opponentOnline === false
      ? `<div class="disconnect-notice">상대 연결이 끊겼습니다. 이번 판은 자동 진행되고 판 종료 후 방에서 정리됩니다.</div>`
      : "";
  const autoNotice =
    state.room.mode === "human" && state.autoPlayLocked?.cpu
      ? `<div class="disconnect-notice">상대가 3회 이상 미응답하여 남은 차례는 자동으로 즉시 진행됩니다.</div>`
      : state.room.mode === "human" && state.autoPlayLocked?.player
        ? `<div class="disconnect-notice">내 차례가 자동 진행 중입니다. 직접 패를 내면 자동 진행이 해제됩니다.</div>`
        : "";
  return `
    <div class="room-panel">
      <div><strong>${mode}</strong></div>
      <div>${state.room.mode === "practice" ? "연습 판돈" : "최소 판돈"} <strong>${escapeHtml(formatStake(state.room))}</strong></div>
      ${renderPracticeBalances()}
      <div>초대 주소 <button class="copy-code" data-action="copy-room">복사</button></div>
      <div>${seat}</div>
      ${disconnectNotice}
      ${autoNotice}
    </div>
  `;
}

function renderPracticeBalances() {
  if (state.room?.mode !== "practice" || !state.room.balances) return "";
  return `
    <div class="balance-row">
      <span>나 ${escapeHtml(formatBalance(state.room.balances.player, state.room.stakeUnit))}</span>
      <span>컴퓨터 ${escapeHtml(formatBalance(state.room.balances.cpu, state.room.stakeUnit))}</span>
    </div>
  `;
}

function renderTurnTimer() {
  if (state.room?.mode !== "human" || !state.room.opponentJoined || state.gameOver) return "";
  if (decisionPromptActive(state)) return "";
  const remaining = Math.max(0, Number(state.timeRemaining ?? 0));
  const owner = state.turn === "player" ? "내 차례" : "상대 차례";
  const pct = Math.max(0, Math.min(100, (remaining / (state.turnLimit || 10)) * 100));
  return `
    <div class="turn-timer ${remaining <= 3 ? "urgent" : ""} ${state.turn === "player" ? "my-turn" : ""}">
      <div class="turn-timer-head">
        <strong>${owner}</strong>
        <span>${remaining}초</span>
      </div>
      <div class="turn-timer-track">
        <span style="width: ${pct}%"></span>
      </div>
    </div>
  `;
}

function renderWaitingOverlay() {
  if (!state.room || state.room.mode !== "human" || state.room.opponentJoined) return "";
  return `
    <div class="waiting-overlay">
      <section class="waiting-box">
        <h2>상대를 기다리는 중</h2>
        <p>초대 주소를 복사해서 상대에게 알려주세요.</p>
        <div class="invite-url">초대 주소가 준비되었습니다.</div>
        <div class="waiting-actions">
          <button class="result-button primary" data-action="copy-room">초대 주소 복사</button>
          <button class="result-button secondary" data-action="refresh">입장 확인</button>
          <button class="result-button danger" data-action="leave-current-room">방 나가기</button>
        </div>
      </section>
    </div>
  `;
}

function renderAutoToggle() {
  if (!state?.room || !state.room.opponentJoined || state.gameOver) return "";
  const enabled = Boolean(state.autoMode?.player);
  return `
    <button class="auto-toggle ${enabled ? "on" : ""}" data-action="toggle-auto" aria-pressed="${enabled ? "true" : "false"}">
      <span>Auto</span>
      <strong>${enabled ? "ON" : "OFF"}</strong>
      <small>2.5초 간격</small>
    </button>
  `;
}

function renderRotateOverlay() {
  if (!state || state.gameOver) return "";
  return `
    <div class="rotate-overlay">
      <section class="rotate-box">
        <strong>가로 화면 권장</strong>
        <span>모바일에서는 기기를 가로로 돌리면 패와 점수를 더 편하게 볼 수 있습니다.</span>
      </section>
    </div>
  `;
}

function renderStartCountdownOverlay() {
  const remaining = Number(state.startCountdownRemaining || 0);
  if (!state.room || state.room.mode !== "human" || !state.room.opponentJoined || state.gameOver || remaining <= 0) return "";
  return `
    <div class="start-countdown-overlay">
      <section class="start-countdown-box">
        <p>상대방이 들어왔습니다</p>
        <strong>${Math.max(1, remaining)}</strong>
        <span>이제 시작합니다</span>
      </section>
    </div>
  `;
}

function findNewCapturedIds(before, after) {
  if (!before || !after) return new Set();
  const previous = new Set([
    ...before.captured.player.map((card) => card.id),
    ...before.captured.cpu.map((card) => card.id),
  ]);
  return new Set([
    ...after.captured.player,
    ...after.captured.cpu,
  ].filter((card) => !previous.has(card.id)).map((card) => card.id));
}

function renderOpponent(name) {
  const backs = state.hands.cpu
    .map((_, index) => `<div class="card back" title="${escapeHtml(name)} 손패 ${index + 1}"></div>`)
    .join("");
  return `
    <section class="row opponent">
      <div class="row-head">
        <div class="row-title">${escapeHtml(name)} 손패 <span class="badge">${state.hands.cpu.length}</span></div>
        <div class="row-title">획득 <span class="badge">${state.captured.cpu.length}</span></div>
      </div>
      <div class="cards">${backs}</div>
    </section>
  `;
}

function renderCaptured(owner, title) {
  const cards = sortCapturedCards(state.captured[owner]);
  const score = state.scores[owner];
  return `
    <section class="capture-lane ${owner}">
      <div class="row-head">
        <div class="row-title">${title} <span class="badge">${cards.length}</span></div>
        <div class="capture-score">광 ${score.bright} / 열끗 ${score.animals} / 띠 ${score.ribbons} / 피 ${score.pi}</div>
      </div>
      <div class="capture-board">
        ${CAPTURE_GROUPS.map((group) => renderCaptureGroup(group, cards)).join("")}
      </div>
    </section>
  `;
}

function renderCaptureGroup(group, cards) {
  const groupCards = cards.filter((card) => card.kind === group.kind);
  return `
    <section class="capture-group ${group.kind}">
      <div class="capture-group-title">
        <span>${group.label}</span>
        <span>${groupCards.length}</span>
      </div>
      <div class="capture-stack">
        ${groupCards.length ? groupCards.map((card) => renderCard(card, "captured")).join("") : `<span class="capture-placeholder"></span>`}
      </div>
    </section>
  `;
}

function sortCapturedCards(cards) {
  const order = { bright: 0, animal: 1, ribbon: 2, junk: 3 };
  return [...cards].sort((a, b) => {
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    if (a.month !== b.month) return a.month - b.month;
    return a.id.localeCompare(b.id);
  });
}

function renderPlayer(canAct) {
  const hintedCards = hintCardIds(canAct);
  return `
    <section class="row player-hand-row ${canAct ? "my-turn" : ""}">
      <div class="row-head">
        <div class="row-title">내 손패 <span class="badge">${state.hands.player.length}</span>${canAct ? `<span class="turn-badge">내 차례</span>` : ""}</div>
        <div class="row-title">획득 <span class="badge">${state.captured.player.length}</span></div>
      </div>
      <div class="cards">
        ${state.hands.player.map((card) => renderCard(card, "hand", canAct, hintedCards.has(card.id))).join("")}
      </div>
    </section>
  `;
}

function hintCardIds(canAct) {
  if (!canAct || state.autoMode?.player) return new Set();
  const turnLimit = Number(state.turnLimit || 10);
  const remaining = Number(state.timeRemaining ?? turnLimit);
  if (turnLimit - remaining < 5) return new Set();
  const matching = state.hands.player.filter((card) =>
    state.field.some((fieldCard) => fieldCard.month === card.month),
  );
  return new Set((matching.length ? matching : state.hands.player).map((card) => card.id));
}

function renderCard(card, zone, canAct = false, hinted = false) {
  const playable = zone === "hand" && canAct;
  const choose =
    state.pendingChoice?.owner === "player" &&
    zone === "choice" &&
    card.month === state.pendingChoice.played.month;
  const action = playable ? `data-card="${card.id}"` : choose ? `data-choice="${card.id}"` : "";
  const className = [
    "card",
    zone === "captured" ? "captured-card" : "",
    recentCapturedIds.has(card.id) ? "newly-captured" : "",
    playable || choose ? "playable" : "",
    hinted ? "hinted" : "",
    card.kind,
  ].join(" ");
  const imageSrc = `${card.image || imageForCard(card)}?v=real-cards-4`;

  return `
    <button class="${className}" data-card-id="${escapeHtml(card.id)}" ${action} title="${card.month}월 ${escapeHtml(card.name)} / ${KIND_LABELS[card.kind]}">
      <img class="card-art" src="${escapeHtml(imageSrc)}" alt="" draggable="false" />
    </button>
  `;
}

function imageForCard(card) {
  const [month = "1", slot = "0"] = String(card.id || "1-0").split("-");
  const index = (Number(month) - 1) * 4 + Number(slot);
  return `/assets/cards/${CARD_IMAGES[index] || CARD_IMAGES[0]}`;
}

function renderChoice() {
  if (!state.pendingChoice || state.pendingChoice.owner !== "player") return "";
  const choices = state.field.filter(
    (card) => card.month === state.pendingChoice.played.month,
  );
  return `
    <div class="choice-overlay">
      <div class="choice-box">
        <h2 class="choice-title">먹을 패 선택</h2>
        <p class="choice-sub">${state.pendingChoice.played.month}월 카드 중 하나를 골라 가져갑니다.</p>
        <div class="choice-cards">
          ${choices.map((card) => renderCard(card, "choice")).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderDecisionPrompt() {
  if (!state.canDeclare || state.turn !== "player" || state.gameOver || state.pendingChoice) {
    return "";
  }

  const score = state.scores.player;
  return `
    <div class="decision-overlay">
      <section class="decision-box">
        <div class="decision-score">${score.total}점</div>
        <h2 class="decision-title">고 또는 스톱</h2>
        <p class="decision-sub">점수가 났습니다. 계속 진행할지, 여기서 판을 끝낼지 선택하세요.</p>
        <div class="decision-actions">
          <button class="decision-button go" data-action="go">고</button>
          <button class="decision-button stop" data-action="stop">스톱</button>
        </div>
      </section>
    </div>
  `;
}

function renderResultOverlay(opponentName) {
  if (!state.gameOver) return "";

  const playerScore = state.scores.player.total;
  const opponentScore = state.scores.cpu.total;
  const resultClass =
    state.winner === "player" ? "win" : state.winner === "cpu" ? "lose" : "draw";
  const title =
    state.winner === "player" ? "승리" : state.winner === "cpu" ? "패배" : "무승부";
  const subtitle =
    state.winner === "player"
      ? "이번 판은 당신이 가져갔습니다."
      : state.winner === "cpu"
        ? `${opponentName}가 이번 판을 가져갔습니다.`
        : "이번 판은 같은 점수로 끝났습니다.";
  const rematchReady = state.rematchReady || {};
  const waitingForRematch = state.room?.mode === "human";
  const balanceSummary = state.room?.mode === "practice" && state.room.balances
    ? `
        <div class="result-balances">
          <span>나 ${escapeHtml(formatBalance(state.room.balances.player, state.room.stakeUnit))}</span>
          <span>${escapeHtml(opponentName)} ${escapeHtml(formatBalance(state.room.balances.cpu, state.room.stakeUnit))}</span>
        </div>
      `
    : "";
  const settlementSummary = state.room?.mode === "practice" && state.settlement
    ? `
        <div class="settlement-summary">
          ${escapeHtml(String(state.settlement.payoutScore ?? state.settlement.score ?? 0))}점 x ${escapeHtml(formatBalance(state.settlement.stake, state.room.stakeUnit))} = ${escapeHtml(formatBalance(state.settlement.amount, state.room.stakeUnit))}
        </div>
      `
    : "";
  const playerReady = Boolean(rematchReady.player);
  const opponentReady = Boolean(rematchReady.cpu);
  const rematchRemaining = Math.max(0, Number(state.rematchRemaining ?? state.room?.rematchLimit ?? 10));
  const rematchStatus = waitingForRematch
    ? `
        <div class="rematch-status">
          <div class="rematch-count" data-role="rematch-count">${rematchRemaining}초 안에 새판을 선택하세요</div>
          <div class="rematch-ready-row">
            <span class="${playerReady ? "ready" : ""}">나 ${playerReady ? "준비" : "대기"}</span>
            <span class="${opponentReady ? "ready" : ""}">${escapeHtml(opponentName)} ${opponentReady ? "준비" : "대기"}</span>
          </div>
        </div>
      `
    : "";
  const newButtonLabel = waitingForRematch && playerReady ? "상대 대기 중" : "새판 다시하기";

  return `
    <div class="result-overlay">
      <section class="result-box ${resultClass}">
        <div class="result-burst" aria-hidden="true"></div>
        <div class="result-label">${title}</div>
        <div class="result-score">
          <span>나 ${playerScore}</span>
          <strong>:</strong>
          <span>${escapeHtml(opponentName)} ${opponentScore}</span>
        </div>
        <p class="result-sub">${subtitle}</p>
        ${settlementSummary}
        ${balanceSummary}
        ${rematchStatus}
        <div class="result-actions">
          <button class="result-button primary" data-action="new" ${waitingForRematch && playerReady ? "disabled" : ""}>${newButtonLabel}</button>
          <button class="result-button secondary" data-action="quit">그만하기</button>
        </div>
      </section>
    </div>
  `;
}

function renderQuitScreen() {
  return `
    <section class="quit-screen">
      <div class="quit-box">
        <h1>게임 종료</h1>
        <p>수고하셨습니다. 다시 시작하려면 새 판을 눌러주세요.</p>
        <button class="result-button primary" data-action="new">새판 시작</button>
        <button class="result-button secondary" data-action="leave-room">로비로 이동</button>
      </div>
    </section>
  `;
}

function renderScore(name, score, active) {
  const detail = score.detail.length ? score.detail : ["아직 점수 없음"];
  return `
    <section class="score-card ${active ? "active" : ""}">
      <div class="score-name">
        <span>${escapeHtml(name)}</span>
        <span>${active ? "차례" : ""}</span>
      </div>
      <div class="score-main">${score.total}</div>
      <div class="score-detail">
        <span>광 ${score.bright} / 띠 ${score.ribbons} / 열끗 ${score.animals} / 피 ${score.pi}</span>
        ${detail.slice(0, 4).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </section>
  `;
}

function clearSession(clearUrl = true) {
  clearStoredSession();
  state = null;
  quitGame = false;
  joinPassword = "";
  stopPolling();
  if (clearUrl) clearRoomUrl();
}

app.addEventListener("input", (event) => {
  if (event.target.dataset.role === "join-code") {
    joinCode = event.target.value.toUpperCase();
    event.target.value = joinCode;
  } else if (event.target.dataset.role === "join-password") {
    joinPassword = event.target.value;
  } else if (event.target.dataset.role === "stake") {
    stakeInput = event.target.value;
  } else if (event.target.dataset.role === "room-privacy") {
    roomPrivate = event.target.value === "private";
    renderLobby();
  } else if (event.target.dataset.role === "room-password") {
    roomPassword = event.target.value;
  }
});

app.addEventListener("change", (event) => {
  if (event.target.dataset.role !== "stake") return;
  stakeInput = normalizeStakeInput(event.target.value);
  event.target.value = stakeInput;
});

app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.action === "create-practice") {
    createRoom("practice");
  } else if (button.dataset.action === "open-room-dialog") {
    roomDialogOpen = true;
    renderLobby();
  } else if (button.dataset.action === "close-room-dialog") {
    roomDialogOpen = false;
    renderLobby();
  } else if (button.dataset.action === "create-human-confirmed") {
    stakeInput = normalizeStakeInput(stakeInput);
    if (roomPrivate && !roomPassword.trim()) {
      roomDialogOpen = true;
      renderLobby("비밀방은 암호를 입력해야 합니다.");
      return;
    }
    roomDialogOpen = false;
    createRoom("human", { private: roomPrivate, password: roomPassword.trim() });
  } else if (button.dataset.action === "refresh-rooms") {
    loadOpenRooms().then(() => renderLobby());
  } else if (button.dataset.action === "confirm-join-room") {
    pendingJoinRoomId = button.dataset.roomId;
    renderLobby();
  } else if (button.dataset.action === "join-confirmed") {
    const roomId = pendingJoinRoomId;
    pendingJoinRoomId = null;
    joinRoom(roomId, joinPassword);
  } else if (button.dataset.action === "join-cancel") {
    pendingJoinRoomId = null;
    renderLobby();
  } else if (button.dataset.action === "join-room") {
    joinRoom(joinCode, joinPassword);
  } else if (button.dataset.action === "leave-room") {
    clearSession();
    loadOpenRooms().then(() => renderLobby());
  } else if (button.dataset.action === "leave-current-room") {
    leaveCurrentRoom();
  } else if (button.dataset.action === "copy-room") {
    navigator.clipboard?.writeText(inviteUrl(state));
  } else if (button.dataset.action === "refresh") {
    refreshState();
  } else if (button.dataset.action === "new") {
    quitGame = false;
    sendAction("NEW_GAME");
  } else if (button.dataset.action === "go") {
    sendAction("DECLARE_GO");
  } else if (button.dataset.action === "stop") {
    sendAction("DECLARE_STOP");
  } else if (button.dataset.action === "forfeit") {
    sendAction("FORFEIT");
  } else if (button.dataset.action === "toggle-auto") {
    sendAction("SET_AUTO_MODE", { enabled: !state.autoMode?.player });
  } else if (button.dataset.action === "quit") {
    quitGame = true;
    render();
  } else if (button.dataset.card) {
    animatePlayedCard(button);
    sendAction("PLAY_CARD", { cardId: button.dataset.card });
  } else if (button.dataset.choice) {
    sendAction("CHOOSE_CAPTURE", { cardId: button.dataset.choice });
  }
});
