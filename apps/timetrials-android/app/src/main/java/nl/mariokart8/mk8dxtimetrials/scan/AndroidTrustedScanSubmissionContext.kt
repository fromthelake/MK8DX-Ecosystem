package nl.mariokart8.mk8dxtimetrials.scan

import java.util.UUID
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.track.AndroidTrackCatalogEntry
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog

private val trustedScanPlayerIdPattern =
    Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
private val scanOpaqueSubmissionIdPattern =
    Regex("^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")

internal fun interface AndroidScanSubmissionOpaqueIdProvider {
    fun nextOpaqueId(): String
}

internal class AndroidTrustedScanSubmissionContextFactory(
    private val playerReference: ScanPlayerReferenceV1,
    private val producerVersion: String,
    private val opaqueIdProvider: AndroidScanSubmissionOpaqueIdProvider =
        AndroidScanSubmissionOpaqueIdProvider { UUID.randomUUID().toString() },
    private val clock: AndroidOutboxClock = AndroidOutboxClock(System::currentTimeMillis),
) {
    constructor(
        playerId: String,
        producerVersion: String,
        opaqueIdProvider: AndroidScanSubmissionOpaqueIdProvider =
            AndroidScanSubmissionOpaqueIdProvider { UUID.randomUUID().toString() },
        clock: AndroidOutboxClock = AndroidOutboxClock(System::currentTimeMillis),
    ) : this(
        ScanPlayerReferenceV1("player", playerId),
        producerVersion,
        opaqueIdProvider,
        clock,
    )

    init {
        require(
            (playerReference.namespace == "player" &&
                playerReference.value.length <= 135 &&
                playerReference.value.matches(trustedScanPlayerIdPattern)) ||
                (playerReference.namespace == "producer_local_profile" &&
                    playerReference.value.length in 1..255 &&
                    playerReference.value.none(Char::isISOControl)),
        )
        require(
            producerVersion.isNotBlank() &&
                producerVersion.codePointCount(0, producerVersion.length) <= 64 &&
                producerVersion.none(Char::isISOControl),
        )
    }

    fun create(track: AndroidTrackCatalogEntry, mode: Int): AndroidScanSubmissionContext {
        require(Schema9AndroidTrackCatalog.find(track.id) == track)
        require(mode == 150 || mode == 200)
        val opaqueId = opaqueIdProvider.nextOpaqueId()
        require(opaqueId.matches(scanOpaqueSubmissionIdPattern))
        return AndroidScanSubmissionContext(
            submissionId = "user_submission.time.$opaqueId",
            revision = 1,
            mode = mode,
            trackId = track.id,
            playerReference = playerReference,
            createdAtMs = clock.nowMs(),
            producerVersion = producerVersion,
            localRecordId = opaqueId,
        )
    }
}
