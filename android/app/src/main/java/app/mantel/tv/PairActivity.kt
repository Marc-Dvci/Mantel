package app.mantel.tv

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import app.mantel.caremode.CareMode
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Connects this TV to a household. A family member opens Settings in the family
 * app, asks for a code, and types it here with the remote. The code works once,
 * for fifteen minutes, and becomes a token only this TV holds.
 */
class PairActivity : AppCompatActivity() {
    private lateinit var settings: Settings
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = Settings(this)
        val pad = (resources.displayMetrics.density * 24).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(pad * 4, pad * 2, pad * 4, pad)
            setBackgroundColor(Color.parseColor("#1c2735"))
        }
        fun text(s: String, size: Float, bold: Boolean = false) = TextView(this).apply {
            text = s
            textSize = size
            setTextColor(Color.parseColor("#f7f1e6"))
            if (bold) typeface = Typeface.DEFAULT_BOLD
            setPadding(0, pad / 3, 0, pad / 3)
        }
        root.addView(text("Mantel", 34f, bold = true))
        root.addView(text("Connect this TV to your family", 20f))

        val server = EditText(this).apply {
            setText(settings.server)
            hint = "Server address, for example https://mantel.example.org"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#88ffffff"))
        }
        val code = EditText(this).apply {
            hint = "Six-digit code from the family app"
            inputType = InputType.TYPE_CLASS_NUMBER
            textSize = 28f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#88ffffff"))
        }
        status = text(if (settings.paired) "This TV is connected. Enter a new code to move it to another household." else "", 16f)
        val care = CheckBox(this).apply {
            text = "Care mode: open Mantel when the TV starts, and return to it when the TV is left idle elsewhere"
            isChecked = CareMode.isEnabled(this@PairActivity)
            setTextColor(Color.parseColor("#f7f1e6"))
            setOnCheckedChangeListener { _, on -> CareMode.setEnabled(this@PairActivity, on) }
        }
        val connect = Button(this).apply {
            text = "Connect"
            setOnClickListener { pair(server.text.toString().trim(), code.text.toString().trim()) }
        }
        val back = Button(this).apply {
            text = "Back to Mantel"
            isEnabled = settings.paired
            setOnClickListener { openMantel() }
        }
        listOf(server, code, connect, back, care, status).forEach(root::addView)
        setContentView(root)
        code.requestFocus()
    }

    private fun pair(server: String, code: String) {
        if (server.isBlank() || !Regex("^\\d{6}$").matches(code)) {
            status.text = "Enter the server address and the six digits."
            return
        }
        status.text = "Connecting…"
        thread {
            val result = try {
                val conn = URL("${server.trimEnd('/')}/api/tv/pair").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.setRequestProperty("content-type", "application/json")
                conn.outputStream.use { it.write(JSONObject().put("code", code).put("name", settings.deviceName).toString().toByteArray()) }
                val ok = conn.responseCode in 200..299
                val body = (if (ok) conn.inputStream else conn.errorStream).bufferedReader().readText()
                if (ok) Result.success(JSONObject(body).getString("token"))
                else Result.failure(Exception(runCatching { JSONObject(body).getString("error") }.getOrDefault("That code did not work.")))
            } catch (e: Exception) {
                Result.failure(Exception("Could not reach the server: ${e.message}"))
            }
            runOnUiThread {
                result.onSuccess { token ->
                    settings.server = server
                    settings.token = token
                    openMantel()
                }.onFailure { status.text = it.message }
            }
        }
    }

    private fun openMantel() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }
}
