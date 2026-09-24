import Foundation

/// Runs `agentlens telemetry` and decodes its JSON.
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

        public var errorDescription: String? {
            switch self {
            case .nodeNotFound:
                "node 실행 파일을 찾지 못했습니다. 설정에서 경로를 지정하세요."
            case .scriptMissing(let path):
                "agentlens CLI가 없습니다: \(path)"
            case .processFailed(let status, let message):
                "telemetry 실행 실패 (exit \(status)): \(message)"
            case .decodeFailed(let message):
                "telemetry 응답을 해석하지 못했습니다: \(message)"
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
        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [scriptPath, "telemetry", "--workspace", workspace]
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors

        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let errorData = errors.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            let message = String(data: errorData, encoding: .utf8) ?? ""
            throw LoadError.processFailed(
                status: process.terminationStatus,
                message: message.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
        return try Self.decode(data)
    }
}
