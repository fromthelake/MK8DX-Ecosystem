package nl.mariokart8.mk8dxtimetrials.lan

import java.net.URI
import java.security.MessageDigest
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.time.format.DateTimeFormatter
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.X509TrustManager

/**
 * The numbered steps after "Connect" for a home or club installation (A2, own CA):
 * 1 connect (done once paired), 2 let the phone trust the installation (for the website and the browser),
 * 3 sign in. Shown at every start until steps 2 and 3 are done; "Later" hides it until the next start.
 */
internal enum class AndroidLanOnboardingStep { Connect, Trust, SignIn }

internal enum class AndroidLanStepStatus { Done, Current, Todo }

/** What the phone's own trust store says about this installation. */
internal enum class AndroidSystemTrust {
    /** Not checked yet, or the check is running. */
    Unknown,
    /** A TLS connection with the phone's CA store (system + user CAs, what browsers use) succeeded. */
    Trusted,
    /** The installation answered, but its certificate is not trusted by the phone's store. */
    NotTrusted,
    /** The installation could not be reached: says nothing about trust. */
    Unreachable,
}

internal data class AndroidLanOnboardingFacts(
    val paired: Boolean,
    val systemTrust: AndroidSystemTrust,
    val signedIn: Boolean,
    val completedBefore: Boolean,
    val laterThisStart: Boolean,
)

internal data class AndroidLanOnboardingPlan(
    val show: Boolean,
    val steps: List<Pair<AndroidLanOnboardingStep, AndroidLanStepStatus>>,
    /** Both remaining steps are done: the app remembers it and never shows the steps again. */
    val complete: Boolean,
)

internal object AndroidLanOnboardingRules {
    fun plan(facts: AndroidLanOnboardingFacts): AndroidLanOnboardingPlan {
        val done = mapOf(
            AndroidLanOnboardingStep.Connect to facts.paired,
            AndroidLanOnboardingStep.Trust to (facts.systemTrust == AndroidSystemTrust.Trusted),
            AndroidLanOnboardingStep.SignIn to facts.signedIn,
        )
        val current = AndroidLanOnboardingStep.entries.firstOrNull { done[it] != true }
        val steps = AndroidLanOnboardingStep.entries.map { step ->
            step to when {
                done[step] == true -> AndroidLanStepStatus.Done
                step == current -> AndroidLanStepStatus.Current
                else -> AndroidLanStepStatus.Todo
            }
        }
        val complete = facts.paired && current == null
        return AndroidLanOnboardingPlan(
            show = facts.paired && !facts.completedBefore && !complete && !facts.laterThisStart,
            steps = steps,
            complete = complete,
        )
    }
}

/**
 * The installation's root certificate, named the way the host's card and `/setup` page name it: the SHA-256
 * of the certificate (DER), the first 16 hex digits upper-case in groups of four. The key fingerprint (SPKI)
 * the pairing QR carries stays the pin; this code is only what a person compares.
 */
internal object AndroidLanCertificateCode {
    fun certificateSha256(certificate: X509Certificate): String = sha256(certificate.encoded)

    fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun short(certificateSha256: String): String {
        require(Regex("^[0-9a-f]{64}$").matches(certificateSha256)) { "not a SHA-256 hex digest" }
        return certificateSha256.take(16).uppercase().chunked(4).joinToString(" ")
    }
}

/**
 * The saved certificate's name in Downloads, the same name the host's `/setup` page downloads
 * (`tooling/offline_lan_ca.py` `certificate_file_name`): `MK8DX-<first 8 hex of the certificate SHA-256, upper case>-
 * <the root's notBefore date, UTC>.crt`. One installation always gives one file name, on the phone and in the browser.
 */
internal object AndroidLanCertificateFileName {
    fun of(certificateSha256: String, notBefore: java.time.Instant): String {
        require(Regex("^[0-9a-f]{64}$").matches(certificateSha256)) { "not a SHA-256 hex digest" }
        val date = notBefore.atZone(java.time.ZoneOffset.UTC).toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE)
        return "MK8DX-${certificateSha256.take(8).uppercase()}-$date.crt"
    }

    fun of(root: X509Certificate): String =
        of(AndroidLanCertificateCode.certificateSha256(root), root.notBefore.toInstant())
}

/** Phone brands whose certificate menu we describe in their own words. */
internal enum class AndroidPhoneBrand { Vivo, Samsung, Pixel, Xiaomi, OnePlusOppo, Generic }

internal object AndroidCertificateInstallRoute {
    fun brand(manufacturer: String?, brand: String? = null): AndroidPhoneBrand {
        val names = listOfNotNull(manufacturer, brand).map { it.trim().lowercase() }
        return when {
            names.any { it == "vivo" || it == "iqoo" } -> AndroidPhoneBrand.Vivo
            names.any { it == "samsung" } -> AndroidPhoneBrand.Samsung
            names.any { it == "google" || it == "pixel" } -> AndroidPhoneBrand.Pixel
            names.any { it == "xiaomi" || it == "redmi" || it == "poco" } -> AndroidPhoneBrand.Xiaomi
            names.any { it == "oneplus" || it == "oppo" || it == "realme" } -> AndroidPhoneBrand.OnePlusOppo
            else -> AndroidPhoneBrand.Generic
        }
    }

    /**
     * The menu path in English and Dutch. Vivo's path was followed on a real Vivo X200 Pro (Android 15, Dutch)
     * on 2026-11-16; Pixel/AOSP on the Android 16 emulator. The others follow the makers' current menus and are
     * phrased so that searching Settings for "certificate" still works where a menu differs.
     */
    /** English and Dutch, in the form the Android message extractor collects (`t("English", "Dutch")`). */
    private fun t(english: String, dutch: String): Pair<String, String> = english to dutch

