package com.tran.voting.ui

import android.content.res.Configuration
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertNotEquals
import java.util.Locale

/**
 * `screens.json`, the scenario catalogue `pnpm tokens:sync` writes from the Rust screen contract
 * into this test APK's assets (ADR-0038). The shape is documented at the top of
 * `crates/tran-tokens-codegen/src/screens_json.rs`: every step is one flat object with a `verb`.
 */
data class ScreenCatalogue(val screens: List<ContractScreen>) {
    /** The declaration of `id`, wherever it is listed: a shared element is declared once. */
    fun element(id: String): ContractElement? = screens.flatMap { it.elements }.firstOrNull { it.id == id }

    fun scenario(name: String): Pair<ContractScreen, ContractScenario> =
        screens.firstNotNullOf { screen -> screen.scenarios.firstOrNull { it.name == name }?.let { screen to it } }

    companion object {
        /** Read once from the instrumentation (test APK) assets. */
        val shared: ScreenCatalogue by lazy {
            val assets = InstrumentationRegistry.getInstrumentation().context.assets
            val json = JSONObject(assets.open("screens.json").bufferedReader().use { it.readText() })
            ScreenCatalogue(json.getJSONArray("screens").objects().map(::screen))
        }

        private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)

        private fun JSONObject.text(name: String): String? = if (has(name)) getString(name) else null

        private fun screen(json: JSONObject) = ContractScreen(
            id = json.getString("id"),
            elements = json.getJSONArray("elements").objects().map {
                ContractElement(
                    id = it.getString("id"),
                    kind = it.getString("kind"),
                    label = it.getString("label"),
                    touch = it.getString("touch"),
                    // Always on screen on Android: another platform's own element (the web's skip link) is not.
                    always = it.getString("presence") == "always" &&
                        it.getJSONArray("platforms").let { platforms -> (0 until platforms.length()).any { i -> platforms.getString(i) == "android" } },
                )
            },
            scenarios = json.getJSONArray("scenarios").objects().map { scenario ->
                ContractScenario(
                    name = scenario.getString("name"),
                    withinMs = scenario.getLong("within_ms"),
                    given = scenario.getJSONArray("given").objects().map(::step),
                    whens = scenario.getJSONArray("when").objects().map(::step),
                    thens = scenario.getJSONArray("then").objects().map(::step),
                )
            },
        )

        private fun step(json: JSONObject) = ContractStep(
            verb = json.getString("verb"),
            value = json.text("value"),
            id = json.text("id"),
            text = json.text("text"),
            option = json.text("option"),
            key = json.text("key"),
            args = if (json.has("args")) json.getJSONArray("args").objects().map { it.getString("value") } else emptyList(),
            n = if (json.has("n")) json.getInt("n") else null,
        )
    }
}

data class ContractScreen(val id: String, val elements: List<ContractElement>, val scenarios: List<ContractScenario>)

data class ContractElement(val id: String, val kind: String, val label: String, val touch: String, val always: Boolean)

data class ContractScenario(
    val name: String,
    val withinMs: Long,
    val given: List<ContractStep>,
    val whens: List<ContractStep>,
    val thens: List<ContractStep>,
)

/** One step; `args` are the values only, in the template's placeholder order (`rust-core` tests it). */
data class ContractStep(
    val verb: String,
    val value: String?,
    val id: String?,
    val text: String?,
    val option: String?,
    val key: String?,
    val args: List<String>,
    val n: Int?,
) {
    /** How a failure names the step: the verb and its operands, as the Gherkin quotes them. */
    val title: String get() = listOfNotNull(verb, id, text, option, key, value, n?.toString()).joinToString(" ")
}

/**
 * Resolves a locale key through the app's generated string resources (`res/values{,-ne,-hi}/`,
 * written from `locales/` by `pnpm tokens:sync`), never through copy written here. The resource
 * name is the key in snake case (`eligibility.result.reasonMeets` → `eligibility_result_reason_meets`),
 * as the generator names it; arguments are positional (`%1$s`).
 */
object ContractStrings {
    fun resolve(key: String, args: List<String> = emptyList(), locale: String = "en"): String {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val configuration = Configuration(target.resources.configuration).apply { setLocale(Locale.forLanguageTag(locale)) }
        val localized = target.createConfigurationContext(configuration)
        val name = key.replace(Regex("([a-z0-9])([A-Z])"), "$1_$2").replace('.', '_').lowercase(Locale.ROOT)
        @Suppress("DiscouragedApi") // the key is data from screens.json, so the id is looked up by name
        val id = localized.resources.getIdentifier(name, "string", target.packageName)
        assertNotEquals("\"$key\" has no string resource ($name): run `pnpm tokens:sync`", 0, id)
        return if (args.isEmpty()) localized.getString(id) else localized.getString(id, *args.toTypedArray())
    }
}
