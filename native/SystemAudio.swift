import Foundation
import ScreenCaptureKit
import CoreMedia
import AudioToolbox
import Darwin

// Audio only: no screen output is registered and no files are recorded.
let outputLock = NSLock()
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    FileHandle.standardOutput.write(data + Data([10]))
}
final class AudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    var capture: SCStream?
    let queue = DispatchQueue(label: "hidden.system-audio")
    var reportedFormat = false
    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw NSError(domain: "Hidden", code: 1, userInfo: [NSLocalizedDescriptionKey: "Нет доступного дисплея для аудиозахвата."]) }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48000
        config.channelCount = 2
        config.width = 2; config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        capture = stream
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await stream.startCapture()
        emit(["type": "ready", "backend": "ScreenCaptureKit"])
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        emit(["type": "error", "message": error.localizedDescription]); exit(1)
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .audio, sample.isValid,
              let description = CMSampleBufferGetFormatDescription(sample),
              let format = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee else { return }
        if !reportedFormat {
            reportedFormat = true
            emit(["type": "diagnostic", "message": "Аудиопоток macOS: \(Int(format.mSampleRate)) Гц, \(format.mBitsPerChannel) бит, \(format.mChannelsPerFrame) канала"])
        }
        guard format.mBitsPerChannel == 32, format.mFormatFlags & kAudioFormatFlagIsFloat != 0 else {
            emit(["type": "error", "message": "Неподдерживаемый формат аудиопотока macOS."]); return
        }
        var needed = 0
        var retained: CMBlockBuffer?
        let sizing = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: &needed, bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
        guard sizing == noErr, needed > 0, needed <= 1048576 else { return }
        let storage = UnsafeMutableRawPointer.allocate(byteCount: needed, alignment: 16)
        defer { storage.deallocate() }
        let pointer = storage.bindMemory(to: AudioBufferList.self, capacity: 1)
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: nil, bufferListOut: pointer, bufferListSize: needed, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &retained)
        let buffers = UnsafeMutableAudioBufferListPointer(pointer)
        guard status == noErr, buffers.count > 0 else {
            emit(["type": "error", "message": "Не удалось прочитать аудиобуфер macOS (\(status))."]); return
        }
        let count = CMSampleBufferGetNumSamples(sample)
        guard count > 0, count <= 192000 else { return }
        var mono = [Float](repeating: 0, count: count)
        for buffer in buffers {
            guard let data = buffer.mData else { continue }
            let channels = Int(buffer.mNumberChannels)
            guard channels > 0, Int(buffer.mDataByteSize) >= count * channels * 4 else { continue }
            let values = data.assumingMemoryBound(to: Float.self)
            for frame in 0..<count {
                for channel in 0..<channels { mono[frame] += values[frame * channels + channel] / Float(format.mChannelsPerFrame) }
            }
        }
        let bytes = mono.withUnsafeBytes { Data($0) }
        emit(["type": "pcm", "sampleRate": format.mSampleRate, "data": bytes.base64EncodedString()])
    }
}
let capture = AudioCapture()
let parent = getppid()
let parentWatch = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
    if getppid() != parent { exit(0) }
}
Task {
    do { try await capture.start() }
    catch { emit(["type": "error", "message": error.localizedDescription]); exit(1) }
}
// SIGTERM (parent stop/quit) exits immediately and releases the SCStream.
RunLoop.main.run()
