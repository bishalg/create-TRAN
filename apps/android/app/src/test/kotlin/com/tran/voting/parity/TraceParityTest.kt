// Verifies: REQ-OBS-001
package com.tran.voting.parity

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.BeforeClass
import org.junit.Test
import uniffi.tran_uniffi.TranTraceContext
import uniffi.tran_uniffi.childSpanOffline
import uniffi.tran_uniffi.formatTraceparentOffline
import uniffi.tran_uniffi.newTraceOffline
import uniffi.tran_uniffi.parseTraceparentOffline
import java.io.File

/** `fixtures/trace.json` through the UniFFI surface the app uses (spec 023, REQ-OBS-001). */
class TraceParityTest {
    companion object {
        @BeforeClass
        @JvmStatic
        fun loadNativeLibrary() = VoteEligibilityParityTest.loadNativeLibrary()

        private val fixture: JSONObject by lazy {
            val repoRoot = System.getenv("REPO_ROOT") ?: error("REPO_ROOT not set (Gradle test task should provide it)")
            JSONObject(File(repoRoot, "fixtures/trace.json").readText())
        }

        private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map(::getJSONObject)
    }

    @Test
    fun `REQ-OBS-001 parseValid matches the fixture`() {
        for (case in fixture.getJSONArray("parseValid").objects()) {
            val name = case.getString("name")
            val header = case.getString("header")
            val expected = case.getJSONObject("expected")
            val parsed = parseTraceparentOffline(header)
            assertNotNull("case '$name' should parse", parsed)
            assertEquals("traceId in '$name'", expected.getString("traceId"), parsed?.traceId)
            assertEquals("spanId in '$name'", expected.getString("spanId"), parsed?.spanId)
            assertEquals("sampled in '$name'", expected.getBoolean("sampled"), parsed?.sampled)
        }
    }

    @Test
    fun `REQ-OBS-001 parseInvalid matches the fixture`() {
        for (case in fixture.getJSONArray("parseInvalid").objects()) {
            val name = case.getString("name")
            val header = case.getString("header")
            val parsed = parseTraceparentOffline(header)
            assertNull("case '$name' should be rejected: $header", parsed)
        }
    }

    @Test
    fun `REQ-OBS-001 formatCases match the fixture`() {
        for (case in fixture.getJSONArray("formatCases").objects()) {
            val ctxObj = case.getJSONObject("context")
            val ctx = TranTraceContext(
                traceId = ctxObj.getString("traceId"),
                spanId = ctxObj.getString("spanId"),
                sampled = ctxObj.getBoolean("sampled")
            )
            val expectedHeader = case.getString("expectedHeader")
            assertEquals(expectedHeader, formatTraceparentOffline(ctx))
        }
    }

    @Test
    fun `REQ-OBS-001 newTraceCases match the fixture`() {
        for (case in fixture.getJSONArray("newTraceCases").objects()) {
            val name = case.getString("name")
            val bytesJson = case.getJSONArray("randomBytes")
            val bytes = ByteArray(bytesJson.length()) { i -> bytesJson.getInt(i).toByte() }
            val sampled = case.getBoolean("sampled")
            val res = newTraceOffline(bytes, sampled)
            if (case.isNull("expected")) {
                assertNull("case '$name' should return null", res)
            } else {
                val expected = case.getJSONObject("expected")
                assertNotNull("case '$name' should succeed", res)
                assertEquals("traceId in '$name'", expected.getString("traceId"), res?.traceId)
                assertEquals("spanId in '$name'", expected.getString("spanId"), res?.spanId)
                assertEquals("sampled in '$name'", expected.getBoolean("sampled"), res?.sampled)
                assertEquals("header in '$name'", case.getString("expectedHeader"), res?.let { formatTraceparentOffline(it) })
            }
        }
    }

    @Test
    fun `REQ-OBS-001 childSpanCases match the fixture`() {
        for (case in fixture.getJSONArray("childSpanCases").objects()) {
            val name = case.getString("name")
            val parentTraceId = case.getString("parentTraceId")
            val bytesJson = case.getJSONArray("randomBytes")
            val bytes = ByteArray(bytesJson.length()) { i -> bytesJson.getInt(i).toByte() }
            val sampled = case.getBoolean("sampled")
            val res = childSpanOffline(parentTraceId, bytes, sampled)
            if (case.isNull("expected")) {
                assertNull("case '$name' should return null", res)
            } else {
                val expected = case.getJSONObject("expected")
                assertNotNull("case '$name' should succeed", res)
                assertEquals("traceId in '$name'", expected.getString("traceId"), res?.traceId)
                assertEquals("spanId in '$name'", expected.getString("spanId"), res?.spanId)
                assertEquals("sampled in '$name'", expected.getBoolean("sampled"), res?.sampled)
                assertEquals("header in '$name'", case.getString("expectedHeader"), res?.let { formatTraceparentOffline(it) })
            }
        }
    }
}
