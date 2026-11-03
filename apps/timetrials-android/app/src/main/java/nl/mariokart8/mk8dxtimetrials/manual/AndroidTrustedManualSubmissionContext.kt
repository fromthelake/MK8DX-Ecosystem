package nl.mariokart8.mk8dxtimetrials.manual

import java.util.UUID
import nl.mariokart8.mk8dxtimetrials.outbox.AndroidOutboxClock
import nl.mariokart8.mk8dxtimetrials.track.AndroidTrackCatalogEntry
import nl.mariokart8.mk8dxtimetrials.track.Schema9AndroidTrackCatalog

private val trustedPlayerIdPattern =
    Regex("^player\\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
private val opaqueSubmissionIdPattern =
    Regex("^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$")

internal fun interface AndroidManualSubmissionOpaqueIdProvider {
    fun nextOpaqueId(): String
}

internal class AndroidTrustedManualSubmissionContextFactory(
    private val playerReference: ManualPlayerReferenceV1,
    private val producerVersion: String,
    private val opaqueIdProvider: AndroidManualSubmissionOpaqueIdProvider =
        AndroidManualSubmissionOpaqueIdProvider { UUID.randomUUID().toString() },
    private val clock: AndroidOutboxClock = AndroidOutboxClock(System::currentTimeMillis),
) {
    constructor(
        playerId: String,
        producerVersion: String,
        opaqueIdProvider: AndroidManualSubmissionOpaqueIdProvider =
            AndroidManualSubmissionOpaqueIdProvider { UUID.randomUUID().toString() },
        clock: AndroidOutboxClock = AndroidOutboxClock(System::currentTimeMillis),
    ) : this(
        ManualPlayerReferenceV1("player", playerId),
        producerVersion,
        opaqueIdProvider,
        clock,
    )

    init {
        require(
            (playerReference.namespace == "player" &&
                playerReference.value.length <= 135 &&
                playerReference.value.matches(trustedPlayerIdPattern)) ||
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

    fun create(track: AndroidTrackCatalogEntry): AndroidManualSubmissionContext {
        require(Schema9AndroidTrackCatalog.find(track.id) == track)
        val opaqueId = opaqueIdProvider.nextOpaqueId()
        require(opaqueId.matches(opaqueSubmissionIdPattern))
        return AndroidManualSubmissionContext(
            submissionId = "user_submission.time.$opaqueId",
            revision = 1,
            trackId = track.id,
            playerReference = playerReference,
            createdAtMs = clock.nowMs(),
            producerVersion = producerVersion,
            localRecordId = opaqueId,
        )
    }
}
