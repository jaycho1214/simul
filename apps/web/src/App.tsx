import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioStreamController,
  type AudioStatus,
} from "./audio/audio-stream-controller.ts";
import { fetchConfig, serverBaseUrls, type WebConfig } from "./config.ts";
import { endonym, languageRows } from "./languages.ts";
import { S } from "./strings.ts";
import { LanguagePicker } from "./components/LanguagePicker.tsx";
import { ListenScreen } from "./components/ListenScreen.tsx";
import { useListenSession } from "./transcript/use-listen-session.ts";

// The page is served by the same process that serves audio and transcripts, so
// the origins are fixed for the lifetime of the tab. Computed once so they are
// stable dependencies.
const BASE = serverBaseUrls(window.location);

function ListenContainer(props: {
  lang: string;
  controller: AudioStreamController;
  transcriptDelayMs: number;
  onBack: () => void;
}) {
  const { state, retry } = useListenSession({
    lang: props.lang,
    wsBaseUrl: BASE.ws,
    transcriptDelayMs: props.transcriptDelayMs,
  });

  const [audioStatus, setAudioStatus] = useState<AudioStatus>(
    props.controller.status,
  );
  const [muted, setMuted] = useState(props.controller.isMuted);

  useEffect(
    () => props.controller.onStatusChange(setAudioStatus),
    [props.controller],
  );

  const toggleMute = () => {
    if (props.controller.isMuted) {
      void props.controller.unmute();
      setMuted(false);
    } else {
      props.controller.mute();
      setMuted(true);
    }
  };

  return (
    <ListenScreen
      lang={props.lang}
      endonym={endonym(props.lang)}
      muted={muted}
      audioStatus={audioStatus}
      transcript={state}
      onToggleMute={toggleMute}
      onBack={props.onBack}
      onRetry={retry}
    />
  );
}

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [config, setConfig] = useState<WebConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [controller, setController] = useState<AudioStreamController | null>(null);
  const [lang, setLang] = useState<string | null>(null);

  const load = useCallback(() => {
    setConfigFailed(false);
    fetchConfig(BASE.http).then(setConfig, () => setConfigFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pick = (picked: string) => {
    const element = audioRef.current;
    if (!element) return;

    const next = new AudioStreamController({
      element,
      httpBaseUrl: BASE.http,
      lang: picked,
    });
    // Synchronous, inside the tap. iOS grants playback only from within a user
    // gesture, so nothing may be awaited before this call. There is no
    // auto-start path anywhere else in the app.
    void next.start();

    setController(next);
    setLang(picked);
  };

  const back = () => {
    controller?.destroy();
    setController(null);
    setLang(null);
  };

  let body: ReactNode;
  if (configFailed) {
    body = (
      <main className="notice-screen">
        <p className="notice-text">{S.configError}</p>
        <button type="button" className="notice-retry" onClick={load}>
          {S.retry}
        </button>
      </main>
    );
  } else if (!config) {
    body = (
      <main className="notice-screen">
        <p className="notice-text">{S.connecting}</p>
      </main>
    );
  } else if (lang && controller) {
    body = (
      <ListenContainer
        lang={lang}
        controller={controller}
        transcriptDelayMs={config.transcriptDelayMs}
        onBack={back}
      />
    );
  } else {
    body = <LanguagePicker rows={languageRows(config)} onPick={pick} />;
  }

  return (
    <>
      {/* Mounted for the whole session so the ref exists before the tap that
          must call play() on it. */}
      <audio ref={audioRef} className="audio-sink" playsInline preload="none" />
      {body}
    </>
  );
}
