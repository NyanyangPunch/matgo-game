CARD_BLUEPRINTS = [
    ("bright", "송학"), ("ribbon", "홍단"), ("junk", "피"), ("junk", "피"),
    ("animal", "매조"), ("ribbon", "홍단"), ("junk", "피"), ("junk", "피"),
    ("bright", "벚꽃"), ("ribbon", "홍단"), ("junk", "피"), ("junk", "피"),
    ("animal", "흑싸리"), ("ribbon", "초단"), ("junk", "피"), ("junk", "피"),
    ("animal", "난초"), ("ribbon", "초단"), ("junk", "피"), ("junk", "쌍피", 2),
    ("animal", "목단"), ("ribbon", "청단"), ("junk", "피"), ("junk", "피"),
    ("animal", "멧돼지"), ("ribbon", "초단"), ("junk", "피"), ("junk", "피"),
    ("bright", "공산"), ("animal", "기러기"), ("junk", "피"), ("junk", "피"),
    ("animal", "술잔"), ("ribbon", "청단"), ("junk", "피"), ("junk", "쌍피", 2),
    ("animal", "사슴"), ("ribbon", "청단"), ("junk", "피"), ("junk", "피"),
    ("bright", "오동"), ("junk", "피"), ("junk", "피"), ("junk", "쌍피", 2),
    ("bright", "비광"), ("animal", "제비"), ("ribbon", "비띠"), ("junk", "쌍피", 2),
]

CARD_IMAGES = [
    "Hanafuda_January_Hikari_Alt.svg", "Hanafuda_January_Tanzaku_Alt.svg", "Hanafuda_January_Kasu_1_Alt.svg", "Hanafuda_January_Kasu_2_Alt.svg",
    "Hanafuda_February_Tane_Alt.svg", "Hanafuda_February_Tanzaku_Alt.svg", "Hanafuda_February_Kasu_1_Alt.svg", "Hanafuda_February_Kasu_2_Alt.svg",
    "Hanafuda_March_Hikari_Alt.svg", "Hanafuda_March_Tanzaku_Alt.svg", "Hanafuda_March_Kasu_1_Alt.svg", "Hanafuda_March_Kasu_2_Alt.svg",
    "Hanafuda_April_Tane_Alt.svg", "Hanafuda_April_Tanzaku_Alt.svg", "Hanafuda_April_Kasu_1_Alt.svg", "Hanafuda_April_Kasu_2_Alt.svg",
    "Hanafuda_May_Tane_Alt.svg", "Hanafuda_May_Tanzaku_Alt.svg", "Hanafuda_May_Kasu_1_Alt.svg", "Hanafuda_May_Kasu_2_Alt.svg",
    "Hanafuda_June_Tane_Alt.svg", "Hanafuda_June_Tanzaku_Alt.svg", "Hanafuda_June_Kasu_1_Alt.svg", "Hanafuda_June_Kasu_2_Alt.svg",
    "Hanafuda_July_Tane_Alt.svg", "Hanafuda_July_Tanzaku_Alt.svg", "Hanafuda_July_Kasu_1_Alt.svg", "Hanafuda_July_Kasu_2_Alt.svg",
    "Hanafuda_August_Hikari_Alt.svg", "Hanafuda_August_Tane_Alt.svg", "Hanafuda_August_Kasu_1_Alt.svg", "Hanafuda_August_Kasu_2_Alt.svg",
    "Hanafuda_September_Tane_Alt.svg", "Hanafuda_September_Tanzaku_Alt.svg", "Hanafuda_September_Kasu_1_Alt.svg", "Hanafuda_September_Kasu_2_Alt.svg",
    "Hanafuda_October_Tane_Alt.svg", "Hanafuda_October_Tanzaku_Alt.svg", "Hanafuda_October_Kasu_1_Alt.svg", "Hanafuda_October_Kasu_2_Alt.svg",
    "Hanafuda_November_Hikari_Alt.svg", "Hanafuda_November_Tane_Alt.svg", "Hanafuda_November_Tanzaku_Alt.svg", "Hanafuda_November_Kasu_Alt.svg",
    "Hanafuda_December_Hikari_Alt.svg", "Hanafuda_December_Kasu_1_Alt.svg", "Hanafuda_December_Kasu_2_Alt.svg", "Hanafuda_December_Kasu_3_Alt.svg",
]


def create_deck():
    deck = []
    for index, data in enumerate(CARD_BLUEPRINTS):
        kind, name, *rest = data
        month = index // 4 + 1
        deck.append({
            "id": f"{month}-{index % 4}",
            "month": month,
            "kind": kind,
            "name": name,
            "pi": rest[0] if rest else (1 if kind == "junk" else 0),
            "image": f"/assets/cards/{CARD_IMAGES[index]}",
        })
    return deck
