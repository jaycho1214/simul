import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Single locale. The operator app is used by one Korean-speaking sound engineer
 * on one laptop; a language switcher would only create a way to ship an event
 * in the wrong language. Keys are grouped by panel.
 */
export const KO_STRINGS = {
  appName: "통역 오퍼레이터",

  panel: {
    device: "입력 장치",
    level: "레벨 미터",
    join: "접속 정보",
    lanes: "레인 현황",
    control: "제어",
  },

  device: {
    select: "장치 선택",
    none: "장치를 선택하세요",
    refresh: "장치 목록 새로 고침",
    channel: "채널",
    requestedChannels: "요청 채널 수",
    requestedChannelsHint: "장치가 지원하는 최대 채널 수를 넣으세요. 맥에서는 18, 윈도우 페어 장치에서는 2입니다.",
    channelCount: "요청 {{requested}}채널 · 실제 {{achieved}}채널",
    sampleRate: "샘플레이트 — 장치 {{device}} Hz · 처리 {{context}} Hz",
    dspOff: "DSP 꺼짐 확인됨 — 에코 제거 · 잡음 억제 · 자동 게인",
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
    deviceOpenFailed: "선택한 장치를 열 수 없습니다: {{reason}}. 다른 장치를 고르거나 케이블을 확인하세요.",
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
    profile_pass: "네트워크 프로필: {{alias}} — 개인(Private)",
    profile_warn: "경고: {{alias}} 네트워크가 공용(Public)으로 분류되어 있습니다. 휴대폰이 접속하지 못합니다.",
    profile_unknown: "네트워크 프로필을 확인하지 못했습니다.",
    rule_pass: "방화벽 인바운드 허용 규칙 발견: {{name}}",
    rule_warn: "경고: TCP {{port}} 인바운드 허용 규칙을 찾지 못했습니다. 휴대폰이 페이지를 열지 못합니다.",
    rule_unknown: "방화벽 규칙을 확인하지 못했습니다.",
    external_pass: "외부 기기가 실제로 접속했습니다.",
    external_warn: "아직 외부 기기 접속 기록이 없습니다. 휴대폰으로 직접 확인하세요.",
    macos: "macOS에서는 Windows 방화벽 점검을 실행할 수 없습니다. 행사용 노트북에서 확인하세요.",
  },

  lanes: {
    language: "언어",
    listeners: "청취자 수",
    status: "상태",
    laneDrops: "레인 드롭",
    listenerDrops: "청취자 드롭",
    sessionState: "세션 상태",
    empty: "열린 레인이 없습니다",
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
    apiKeySet: "설정됨",
    apiKeyMissing: "설정되지 않음 — 번역 레인이 열리지 않습니다",
    save: "저장",
  },
} as const;

void i18n.use(initReactI18next).init({
  lng: "ko",
  fallbackLng: "ko",
  supportedLngs: ["ko"],
  interpolation: { escapeValue: false },
  resources: { ko: { translation: KO_STRINGS } },
});

export default i18n;
