// A standalone Foundation client. It imports no Switchboard code and is not part of its app bundle.
// Run through proof/run-local.mjs, which supplies an isolated daemon and synthetic consent surface.
import Foundation

struct SmokeError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

final class NativeClient {
    let socket: URLSessionWebSocketTask
    init(url: URL) {
        socket = URLSession.shared.webSocketTask(with: url)
        socket.resume()
    }
    func send(_ object: [String: Any]) async throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        try await socket.send(.data(data))
    }
    func receive() async throws -> [String: Any] {
        let message = try await socket.receive()
        let data: Data
        switch message {
        case .data(let value): data = value
        case .string(let value): data = Data(value.utf8)
        @unknown default: throw SmokeError("Unknown socket message")
        }
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw SmokeError("Invalid response") }
        return result
    }
    func request(_ method: String, _ params: [String: Any] = [:]) async throws -> Any {
        let id = UUID().uuidString
        // Deliberately false caller identity: the server must use the token's principal instead.
        try await send(["type": "request", "id": id, "method": method, "params": params,
                        "origin": "https://another-app.invalid", "appId": "another.app"])
        while true {
            let response = try await receive()
            if response["id"] as? String != id { continue }
            if let error = response["error"] as? [String: Any] { throw SmokeError(error["message"] as? String ?? "Request failed") }
            return response["result"] ?? NSNull()
        }
    }
    func object(_ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
        guard let result = try await request(method, params) as? [String: Any] else { throw SmokeError("Expected an object for \(method)") }
        return result
    }
}

func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw SmokeError(message) }
}
func report(_ message: String) {
    FileHandle.standardOutput.write(Data((message + "\n").utf8))
}

@main struct VoicepadSmoke {
    static func main() async {
        do { try await run() }
        catch { FileHandle.standardError.write(Data(("FAIL \(error)\n").utf8)); exit(1) }
    }
    static func run() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let url = URL(string: env["SWITCHBOARD_TEST_NATIVE_URL"] ?? ""),
              let model = env["SWITCHBOARD_TEST_MODEL"], let tokenFile = env["SWITCHBOARD_TEST_TOKEN_FILE"],
              let contextFile = env["SWITCHBOARD_TEST_CONTEXT_FILE"] else { throw SmokeError("Use proof/run-local.mjs") }
        let appId = "dev.switchboard.standalone-voice-test"
        let client = NativeClient(url: url)
        defer { client.socket.cancel(with: .normalClosure, reason: nil) }
        try await client.send(["type": "requestConnect", "appId": appId, "name": "Standalone Voicepad test",
                               "reason": "Test local AI and voice using synthetic data"])
        var registration = try await client.receive()
        while registration["type"] as? String == "event" { registration = try await client.receive() }
        guard let token = registration["token"] as? String, registration["type"] as? String == "registered" else { throw SmokeError("Native consent did not register this app") }
        let tokenData = Data(token.utf8)
        try tokenData.write(to: URL(fileURLWithPath: tokenFile), options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tokenFile)
        let grant = try await client.object("claude_permissions")
        try require(grant["origin"] as? String == "native@\(appId)", "Native app identity was not derived from its token")
        let caps = try await client.object("claude_capabilities")
        let methods = caps["methods"] as? [String] ?? []
        try require(methods.contains("claude_storage") && methods.contains("claude_context") && methods.contains("claude_session"), "Native methods missing")
        try require(!methods.contains("claude_stream"), "Native discovery advertises unsupported streaming")
        let local = caps["local"] as? [String: Any] ?? [:]
        try require(local["tts"] as? Bool == true && local["stt"] as? Bool == true, "Local voice not advertised")
        report("PASS standalone Swift client registers through consent and discovers its native capabilities")

        _ = try await client.object("claude_storage", ["op": "set", "key": "private-note", "value": "NATIVE_ONLY_527"])
        let stored = try await client.object("claude_storage", ["op": "get", "key": "private-note"])
        try require(stored["value"] as? String == "NATIVE_ONLY_527", "Private storage round trip failed")
        let context = try await client.object("claude_context", ["op": "publish", "context": ["name": "Synthetic voice project", "kind": "note", "data": ["marker": "SHARED_WITH_CONSENT_824"]]])
        guard let contextId = context["id"] as? String else { throw SmokeError("Context publish failed") }
        try JSONSerialization.data(withJSONObject: ["id": contextId]).write(to: URL(fileURLWithPath: contextFile), options: .atomic)
        report("PASS native app stores private data and publishes its own context")

        let text = try await client.object("claude_complete", ["model": model, "prompt": "The launch moves to Friday. Write one short sentence confirming the new day.", "maxTokens": 64])
        try require(text["model"] as? String == model, "Expected local model \(model), got \(text["model"] ?? "none")")
        // This checks routing and generated output, not exact-token instruction following by a 1B model.
        let generated = (text["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let usage = text["usage"] as? [String: Any] ?? [:]
        try require(!generated.isEmpty && (usage["outputTokens"] as? Int ?? 0) > 0, "Local model returned no generated text or usage")
        report("PASS standalone native app completes through the real local Ollama model")

        let spoken = try await client.object("claude_speak", ["text": "The launch moves to Friday. The product photos are ready.", "voice": "Samantha"])
        guard let audio = spoken["audio"] as? String, audio.hasPrefix("data:audio/wav;base64,") else { throw SmokeError("Local speech returned no audio") }
        try require(spoken["backend"] as? String == "macos-say", "Expected the stock on-device voice")
        let transcript = try await client.object("claude_transcribe", ["audio": audio, "language": "en"])
        try require((transcript["text"] as? String ?? "").lowercased().contains("friday"), "Whisper did not transcribe the synthetic speech")
        try require(transcript["backend"] as? String == "whisper-cli", "Expected local Whisper")
        report("PASS native speech synthesis and Whisper transcription run entirely on-device")

        report("READY_FOR_MODEL_CHANGE")
        while true {
            let event = try await client.receive()
            if event["event"] as? String == "capabilitiesChanged" { break }
        }
        let updated = try await client.object("claude_capabilities")
        try require(!(updated["models"] as? [String] ?? []).contains(model), "Native app did not observe the disabled model")
        report("PASS native app receives live model-change notifications")
    }
}
