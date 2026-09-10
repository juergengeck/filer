import Foundation
#if SWIFT_PACKAGE
import OneFilerShared
#endif

/// The process lifecycle owned by a single configured ONE instance.
protocol OwnedRuntime: AnyObject, Sendable {
    var isRunning: Bool { get }
    func invoke(_ request: Data) async throws -> Data
    func shutdown() async
}

extension NodeRuntimeProcess: OwnedRuntime {}

/// Serializes ownership while allowing asynchronous startup, requests, and shutdown.
actor RuntimePool {
    typealias Configuration = [String: LocalDomainConfiguration]
    typealias Factory = (String, LocalDomainConfiguration) async throws -> any OwnedRuntime
    private struct Entry {
        let generation: UUID
        let task: Task<any OwnedRuntime, Error>
    }
    private struct Retirement {
        let generation: UUID
        let task: Task<Void, Never>
    }
    private var closing: [UUID: Retirement] = [:]
    private let configuration: () throws -> Configuration
    private let factory: Factory
    private var entries: [UUID: Entry] = [:]
    private var stopped = false

    init(configuration: @escaping () throws -> Configuration, factory: @escaping Factory) {
        self.configuration = configuration
        self.factory = factory
    }

    func perform(domain: String, request: Data) async throws -> Data {
        guard !stopped else { throw CocoaError(.userCancelled) }
        guard let config = try configuration()[domain] else { throw Self.unregistered() }
        if let retirement = closing[config.storageId] {
            await retirement.task.value
            return try await perform(domain: domain, request: request)
        }
        let entry: Entry
        if let current = entries[config.storageId] {
            entry = current
        } else {
            let factory = self.factory
            entry = Entry(generation: UUID(), task: Task { try await factory(domain, config) })
            entries[config.storageId] = entry
        }
        let child: any OwnedRuntime
        do { child = try await entry.task.value }
        catch {
            if entries[config.storageId]?.generation == entry.generation { entries.removeValue(forKey: config.storageId) }
            throw error
        }
        // Configuration can change while startup is suspended. Never revive a removed owner.
        guard !stopped, entries[config.storageId]?.generation == entry.generation else { throw Self.unregistered() }
        guard try configuration()[domain]?.storageId == config.storageId else {
            await retire(id: config.storageId, entry: entry).value
            throw Self.unregistered()
        }
        guard child.isRunning else {
            await retire(id: config.storageId, entry: entry).value
            throw PrivateSocket.failure("The local ONE runtime stopped. Try the operation again.")
        }
        return try await child.invoke(request)
    }

    /// Called after a configuration filesystem event, including changes made by the signed CLI.
    func reconcile() async throws {
        let active = Set(try configuration().values.map(\.storageId))
        let removed = entries.filter { !active.contains($0.key) }
        let retirements = removed.map { retire(id: $0.key, entry: $0.value) }
        for task in retirements { await task.value }
    }

    func stop() async {
        stopped = true
        let owned = entries
        for (id, entry) in owned { _ = retire(id: id, entry: entry) }
        let retirements = closing.values
        for retirement in retirements { await retirement.task.value }
    }

    /// Keep ownership until shutdown finishes, so a replacement cannot reopen live storage.
    private func retire(id: UUID, entry: Entry) -> Task<Void, Never> {
        if let retirement = closing[id] { return retirement.task }
        entries.removeValue(forKey: id)
        let generation = UUID()
        let task = Task {
            if let child = try? await entry.task.value { await child.shutdown() }
            if self.closing[id]?.generation == generation { self.closing.removeValue(forKey: id) }
        }
        closing[id] = Retirement(generation: generation, task: task)
        return task
    }

    private static func unregistered() -> NSError {
        NSError(domain: "one.filer.runtime", code: 4, userInfo: [NSLocalizedDescriptionKey: "This domain is no longer registered with Filer."])
    }
}
