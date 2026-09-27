package app.mantel.caremode

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/**
 * Care mode for a Fire TV app that is meant to be the screen a person comes back to.
 *
 * Fire TV does not let a third-party app replace the home screen. Care mode gets
 * close with two parts a family member switches on once:
 *
 *  - [BootReceiver] opens the app when the TV starts.
 *  - [ReturnService], an accessibility service, opens it again when the TV has
 *    been left on the home screen or in another app with nobody navigating.
 *
 * The host app names its activity in its manifest:
 *
 *     <meta-data android:name="app.mantel.caremode.ACTIVITY" android:value="com.example.MainActivity" />
 */
object CareMode {
    private const val PREFS = "app.mantel.caremode"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_RETURN_AFTER_MS = "returnAfterMs"
    const val DEFAULT_RETURN_AFTER_MS = 10 * 60_000L
    private const val META_ACTIVITY = "app.mantel.caremode.ACTIVITY"

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    fun returnAfterMs(context: Context): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_RETURN_AFTER_MS, DEFAULT_RETURN_AFTER_MS)

    fun setReturnAfterMs(context: Context, ms: Long) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(KEY_RETURN_AFTER_MS, ms).apply()
    }

    /** The activity named in the host's manifest meta-data. */
    fun activity(context: Context): ComponentName? {
        val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        val name = info.metaData?.getString(META_ACTIVITY) ?: return null
        return ComponentName(context.packageName, name)
    }

    fun launch(context: Context) {
        val component = activity(context) ?: return
        val intent = Intent(Intent.ACTION_MAIN)
            .setComponent(component)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        context.startActivity(intent)
    }
}
