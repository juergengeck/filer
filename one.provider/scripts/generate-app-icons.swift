#!/usr/bin/env swift
import AppKit

/// Appends an unsigned big-endian length/type field used by the ICNS format.
func appendUInt32(_ value: UInt32, to data: inout Data) {
    var bigEndian = value.bigEndian
    withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
}

/// Rasterizes the unchanged olive at every conventional macOS icon resolution.
func createIconFile(svg: String, directory: URL, name: String) throws -> Data {
    guard let image = NSImage(data: Data(svg.utf8)) else {
        fatalError("Cannot render olive.svg")
    }
    let iconset = directory.appendingPathComponent("\(name).iconset")
    try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
    for size in [16, 32, 128, 256, 512] {
        for scale in [1, 2] {
            let pixels = size * scale
            guard let bitmap = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
            ) else { fatalError("Cannot allocate icon bitmap") }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
            image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
            NSGraphicsContext.restoreGraphicsState()
            guard let png = bitmap.representation(using: .png, properties: [:]) else {
                fatalError("Cannot encode icon PNG")
            }
            let suffix = scale == 2 ? "@2x" : ""
            try png.write(to: iconset.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
        }
    }
    let output = directory.appendingPathComponent("\(name).icns")
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
    process.arguments = ["-c", "icns", iconset.path, "-o", output.path]
    try process.run()
    process.waitUntilExit()
    precondition(process.terminationStatus == 0, "iconutil failed")
    return try Data(contentsOf: output)
}

/// Creates the transparent File Provider root icon, including the native dark rendition.
/// IconServices selects the nested dark elements for the current system appearance.
func generateProviderIcon(lightSvg: String, darkSvg: String, output: URL) throws {
    let temporary = FileManager.default.temporaryDirectory
        .appendingPathComponent("filer-icons-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporary) }
    let light = try createIconFile(svg: lightSvg, directory: temporary, name: "light")
    let dark = try createIconFile(
        svg: darkSvg,
        directory: temporary, name: "dark")
    var elements = Data(light.dropFirst(8))
    // Native dark-appearance variant: https://github.com/relikd/icns-analysis#other-types
    appendUInt32(0xFDD92FA8, to: &elements)
    appendUInt32(UInt32(dark.count), to: &elements)
    elements.append(dark.dropFirst(8))
    var icon = Data("icns".utf8)
    appendUInt32(UInt32(elements.count + 8), to: &icon)
    icon.append(elements)
    try icon.write(to: output)
}

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
    try generateProviderIcon(
        lightSvg: svg, darkSvg: darkSvg,
        output: provider.appendingPathComponent("Resources/ProviderIcon.icns"))
    print("Generated provider ICNS and synchronized olive SVG assets")
}

try generateAppIcon()
