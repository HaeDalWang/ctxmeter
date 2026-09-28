import Foundation
import Testing

@testable import CtxmeterBarCore

private func release(_ tag: String, url: String = "https://github.com/HaeDalWang/ctxmeter/releases/tag/v9") -> Data {
    Data("""
    { "tag_name": "\(tag)", "html_url": "\(url)", "draft": false, "prerelease": false, "body": "ignored" }
    """.utf8)
}

@Test func parsesVersionsWithOrWithoutALeadingV() {
    #expect(ReleaseVersion("v0.1.0") == ReleaseVersion("0.1.0"))
    #expect(ReleaseVersion("v1.2.3")?.parts == [1, 2, 3])
}

@Test func rejectsTagsThatAreNotVersions() {
    #expect(ReleaseVersion("latest") == nil)
    #expect(ReleaseVersion("") == nil)
    #expect(ReleaseVersion("v1..2") == nil)
}

@Test func comparesNumericallyNotAsText() {
    #expect(ReleaseVersion("0.10.0")! > ReleaseVersion("0.9.0")!)
    #expect(ReleaseVersion("1.0")! == ReleaseVersion("1.0.0")!)
}

@Test func reportsAnUpdateOnlyWhenTheReleaseIsNewer() throws {
    let newer = try UpdateCheck.available(current: "0.1.0", releaseJSON: release("v0.2.0"))
    #expect(newer?.version == "0.2.0")
    #expect(newer?.url.absoluteString == "https://github.com/HaeDalWang/ctxmeter/releases/tag/v9")
    #expect(try UpdateCheck.available(current: "0.1.0", releaseJSON: release("v0.1.0")) == nil)
    #expect(try UpdateCheck.available(current: "0.2.0", releaseJSON: release("v0.1.0")) == nil)
}

@Test func ignoresAReleaseLinkOutsideThisRepository() throws {
    // The response is untrusted; the button must never open an arbitrary URL.
    let hostile = release("v9.0.0", url: "https://evil.example/ctxmeter")
    let update = try UpdateCheck.available(current: "0.1.0", releaseJSON: hostile)
    #expect(update?.url == UpdateCheck.releasesPage)
}

@Test func skipsDraftsAndPrereleases() throws {
    let draft = Data(#"{ "tag_name": "v9.0.0", "html_url": "x", "draft": true, "prerelease": false }"#.utf8)
    let pre = Data(#"{ "tag_name": "v9.0.0", "html_url": "x", "draft": false, "prerelease": true }"#.utf8)
    #expect(try UpdateCheck.available(current: "0.1.0", releaseJSON: draft) == nil)
    #expect(try UpdateCheck.available(current: "0.1.0", releaseJSON: pre) == nil)
}

@Test func treatsAnUnparseableTagAsNoUpdate() throws {
    #expect(try UpdateCheck.available(current: "0.1.0", releaseJSON: release("nightly")) == nil)
}

@Test func throwsOnAMalformedResponse() {
    #expect(throws: (any Error).self) {
        try UpdateCheck.available(current: "0.1.0", releaseJSON: Data("not json".utf8))
    }
}

@Test func checksAtMostOncePerInterval() {
    let now = Date(timeIntervalSince1970: 1_000_000)
    #expect(UpdateCheck.isDue(lastChecked: nil, now: now))
    #expect(!UpdateCheck.isDue(lastChecked: now.addingTimeInterval(-3600), now: now))
    #expect(UpdateCheck.isDue(lastChecked: now.addingTimeInterval(-UpdateCheck.interval - 1), now: now))
    // A clock that moved backwards must not suppress checks forever.
    #expect(UpdateCheck.isDue(lastChecked: now.addingTimeInterval(86_400 * 30), now: now))
}

@Test func upgradeCommandIsTheDocumentedOne() {
    #expect(UpdateCheck.upgradeCommand == "git pull && ./scripts/ctxmeter-bar.sh install")
}
