package nl.mariokart8.mk8dxtimetrials.lan

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidLanPairingTest {
    private val spki = "1bf4569a99de25a2ff4d693cd0dfd8d6ed90952ac0ea6cf48f70a2100d0930c9"

    @Test fun buildsAndParsesTheSetupQr() {
        val text = AndroidLanPairingPayload.build("192.168.0.236", spki)
        assertEquals("http://192.168.0.236/setup#mk8dx-pair=1&origin=https%3A%2F%2F192.168.0.236&spki=$spki", text)
        assertEquals(
            AndroidLanPairingOffer("https://192.168.0.236", "192.168.0.236", spki),
            AndroidLanPairingPayload.parse(text),
        )
    }

    @Test fun refusesAnythingButAnExactPrivatePairing() {
        val ok = "http://10.0.0.5/setup#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.5&spki=$spki"
        assertNotNull(AndroidLanPairingPayload.parse(ok))
        listOf(
            "http://192.168.0.236/setup",
            "https://192.168.0.236/setup#mk8dx-pair=1&origin=https%3A%2F%2F192.168.0.236&spki=$spki",
            "http://8.8.8.8/setup#mk8dx-pair=1&origin=https%3A%2F%2F8.8.8.8&spki=$spki",
            "http://127.0.0.1/setup#mk8dx-pair=1&origin=https%3A%2F%2F127.0.0.1&spki=$spki",
            "http://10.0.0.5/setup#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.6&spki=$spki",
            "http://10.0.0.5/setup#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.5%3A8443&spki=$spki",
            "http://10.0.0.5:8080/setup#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.5&spki=$spki",
            "http://10.0.0.5/other#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.5&spki=$spki",
            "http://10.0.0.5/setup?x=1#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.5&spki=$spki",
            "http://10.0.0.5/setup#mk8dx-pair=2&origin=https%3A%2F%2F10.0.0.5&spki=$spki",
            "http://10.0.0.5/setup#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.5&spki=${spki.uppercase()}",
            "http://10.0.0.5/setup#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.5&spki=${spki.dropLast(2)}",
            "http://10.0.0.5/setup#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.5&spki=$spki&spki=$spki",
            "http://10.0.0.5/setup#mk8dx-pair=1&origin=https%3A%2F%2F10.0.0.5&spki=$spki&token=x",
            "https://192.168.0.236/offline-invitation#t=abc",
        ).forEach { assertNull(it, AndroidLanPairingPayload.parse(it)) }
    }

    @Test fun privateAddressesOnly() {
        listOf("10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1")
            .forEach { assertTrue(it, AndroidLanPairingPayload.isPrivateIpv4(it)) }
        listOf("172.15.0.1", "172.32.0.1", "192.169.0.1", "11.0.0.1", "010.0.0.1", "10.0.0", "10.0.0.256", "example.org", "::1")
            .forEach { assertTrue(it, !AndroidLanPairingPayload.isPrivateIpv4(it)) }
    }

    @Test fun readsTheRootResponse() {
        val body = "PEM".toByteArray()
        assertArrayEquals(body, AndroidLanRootFetcher.parseResponse(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-x509-ca-cert\r\nContent-Length: 3\r\n\r\nPEMtrailing".toByteArray()))
        assertArrayEquals(body, AndroidLanRootFetcher.parseResponse(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nPE\r\n1\r\nM\r\n0\r\n\r\n".toByteArray()))
        listOf(
            "HTTP/1.1 404 Not Found\r\nContent-Length: 3\r\n\r\nPEM",
            "HTTP/1.1 308 Permanent Redirect\r\nLocation: https://x\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nPEM",
            "garbage",
        ).forEach { raw -> assertTrue(raw, runCatching { AndroidLanRootFetcher.parseResponse(raw.toByteArray()) }.isFailure) }
    }

    @Test fun stopsReadingOnceTheAnnouncedBodyArrived() {
        val head = "HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n"
        assertTrue(!AndroidLanRootFetcher.isComplete("HTTP/1.1 200 OK\r\nContent-Len".toByteArray()))
        assertTrue(!AndroidLanRootFetcher.isComplete((head + "PE").toByteArray()))
        assertTrue(AndroidLanRootFetcher.isComplete((head + "PEM").toByteArray()))
        assertTrue(!AndroidLanRootFetcher.isComplete("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nPEM".toByteArray()))
    }

    @Test fun acceptsOnlyTheConfirmedSelfSignedCa() {
        val root = AndroidLanRoot.accept(CA.toByteArray(), spki)
        assertNotNull(root)
        assertEquals(spki, AndroidLanRoot.spkiSha256(root!!))
        assertNull(AndroidLanRoot.accept(CA.toByteArray(), "0" + spki.drop(1)))
        assertNull(AndroidLanRoot.accept(LEAF.toByteArray(), "2ae1c98f80de22974e2b4f0f7fee5c06722ee19d7e5572c1a230836a035476dd"))
        assertNull(AndroidLanRoot.accept((CA + "\n" + CA).toByteArray(), spki))
        assertNull(AndroidLanRoot.accept("not a certificate".toByteArray(), spki))
        assertNull(AndroidLanRoot.accept(CA.toByteArray(), spki, nowMs = 0L))
        assertNotNull(AndroidLanRoot.socketFactory(root))
    }

    @Test fun decodesTheSetupQrFromAPaddedCameraPlane() {
        val text = AndroidLanPairingPayload.build("192.168.0.236", spki)
        val matrix = com.google.zxing.qrcode.QRCodeWriter()
            .encode(text, com.google.zxing.BarcodeFormat.QR_CODE, 480, 480)
        val width = matrix.width
        val height = matrix.height
        val stride = width + 32 // camera planes often pad each row
        val plane = ByteArray(stride * height) { 0x55 }
        for (y in 0 until height) for (x in 0 until width) {
            plane[y * stride + x] = if (matrix[x, y]) 0x10 else 0xF0.toByte()
        }
        assertEquals(text, AndroidQrDecoder.decode(plane, stride, width, height))
        assertNull(AndroidQrDecoder.decode(ByteArray(stride * height) { 0x55 }, stride, width, height))
    }

    @Test fun groupsTheFingerprintForReading() {
        assertEquals("1bf4 569a 99de", AndroidLanRoot.grouped(spki.take(12)))
    }

    private companion object {
        // Synthetic certificates made for this test only (keys discarded); no installation uses them.
        const val CA = """-----BEGIN CERTIFICATE-----
MIIBqzCCAVGgAwIBAgIUOnP/XMKBRPA9SF/BPeOnTLoFc50wCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXU3ludGhldGljIHRlc3QgTEFOIHJvb3QwIBcNMjYxMTEwMTk1
NDE1WhgPMjEyNjEwMTcxOTU0MTVaMCIxIDAeBgNVBAMMF1N5bnRoZXRpYyB0ZXN0
IExBTiByb290MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEuuX0HRUy0FzwclIE
Qm2Q8WfUxiuaXVHoq0kwg7/UFoh0GRF+yRxmLzyzIbQ3JddxYJESj2N2AAKagKm1
dWw/PqNjMGEwHQYDVR0OBBYEFIPnoSd4luel1ART9XUgNz7sroneMB8GA1UdIwQY
MBaAFIPnoSd4luel1ART9XUgNz7sroneMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0P
AQH/BAQDAgEGMAoGCCqGSM49BAMCA0gAMEUCIFFf39hCzxwwONKxuBmETAI9LfTg
gQR5LIl1NSP/W7aaAiEA4Vyzh1/RWODQm2gg8Q/Ixkh9kH75p4lYNG7/BHJmqF0=
-----END CERTIFICATE-----"""
        const val LEAF = """-----BEGIN CERTIFICATE-----
MIIBjzCCATagAwIBAgIUaLwsmeNKaOEbziK3mfSFHv8KDVUwCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTU3ludGhldGljIHRlc3QgbGVhZjAgFw0yNjExMTAxOTU0MTVa
GA8yMTI2MTAxNzE5NTQxNVowHjEcMBoGA1UEAwwTU3ludGhldGljIHRlc3QgbGVh
ZjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABE79ZPU57vWOicgOfbjtL8Y2fvSw
hVBIVV//D9/EjceGjKxEGJAKRoJJ2++aOrF0/S1O84tKe6sxRhGYOupsMgmjUDBO
MB0GA1UdDgQWBBQWroPiQ8gZ9rFHRAXcwzv+VqiDezAfBgNVHSMEGDAWgBQWroPi
Q8gZ9rFHRAXcwzv+VqiDezAMBgNVHRMBAf8EAjAAMAoGCCqGSM49BAMCA0cAMEQC
IA11ABmjVrEcb5NFjVfiSUM73CasHAcmABKNGzrY0iGuAiAxboJcwq+FCmu23yIe
QHevZiAXNaH70L2ZTT47kqI7EA==
-----END CERTIFICATE-----"""
    }
}
