import json
import math
import random
import string
import time
import urllib.parse
from decimal import Decimal, InvalidOperation
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

try:
    import uvicorn
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
except ImportError:
    uvicorn = None
    FastAPI = None
    HTTPException = None
    Request = None
    FileResponse = None
    StaticFiles = None

from cards import create_deck
from settings import (
    DISCONNECT_GRACE_SECONDS,
    FRONTEND,
    MAX_STAKE_SL,
    MIN_STAKE_SL,
    OPPONENT,
    PLAYER,
    PRACTICE_STAKE_SL,
    PRACTICE_STARTING_BALANCE_SL,
    REMATCH_LIMIT_SECONDS,
    ROOT,
    SEATS,
    TURN_LIMIT_SECONDS,
)

AUTO_PLAY_DELAY_SECONDS = 2



def new_game():
    deck = create_deck()
    random.shuffle(deck)
    state = {
        "hands": {PLAYER: [], OPPONENT: []},
        "field": [],
        "deck": [],
        "captured": {PLAYER: [], OPPONENT: []},
        "turn": PLAYER,
        "pendingChoice": None,
        "gameOver": False,
        "winner": None,
        "goScore": {PLAYER: 0, OPPONENT: 0},
        "goCount": {PLAYER: 0, OPPONENT: 0},
        "autoMode": {PLAYER: False, OPPONENT: False},
        "autoPlayStreak": {PLAYER: 0, OPPONENT: 0},
        "autoPlayLocked": {PLAYER: False, OPPONENT: False},
        "rematchReady": {PLAYER: False, OPPONENT: False},
        "rematchStartedAt": None,
        "turnStartedAt": time.time(),
        "startCountdownUntil": None,
        "message": "당신의 차례입니다. 손패를 골라주세요.",
        "logs": ["새 판을 시작했습니다."],
    }
    for _ in range(10):
        state["hands"][PLAYER].append(deck.pop())
        state["hands"][OPPONENT].append(deck.pop())
    for _ in range(8):
        state["field"].append(deck.pop())
    state["deck"] = deck
    return state


def replace_state_with_new_game(room):
    previous_auto_mode = room.get("state", {}).get("autoMode", {PLAYER: False, OPPONENT: False})
    room["state"] = new_game()
    room["state"]["autoMode"] = {
        PLAYER: bool(previous_auto_mode.get(PLAYER)),
        OPPONENT: bool(previous_auto_mode.get(OPPONENT)),
    }
    return room["state"]


ROOMS = {}


def make_id(size=5):
    alphabet = string.ascii_uppercase + string.digits
    while True:
        room_id = "".join(random.choice(alphabet) for _ in range(size))
        if room_id not in ROOMS:
            return room_id


def make_token():
    return "".join(random.choice(string.ascii_letters + string.digits) for _ in range(20))


def normalize_stake(stake):
    try:
        amount = Decimal(str(stake if stake is not None else MIN_STAKE_SL))
    except (InvalidOperation, ValueError):
        raise ValueError("판돈은 숫자로 입력해주세요.")
    min_stake = Decimal(MIN_STAKE_SL)
    max_stake = Decimal(MAX_STAKE_SL)
    if amount < min_stake or amount > max_stake:
        raise ValueError(f"판돈은 {MIN_STAKE_SL}SL부터 {MAX_STAKE_SL}SL까지 가능합니다.")
    return format(amount.quantize(Decimal("0.01")), "f")


def format_sl(amount):
    return format(Decimal(str(amount)).quantize(Decimal("0.01")), "f")


def new_practice_balances():
    return {
        PLAYER: format_sl(PRACTICE_STARTING_BALANCE_SL),
        OPPONENT: format_sl(PRACTICE_STARTING_BALANCE_SL),
    }


def create_room(mode, stake=None, private=False, password=""):
    room_id = make_id()
    host_token = make_token()
    now = time.time()
    room_mode = "human" if mode == "human" else "practice"
    is_private = bool(private) if room_mode == "human" else False
    room = {
        "id": room_id,
        "mode": room_mode,
        "private": is_private,
        "password": str(password or "").strip() if is_private else "",
        "stake": normalize_stake(stake) if room_mode == "human" else format_sl(PRACTICE_STAKE_SL),
        "balances": new_practice_balances() if room_mode == "practice" else None,
        "state": new_game(),
        "players": {PLAYER: host_token, OPPONENT: None},
        "lastSeen": {PLAYER: now, OPPONENT: None},
    }
    if room["mode"] == "practice":
        room["players"][OPPONENT] = "computer"
        room["lastSeen"][OPPONENT] = now
    ROOMS[room_id] = room
    return room, PLAYER, host_token


def get_room(room_id):
    return ROOMS.get(room_id)


def seat_for(room, token):
    for seat, known_token in room["players"].items():
        if known_token == token:
            return seat
    return None


