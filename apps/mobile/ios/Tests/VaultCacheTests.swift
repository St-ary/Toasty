import XCTest

/// Unit tests for the credential-cache matching logic used by the autofill
/// extension. VaultCache.swift is compiled directly into this test bundle,
/// so these run on the simulator with no host app.
final class VaultCacheTests: XCTestCase {

    private func entry(name: String, urls: [String]) -> VaultCache.Entry {
        VaultCache.Entry(id: "id-\(name)", name: name, username: "user", password: "pw", urls: urls)
    }

    func testMatchesExactDomain() {
        let e = entry(name: "Example", urls: ["https://example.com"])
        XCTAssertTrue(e.matches(domain: "example.com"))
    }

    func testMatchesSubdomain() {
        let e = entry(name: "Example", urls: ["https://login.example.com"])
        XCTAssertTrue(e.matches(domain: "example.com"))
        XCTAssertTrue(e.matches(domain: "login.example.com"))
    }

    func testMatchesWwwPrefix() {
        let e = entry(name: "Example", urls: ["https://www.example.com"])
        XCTAssertTrue(e.matches(domain: "example.com"))
    }

    func testMatchesUrlWithPath() {
        let e = entry(name: "Example", urls: ["https://example.com/login?next=1"])
        XCTAssertTrue(e.matches(domain: "example.com"))
    }

    func testDoesNotMatchDifferentDomain() {
        let e = entry(name: "Example", urls: ["https://example.com"])
        XCTAssertFalse(e.matches(domain: "example.org"))
        XCTAssertFalse(e.matches(domain: "notexample.com"))
    }

    func testMatchesAnyOfSeveralUrls() {
        let e = entry(name: "Multi", urls: ["https://a.example.com", "https://b.other.com"])
        XCTAssertTrue(e.matches(domain: "other.com"))
    }
}
