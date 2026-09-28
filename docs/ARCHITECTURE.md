# Architecture

## One core, three places

`packages/core` holds every rule, in TypeScript with no dependencies:

| Module | What it decides |
|---|---|
| `time.ts` | household wall-clock time from UTC instants (Intl only), "4 o'clock", "half past 4", parts of the day |
| `today.ts` | the Today screen: day, part of day, date, next item, what is done, the screen mode (day, evening, night) |
| `answers.ts` | the matcher (sentence to topic) and the answer rules (topic to words) |
| `door.ts` | what the TV says at a doorbell press, and the family's alert |
| `messages.ts` | when a family message plays |
| `signal.ts` | care-day features from events, per-person baselines, the Change Signal rule |
| `digest.ts` | the evening digest's counts and sentences |
| `checks.ts` | the checks every model draft passes |
| `topics.ts` | built-in topics and the truth-policy guidance |
| `sim.ts`, `demo.ts` | the household simulator and the demo household |

The TV bundles this core into its interface, so the Today screen and the answers work with no network. The server uses it for door decisions, the Change Signal and the digest. The tests and the evaluation tools use it directly.

## The Fire TV app

`android/app` is a Kotlin app for Fire OS (minSdk 25, Fire OS 6 and later).

- **Interface.** One full-screen WebView loads the TV interface (`apps/tv`, React) from the APK's own assets through `WebViewAssetLoader`. The interface talks to the household server with a bearer token the TV got at pairing.
- **Presence.** CameraX opens whichever camera the device has; on a Fire TV Cube that is a USB (UVC) webcam. Two frames a second, downscaled to 320 pixels, become a count of faces with `android.media.FaceDetector`. `PresenceTracker` needs two sightings within 4 seconds to decide someone came in, and 90 seconds without a face to decide the room is empty. Frames are never stored or sent.
- **Speech.** Vosk runs the small English model on the device against the default input, which on a Cube with a webcam is the webcam's microphone. Only a finished sentence reaches the interface, which decides whether it is a question for Mantel. Listening pauses while the TV speaks or plays a recording.
- **Voice.** A family recording first, then the household voice the server synthesises with Amazon Polly, then the device's text-to-speech engine.
- **Remote.** Back never leaves Mantel: it closes what is on screen. OK reads the day aloud, or plays a photo's story. Left and Right browse photos. Menu opens pairing and care mode.
- **Care mode** (`android/caremode`, a separate library). Opens the app at boot, and an accessibility service that reads only the foreground package brings it back after the TV is left idle elsewhere for ten minutes.

`MantelBridge` exposes the native side to the interface as `window.MantelNative`; events come back through `window.__mantelNative(json)`.

## The Vega app

`vega/` is the TV for Vega OS, in React Native for Vega ([VEGA.md](VEGA.md)).

- **Interface.** The Fire OS interface's screens as native views (`screens.tsx`), with the same rules for what shows when (`App.tsx`), importing `packages/core` through Metro.
- **Presence and questions.** Vega gives apps no camera and no speech recognition: the person is treated as present, and a demo server can send a presence change or the words of a question (`POST /api/dev/tv/input`), which the TV matches and answers as it would a recognised sentence.
- **Voice.** A family recording, then the household voice from the server. Each clip is fetched by the app and its MP3 frames wrapped in MP4 (`mp4.ts`) for Media Source Extensions, because the media player opens https only.
- **Remote and offline.** `useTVEventHandler` for OK, Left and Right, `BackHandler` for Back; the last state and the event queue in AsyncStorage.

## The server

`apps/server` is an Express app that runs locally (`main.ts`) and on AWS Lambda (`lambda.ts`) unchanged.

| Route | For |
|---|---|
| `GET /api/tv/state?since=v&wait=20000` | the TV's long-poll: the household (approved words only), the active door card, the server clock |
| `POST /api/tv/events` | presence, questions, what was shown and played |
| `GET /api/tv/speech?text=` | the household voice for a line, made once and cached |
| `POST /api/tv/pair` | a six-digit code becomes a TV token |
| `/api/family/*` | the family app: plan, answers, approvals, moments, messages, drafts, alerts, digest, settings, privacy |
| `POST /ring/webhook` | Ring's signed webhooks |
| `GET /media/<household>/<id>?k=` | photos, recordings, snapshots, behind a per-household key |
| `/api/dev/*`, `/ring-sim/*` | demo only: the clock, the simulated Ring |

State is one versioned document per household plus an append-only event log. `LocalStore` keeps them in files; `DynamoStore` keeps them in one DynamoDB table and writes the document with a condition on the version it read, so two writers never lose each other's change. Long-polls wake on the version.

A tick every few minutes expires the door card, reads yesterday's care day with the Change Signal an hour after the planned waking time, and writes the digest at 20:00. Each step records that it ran.

## AWS

`infrastructure/cdk` deploys CloudFront in front of S3 (the web apps) and an API Gateway HTTP API (the Lambda), a scheduled tick Lambda, one DynamoDB table, a private media bucket and two Secrets Manager secrets. The API Lambda's 29-second timeout covers the TV's 20-second long-poll. See [AWS.md](AWS.md).

## What leaves the house

The TV sends events: a presence start or end with its time, a question's recognised words and which answer was shown, which photo or message played. Camera frames, audio, and speech that was not a question never leave the TV. See [SAFETY.md](SAFETY.md).
