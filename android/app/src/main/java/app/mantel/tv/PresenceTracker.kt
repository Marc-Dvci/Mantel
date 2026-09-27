package app.mantel.tv

/**
 * Turns per-frame face counts into "someone is in the room" and "the room is empty".
 *
 * A person watching the TV faces it, so a face is the signal. Two sightings
 * within [confirmWindowMs] make the room occupied, which ignores a single false
 * detection. The room is empty after [absentAfterMs] without a face, long enough
 * that someone looking down at a cup of tea is not "gone".
 */
class PresenceTracker(
    private val confirmWindowMs: Long = 4_000,
    private val absentAfterMs: Long = 90_000,
) {
    var present = false
        private set
    private var lastFaceAt = Long.MIN_VALUE
    private var firstSightingAt = Long.MIN_VALUE

    /** Returns the new state when it changes, otherwise null. */
    fun onFrame(nowMs: Long, faces: Int): Boolean? {
        if (faces > 0) {
            if (!present) {
                if (firstSightingAt != Long.MIN_VALUE && nowMs - firstSightingAt <= confirmWindowMs && nowMs > firstSightingAt) {
                    present = true
                    lastFaceAt = nowMs
                    firstSightingAt = Long.MIN_VALUE
                    return true
                }
                if (firstSightingAt == Long.MIN_VALUE || nowMs - firstSightingAt > confirmWindowMs) firstSightingAt = nowMs
            }
            lastFaceAt = nowMs
            return null
        }
        if (present && nowMs - lastFaceAt >= absentAfterMs) {
            present = false
            return false
        }
        return null
    }
}
