# Friction log

Each entry is something I hit while building Mantel, with the page that was read at the time. Severity: **high** blocks a working submission, **medium** costs hours or forces a decision on incomplete information, **low** is a papercut a sentence of documentation removes.

---

## 1. Vega Developer Tools do not run on Windows, so a Windows developer has no Vega simulator

**Severity: high** for anyone on Windows.

**Task.** Start on Vega OS, which the hackathon names first, and show the app in the Vega Virtual Device.

**Steps.** Read [Getting started with Vega OS development](https://developer.amazon.com/apps-and-games/blogs/2026/07/guide-to-building-for-fire-tv-on-vega-os).

**Expected.** Vega Developer Tools and the Vega Virtual Device on Windows, or a supported route through WSL.

**Actual.** The guide lists Mac and Linux only, and says Windows and WSL are not supported. The submission rules ask for the app on "an actual Fire TV device or the Fire TV/Vega simulator", and the only simulator named is Vega's.

**Workaround.** Built for Fire OS instead (Kotlin, a WebView shell around a React interface), tested on the Android TV API 30 emulator, which is the Android base of Fire OS 8, and planned the film on a Fire TV device.

**Suggestion.** Ship the Vega Virtual Device for WSL 2, or state in the hackathon resources which simulator a Fire OS app on Windows is expected to use.

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
