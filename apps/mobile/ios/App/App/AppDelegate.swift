import UIKit
import WebKit

/// Native shell around the Toasty web vault — the web bundle ships in the
/// app and is served through a custom URL scheme, so the app UI is exactly
/// the website. ES-module scripts are blocked on file:// URLs (WebKit
/// treats them as cross-origin), which renders a blank page — this is the
/// same approach Capacitor uses to keep bundled web apps working. API calls
/// go to the self-hosted server entered on first launch.
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = VaultViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

/// Serves the bundled web vault under toasty:// so module scripts load.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {

    static let scheme = "toasty"

    private static let mimeTypes: [String: String] = [
        "html": "text/html",
        "js": "text/javascript",
        "mjs": "text/javascript",
        "css": "text/css",
        "json": "application/json",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "woff": "font/woff",
        "woff2": "font/woff2",
        "ttf": "font/ttf",
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        while path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }

        let fileURL = Bundle.main.bundleURL.appendingPathComponent(path)
        guard let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let ext = fileURL.pathExtension.lowercased()
        let mime = Self.mimeTypes[ext] ?? "application/octet-stream"
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": mime]
        ) else {
            urlSchemeTask.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Nothing to cancel; bundle reads complete synchronously.
    }
}

class VaultViewController: UIViewController, WKScriptMessageHandler {

    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        let content = WKUserContentController()
        content.add(self, name: "VaultCache")

        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)

        if let url = URL(string: "toasty://app/public/index.html") {
            webView.load(URLRequest(url: url))
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "save":
            if let items = body["items"] as? String {
                VaultCache.save(items: items)
            }
        case "clear":
            VaultCache.clear()
        default:
            break
        }
    }
}

@main
struct ToastyApp {
    static func main() {
        let delegate = AppDelegate()
        _ = UIApplicationMain(
            CommandLine.argc,
            CommandLine.unsafeArgv,
            nil,
            NSStringFromClass(type(of: delegate))
        )
    }
}
