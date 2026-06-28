import { cssEscape } from "./utils.js";

export function animatePlayedCard(source) {
  if (!source?.getBoundingClientRect) return;
  const field = document.querySelector(".field");
  if (!field) return;

  const from = source.getBoundingClientRect();
  const to = field.getBoundingClientRect();
  const clone = source.cloneNode(true);
  clone.classList.add("flying-card");
  Object.assign(clone.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  });
  document.body.appendChild(clone);

  const endX = to.left + to.width * 0.5 - (from.left + from.width * 0.5);
  const endY = to.top + to.height * 0.5 - (from.top + from.height * 0.5);
  clone
    .animate(
      [
        { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1 },
        { transform: `translate(${endX}px, ${endY}px) scale(0.92) rotate(-8deg)`, opacity: 0.25 },
      ],
      { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
    )
    .finished.finally(() => clone.remove());
}

export function animateNewCaptures(recentCapturedIds) {
  if (!recentCapturedIds.size) return;
  const field = document.querySelector(".field");
  if (!field) return;

  const fieldRect = field.getBoundingClientRect();
  const fromX = fieldRect.left + fieldRect.width * 0.5;
  const fromY = fieldRect.top + fieldRect.height * 0.5;

  for (const cardId of recentCapturedIds) {
    const target = document.querySelector(`[data-card-id="${cssEscape(cardId)}"].captured-card`);
    if (!target) continue;
    const rect = target.getBoundingClientRect();
    const deltaX = fromX - (rect.left + rect.width * 0.5);
    const deltaY = fromY - (rect.top + rect.height * 0.5);
    target.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(1.22) rotate(7deg)`, opacity: 0.1, filter: "brightness(1.35)" },
        { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1, filter: "brightness(1)" },
      ],
      { duration: 520, easing: "cubic-bezier(.18,.86,.32,1.18)" },
    );
  }
}
