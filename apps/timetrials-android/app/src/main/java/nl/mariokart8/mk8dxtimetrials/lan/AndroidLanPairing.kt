package nl.mariokart8.mk8dxtimetrials.lan

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory

/**
 * Pairing with an offline LAN installation (ADR-0223 decisions 7 and 8).
 *
 * The host's setup QR is `http://<LAN-IP>/setup#mk8dx-pair=1&origin=https%3A%2F%2F<LAN-IP>&spki=<hex>`.
 * A phone camera opens the setup page (the fragment never reaches the server); this app reads
 * the exact origin and the SHA-256 of the installation CA's public key from it. After the person
 * confirms both, the app fetches the public root from `/setup/root.crt`, accepts it only when its
 * key matches the confirmed fingerprint, and from then on trusts exactly that root for exactly
 * that origin. The ordinary online trust path is unchanged and user-installed CAs stay untrusted.
 */
internal data class AndroidLanPairingOffer(
    val origin: String,
    val host: String,
    val spkiSha256: String,
)

internal object AndroidLanPairingPayload {
    private val spkiPattern = Regex("^[0-9a-f]{64}$")

    fun build(host: String, spkiSha256: String): String =
        "http://$host/setup#mk8dx-pair=1&origin=" +
            java.net.URLEncoder.encode("https://$host", "UTF-8") + "&spki=$spkiSha256"

    fun parse(text: String): AndroidLanPairingOffer? = try {
        val uri = URI(text.trim())
        val host = uri.host
        val fields = uri.rawFragment.orEmpty().split('&').mapNotNull { part ->
            val at = part.indexOf('=')
            if (at <= 0) null else part.substring(0, at) to URLDecoder.decode(part.substring(at + 1), "UTF-8")
        }
        val keys = fields.map { it.first }
        val values = fields.toMap()
        val origin = values["origin"]
        val spki = values["spki"]
        if (uri.scheme != "http" || host == null || !isPrivateIpv4(host) || uri.port != -1 ||
            uri.rawUserInfo != null || uri.rawPath != "/setup" || uri.rawQuery != null ||
            keys.size != keys.toSet().size || keys.toSet() != setOf("mk8dx-pair", "origin", "spki") ||
            values["mk8dx-pair"] != "1" || origin != "https://$host" || spki == null || !spkiPattern.matches(spki)
        ) null else AndroidLanPairingOffer(origin, host, spki)
    } catch (_: Exception) {
        null
    }

    /** Only RFC 1918 addresses: a pairing never names a public or loopback host. */
    fun isPrivateIpv4(host: String): Boolean {
        val parts = host.split('.')
        if (parts.size != 4 || parts.any { it.isEmpty() || it.length > 3 || !it.all(Char::isDigit) ||
                (it.length > 1 && it.startsWith('0')) }) return false
        val octets = parts.map { it.toInt() }
        if (octets.any { it > 255 }) return false
        return octets[0] == 10 || (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168)
    }
}

internal object AndroidLanRoot {
    /** Groups of four for reading aloud or comparing with the host screen. */
    fun grouped(hex: String): String = hex.chunked(4).joinToString(" ")

    fun spkiSha256(certificate: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(certificate.publicKey.encoded)
            .joinToString("") { "%02x".format(it) }

    /**
     * The fetched bytes become the trusted root only if they are one self-signed, currently valid
     * CA certificate whose public key hashes to the confirmed fingerprint.
     */
    fun accept(bytes: ByteArray, spkiSha256: String, nowMs: Long = System.currentTimeMillis()): X509Certificate? = try {
        val all = CertificateFactory.getInstance("X.509").generateCertificates(ByteArrayInputStream(bytes))
        val certificate = all.singleOrNull() as? X509Certificate
        if (certificate == null || spkiSha256(certificate) != spkiSha256 || certificate.basicConstraints < 0 ||
            certificate.subjectX500Principal != certificate.issuerX500Principal) null
        else {
            certificate.verify(certificate.publicKey)
            certificate.checkValidity(java.util.Date(nowMs))
            certificate
        }
    } catch (_: Exception) {
        null
    }

    /** TLS that trusts this one root and nothing else; hostname checks stay with HttpsURLConnection. */
    fun socketFactory(root: X509Certificate): SSLSocketFactory {
        val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setCertificateEntry("mk8dx-lan-root", root)
        }
        val trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(store) }
        return SSLContext.getInstance("TLS").apply { init(null, trust.trustManagers, null) }.socketFactory
    }
}

/**
 * One fixed plain-HTTP read of the public root. Plain HTTP is acceptable only because the result
 * is checked against the fingerprint the person confirmed; nothing else is ever fetched this way.
 */
internal object AndroidLanRootFetcher {
    const val MAX_BYTES = 64 * 1024

    fun fetch(host: String, timeoutMs: Int = 8_000): ByteArray {
        require(AndroidLanPairingPayload.isPrivateIpv4(host)) { "not a private LAN address" }
        Socket().use { socket ->
            socket.connect(InetSocketAddress(host, 80), timeoutMs)
            socket.soTimeout = timeoutMs
            socket.getOutputStream().apply {
                write("GET /setup/root.crt HTTP/1.1\r\nHost: $host\r\nAccept: */*\r\nConnection: close\r\n\r\n"
                    .toByteArray(Charsets.US_ASCII))
                flush()
            }
            return parseResponse(readLimited(socket.getInputStream()))
        }
    }

    private fun readLimited(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
            if (out.size() > MAX_BYTES) throw IllegalStateException("root certificate response too large")
        }
        return out.toByteArray()
    }

    fun parseResponse(raw: ByteArray): ByteArray {
        val split = indexOf(raw, "\r\n\r\n".toByteArray(Charsets.US_ASCII))
        check(split > 0) { "incomplete response" }
        val lines = String(raw, 0, split, Charsets.ISO_8859_1).split("\r\n")
        check(Regex("^HTTP/1\\.[01] 200( .*)?$").matches(lines.first())) { "unexpected status" }
        val headers = lines.drop(1).mapNotNull { line ->
            val at = line.indexOf(':')
            if (at <= 0) null else line.substring(0, at).trim().lowercase() to line.substring(at + 1).trim()
        }
        val body = raw.copyOfRange(split + 4, raw.size)
        val chunked = headers.any { it.first == "transfer-encoding" && it.second.lowercase().contains("chunked") }
        if (chunked) return dechunk(body)
        val length = headers.lastOrNull { it.first == "content-length" }?.second?.toIntOrNull()
        if (length != null) {
            check(length in 0..body.size) { "truncated body" }
            return body.copyOf(length)
        }
        return body
    }

    private fun dechunk(body: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        var at = 0
        while (true) {
            val end = indexOf(body, "\r\n".toByteArray(Charsets.US_ASCII), at)
            check(end > at) { "bad chunk" }
            val size = String(body, at, end - at, Charsets.US_ASCII).substringBefore(';').trim().toInt(16)
            at = end + 2
            if (size == 0) return out.toByteArray()
            check(at + size <= body.size) { "truncated chunk" }
            out.write(body, at, size)
            at += size + 2
        }
    }

    private fun indexOf(haystack: ByteArray, needle: ByteArray, from: Int = 0): Int {
        outer@ for (i in from..haystack.size - needle.size) {
            for (j in needle.indices) if (haystack[i + j] != needle[j]) continue@outer
            return i
        }
        return -1
    }
}
