# Mantel on a Fire TV

## Hardware

| Device | What works |
|---|---|
| Fire TV Cube with a USB (UVC) webcam, 720p30 or better | everything: presence from the webcam, questions through the webcam's microphone |
| Fire TV Stick (Fire OS 7 or 8) | Today, answers from the remote (OK reads the day), door cards, moments, messages, night screen |
| Android TV emulator, API 30 (Fire OS 8's Android base) | development; the emulator's virtual camera and a debug receiver stand in for the webcam and microphone |
| Fire TV with Vega OS, Vega Virtual Device | the separate Vega OS app: [VEGA.md](VEGA.md) |

Amazon's recommended webcams for the Cube's video calling (Logitech C920, C922x, C310) are UVC cameras and work the same way here.

## Build

```bash
python tools/android/fetch_model.py          # the Vosk small English model, into the APK's assets
pnpm build:web && pnpm build:android-assets  # the TV interface, into the APK's assets
cd android
./gradlew assembleDebug testDebugUnitTest    # app-debug.apk, and the unit tests
```

## Install and connect

1. On the Fire TV: Settings, My Fire TV, Developer options: turn on ADB debugging and apps from unknown sources. Note the IP address under About, Network.
2. From the computer: `adb connect <fire-tv-ip>:5555`, then `adb install -r -g android/app/build/outputs/apk/debug/app-debug.apk`. `-g` grants the camera and microphone permissions; without it the TV asks on first launch.
3. Open Mantel from Your Apps. It opens on the pairing screen.
4. In the family app, Settings, Connect a TV: a six-digit code. Enter the server address and the code on the TV with the remote.

For development, the server and token can also be set from ADB:

```bash
adb shell am start -n app.mantel.tv/.MainActivity --es server http://192.168.1.20:8795 --es token demo-tv
```

## Care mode

Fire TV does not let an app replace its home screen. Care mode opens Mantel when the TV starts and brings it back after the TV is left idle elsewhere. Both parts need a one-time grant that Fire OS has no settings screen for:

```bash
# open at boot (Fire OS 8 restricts starting an activity from the background)
adb shell appops set app.mantel.tv SYSTEM_ALERT_WINDOW allow
# return to Mantel after ten idle minutes elsewhere
adb shell settings put secure enabled_accessibility_services app.mantel.tv/app.mantel.caremode.ReturnService
adb shell settings put secure accessibility_enabled 1
```

The Menu button on Mantel's screen opens the pairing screen, which has the care mode checkbox.

## Without a webcam or microphone (debug builds)

A debug build registers a receiver that stands in for the senses:

```bash
adb shell am broadcast -a app.mantel.tv.DEBUG --es presence true
adb shell am broadcast -a app.mantel.tv.DEBUG --es say "when is sarah coming"
adb push question.wav /data/local/tmp/q.wav && adb shell chmod 644 /data/local/tmp/q.wav
adb shell am broadcast -a app.mantel.tv.DEBUG --es wav /data/local/tmp/q.wav   # 16 kHz mono 16-bit
```

`wav` runs the file through the same on-device Vosk model the microphone path uses. On the API 30 Android TV emulator, a synthesised "When is Sarah coming?" came back from the model as `when is sarah coming`, and "Where is Robert?" as `where is robert to`, which the matcher still answered with Sarah's Robert topic.

## Emulator

```bash
sdkmanager "system-images;android-30;android-tv;x86"
avdmanager create avd -n Mantel_TV_API30 -k "system-images;android-30;android-tv;x86" -d tv_1080p
emulator -avd Mantel_TV_API30
adb install -r -g android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.mantel.tv/.MainActivity --es server http://10.0.2.2:8795 --es token demo-tv
```

`10.0.2.2` is the host computer as the emulator sees it.
