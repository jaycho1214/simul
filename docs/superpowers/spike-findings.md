# Spike Findings

Each spike appends a section here. Every section ends with a dated **Decision**
line.

> No spike run output exists in this repository as of Task 10 (2026-09-10).
> The three throwaway probes described in `docs/superpowers/plans/2026-09-10-spikes.md`
> were never executed and recorded here, so there is nothing genuine to
> transcribe into this section. Fabricating spike results was not done. If
> the spikes still need to run, do that first — the manual rehearsal
> checklist below assumes their conclusions (chunked `<audio>` WebM/Opus
> playback on iOS Safari, the measured end-to-end latency for
> `TRANSCRIPT_DELAY_MS`) are already validated, and several checklist items
> exist specifically to catch it if that assumption is wrong.

---

## Task 10 — Manual rehearsal checklist (attendee web app)

**Status: NOT YET RUN.** This checklist was written as Task 10's deliverable
— the list of things a jsdom test fundamentally cannot decide, because
jsdom has no media pipeline, no real network stack, and no hardware silent
switch. It has not been executed against real phones. An automated agent
has no phone, no venue wifi, and no hands to flip a silent switch with; a
person has to actually do this, on real hardware, before the first live
event. Do not treat this document as evidence the app works on a phone —
only a completed run of this checklist is that evidence.

This is written for the person holding the phone, not for a developer
reading source. Each item says exactly what to do and exactly what
"passing" looks like. Record the actual result (pass / fail / notes) in the
**Results** table at the bottom as you go — that table, filled in, is what
makes this checklist a real deliverable instead of a wish list.

### Setup (do this once, before the first checklist item)

1. On the laptop that will run the server during the event:
   ```
   pnpm --filter @tongyeok/web build
   ```
   Confirm `apps/web/dist/index.html` and hashed files under
   `apps/web/dist/assets/` exist.
2. Find the laptop's LAN IP address (the address phones on the same wifi
   will use): `ipconfig getifaddr en0` on macOS, or check System
   Settings → Wi-Fi → Details. Write it down — every item below refers to
   it as `<lan-ip>`.
3. Start the server with the built app wired in:
   ```
   GEMINI_API_KEY=<real key> INGEST_TOKEN=<token> WEB_ROOT=apps/web/dist pnpm --filter @tongyeok/server dev
   ```
4. From a laptop browser (not a phone yet), confirm `http://127.0.0.1:8080/`
   loads the picker and `http://127.0.0.1:8080/config` returns JSON. If
   either fails, stop — nothing below will work either, and the problem is
   on the laptop, not the phone.
5. Make sure the laptop's firewall allows inbound connections on the
   server's port from the local network (macOS will prompt for this the
   first time; allow it).
6. Have the source audio (a mic, or a talk actually happening) feeding the
   operator app / ingest pipeline so lanes have something to translate.

### Checklist

- [ ] **1. An iPhone loads the picker over plain HTTP.**
      On an iPhone connected to the venue wifi (not cellular — turn off
      cellular data or use airplane mode + wifi to be sure), open Safari and
      go to `http://<lan-ip>:8080`. **Pass:** the language picker appears
      within a couple of seconds, with no certificate warning (there is no
      HTTPS here, so there should be no such warning) and no "not secure"
      interstitial blocking the page.

- [ ] **2. Tapping a language starts real audio within a few seconds.**
      Tap a language on the picker. **Pass:** audio is audible (with the
      ringer on, volume up) within roughly 2–5 seconds of the tap. **If it does
      not start at all, or Safari shows an error instead of playing** — stop
      and re-read Spike 3's conclusion in this document's spike sections above.
      If that conclusion said chunked WebM/Opus `<audio>` playback works on iOS
      Safari and it in fact does not on the phone in your hand, that conclusion
      was wrong, and the CAF fallback described in the server plan's Task 5 is
      needed before anything else in this checklist is worth running — a
      different codec path changes several of the checks below.

- [ ] **3. The silent switch and the yellow notice.**
      Flip the iPhone's physical silent switch (the small switch on the left
      edge) to silent (orange visible). With a language already playing,
      confirm there is **no sound** — none, not even a brief blip — while
      silent is on. Then look at the screen without scrolling: **pass** means
      a visible yellow/warning-colored notice about the silent switch is
      visible above the fold, on the smallest phone available (an iPhone SE or
      similarly small screen if one is on hand; the largest available iPhone
      if not, noting in Results which model was used).

- [ ] **4. Background playback with the screen off.**
      With headphones plugged in (or connected via Bluetooth) and a language
      playing, lock the phone's screen and put it in a pocket. Wait 5 minutes.
      **Pass:** audio is still audible in the headphones at the 5-minute mark,
      uninterrupted. No wake lock exists in this app by design — this check
      is what proves that omission was safe, not a check that something else
      is compensating for it.

- [ ] **5. Mute stops audio and actually closes the HTTP stream.**
      On the laptop, run
      `lsof -nP -iTCP:8080 -sTCP:ESTABLISHED | wc -l` and note the count.
      On the phone, tap 음소거 / Mute. **Pass, part one:** audio stops
      immediately. **Pass, part two:** re-run the same `lsof` command — the
      count has dropped by exactly one (the closed `/stream/<lang>.webm`
      connection). **Pass, part three:** on the operator dashboard, the
      listener count (청취자 수) for that language's lane is unchanged — the
      WebSocket to `/listen` is a separate connection from the muted
      `<audio>` stream, and muting must not be mistaken by the operator's view
      for someone leaving.

