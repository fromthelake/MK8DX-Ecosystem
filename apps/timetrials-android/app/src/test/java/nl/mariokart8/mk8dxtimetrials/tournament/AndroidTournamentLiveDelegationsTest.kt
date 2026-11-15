package nl.mariokart8.mk8dxtimetrials.tournament

import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidTournamentLiveDelegationsTest {
    private val now = 1_800_000_000_000L
    private val moment: (Long) -> String = { "t$it" }

    private fun delegation(
        account: String = "user_account.capture",
        status: String = "active",
        expiresAtMs: Long = now + 3_600_000,
        revokedAtMs: Long? = null,
    ) = AndroidLiveCaptureDelegation(
        delegationId = "live_capture_delegation.one", tournamentId = "tournament.demo", delegateUserAccountId = account,
        delegateDisplayName = "Capture operator", status = status, reason = "Live capture delegated by Tournament director",
        grantedByUserAccountId = "user_account.director", grantedAtMs = now - 60_000, expiresAtMs = expiresAtMs,
        revokedAtMs = revokedAtMs,
    )

    private fun record(
        id: String,
        liveStatus: String?,
        approvedAtMs: Long? = null,
        account: String = "user_account.capture",
        name: String = "Capture operator",
    ) = AndroidTournamentEvidenceRecord(
        recordId = id, clientRecordId = "run-$id", revision = 3, status = "uploading",
        sourceKind = "tournament_live_capture", uploadedBy = AndroidTournamentEvidenceUploader(account, name),
        complete = false, resultCount = 0, createdAtMs = 1, updatedAtMs = 2,
        live = liveStatus?.let { AndroidTournamentLiveAssociation(status = it, approvedAtMs = approvedAtMs) },
    )

    @Test
    fun offersEachConnectedAccountOnceAndLeavesOutThoseAlreadyDelegated() {
        val records = listOf(
            record("a", "requested"),
            record("b", "active", approvedAtMs = 5),
            record("c", "requested", account = "user_account.second", name = "Second PC"),
            record("d", null, account = "user_account.processor", name = "Processor upload"),
        )
        assertEquals(
            listOf("user_account.capture", "user_account.second"),
            androidLiveDelegationCandidates(records, emptyList(), now).map { it.userAccountId },
        )
        assertEquals(
            listOf("user_account.second"),
            androidLiveDelegationCandidates(records, listOf(delegation()), now).map { it.userAccountId },
        )
        // A revoked or expired delegation offers the account again.
        assertEquals(2, androidLiveDelegationCandidates(records, listOf(delegation(status = "revoked")), now).size)
        assertEquals(2, androidLiveDelegationCandidates(records, listOf(delegation(expiresAtMs = now)), now).size)
    }

    @Test
    fun withdrawsOnlyFeedsThatWentPublic() {
        assertTrue(androidLiveFeedWithdrawable(record("a", "active", approvedAtMs = 5)))
        assertTrue(androidLiveFeedWithdrawable(record("b", "complete", approvedAtMs = 5)))
        assertTrue(androidLiveFeedWithdrawable(record("c", "stopping", approvedAtMs = 5)))
        assertFalse(androidLiveFeedWithdrawable(record("d", "stopping", approvedAtMs = null)))
        assertFalse(androidLiveFeedWithdrawable(record("e", "requested")))
        assertFalse(androidLiveFeedWithdrawable(record("f", "invalidated")))
        assertFalse(androidLiveFeedWithdrawable(record("g", null)))
    }

    @Test
    fun namesEachDelegationState() {
        val english = AndroidProductLanguage.ENGLISH
        assertEquals("active until t${now + 3_600_000}", androidLiveDelegationState(english, delegation(), now, moment))
        assertEquals("expired t$now", androidLiveDelegationState(english, delegation(expiresAtMs = now), now, moment))
        assertEquals("revoked t5", androidLiveDelegationState(english, delegation(status = "revoked", revokedAtMs = 5), now, moment))
        assertEquals("revoked", androidLiveDelegationState(english, delegation(status = "revoked"), now, moment))
        assertEquals(
            "ingetrokken t5",
            androidLiveDelegationState(AndroidProductLanguage.DUTCH, delegation(status = "revoked", revokedAtMs = 5), now, moment),
        )
    }

    @Test
    fun aRequestedFeedWaitsForTheDirectorUnlessItsUploaderIsDelegated() {
        val english = AndroidProductLanguage.ENGLISH
        assertTrue(androidRequestedLiveFeedText(english, null, moment).startsWith("Waiting for the Director."))
        assertTrue(androidRequestedLiveFeedText(AndroidProductLanguage.DUTCH, null, moment).startsWith("Wacht op de toernooileider."))
        val active = androidActiveLiveCaptureDelegation(listOf(delegation()), "user_account.capture", now)
        assertTrue(
            androidRequestedLiveFeedText(english, active, moment)
                .startsWith("This account holds your capture delegation until t${now + 3_600_000}."),
        )
        assertNull(androidActiveLiveCaptureDelegation(listOf(delegation()), "user_account.second", now))
        assertNull(androidActiveLiveCaptureDelegation(null, "user_account.capture", now))
    }

    @Test
    fun offersTheWebDurationsWithTwelveHoursAsDefault() {
        assertEquals(listOf(120, 360, 720, 1_440, 4_320, 10_080), ANDROID_LIVE_DELEGATION_DURATIONS)
        assertEquals(720, ANDROID_LIVE_CAPTURE_DELEGATION_DEFAULT_MINUTES)
        assertEquals("12 hours (default)", androidLiveDelegationDurationLabel(AndroidProductLanguage.ENGLISH, 720))
        assertEquals("7 dagen (maximaal)", androidLiveDelegationDurationLabel(AndroidProductLanguage.DUTCH, 10_080))
    }
}
