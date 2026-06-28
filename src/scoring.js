const BRIGHT_WITH_RAIN_PENALTY = 2;

export function scoreCaptured(cards) {
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
    const points = hasRainBright ? BRIGHT_WITH_RAIN_PENALTY : 3;
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

  if (red) {
    total += 3;
    detail.push("홍단 3점");
  }
  if (blue) {
    total += 3;
    detail.push("청단 3점");
  }
  if (grass) {
    total += 3;
    detail.push("초단 3점");
  }

  if (animals.length >= 5) {
    const points = animals.length - 4;
    total += points;
    detail.push(`열끗 ${animals.length}장 ${points}점`);
  }
  if (godori) {
    total += 5;
    detail.push("고도리 5점");
  }

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