def other_seat(seat):
    return OPPONENT if seat == PLAYER else PLAYER


def both_players_joined(room):
    return all(room.get("players", {}).get(seat) for seat in SEATS)


def join_room(room_id, password=""):
    room = get_room(room_id)
    if not room or room["mode"] != "human":
        return None, None, None, "방을 찾을 수 없습니다."
    if not room["players"][PLAYER]:
        return None, None, None, "Room is not available."
    if room["players"][OPPONENT]:
        return None, None, None, "이미 두 명이 있는 방입니다."
    if room.get("private") and str(password or "").strip() != room.get("password"):
        return None, None, None, "비밀방 암호가 맞지 않습니다."
    token = make_token()
    room["players"][OPPONENT] = token
    room.setdefault("lastSeen", {})[OPPONENT] = time.time()
    replace_state_with_new_game(room)
    room["state"]["startCountdownUntil"] = time.time() + 3
    room["state"]["turnStartedAt"] = room["state"]["startCountdownUntil"]
    room["state"]["message"] = "상대방이 들어왔습니다. 곧 시작합니다."
    room["state"]["logs"].insert(0, "상대가 방에 입장해 새 판을 섞었습니다.")
    return room, OPPONENT, token, None


def leave_room(room_id, token):
    room = get_room(room_id)
    if not room:
        return
    seat = seat_for(room, token)
    if not seat:
        return
    if room["mode"] == "human" and seat == PLAYER and not room["players"][OPPONENT]:
        ROOMS.pop(room_id, None)
        return
    room["players"][seat] = None
    room.setdefault("lastSeen", {})[seat] = None
    if room["mode"] == "human":
        room["state"]["gameOver"] = True
        room["state"]["winner"] = other_seat(seat)
        prepare_rematch(room["state"])
        room["state"]["message"] = "상대가 방을 떠났습니다."
        room["state"]["logs"].insert(0, "상대가 방을 떠났습니다.")


DEFAULT_ROOM, DEFAULT_SEAT, DEFAULT_TOKEN = create_room("practice")


def settle_practice_room(room):
    if room["mode"] != "practice":
        return
    state = room["state"]
    if not state.get("gameOver") or state.get("settled"):
        return
    state["settled"] = True
    winner = state.get("winner")
    if winner not in SEATS:
        state["settlement"] = {"amount": "0.00", "score": 0, "stake": room.get("stake", PRACTICE_STAKE_SL)}
        state["logs"].insert(0, "연습게임 무승부로 잔액 변동이 없습니다.")
        return
    loser = other_seat(winner)
    stake = Decimal(str(room.get("stake", PRACTICE_STAKE_SL)))
    winner_score = score_captured(state["captured"][winner])["total"]
    go_count = state.get("goCount", {}).get(winner, 0)
    score_rule = apply_go_bonus(winner_score, go_count)
    payout_score = max(1, score_rule["total"])
    amount = stake * Decimal(payout_score)
    balances = room.setdefault("balances", new_practice_balances())
    balances[winner] = format_sl(Decimal(balances[winner]) + amount)
    balances[loser] = format_sl(max(Decimal("0"), Decimal(balances[loser]) - amount))
    state["settlement"] = {
        "amount": format_sl(amount),
        "score": winner_score,
        "payoutScore": payout_score,
        "goCount": go_count,
        "goBonus": score_rule["bonus"],
        "goMultiplier": score_rule["multiplier"],
        "stake": format_sl(stake),
        "winner": winner,
        "loser": loser,
    }
    state["logs"].insert(0, f"연습게임 {payout_score}점 x {format_sl(stake)}SL = {format_sl(amount)}SL 정산 완료.")


