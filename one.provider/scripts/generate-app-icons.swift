#!/usr/bin/env swift
import Foundation

/// Synchronizes the olive artwork used by the app icon, dialogs, and menu bar.
func generateAppIcon() throws {
    let provider = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
    let source = provider.deletingLastPathComponent().appendingPathComponent("olive.svg")
    let svg = try String(contentsOf: source, encoding: .utf8)
    precondition(svg.components(separatedBy: "<path ").count == 2,
                 "Review olive paths before generating appearance variants")
    let darkSvg = svg.replacingOccurrences(of: "<path ", with: "<path fill=\"white\" ")
    let assets = provider.appendingPathComponent("Resources/Assets.xcassets")
    try Data(svg.utf8).write(to: assets.appendingPathComponent("FilerIcon.imageset/olive.svg"))
    try Data(darkSvg.utf8).write(to: assets.appendingPathComponent("FilerIcon.imageset/olive-dark.svg"))
    try Data(svg.utf8).write(to: assets.appendingPathComponent("MenuBarIcon.imageset/olive.svg"))

    // Icon Composer applies layer fills to every shape, including invisible ones.
    // Remove the empty artboard rectangle while preserving the olive geometry.
    let rectangle = try NSRegularExpression(pattern: #"<rect\b[^>]*style="fill:none;"[^>]*/>"#)
    let range = NSRange(svg.startIndex..<svg.endIndex, in: svg)
    precondition(rectangle.numberOfMatches(in: svg, range: range) == 1,
                 "Review olive artboard before generating the app icon")
    let artwork = rectangle.stringByReplacingMatches(in: svg, range: range, withTemplate: "")
    let output = provider.appendingPathComponent("Resources/AppIcon.icon/Assets/olive.svg")
    try Data(artwork.utf8).write(to: output)
    print("Synchronized olive SVG assets; Xcode compiles AppIcon.icon for each appearance")
}

try generateAppIcon()
