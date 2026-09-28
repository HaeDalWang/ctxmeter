import Foundation

/// A release tag such as `v0.2.0`, compared number by number.
public struct ReleaseVersion: Comparable, Sendable {
    public let parts: [Int]

    public init?(_ text: String) {
        let trimmed = text.hasPrefix("v") ? String(text.dropFirst()) : text
        let fields = trimmed.split(separator: ".", omittingEmptySubsequences: false)
        let numbers = fields.compactMap { Int($0) }
        guard !fields.isEmpty, numbers.count == fields.count, numbers.allSatisfy({ $0 >= 0 }) else { return nil }
        parts = numbers
    }

    /// `1.0` and `1.0.0` are the same release.
    private static func padded(_ a: [Int], _ b: [Int]) -> ([Int], [Int]) {
        let width = max(a.count, b.count)
        return (a + Array(repeating: 0, count: width - a.count), b + Array(repeating: 0, count: width - b.count))
    }

    public static func == (lhs: Self, rhs: Self) -> Bool {
        let (a, b) = padded(lhs.parts, rhs.parts)
        return a == b
    }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        let (a, b) = padded(lhs.parts, rhs.parts)
        return a.lexicographicallyPrecedes(b)
    }

    public var text: String { parts.map(String.init).joined(separator: ".") }
}

public struct AvailableUpdate: Equatable, Sendable {
    public let version: String
    public let url: URL
}

/// "A newer release exists" — no download, no install. The app only reads the
/// latest GitHub release and links to it.
public enum UpdateCheck {
    public static let latestReleaseAPI = URL(string: "https://api.github.com/repos/HaeDalWang/ctxmeter/releases/latest")!
    public static let releasesPage = URL(string: "https://github.com/HaeDalWang/ctxmeter/releases")!
    public static let upgradeCommand = "git pull && ./scripts/ctxmeter-bar.sh install"
    public static let interval: TimeInterval = 24 * 60 * 60

    private struct Release: Decodable {
        let tag_name: String
        let html_url: String?
        let draft: Bool?
        let prerelease: Bool?
    }

    /// Nil when there is nothing newer. Throws only when the payload is not a release.
    public static func available(current: String, releaseJSON: Data) throws -> AvailableUpdate? {
        let release = try JSONDecoder().decode(Release.self, from: releaseJSON)
        if release.draft == true || release.prerelease == true { return nil }
        guard let latest = ReleaseVersion(release.tag_name),
              let installed = ReleaseVersion(current),
              latest > installed else { return nil }
        return AvailableUpdate(version: latest.text, url: trustedLink(release.html_url))
    }

    /// The response is untrusted: only a link into this repository is opened.
    private static func trustedLink(_ text: String?) -> URL {
        guard let text, let url = URL(string: text), url.scheme == "https", url.host == "github.com",
              url.path.hasPrefix("/HaeDalWang/ctxmeter/") else { return releasesPage }
        return url
    }

    /// Due once `interval` has passed, or when the stored time is in the future
    /// (a clock moved backwards must not suppress checks forever).
    public static func isDue(lastChecked: Date?, now: Date) -> Bool {
        guard let lastChecked else { return true }
        let elapsed = now.timeIntervalSince(lastChecked)
        return elapsed < 0 || elapsed >= interval
    }
}
