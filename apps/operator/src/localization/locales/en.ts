import type { KO_STRINGS, StringTable } from "./ko.ts";

/**
 * English, key for key with the Korean table. `satisfies` makes a missing key
 * a compile error. Counts use "{{n}}" with wording that reads for 1 as well
 * as many, since the app deliberately never uses i18next's `count` plurals.
 */
export const EN_STRINGS = {
  appName: "Simul Operator",

  panel: {
    device: "Input device",
    level: "Level meter",
    join: "Join info",
    lanes: "Lanes",
    control: "Control",
    brand: "Event brand",
  },

  section: {
    live: "Live",
    device: "Input device",
    join: "Join info",
    brand: "Event brand",
    server: "Server · Log",
  },

  rail: {
    sub_live: "Lanes: {{n}}",
    sub_noDevice: "Choose a device",
    sub_noAddress: "No address",
    sub_unbranded: "Not set",
    sub_server: "Port {{port}}",
    sub_serverDown: "Stopped",
  },

  lang: {
    title: "Languages",
    autoDetect:
      "There is no source language to choose. Gemini detects the language being spoken, translates it into each language you offer, and passes speech that is already in that language straight through.",
    offered: "Languages to offer",
    count: "{{n}} selected",
    speakerLanguage:
      "Leave the speaker's own language out of the list. Anyone who picks it opens a lane that just repeats the speaker untranslated, and it costs the same API usage as any other lane for as long as someone listens. For a Korean sermon, turn Korean off.",
    passthrough: "Original lane (debug)",
    passthroughHint:
      "Adds a lane at the bottom of the attendee list carrying the room's sound untranslated. For checking the audio path; it costs nothing in API usage.",
    remove: "Remove {{code}}",
    addCode: "Language code not in the list",
    add: "Add",
    addHint:
      "The list above holds only the commonly used languages. Gemini supports about 70; enter any other as a BCP-47 code.",
    restore: "Add {{code}} back",
    pendingRemoval: "removed on restart",
    liveHint:
      "An added language is offered at once and appears on attendee screens within seconds. A removal takes effect after the server restarts.",
    removalNeedsRestart:
      "Removed items ({{codes}}) stay on attendee screens until the server restarts; they are still being served until then. Restarting mid-event briefly cuts the audio for everyone listening.",
  },

  brand: {
    name: "Event name",
    namePlaceholder: "e.g. Sunday Service",
    nameHint: "Shown at the top of the attendee screen. Leave empty to show the app name instead.",
    accent: "Accent colour",
    accentPlaceholder: "#3e8fd0",
    accentInvalid: "Enter a colour code like #3e8fd0.",
    accentHint:
      "Brightness is adjusted automatically so it reads against the attendee screen's background. The green, amber and red status colours do not change.",
    logo: "Logo",
    logoHint:
      "Drag an image here or choose a file. It is copied into the app, so the original can be deleted.",
    logoPick: "Choose file",
    logoClear: "Remove logo",
    logoNone: "No file selected",
    theme: "Screen mode",
    themeDefault: "Default (match the attendee's device)",
    themeDark: "Dark",
    themeLight: "Light",
    themeAuto: "Match the attendee's device",
    themeHint: "Dark reads best in a dim hall, light at a daytime event.",
    appliesOnRefresh:
      "Changes apply immediately. Attendees already listening see them after refreshing.",
    restart: "Restart server",
  },

  device: {
    select: "Choose device",
    none: "Choose a device",
    refresh: "Refresh device list",
    channel: "Channel",
    requestedChannels: "Requested channels",
    requestedChannelsHint:
      "Enter the most channels the device supports: 18 on a Mac, 2 for a Windows pair device.",
    channelCount: "Requested {{requested}} ch · got {{achieved}} ch",
    sampleRate: "Sample rate — device {{device}} Hz · processing {{processed}} Hz",
    dspOff: "DSP confirmed off — echo cancellation · noise suppression · auto gain",
    feedbackWarning:
      "Echo cancellation is off, so testing on one laptop with the translated audio on its speakers feeds that sound back into the microphone and the translation loops endlessly. Use earphones or mute the attendee screen when testing.",
    permissionNeeded: "Microphone permission is required. Device names appear once it is granted.",
  },

  warn: {
    channel_downmix:
      "Only {{achieved}} channels opened instead of the requested {{requested}}. Channels cannot be picked in software; route the channel to the USB send pair on the mixer.",
    channel_out_of_range:
      "Channel {{selected}} is beyond the {{achieved}} channels actually open. Pick another channel number or re-route on the mixer.",
    dsp_enabled: "Warning: browser DSP is on — {{flags}}. Translation quality will suffer.",
    dsp_unreported: "The browser did not report its DSP state — {{flags}}. It cannot be confirmed.",
    sample_rate_mismatch: "Requested 16000 Hz but opened at {{actual}} Hz.",
  },

  error: {
    deviceLost: "The audio device disconnected. Capture stopped. Choose the device again.",
    deviceOpenFailed: "The selected device could not be opened — {{name}}: {{reason}}",
    workletFailed:
      "The audio processing module failed to load — {{name}}: {{reason}}. Restart the app.",
    ingestDisconnected: "Lost the connection to the server. Reconnecting; capture continues.",
    noDevice: "Cannot start — choose an input device first.",
  },

  hint: {
    notAllowed:
      "The system blocked microphone access. Windows: Settings → Privacy & security → Microphone, turn on 'Microphone access' and 'Let desktop apps access your microphone'. macOS: System Settings → Privacy & Security → Microphone, allow Simul.",
    notReadable:
      "The device exists but will not open. Most likely another program holds it exclusively — on an X-AIR/XR18, close anything using ASIO (obs-asio, a DAW, the X-AIR control panel) or switch OBS to WASAPI, and use a different USB pair. Failing that, replug the USB cable and refresh the device list.",
    notFound:
      "The saved device was not found, or it cannot deliver the requested channel count. Refresh the device list, pick it again, and lower the requested channel count to what the device has.",
  },

  log: {
    captureStarted:
      "Capture started — requested {{requested}} ch · got {{achieved}} ch, channel {{channel}}, device {{device}} Hz → processed {{processed}} Hz",
    captureStartedNoReport: "Capture started",
    captureStopped: "Capture stopped",
    captureError: "Capture error — {{message}}",
    ingest_connecting: "Connecting to the server's /ingest",
    ingest_open: "Connected to the server's /ingest",
    ingest_reconnecting: "Lost the server's /ingest — reconnecting",
    ingest_stopped: "The server's /ingest closed",
    ingest_idle: "The server's /ingest is idle",
    devicePicked: "Input device chosen — {{label}}",
    startPressed: "Start — {{label}}, channel {{channel}}, {{requested}} ch requested",
    stopPressed: "Stop",
    noiseMeasured: "Room measured — {{level}} dBFS, noise reduction on",
  },

  level: {
    rms: "RMS",
    peak: "Peak",
    clipping: "Clipping",
    idle: "Stopped",
    gain: "Input gain",
    gainHint:
      "A trim for when the mixer cannot be touched. It applies to the meter and to what is sent to the server alike, and takes effect immediately while capturing. Aim for ordinary speech around -20 dBFS, and back it off if the clipping indicator lights.",
    gainReset: "0 dB",
    noise: "Noise reduction",
    noiseOn: "On",
    noiseMeasure: "Measure the room",
    noiseMeasuring: "Measuring…",
    noiseMeasured: "Measured background {{level}} dBFS",
    noiseNotMeasured:
      "Not measured yet. Measure while capturing, at a moment the speaker is not talking.",
    noiseNeedsCapture: "Measuring needs capture to be running.",
    noiseMeasureFailed: "Measurement failed — {{reason}}",
    noiseSensitivity: "Sensitivity",
    noiseHint:
      "Remembers two seconds of the room (audience, a voice beside the speaker) frequency by frequency, and takes sound at that level out. While the speaker talks, background in bands the voice is not using is still reduced; anything as loud as the speaker stays. Applies at once, no restart, with 24 ms of latency. Raise the sensitivity to remove more, lower it to keep a quiet speaker.",
    noiseReducing: "Noise −{{db}} dB",
  },

  join: {
    scan: "Scan the QR code with a phone",
    interface: "Network interface",
    noAddress: "No LAN address found. Connect to a wired or wireless network.",
    externalSeen: "External connection confirmed",
    externalNone: "No external connection confirmed yet",
    recheck: "Re-check reachability",
  },

  reach: {
    title: "Reachability",
    advisory: "Advisory",
    proof: "Measured",
    profile_pass: "Network profile: {{alias}} — Private",
    profile_warn:
      "Warning: the {{alias}} network is classed as Public. Phones will not be able to connect.",
    profile_unknown: "The network profile could not be determined.",
    rule_pass: "Inbound firewall allow rule found: {{name}}",
    rule_warn:
      "Warning: no inbound allow rule for TCP {{port}} was found. Phones will not be able to open the page.",
    rule_unknown: "Firewall rules could not be checked.",
    external_pass: "An external device has actually connected.",
    external_warn: "No external device has connected yet. Check with a phone.",
    macos: "The Windows firewall check cannot run on macOS. Check on the event laptop.",
  },

  lanes: {
    language: "Language",
    listeners: "Listeners",
    audioListeners: "Audio listeners",
    status: "Status",
    laneDrops: "Lane drops",
    listenerDrops: "Listener drops",
    sessionState: "Session",
    empty: "No open lanes",
    laneDropsHint:
      "Lane drops count audio frames that arrived after a lane had closed. They say nothing about audio quality, so do not read a problem into this number alone.",
  },

  laneState: {
    starting: "Starting",
    live: "Live",
    reconnecting: "Reconnecting",
    error: "Error",
  },

  laneOpen: {
    open: "Open",
    waiting: "Waiting",
    error: "Error",
  },

  control: {
    start: "Start",
    stop: "Stop",
    serverTitle: "Server status",
    server_stopped: "Server stopped",
    server_starting: "Server starting",
    server_listening: "Server running — port {{port}}",
    server_crashed: "The server exited unexpectedly — {{restarts}} restart(s)",
    server_giving_up: "The server keeps exiting. Check the log.",
    server_external: "Using an external server (--external-server)",
    restart: "Restart server",
    port: "Port",
    portHint: "The TCP port the attendee page and the QR address use (1–65535).",
    portInvalid: "Enter a number from 1 to 65535.",
    portRestart:
      "The port is now {{port}}. Press Restart server to apply it, and stop and start capture again if it was running. The Windows firewall rule must be recreated for the new port too.",
    apiKey: "Gemini API key",
    apiKeyReplace: "Paste a new key to replace it",
    apiKeySet: "Set",
    apiKeyMissing: "Not set — translation lanes will not open",
    save: "Save",
    usageTitle: "API usage (estimate)",
    usageSince: "Since the server started at {{time}}",
    usageEmpty: "No lane has opened yet. Costs accrue here once an attendee picks a language.",
    usageTokensHeader: "Tokens (in · out)",
    usageTokens: "{{input}} · {{output}}",
    usageTotal: "Total",
    usageLanguage: "Language",
    usageCost: "Estimated cost",
    usageHint:
      "The audio tokens Gemini reports every second, summed and priced at Google's published rates ($3.50 in, $21.00 out per million tokens). Restarting the server starts the count again from zero. The Gemini API cannot report a key's actual bill, so check the exact figure on the AI Studio usage dashboard.",
    usageDashboard: "Open the AI Studio usage dashboard",
  },

  strip: {
    listenersLabel: "listeners",
    capturing: "Capturing",
    captureStopped: "Capture stopped",
    listeners: "{{n}} listening",
    errorLanes: "Lanes in error: {{n}}",
  },

  serverLog: {
    title: "Log",
    tabServer: "Server",
    tabApp: "App",
    empty: "No log lines",
  },

  footer: {
    language: "Display language",
    version: "Version {{version}}",
  },

  update: {
    ready: "Update v{{version}} is ready",
    readyHint: "Restart to apply it.",
    restart: "Restart",
    restartLink: "Restart to update",
    check: "Check for updates",
    checking: "Checking…",
    downloading: "Downloading…",
  },
} as const satisfies StringTable<typeof KO_STRINGS>;
