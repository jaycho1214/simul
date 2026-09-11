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
    passthrough: "Original lane (debug)",
    passthroughHint:
      "Adds a lane at the bottom of the attendee list carrying the room's sound untranslated. For checking the audio path; it costs nothing in API usage.",
    remove: "Remove {{code}}",
    addCode: "Language code not in the list",
    add: "Add",
    addHint:
      "The list above holds only the commonly used languages. Gemini supports about 70; enter any other as a BCP-47 code.",
    restartNeeded:
      "Language changes take effect after the server restarts. Restarting mid-event briefly cuts the audio for everyone listening.",
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
    themeDefault: "Default (dark)",
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
    deviceOpenFailed:
      "The selected device could not be opened: {{reason}}. Choose another device or check the cable.",
    workletFailed: "The audio processing module failed to load: {{reason}}. Restart the app.",
    ingestDisconnected: "Lost the connection to the server. Reconnecting; capture continues.",
  },

  level: {
    rms: "RMS",
    peak: "Peak",
    clipping: "Clipping",
    idle: "Stopped",
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
    apiKey: "Gemini API key",
    apiKeyReplace: "Paste a new key to replace it",
    apiKeySet: "Set",
    apiKeyMissing: "Not set — translation lanes will not open",
    save: "Save",
  },

  strip: {
    listenersLabel: "listeners",
    capturing: "Capturing",
    captureStopped: "Capture stopped",
    listeners: "{{n}} listening",
    errorLanes: "Lanes in error: {{n}}",
  },

  serverLog: {
    title: "Server log",
    empty: "No log lines",
  },
} as const satisfies StringTable<typeof KO_STRINGS>;
