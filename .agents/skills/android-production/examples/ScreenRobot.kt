package com.tran.voting.testing.robot

import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput

/**
 * Screen/Robot pattern implementation for Jetpack Compose BDD testing.
 * Inspired by Mozilla Fenix (Firefox Android) and `protonpass/android-pass`.
 */
fun votingRobot(
    composeRule: ComposeTestRule,
    block: VotingRobot.() -> Unit
): VotingRobot = VotingRobot(composeRule).apply(block)

class VotingRobot(private val composeRule: ComposeTestRule) {

    private val ageField: SemanticsNodeInteraction
        get() = composeRule.onNodeWithTag("age-field")

    private val countryField: SemanticsNodeInteraction
        get() = composeRule.onNodeWithTag("country-field")

    private val checkButton: SemanticsNodeInteraction
        get() = composeRule.onNodeWithTag("check-button")

    private val resultText: SemanticsNodeInteraction
        get() = composeRule.onNodeWithTag("offline-result")

    fun enterAge(age: String) {
        ageField.performTextClearance()
        ageField.performTextInput(age)
    }

    fun enterCountry(country: String) {
        countryField.performTextClearance()
        countryField.performTextInput(country)
    }

    fun tapCheckOffline() {
        checkButton.performClick()
    }

    infix fun verify(block: VotingVerificationRobot.() -> Unit): VotingVerificationRobot {
        return VotingVerificationRobot(composeRule).apply(block)
    }
}

class VotingVerificationRobot(private val composeRule: ComposeTestRule) {
    fun resultMatches(expected: String) {
        composeRule.onNodeWithTag("offline-result")
            .assertIsDisplayed()
            .assertTextEquals(expected)
    }

    fun checkButtonIsVisible() {
        composeRule.onNodeWithTag("check-button").assertIsDisplayed()
    }
}
