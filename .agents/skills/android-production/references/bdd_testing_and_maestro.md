# BDD Testing & Maestro Guide

In 2026, large Android engineering teams rarely write raw Espresso tests. Instead, they apply Behavior-Driven Development (BDD) to ensure tests read like executable user journey specifications.

---

## 1. The Three Modern BDD Approaches

| Strategy                           | Reference Tool              | Primary Use Case                                                                     |
| :--------------------------------- | :-------------------------- | :----------------------------------------------------------------------------------- |
| **Strict Gherkin (`.feature`)**    | `cucumber/cucumber-android` | Product-led teams where non-technical stakeholders write feature files               |
| **Kotlin BDD Step DSL**            | `KasperskyLab/Kaspresso`    | Engineering-led teams wanting step annotations, OS control, and zero flakiness       |
| **Screen/Robot Pattern & Maestro** | `Firefox Fenix` & `Maestro` | Cross-platform teams wanting readable Compose tests and declarative YAML smoke flows |

---

## 2. Approach 1: Strict Gherkin with `cucumber-android`

Feature files reside in `androidTest/assets/features/*.feature`:

```gherkin
Feature: Offline Voting Eligibility
  Scenario: Adult citizen is eligible
    Given the voting app is launched
    When the user enters age "20"
    And the user selects country "NP"
    And the user taps "Check offline"
    Then the eligibility result shows "Age 20 meets the minimum voting age of 18 in NP."
```

### Kotlin Step Definition Binding with Compose Semantics

```kotlin
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.assertTextEquals
import io.cucumber.java.en.Given
import io.cucumber.java.en.When
import io.cucumber.java.en.Then
import io.cucumber.junit.Cucumber
import org.junit.runner.RunWith

class VotingStepDefinitions(
    private val composeRule: ComposeContentTestRule
) {
    @Given("the voting app is launched")
    fun appLaunched() {
        // App is already displayed via TestRule
    }

    @When("the user enters age {string}")
    fun enterAge(age: String) {
        composeRule.onNodeWithTag("age-field").performTextInput(age)
    }

    @When("the user selects country {string}")
    fun enterCountry(country: String) {
        composeRule.onNodeWithTag("country-field").performTextInput(country)
    }

    @When("the user taps {string}")
    fun tapButton(buttonText: String) {
        composeRule.onNodeWithTag("check-button").performClick()
    }

    @Then("the eligibility result shows {string}")
    fun verifyResult(expected: String) {
        composeRule.onNodeWithTag("offline-result").assertTextEquals(expected)
    }
}
```

---

## 3. Approach 2: Kotlin BDD Step DSL with Kaspresso

Kaspresso wraps Compose semantics with built-in retry timeouts (eliminating flakiness) and `Kautomator` for handling system dialogs (e.g. biometric prompts, notification permissions):

```kotlin
import com.kaspersky.kaspresso.testcases.api.testcase.TestCase
import org.junit.Test

class VotingKaspressoTest : TestCase() {

    @Test
    fun testEligibleVoterJourney() = run {
        step("Given the user is on the voting home screen") {
            VotingScreen.assertDisplayed()
        }

        step("When the user submits valid adult age in Nepal") {
            VotingScreen {
                ageField.replaceText("20")
                countryField.replaceText("NP")
                checkButton.click()
            }
        }

        step("Then voting eligibility is confirmed") {
            VotingScreen {
                resultText.hasText("Age 20 meets the minimum voting age of 18 in NP.")
            }
        }
    }
}
```

---

## 4. Approach 3: Screen/Robot Pattern (Firefox & Proton Pass)

The Screen/Robot pattern cleanly separates **"What"** the test asserts from **"How"** Compose semantics find elements:

```kotlin
class VotingScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun verifyEligibleVoter() {
        votingRobot(composeTestRule) {
            enterAge("20")
            enterCountry("NP")
            tapCheckOffline()
        } verify {
            resultMatches("Age 20 meets the minimum voting age of 18 in NP.")
        }
    }
}
```

---

## 5. Declarative Maestro E2E Flows

For cross-platform smoke tests, **Maestro (`.maestro/flows/*.yaml`)** runs natively across Android and iOS without compiling test APKs:

```yaml
# e2e/maestro/flows/offline-eligibility.yaml
appId: com.tran.voting
tags: [offline, smoke]
---
- launchApp:
    clearState: true

- tapOn:
    id: age-field
- eraseText: 10
- inputText: '20'

- tapOn:
    id: country-field
- eraseText: 10
- inputText: NP

- tapOn:
    id: check-button

- assertVisible:
    id: offline-result
    text: 'Age 20 meets the minimum voting age of 18 in NP.'
```

### Running Maestro Flows

```bash
maestro test e2e/maestro/flows/offline-eligibility.yaml
```
