package app.mantel.caremode

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Opens the care app when the TV starts. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!CareMode.isEnabled(context)) return
        try {
            CareMode.launch(context)
        } catch (e: RuntimeException) {
            // Without the overlay permission Fire OS 8 refuses a background start. See docs/FIRE_TV.md.
            Log.w("CareMode", "Could not open the care app at boot: ${e.message}")
        }
    }
}
