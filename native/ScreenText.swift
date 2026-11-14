import CoreGraphics
import Foundation
import ImageIO
import Vision

typealias Line = (text: String, bounds: CGRect)

func recognize(_ data: Data) throws -> [Line] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let supported = try request.supportedRecognitionLanguages()
    request.recognitionLanguages = ["en-US", "ru-RU"].filter { supported.contains($0) }
    try VNImageRequestHandler(data: data).perform([request])
    return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return (candidate.string, observation.boundingBox)
    }
}

struct Column {
    var left: CGFloat
    var right: CGFloat
    var count: Int
}

func contentColumn(in lines: [Line]) -> Column? {
    let gutter: CGFloat = 0.035
    var columns: [Column] = []
    let body = lines.filter { (0.05...0.95).contains($0.bounds.midY) }
    for line in body.sorted(by: { $0.bounds.minX < $1.bounds.minX }) {
        let bounds = line.bounds
        if let last = columns.indices.last, bounds.minX <= columns[last].right + gutter {
            columns[last].right = max(columns[last].right, bounds.maxX)
            columns[last].count += 1
        } else {
            columns.append(Column(left: bounds.minX, right: bounds.maxX, count: 1))
        }
    }
    // Only crop when a broad center column is separated from narrow side panels.
    // Keep all content in ambiguous layouts, including two broad columns.
    guard columns.count > 1, let main = columns.firstIndex(where: {
        $0.left < 0.5 && $0.right > 0.5 && $0.right - $0.left >= 0.3 && $0.count >= 6
    }), columns.indices.filter({ $0 != main }).allSatisfy({
        columns[$0].right - columns[$0].left <= 0.24
    }) else { return nil }
    return columns[main]
}

func grayscaleForOCR(_ image: CGImage) -> CGImage {
    guard let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: CGImageAlphaInfo.none.rawValue),
          let bytes = context.data?.assumingMemoryBound(to: UInt8.self) else { return image }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    let stride = context.bytesPerRow
    var darkSamples = 0
    var samples = 0
    for y in Swift.stride(from: 0, to: image.height, by: 32) {
        for x in Swift.stride(from: 0, to: image.width, by: 32) {
            darkSamples += bytes[y * stride + x] < 96 ? 1 : 0
            samples += 1
        }
    }
    guard darkSamples * 2 > samples else { return image }
    for y in 0..<image.height {
        for x in 0..<image.width {
            let index = y * stride + x
            bytes[index] = 255 - bytes[index]
        }
    }
    return context.makeImage() ?? image
}

// Materialize the cropped pixels before handing them to Vision.
func pngData(for image: CGImage) -> Data? {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil)
        else { return nil }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return data as Data
}

func focusedLines(in image: CGImage, lines: [Line]) -> [Line] {
    guard let column = contentColumn(in: lines) else { return lines }
    let left = max(0, column.left - 0.012)
    let right = min(1, column.right + 0.012)
    let area = CGRect(x: left * CGFloat(image.width), y: 0,
                      width: (right - left) * CGFloat(image.width), height: CGFloat(image.height)).integral
    let center = lines.filter { $0.bounds.midX >= column.left && $0.bounds.midX <= column.right }
    guard let crop = image.cropping(to: area),
          let pixels = pngData(for: grayscaleForOCR(crop)),
          let rescanned = try? recognize(pixels),
          rescanned.count >= center.count * 2 / 3 else { return center }
    return rescanned
}

func format(_ lines: [Line]) -> String {
    var rows: [[Line]] = []
    for line in lines.sorted(by: { $0.bounds.midY > $1.bounds.midY }) {
        if let previous = rows.last?.first,
           abs(previous.bounds.midY - line.bounds.midY) < min(previous.bounds.height, line.bounds.height) * 0.55 {
            rows[rows.count - 1].append(line)
        } else {
            rows.append([line])
        }
    }
    let leftEdge = lines.map { $0.bounds.minX }.min() ?? 0
    let glyphWidths = lines.filter { $0.text.count >= 8 }
        .map { $0.bounds.width / CGFloat($0.text.count) }.sorted()
    let glyphWidth = glyphWidths.isEmpty ? 0.01 : max(0.001, glyphWidths[glyphWidths.count / 2])
    return rows.map { row in
        let ordered = row.sorted { $0.bounds.minX < $1.bounds.minX }
        let offset = (ordered[0].bounds.minX - leftEdge) / glyphWidth
        let indent = offset < 1.5 ? 0 : min(32, Int(offset.rounded()))
        return String(repeating: " ", count: indent) + ordered.map { $0.text }.joined(separator: "  ")
    }.joined(separator: "\n")
}

do {
    let png = FileHandle.standardInput.readDataToEndOfFile()
    guard let source = CGImageSourceCreateWithData(png as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { exit(1) }
    let lines = try recognize(png)
    let text = format(CommandLine.arguments.contains("--whole-image") ? lines : focusedLines(in: image, lines: lines))
    FileHandle.standardOutput.write(Data(text.utf8))
} catch {
    exit(1)
}
