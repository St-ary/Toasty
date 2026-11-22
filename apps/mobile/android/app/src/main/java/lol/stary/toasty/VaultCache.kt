package lol.stary.toasty

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypted-at-rest cache of login credentials used by the autofill
 * service. The cache exists only while the vault is unlocked: the web app
 * pushes it after unlock and clears it on lock, so a locked or killed app
 * leaves nothing readable behind.
 *
 * Contents are AES-256-GCM encrypted with a key that lives in the Android
 * Keystore and never leaves secure hardware.
 */
object VaultCache {
    private const val PREFS = "toasty_vault_cache"
    private const val KEY_IV = "iv"
    private const val KEY_DATA = "data"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "toasty_autofill_key"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128

    data class Entry(
        val id: String,
        val name: String,
        val username: String,
        val password: String,
        val urls: List<String>,
    )

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
            return it.secretKey
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun save(context: Context, itemsJson: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ciphertext = cipher.doFinal(itemsJson.toByteArray(Charsets.UTF_8))
        prefs(context).edit()
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(KEY_DATA, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }

    fun load(context: Context): List<Entry> {
        val stored = prefs(context)
        val iv = stored.getString(KEY_IV, null) ?: return emptyList()
        val data = stored.getString(KEY_DATA, null) ?: return emptyList()
        val plaintext = try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                key(),
                GCMParameterSpec(GCM_TAG_BITS, Base64.decode(iv, Base64.NO_WRAP)),
            )
            String(
                cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)),
                Charsets.UTF_8,
            )
        } catch (_: Exception) {
            return emptyList()
        }
        return try {
            val array = JSONArray(plaintext)
            buildList {
                for (i in 0 until array.length()) {
                    val o = array.optJSONObject(i) ?: continue
                    val urls = o.optJSONArray("urls") ?: JSONArray()
                    add(
                        Entry(
                            id = o.optString("id"),
                            name = o.optString("name"),
                            username = o.optString("username"),
                            password = o.optString("password"),
                            urls = buildList {
                                for (j in 0 until urls.length()) {
                                    val u = urls.optString(j)
                                    if (u.isNotBlank()) add(u)
                                }
                            },
                        ),
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun matches(entry: Entry, domain: String?, packageName: String): Boolean {
        if (domain != null) {
            val host = domain.lowercase().removePrefix("www.")
            if (entry.urls.any { url ->
                    val u = url.lowercase().removePrefix("https://").removePrefix("http://")
                        .removePrefix("www.").substringBefore("/").substringBefore(":")
                    u == host || u.endsWith(".$host") || host.endsWith(".$u")
                }
            ) {
                return true
            }
        }
        return entry.urls.any { it.contains(packageName, ignoreCase = true) }
    }
}
