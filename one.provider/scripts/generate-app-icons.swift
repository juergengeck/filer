#!/usr/bin/env swift
import AppKit

/// Regenerates the full-color Finder/app icons from the canonical olive vector.
/// Unlike menu/sidebar templates, these icons need their own contrast on both
/// light and dark surfaces. Keep the canvas and olive cutout transparent.
func generateAppIcons() throws {
    let script = URL(fileURLWithPath: #filePath)
    let provider = script.deletingLastPathComponent().deletingLastPathComponent()
    let source = provider.deletingLastPathComponent().appendingPathComponent("olive.svg")
    let catalog = provider.appendingPathComponent("Resources/Assets.xcassets/AppIcon.appiconset")
    let svg = try String(contentsOf: source, encoding: .utf8)
    precondition(svg.contains("viewBox=\"0 0 500 500\""), "Review olive viewport before regenerating icons")
    // A narrow white edge separates the black olive from dark Finder chrome.
    // Expand the viewport so the stroke is not clipped at the canvas edges.
    let outlined = svg
        .replacingOccurrences(of: "viewBox=\"0 0 500 500\"", with: "viewBox=\"-12 -12 524 524\"")
        .replacingOccurrences(of: "<path ", with: "<path stroke=\"white\" stroke-width=\"16\" ")
    guard let image = NSImage(data: Data(outlined.utf8)) else {
        fatalError("Cannot render olive.svg")
    }
    let manifest = try JSONDecoder().decode(IconManifest.self, from: Data(contentsOf: catalog.appendingPathComponent("Contents.json")))
    for entry in manifest.images {
        let points = Int(entry.size.components(separatedBy: "x")[0])!
        let scale = Int(entry.scale.dropLast())!
        let pixels = points * scale
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ) else { fatalError("Cannot allocate icon bitmap") }
        bitmap.size = NSSize(width: pixels, height: pixels)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
        NSGraphicsContext.restoreGraphicsState()
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            fatalError("Cannot encode icon PNG")
        }
        try png.write(to: catalog.appendingPathComponent(entry.filename))
        print("Generated \(entry.filename) (\(pixels)×\(pixels), RGBA)")
    }
}

struct IconManifest: Decodable {
    let images: [Entry]
    struct Entry: Decodable {
        let filename: String
        let size: String
        let scale: String
    }
}

try generateAppIcons()