    fun steps(brand: AndroidPhoneBrand): Pair<String, String> = when (brand) {
        AndroidPhoneBrand.Vivo -> t(
            "Settings → Security → More security settings → Install from storage → CA certificate → choose the MK8DX file → confirm with your PIN.",
            "Instellingen → Beveiliging → Meer veiligheidsinstellingen → Installeren vanuit opslag → CA-certificaat → kies het MK8DX-bestand → bevestig met je pincode.",
        )
        AndroidPhoneBrand.Samsung -> t(
            "Settings → Security and privacy → More security settings → Install from device storage → CA certificate → Install anyway → choose the MK8DX file.",
            "Instellingen → Beveiliging en privacy → Meer beveiligingsinstellingen → Installeren vanaf apparaatopslag → CA-certificaat → Toch installeren → kies het MK8DX-bestand.",
        )
        AndroidPhoneBrand.Pixel -> t(
            "Settings → Security & privacy → More security & privacy → Encryption & credentials → Install a certificate → CA certificate → Install anyway → choose the MK8DX file.",
            "Instellingen → Beveiliging en privacy → Meer beveiliging en privacy → Versleuteling en inloggegevens → Een certificaat installeren → CA-certificaat → Toch installeren → kies het MK8DX-bestand.",
        )
        AndroidPhoneBrand.Xiaomi -> t(
            "Settings → Passwords & security → Privacy → Encryption & credentials → Install a certificate → CA certificate → choose the MK8DX file.",
            "Instellingen → Wachtwoorden en beveiliging → Privacy → Versleuteling en inloggegevens → Certificaat installeren → CA-certificaat → kies het MK8DX-bestand.",
        )
        AndroidPhoneBrand.OnePlusOppo -> t(
            "Settings → Security & privacy → More security settings → Install from storage → CA certificate → choose the MK8DX file.",
            "Instellingen → Beveiliging en privacy → Meer beveiligingsinstellingen → Installeren vanuit opslag → CA-certificaat → kies het MK8DX-bestand.",
        )
        AndroidPhoneBrand.Generic -> t(
            "Open Settings and search for “certificate”. Choose Install a certificate (or Install from storage) → CA certificate → choose the MK8DX file → confirm with your PIN.",
            "Open Instellingen en zoek op “certificaat”. Kies Certificaat installeren (of Installeren vanuit opslag) → CA-certificaat → kies het MK8DX-bestand → bevestig met je pincode.",
        )
    }
}

/**
 * Does the phone itself (not this app's pin) trust the installation? A TLS handshake with the phone's CA store,
 * which holds the system and the user-installed CAs: what Chrome uses. The platform's default trust manager is
 * not used for this because, for an app targeting Android 7 or later, it leaves user-installed CAs out and would
 * answer "not trusted" for ever. The pinned root is never consulted here, so a green check means the browser
 * route works too.
 */
internal class AndroidSystemTrustCheck(
    private val trustManager: () -> X509TrustManager,
    private val handshake: (URI, X509TrustManager) -> Unit,
) {
    fun check(origin: String): AndroidSystemTrust {
        val uri = runCatching { URI(origin) }.getOrNull()
        if (uri == null || uri.scheme != "https" || uri.host.isNullOrEmpty()) return AndroidSystemTrust.Unreachable
        return try {
            handshake(uri, trustManager())
            AndroidSystemTrust.Trusted
        } catch (error: Exception) {
            classify(error)
        }
    }

    companion object {
        fun classify(error: Throwable): AndroidSystemTrust {
            var current: Throwable? = error
            var depth = 0
            while (current != null && depth < 8) {
                if (current is CertificateException || current is CertPathValidatorException ||
                    current is SSLPeerUnverifiedException || current is SSLHandshakeException) {
                    return AndroidSystemTrust.NotTrusted
                }
                current = current.cause
                depth += 1
            }
            return AndroidSystemTrust.Unreachable
        }
    }
}

/** A personal sign-in card: `https://<installation>/offline-invite#token=<43 characters>`. */
internal data class AndroidOfflineInvitationCard(val origin: String, val token: String) {
    override fun toString(): String = "AndroidOfflineInvitationCard(origin=$origin, token=<hidden>)"
}

internal sealed interface AndroidInvitationCardParse {
    data class Card(val card: AndroidOfflineInvitationCard) : AndroidInvitationCardParse
    /** A real card, but printed by another installation than the one this phone is connected to. */
    data class OtherInstallation(val origin: String) : AndroidInvitationCardParse
    data object NotACard : AndroidInvitationCardParse
}

internal object AndroidOfflineInvitationCardParser {
    private val tokenPattern = Regex("^[A-Za-z0-9_-]{43}$")

    fun parse(text: String, connectedOrigin: String): AndroidInvitationCardParse = try {
        val uri = URI(text.trim())
        val fragment = uri.rawFragment.orEmpty()
        val token = fragment.removePrefix("token=")
        if (uri.scheme != "https" || uri.host.isNullOrEmpty() || uri.rawUserInfo != null ||
            uri.rawPath != "/offline-invite" || uri.rawQuery != null ||
            !fragment.startsWith("token=") || !tokenPattern.matches(token)
        ) {
            AndroidInvitationCardParse.NotACard
        } else {
            val origin = "https://${uri.host}" + if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"
            if (origin != connectedOrigin) AndroidInvitationCardParse.OtherInstallation(origin)
            else AndroidInvitationCardParse.Card(AndroidOfflineInvitationCard(origin, token))
        }
    } catch (_: Exception) {
        AndroidInvitationCardParse.NotACard
    }
}
