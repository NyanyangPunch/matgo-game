# 맞고 연습장

프론트엔드와 백엔드를 분리한 맞고 MVP입니다.
처음 화면에서 컴퓨터와 연습게임을 바로 시작하거나, 사람과 1:1 맞고 방을 만들어 열린 방 목록에서 입장할 수 있습니다.

## 실행

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" backend\server.py
```

브라우저에서 `http://127.0.0.1:5173`을 엽니다.

## 구조

```txt
backend/       게임 상태, 룰 검증, 컴퓨터 턴, HTTP API
frontend/      화면 렌더링, 카드 클릭, 액션 전송
frontend/assets/hwatu-months.png
               화투풍 월별 카드 이미지 시트
shared/        이후 공용 규칙/타입 문서나 생성 코드 배치 예정
```

## 방 구조

- `연습게임`: 별도 목록 방을 만들지 않고 컴퓨터와 1:1로 바로 진행합니다.
- `사람과 맞고`: 방을 만든 사람이 선 플레이어가 되고, 상대는 로비의 공개방 카드로 입장합니다.
- 현재는 같은 서버에 접속한 브라우저끼리 공개방 목록 또는 초대 주소로 플레이하는 구조입니다.

카드 이미지는 `frontend/assets/cards/`의 Wikimedia Commons Hanafuda SVG 세트를 사용합니다.
해당 자산은 Louie Mantia 외 기여자의 CC BY-SA 4.0 라이선스 이미지입니다.
출처: https://commons.wikimedia.org/wiki/File:Hanafuda_January_Hikari_Alt.svg

이전 실험용 생성 이미지 시트는 `frontend/assets/hwatu-months.png`에 남아 있지만, 현재 화면에서는 48장 개별 SVG를 사용합니다.
