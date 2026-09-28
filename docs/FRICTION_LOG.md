# Friction log

Each entry is something I hit while building Mantel, with the page that was read at the time. Severity: **high** blocks a working submission, **medium** costs hours or forces a decision on incomplete information, **low** is a papercut a sentence of documentation removes.

---

## 1. Vega Developer Tools are not supported on Windows

**Severity: medium** (high until a working route is found).

**Task.** Start on Vega OS, which the hackathon names first, and show the app in the Vega Virtual Device.

**Steps.** Read [Getting started with Vega OS development](https://developer.amazon.com/apps-and-games/blogs/2026/07/guide-to-building-for-fire-tv-on-vega-os).

**Expected.** Vega Developer Tools and the Vega Virtual Device on Windows, or a supported route through WSL.

**Actual.** The guide lists Mac and Linux only, and says Windows and WSL are not supported. The submission rules ask for the app on "an actual Fire TV device or the Fire TV/Vega simulator", and the only simulator named is Vega's.

**Workaround.** I built for Fire OS first. Later I installed the SDK in WSL 2 anyway (Ubuntu 22.04 with systemd, `/dev/kvm` from nested virtualization, `get_vvm.sh` with `NONINTERACTIVE=true`): the CLI, the build and the Vega Virtual Device all ran, the device's window through WSLg, with a warning about nested virtualization. Three things needed finding out: the device stops when the WSL session that started it ends, so it needs a session that stays open; the device reaches a server on Windows at the WSL gateway address; and audio needed the change in entry 10. [VEGA.md](VEGA.md) has the steps.

**Suggestion.** Support WSL 2, which already nearly works, with a page covering those three points.

---

## 2. No emulator for Fire OS itself

**Severity: medium.**

**Task.** Test a Fire OS app without a Fire TV at hand.

**Steps.** Looked through the Fire TV developer documentation and the hackathon resources for a Fire OS emulator or system image.

**Expected.** A Fire OS 8 system image for the Android emulator, or a documented equivalent.

**Actual.** I found none. The closest stand-in is Google's Android TV image at API 30. It has no Amazon launcher, no Amazon text-to-speech engine and no Fire OS permission behaviour, so every Fire-specific path (care mode's boot launch, the accessibility grant, the speech engine) stays untested until a device is connected.

**Workaround.** Android TV API 30 emulator for everything else, and a debug-build receiver in Mantel that stands in for the camera and microphone over ADB.

**Suggestion.** A Fire OS 8 emulator image, even without DRM playback, would cover most app testing.

---

## 3. A UVC webcam on the Fire TV Cube is documented for Zoom and Alexa calling, not for app developers

**Severity: medium.**

**Task.** Read presence from a USB webcam on a Fire TV Cube, from a third-party app.

**Steps.** Searched the Fire TV developer documentation for camera access, UVC, CameraX or Camera2 on the Cube. Found Amazon's customer help page on two-way video calling with a webcam, and Zoom's launch on the 2nd-gen Cube with a UVC webcam (720p30 minimum).

**Expected.** A developer page: which Fire TV devices expose an external camera to apps, through which API (Camera2 external camera, or USB host), at which resolutions, and which permission prompt the user sees.

**Actual.** I did not find one. Mantel opens whichever camera CameraX reports (the webcam is neither "front" nor "back") and degrades to remote-only presence when there is none, which works without knowing the answers but cannot promise a household which devices will see them.

**Suggestion.** One page listing camera support per device and the API path, with a minimal sample.

---

## 4. No supported way to make a care app the screen a person returns to

**Severity: medium.**

**Task.** Keep Mantel on screen for a person who cannot find their way back to an app.