def public_state(room, viewer_seat):
    if room["mode"] == "human":
        enforce_rematch_timeout(room)
        if both_players_joined(room):
            enforce_timeouts(room)
        cleanup_disconnected_after_game(room)
    else:
        enforce_timeouts(room)
        settle_practice_room(room)
    state = json.loads(json.dumps(room["state"]))
    my_seat = viewer_seat or PLAYER
    their_seat = other_seat(my_seat)
    state["autoMode"] = room["state"].get("autoMode", {PLAYER: False, OPPONENT: False})
    state["autoPlayStreak"] = room["state"].get("autoPlayStreak", {PLAYER: 0, OPPONENT: 0})
    state["autoPlayLocked"] = room["state"].get("autoPlayLocked", {PLAYER: False, OPPONENT: False})

    if my_seat == OPPONENT:
        state = perspective_swap(state)

    opponent_joined = room["mode"] == "practice" or bool(room["players"][their_seat])
    opponent_online = opponent_joined and not is_disconnected(room, their_seat)
    state["hands"][OPPONENT] = [{"back": True, "id": f"opponent-{i}"} for i, _ in enumerate(room["state"]["hands"][their_seat])]
    state["deck"] = [{"back": True, "id": f"deck-{i}"} for i, _ in enumerate(room["state"]["deck"])]
    state["scores"] = {
        PLAYER: score_captured(state["captured"][PLAYER]),
        OPPONENT: score_captured(state["captured"][OPPONENT]),
    }
    state["canDeclare"] = can_declare(room["state"], my_seat)
    state["turnLimit"] = TURN_LIMIT_SECONDS
    state["timeRemaining"] = time_remaining(room["state"])
    state["startCountdownRemaining"] = start_countdown_remaining(room["state"]) if room["mode"] == "human" else None
    state["rematchRemaining"] = rematch_remaining(room["state"]) if room["mode"] == "human" else None
    state["room"] = {
        "id": room["id"],
        "mode": room["mode"],
        "private": room.get("private", False),
        "stake": room.get("stake", "0"),
        "stakeUnit": "SL",
        "minStake": MIN_STAKE_SL,
        "maxStake": MAX_STAKE_SL,
        "balances": room.get("balances"),
        "seat": my_seat,
        "playerId": room["players"][my_seat],
        "opponentJoined": opponent_joined,
        "opponentOnline": opponent_online,
        "disconnectGrace": DISCONNECT_GRACE_SECONDS,
        "rematchLimit": REMATCH_LIMIT_SECONDS,
    }
    if room["mode"] == "human" and not opponent_joined:
        state["message"] = "상대가 들어오길 기다리는 중입니다. 방 코드를 공유하세요."
    return state


def perspective_swap(state):
    state["hands"] = {PLAYER: state["hands"][OPPONENT], OPPONENT: state["hands"][PLAYER]}
    state["captured"] = {PLAYER: state["captured"][OPPONENT], OPPONENT: state["captured"][PLAYER]}
    if state["turn"] in SEATS:
        state["turn"] = PLAYER if state["turn"] == OPPONENT else OPPONENT
    if state["winner"] in SEATS:
        state["winner"] = PLAYER if state["winner"] == OPPONENT else OPPONENT
    if state.get("rematchReady"):
        state["rematchReady"] = {PLAYER: state["rematchReady"][OPPONENT], OPPONENT: state["rematchReady"][PLAYER]}
    if state.get("autoPlayStreak"):
        state["autoPlayStreak"] = {PLAYER: state["autoPlayStreak"][OPPONENT], OPPONENT: state["autoPlayStreak"][PLAYER]}
    if state.get("autoPlayLocked"):
        state["autoPlayLocked"] = {PLAYER: state["autoPlayLocked"][OPPONENT], OPPONENT: state["autoPlayLocked"][PLAYER]}
    if state.get("autoMode"):
        state["autoMode"] = {PLAYER: state["autoMode"][OPPONENT], OPPONENT: state["autoMode"][PLAYER]}
    pending = state.get("pendingChoice")
    if pending and pending.get("owner") in SEATS:
        pending["owner"] = PLAYER if pending["owner"] == OPPONENT else OPPONENT
    return state


def handle_action(room, seat, payload):
    if room["mode"] == "human":
        if both_players_joined(room):
            enforce_timeouts(room)
        cleanup_disconnected_after_game(room)
    action = payload.get("type")
    state = room["state"]
    if start_countdown_remaining(state) > 0 and action not in {"NEW_GAME", "FORFEIT", "SET_AUTO_MODE"}:
        return public_state(room, seat)
    if action == "NEW_GAME":
        if room["mode"] == "human":
            if not all(room["players"].get(seat_name) for seat_name in SEATS):
                state["message"] = "상대를 기다리는 중입니다."
                return public_state(room, seat)
            if state["gameOver"]:
                mark_rematch_ready(room, seat)
                if all(room["state"]["rematchReady"].get(seat_name) for seat_name in SEATS):
                    replace_state_with_new_game(room)
                    room["state"]["startCountdownUntil"] = time.time() + 3
                    room["state"]["turnStartedAt"] = room["state"]["startCountdownUntil"]
                    room["state"]["message"] = "두 플레이어가 모두 새판을 선택했습니다. 곧 시작합니다."
                return public_state(room, seat)
            return public_state(room, seat)
        if room["mode"] == "human" and not all(room["players"].get(seat_name) for seat_name in SEATS):
            state["message"] = "상대를 기다리는 중입니다."
            return public_state(room, seat)
        replace_state_with_new_game(room)
    elif action == "SET_AUTO_MODE":
        set_auto_mode(state, seat, payload.get("enabled"))
    elif action == "PLAY_CARD":
        reset_auto_play(state, seat)
        play_player_card(state, seat, payload.get("cardId"))
        run_ai_if_needed(room)
    elif action == "CHOOSE_CAPTURE":
        reset_auto_play(state, seat)
        resolve_choice(state, seat, payload.get("cardId"))
        run_ai_if_needed(room)
    elif action == "DECLARE_GO":
        reset_auto_play(state, seat)
        declare_go(state, seat)
    elif action == "DECLARE_STOP":
        reset_auto_play(state, seat)
        declare_stop(state, seat)
    elif action == "FORFEIT":
        forfeit_game(state, seat)
    return public_state(room, seat)


