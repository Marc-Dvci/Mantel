package app.mantel.tv

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * The whole Fire TV app: one full-screen WebView running the Mantel interface
 * from the APK's own assets, and the device's senses behind a bridge.
 *
 * The interface is the same code the tests and the browser preview run. The
 * native side does what only a device can: the webcam, the microphone, the
 * speech engine, keeping the screen on and dimming it at night, the remote's
 * Back and Menu keys.
 */
class MainActivity : AppCompatActivity(), MantelBridge.Host {
    override lateinit var settings: Settings
    private lateinit var web: WebView
    private var presence: Presence? = null
    private var speech: Speech? = null
    private lateinit var voice: Voice
    private var cameraActive = false
    private var micActive = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = Settings(this)
        settings.applyExtras(intent)
        if (!settings.paired) {
            startActivity(Intent(this, PairActivity::class.java))
            finish()
            return
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        voice = Voice(this) { id, state -> send(MantelBridge.event("tts", "id" to id, "state" to state)) }

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this).apply {
            setBackgroundColor(0xff0d1118.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Family recordings and the door announcement play without a key press.
            settings.mediaPlaybackRequiresUserGesture = false
            // The interface loads from the APK over https; a household server on the
            // home network is often plain http.
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            webChromeClient = object : android.webkit.WebChromeClient() {
                override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                    android.util.Log.i("MantelWeb", "${m.messageLevel()}: ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                    return true
                }
            }
            isFocusable = true
            isFocusableInTouchMode = true
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)
            }
            addJavascriptInterface(MantelBridge(this@MainActivity), "MantelNative")
        }
        setContentView(web)
        hideSystemUi()
        web.loadUrl("https://appassets.androidplatform.net/assets/tv/index.html")
        web.requestFocus()
        startSenses()
        if (BuildConfig.DEBUG) registerDebugReceiver()
    }

    /**
     * Debug builds only: stand in for the webcam and microphone from ADB, for a
     * TV or emulator without them.
     *
     *   adb shell am broadcast -a app.mantel.tv.DEBUG --es presence true
     *   adb shell am broadcast -a app.mantel.tv.DEBUG --es say "when is sarah coming"
     *   adb shell am broadcast -a app.mantel.tv.DEBUG --es wav /sdcard/Download/question.wav
     */
    private val debugReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context, intent: Intent) {
            intent.getStringExtra("presence")?.let { send(MantelBridge.event("presence", "present" to (it == "true"))) }
            intent.getStringExtra("say")?.let { send(MantelBridge.event("speech", "text" to it, "final" to true)) }
            intent.getStringExtra("wav")?.let { path ->
                kotlin.concurrent.thread {
                    val text = speech?.recognizeFile(path)
                    android.util.Log.i("MantelSpeech", "recognised from $path: $text")
                    if (text != null) runOnUiThread { send(MantelBridge.event("speech", "text" to text, "final" to true)) }
                }
            }
            if (intent.getStringExtra("key") == "back") send(MantelBridge.event("key", "key" to "back"))
        }
    }

    private fun registerDebugReceiver() {
        val filter = android.content.IntentFilter("app.mantel.tv.DEBUG")
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(debugReceiver, filter, android.content.Context.RECEIVER_EXPORTED)
        else @Suppress("UnspecifiedRegisterReceiverFlag") registerReceiver(debugReceiver, filter)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        settings.applyExtras(intent)
    }

    private fun startSenses() {
        val missing = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
            .filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) ActivityCompat.requestPermissions(this, missing.toTypedArray(), REQUEST_SENSES)
        else startGrantedSenses()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_SENSES) startGrantedSenses()
    }

    /** Start whatever was granted: a household can refuse the camera and keep the microphone, or refuse both. */
    private fun startGrantedSenses() {
        val granted = { p: String -> ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED }
        if (granted(Manifest.permission.CAMERA) && presence == null) {
            presence = Presence(
                this,
                this,
                onChange = { present -> send(MantelBridge.event("presence", "present" to present)) },
                onCamera = { active ->
                    cameraActive = active
                    send(MantelBridge.event("camera", "active" to active))
                },
            ).also { it.start() }
        }
        if (granted(Manifest.permission.RECORD_AUDIO) && speech == null) {
            speech = Speech(
                this,
                onSentence = { text -> runOnUiThread { send(MantelBridge.event("speech", "text" to text, "final" to true)) } },
                onActive = { active ->
                    micActive = active
                    runOnUiThread { send(MantelBridge.event("microphone", "active" to active)) }
                },
            ).also { it.start() }
        }
    }

    /** Deliver a native event to the interface. */
    private fun send(json: String) {
        if (!::web.isInitialized) return
        web.post { web.evaluateJavascript("window.__mantelNative && window.__mantelNative(${JSONObject.quote(json)})", null) }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                // Back never leaves Mantel: it closes whatever is on screen and returns to Today.
                KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> {
                    send(MantelBridge.event("key", "key" to "back"))
                    return true
                }
                // Menu opens the family's setup screen (pairing, server).
                KeyEvent.KEYCODE_MENU -> {
                    openSettings()
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun hideSystemUi() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
    }

    // ---------------------------------------------------------------- MantelBridge.Host

    override fun runOnUi(block: () -> Unit) = runOnUiThread(block)

    override fun capabilities(): JSONObject = JSONObject()
        .put("camera", cameraActive)
        .put("microphone", micActive)
        .put("tts", ::voice.isInitialized && voice.available)
        .put("presenceModel", Presence.MODEL)
        .put("speechModel", Speech.MODEL)

    override fun speak(text: String, id: String) = voice.speak(text, id)

    override fun stopSpeaking() = voice.stop()

    override fun setListening(mode: String) {
        speech?.setMode(mode)
    }

    override fun setMediaPlaying(playing: Boolean) {
        speech?.setMediaPlaying(playing)
    }

    override fun setKeepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /** 0..1 dims the panel at night; a negative level returns it to the TV's own setting. */
    override fun setDim(level: Float) {
        val lp = window.attributes
        lp.screenBrightness = if (level < 0) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else level.coerceIn(0.01f, 1f)
        window.attributes = lp
    }

    override fun openSettings() {
        startActivity(Intent(this, PairActivity::class.java))
    }

    override fun onDestroy() {
        if (BuildConfig.DEBUG) runCatching { unregisterReceiver(debugReceiver) }
        presence?.stop()
        speech?.stop()
        if (::voice.isInitialized) voice.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_SENSES = 7
    }
}
