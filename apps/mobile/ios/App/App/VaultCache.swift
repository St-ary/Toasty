import Foundation
import Security

/// Shared credential cache between the app and the autofill extension.
/// Backed by an App Group keychain item; encrypted with a key protected by
/// the device passcode/biometrics (kSecAttrAccessibleWhenPasscodeSet).
/// The cache is populated only while the vault is unlocked.
enum VaultCache {

    private static let service = "lol.stary.toasty.vaultcache"
    private static let account = "autofill"

    static func save(items: String) {
        guard let data = items.data(using: .utf8) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func entries() -> [Entry] {
        guard let raw = load(), let data = raw.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return array.compactMap { item in
            guard let id = item["id"] as? String,
                  let name = item["name"] as? String else { return nil }
            return Entry(
                id: id,
                name: name,
                username: item["username"] as? String ?? "",
                password: item["password"] as? String ?? "",
                urls: item["urls"] as? [String] ?? []
            )
        }
    }

    struct Entry {
        let id: String
        let name: String
        let username: String
        let password: String
        let urls: [String]

        func matches(domain: String) -> Bool {
            let hosts = Entry.hostCandidates(from: domain)
            return urls.contains { url in
                let bare = Entry.bareHost(of: url)
                return hosts.contains { host in
                    bare == host || bare.hasSuffix(".\(host)") || host.hasSuffix(".\(bare)")
                }
            }
        }

        static func bareHost(of raw: String) -> String {
            let cleaned = raw.lowercased()
                .replacingOccurrences(of: "https://", with: "")
                .replacingOccurrences(of: "http://", with: "")
                .replacingOccurrences(of: "www.", with: "")
            let hostPart = cleaned.split(separator: "/").first.map(String.init) ?? cleaned
            return hostPart.split(separator: ":").first.map(String.init) ?? hostPart
        }

        /// Host forms to try for a service identifier: the host itself plus a
        /// reverse-DNS guess (com.discord -> discord.com) so native app bundle
        /// IDs match saved URLs.
        static func hostCandidates(from domain: String) -> [String] {
            let bare = bareHost(of: domain)
            let reversed = bare.split(separator: ".").reversed().joined(separator: ".")
            return bare == reversed ? [bare] : [bare, reversed]
        }
    }
}
