import AppKit

/// Brings a window opened from the menu bar to the front.
///
/// The app sets `LSUIElement`, so it is an accessory that is never the active
/// application. `openWindow` and `openSettings` create their window, but macOS
/// orders it behind whatever the user was working in, which reads as the button
/// doing nothing at all. Activating after the scene has been created is what puts
/// it in front.
///
/// The activation is deferred to the next runloop pass: at the moment the button
/// fires, the window does not exist yet, and activating before it does leaves it
/// behind again.
enum ForegroundWindow {
    static func present(_ open: () -> Void) {
        open()
        DispatchQueue.main.async {
            NSApplication.shared.activate()
        }
    }
}
