# Android Architecture & Circuit MVI Guide

This guide details modern Android architecture targeting Jetpack Compose, Kotlin 2.x, and Android 17 (SDK 37), synthesizing Google's **Now in Android (`android/nowinandroid`)**, **Element X Android (`element-hq/element-x-android`)**, and **Slack Circuit (`slackhq/circuit`)**.

---

## 1. Layered Reactive Architecture (Now in Android)

Google's architecture standard organizes applications into three decoupled layers:

```
+-------------------------------------------------------+
|                       UI Layer                        |
|   Composables + Circuit Presenter / ViewModel        |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
|                     Domain Layer                      |
|   UseCases / Interactors (Pure Kotlin, Business Logic)|
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
|                      Data Layer                       |
|   Repositories, Offline Engines (UniFFI), Network, DB |
+-------------------------------------------------------+
```

### Unidirectional Data Flow (UDF) Rules:

1. **Downstream Data**: State flows down from repositories to domain interactors, then into the UI as immutable data classes.
2. **Upstream Events**: User intents (clicks, text changes) flow upstream as sealed interface actions/events.
3. **Lifecycle Awareness**: In Compose, always collect state using:
   ```kotlin
   val uiState by viewModel.uiState.collectAsStateWithLifecycle()
   ```
   This automatically pauses state collection when the Activity/Fragment is stopped, conserving battery and CPU.

---

## 2. Slack Circuit MVI Architecture (Element X Standard)

Slack Circuit replaces traditional `AndroidViewModel` classes with lightweight, Compose-driven presenters.

### Circuit Building Blocks

```kotlin
import com.slack.circuit.runtime.CircuitUiEvent
import com.slack.circuit.runtime.CircuitUiState
import com.slack.circuit.runtime.presenter.Presenter
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

// 1. Immutable UI State
data class VotingUiState(
    val ageText: String,
    val countryCode: String,
    val resultText: String,
    val isEvaluating: Boolean,
    val eventSink: (VotingUiEvent) -> Unit
) : CircuitUiState

// 2. User & Lifecycle Events
sealed interface VotingUiEvent : CircuitUiEvent {
    data class AgeChanged(val age: String) : VotingUiEvent
    data class CountryChanged(val country: String) : VotingUiEvent
    data object SubmitTapped : VotingUiEvent
}

// 3. Compose-Driven Presenter
class VotingPresenter(
    private val offlineEngine: VotingEngine
) : Presenter<VotingUiState> {

    @Composable
    override fun present(): VotingUiState {
        var ageText by remember { mutableStateOf("20") }
        var countryCode by remember { mutableStateOf("NP") }
        var resultText by remember { mutableStateOf("Tap Check offline") }
        var isEvaluating by remember { mutableStateOf(false) }

        return VotingUiState(
            ageText = ageText,
            countryCode = countryCode,
            resultText = resultText,
            isEvaluating = isEvaluating,
            eventSink = { event ->
                when (event) {
                    is VotingUiEvent.AgeChanged -> ageText = event.age
                    is VotingUiEvent.CountryChanged -> countryCode = event.country
                    VotingUiEvent.SubmitTapped -> {
                        isEvaluating = true
                        val res = offlineEngine.checkEligibility(ageText, countryCode)
                        resultText = res
                        isEvaluating = false
                    }
                }
            }
        )
    }
}
```

### Why Circuit Surpasses Traditional ViewModels

- **Seamless Testing**: Presenters are standard functions tested with `presenter.test { val state = awaitItem(); ... }`.
- **Zero Android Lifecycle Boilerplate**: No saved state handles or ViewModel factories needed.
- **Natural Compose Integration**: State management is just Compose code running inside the composition tree.

---

## 3. Konsist Architectural Guardrails

**Element X** uses **Konsist** to run automated unit tests that enforce architecture and prevent code degradation.

### Enforcing Module Boundaries

Ensure feature modules do not depend on internal classes of other features:

```kotlin
import com.lemonappdev.konsist.api.Konsist
import com.lemonappdev.konsist.api.ext.list.withPackage
import com.lemonappdev.konsist.api.verify.assertTrue
import org.junit.jupiter.api.Test

class ArchitectureGuardrailsTest {

    @Test
    fun `feature modules never import internal classes of other features`() {
        Konsist
            .scopeFromProject()
            .files
            .withPackage("com.tran.voting.features..")
            .assertTrue { file ->
                val illegalImports = file.imports.filter { import ->
                    import.name.contains(".internal.") &&
                    !import.name.startsWith(file.packageDirective?.name ?: "")
                }
                illegalImports.isEmpty()
            }
    }

    @Test
    fun `all ViewModel classes end with ViewModel suffix and extend BaseViewModel`() {
        Konsist
            .scopeFromProject()
            .classes()
            .withNameEndingWith("ViewModel")
            .assertTrue { clazz ->
                clazz.hasParentWithName("BaseViewModel")
            }
    }

    @Test
    fun `every public Composable screen has a Preview annotation`() {
        Konsist
            .scopeFromProject()
            .functions()
            .filter { it.hasAnnotationWithName("Composable") && it.name.endsWith("Screen") }
            .assertTrue { it.containingFile.hasAnnotationWithName("Preview") }
    }
}
```