def play_player_card(state, seat, card_id):
    if state["gameOver"] or state["turn"] != seat or state["pendingChoice"]:
        return
    card = find_by_id(state["hands"][seat], card_id)
    if card:
        play_card(state, seat, card)


def run_ai_if_needed(room):
    if room["mode"] != "practice":
        return
    state = room["state"]
    while not state["gameOver"] and state["turn"] == OPPONENT and not state["pendingChoice"]:
        card = choose_cpu_card(state)
        play_card(state, OPPONENT, card)
        if state["pendingChoice"]:
            month = state["pendingChoice"]["played"]["month"]
            candidates = [card for card in state["field"] if card["month"] == month]
            target = sorted(candidates, key=card_value)[-1]
            resolve_choice(state, OPPONENT, target["id"])


def resolve_choice(state, seat, card_id):
    pending = state["pendingChoice"]
    if not pending or pending["owner"] != seat or state["gameOver"]:
        return
    target = find_by_id(state["field"], card_id)
    if not target or target["month"] != pending["played"]["month"]:
        return
    state["pendingChoice"] = None
    capture_specific(state, pending["owner"], pending["played"], target)
    draw_and_resolve(state, pending["owner"])
    finish_turn(state, pending["owner"])


def declare_go(state, seat):
    if not state["gameOver"] and state["turn"] == seat and can_declare(state, seat):
        state["goScore"][seat] = score_captured(state["captured"][seat])["total"]
        state.setdefault("goCount", {PLAYER: 0, OPPONENT: 0})
        state["goCount"][seat] = state["goCount"].get(seat, 0) + 1
        go_count = state["goCount"][seat]
        state["logs"].insert(0, f"{seat_label(seat)}이 {go_count}고를 선언했습니다.")
        state["message"] = f"{go_count}고를 선언했습니다. 계속 진행하세요."


def declare_stop(state, seat):
    if not state["gameOver"] and state["turn"] == seat and can_declare(state, seat):
        end_game(state, seat, "스톱을 선언했습니다.")


def play_card(state, owner, card):
    remove_by_id(state["hands"][owner], card["id"])
    state["logs"].insert(0, f"{seat_label(owner)}: {describe_card(card)} 냈습니다.")
    matches = [field_card for field_card in state["field"] if field_card["month"] == card["month"]]

    if len(matches) == 0:
        state["field"].append(card)
        draw_and_resolve(state, owner)
        finish_turn(state, owner)
    elif len(matches) == 1:
        capture_specific(state, owner, card, matches[0])
        draw_and_resolve(state, owner)
        finish_turn(state, owner)
    elif len(matches) == 2:
        state["pendingChoice"] = {"owner": owner, "played": card}
        state["message"] = "같은 월 카드가 2장 있습니다. 먹을 카드를 선택하세요."
        reset_turn_timer(state)
    else:
        capture_many(state, owner, [card, *matches])
        draw_and_resolve(state, owner)
        finish_turn(state, owner)


def draw_and_resolve(state, owner):
    if not state["deck"]:
        return
    drawn = state["deck"].pop()
    state["logs"].insert(0, f"{seat_label(owner)}: 더미에서 {describe_card(drawn)} 뒤집었습니다.")
    matches = [field_card for field_card in state["field"] if field_card["month"] == drawn["month"]]
    if not matches:
        state["field"].append(drawn)
    else:
        capture_many(state, owner, [drawn, *matches])


def capture_specific(state, owner, played, target):
    remove_by_id(state["field"], target["id"])
    capture_many(state, owner, [played, target])


def capture_many(state, owner, cards):
    for card in cards:
        remove_by_id(state["field"], card["id"])
    state["captured"][owner].extend(cards)
    names = ", ".join(describe_card(card) for card in cards)
    state["logs"].insert(0, f"{seat_label(owner)}: {names} 획득.")


def finish_turn(state, owner):
    if state["gameOver"]:
        return
    score = score_captured(state["captured"][owner])["total"]
    if owner == OPPONENT and score >= 7:
        end_game(state, OPPONENT, "상대가 스톱을 선언했습니다.")
        return
    if not state["hands"][PLAYER] or not state["hands"][OPPONENT]:
        player_score = score_captured(state["captured"][PLAYER])["total"]
        opponent_score = score_captured(state["captured"][OPPONENT])["total"]
        if player_score == opponent_score:
            state["gameOver"] = True
            state["winner"] = "draw"
            prepare_rematch(state)
            state["message"] = "동점으로 판이 끝났습니다."
            state["logs"].insert(0, "동점으로 종료되었습니다.")
        else:
            end_game(state, PLAYER if player_score > opponent_score else OPPONENT, "손패를 모두 사용해서 판이 끝났습니다.")
        return
    state["turn"] = other_seat(owner)
    state["message"] = "당신의 차례입니다. 손패를 골라주세요."
    reset_turn_timer(state)


