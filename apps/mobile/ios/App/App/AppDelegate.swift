import UIKit
import WebKit

/// Native shell around the Toasty web vault — the web bundle ships in the
/// app and loads locally, so the UI is exactly the website. API calls go to
/// the self-hosted server entered on first launch.
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

class VaultViewController: UIViewController, WKScriptMessageHandler {

    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        let content = WKUserContentController()
        content.add(self, name: "VaultCache")

        let config = WKWebViewConfiguration()
        config.userContentController = content

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)

        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "public") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
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
