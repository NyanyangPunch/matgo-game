export const KIND_LABELS = {
  bright: "광",
  ribbon: "띠",
  animal: "열",
  junk: "피",
  bonus: "쌍",
};

const MONTH_ART = ["송", "매", "벚", "흑", "난", "목", "홍", "공", "국", "단", "오", "비"];

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

export function createDeck() {
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

export function describeCard(card) {
  return `${card.month}월 ${card.name}`;
}
