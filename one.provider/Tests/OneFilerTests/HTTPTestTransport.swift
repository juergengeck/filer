import Foundation

/// External domain fixtures only; the shipped bridge has no HTTP transport.
func httpFixtureTransport(endpoint: URL, token: String) -> (Data) async throws -> Data {
    return { bytes in
        let envelope = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        let operation = envelope["operation"] as! String
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0",
            "method": String(operation.dropFirst("filer:".count)), "params": envelope["request"]!, "id": 1])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.userAuthenticationRequired) }
        return try JSONSerialization.data(withJSONObject: ["success": true,
            "requestId": envelope["requestId"]!, "result": JSONSerialization.jsonObject(with: data)])
    }
}
