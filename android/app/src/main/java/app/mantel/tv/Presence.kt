package app.mantel.tv

import android.content.Context
import android.graphics.Bitmap
import android.media.FaceDetector
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executors

/**
 * Presence from the TV's webcam, on the device.
 *
 * A Fire TV Cube takes a USB (UVC) webcam. CameraX opens whichever camera the
 * device has, frames are analysed at two per second at 320 pixels wide, and
 * each frame is only ever turned into a count of faces. No frame is stored,
 * written, or sent anywhere.
 */
class Presence(
    private val context: Context,
    private val owner: LifecycleOwner,
    private val onChange: (present: Boolean) -> Unit,
    private val onCamera: (active: Boolean) -> Unit,
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val tracker = PresenceTracker()
    private var lastFrameAt = 0L
    var available = false
        private set

    fun start() {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                val provider = future.get()
                val infos = provider.availableCameraInfos
                if (infos.isEmpty()) {
                    Log.i(TAG, "No camera attached; presence comes from the remote only")
                    onCamera(false)
                    return@addListener
                }
                // Any camera will do: on a Fire TV Cube it is the USB webcam, which is
                // neither "front" nor "back".
                val selector = CameraSelector.Builder().addCameraFilter { listOf(it.first()) }.build()
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor, ::analyse)
                provider.unbindAll()
                provider.bindToLifecycle(owner, selector, analysis)
                available = true
                onCamera(true)
            } catch (e: Exception) {
                Log.w(TAG, "Camera unavailable: ${e.message}")
                onCamera(false)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun analyse(image: ImageProxy) {
        try {
            val now = SystemClock.elapsedRealtime()
            if (now - lastFrameAt < FRAME_INTERVAL_MS) return
            lastFrameAt = now
            val faces = countFaces(image)
            tracker.onFrame(now, faces)?.let { present -> ContextCompat.getMainExecutor(context).execute { onChange(present) } }
        } catch (e: Exception) {
            Log.w(TAG, "Frame skipped: ${e.message}")
        } finally {
            image.close()
        }
    }

    /**
     * The luma plane, downscaled to 320 pixels wide, as an RGB_565 bitmap, which
     * is what android.media.FaceDetector reads. Grey is enough to find a face.
     */
    private fun countFaces(image: ImageProxy): Int {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        val step = maxOf(1, image.width / TARGET_WIDTH)
        val w = (image.width / step) and 1.inv() // FaceDetector needs an even width
        val h = image.height / step
        val pixels = IntArray(w * h)
        for (y in 0 until h) {
            val row = y * step * rowStride
            for (x in 0 until w) {
                val v = buffer.get(row + x * step * pixelStride).toInt() and 0xff
                pixels[y * w + x] = (0xff shl 24) or (v shl 16) or (v shl 8) or v
            }
        }
        val bitmap = Bitmap.createBitmap(pixels, w, h, Bitmap.Config.RGB_565)
        val found = arrayOfNulls<FaceDetector.Face>(MAX_FACES)
        val n = FaceDetector(w, h, MAX_FACES).findFaces(bitmap, found)
        bitmap.recycle()
        return found.take(n).count { it != null && it.confidence() >= MIN_CONFIDENCE }
    }

    fun stop() {
        try {
            ProcessCameraProvider.getInstance(context).get().unbindAll()
        } catch (_: Exception) {
        }
        executor.shutdown()
    }

    companion object {
        private const val TAG = "MantelPresence"
        private const val FRAME_INTERVAL_MS = 500L
        private const val TARGET_WIDTH = 320
        private const val MAX_FACES = 4
        private const val MIN_CONFIDENCE = 0.4f
        const val MODEL = "android.media.FaceDetector on the device"
    }
}
