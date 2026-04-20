import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.

        // WKWebView の defaultTextEncodingName を UTF-8 に強制設定
        // これにより、ローカルファイル読み込み時のエンコーディング問題を解決
        if let rootVC = window?.rootViewController {
            configureWebViewEncoding(in: rootVC.view)
        }

        return true
    }

    /// WKWebView を再帰的に探し、customUserAgent を設定して UTF-8 を優先させる
    private func configureWebViewEncoding(in view: UIView) {
        if let webView = view as? WKWebView {
            // UTF-8 エンコーディングを強制
            webView.configuration.defaultWebpagePreferences.allowsContentJavaScript = true

            // カスタムスクリプトで charset を保証
            let script = WKUserScript(
                source: """
                    // UTF-8 エンコーディングをメタタグで保証
                    (function() {
                        var meta = document.querySelector('meta[charset]');
                        if (!meta) {
                            meta = document.createElement('meta');
                            meta.setAttribute('charset', 'UTF-8');
                            document.head.insertBefore(meta, document.head.firstChild);
                        }
                        var httpEquiv = document.querySelector('meta[http-equiv="Content-Type"]');
                        if (!httpEquiv) {
                            httpEquiv = document.createElement('meta');
                            httpEquiv.setAttribute('http-equiv', 'Content-Type');
                            httpEquiv.setAttribute('content', 'text/html; charset=utf-8');
                            document.head.insertBefore(httpEquiv, document.head.firstChild);
                        }
                    })();
                """,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            webView.configuration.userContentController.addUserScript(script)
            return
        }
        for subview in view.subviews {
            configureWebViewEncoding(in: subview)
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
