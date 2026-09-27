package app.mantel.caremode

/**
 * When to bring the care app back.
 *
 * Every window change on the TV means someone is navigating, so the time since
 * the last change is how long the screen has been left alone. The care app comes
 * back when something else has been on screen, untouched, for `returnAfterMs`.
 * A foreground app that is known to be in use for long stretches (a video
 * player a family member started) can be exempted.
 */
class IdlePolicy(
    private val ownPackage: String,
    private val exempt: Set<String> = emptySet(),
) {
    fun shouldReturn(
        enabled: Boolean,
        foregroundPackage: String?,
        lastWindowChangeAtMs: Long,
        nowMs: Long,
        returnAfterMs: Long,
    ): Boolean {
        if (!enabled) return false
        if (foregroundPackage == null || foregroundPackage == ownPackage) return false
        if (foregroundPackage in exempt) return false
        // System UI dialogs (permission prompts, volume) are transient; never interrupt them.
        if (foregroundPackage == "com.android.systemui" || foregroundPackage.startsWith("com.android.permissioncontroller")) return false
        return nowMs - lastWindowChangeAtMs >= returnAfterMs
    }

    /** Milliseconds until the next check is worth doing. */
    fun nextCheckInMs(lastWindowChangeAtMs: Long, nowMs: Long, returnAfterMs: Long): Long =
        (returnAfterMs - (nowMs - lastWindowChangeAtMs)).coerceIn(5_000L, returnAfterMs)
}