- [ ] **6. Unmute rejoins at the live edge, not two minutes behind.**
      Immediately after item 5, start a **second** phone listening to the
      same language and leave it playing continuously (never mute it) as a
      reference clock. Wait two minutes on the first (muted) phone, then tap
      소리 켜기 / Unmute. **Pass:** within a few seconds, what the first phone
      says is in step with what the second phone is currently saying — not
      replaying the two minutes it missed. Two phones sitting next to each
      other should sound like the same live broadcast, not staggered.

- [ ] **7. Backgrounding the transcript tab reconnects and repopulates.**
      With the app open and a transcript scrolling, background the browser tab
      (switch apps, or lock the phone) for three minutes, then return to it.
      **Pass:** the transcript reconnects on its own and repopulates from
      `history` — no visible gap in the middle of the conversation, and no
      frozen list that stopped updating minutes ago. **Fail** looks like a
      transcript that either has a blank gap where the backgrounded time was,
      or one that never resumes scrolling at all.

- [ ] **8. Wifi edge-of-range recovery.**
      While a language is playing, physically walk toward the edge of the
      venue wifi's range until audio audibly stalls or stutters, then walk
      back toward the access point. **Pass:** playback recovers on its own
      once back in range, without needing to mute/unmute or reload the page.

- [ ] **9. Repeat on Android Chrome.**
      Repeat items 1 (loads over plain HTTP), 4 (background playback, screen
      off, 5 minutes), and 6 (unmute rejoins at the live edge) on an Android
      phone in Chrome. **Pass criteria are identical** to the iPhone versions
      above. Record the Android model and Chrome version used.

- [ ] **10. Transcript readability and scroll behavior in the room.**
      Hold the phone at a normal arm's-length reading distance under the
      actual venue lighting (not a bright office — the room the event will
      actually be in, or as close a proxy as available). **Pass:** the
      transcript text is legible without squinting. Then, mid-event, scroll up
      through older lines: **pass** means the list stops auto-scrolling to the
      bottom while you're reading (it does not chase new lines out from under
      your thumb). Scroll back down to the bottom: **pass** means it re-pins
      and resumes auto-scrolling to new lines.

- [ ] **11. Transcript delay is tuned so text does not arrive before audio.**
      Set `TRANSCRIPT_DELAY_MS` in the server's environment to Spike 2's
      measured end-to-end latency value (see that spike's section above),
      restart the server, and repeat item 2 while watching the transcript and
      listening to the audio together. **Pass:** the translated line appears
      on screen at the same time as, or after, the matching audio is heard —
      never noticeably before it, which would spoil the audio for anyone
      reading ahead. **Record the `TRANSCRIPT_DELAY_MS` value that worked** in
      the Results table; that value is what ships to the actual event's
      `.env`.

- [ ] **12. `navigator.mediaSession` and OS transport controls (observe only).**
      With audio playing, check the phone's lock screen / notification shade
      for OS media transport controls (play/pause/skip artwork). **This is a
      cosmetic finding to record, not a defect to fix** — the spec calls for
      verifying rather than assuming, and nothing in the app depends on the
      answer either way. Record what was actually observed on each platform
      (iOS Safari, Android Chrome): did generic transport controls appear, did
      `mediaSession` metadata show, or did nothing show at all, given this is
      a non-secure (`http://`) origin.

- [ ] **13. Load test: 20+ real phones.**
      Get at least 20 phones (the more the better, up to the 60-phone target)
      onto the picker at `http://<lan-ip>:8080` simultaneously. First have them
      all sit on the picker screen (not yet playing) for a minute. Then have
      them all pick the **same** language at once. Then redistribute them
      across the offered languages roughly evenly. At each stage, watch the
      operator dashboard for 레인 드롭 (lane drops) and 청취자 드롭 (listener
      drops). **Pass:** no lane drop events, and the listener-drop count stays
      at zero (or matches only phones that were deliberately closed/backed
      out), across all three stages. Note the actual phone count used — if
      fewer than 20 were available, say so plainly rather than rounding up.

### Results

Fill in as each item is actually run. Do not check the boxes above until a
row exists here for that item.

| #   | Item                                        | Result | Device(s) used    | Notes |
| --- | ------------------------------------------- | ------ | ----------------- | ----- |
| 1   | iPhone loads picker over HTTP               |        |                   |       |
| 2   | Audio starts within a few seconds           |        |                   |       |
| 3   | Silent switch + yellow notice               |        |                   |       |
| 4   | Background playback, 5 min                  |        |                   |       |
| 5   | Mute stops audio + closes stream            |        |                   |       |
| 6   | Unmute rejoins at live edge                 |        |                   |       |
| 7   | Backgrounded tab reconnects                 |        |                   |       |
| 8   | Wifi edge-of-range recovery                 |        |                   |       |
| 9   | Android Chrome repeat (1, 4, 6)             |        |                   |       |
| 10  | Transcript readability + scroll pin         |        |                   |       |
| 11  | TRANSCRIPT_DELAY_MS tuned                   |        | value used: ____  |       |
| 12  | mediaSession / transport controls (observe) |        |                   |       |
| 13  | 20+ phone load test                         |        | phone count: ____ |       |

**Decision:** Not yet made — this checklist has not been run against real
hardware. Do not schedule a live event on this system until every row above
has a recorded result and every "Pass" criterion in the checklist text has
actually been met, item 2's iOS-audio check and item 13's load test above
all others.
