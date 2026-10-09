# 자연스러운 대화 테스트

`npm run test:conversation` 실행 후 <http://127.0.0.1:8790>을 엽니다.
Chrome 확장 프로그램을 다시 로드하고 이 탭의 자막을 시작한 뒤 오디오를 재생합니다.

- 57.7초, 두 화자, 서로 다른 8개 발화, 반복 없는 영어 대화입니다.
- 주말 약속, 시간 변경, 음식, 비가 올 때의 대안을 자연스럽게 이어갑니다.
- 페이지에서 기준 원문과 발화 시간을 펼쳐 문장 누락을 비교할 수 있습니다.
- `conversation.wav`는 로컬 macOS의 Samantha/Daniel 음성으로 만든 합성 음성입니다.
- 재생성: `python3 tests/fixtures/conversation/generate.py` (설치된 두 음성 필요).
- 자막 표시 회귀 검사: `npm run test:captions-stability`.

표시 회귀 검사는 합성 자막을 입력하는 브라우저 테스트이며 실제 음성 인식·번역 정확도 검사는 아닙니다.

화자 모델 검사: `npm run test:speakers`.
실제 탭 캡처·받아쓰기·번역·화면 검사: `npm run test:conversation:live`.
모델 선택, 준비 조건, 검증 범위는 `docs/verification/captions/conversation-speakers.md`에 기록했습니다.
