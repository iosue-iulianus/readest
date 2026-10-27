@file:OptIn(ExperimentalWindowApi::class)

package com.readest.native_bridge

import android.app.Activity
import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.window.area.WindowAreaCapability
import androidx.window.area.WindowAreaController
import androidx.window.area.WindowAreaInfo
import androidx.window.area.WindowAreaPresentationSessionCallback
import androidx.window.area.WindowAreaSessionPresenter
import androidx.window.core.ExperimentalWindowApi
import app.tauri.annotation.InvokeArg
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.min
import kotlin.math.roundToInt

@InvokeArg
class SetCoverScreenBookRequestArgs {
    var title: String = ""
    var author: String = ""
    var coverPath: String = ""
    // How much to dim the cover, in percent.
    var dim: Int = 0
    // Fill the screen and crop the cover's edges instead of showing it whole.
    var crop: Boolean = false
}

/**
 * Shows the open book's cover on a foldable's outer screen while the app runs
 * unfolded, through Jetpack WindowManager's rear display presentation (API 34+,
 * e.g. Galaxy Z Fold). Owned by [NativeBridgePlugin]; every method runs on the
 * main thread.
 *
 * A session starts only when JS asked for one ([start]), a book is set and the
 * rear area reports AVAILABLE. Folding or leaving the app ends it; it comes back
 * when the area becomes available again, never straight after the system ended
 * it while the area stayed available, so a session the system keeps ending
 * can't loop.
 *
 * Watches the activity's lifecycle itself: Tauri declares Plugin.onResume but
 * never calls it.
 */