def end_game(state, winner, reason):
    state["gameOver"] = True
    state["winner"] = winner
    prepare_rematch(state)
    state["message"] = f"{seat_label(winner)}의 승리! {reason}"
    state["logs"].insert(0, f"{seat_label(winner)}의 승리: {reason}")


def forfeit_game(state, seat):
    if state["gameOver"]:
        return
    winner = other_seat(seat)
    end_game(state, winner, f"{seat_label(seat)}이 경기를 포기했습니다.")


def reset_turn_timer(state):
    state["turnStartedAt"] = time.time()


def time_remaining(state):
    if state["gameOver"]:
        return 0
    if start_countdown_remaining(state) > 0:
        return TURN_LIMIT_SECONDS
    actor = state.get("pendingChoice", {}).get("owner") if state.get("pendingChoice") else state.get("turn")
    if actor in SEATS and should_auto_play_now(state, actor):
        return 0
    elapsed = time.time() - state.get("turnStartedAt", time.time())
    return max(0, int(TURN_LIMIT_SECONDS - elapsed))


def start_countdown_remaining(state):
    until = state.get("startCountdownUntil")
    if not until or state.get("gameOver"):
        return 0
    return max(0, math.ceil(until - time.time()))


def should_auto_play_now(state, seat):
    if state.get("autoPlayLocked", {}).get(seat):
        return True
    if not state.get("autoMode", {}).get(seat):
        return False
    elapsed = time.time() - state.get("turnStartedAt", time.time())
    return elapsed >= AUTO_PLAY_DELAY_SECONDS


def set_auto_mode(state, seat, enabled):
    if seat not in SEATS:
        return
    state.setdefault("autoMode", {PLAYER: False, OPPONENT: False})
    state["autoMode"][seat] = bool(enabled)
    reset_turn_timer(state)
    state["message"] = "Auto mode is on." if state["autoMode"][seat] else "Auto mode is off."


def reset_auto_play(state, seat):
    if seat not in SEATS:
        return
    state.setdefault("autoPlayStreak", {PLAYER: 0, OPPONENT: 0})
    state.setdefault("autoPlayLocked", {PLAYER: False, OPPONENT: False})
    state["autoPlayStreak"][seat] = 0
    state["autoPlayLocked"][seat] = False


def record_auto_play(state, seat, user_requested=False):
    state.setdefault("autoPlayStreak", {PLAYER: 0, OPPONENT: 0})
    state.setdefault("autoPlayLocked", {PLAYER: False, OPPONENT: False})
    if user_requested:
        return
    state["autoPlayStreak"][seat] = state["autoPlayStreak"].get(seat, 0) + 1
    if state["autoPlayStreak"][seat] >= 3:
        state["autoPlayLocked"][seat] = True


def prepare_rematch(state):
    state["rematchReady"] = {PLAYER: False, OPPONENT: False}
    state["rematchStartedAt"] = time.time()


def mark_rematch_ready(room, seat):
    state = room["state"]
    if not state.get("gameOver") or seat not in SEATS:
        return
    state.setdefault("rematchReady", {PLAYER: False, OPPONENT: False})
    state["rematchReady"][seat] = True
    if not state.get("rematchStartedAt"):
        state["rematchStartedAt"] = time.time()
    state["message"] = "새판 다시하기 대기 중입니다. 상대도 눌러야 시작됩니다."


def rematch_remaining(state):
    if not state.get("gameOver"):
        return None
    started_at = state.get("rematchStartedAt")
    if not started_at:
        return REMATCH_LIMIT_SECONDS
    elapsed = time.time() - started_at
    return max(0, int(REMATCH_LIMIT_SECONDS - elapsed))


def enforce_rematch_timeout(room):
    state = room["state"]
    if room["mode"] != "human" or not state.get("gameOver"):
        return
    if not all(room["players"].get(seat) for seat in SEATS):
        return
    state.setdefault("rematchReady", {PLAYER: False, OPPONENT: False})
    if not state.get("rematchStartedAt"):
        state["rematchStartedAt"] = time.time()
        return
    if rematch_remaining(state) > 0:
        return
    removed = []
    for seat in SEATS:
        if not state["rematchReady"].get(seat):
            room["players"][seat] = None
            room.setdefault("lastSeen", {})[seat] = None
            removed.append(seat)
    if removed:
        state["message"] = "시간 안에 새판 다시하기를 누르지 않은 플레이어가 방에서 나갔습니다."
        state["logs"].insert(0, "새판 준비 시간이 지나 미응답 플레이어를 정리했습니다.")


