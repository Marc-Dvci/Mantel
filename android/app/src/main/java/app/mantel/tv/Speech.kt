package app.mantel.tv

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService

/**
 * Speech recognition on the TV, with no network.
 *
 * Vosk runs the small English model (about 40 MB) against the default input,
 * which on a Fire TV Cube with a USB webcam is the webcam's own microphone, so
 * nothing goes through the voice remote or Alexa. Audio never leaves the
 * device; only a finished sentence is handed to the interface, which decides
 * whether it is a question for Mantel at all.
 *
 * Listening pauses whenever Mantel itself is speaking or playing a recording,
 * so it never hears and answers itself.
 */
class Speech(
    private val context: Context,
    private val onSentence: (String) -> Unit,
    private val onActive: (Boolean) -> Unit,
) : RecognitionListener {
    private var service: SpeechService? = null
    private var model: Model? = null
    private var mode = "questions"
    private var mediaPlaying = false
    var available = false
        private set

    fun start() {
        StorageService.unpack(
            context,
            MODEL_ASSET,
            "model",
            { m ->
                model = m
                try {
                    service = SpeechService(Recognizer(m, SAMPLE_RATE), SAMPLE_RATE).also { it.startListening(this) }
                    available = true
                    applyPause()
                    onActive(true)
                } catch (e: Exception) {
                    Log.w(TAG, "Microphone unavailable: ${e.message}")
                    onActive(false)
                }
            },
            { e ->
                Log.w(TAG, "Speech model missing: ${e.message}. Run tools/android/fetch-model.")
                onActive(false)
            },
        )
    }

    fun setMode(listening: String) {
        mode = listening
        applyPause()
    }

    fun setMediaPlaying(playing: Boolean) {
        mediaPlaying = playing
        applyPause()
    }

    private fun applyPause() {
        service?.setPause(mode == "off" || mediaPlaying)
    }

    override fun onResult(hypothesis: String?) = deliver(hypothesis)

    override fun onFinalResult(hypothesis: String?) = deliver(hypothesis)

    override fun onPartialResult(hypothesis: String?) = Unit

    override fun onError(exception: Exception?) {
        Log.w(TAG, "Recognition error: ${exception?.message}")
    }

    override fun onTimeout() = Unit

    private fun deliver(hypothesis: String?) {
        if (mediaPlaying || mode == "off") return
        val text = parse(hypothesis) ?: return
        onSentence(text)
    }

    /**
     * Recognise a 16 kHz mono 16-bit WAV file with the same model and deliver the
     * sentence as if it had been heard. Used by the debug receiver to test the
     * on-device path on a TV or emulator with no microphone.
     */
    fun recognizeFile(path: String): String? {
        val m = model ?: return null
        val rec = Recognizer(m, SAMPLE_RATE)
        java.io.File(path).inputStream().use { input ->
            input.skip(44) // RIFF header
            val buf = ByteArray(4096)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                rec.acceptWaveForm(buf, n)
            }
        }
        val text = parse(rec.finalResult)
        rec.close()
        return text
    }

    fun stop() {
        service?.stop()
        service?.shutdown()
        service = null
        model?.close()
    }

    companion object {
        private const val TAG = "MantelSpeech"
        private const val SAMPLE_RATE = 16_000f
        const val MODEL_ASSET = "model-en-us"
        const val MODEL = "Vosk small English model on the device"

        /** Vosk answers {"text": "..."}; an empty or one-word result is not a sentence. */
        fun parse(hypothesis: String?): String? {
            if (hypothesis.isNullOrBlank()) return null
            val text = try {
                JSONObject(hypothesis).optString("text").trim()
            } catch (_: Exception) {
                return null
            }
            if (text.isEmpty() || text == "the" || !text.contains(' ')) return null
            return text
        }
    }
}
