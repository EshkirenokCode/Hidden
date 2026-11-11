import Foundation
import Vision

do {
    let image = FileHandle.standardInput.readDataToEndOfFile()
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let supported = try request.supportedRecognitionLanguages()
    request.recognitionLanguages = ["en-US", "ru-RU"].filter { supported.contains($0) }
    try VNImageRequestHandler(data: image).perform([request])

    let lines = (request.results ?? []).compactMap { observation -> (text: String, bounds: CGRect)? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return (candidate.string, observation.boundingBox)
    }.sorted { $0.bounds.midY > $1.bounds.midY }

    // Vision can return the label and the body of a line as separate observations.
    var rows: [[(text: String, bounds: CGRect)]] = []
    for line in lines {
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
    let text = rows.map { row in
        let ordered = row.sorted { $0.bounds.minX < $1.bounds.minX }
        let offset = (ordered[0].bounds.minX - leftEdge) / glyphWidth
        let indent = offset < 1.5 ? 0 : min(32, Int(offset.rounded()))
        return String(repeating: " ", count: indent) + ordered.map { $0.text }.joined(separator: "  ")
    }.joined(separator: "\n")
    FileHandle.standardOutput.write(Data(text.utf8))
} catch {
    exit(1)
}
