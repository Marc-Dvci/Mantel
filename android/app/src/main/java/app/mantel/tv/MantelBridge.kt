package app.mantel.tv

import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * `window.MantelNative` in the TV interface. Every method is called from the
 * WebView's own thread and hops to the main thread through [host].
 * Events go the other way through `window.__mantelNative(json)`.
 */
class MantelBridge(private val host: Host) {
    interface Host {
        val settings: Settings
        fun runOnUi(block: () -> Unit)
        fun capabilities(): JSONObject
        fun speak(text: String, id: String)
        fun stopSpeaking()
        fun setListening(mode: String)
        fun setMediaPlaying(playing: Boolean)
        fun setKeepScreenOn(on: Boolean)
        fun setDim(level: Float)
        fun openSettings()
    }

    @JavascriptInterface
    fun getConfig(): String = JSONObject()
        .put("server", host.settings.server)
        .put("token", host.settings.token ?: "")
        .put("deviceName", host.settings.deviceName)
        .toString()

    @JavascriptInterface
    fun capabilities(): String = host.capabilities().toString()

    @JavascriptInterface
    fun speak(text: String, id: String) = host.runOnUi { host.speak(text, id) }

    @JavascriptInterface
    fun stopSpeaking() = host.runOnUi { host.stopSpeaking() }

    @JavascriptInterface
    fun setListening(mode: String) = host.runOnUi { host.setListening(mode) }

    @JavascriptInterface
    fun setMediaPlaying(playing: Boolean) = host.runOnUi { host.setMediaPlaying(playing) }

    @JavascriptInterface
    fun setKeepScreenOn(on: Boolean) = host.runOnUi { host.setKeepScreenOn(on) }

    @JavascriptInterface
    fun setDim(level: Double) = host.runOnUi { host.setDim(level.toFloat()) }

    @JavascriptInterface
    fun openSettings() = host.runOnUi { host.openSettings() }

    @JavascriptInterface
    fun log(message: String) {
        android.util.Log.i("MantelWeb", message)
    }

    companion object {
        /** A native event as the interface reads it. */
        fun event(type: String, vararg fields: Pair<String, Any>): String {
            val o = JSONObject().put("type", type)
            for ((k, v) in fields) o.put(k, v)
            return o.toString()
        }
    }
}
