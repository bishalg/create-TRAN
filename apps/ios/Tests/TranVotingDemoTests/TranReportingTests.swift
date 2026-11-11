// Verifies: REQ-OBS-011 REQ-ERR-011 REQ-ERR-014
import XCTest

/// REQ-OBS-011: Client failure can be joined to server's logs via trace_id in TranReporting.
final class TranReportingTests: XCTestCase {
    override func tearDown() {
        TranReporting.sink = nil
        super.tearDown()
    }

    func testReportDeliversTraceIdForServerError() {
        var reportedEvent: TranReporting.Event?
        var reportedDetail: String?
        TranReporting.sink = { event, detail in
            reportedEvent = event
            reportedDetail = detail
        }

        let traceId = "4bf92f3577b34da6a3ce929d0e0e4736"
        let failure = TranRequestFailure(
            code: .serverInternal,
            status: 500,
            requestId: "req-123",
            traceId: traceId
        )

        TranReporting.report(failure)

        XCTAssertNotNil(reportedEvent)
        XCTAssertEqual(reportedEvent?.code, "server.internal")
        XCTAssertEqual(reportedEvent?.status, 500)
        XCTAssertEqual(reportedEvent?.requestId, "req-123")
        XCTAssertEqual(reportedEvent?.traceId, traceId)
        XCTAssertNil(reportedDetail)
    }

    func testReportDeliversTraceIdForTransportFailureWhenReported() {
        var reportedEvent: TranReporting.Event?
        var reportedDetail: String?
        TranReporting.sink = { event, detail in
            reportedEvent = event
            reportedDetail = detail
        }

        let traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        // client.unexpected is an error-level failure
        let failure = TranRequestFailure.classify(
            URLError(.badURL),
            traceId: traceId
        )

        TranReporting.report(failure, detail: "bad url encountered")

        XCTAssertNotNil(reportedEvent)
        XCTAssertEqual(reportedEvent?.code, "client.unexpected")
        XCTAssertEqual(reportedEvent?.traceId, traceId)
        XCTAssertEqual(reportedDetail, "bad url encountered")
    }

    func testClassifyPreservesTraceIdWhenNoResponseArrived() {
        let traceId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        let networkError = URLError(.notConnectedToInternet)
        let failure = TranRequestFailure.classify(networkError, traceId: traceId)

        XCTAssertEqual(failure.code, .networkOffline)
        XCTAssertEqual(failure.traceId, traceId)
        XCTAssertNil(failure.status)
    }
}