def mark_seen(room, seat):
    if not room or seat not in SEATS:
        return
    if room["mode"] != "human":
        return
    if not room["players"].get(seat):
        return
    room.setdefault("lastSeen", {})[seat] = time.time()


def is_disconnected(room, seat):
    if room["mode"] != "human":
        return False
    if not room["players"].get(seat):
        return False
    last_seen = room.setdefault("lastSeen", {}).get(seat)
    if not last_seen:
        return False
    return time.time() - last_seen > DISCONNECT_GRACE_SECONDS


def cleanup_disconnected_after_game(room):
    if room["mode"] != "human" or not room["state"].get("gameOver"):
        return
    removed = []
    for seat in SEATS:
        if is_disconnected(room, seat):
            room["players"][seat] = None
            room.setdefault("lastSeen", {})[seat] = None
            removed.append(seat)
    if removed:
        room["state"]["message"] = "연결이 끊긴 플레이어가 방에서 나갔습니다."
        room["state"]["logs"].insert(0, "연결이 끊긴 플레이어를 방에서 정리했습니다.")


def enforce_timeouts_legacy(room):
    state = room["state"]
    if room["mode"] == "human" and not both_players_joined(room):
        return
    if start_countdown_remaining(state) > 0:
        return
    while not state["gameOver"] and time_remaining(state) <= 0:
        if can_declare(state, state["turn"]):
            reset_turn_timer(state)
            return
        pending = state.get("pendingChoice")
        if pending:
            owner = pending["owner"]
            locked = should_auto_play_now(state, owner)
            target = choose_capture_target(state, pending["played"])
            if not target:
                reset_turn_timer(state)
                return
            record_auto_play(state, owner)
            reason = "자동 진행 상태로" if locked else "시간 초과로"
            state["logs"].insert(0, f"{seat_label(owner)}: {reason} 먹을 패가 자동 선택되었습니다.")
            resolve_choice(state, owner, target["id"])
        else:
            owner = state["turn"]
            locked = should_auto_play_now(state, owner)
            card = choose_auto_card(state, owner)
            if not card:
                reset_turn_timer(state)
                return
            record_auto_play(state, owner)
            reason = "자동 진행 상태로" if locked else "시간 초과로"
            state["logs"].insert(0, f"{seat_label(owner)}: {reason} {describe_card(card)} 자동 제출.")
            play_card(state, owner, card)
        run_ai_if_needed(room)


def choose_capture_target(state, played):
    candidates = [card for card in state["field"] if card["month"] == played["month"]]
    if not candidates:
        return None
    return sorted(candidates, key=card_value)[-1]


def choose_auto_card(state, owner):
    hand = state["hands"][owner]
    if not hand:
        return None
    matching = [card for card in hand if any(field_card["month"] == card["month"] for field_card in state["field"])]
    candidates = matching or hand
    return sorted(
        candidates,
        key=lambda card: (
            -len([field_card for field_card in state["field"] if field_card["month"] == card["month"]]),
            -card_value(card),
            random.random(),
        ),
    )[0]


def enforce_timeouts(room):
    state = room["state"]
    if room["mode"] == "human" and not both_players_joined(room):
        return
    if start_countdown_remaining(state) > 0:
        return
    while not state["gameOver"] and time_remaining(state) <= 0:
        pending = state.get("pendingChoice")
        actor = pending["owner"] if pending else state["turn"]
        user_auto = bool(state.get("autoMode", {}).get(actor))
        if room["mode"] == "practice" and not user_auto:
            return
        if can_declare(state, state["turn"]):
            if should_auto_play_now(state, state["turn"]):
                record_auto_play(state, state["turn"], user_requested=user_auto)
                state["logs"].insert(0, f"{seat_label(state['turn'])}: Auto selected stop.")
                declare_stop(state, state["turn"])
                return
            reset_turn_timer(state)
            return

        if pending:
            owner = pending["owner"]
            locked = bool(state.get("autoPlayLocked", {}).get(owner))
            target = choose_capture_target(state, pending["played"])
            if not target:
                reset_turn_timer(state)
                return
            user_auto = bool(state.get("autoMode", {}).get(owner))
            record_auto_play(state, owner, user_requested=user_auto)
            reason = "Auto mode" if user_auto else "Auto lock" if locked else "Timeout"
            state["logs"].insert(0, f"{seat_label(owner)}: {reason} selected a capture.")
            resolve_choice(state, owner, target["id"])
        else:
            owner = state["turn"]
            locked = bool(state.get("autoPlayLocked", {}).get(owner))
            card = choose_auto_card(state, owner)
            if not card:
                reset_turn_timer(state)
                return
            user_auto = bool(state.get("autoMode", {}).get(owner))
            record_auto_play(state, owner, user_requested=user_auto)
            reason = "Auto mode" if user_auto else "Auto lock" if locked else "Timeout"
            state["logs"].insert(0, f"{seat_label(owner)}: {reason} played {describe_card(card)}.")
            play_card(state, owner, card)
        run_ai_if_needed(room)


