package com.tran.voting.feature.voting

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

// 1. Immutable Circuit State
data class VotingCircuitState(
    val ageText: String,
    val countryCode: String,
    val resultText: String,
    val isChecking: Boolean,
    val eventSink: (VotingCircuitEvent) -> Unit
)

// 2. Sealed Circuit Events
sealed interface VotingCircuitEvent {
    data class AgeChanged(val age: String) : VotingCircuitEvent
    data class CountryChanged(val country: String) : VotingCircuitEvent
    data object CheckEligibility : VotingCircuitEvent
}

// 3. Compose-Driven Presenter
class VotingCircuitPresenter {
    @Composable
    fun present(): VotingCircuitState {
        var ageText by remember { mutableStateOf("20") }
        var countryCode by remember { mutableStateOf("NP") }
        var resultText by remember { mutableStateOf("Ready to check") }
        var isChecking by remember { mutableStateOf(false) }

        return VotingCircuitState(
            ageText = ageText,
            countryCode = countryCode,
            resultText = resultText,
            isChecking = isChecking,
            eventSink = { event ->
                when (event) {
                    is VotingCircuitEvent.AgeChanged -> ageText = event.age
                    is VotingCircuitEvent.CountryChanged -> countryCode = event.country
                    VotingCircuitEvent.CheckEligibility -> {
                        isChecking = true
                        val age = ageText.toIntOrNull()
                        resultText = if (age != null && age >= 18) {
                            "Eligible to vote in $countryCode"
                        } else {
                            "Not eligible to vote in $countryCode"
                        }
                        isChecking = false
                    }
                }
            }
        )
    }
}

// 4. Circuit Pure Composable View
@Composable
fun VotingCircuitUi(
    state: VotingCircuitState,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        OutlinedTextField(
            value = state.ageText,
            onValueChange = { state.eventSink(VotingCircuitEvent.AgeChanged(it)) },
            label = { Text("Age") },
            modifier = Modifier.testTag("age-field")
        )

        OutlinedTextField(
            value = state.countryCode,
            onValueChange = { state.eventSink(VotingCircuitEvent.CountryChanged(it)) },
            label = { Text("Country") },
            modifier = Modifier.testTag("country-field")
        )

        Button(
            onClick = { state.eventSink(VotingCircuitEvent.CheckEligibility) },
            modifier = Modifier.testTag("check-button")
        ) {
            Text(if (state.isChecking) "Checking…" else "Check offline")
        }

        Text(
            text = state.resultText,
            modifier = Modifier.testTag("offline-result")
        )
    }
}
