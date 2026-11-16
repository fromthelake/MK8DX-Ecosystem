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
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonSize
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTextField
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
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
    /** The root is fetched first, so the confirm screen can show the same short code as the card. */
    data class Fetching(val offer: AndroidLanPairingOffer) : PairingStep
    data class Confirm(val offer: AndroidLanPairingOffer, val root: java.security.cert.X509Certificate) : PairingStep
}

/**
 * Scan the setup QR on the host screen, show the address and key fingerprint, and connect only
 * after the person confirms both (ADR-0223 decision 7). [onPaired] receives the exact origin.
 */
@Composable
internal fun AndroidLanPairingFlow(onPaired: (String) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val language = remember { AndroidProductLanguageStore.readForFirstStart(context) }
    fun t(en: String, nl: String) = androidText(language, en, nl)
    var step by remember { mutableStateOf<PairingStep>(PairingStep.Scanning) }
    var message by remember { mutableStateOf<String?>(null) }
    var pasted by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    fun fetch(parsed: AndroidLanPairingOffer) {
        message = null
        step = PairingStep.Fetching(parsed)
        scope.launch {
            // Accepted only when its key matches the fingerprint in the QR (the pin); nothing is stored yet.
            val root = withContext(Dispatchers.IO) {
                runCatching { AndroidLanRootFetcher.fetch(parsed.host) }
                    .onFailure { android.util.Log.w("MK8DXLanPairing", "root fetch failed: ${it.javaClass.simpleName}: ${it.message}") }
                    .getOrNull()
                    ?.let { bytes ->
                        AndroidLanRoot.accept(bytes, parsed.spkiSha256)
                            ?: null.also { android.util.Log.w("MK8DXLanPairing", "root refused (${bytes.size} bytes)") }
                    }
            }
            if (root == null) {
                step = PairingStep.Scanning
                message = t(
                    "Could not get a matching certificate from ${parsed.host}. Check the network and that the host is running, then try again. Nothing was changed.",
                    "Geen passend certificaat gekregen van ${parsed.host}. Controleer het netwerk en of de host draait, en probeer opnieuw. Er is niets gewijzigd.",
                )
            } else {
                step = PairingStep.Confirm(parsed, root)
            }
        }
    }

    fun offer(text: String) {
        val parsed = AndroidLanPairingPayload.parse(text)
        if (parsed != null) fetch(parsed)
        else message = t(
            "This is not the QR code of a Prepare a device card. A personal sign-in card comes later, in the browser.",
            "Dit is niet de QR-code van een kaart Apparaat voorbereiden. Een persoonlijke inlogkaart komt later, in de browser.",
        )
    }

    Mk8dxTheme(Mk8dxTheme.appearance) {
    val colors = Mk8dxTheme.colors
    val type = Mk8dxTheme.type
    Column(
        Modifier
            .fillMaxSize()
            .background(colors.surfaceApp)
            // Like the community screen: no shell around it, so it keeps clear of the bars itself.
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(Mk8dxSpacing.xxl)
            .testTag("lan-pairing"),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg),
    ) {
        Mk8dxSectionLabel(t("HOME OR CLUB", "THUIS OF CLUB"))
        when (val current = step) {
            PairingStep.Scanning -> {
                Mk8dxDisplayText(t("Scan the Prepare a device card", "Scan de kaart Apparaat voorbereiden"), type.display4)
                Text(
                    t(
                        "Point the camera at the QR code on the Prepare a device card. Your administrator shows it on the MK8DX computer or hands it out on paper. The phone must be on the same Wi-Fi as that computer.",
                        "Richt de camera op de QR-code van de kaart Apparaat voorbereiden. Je beheerder laat die zien op de MK8DX-computer of geeft hem op papier. De telefoon moet op dezelfde wifi zitten als die computer.",
                    ),
                    style = type.body,
                    color = colors.textBody,
                )
                QrCameraPreview(onText = ::offer, label = t("Use the camera", "Camera gebruiken"))
                message?.let { Mk8dxStatusMessage(it, tone = Mk8dxStatusTone.Error) }
                Mk8dxTextField(
                    label = t("Or paste the setup link", "Of plak de setup-link"),
                    value = pasted,
                    onValueChange = { pasted = it },
                    tag = "lan-pairing-link",
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                    Mk8dxButton(t("Cancel", "Annuleren"), onCancel, variant = Mk8dxButtonVariant.Quiet, tag = "lan-pairing-cancel")
                    Mk8dxButton(
                        t("Next", "Volgende"),
                        { offer(pasted) },
                        variant = Mk8dxButtonVariant.Primary,
                        disabledReason = if (pasted.isBlank()) t("Paste the setup link first", "Plak eerst de setup-link") else null,
                        disabledReasonShown = false,
                        tag = "lan-pairing-next",
                    )
                }
            }
            is PairingStep.Fetching -> {
                Mk8dxDisplayText(t("Check that this is your installation", "Controleer dat dit jouw installatie is"), type.display4)
                Mk8dxStatusMessage(t("Connecting…", "Verbinden…"), tone = Mk8dxStatusTone.Info)
            }
            is PairingStep.Confirm -> {
                val pairing = current.offer
                val certificateSha256 = AndroidLanCertificateCode.certificateSha256(current.root)
                Mk8dxDisplayText(t("Check that this is your installation", "Controleer dat dit jouw installatie is"), type.display4)
                Text(
                    t(
                        "First check this code. It must match the code on the Prepare a device card or in MK8DX beheer on the host computer.",
                        "Controleer eerst deze code. Hij moet gelijk zijn aan de code op de kaart Apparaat voorbereiden of in MK8DX beheer op de hostcomputer.",
                    ),
                    style = type.body,
                    color = colors.textBody,
                )
                Mk8dxPanel(t("CODE", "CODE")) {
                    Text(
                        AndroidLanCertificateCode.short(certificateSha256),
                        style = type.display6,
                        color = colors.textPrimary,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.testTag("lan-pairing-short-code"),
                    )
                }
                Mk8dxPanel(t("ADDRESS", "ADRES")) {
                    Text(pairing.origin, style = type.body, color = colors.textPrimary, fontFamily = FontFamily.Monospace)
                }
                var details by rememberSaveable { mutableStateOf(false) }
                Mk8dxButton(
                    t("Full fingerprints", "Volledige vingerafdrukken"),
                    { details = !details },
                    variant = Mk8dxButtonVariant.Quiet,
                    tag = "lan-pairing-details",
                )
                if (details) {
                    Mk8dxPanel(null) {
                        Text(t("Root certificate SHA-256:", "SHA-256 van het basiscertificaat:"), style = type.bodyS, color = colors.textSecondary)
                        Text(certificateSha256, style = type.bodyS, color = colors.textPrimary, fontFamily = FontFamily.Monospace)
                        Text(t("Root public key SHA-256 (SPKI):", "SHA-256 van de publieke sleutel (SPKI):"), style = type.bodyS, color = colors.textSecondary)
                        Text(pairing.spkiSha256, style = type.bodyS, color = colors.textPrimary, fontFamily = FontFamily.Monospace)
                    }
                }
                Text(
                    t(
                        "Connect only if the code matches exactly. The app will then trust this installation, and only for this address.",
                        "Verbind alleen als de code precies gelijk is. De app vertrouwt daarna deze installatie, en alleen voor dit adres.",
                    ),
                    style = type.body,
                    color = colors.textBody,
                )
                message?.let { Mk8dxStatusMessage(it, tone = Mk8dxStatusTone.Error) }
                Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                    Mk8dxButton(
                        t("Back", "Terug"),
                        { message = null; step = PairingStep.Scanning },
                        variant = Mk8dxButtonVariant.Quiet,
                        tag = "lan-pairing-back",
                    )
                    Mk8dxButton(
                        t("Connect", "Verbinden"),
                        {
                            if (AndroidLanPairingStore.save(context, pairing.origin, pairing.spkiSha256, current.root)) {
                                onPaired(pairing.origin)
                            } else {
                                message = t("Could not save the connection. Try again.", "De verbinding kon niet worden opgeslagen. Probeer opnieuw.")
                            }
                        },
                        variant = Mk8dxButtonVariant.Primary,
                        tag = "lan-pairing-connect",
                    )
                }
            }
        }
    }
    }
}

/**
 * The app's own QR scanner: [onText] receives every decoded text; a text [accepts] approves is delivered once.
 */
@Composable
internal fun QrCameraPreview(
    onText: (String) -> Unit,
    label: String,
    accepts: (String) -> Boolean = { AndroidLanPairingPayload.parse(it) != null },
    tag: String = "lan-pairing-camera",
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    if (!granted) {
        Mk8dxButton(
            label,
            { permission.launch(Manifest.permission.CAMERA) },
            variant = Mk8dxButtonVariant.Primary,
            size = Mk8dxButtonSize.Lg,
            camera = true,
            tag = tag,
            modifier = Modifier.fillMaxWidth(),
        )
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
    val frame = RoundedCornerShape(Mk8dxSpacing.md)
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .clip(frame)
            .border(Mk8dxSpacing.xxs, Mk8dxTheme.colors.borderStrong, frame)
            .background(Mk8dxTheme.colors.surfaceRaised)
            .clipToBounds(),
    ) {
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
                                if (text != null && accepts(text) &&
                                    delivered.compareAndSet(false, true)) {
                                    ContextCompat.getMainExecutor(viewContext).execute { onText(text) }
                                } else if (text != null && !accepts(text)) {
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