**Steps.** Read [Developing for Fire TV devices running Fire OS 8](https://developer.amazon.com/docs/fire-tv/fire-os-8.html), which carries Android 10's restriction: "the system places restrictions on starting activities from the background".

**Expected.** An assisted-living or kiosk mode a family can switch on, or a documented launch-at-boot permission with a settings screen.

**Actual.** Launch at boot needs a background-start exemption with no settings screen, and the Home button always leaves the app. A family member has to run ADB commands (`appops set ... SYSTEM_ALERT_WINDOW allow`, enable an accessibility service) that a caregiver should never see.

**Workaround.** `android/caremode`: a boot receiver, and an accessibility service that reads only the foreground package and brings the app back after ten idle minutes elsewhere. [FIRE_TV.md](FIRE_TV.md) lists the one-time commands.

**Suggestion.** A "care mode" in Fire TV settings for accessibility apps: launch at boot, and return after idle.

---

## 5. No app-level speech recognition

**Severity: medium.**

**Task.** Hear a spoken question in the living room without the voice remote.

**Steps.** Read the Vega forum thread [Speech-to-text support with manual mic trigger?](https://community.amazondeveloper.com/t/speech-to-text-support-with-manual-mic-trigger/27863).

**Expected.** An API like Android's `SpeechRecognizer`.

**Actual.** Amazon's answer in that thread: "VegaOS does not expose an app-level speech-to-text API like Android's SpeechRecognizer for custom speech recognition flows." On Fire OS the voice remote and the far-field microphones go to Alexa.

**Workaround.** Vosk's small English model runs on the TV, listening through the webcam's microphone. It adds about 40 MB to the APK.

**Suggestion.** An on-device recognition API for accessibility apps, with the same privacy indicator Alexa uses.

---

## 6. A reasoning model on Bedrock returned an empty answer at a normal token budget

**Severity: low.**

**Task.** Draft a short caption with `openai.gpt-oss-120b` through the Bedrock API endpoint.

**Steps.** Chat completions with `max_tokens: 700`.

**Expected.** A one-sentence caption.

**Actual.** For one prompt, an empty `content`: the model's reasoning used the budget. Nothing in the response said so.

**Workaround.** `reasoning_effort: "low"` and `max_tokens: 2500` (`apps/server/src/language.ts`).

**Suggestion.** Return a finish reason that names the reasoning budget, and note in the model card that reasoning counts against `max_tokens`.

---

## 7. The Vega Virtual Device has no WebView

**Severity: medium.**

**Task.** Run Mantel's web TV interface in Vega's WebView on the Vega Virtual Device.

**Steps.** A WebView app from the Vega template (`@amazon-devices/webview`, the page from the package's own assets), `npm run build:debug`, then `vega run-app` on the virtual device.

**Expected.** The app to install and show the page, or the build to say the virtual device cannot run it.

**Actual.** The build succeeded for all three architectures. The install failed: `Module dependency not found`, for `/com.amazon.kepler.webview_4@IWebview_4`, and the CLI suggested a physical device. The virtual device's installed packages include no WebView.

**Workaround.** A native React Native app for Vega (`vega/`) with the same screens, importing the same TypeScript core.

**Suggestion.** Include the WebView in the virtual device image, or say in the WebView documentation that the virtual device cannot run it, and warn at build time.

---

## 8. Vega's media player will not open an http URL, and says only "not supported"

**Severity: medium.**

**Task.** Play a family recording from the household server, which on a home network is plain http.

**Steps.** `AudioPlayer` from `@amazon-devices/react-native-w3cmedia`, `initialize()`, then `src` set to the recording's URL, with the server's host in the manifest's `[network-traffic-policy.cleartext]` allowlist (which the app's own `fetch` honours).

**Expected.** Playback, as for `fetch`; or an error that names cleartext.

**Actual.** `error` with code 4 (`MEDIA_ERR_SRC_NOT_SUPPORTED`) and an empty message for every `http://` source: the LAN server, the same server through a reverse port forward to the device's loopback, and a public http URL. The same file over https played. Through Media Source Extensions, a bare MP3 failed with code 3 (decode) although `MediaSource.isTypeSupported("audio/mpeg")` returned true; MP3 inside an MP4 container played.

**Workaround.** The app fetches each clip itself and wraps the MP3 frames, untouched, in a minimal MP4 for MSE (`vega/src/mp4.ts`, about 150 lines).

**Suggestion.** Apply the cleartext allowlist to the media pipeline, or state "https only" in the `AudioPlayer` documentation and in `MediaError.message`; and have `isTypeSupported` answer for what MSE can decode.

---

## 9. Driving the Vega Virtual Device from a script

**Severity: low.**

**Task.** Press the remote's keys from a script, to film the app.

**Steps.** The emulator console's `event send EV_KEY:KEY_BACK:1` (and keycode 158); key events into the device's window through X11; then `vega device run-cmd -c 'inputd-cli button_press KEY_BACK'`.

**Expected.** One documented way to press a remote key.

**Actual.** Neither console events nor window events reached the app. `inputd-cli`, found by listing the device's `/usr/bin`, did, but through `run-cmd` a key can land seconds after the command returns, and `KEY_ENTER` arrives as `enter`, where the remote's OK is `select`.

**Workaround.** `inputd-cli` for keys, with a wait after each; the app treats `enter` as OK.

**Suggestion.** A `vega device send-key` command, and `inputd-cli` in the documentation.

---

## 10. Audio and logs on the Vega Virtual Device under WSL 2

**Severity: low.**

**Task.** Check that a recording plays, and read the app's log when it does not.

**Steps.** Played audio in the app; watched `currentTime`; read `loggingctl log -v <package>` through `vega device run-cmd`.

**Expected.** Sound through WSLg, or a playback error; the recent log.

**Actual.** While the device ran, WSLg's PulseAudio stopped answering and playback stalled at about half a second with no error, for Amazon's own https sample file as well. The log returned only the last few lines, mostly the renderer's five-second telemetry, so the media errors had gone by the time they were read.

**Workaround.** `QEMU_AUDIO_DRV=none` when starting the device: playback then runs in real time to `ended`, silently. For diagnosis, a temporary on-screen readout of the player's state.

**Suggestion.** A larger log buffer or a filter for the renderer telemetry, and an audio note for WSL.

---

## 11. React Native for Vega draws some styles differently from the web

**Severity: low.**

**Task.** Match the Fire OS app's look in native views: a soft radial light behind the day, and Atkinson Hyperlegible in two weights.

**Steps.** `experimental_backgroundImage` with a radial gradient; a white radial PNG with `tintColor`; stacked translucent circles; fonts in `assets/raw/fonts`, then `assets/fonts`.

**Expected.** What React Native documents.

**Actual.** The gradient was not drawn. The tinted image filled its whole rectangle. Stacked translucent circles came out lavender where the same colour and opacity on the web are steel blue. A font is found by its file name, one weight per family, so the bold weight needed a family name of its own.

**Workaround.** Opaque nested circles, each already blended with the background to the gradient's value at its radius; the bold file renamed to "Atkinson Hyperlegible Bold" (the licence reserves no font name).

**Suggestion.** A page listing the style properties React Native for Vega draws differently or not at all.
