import AuthenticationServices
import UIKit

/// iOS Password AutoFill (Credential Provider extension): offers cached
/// Toasty logins in apps and Safari. The cache is only populated while the
/// vault is unlocked in the app; otherwise the provider prompts the user to
/// open Toasty and unlock first.
class CredentialProviderViewController: ASCredentialProviderViewController {

    private var serviceIdentifiers: [ASCredentialServiceIdentifier] = []

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        self.serviceIdentifiers = serviceIdentifiers
        let entries = VaultCache.entries()

        let matching = entries.filter { entry in
            serviceIdentifiers.contains { identifier in
                entry.matches(domain: identifier.identifier)
            }
        }

        let list = matching.isEmpty ? entries : matching

        let alert = UIAlertController(
            title: "Toasty",
            message: list.isEmpty
                ? "No cached logins. Open Toasty and unlock your vault first."
                : "Choose a login to fill",
            preferredStyle: .actionSheet
        )
        for entry in list.prefix(8) {
            alert.addAction(
                UIAlertAction(title: "\(entry.name) — \(entry.username)", style: .default) { [weak self] _ in
                    self?.complete(entry: entry)
                }
            )
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.extensionContext.cancelRequest(withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.userCanceled.rawValue
            ))
        })
        present(alert, animated: true)
    }

    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        guard let entry = VaultCache.entries().first(where: { $0.id == credentialIdentity.recordIdentifier }) else {
            extensionContext.cancelRequest(withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.credentialIdentityNotFound.rawValue
            ))
            return
        }
        complete(entry: entry)
    }

    private func complete(entry: VaultCache.Entry) {
        let credential = ASPasswordCredential(user: entry.username, password: entry.password)
        extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
    }
}
