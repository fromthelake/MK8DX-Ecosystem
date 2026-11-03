package nl.mariokart8.mk8dxtimetrials.ecosystem

import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceChoice
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxAppearanceSyncClient

/**
 * The account side of the appearance choice (ADR-0205 §2): the value the
 * account holds, read and written through `/v1/account/appearance-preference`
 * exactly as the API serves it.
 *
 * Only the *choice* travels — `system`, `light` or `dark`, or nothing at all
 * when the account has never held one. A device on `system` still follows its
 * own phone, which is why the resolved mode is never sent.
 */
internal class AndroidAccountAppearanceSync(
    private val client: AndroidTimeTrialsEcosystemDataSource,
) : Mk8dxAppearanceSyncClient {
    override fun readAccountChoice(): Mk8dxAppearanceChoice? =
        Mk8dxAppearanceChoice.ofWire(client.appearancePreference()?.appearance)

    override fun writeAccountChoice(choice: Mk8dxAppearanceChoice): Boolean =
        client.saveAppearancePreference(choice.wireValue)?.appearance == choice.wireValue
}

/** Signed out, or no client: the choice stays on this phone. */
internal fun androidAppearanceSync(
    client: AndroidTimeTrialsEcosystemDataSource?,
    playerId: String?,
): Mk8dxAppearanceSyncClient? {
    if (client == null || playerId == null) return null
    return AndroidAccountAppearanceSync(client)
}
