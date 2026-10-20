// Verifies: REQ-NAT-001 REQ-FFI-002
import XCTest

final class VoteEligibilityParityTests: XCTestCase {
    private func reasonCode(_ reason: TranEligibilityReason) -> String {
        switch reason {
        case .meetsMinimumAge: return "meets_minimum_age"
        case .belowMinimumAge: return "below_minimum_age"
        }
    }

    private func errorCode(_ error: TranValidationError) -> String {
        switch error {
        case .AgeOutOfRange: return "age_out_of_range"
        case .BirthdateInFuture: return "birthdate_in_future"
        case .InvalidBirthdate: return "invalid_birthdate"
        case .InvalidReferenceDate: return "invalid_reference_date"
        case .InvalidCountryCode: return "invalid_country_code"
        }
    }

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
            XCTAssertEqual(reasonCode(result.reason), expected["reasonCode"] as! String, name)
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
            let expectedCode = row["code"] as! String

            do {
                _ = try evaluateVoteEligibilityOffline(
                    age: UInt16(age),
                    birthdateIso: birth,
                    countryCode: country,
                    referenceDateIso: reference
                )
                XCTFail("Expected error for \(row["name"] ?? "")")
            } catch let err as TranValidationError {
                XCTAssertEqual(errorCode(err), expectedCode, row["name"] as? String ?? "case")
            } catch {
                XCTFail("Unexpected error type: \(error)")
            }
        }
    }
}