internal class CoverScreenController(
    private val activity: Activity,
    private val scope: CoroutineScope,
    private val onStatusChanged: (supported: Boolean, status: String) -> Unit,
) {
    class Book(
        val title: String,
        val author: String,
        val coverPath: String,
        val dim: Int,
        val crop: Boolean,
    ) {
        constructor(args: SetCoverScreenBookRequestArgs) :
            this(args.title, args.author, args.coverPath, args.dim, args.crop)
    }

    private val controller: WindowAreaController? =
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                WindowAreaController.getOrCreate()
            } catch (e: Throwable) {
                Log.w(TAG, "WindowAreaController unavailable", e)
                null
            }
        } else {
            null
        }

    private var book: Book? = null
    private var wanted = false
    private var resumed = true
    private var starting = false
    private var session: WindowAreaSessionPresenter? = null
    private var rearArea: WindowAreaInfo? = null
    // The settled status of presenting on the rear area; null until the first
    // emission settles, and again while the app is paused.
    private var presentStatus: WindowAreaCapability.Status? = null
    private var reported: String? = null
    private val firstStatus = CompletableDeferred<Unit>()

    private var collectJob: Job? = null
    private var renderJob: Job? = null
    private var content: FrameLayout? = null
    private var imageView: ImageView? = null
    private var textView: TextView? = null

    private val lifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(a: Activity) {
            if (a === activity) onResume()
        }

        override fun onActivityPaused(a: Activity) {
            if (a === activity) onPause()
        }

        override fun onActivityCreated(a: Activity, b: Bundle?) {}
        override fun onActivityStarted(a: Activity) {}
        override fun onActivityStopped(a: Activity) {}
        override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
        override fun onActivityDestroyed(a: Activity) {}
    }

    init {
        activity.application.registerActivityLifecycleCallbacks(lifecycleCallbacks)
        startCollecting()
    }

    /** Waits briefly for the first settled status so a supported device isn't reported as unsupported. */
    suspend fun status(): Pair<Boolean, String> {
        if (controller != null) withTimeoutOrNull(STATUS_WAIT_MS) { firstStatus.await() }
        val status = currentStatus()
        return (status != STATUS_UNSUPPORTED) to status
    }

    fun setBook(next: Book) {
        book = next
        render()
    }

    fun start() {
        wanted = true
        maybeStart()
    }

    fun stop() {
        wanted = false
        session?.close()
    }

    fun close() {
        wanted = false
        onPause()
        activity.application.unregisterActivityLifecycleCallbacks(lifecycleCallbacks)
    }

    private fun onResume() {
        resumed = true
        startCollecting()
    }

    private fun onPause() {
        resumed = false
        collectJob?.cancel()
        collectJob = null
        // A resume then counts as the area becoming available again.
        presentStatus = null
        session?.close()
    }

    private fun startCollecting() {
        val controller = controller ?: return
        if (collectJob != null) return
        collectJob = scope.launch {
            var settle: Job? = null
            controller.windowAreaInfos.collect { infos ->
                // Statuses flicker for a few ms on launch, fold and session end
                // (folded: UNSUPPORTED, AVAILABLE, then UNAVAILABLE). Act only on
                // one that holds.
                settle?.cancel()
                settle = launch {
                    delay(SETTLE_MS)
                    applyAreas(infos)
                }
            }
        }
    }

    private fun applyAreas(infos: List<WindowAreaInfo>) {
        val area = infos.firstOrNull { it.type == WindowAreaInfo.Type.TYPE_REAR_FACING }
        val status = area?.getCapability(WindowAreaCapability.Operation.OPERATION_PRESENT_ON_AREA)?.status
        val previous = presentStatus
        rearArea = area
        presentStatus = status
        firstStatus.complete(Unit)
        report()
        val available = WindowAreaCapability.Status.WINDOW_AREA_STATUS_AVAILABLE
        val active = WindowAreaCapability.Status.WINDOW_AREA_STATUS_ACTIVE
        if (status == available && previous != available && previous != active) maybeStart()
    }

    private fun maybeStart() {
        val controller = controller ?: return
        val area = rearArea ?: return
        if (!wanted || !resumed || book == null || session != null || starting) return
        if (presentStatus != WindowAreaCapability.Status.WINDOW_AREA_STATUS_AVAILABLE) return
        starting = true
        controller.presentContentOnWindowArea(area.token, activity, activity.mainExecutor, callback)
    }

    private val callback = object : WindowAreaPresentationSessionCallback {
        override fun onSessionStarted(session: WindowAreaSessionPresenter) {
            starting = false
            if (!wanted || !resumed) {
                session.close()
                return
            }
            this@CoverScreenController.session = session
            session.setContentView(buildView(session.context))
            render()
            report()
        }

        override fun onSessionEnded(t: Throwable?) {
            if (t != null) Log.w(TAG, "cover screen session ended", t)
            starting = false
            session = null
            renderJob?.cancel()
            content = null
            imageView = null
            textView = null
            report()
        }

        override fun onContainerVisibilityChanged(isVisible: Boolean) {}
    }

    private fun buildView(context: Context): View {
        val root = FrameLayout(context)
        // Pure black: the outer screen is OLED, so the bars around the cover stay off.
        root.setBackgroundColor(Color.BLACK)
        val content = FrameLayout(context)
        val image = ImageView(context)
        val text = TextView(context)
        text.setTextColor(Color.WHITE)
        text.textSize = 24f
        text.gravity = Gravity.CENTER
        val padding = (32 * context.resources.displayMetrics.density).roundToInt()
        text.setPadding(padding, padding, padding, padding)
        text.visibility = View.GONE
        val fill = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
        )
        content.addView(image, fill)
        content.addView(text, fill)
        root.addView(content, fill)
        this.content = content
        imageView = image
        textView = text
        return root
    }

    /** Updates the session's view in place; the old cover stays up until the new one is decoded. */
    private fun render() {
        val session = session ?: return
        val book = book ?: return
        content?.alpha = (100 - book.dim.coerceIn(0, MAX_DIM)) / 100f
        val bounds = session.context.getSystemService(WindowManager::class.java).currentWindowMetrics.bounds
        renderJob?.cancel()
        renderJob = scope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                try {
                    if (book.crop) {
                        decodeCropped(book.coverPath, bounds.width(), bounds.height())
                    } else {
                        decodeFitted(book.coverPath, bounds.width(), bounds.height())
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "cover screen decode failed", e)
                    null
                }
            }
            val image = imageView ?: return@launch
            val text = textView ?: return@launch
            image.scaleType = if (book.crop) ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER
            image.setImageBitmap(bitmap)
            if (bitmap == null) {
                text.text = listOf(book.title, book.author).filter { it.isNotEmpty() }.joinToString("\n\n")
                text.visibility = View.VISIBLE
            } else {
                text.visibility = View.GONE
            }
        }
    }

    // Scales the cover to fit the screen whole. decodeCoverCroppedAndScaled crops
    // to the target's aspect, so asking for the cover's own aspect crops nothing.
    private fun decodeFitted(path: String, maxW: Int, maxH: Int): Bitmap? {
        if (path.isEmpty()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        if (bounds.outWidth < 2 || bounds.outHeight < 2) return null
        val scale = min(maxW.toFloat() / bounds.outWidth, maxH.toFloat() / bounds.outHeight)
        val w = (bounds.outWidth * scale).roundToInt().coerceAtLeast(2)
        val h = (bounds.outHeight * scale).roundToInt().coerceAtLeast(2)
        return WidgetImageUtils.decodeCoverCroppedAndScaled(path, w, h)
    }

    private fun decodeCropped(path: String, w: Int, h: Int): Bitmap? =
        if (path.isEmpty()) null else WidgetImageUtils.decodeCoverCroppedAndScaled(path, w, h)

    private fun currentStatus(): String = when {
        session != null -> STATUS_ACTIVE
        presentStatus == WindowAreaCapability.Status.WINDOW_AREA_STATUS_AVAILABLE -> STATUS_AVAILABLE
        // ACTIVE without our session means another app holds the area.
        presentStatus == WindowAreaCapability.Status.WINDOW_AREA_STATUS_UNAVAILABLE ||
            presentStatus == WindowAreaCapability.Status.WINDOW_AREA_STATUS_ACTIVE -> STATUS_UNAVAILABLE
        else -> STATUS_UNSUPPORTED
    }

    private fun report() {
        // While paused the status is unknown, not unsupported.
        if (!resumed) return
        val status = currentStatus()
        if (status == reported) return
        reported = status
        onStatusChanged(status != STATUS_UNSUPPORTED, status)
    }

    companion object {
        private const val TAG = "CoverScreen"
        private const val SETTLE_MS = 300L
        private const val STATUS_WAIT_MS = 1500L
        private const val MAX_DIM = 90
        private const val STATUS_UNSUPPORTED = "unsupported"
        private const val STATUS_UNAVAILABLE = "unavailable"
        private const val STATUS_AVAILABLE = "available"
        private const val STATUS_ACTIVE = "active"
    }
}