def score_captured(cards):
    bright = [card for card in cards if card["kind"] == "bright"]
    ribbons = [card for card in cards if card["kind"] == "ribbon"]
    animals = [card for card in cards if card["kind"] == "animal"]
    pi = sum(card.get("pi", 0) for card in cards)
    detail = []
    total = 0

    has_rain_bright = any(card["month"] == 12 for card in bright)
    if len(bright) == 3:
        points = 2 if has_rain_bright else 3
        total += points
        detail.append(f"광 {len(bright)}장 {points}점")
    elif len(bright) == 4:
        total += 4
        detail.append("광 4장 4점")
    elif len(bright) == 5:
        total += 15
        detail.append("광 5장 15점")

    if len(ribbons) >= 5:
        points = len(ribbons) - 4
        total += points
        detail.append(f"띠 {len(ribbons)}장 {points}점")

    for months, label in [([1, 2, 3], "홍단"), ([6, 9, 10], "청단"), ([4, 5, 7], "초단")]:
        if all(any(card["month"] == month for card in ribbons) for month in months):
            total += 3
            detail.append(f"{label} 3점")

    if len(animals) >= 5:
        points = len(animals) - 4
        total += points
        detail.append(f"열끗 {len(animals)}장 {points}점")
    if all(any(card["month"] == month for card in animals) for month in [2, 4, 8]):
        total += 5
        detail.append("고도리 5점")

    if pi >= 10:
        points = pi - 9
        total += points
        detail.append(f"피 {pi}장 {points}점")

    return {
        "total": total,
        "bright": len(bright),
        "ribbons": len(ribbons),
        "animals": len(animals),
        "pi": pi,
        "detail": detail,
    }


def apply_go_bonus(score, go_count):
    if go_count <= 0:
        return {"total": score, "bonus": 0, "multiplier": 1}
    if go_count == 1:
        return {"total": score + 1, "bonus": 1, "multiplier": 1}
    if go_count == 2:
        return {"total": score + 2, "bonus": 2, "multiplier": 1}
    multiplier = go_count - 1
    return {"total": score * multiplier, "bonus": 0, "multiplier": multiplier}


def can_declare(state, owner):
    score = score_captured(state["captured"][owner])["total"]
    return score >= 7 and score > state.get("goScore", {}).get(owner, 0)


def choose_cpu_card(state):
    return sorted(
        state["hands"][OPPONENT],
        key=lambda card: (
            -len([field_card for field_card in state["field"] if field_card["month"] == card["month"]]),
            -card_value(card),
        ),
    )[0]


def card_value(card):
    if card["kind"] == "bright":
        return 5
    if card["kind"] == "animal":
        return 4
    if card["kind"] == "ribbon":
        return 3
    if card.get("pi") == 2:
        return 2
    return 1


def find_by_id(cards, card_id):
    return next((card for card in cards if card.get("id") == card_id), None)


def remove_by_id(cards, card_id):
    index = next((i for i, card in enumerate(cards) if card.get("id") == card_id), -1)
    if index >= 0:
        cards.pop(index)


def describe_card(card):
    return f"{card['month']}월 {card['name']}"


