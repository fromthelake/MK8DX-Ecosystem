package nl.mariokart8.mk8dxtimetrials.lan

import java.io.IOException
import java.net.URI
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.X509TrustManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidLanOnboardingTest {
    private fun facts(
        trust: AndroidSystemTrust = AndroidSystemTrust.Unknown,
        signedIn: Boolean = false,
        paired: Boolean = true,
        completedBefore: Boolean = false,
        later: Boolean = false,
    ) = AndroidLanOnboardingFacts(paired, trust, signedIn, completedBefore, later)

    @Test fun afterConnectingTheTrustStepIsCurrent() {
        val plan = AndroidLanOnboardingRules.plan(facts())
        assertTrue(plan.show)
        assertFalse(plan.complete)
        assertEquals(
            listOf(
                AndroidLanOnboardingStep.Connect to AndroidLanStepStatus.Done,
                AndroidLanOnboardingStep.Trust to AndroidLanStepStatus.Current,
                AndroidLanOnboardingStep.SignIn to AndroidLanStepStatus.Todo,
            ),
            plan.steps,
        )
    }

    @Test fun aTrustedPhoneMovesOnToSigningIn() {
        val plan = AndroidLanOnboardingRules.plan(facts(trust = AndroidSystemTrust.Trusted))
        assertEquals(AndroidLanStepStatus.Done, plan.steps[1].second)
        assertEquals(AndroidLanStepStatus.Current, plan.steps[2].second)
        assertTrue(plan.show)
    }

    @Test fun signingInFirstStillLeavesTheTrustStep() {
        val plan = AndroidLanOnboardingRules.plan(facts(trust = AndroidSystemTrust.NotTrusted, signedIn = true))
        assertEquals(AndroidLanStepStatus.Current, plan.steps[1].second)
        assertEquals(AndroidLanStepStatus.Done, plan.steps[2].second)
        assertTrue(plan.show)
    }

    @Test fun anUnreachableInstallationIsNotCountedAsTrusted() {
        val plan = AndroidLanOnboardingRules.plan(facts(trust = AndroidSystemTrust.Unreachable, signedIn = true))
        assertFalse(plan.complete)
    }

    @Test fun bothStepsDoneCompletesAndHides() {
        val plan = AndroidLanOnboardingRules.plan(facts(trust = AndroidSystemTrust.Trusted, signedIn = true))
        assertTrue(plan.complete)
        assertFalse(plan.show)
    }

    @Test fun laterAndCompletedBeforeHideItButNeverMarkItComplete() {
        assertFalse(AndroidLanOnboardingRules.plan(facts(later = true)).show)
        assertFalse(AndroidLanOnboardingRules.plan(facts(later = true)).complete)
        assertFalse(AndroidLanOnboardingRules.plan(facts(completedBefore = true)).show)
    }

    @Test fun anOnlineCommunityWithoutPairingNeverShowsIt() {
        val plan = AndroidLanOnboardingRules.plan(facts(paired = false, trust = AndroidSystemTrust.Trusted, signedIn = true))
        assertFalse(plan.show)
        assertFalse(plan.complete)
    }

    @Test fun shortCodeIsTheCertificateHashLikeTheCardAndSetupPage() {
        // tooling/offline_lan_ca.py setup_page: first 16 hex of the certificate SHA-256, upper case, groups of four.
        val hash = "4daa0747ea4b4112" + "0".repeat(48)
        assertEquals("4DAA 0747 EA4B 4112", AndroidLanCertificateCode.short(hash))
        assertEquals(
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            AndroidLanCertificateCode.sha256("test".toByteArray()),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun shortCodeRefusesAnythingButADigest() {
        AndroidLanCertificateCode.short("ec18f64c")
    }

    @Test fun certificateFileNameIsTheSameAsTheSetupPageDownload() {
        // tooling/offline_lan_ca.py certificate_file_name: MK8DX-<8 hex of the certificate SHA-256>-<root notBefore, UTC>.crt
        val hash = "0658270ff0578e488a6eb2293874c578a9eabe1bfd1d0c479209e46c07b68caa"
        assertEquals("MK8DX-0658270F-2026-11-16.crt",
            AndroidLanCertificateFileName.of(hash, java.time.Instant.parse("2026-11-16T09:55:00Z")))
        // The date is the UTC date, not the phone's local one.
        assertEquals("MK8DX-0658270F-2026-11-15.crt",
            AndroidLanCertificateFileName.of(hash, java.time.Instant.parse("2026-11-15T23:30:00Z")))
    }

    @Test fun brandsAreRecognisedFromManufacturerOrBrand() {
        assertEquals(AndroidPhoneBrand.Vivo, AndroidCertificateInstallRoute.brand("vivo"))
        assertEquals(AndroidPhoneBrand.Vivo, AndroidCertificateInstallRoute.brand("VIVO", "iQOO"))
        assertEquals(AndroidPhoneBrand.Samsung, AndroidCertificateInstallRoute.brand("samsung"))
        assertEquals(AndroidPhoneBrand.Pixel, AndroidCertificateInstallRoute.brand("Google"))
        assertEquals(AndroidPhoneBrand.Xiaomi, AndroidCertificateInstallRoute.brand("Xiaomi", "Redmi"))
        assertEquals(AndroidPhoneBrand.Xiaomi, AndroidCertificateInstallRoute.brand("unknown", "POCO"))
        assertEquals(AndroidPhoneBrand.OnePlusOppo, AndroidCertificateInstallRoute.brand("OnePlus"))
        assertEquals(AndroidPhoneBrand.OnePlusOppo, AndroidCertificateInstallRoute.brand("OPPO"))
        assertEquals(AndroidPhoneBrand.Generic, AndroidCertificateInstallRoute.brand("Fairphone"))
        assertEquals(AndroidPhoneBrand.Generic, AndroidCertificateInstallRoute.brand(null))
    }

    @Test fun theVivoRouteIsTheOneVerifiedOnTheOwnersPhone() {
        val (english, dutch) = AndroidCertificateInstallRoute.steps(AndroidPhoneBrand.Vivo)
        assertEquals(
            "Instellingen → Beveiliging → Meer veiligheidsinstellingen → Installeren vanuit opslag → CA-certificaat → kies het MK8DX-bestand → bevestig met je pincode.",
            dutch,
        )
        assertTrue(english.contains("More security settings"))
        assertFalse(dutch.contains("Versleuteling en inloggegevens"))
        for (brand in AndroidPhoneBrand.entries) {
            val (en, nl) = AndroidCertificateInstallRoute.steps(brand)
            assertTrue(en.contains("CA certificate") && nl.contains("CA-certificaat"))
        }
    }

    private class FakeTrustManager(private val trusted: Boolean) : X509TrustManager {
        var asked = 0
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            asked += 1
            if (!trusted) throw CertificateException("Trust anchor for certification path not found.")
        }
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    /** The handshake hands the server's chain to the trust manager it was given, as JSSE does. */
    private fun handshakeWith(seen: MutableList<URI>) = { origin: URI, manager: X509TrustManager ->
        seen += origin
        try {
            manager.checkServerTrusted(emptyArray(), "ECDHE_ECDSA")
        } catch (error: CertificateException) {
            throw SSLHandshakeException("handshake failed").apply { initCause(error) }
        }
    }

    @Test fun theTrustCheckUsesOnlyTheGivenStoreAndClassifiesTheAnswer() {
        val seen = mutableListOf<URI>()
        val trusted = FakeTrustManager(true)
        assertEquals(AndroidSystemTrust.Trusted, AndroidSystemTrustCheck({ trusted }, handshakeWith(seen)).check("https://192.168.1.174"))
        assertEquals(1, trusted.asked)
        val untrusted = FakeTrustManager(false)
        assertEquals(AndroidSystemTrust.NotTrusted, AndroidSystemTrustCheck({ untrusted }, handshakeWith(seen)).check("https://192.168.1.174"))
        assertEquals(listOf(URI("https://192.168.1.174"), URI("https://192.168.1.174")), seen)
    }

    @Test fun aNetworkFailureIsNotATrustAnswer() {
        val check = AndroidSystemTrustCheck({ FakeTrustManager(true) }, { _, _ -> throw IOException("connect timed out") })
        assertEquals(AndroidSystemTrust.Unreachable, check.check("https://192.168.1.174"))
        assertEquals(AndroidSystemTrust.Unreachable, check.check("http://192.168.1.174"))
        assertNotEquals(AndroidSystemTrust.Trusted, AndroidSystemTrustCheck.classify(IOException("x", CertificateException("y"))))
    }

    @Test fun parsesOnlyRealSignInCardsOfTheConnectedInstallation() {
        val token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
        assertEquals(43, token.length)
        val origin = "https://192.168.1.174"
        assertEquals(
            AndroidInvitationCardParse.Card(AndroidOfflineInvitationCard(origin, token)),
            AndroidOfflineInvitationCardParser.parse("$origin/offline-invite#token=$token", origin),
        )
        assertEquals(
            AndroidInvitationCardParse.OtherInstallation("https://192.168.1.175"),
            AndroidOfflineInvitationCardParser.parse("https://192.168.1.175/offline-invite#token=$token", origin),
        )
        listOf(
            "http://192.168.1.174/offline-invite#token=$token",
            "$origin/offline-invite?token=$token",
            "$origin/offline-invite#token=${token.dropLast(1)}",
            "$origin/offline-invite#token=$token&x=1",
            "$origin/other#token=$token",
            "https://user@192.168.1.174/offline-invite#token=$token",
            "http://192.168.1.174/setup#mk8dx-pair=1&origin=https%3A%2F%2F192.168.1.174&spki=${"a".repeat(64)}",
            "not a link",
        ).forEach { text ->
            assertEquals(text, AndroidInvitationCardParse.NotACard, AndroidOfflineInvitationCardParser.parse(text, origin))
        }
        assertFalse(AndroidOfflineInvitationCard(origin, token).toString().contains(token))
    }
}
