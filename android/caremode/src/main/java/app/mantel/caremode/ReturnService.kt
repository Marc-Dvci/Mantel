package app.mantel.caremode

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent

/**
 * Returns to the care app after the TV has been left alone elsewhere.
 *
 * It reads only which package owns the foreground window, from window-state
 * events. It never reads window content (`canRetrieveWindowContent` is false).
 */
class ReturnService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private var foreground: String? = null
    private var lastChange = SystemClock.elapsedRealtime()
    private lateinit var policy: IdlePolicy

    private val check = object : Runnable {
        override fun run() {
            val now = SystemClock.elapsedRealtime()
            val after = CareMode.returnAfterMs(this@ReturnService)
            if (policy.shouldReturn(CareMode.isEnabled(this@ReturnService), foreground, lastChange, now, after)) {
                CareMode.launch(this@ReturnService)
                lastChange = now
            }
            handler.postDelayed(this, policy.nextCheckInMs(lastChange, now, after))
        }
    }

    override fun onServiceConnected() {
        policy = IdlePolicy(packageName)
        handler.post(check)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        foreground = pkg
        lastChange = SystemClock.elapsedRealtime()
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
