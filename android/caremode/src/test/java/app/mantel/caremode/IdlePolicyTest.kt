package app.mantel.caremode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IdlePolicyTest {
    private val policy = IdlePolicy("app.mantel.tv", exempt = setOf("com.example.player"))
    private val tenMin = 10 * 60_000L

    @Test
    fun returnsAfterTheHomeScreenIsLeftAlone() {
        assertTrue(policy.shouldReturn(true, "com.amazon.tv.launcher", 0, tenMin, tenMin))
        assertFalse(policy.shouldReturn(true, "com.amazon.tv.launcher", 0, tenMin - 1, tenMin))
    }

    @Test
    fun neverInterruptsItselfOrWhenOff() {
        assertFalse(policy.shouldReturn(true, "app.mantel.tv", 0, tenMin * 3, tenMin))
        assertFalse(policy.shouldReturn(false, "com.amazon.tv.launcher", 0, tenMin * 3, tenMin))
        assertFalse(policy.shouldReturn(true, null, 0, tenMin * 3, tenMin))
    }

    @Test
    fun leavesExemptAppsAndSystemDialogsAlone() {
        assertFalse(policy.shouldReturn(true, "com.example.player", 0, tenMin * 3, tenMin))
        assertFalse(policy.shouldReturn(true, "com.android.systemui", 0, tenMin * 3, tenMin))
        assertFalse(policy.shouldReturn(true, "com.android.permissioncontroller", 0, tenMin * 3, tenMin))
    }

    @Test
    fun checksAgainWhenTheWindowWouldExpire() {
        assertEquals(tenMin - 60_000L, policy.nextCheckInMs(0, 60_000L, tenMin))
        assertEquals(5_000L, policy.nextCheckInMs(0, tenMin, tenMin))
    }
}
