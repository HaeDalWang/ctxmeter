import Foundation

/// The CLI commands the app runs. Arguments live here so they can be tested
/// without spawning anything.
public enum CtxmeterCommand: Sendable, Equatable {
    case telemetry
    case history
    case details
    case toggle(target: String, enabled: Bool)

    public func arguments(workspace: String) -> [String] {
        let scope = ["--workspace", workspace]
        switch self {
        case .telemetry: return ["telemetry"] + scope
        case .history: return ["history"] + scope
        case .details: return ["details"] + scope
        case .toggle(let target, let enabled):
            return ["fix", enabled ? "--enable" : "--disable", target, "--json"] + scope
        }
    }
}

public enum CLIDecoder {
    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw TelemetryLoader.LoadError.decodeFailed(error.localizedDescription)
        }
    }
}

/// Spawns the bundled Node CLI and returns its stdout. Same process rules as
/// `TelemetryLoader`, shared by every command.
public struct CLIRunner: Sendable {
    private let nodePath: String
    private let scriptPath: String
    private let workspace: String

    public init(nodePath: String, scriptPath: String, workspace: String) {
        self.nodePath = nodePath
        self.scriptPath = scriptPath
        self.workspace = workspace
    }

    public func run<T: Decodable>(_ command: CtxmeterCommand, as type: T.Type) throws -> T {
        try CLIDecoder.decode(type, from: output(command))
    }

    public func output(_ command: CtxmeterCommand) throws -> Data {
        guard FileManager.default.isReadableFile(atPath: scriptPath) else {
            throw TelemetryLoader.LoadError.scriptMissing(scriptPath)
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = [scriptPath] + command.arguments(workspace: workspace)
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
            throw TelemetryLoader.LoadError.processFailed(
                status: process.terminationStatus,
                message: message.replacingOccurrences(of: "ctxmeter error: ", with: "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
        return data
    }
}
