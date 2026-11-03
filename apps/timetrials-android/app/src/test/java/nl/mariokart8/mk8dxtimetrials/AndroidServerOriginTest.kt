package nl.mariokart8.mk8dxtimetrials

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidServerOriginTest {
    @Test fun `owner default keeps preexisting local storage paths`() {
        val owner = "https://community.example"
        org.junit.Assert.assertTrue(AndroidServerOrigin.usesPackagedDefault(owner, owner))
        org.junit.Assert.assertFalse(AndroidServerOrigin.usesPackagedDefault("https://other.example", owner))
        org.junit.Assert.assertFalse(AndroidServerOrigin.usesPackagedDefault("https://other.example", "https://example.invalid"))
    }

    @Test fun `one exact HTTPS origin is accepted`() {
        assertEquals("https://www.example.org", AndroidServerOrigin.validate("https://www.example.org"))
        assertNull(AndroidServerOrigin.validate("http://www.example.org"))
        assertNull(AndroidServerOrigin.validate("https://www.example.org/path"))
        assertNull(AndroidServerOrigin.validate("https://www.example.org/"))
        assertNull(AndroidServerOrigin.validate("https://user@www.example.org"))
        assertNull(AndroidServerOrigin.validate("https://www.example.org:444"))
        assertNull(AndroidServerOrigin.validate("https://127.0.0.1:65262", allowLoopbackPort = false))
        assertEquals("https://127.0.0.1:65262", AndroidServerOrigin.validate("https://127.0.0.1:65262", allowLoopbackPort = true))
        assertNull(AndroidServerOrigin.validate("https://www.example.org:444", allowLoopbackPort = true))
    }
}
