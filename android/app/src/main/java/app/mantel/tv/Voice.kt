package app.mantel.tv

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * The device's own speech engine, used when a line has neither a family
 * recording nor a household voice from the server. Reports start and end of
 * every line, so listening pauses while the TV talks.
 */
class Voice(context: Context, private val onEvent: (id: String, state: String) -> Unit) {
    private var ready = false
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
            tts.language = Locale.US
            tts.setSpeechRate(0.9f)
        }
    }

    init {
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String) = onEvent(utteranceId, "start")
            override fun onDone(utteranceId: String) = onEvent(utteranceId, "done")
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String) = onEvent(utteranceId, "error")
        })
    }

    val available: Boolean
        get() = ready

    fun speak(text: String, id: String) {
        if (!ready) {
            onEvent(id, "error")
            return
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), id)
    }

    fun stop() {
        if (ready) tts.stop()
    }

    fun shutdown() = tts.shutdown()
}
