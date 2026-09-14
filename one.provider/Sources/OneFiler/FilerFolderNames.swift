import Foundation

/// Localize mounted folders at the native boundary, preserving RPC paths and item IDs.
enum FilerFolderNames {
    private static let names: [String: [String: String]] = [
        "/Files": ["en": "Files", "de": "Dateien"],
        "/Fotos": ["en": "Photos", "de": "Fotos"],
        "/Gesundheit": ["en": "Health", "de": "Gesundheit"],
        "/Gesundheit/Flexibel": ["en": "Flexibel", "de": "Flexibel"],
        "/contacts": ["en": "Contacts", "de": "Kontakte"],
        "/chats": ["en": "Chats", "de": "Chats"],
        "/questionnaires": ["en": "Questionnaires", "de": "Fragebögen"],
        "/ONE": ["en": "ONE", "de": "ONE"],
        "/ONE/System/settings": ["en": "Settings", "de": "Einstellungen"],
        "/ONE/invites": ["en": "Invitations", "de": "Einladungen"],
        "/ONE/System": ["en": "System", "de": "System"],
        "/ONE/System/journal": ["en": "Journal", "de": "Journal"],
        "/ONE/System/debug": ["en": "Debug", "de": "Diagnose"],
        "/ONE/System/objects": ["en": "Objects", "de": "Objekte"],
        "/ONE/System/types": ["en": "Types", "de": "Typen"],
        "/ONE/System/models": ["en": "Models", "de": "Modelle"]
    ]

    /// Use the user's first supported language, including regional language variants.
    static func language(for preferences: [String]) -> String {
        Bundle.preferredLocalizations(from: ["en", "de"], forPreferences: preferences).first ?? "en"
    }

    /// Match complete owned mount paths so user-created folders keep their names.
    static func name(for path: String, language: String) -> String? {
        names[path]?[language]
    }
}
