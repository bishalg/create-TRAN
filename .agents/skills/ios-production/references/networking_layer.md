# Networking Layer Guide

This guide details the construction of a robust, lightweight, and type-safe `async/await` HTTP networking client using Swift's native `URLSession`. Drawing on architectures from **Bitwarden (`Networking`)** and **IceCubesApp (`Packages/Network`)**, this design eliminates monolithic service classes and heavy third-party dependencies like Alamofire.

---

## 1. Declarative Endpoint Protocol

Instead of having monolithic network manager classes with dozens of functions, endpoints are defined as lightweight, declarative value types:

```swift
import Foundation

public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

public protocol Endpoint: Sendable {
    var baseURL: URL { get }
    var path: String { get }
    var method: HTTPMethod { get }
    var headers: [String: String] { get }
    var queryItems: [URLQueryItem]? { get }
    var body: Data? { get }
}

public extension Endpoint {
    var headers: [String: String] { [:] }
    var queryItems: [URLQueryItem]? { nil }
    var body: Data? { nil }

    func makeURLRequest() throws -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: true)
        if let queryItems, !queryItems.isEmpty {
            components?.queryItems = queryItems
        }
        guard let url = components?.url else {
            throw NetworkError.invalidURL(path)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        return request
    }
}
```

---

## 2. Request Interceptors & Token Refresh

### The "Thundering Herd" Problem

When multiple parallel requests fail with `401 Unauthorized`, an uncoordinated client will fire multiple simultaneous refresh token requests. This invalidates refresh tokens and breaks the user's session.

### The Actor-Based Solution

Use an `actor` to serialize token refresh so only one network call is executed while other requests await the result:

```swift
public protocol AuthenticationProvider: Actor {
    func getValidToken() async throws -> String
    func refreshToken() async throws -> String
}

public actor TokenManager: AuthenticationProvider {
    private var accessToken: String?
    private var isRefreshing = false
    private var refreshTask: Task<String, Error>?

    public init(initialToken: String? = nil) {
        self.accessToken = initialToken
    }

    public func getValidToken() async throws -> String {
        if let token = accessToken {
            return token
        }
        return try await refreshToken()
    }

    public func refreshToken() async throws -> String {
        // If a refresh is already in-flight, await its completion
        if let existingTask = refreshTask {
            return try await existingTask.value
        }

        let task = Task<String, Error> {
            defer { refreshTask = nil }
            // Perform token refresh HTTP request
            let newToken = try await performRefreshTokenCall()
            self.accessToken = newToken
            return newToken
        }

        refreshTask = task
        return try await task.value
    }

    private func performRefreshTokenCall() async throws -> String {
        // Implement actual token exchange call
        return "refreshed_access_token"
    }
}
```

---

## 3. Strongly-Typed Network Errors

Never bubble up untyped `NSError` or raw `URLError` directly to UI layers. Map them into domain-appropriate errors:

```swift
public enum NetworkError: LocalizedError, Sendable {
    case invalidURL(String)
    case badServerResponse(statusCode: Int, data: Data)
    case decodingFailed(Error)
    case unauthorized
    case clientError(URLError)
    case unknown(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL(let path):
            return "Invalid URL constructed for path: \(path)"
        case .badServerResponse(let code, _):
            return "Server responded with status code: \(code)"
        case .decodingFailed(let underlying):
            return "Failed to parse server response: \(underlying.localizedDescription)"
        case .unauthorized:
            return "Session expired. Please log in again."
        case .clientError(let err):
            return err.localizedDescription
        case .unknown(let msg):
            return msg
        }
    }
}
```

---

## 4. Execution Engine

```swift
public protocol NetworkClientProtocol: Sendable {
    func execute<T: Decodable & Sendable>(_ endpoint: Endpoint) async throws -> T
}

public final class NetworkClient: NetworkClientProtocol {
    private let session: URLSession
    private let decoder: JSONDecoder
    private let authProvider: AuthenticationProvider?

    public init(
        session: URLSession = .shared,
        decoder: JSONDecoder = JSONDecoder(),
        authProvider: AuthenticationProvider? = nil
    ) {
        self.session = session
        self.decoder = decoder
        self.authProvider = authProvider
    }

    public func execute<T: Decodable & Sendable>(_ endpoint: Endpoint) async throws -> T {
        var request = try endpoint.makeURLRequest()

        if let authProvider {
            let token = try await authProvider.getValidToken()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch let urlError as URLError {
            throw NetworkError.clientError(urlError)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.unknown("Non-HTTP response received")
        }

        switch httpResponse.statusCode {
        case 200...299:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw NetworkError.decodingFailed(error)
            }
        case 401:
            throw NetworkError.unauthorized
        default:
            throw NetworkError.badServerResponse(statusCode: httpResponse.statusCode, data: data)
        }
    }
}
```

---

## 5. Concrete Endpoint Example

```swift
public struct GetElectionListEndpoint: Endpoint {
    public let baseURL: URL
    public let status: String

    public init(baseURL: URL, status: String = "active") {
        self.baseURL = baseURL
        self.status = status
    }

    public var path: String { "/api/v1/elections" }
    public var method: HTTPMethod { .get }
    public var queryItems: [URLQueryItem]? {
        [URLQueryItem(name: "status", value: status)]
    }
}
```
