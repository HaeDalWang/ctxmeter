import CtxmeterBarCore
import Foundation
import Observation

@Observable
@MainActor
final class TelemetryStore {
    private(set) var report: TelemetryReport?
    private(set) var errorMessage: String?
    private(set) var isRefreshing = false
    private(set) var lastRefreshedAt: Date?

    // History reads every recent session log, so it refreshes less often than
    // telemetry. Details runs a full scan and loads only when asked.
    private(set) var history: HistoryReport?
    private(set) var details: DetailsReport?
    private(set) var detailsError: String?
    private(set) var isLoadingDetails = false
    private(set) var togglingTarget: String?
    private(set) var lastToggle: ToggleResult?
    /// Harnesses whose config changed since the app last saw them restart.
    private(set) var restartNeeded: Set<Harness> = []
    private var historyLoadedAt: Date?
    private static let historyMinimumAge: TimeInterval = 60

    var refreshSeconds: Double {
        didSet {
            guard refreshSeconds != oldValue else { return }
            defaults.set(refreshSeconds, forKey: AppSettings.refreshKey)
            restartTimer()
        }
    }

    var workspace: String {
        didSet {
            guard workspace != oldValue else { return }
            defaults.set(workspace, forKey: AppSettings.workspaceKey)
            history = nil
            details = nil
            historyLoadedAt = nil
            Task { await refresh() }
        }
    }

    var nodePathOverride: String {
        didSet {
            guard nodePathOverride != oldValue else { return }
            defaults.set(nodePathOverride, forKey: AppSettings.nodePathKey)
            Task { await refresh() }
        }
    }

    /// Also decides what the menu bar shows, so there is only one selector.
    var selectedTab: PopoverTab {
        didSet {
            guard selectedTab != oldValue else { return }
            defaults.set(selectedTab.storageKey, forKey: AppSettings.selectedTabKey)
        }
    }

    var menuBarText: String { Format.menuBarText(report, tab: selectedTab) }

    /// Whose icon the menu bar shows. `nil` means no harness has a percentage,
    /// so the generic overview icon is used.
    var menuBarFocus: Harness? { Format.menuBarFocus(report, tab: selectedTab) }

    /// The full three-harness summary, shown on hover rather than in the bar.
    var summaryLabel: String { Format.menuBarLabel(report) }

    var tooltip: String { Format.menuBarTooltip(report) }

    /// The bundled copy of the Node CLI, staged by `make bundle`.
    var scriptPath: String {
        Bundle.main.resourceURL?.appendingPathComponent("ctxmeter/src/cli.js").path ?? ""
    }

    private let defaults: UserDefaults
    private var timerTask: Task<Void, Never>?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let storedRefresh = defaults.object(forKey: AppSettings.refreshKey) as? Double
        refreshSeconds = AppSettings.clampRefresh(storedRefresh ?? AppSettings.defaultRefreshSeconds)
        workspace = defaults.string(forKey: AppSettings.workspaceKey)
            ?? (Bundle.main.object(forInfoDictionaryKey: "AGLDefaultWorkspace") as? String)
            ?? FileManager.default.homeDirectoryForCurrentUser.path
        nodePathOverride = defaults.string(forKey: AppSettings.nodePathKey) ?? ""
        selectedTab = PopoverTab(storageKey: defaults.string(forKey: AppSettings.selectedTabKey))
    }

    func start() {
        Task { await refresh() }
        restartTimer()
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        guard let runner = makeRunner() else {
            errorMessage = TelemetryLoader.LoadError.nodeNotFound.localizedDescription
            return
        }
        do {
            let loaded = try await Task.detached { try runner.run(.telemetry, as: TelemetryReport.self) }.value
            report = loaded
            errorMessage = nil
            lastRefreshedAt = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
        await refreshHistoryIfStale()
    }

    /// History is best effort: a failure leaves the last chart in place rather
    /// than replacing the popover with an error.
    func refreshHistoryIfStale(force: Bool = false) async {
        if !force, let loaded = historyLoadedAt, Date().timeIntervalSince(loaded) < Self.historyMinimumAge { return }
        guard let runner = makeRunner() else { return }
        historyLoadedAt = Date()
        if let loaded = try? await Task.detached(operation: { try runner.run(.history, as: HistoryReport.self) }).value {
            history = loaded
        }
    }

    func loadDetails() async {
        guard !isLoadingDetails, let runner = makeRunner() else { return }
        isLoadingDetails = true
        defer { isLoadingDetails = false }
        do {
            details = try await Task.detached { try runner.run(.details, as: DetailsReport.self) }.value
            detailsError = nil
        } catch {
            detailsError = error.localizedDescription
        }
    }

    /// Called only after the user confirmed the prompt. The CLI does the write,
    /// the backup, and the refusal cases; the app just reports what happened.
    func toggle(_ item: DetailItem, harness: Harness) async {
        guard let ref = item.switch, !ref.isManual, togglingTarget == nil, let runner = makeRunner() else { return }
        togglingTarget = ref.target
        defer { togglingTarget = nil }
        let command = CtxmeterCommand.toggle(target: ref.target, enabled: !ref.enabled)
        do {
            lastToggle = try await Task.detached { try runner.run(command, as: ToggleResult.self) }.value
            restartNeeded.insert(harness)
            detailsError = nil
        } catch {
            detailsError = error.localizedDescription
        }
        await loadDetails()
    }

    func acknowledgeRestart(_ harness: Harness) {
        restartNeeded.remove(harness)
    }

    private func makeRunner() -> CLIRunner? {
        guard let nodePath = NodeLocator.resolve(override: nodePathOverride) else { return nil }
        return CLIRunner(nodePath: nodePath, scriptPath: scriptPath, workspace: workspace)
    }

    private func restartTimer() {
        timerTask?.cancel()
        let interval = AppSettings.clampRefresh(refreshSeconds)
        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(interval))
                if Task.isCancelled { return }
                await self?.refresh()
            }
        }
    }
}
