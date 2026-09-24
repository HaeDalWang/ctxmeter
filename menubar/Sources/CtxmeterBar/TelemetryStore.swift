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

        guard let nodePath = NodeLocator.resolve(override: nodePathOverride) else {
            errorMessage = TelemetryLoader.LoadError.nodeNotFound.localizedDescription
            return
        }
        let loader = TelemetryLoader(nodePath: nodePath, scriptPath: scriptPath, workspace: workspace)
        do {
            let loaded = try await Task.detached { try loader.load() }.value
            report = loaded
            errorMessage = nil
            lastRefreshedAt = Date()
        } catch {
            errorMessage = error.localizedDescription
        }
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
