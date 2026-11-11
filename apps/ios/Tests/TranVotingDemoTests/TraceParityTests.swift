// Verifies: REQ-OBS-001
import XCTest

/// W3C Trace Context parity with `fixtures/trace.json` through UniFFI (spec 023, REQ-OBS-001).
final class TraceParityTests: XCTestCase {
    private func fixtureData() throws -> [String: Any] {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let url = repoRoot.appendingPathComponent("fixtures/trace.json")
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testParseValidMatchesFixture() throws {
        let root = try fixtureData()
        let cases = try XCTUnwrap(root["parseValid"] as? [[String: Any]])
        for testCase in cases {
            let name = try XCTUnwrap(testCase["name"] as? String)
            let header = try XCTUnwrap(testCase["header"] as? String)
            let expected = try XCTUnwrap(testCase["expected"] as? [String: Any])
            let expectedTraceId = try XCTUnwrap(expected["traceId"] as? String)
            let expectedSpanId = try XCTUnwrap(expected["spanId"] as? String)
            let expectedSampled = try XCTUnwrap(expected["sampled"] as? Bool)

            let parsed = parseTraceparentOffline(header: header)
            XCTAssertNotNil(parsed, "case '\(name)' should parse")
            if let ctx = parsed {
                XCTAssertEqual(ctx.traceId, expectedTraceId, "traceId mismatch in '\(name)'")
                XCTAssertEqual(ctx.spanId, expectedSpanId, "spanId mismatch in '\(name)'")
                XCTAssertEqual(ctx.sampled, expectedSampled, "sampled mismatch in '\(name)'")
            }
        }
    }

    func testParseInvalidMatchesFixture() throws {
        let root = try fixtureData()
        let cases = try XCTUnwrap(root["parseInvalid"] as? [[String: Any]])
        for testCase in cases {
            let name = try XCTUnwrap(testCase["name"] as? String)
            let header = try XCTUnwrap(testCase["header"] as? String)
            let parsed = parseTraceparentOffline(header: header)
            XCTAssertNil(parsed, "case '\(name)' should be rejected: \(header)")
        }
    }

    func testFormatCasesMatchFixture() throws {
        let root = try fixtureData()
        let cases = try XCTUnwrap(root["formatCases"] as? [[String: Any]])
        for testCase in cases {
            let contextDict = try XCTUnwrap(testCase["context"] as? [String: Any])
            let traceId = try XCTUnwrap(contextDict["traceId"] as? String)
            let spanId = try XCTUnwrap(contextDict["spanId"] as? String)
            let sampled = try XCTUnwrap(contextDict["sampled"] as? Bool)
            let expectedHeader = try XCTUnwrap(testCase["expectedHeader"] as? String)

            let ctx = TranTraceContext(traceId: traceId, spanId: spanId, sampled: sampled)
            XCTAssertEqual(formatTraceparentOffline(context: ctx), expectedHeader)
        }
    }

    func testNewTraceCasesMatchFixture() throws {
        let root = try fixtureData()
        let cases = try XCTUnwrap(root["newTraceCases"] as? [[String: Any]])
        for testCase in cases {
            let name = try XCTUnwrap(testCase["name"] as? String)
            let randomInts = try XCTUnwrap(testCase["randomBytes"] as? [Int])
            let randomBytes = randomInts.map { UInt8($0) }
            let sampled = try XCTUnwrap(testCase["sampled"] as? Bool)

            let res = newTraceOffline(randomBytes: Data(randomBytes), sampled: sampled)
            if let expected = testCase["expected"] as? [String: Any],
               let expectedHeader = testCase["expectedHeader"] as? String {
                let expectedTraceId = try XCTUnwrap(expected["traceId"] as? String)
                let expectedSpanId = try XCTUnwrap(expected["spanId"] as? String)
                let expectedSampled = try XCTUnwrap(expected["sampled"] as? Bool)

                XCTAssertNotNil(res, "case '\(name)' should succeed")
                if let ctx = res {
                    XCTAssertEqual(ctx.traceId, expectedTraceId, "traceId mismatch in '\(name)'")
                    XCTAssertEqual(ctx.spanId, expectedSpanId, "spanId mismatch in '\(name)'")
                    XCTAssertEqual(ctx.sampled, expectedSampled, "sampled mismatch in '\(name)'")
                    XCTAssertEqual(formatTraceparentOffline(context: ctx), expectedHeader, "header mismatch in '\(name)'")
                }
            } else {
                XCTAssertNil(res, "case '\(name)' should return nil")
            }
        }
    }

    func testChildSpanCasesMatchFixture() throws {
        let root = try fixtureData()
        let cases = try XCTUnwrap(root["childSpanCases"] as? [[String: Any]])
        for testCase in cases {
            let name = try XCTUnwrap(testCase["name"] as? String)
            let parentTraceId = try XCTUnwrap(testCase["parentTraceId"] as? String)
            let randomInts = try XCTUnwrap(testCase["randomBytes"] as? [Int])
            let randomBytes = randomInts.map { UInt8($0) }
            let sampled = try XCTUnwrap(testCase["sampled"] as? Bool)

            let res = childSpanOffline(traceId: parentTraceId, randomBytes: Data(randomBytes), sampled: sampled)
            if let expected = testCase["expected"] as? [String: Any],
               let expectedHeader = testCase["expectedHeader"] as? String {
                let expectedTraceId = try XCTUnwrap(expected["traceId"] as? String)
                let expectedSpanId = try XCTUnwrap(expected["spanId"] as? String)
                let expectedSampled = try XCTUnwrap(expected["sampled"] as? Bool)

                XCTAssertNotNil(res, "case '\(name)' should succeed")
                if let ctx = res {
                    XCTAssertEqual(ctx.traceId, expectedTraceId, "traceId mismatch in '\(name)'")
                    XCTAssertEqual(ctx.spanId, expectedSpanId, "spanId mismatch in '\(name)'")
                    XCTAssertEqual(ctx.sampled, expectedSampled, "sampled mismatch in '\(name)'")
                    XCTAssertEqual(formatTraceparentOffline(context: ctx), expectedHeader, "header mismatch in '\(name)'")
                }
            } else {
                XCTAssertNil(res, "case '\(name)' should return nil")
            }
        }
    }
}
