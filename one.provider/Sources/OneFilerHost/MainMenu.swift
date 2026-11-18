import Cocoa

/// Hidden main menu for the LSUIElement menu-bar host.
///
/// The host has no visible menu bar, so without an Edit menu AppKit has nothing
/// to route standard key equivalents through: Cmd+C/V/X/A/Z never reach the
/// field editor and pasting into a modal dialog (pairing invitation, domain
/// registration) silently fails while typing works. This menu is never shown,
/// it only gives those shortcuts a responder-chain target.
enum MainMenu {
    static func make() -> NSMenu {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "Quit OneFiler", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        let entries: [(String, Selector, String)] = [
            ("Undo", Selector("undo:"), "z"),
            ("Redo", Selector("redo:"), "Z"),
            ("Cut", #selector(NSText.cut(_:)), "x"),
            ("Copy", #selector(NSText.copy(_:)), "c"),
            ("Paste", #selector(NSText.paste(_:)), "v"),
            ("Delete", #selector(NSText.delete(_:)), ""),
            ("Select All", #selector(NSText.selectAll(_:)), "a"),
        ]
        for (index, entry) in entries.enumerated() {
            if index == 2 || index == 6 { editMenu.addItem(NSMenuItem.separator()) }
            // Nil target routes the action through the responder chain to the field editor.
            let item = NSMenuItem(title: entry.0, action: entry.1, keyEquivalent: entry.2)
            editMenu.addItem(item)
        }
        editItem.submenu = editMenu

        return mainMenu
    }

    static func install() {
        NSApp.mainMenu = make()
    }
}
