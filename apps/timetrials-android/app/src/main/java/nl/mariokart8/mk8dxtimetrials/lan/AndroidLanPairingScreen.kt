package nl.mariokart8.mk8dxtimetrials.lan

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguageStore
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private sealed interface PairingStep {
    data object Scanning : PairingStep
    data class Confirm(val offer: AndroidLanPairingOffer) : PairingStep
    data class Connecting(val offer: AndroidLanPairingOffer) : PairingStep
}

/**
 * Scan the setup QR on the host screen, show the address and key fingerprint, and connect only
 * after the person confirms both (ADR-0223 decision 7). [onPaired] receives the exact origin.
 */
@Composable
internal fun AndroidLanPairingFlow(onPaired: (String) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val language = remember { AndroidProductLanguageStore.read(context) }
    fun t(en: String, nl: String) = androidText(language, en, nl)
    var step by remember { mutableStateOf<PairingStep>(PairingStep.Scanning) }
    var message by remember { mutableStateOf<String?>(null) }
    var pasted by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    fun offer(text: String) {
        val parsed = AndroidLanPairingPayload.parse(text)
        if (parsed != null) { message = null; step = PairingStep.Confirm(parsed) }
        else message = t(
            "This is not the setup QR of an MK8DX installation. Scan the setup QR on the host screen, not a personal invitation.",
            "Dit is niet de setup-QR van een MK8DX-installatie. Scan de setup-QR op het hostscherm, niet een persoonlijke uitnodiging.",
        )
    }

    Column(
        Modifier.padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        when (val current = step) {
            PairingStep.Scanning -> {
                Text(t("Connect to a home or club installation", "Verbinden met een installatie thuis of bij de club"))
                Text(t(
                    "Scan the setup QR on the host screen. The phone must be on the same network.",
                    "Scan de setup-QR op het hostscherm. De telefoon moet op hetzelfde netwerk zitten.",
                ))
                QrCameraPreview(onText = ::offer)
                message?.let { Text(it) }
                OutlinedTextField(
                    value = pasted, onValueChange = { pasted = it }, singleLine = true,
                    label = { Text(t("Or paste the setup link", "Of plak de setup-link")) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onCancel) { Text(t("Cancel", "Annuleren")) }
                    Button(onClick = { offer(pasted) }, enabled = pasted.isNotBlank()) { Text(t("Next", "Volgende")) }
                }
            }
            is PairingStep.Confirm, is PairingStep.Connecting -> {
                val pairing = if (current is PairingStep.Confirm) current.offer else (current as PairingStep.Connecting).offer
                Text(t("Check this against the host screen", "Vergelijk dit met het hostscherm"))
                Text(t("Address", "Adres"))
                Text(pairing.origin, fontFamily = FontFamily.Monospace)
                Text(t("Root public key SHA-256 (SPKI)", "Root publieke sleutel SHA-256 (SPKI)"))
                Text(AndroidLanRoot.grouped(pairing.spkiSha256), fontFamily = FontFamily.Monospace)
                Text(t(
                    "Connect only if both match exactly. The app will then trust this installation, and only for this address.",
                    "Verbind alleen als beide precies gelijk zijn. De app vertrouwt daarna deze installatie, en alleen voor dit adres.",
                ))
                message?.let { Text(it) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { message = null; step = PairingStep.Scanning }, enabled = current is PairingStep.Confirm) {
                        Text(t("Back", "Terug"))
                    }
                    Button(enabled = current is PairingStep.Confirm, onClick = {
                        step = PairingStep.Connecting(pairing)
                        message = t("Connecting…", "Verbinden…")
                        scope.launch {
                            val root = withContext(Dispatchers.IO) {
                                runCatching { AndroidLanRootFetcher.fetch(pairing.host) }
                                    .onFailure { android.util.Log.w("MK8DXLanPairing", "root fetch failed: ${it.javaClass.simpleName}: ${it.message}") }
                                    .getOrNull()
                                    ?.let { bytes ->
                                        AndroidLanRoot.accept(bytes, pairing.spkiSha256)
                                            ?: null.also { android.util.Log.w("MK8DXLanPairing", "root refused (${bytes.size} bytes)") }
                                    }
                            }
                            if (root == null) {
                                step = PairingStep.Confirm(pairing)
                                message = t(
                                    "Could not get a matching certificate from ${pairing.host}. Check the network and that the host is running, then try again. Nothing was changed.",
                                    "Geen passend certificaat gekregen van ${pairing.host}. Controleer het netwerk en of de host draait, en probeer opnieuw. Er is niets gewijzigd.",
                                )
                            } else {
                                AndroidLanPairingStore.save(context, pairing.origin, pairing.spkiSha256, root)
                                onPaired(pairing.origin)
                            }
                        }
                    }) { Text(t("Connect", "Verbinden")) }
                }
            }
        }
    }
}

@Composable
private fun QrCameraPreview(onText: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    if (!granted) {
        val language = remember { AndroidProductLanguageStore.read(context) }
        Button(onClick = { permission.launch(Manifest.permission.CAMERA) }) {
            Text(androidText(language, "Use the camera", "Camera gebruiken"))
        }
        return
    }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val delivered = remember { AtomicBoolean(false) }
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    DisposableEffect(Unit) {
        onDispose {
            provider?.unbindAll()
            executor.shutdown()
        }
    }
    Box(Modifier.fillMaxWidth().aspectRatio(1f).clipToBounds()) {
        AndroidView(factory = { viewContext ->
            PreviewView(viewContext).apply {
                // A TextureView stays inside its Compose bounds; the default SurfaceView drew over the field below.
                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                scaleType = PreviewView.ScaleType.FILL_CENTER
                val future = ProcessCameraProvider.getInstance(viewContext)
                future.addListener({
                    runCatching {
                        val cameraProvider = future.get().also { provider = it }
                        val preview = Preview.Builder().build().also { it.surfaceProvider = surfaceProvider }
                        val analysis = ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                        analysis.setAnalyzer(executor) { image ->
                            try {
                                val plane = image.planes[0]
                                val buffer = plane.buffer
                                val data = ByteArray(buffer.remaining()).also { buffer.get(it) }
                                val text = AndroidQrDecoder.decode(data, plane.rowStride, image.width, image.height)
                                if (text != null && AndroidLanPairingPayload.parse(text) != null &&
                                    delivered.compareAndSet(false, true)) {
                                    ContextCompat.getMainExecutor(viewContext).execute { onText(text) }
                                } else if (text != null && AndroidLanPairingPayload.parse(text) == null) {
                                    ContextCompat.getMainExecutor(viewContext).execute { onText(text) }
                                }
                            } finally {
                                image.close()
                            }
                        }
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                    }
                }, ContextCompat.getMainExecutor(viewContext))
            }
        })
    }
}
