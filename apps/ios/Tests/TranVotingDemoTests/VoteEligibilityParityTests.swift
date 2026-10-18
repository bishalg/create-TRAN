import XCTest

final class VoteEligibilityParityTests: XCTestCase {
    private func fixtureData() throws -> Data {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let url = repoRoot.appendingPathComponent("fixtures/vote-eligibility.json")
        return try Data(contentsOf: url)
    }

    func testEvaluationsMatchGoldenFixture() throws {
        let root = try JSONSerialization.jsonObject(with: fixtureData()) as! [String: Any]
        let evaluations = root["evaluations"] as! [[String: Any]]
        for row in evaluations {
            let input = row["input"] as! [String: Any]
            let age = input["age"] as! Int
            let birth = input["birthdate"] as? String
            let country = row["countryCode"] as! String
            let reference = row["referenceDate"] as! String
            let expected = row["expected"] as! [String: Any]

            let result = try evaluateVoteEligibilityOffline(
                age: UInt16(age),
                birthdateIso: birth,
                countryCode: country,
                referenceDateIso: reference
            )

            let name = row["name"] as? String ?? "case"
            XCTAssertEqual(result.eligible, expected["eligible"] as! Bool, name)
            XCTAssertEqual(result.age, UInt16(expected["age"] as! Int), name)
            XCTAssertEqual(result.minimumAge, UInt16(expected["minimumAge"] as! Int), name)
            XCTAssertEqual(result.countryCode, expected["countryCode"] as! String, name)
            XCTAssertEqual(result.reason, expected["reason"] as! String, name)
        }
    }

    func testRejectedEvaluationsMatchGoldenFixture() throws {
        let root = try JSONSerialization.jsonObject(with: fixtureData()) as! [String: Any]
        let rejected = root["rejectedEvaluations"] as! [[String: Any]]
        for row in rejected {
            let input = row["input"] as! [String: Any]
            let age = input["age"] as! Int
            let birth = input["birthdate"] as? String
            let country = row["countryCode"] as! String
            let reference = row["referenceDate"] as! String
            let expectedError = row["error"] as! String

            do {
                _ = try evaluateVoteEligibilityOffline(
                    age: UInt16(age),
                    birthdateIso: birth,
                    countryCode: country,
                    referenceDateIso: reference
                )
                XCTFail("Expected error for \(row["name"] ?? "")")
            } catch let err as TranValidationError {
                if case .ValidationError(let detail) = err {
                    XCTAssertEqual(detail, expectedError, row["name"] as? String ?? "case")
                } else {
                    XCTFail("Unexpected error variant")
                }
            }
        }
    }
}
