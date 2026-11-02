import Foundation
import ScreenCaptureKit
import CoreMedia
import AudioToolbox

// stdout is raw 16 kHz mono PCM16LE; control messages go to stderr only.
func report(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

@available(macOS 13.0, *)
final class AudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var stopping = false
    private let audioQueue = DispatchQueue(label: "meeting.system-audio")

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "SystemAudio", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "No display available for system audio capture"])
        }
        let parentPID = CommandLine.arguments.dropFirst().first.flatMap(Int32.init) ?? getppid()
        let excluded = content.applications.filter {
            $0.processID == parentPID || $0.processID == getpid()
        }
        let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.showsCursor = false
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 16000
        config.channelCount = 1
        let capture = SCStream(filter: filter, configuration: config, delegate: self)
        stream = capture
        // Register audio only. No video frames are forwarded or saved.
        try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
        try await capture.startCapture()
        report("READY")
    }

    func stop() async {
        if stopping { return }
        stopping = true
        try? await stream?.stopCapture()
        exit(0)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        report("ERROR: \(error.localizedDescription)")
        exit(1)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let description = sampleBuffer.formatDescription,
              let format = CMAudioFormatDescriptionGetStreamBasicDescription(description) else { return }
        let asbd = format.pointee
        guard asbd.mSampleRate == 16000, asbd.mChannelsPerFrame == 1,
              asbd.mFormatID == kAudioFormatLinearPCM else {
            report("ERROR: Unsupported system audio format (expected 16 kHz mono PCM)")
            exit(1)
        }
        var buffers = AudioBufferList()
        var retainedBlock: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: &buffers,
            bufferListSize: MemoryLayout<AudioBufferList>.size, blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            blockBufferOut: &retainedBlock)
        guard status == noErr, buffers.mNumberBuffers == 1,
              let samples = buffers.mBuffers.mData else { return }
        // Retain the backing block for the entire PCM conversion/write.
        defer { withExtendedLifetime(retainedBlock) {} }
        let byteCount = Int(buffers.mBuffers.mDataByteSize)
        if asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0 && asbd.mBitsPerChannel == 32 {
            let count = byteCount / MemoryLayout<Float>.size
            let floats = samples.assumingMemoryBound(to: Float.self)
            var pcm = Data(count: count * 2)
            pcm.withUnsafeMutableBytes { bytes in
                let output = bytes.bindMemory(to: Int16.self)
                for i in 0..<count {
                    let value = floats[i].isFinite ? max(-1, min(1, floats[i])) : 0
                    output[i] = Int16(value * (value < 0 ? 32768 : 32767)).littleEndian
                }
            }
            FileHandle.standardOutput.write(pcm)
        } else if asbd.mBitsPerChannel == 16 && asbd.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0 {
            FileHandle.standardOutput.write(Data(bytes: samples, count: byteCount))
        } else {
            report("ERROR: Unsupported PCM sample encoding")
            exit(1)
        }
    }
}

if #available(macOS 13.0, *) {
    let capture = AudioCapture()
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    termination.setEventHandler { Task { await capture.stop() } }
    interrupt.setEventHandler { Task { await capture.stop() } }
    termination.resume()
    interrupt.resume()
    // Closing the parent's stdin pipe also releases capture on parent exit/crash.
    FileHandle.standardInput.readabilityHandler = { input in
        if input.availableData.isEmpty {
            input.readabilityHandler = nil
            Task { await capture.stop() }
        }
    }
    Task {
        do { try await capture.start() }
        catch {
            report("ERROR: \(error.localizedDescription). Grant Screen & System Audio Recording permission, then restart.")
            exit(1)
        }
    }
    dispatchMain()
} else {
    report("ERROR: System audio capture requires macOS 13 or newer")
    exit(1)
}
