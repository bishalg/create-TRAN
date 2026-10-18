import Foundation

/// HTTP Method representation
public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

/// Declarative API Endpoint definition.
/// Inspired by `IceCubesApp` (`Packages/Network`) and `Bitwarden` (`Networking`).
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

/// Typed network error representation
public enum NetworkError: LocalizedError, Sendable {
    case invalidURL(String)
    case badServerResponse(statusCode: Int, data: Data)
    case decodingFailed(String)
    case unauthorized
    case clientError(String)
    case unknown(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL(let path): "Invalid URL for path: \(path)"
        case .badServerResponse(let code, _): "Server returned HTTP status \(code)"
        case .decodingFailed(let detail): "Failed to decode payload: \(detail)"
        case .unauthorized: "Authentication required or session expired."
        case .clientError(let msg): msg
        case .unknown(let msg): msg
        }
    }
}

/// Actor-based token coordinator to prevent multiple parallel refresh requests (thundering herd)
public actor TokenCoordinator {
    private var cachedToken: String?
    private var inFlightRefreshTask: Task<String, Error>?
    private let refreshHandler: @Sendable () async throws -> String

    public init(
        initialToken: String? = nil,
        refreshHandler: @escaping @Sendable () async throws -> String
    ) {
        self.cachedToken = initialToken
        self.refreshHandler = refreshHandler
    }

    public func validToken() async throws -> String {
        if let token = cachedToken {
            return token
        }
        return try await refreshToken()
    }

    public func refreshToken() async throws -> String {
        if let existing = inFlightRefreshTask {
            return try await existing.value
        }

        let task = Task<String, Error> {
            defer { self.inFlightRefreshTask = nil }
            let newToken = try await self.refreshHandler()
            self.cachedToken = newToken
            return newToken
        }

        self.inFlightRefreshTask = task
        return try await task.value
    }

    public func invalidate() {
        cachedToken = nil
    }
}

/// Clean async/await URLSession Client
public final class EndpointNetworkClient: Sendable {
    private let session: URLSession
    private let decoder: JSONDecoder
    private let tokenCoordinator: TokenCoordinator?

    public init(
        session: URLSession = .shared,
        decoder: JSONDecoder = JSONDecoder(),
        tokenCoordinator: TokenCoordinator? = nil
    ) {
        self.session = session
        self.decoder = decoder
        self.tokenCoordinator = tokenCoordinator
    }

    public func execute<T: Decodable & Sendable>(_ endpoint: Endpoint) async throws -> T {
        var request = try endpoint.makeURLRequest()

        if let tokenCoordinator {
            let token = try await tokenCoordinator.validToken()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch let urlError as URLError {
            throw NetworkError.clientError(urlError.localizedDescription)
        } catch {
            throw NetworkError.unknown(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.unknown("Non-HTTP response received")
        }

        if httpResponse.statusCode == 401, let tokenCoordinator {
            // Attempt a single token refresh and retry
            let newToken = try await tokenCoordinator.refreshToken()
            request.setValue("Bearer \(newToken)", forHTTPHeaderField: "Authorization")
            let (retryData, retryResponse) = try await session.data(for: request)
            guard let retryHttpResponse = retryResponse as? HTTPURLResponse else {
                throw NetworkError.unknown("Non-HTTP response received on retry")
            }
            return try decode(T.self, from: retryData, response: retryHttpResponse)
        }

        return try decode(T.self, from: data, response: httpResponse)
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data, response: HTTPURLResponse) throws -> T {
        switch response.statusCode {
        case 200...299:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw NetworkError.decodingFailed(error.localizedDescription)
            }
        case 401:
            throw NetworkError.unauthorized
        default:
            throw NetworkError.badServerResponse(statusCode: response.statusCode, data: data)
        }
    }
}
