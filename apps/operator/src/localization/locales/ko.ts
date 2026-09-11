/**
 * The Korean table — the reference: every other locale is type-checked
 * against this tree, and a key missing elsewhere falls back to it. Keys are
 * grouped by panel.
 */
export const KO_STRINGS = {
  appName: "통역 오퍼레이터",

  panel: {
    device: "입력 장치",
    level: "레벨 미터",
    join: "접속 정보",
    lanes: "레인 현황",
    control: "제어",
    brand: "행사 브랜드",
  },

  section: {
    live: "라이브",
    device: "입력 장치",
    join: "접속 정보",
    brand: "행사 브랜드",
    server: "서버 · 로그",
  },

  rail: {
    sub_live: "{{n}}개 레인",
    sub_noDevice: "장치를 선택하세요",
    sub_noAddress: "주소 없음",
    sub_unbranded: "설정 안 함",
    sub_server: "{{port}} 포트",
    sub_serverDown: "중지됨",
  },

  lang: {
    title: "언어",
    autoDetect:
      "원음 언어는 따로 정하지 않습니다. Gemini가 말하는 언어를 자동으로 인식해 선택한 각 언어로 통역하고, 이미 그 언어로 말하고 있으면 그대로 다시 들려줍니다.",
    offered: "제공할 언어",
    count: "{{n}}개 선택됨",
    passthrough: "원음 레인 (디버그)",
    passthroughHint:
      "켜면 참석자 목록 맨 아래에 번역하지 않은 현장 소리를 그대로 내보내는 레인이 추가됩니다. 오디오 경로 점검용이며 API 비용은 들지 않습니다.",
    remove: "{{code}} 제거",
    addCode: "목록에 없는 언어 코드",
    add: "추가",
    addHint:
      "위 목록은 자주 쓰는 언어만 추린 것입니다. Gemini가 지원하는 70여 개 언어 중 목록에 없는 것은 BCP-47 코드로 직접 넣으세요.",
    restartNeeded:
      "언어 변경은 서버를 다시 시작해야 적용됩니다. 진행 중에 다시 시작하면 듣고 있는 참석자의 소리가 잠시 끊깁니다.",
  },

  brand: {
    name: "행사 이름",
    namePlaceholder: "예: 새문안 주일예배",
    nameHint: "참석자 화면 상단에 표시됩니다. 비워 두면 앱 이름이 대신 표시됩니다.",
    accent: "강조 색",
    accentPlaceholder: "#3e8fd0",
    accentInvalid: "#3e8fd0 같은 색상 코드를 입력하세요.",
    accentHint:
      "참석자 화면 배경에서 읽히도록 자동으로 밝기를 조정합니다. 초록·노랑·빨강 상태 색은 바뀌지 않습니다.",
    logo: "로고",
    logoHint:
      "이미지를 끌어다 놓거나 파일을 선택하세요. 앱 안에 복사되므로 원본 파일을 지워도 됩니다.",
    logoPick: "파일 선택",
    logoClear: "로고 제거",
    logoNone: "선택된 파일 없음",
    theme: "화면 모드",
    themeDefault: "기본값 (참석자 기기 설정에 맞춤)",
    themeDark: "어두운 화면",
    themeLight: "밝은 화면",
    themeAuto: "참석자 기기 설정에 맞춤",
    themeHint: "어두운 예배당에서는 어두운 화면이, 낮 행사에서는 밝은 화면이 읽기 좋습니다.",
    appliesOnRefresh:
      "변경 사항은 바로 적용됩니다. 이미 듣고 있는 참석자는 화면을 새로 고쳐야 보입니다.",
    restart: "서버 다시 시작",
  },

  device: {
    select: "장치 선택",
    none: "장치를 선택하세요",
    refresh: "장치 목록 새로 고침",
    channel: "채널",
    requestedChannels: "요청 채널 수",
    requestedChannelsHint:
      "장치가 지원하는 최대 채널 수를 넣으세요. 맥에서는 18, 윈도우 페어 장치에서는 2입니다.",
    channelCount: "요청 {{requested}}채널 · 실제 {{achieved}}채널",
    // "processed", not "context": i18next reserves {{context}} for its own
    // contextual-pluralization feature, and react-i18next's typed t() rejects
    // a number there because of it.
    sampleRate: "샘플레이트 — 장치 {{device}} Hz · 처리 {{processed}} Hz",
    dspOff: "DSP 꺼짐 확인됨 — 에코 제거 · 잡음 억제 · 자동 게인",
    feedbackWarning:
      "에코 제거가 꺼져 있으므로, 한 대의 노트북에서 스피커로 번역 음성을 들으며 테스트하면 마이크가 그 소리를 다시 잡아 번역이 끝없이 반복됩니다. 테스트할 때는 이어폰을 쓰거나 참석자 화면을 음소거하세요.",
    permissionNeeded: "마이크 권한이 필요합니다. 권한을 허용하면 장치 이름이 표시됩니다.",
  },

  warn: {
    channel_downmix:
      "요청한 {{requested}}채널 대신 {{achieved}}채널만 열렸습니다. 소프트웨어로 채널을 고를 수 없으니 믹서에서 해당 채널을 USB 송출 페어로 라우팅하세요.",
    channel_out_of_range:
      "선택한 {{selected}}번 채널은 실제 채널 수({{achieved}})를 벗어납니다. 채널 번호를 다시 고르거나 믹서에서 라우팅하세요.",
    dsp_enabled: "경고: 브라우저 DSP가 켜져 있습니다 — {{flags}}. 번역 품질이 떨어집니다.",
    dsp_unreported: "브라우저가 DSP 상태를 보고하지 않았습니다 — {{flags}}. 확인할 수 없습니다.",
    sample_rate_mismatch: "16000 Hz를 요청했지만 {{actual}} Hz로 열렸습니다.",
  },

  error: {
    deviceLost: "오디오 장치 연결이 끊겼습니다. 캡처를 중지했습니다. 장치를 다시 선택하세요.",
    deviceOpenFailed:
      "선택한 장치를 열 수 없습니다: {{reason}}. 다른 장치를 고르거나 케이블을 확인하세요.",
    workletFailed: "오디오 처리 모듈을 불러오지 못했습니다: {{reason}}. 앱을 다시 시작하세요.",
    ingestDisconnected: "서버 연결이 끊겼습니다. 재연결 중입니다. 캡처는 계속됩니다.",
  },

  level: {
    rms: "RMS",
    peak: "피크",
    clipping: "클리핑",
    idle: "정지됨",
  },

  join: {
    scan: "휴대폰으로 QR을 스캔하세요",
    interface: "네트워크 인터페이스",
    noAddress: "LAN 주소를 찾지 못했습니다. 유선 또는 무선 네트워크에 연결하세요.",
    externalSeen: "외부 접속 확인됨",
    externalNone: "아직 외부 접속이 확인되지 않았습니다",
    recheck: "도달 여부 다시 확인",
  },

  reach: {
    title: "도달 여부",
    // network_profile/firewall_rule read the laptop's own config and can be
    // wrong (a rule can exist and still not match the active adapter);
    // external_hit is the only one of the three backed by a phone that
    // actually reached the server. Tagged separately so a "참고" line is never
    // mistaken for the same kind of confirmation as "실측".
    advisory: "참고",
    proof: "실측",
    profile_pass: "네트워크 프로필: {{alias}} — 개인(Private)",
    profile_warn:
      "경고: {{alias}} 네트워크가 공용(Public)으로 분류되어 있습니다. 휴대폰이 접속하지 못합니다.",
    profile_unknown: "네트워크 프로필을 확인하지 못했습니다.",
    rule_pass: "방화벽 인바운드 허용 규칙 발견: {{name}}",
    rule_warn:
      "경고: TCP {{port}} 인바운드 허용 규칙을 찾지 못했습니다. 휴대폰이 페이지를 열지 못합니다.",
    rule_unknown: "방화벽 규칙을 확인하지 못했습니다.",
    external_pass: "외부 기기가 실제로 접속했습니다.",
    external_warn: "아직 외부 기기 접속 기록이 없습니다. 휴대폰으로 직접 확인하세요.",
    macos: "macOS에서는 Windows 방화벽 점검을 실행할 수 없습니다. 행사용 노트북에서 확인하세요.",
  },

  lanes: {
    language: "언어",
    listeners: "청취자 수",
    // The figure that moves when someone mutes; listeners (max of audio and
    // transcript subscriptions) does not, so muting is invisible without
    // this column next to it.
    audioListeners: "오디오 청취자 수",
    status: "상태",
    laneDrops: "레인 드롭",
    listenerDrops: "청취자 드롭",
    sessionState: "세션 상태",
    empty: "열린 레인이 없습니다",
    laneDropsHint:
      "레인 드롭은 레인이 종료된 뒤에도 들어온 오디오 프레임 수입니다. 오디오 품질과는 무관하니 이 수치만으로 문제를 의심하지 마세요.",
  },

  laneState: {
    starting: "시작 중",
    live: "실행 중",
    reconnecting: "재연결 중",
    error: "오류",
  },

  laneOpen: {
    open: "열림",
    waiting: "대기",
    error: "오류",
  },

  control: {
    start: "시작",
    stop: "중지",
    serverTitle: "서버 상태",
    server_stopped: "서버 중지됨",
    server_starting: "서버 시작 중",
    server_listening: "서버 실행 중 — 포트 {{port}}",
    server_crashed: "서버가 비정상 종료되었습니다 — 재시작 {{restarts}}회",
    server_giving_up: "서버가 반복해서 종료됩니다. 로그를 확인하세요.",
    server_external: "외부 서버 사용 중 (--external-server)",
    restart: "서버 재시작",
    apiKey: "Gemini API 키",
    apiKeyReplace: "새 키를 붙여넣어 교체",
    apiKeySet: "설정됨",
    apiKeyMissing: "설정되지 않음 — 번역 레인이 열리지 않습니다",
    save: "저장",
  },

  // The header strip that never scrolls away: capture, server, head count,
  // and — only while there is one — a count of lanes in error. `n` rather
  // than `count` so i18next does not go looking for plural-suffixed keys.
  strip: {
    listenersLabel: "청취자",
    capturing: "캡처 중",
    captureStopped: "캡처 정지됨",
    listeners: "청취자 {{n}}",
    errorLanes: "오류 레인 {{n}}",
  },

  // The sixth surface, added beyond the spec's five panels so the server's
  // stdout/stderr — otherwise invisible once the app is packaged and there is
  // no terminal — is readable from inside the window.
  serverLog: {
    title: "서버 로그",
    empty: "로그가 없습니다",
  },

  // The rail's footer: app-level things, never event controls.
  footer: {
    language: "표시 언어",
    version: "버전 {{version}}",
  },

  // Auto-update. Never a dialog: a toast the engineer acts on when the room allows.
  update: {
    ready: "업데이트 v{{version}} 준비됨",
    readyHint: "다시 시작하면 적용됩니다.",
    restart: "다시 시작",
    restartLink: "다시 시작하여 업데이트",
    check: "업데이트 확인",
    checking: "확인 중…",
    downloading: "내려받는 중…",
  },
} as const;

/**
 * A locale's shape: the Korean tree with every leaf widened to `string`. A
 * missing or extra key in another locale is a compile error, not a blank in
 * the window at a sound desk.
 */
export type StringTable<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : StringTable<T[K]>;
};
