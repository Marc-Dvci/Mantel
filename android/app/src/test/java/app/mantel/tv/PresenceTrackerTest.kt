package app.mantel.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PresenceTrackerTest {
    @Test
    fun oneStrayDetectionIsNotSomeone() {
        val t = PresenceTracker()
        assertNull(t.onFrame(0, 1))
        assertNull(t.onFrame(500, 0))
        assertNull(t.onFrame(10_000, 1))
        assertFalse(t.present)
    }

    @Test
    fun twoSightingsCloseTogetherMeanSomeoneCameIn() {
        val t = PresenceTracker()
        assertNull(t.onFrame(0, 1))
        assertEquals(true, t.onFrame(500, 1))
        assertTrue(t.present)
    }

    @Test
    fun lookingAwayForAMinuteIsNotLeaving() {
        val t = PresenceTracker(absentAfterMs = 90_000)
        t.onFrame(0, 1)
        t.onFrame(500, 1)
        assertNull(t.onFrame(60_000, 0))
        assertTrue(t.present)
        assertEquals(false, t.onFrame(90_500, 0))
        assertFalse(t.present)
    }

    @Test
    fun comesBackAfterLeaving() {
        val t = PresenceTracker(absentAfterMs = 1_000)
        t.onFrame(0, 1)
        t.onFrame(100, 1)
        t.onFrame(2_000, 0)
        assertFalse(t.present)
        assertNull(t.onFrame(3_000, 1))
        assertEquals(true, t.onFrame(3_400, 1))
    }
}
