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

/// Packages black/light and white/dark olives into one native appearance-aware icon.
/// The dark ICNS element contains the nested icon elements without their file header,
/// as used by macOS CoreTypes' GenericFolderIcon.icns since Mojave.
func generateAppIcon() throws {
    let provider = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
    let source = provider.deletingLastPathComponent().appendingPathComponent("olive.svg")
    let svg = try String(contentsOf: source, encoding: .utf8)
    precondition(svg.components(separatedBy: "<path ").count == 2,
                 "Review olive paths before generating appearance variants")
    let darkSvg = svg.replacingOccurrences(of: "<path ", with: "<path fill=\"white\" ")
    let assets = provider.appendingPathComponent("Resources/Assets.xcassets")
    // Finder resolves CFBundleIconName through this appearance-aware image set.
    // Supply actual colors because its path bar does not reliably tint templates.
    try Data(svg.utf8).write(to: assets.appendingPathComponent("FilerIcon.imageset/olive.svg"))
    try Data(darkSvg.utf8).write(to: assets.appendingPathComponent("FilerIcon.imageset/olive-dark.svg"))
    try Data(svg.utf8).write(to: assets.appendingPathComponent("MenuBarIcon.imageset/olive.svg"))
    let temporary = FileManager.default.temporaryDirectory
        .appendingPathComponent("filer-icons-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporary) }
    let light = try createIconFile(svg: svg, directory: temporary, name: "light")
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
    let output = provider.appendingPathComponent("Resources/Olive.icns")
    try icon.write(to: output)
    print("Generated \(output.path) with light and dark renditions")
}

try generateAppIcon()