def seat_label(seat):
    return "선 플레이어" if seat == PLAYER else "후 플레이어"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/state":
            params = urllib.parse.parse_qs(parsed.query)
            has_room_param = "roomId" in params
            room_id = params.get("roomId", [DEFAULT_ROOM["id"]])[0]
            player_id = params.get("playerId", [DEFAULT_TOKEN])[0]
            room = get_room(room_id)
            if has_room_param and not room:
                self.send_json({"error": "방을 찾을 수 없습니다."}, status=404)
                return
            room = room or DEFAULT_ROOM
            seat = seat_for(room, player_id)
            if room["mode"] == "human" and not seat:
                self.send_json({"error": "방에서 나갔습니다."}, status=410)
                return
            seat = seat or PLAYER
            mark_seen(room, seat)
            self.send_json(public_state(room, seat))
            return
        if parsed.path == "/api/rooms":
            for room in ROOMS.values():
                if room["mode"] == "human":
                    enforce_rematch_timeout(room)
                    enforce_timeouts(room)
                    cleanup_disconnected_after_game(room)
            rooms = [
                {
                    "id": room["id"],
                    "mode": room["mode"],
                    "private": room.get("private", False),
                    "stake": room.get("stake", "0"),
                    "stakeUnit": "SL",
                    "open": room["mode"] == "human" and bool(room["players"][PLAYER]) and not room["players"][OPPONENT],
                }
                for room in ROOMS.values()
                if room["mode"] == "human" and room["players"][PLAYER] and not room.get("private")
            ]
            self.send_json({"rooms": rooms})
            return
        if parsed.path == "/styles/app.css":
            return self.send_response_file(ROOT / "styles" / "app.css", "text/css; charset=utf-8")
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")

        if parsed.path == "/api/rooms":
            try:
                room, seat, token = create_room(
                    payload.get("mode", "practice"),
                    payload.get("stake"),
                    payload.get("private"),
                    payload.get("password"),
                )
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return
            self.send_json(public_state(room, seat))
            return
        if parsed.path == "/api/rooms/join":
            room, seat, token, error = join_room(str(payload.get("roomId", "")).upper(), payload.get("password"))
            if error:
                self.send_json({"error": error}, status=400)
                return
            mark_seen(room, seat)
            self.send_json(public_state(room, seat))
            return
        if parsed.path == "/api/rooms/leave":
            leave_room(payload.get("roomId"), payload.get("playerId"))
            self.send_json({"ok": True})
            return
        if parsed.path == "/api/action":
            room = get_room(payload.get("roomId")) or DEFAULT_ROOM
            seat = seat_for(room, payload.get("playerId"))
            if room["mode"] == "human" and not seat:
                self.send_json({"error": "방에서 나갔습니다."}, status=410)
                return
            seat = seat or PLAYER
            mark_seen(room, seat)
            self.send_json(handle_action(room, seat, payload))
            return
        self.send_error(404)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_response_file(self, path, content_type):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def list_rooms():
    for room in ROOMS.values():
        if room["mode"] == "human":
            enforce_rematch_timeout(room)
            if both_players_joined(room):
                enforce_timeouts(room)
            cleanup_disconnected_after_game(room)
    return [
        {
            "id": room["id"],
            "mode": room["mode"],
            "private": room.get("private", False),
            "stake": room.get("stake", "0"),
            "stakeUnit": "SL",
            "open": room["mode"] == "human" and bool(room["players"][PLAYER]) and not room["players"][OPPONENT],
        }
        for room in ROOMS.values()
        if room["mode"] == "human" and room["players"][PLAYER]
    ]


def build_app():
    if FastAPI is None:
        raise RuntimeError("FastAPI is not installed. Run: pip install -r requirements.txt")

    app = FastAPI(title="Matgo Server")

    @app.get("/api/state")
    def api_state(roomId: str | None = None, playerId: str | None = None):
        has_room_param = roomId is not None
        room_id = roomId or DEFAULT_ROOM["id"]
        player_id = playerId or DEFAULT_TOKEN
        room = get_room(room_id)
        if has_room_param and not room:
            raise HTTPException(status_code=404, detail="방을 찾을 수 없습니다.")
        room = room or DEFAULT_ROOM
        seat = seat_for(room, player_id)
        if room["mode"] == "human" and not seat:
            raise HTTPException(status_code=410, detail="방에서 나간 사용자입니다.")
        seat = seat or PLAYER
        mark_seen(room, seat)
        return public_state(room, seat)

    @app.get("/api/rooms")
    def api_rooms():
        return {"rooms": list_rooms()}

    @app.post("/api/rooms")
    async def api_create_room(request: Request):
        payload = await request.json()
        try:
            room, seat, token = create_room(
                payload.get("mode", "practice"),
                payload.get("stake"),
                payload.get("private"),
                payload.get("password"),
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        return public_state(room, seat)

    @app.post("/api/rooms/join")
    async def api_join_room(request: Request):
        payload = await request.json()
        room, seat, token, error = join_room(str(payload.get("roomId", "")).upper(), payload.get("password"))
        if error:
            raise HTTPException(status_code=400, detail=error)
        mark_seen(room, seat)
        return public_state(room, seat)

    @app.post("/api/rooms/leave")
    async def api_leave_room(request: Request):
        payload = await request.json()
        leave_room(payload.get("roomId"), payload.get("playerId"))
        return {"ok": True}

    @app.post("/api/action")
    async def api_action(request: Request):
        payload = await request.json()
        room = get_room(payload.get("roomId")) or DEFAULT_ROOM
        seat = seat_for(room, payload.get("playerId"))
        if room["mode"] == "human" and not seat:
            raise HTTPException(status_code=410, detail="방에서 나간 사용자입니다.")
        seat = seat or PLAYER
        mark_seen(room, seat)
        return handle_action(room, seat, payload)

    @app.get("/styles/app.css")
    def app_css():
        return FileResponse(ROOT / "styles" / "app.css", media_type="text/css")

    @app.get("/")
    def index():
        return FileResponse(FRONTEND / "index.html")

    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
    return app


app = build_app() if FastAPI is not None else None


if __name__ == "__main__":
    if uvicorn is None:
        raise SystemExit("FastAPI/uvicorn is not installed. Run: pip install -r requirements.txt")
    uvicorn.run("server:app", host="127.0.0.1", port=5173, reload=False)
