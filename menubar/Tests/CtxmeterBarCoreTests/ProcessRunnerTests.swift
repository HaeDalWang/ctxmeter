import Foundation
import Testing

@testable import CtxmeterBarCore

@Test func aHungCommandIsStoppedAtTheTimeout() throws {
    let started = Date()
    #expect(throws: TelemetryLoader.LoadError.timedOut(seconds: 1)) {
        _ = try ProcessRunner.run(executable: "/bin/sleep", arguments: ["30"], timeout: 1)
    }
    #expect(Date().timeIntervalSince(started) < 10)
}

@Test func heavyStderrDoesNotDeadlockStdout() throws {
    // Each pipe buffers about 64 KB; reading one to the end before the other
    // used to hang once the child filled the second.
    let script = "head -c 400000 /dev/zero | tr '\\\\0' x >&2; echo done"
    let result = try ProcessRunner.run(executable: "/bin/sh", arguments: ["-c", script], timeout: 10)
    #expect(result.status == 0)
    #expect(String(data: result.stdout, encoding: .utf8) == "done\n")
    #expect(result.stderr.count == 400_000)
}

@Test func theExitStatusIsReported() throws {
    let result = try ProcessRunner.run(executable: "/bin/sh", arguments: ["-c", "exit 3"], timeout: 5)
    #expect(result.status == 3)
}
