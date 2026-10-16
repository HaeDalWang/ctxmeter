import Foundation

/// Runs `ctxmeter telemetry` and decodes its JSON.
///
/// The scanner logic deliberately stays in Node: it is already covered by the
/// JavaScript test suite, and duplicating it in Swift would create two sources
/// of truth. This type only spawns and parses.
public struct TelemetryLoader: Sendable {
    public enum LoadError: Error, LocalizedError, Equatable {
        case nodeNotFound
        case scriptMissing(String)
        case processFailed(status: Int32, message: String)
        case decodeFailed(String)
        case timedOut(seconds: Int)

        public var errorDescription: String? {
            switch self {
            case .nodeNotFound:
                "Could not find the node executable. Set its path in Settings."
            case .scriptMissing(let path):
                "ctxmeter CLI is missing: \(path)"
            case .processFailed(let status, let message):
                "telemetry failed (exit \(status)): \(message)"
            case .decodeFailed(let message):
                "Could not decode the telemetry response: \(message)"
            case .timedOut(let seconds):
                "ctxmeter did not finish within \(seconds)s and was stopped."
            }
        }
    }

    private let nodePath: String
    private let scriptPath: String
    private let workspace: String

    public init(nodePath: String, scriptPath: String, workspace: String) {
        self.nodePath = nodePath
        self.scriptPath = scriptPath
        self.workspace = workspace
    }

    public static func decode(_ data: Data) throws -> TelemetryReport {
        do {
            return try JSONDecoder().decode(TelemetryReport.self, from: data)
        } catch {
            throw LoadError.decodeFailed(error.localizedDescription)
        }
    }

    public func load() throws -> TelemetryReport {
        guard FileManager.default.isReadableFile(atPath: scriptPath) else {
            throw LoadError.scriptMissing(scriptPath)
        }
        let result = try ProcessRunner.run(
            executable: nodePath, arguments: [scriptPath, "telemetry", "--workspace", workspace]
        )
        guard result.status == 0 else {
            let message = String(data: result.stderr, encoding: .utf8) ?? ""
            throw LoadError.processFailed(
                status: result.status,
                message: message.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
        return try Self.decode(result.stdout)
    }
}
