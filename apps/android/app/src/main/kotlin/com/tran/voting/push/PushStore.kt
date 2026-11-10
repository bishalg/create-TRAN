// Verifies: REQ-PSH-010
package com.tran.voting.push

import uniffi.tran_uniffi.TranLastRegistration
import java.util.UUID

/**
 * What the app remembers about push between launches: its installation id and the registration it
 * last made. Neither is a credential (spec 027), so it is plain app storage, not the session vault.
 */
interface PushStore {
    /** A random version-4 UUID made on first launch, never from hardware (REQ-PSH-010). */
    val installationId: String

    /** The token last registered and when, or `null`. */
    var lastRegistration: TranLastRegistration?
}

/** A new installation id: the platform's random UUID, and nothing about the device. */
fun newInstallationId(): String = UUID.randomUUID().toString()

/** The double the JVM suites and the screen contract use. */
class InMemoryPushStore(
    override val installationId: String = newInstallationId(),
    override var lastRegistration: TranLastRegistration? = null,
) : PushStore
