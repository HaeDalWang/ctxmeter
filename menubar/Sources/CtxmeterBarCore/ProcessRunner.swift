import Foundation

/// Runs a command to completion with a deadline.
///
/// Both pipes are drained on their own threads: reading one to the end first
/// deadlocks once the child fills the other's buffer. A command that outlives
/// the deadline is terminated, then killed, so a stuck CLI can never freeze the
/// refresh loop that waits on it.
public enum ProcessRunner {
    public struct Result: Sendable {
        public let status: Int32
        public let stdout: Data
        public let stderr: Data
    }

    /// Long enough for `details` on a large home; short enough that the menu bar recovers.
    public static let defaultTimeout: TimeInterval = 60
    private static let killGrace: TimeInterval = 2

    private final class Buffer: @unchecked Sendable {
        private let lock = NSLock()
        private var data = Data()
        func set(_ value: Data) { lock.lock(); data = value; lock.unlock() }
        func get() -> Data { lock.lock(); defer { lock.unlock() }; return data }
    }

    public static func run(executable: String, arguments: [String], timeout: TimeInterval = defaultTimeout) throws -> Result {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors

        let exited = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in exited.signal() }
        try process.run()

        let drained = DispatchGroup()
        let stdout = Buffer()
        let stderr = Buffer()
        for (pipe, buffer) in [(output, stdout), (errors, stderr)] {
            drained.enter()
            DispatchQueue.global(qos: .utility).async {
                buffer.set(pipe.fileHandleForReading.readDataToEndOfFile())
                drained.leave()
            }
        }

        if exited.wait(timeout: .now() + timeout) == .timedOut {
            process.terminate()
            if exited.wait(timeout: .now() + killGrace) == .timedOut {
                kill(process.processIdentifier, SIGKILL)
                _ = exited.wait(timeout: .now() + killGrace)
            }
            // A grandchild may still hold the pipes open; do not wait on them.
            _ = drained.wait(timeout: .now() + killGrace)
            throw TelemetryLoader.LoadError.timedOut(seconds: Int(timeout.rounded()))
        }
        drained.wait()
        return Result(status: process.terminationStatus, stdout: stdout.get(), stderr: stderr.get())
    }
}
