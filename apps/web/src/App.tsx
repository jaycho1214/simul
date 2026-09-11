import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioController, AudioStatus } from "./audio/audio-controller.ts";
import { createAudioController } from "./audio/create-audio-controller.ts";
import { UNBRANDED, fetchConfig, serverBaseUrls, type Brand, type WebConfig } from "./config.ts";
import { endonym, languageRows } from "./languages.ts";
import { S } from "./strings.ts";
import { Bilingual } from "./components/Bilingual.tsx";
import { LanguagePicker } from "./components/LanguagePicker.tsx";
import { ListenScreen } from "./components/ListenScreen.tsx";
import { useListenSession } from "./transcript/use-listen-session.ts";
import { useBrand } from "./use-brand.ts";
import { readPreference, writePreference, type Preference } from "./theme.ts";

// The page is served by the same process that serves audio and transcripts, so
// the origins are fixed for the lifetime of the tab. Computed once so they are
// stable dependencies.
const BASE = serverBaseUrls(window.location);

function ListenContainer(props: {
  brand: Brand;
  lang: string;
  controller: AudioController;
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
      brand={props.brand}
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
  const [controller, setController] = useState<AudioController | null>(null);
  const [lang, setLang] = useState<string | null>(null);

  // UNBRANDED until /config lands, so the first paint is the stylesheet's own
  // defaults rather than an unstyled page.
  const brand = config?.brand ?? UNBRANDED;
  const [preference, setPreference] = useState<Preference>(readPreference);
  useBrand(brand, preference);

  const choosePreference = useCallback((next: Preference) => {
    writePreference(next);
    setPreference(next);
  }, []);

  const load = useCallback(() => {
    setConfigFailed(false);
    fetchConfig(BASE.http).then(setConfig, () => setConfigFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * While the reader is still on the picker, re-read /config so the moment the
   * operator presses 시작 the rows come alive on their own. Nobody in a hall is
   * going to think to pull-to-refresh, and an attendee app that has to be
   * reloaded to become usable is one the ushers end up explaining.
   *
   * Stops once a language is chosen: from there the listen socket reports the
   * lane's state, and this has nothing left to say.
   */
  useEffect(() => {
    if (lang !== null) return;
    const id = setInterval(() => {
      // A failed poll is not news — the next one is four seconds away, and
      // blanking a working picker over one dropped request would be worse
      // than showing a slightly stale one.
      fetchConfig(BASE.http).then(setConfig, () => {});
    }, 4000);
    return () => clearInterval(id);
  }, [lang]);

  /**
   * Choosing a language is a navigation as far as the reader is concerned, so
   * it gets a history entry and the phone's own back gesture honours it.
   * Without one, an iOS edge-swipe leaves the venue's page entirely, mid
   * service, with nothing to get back to it but the QR code on the wall.
   *
   * The entry carries no URL change: the page is served from `/` over plain
   * HTTP, and a path that exists only in this tab would 404 on a reload.
   */
  const pick = (picked: string) => {
    const element = audioRef.current;
    if (!element || !config) return;

    window.history.pushState({ screen: "listen" }, "");

    // MediaSource where the browser supports it (about a second behind the
    // room), the plain element elsewhere (behind by the server's prime).
    const next = createAudioController({
      element,
      httpBaseUrl: BASE.http,
      lang: picked,
      streamPrimeMs: config.streamPrimeMs,
      // The lane's media clock, for the plain path only: playback there runs at
      // exactly 1.0x on a non-seekable response, so lag lost to a stall is never
      // recovered on its own and would otherwise grow all event. It rejoins
      // instead once it has fallen further behind than the prime explains.
      liveMediaSeconds: async () => {
        const res = await fetch(`${BASE.http}/stats`, { cache: "no-store" });
        if (!res.ok) return null;
        const stats = await res.json();
        const ms = stats?.lanes?.[picked]?.mediaMs;
        return typeof ms === "number" ? ms / 1000 : null;
      },
    });
    // Synchronous, inside the tap. iOS grants playback only from within a user
    // gesture, so nothing may be awaited before this call. There is no
    // auto-start path anywhere else in the app.
    void next.start();

    setController(next);
    setLang(picked);
  };

  /**
   * Idempotent: the button and the gesture both end up here, and a reader who
   * taps 변경 and swipes at the same moment must not tear the controller down
   * twice.
   */
  const leave = useCallback(() => {
    setController((current) => {
      current?.destroy();
      return null;
    });
    setLang(null);
  }, []);

  // The button pops the entry rather than leaving state and history out of
  // step; the listener below is what actually returns to the picker, so both
  // routes behave identically.
  const back = () => window.history.back();

  useEffect(() => {
    window.addEventListener("popstate", leave);
    return () => window.removeEventListener("popstate", leave);
  }, [leave]);

  let body: ReactNode;
  if (configFailed) {
    body = (
      <main className="notice-screen">
        <p className="notice-text">
          <Bilingual text={S.configError} />
        </p>
        <button type="button" className="notice-retry" onClick={load}>
          {S.retry}
        </button>
      </main>
    );
  } else if (!config) {
    body = (
      <main className="notice-screen">
        <p className="notice-text">
          <Bilingual text={S.connecting} />
        </p>
      </main>
    );
  } else if (lang && controller) {
    body = (
      <ListenContainer
        brand={brand}
        lang={lang}
        controller={controller}
        transcriptDelayMs={config.transcriptDelayMs}
        onBack={back}
      />
    );
  } else {
    body = (
      <LanguagePicker
        brand={brand}
        live={config.live}
        preference={preference}
        onPreferenceChange={choosePreference}
        rows={languageRows(config)}
        onPick={pick}
      />
    );
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
