import Foundation

/// A bounded run-state notification, distinct from File Provider invalidations.
struct FilerQAProgress: Decodable, Sendable {
    struct Step: Decodable, Sendable {
        let number: Int
        let title: String
    }
    let status: String
    let currentStep: Step?
    let runId: String?
    let error: String?
    let waitingForResume: Bool?
    let collectionPath: String?

    static func decode(_ value: Any) throws -> FilerQAProgress {
        let data = try JSONSerialization.data(withJSONObject: value)
        guard data.count <= 16384 else { throw CocoaError(.coderReadCorrupt) }
        let progress = try JSONDecoder().decode(FilerQAProgress.self, from: data)
        guard ["idle", "running", "passed", "failed", "cancelled"].contains(progress.status),
              progress.currentStep.map({ $0.number >= 0 && !$0.title.isEmpty && $0.title.count <= 512 }) ?? true,
              progress.runId.map({ !$0.isEmpty && $0.count <= 256 }) ?? true else {
            throw CocoaError(.coderReadCorrupt)
        }
        return progress
    }
}

extension Notification.Name {
    static let filerQAProgress = Notification.Name("OneFilerQAProgress")
}
