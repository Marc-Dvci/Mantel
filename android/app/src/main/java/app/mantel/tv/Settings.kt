package app.mantel.tv

import android.content.Context
import android.content.Intent

/** Where the household's server is and the TV's own token, kept on the device. */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("mantel", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", null) ?: BuildConfig.DEFAULT_SERVER
        set(v) = prefs.edit().putString("server", v.trimEnd('/')).apply()

    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v).apply()

    var deviceName: String
        get() = prefs.getString("deviceName", null) ?: "Living room TV"
        set(v) = prefs.edit().putString("deviceName", v).apply()

    val paired: Boolean
        get() = server.isNotBlank() && !token.isNullOrBlank()

    /**
     * For setup over ADB:
     * adb shell am start -n app.mantel.tv/.MainActivity --es server http://192.168.1.20:8795 --es token <token>
     */
    fun applyExtras(intent: Intent?) {
        intent?.getStringExtra("server")?.let { server = it }
        intent?.getStringExtra("token")?.let { token = it }
    }
}
