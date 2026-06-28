export function saveSession(nextState) {
  if (!nextState?.room) return;
  localStorage.setItem("matgo-session", JSON.stringify({
    roomId: nextState.room.id,
    playerId: nextState.room.playerId,
  }));
}

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("matgo-session") || "null");
  } catch {
    return null;
  }
}

export function clearStoredSession() {
  localStorage.removeItem("matgo-session");
}

export function getRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  return room ? room.trim().toUpperCase() : "";
}

export function updateRoomUrl(nextState) {
  if (!nextState?.room) return;
  window.history.replaceState({}, "", window.location.pathname);
}

export function clearRoomUrl() {
  window.history.replaceState({}, "", window.location.pathname);
}

export function inviteUrl(state) {
  if (!state?.room) return window.location.href;
  const url = new URL(window.location.href);
  url.searchParams.set("room", state.room.id);
  return url.toString();
}
