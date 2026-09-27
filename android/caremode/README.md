# caremode

A small Android library for Fire TV apps that are meant to be the screen someone comes back to: a care app for a person living with dementia, a family calendar, a clinic's waiting-room screen.

Fire TV does not let a third-party app replace the home screen. `caremode` gets close with two parts:

- **`BootReceiver`** opens your app when the TV starts.
- **`ReturnService`**, an accessibility service, opens it again after the TV has been left on the home screen or in another app with nobody navigating for a set time (ten minutes by default). It reads only which package owns the foreground window, from window-state events, and never reads window content.

`IdlePolicy` holds the decision as a pure class, with unit tests: never interrupt your own app, system dialogs or apps you exempt, and wait out the idle period.

## Use

```kotlin
// settings.gradle.kts
include(":caremode")

// app/build.gradle.kts
dependencies { implementation(project(":caremode")) }
```

```xml
<!-- your app's AndroidManifest.xml, inside <application> -->
<meta-data android:name="app.mantel.caremode.ACTIVITY" android:value="com.example.MainActivity" />
```

```kotlin
CareMode.setEnabled(context, true)
CareMode.setReturnAfterMs(context, 10 * 60_000L)
```

## One-time setup on the TV

Fire OS 8 restricts starting activities from the background, and Fire TV has no settings screen for either grant, so a family member runs these once over ADB:

```bash
adb shell appops set <your.package> SYSTEM_ALERT_WINDOW allow
adb shell settings put secure enabled_accessibility_services <your.package>/app.mantel.caremode.ReturnService
adb shell settings put secure accessibility_enabled 1
```

## Test

```bash
./gradlew :caremode:testDebugUnitTest
```

Apache-2.0, part of [Mantel](../../README.md).
