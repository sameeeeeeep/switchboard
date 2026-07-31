// App entry point. Kept in main.swift because the app is now a MULTI-FILE build (RelayMenuBar.swift
// + GodWidgetKit.swift + …), and Swift only allows top-level executable code in a file named main.swift.
import AppKit

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let controller = RelayController()
    app.delegate = controller
    app.run()
}
