package lol.stary.toasty.autofill

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import lol.stary.toasty.R
import lol.stary.toasty.VaultCache

/**
 * Android Autofill Framework integration: offers cached Toasty logins in
 * apps and browsers. Matching is by web domain (browsers) or by URL
 * fragments (apps). The cache is only populated while the vault is
 * unlocked, so an empty cache simply produces no suggestions.
 */
class ToastyAutofillService : AutofillService() {

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback,
    ) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure === null) {
            callback.onSuccess(null)
            return
        }

        val fields = collectFields(structure)
        if (fields.usernameId === null || fields.passwordId === null) {
            callback.onSuccess(null)
            return
        }

        val entries = VaultCache.load(this)
        val matches = entries.filter { VaultCache.matches(it, fields.domain, packageName = fields.packageName) }
        if (matches.isEmpty()) {
            callback.onSuccess(null)
            return
        }

        val response = FillResponse.Builder()
        for (entry in matches.take(5)) {
            val presentation = RemoteViews(packageName, R.layout.autofill_item).apply {
                setTextViewText(R.id.autofill_name, entry.name)
                setTextViewText(R.id.autofill_username, entry.username)
            }
            val dataset = Dataset.Builder(presentation)
                .setValue(fields.usernameId, AutofillValue.forText(entry.username))
                .setValue(fields.passwordId, AutofillValue.forText(entry.password))
                .build()
            response.addDataset(dataset)
        }
        callback.onSuccess(response.build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        // Toasty saves through the vault UI; nothing to capture here.
        callback.onSuccess()
    }

    private data class Fields(
        val usernameId: AutofillId?,
        val passwordId: AutofillId?,
        val domain: String?,
        val packageName: String,
    )

    private fun collectFields(structure: AssistStructure): Fields {
        var usernameId: AutofillId? = null
        var passwordId: AutofillId? = null
        var domain: String? = null
        val packageName = structure.activityComponent?.packageName ?: packageName

        fun walk(node: AssistStructure.ViewNode) {
            if (domain === null && node.webDomain != null) domain = node.webDomain
            val id = node.autofillId
            if (id !== null) {
                val hints = node.autofillHints ?: emptyArray()
                val isPassword = hints.any { it.contains("password", ignoreCase = true) } ||
                    (node.inputType and android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD != 0) ||
                    (node.inputType and android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD != 0)
                val isUser = hints.any {
                    it.contains("username", ignoreCase = true) || it.contains("email", ignoreCase = true)
                } || (node.inputType and android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS != 0)
                if (isPassword && passwordId === null) passwordId = id
                if (isUser && usernameId === null) usernameId = id
            }
            for (i in 0 until node.childCount) walk(node.getChildAt(i))
        }
        for (i in 0 until structure.windowNodeCount) {
            walk(structure.getWindowNodeAt(i).rootViewNode)
        }
        return Fields(usernameId, passwordId, domain, packageName)
    }
}
