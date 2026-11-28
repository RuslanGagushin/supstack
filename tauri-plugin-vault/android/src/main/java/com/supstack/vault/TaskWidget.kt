package com.supstack.vault

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.icu.util.TimeZone as IcuTimeZone
import android.net.Uri
import android.os.Build
import android.text.format.DateFormat
import android.util.AtomicFile
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors

internal object TaskWidget {
    const val ACTION_OPEN = "com.supstack.vault.OPEN_TASK_WIDGET"
    const val ACTION_ADD = "com.supstack.vault.ADD_WIDGET_TASK"
    const val ACTION_TASK = "com.supstack.vault.OPEN_WIDGET_TASK"
    const val EXTRA_TASK_ID = "taskId"
    const val EXTRA_ROOT = "taskRoot"
    const val EXTRA_DATE = "taskDate"
    const val EXTRA_VIEW = "taskView"
    const val ACTION_SWITCH = "com.supstack.vault.SWITCH_TASK_WIDGET"
    private const val ACTION_REFRESH = "com.supstack.vault.REFRESH_TASK_WIDGET"
    /** The snapshot's format, as web/src/js/services/task-widget.js writes it. */
    private const val VERSION = 2
    /** Upcoming: today and the six days after it. */
    private const val UPCOMING_DAYS = 7

    /** What a widget shows; each widget on the home screen keeps its own. */
    enum class Mode(val key: String, val title: Int, val empty: Int) {
        TODAY("today", R.string.task_widget_today, R.string.task_widget_empty),
        UPCOMING("upcoming", R.string.task_widget_upcoming, R.string.task_widget_empty_upcoming);

        val other get() = if (this == TODAY) UPCOMING else TODAY
    }

    /** A section's heading (no `id`) or a task. A task's `date` is the day it is listed on; `meta` its time and note. */
    data class Row(
        val title: String,
        val id: String? = null,
        val overdue: Boolean = false,
        val date: String? = null,
        val meta: String? = null,
        val pri: String? = null,
        val description: String? = null,
    )
    data class Display(val root: String? = null, val date: String = "", val status: Int = R.string.task_widget_first_load, val rows: List<Row> = emptyList())

    private fun prefs(context: Context) = context.getSharedPreferences("task-widget", Context.MODE_PRIVATE)

    fun mode(context: Context, id: Int): Mode =
        prefs(context).getString("view-$id", null).let { key -> Mode.values().firstOrNull { it.key == key } } ?: Mode.TODAY

    fun switchView(context: Context, id: Int) {
        prefs(context).edit().putString("view-$id", mode(context, id).other.key).apply()
    }

    fun forget(context: Context, ids: IntArray) {
        prefs(context).edit().apply { for (id in ids) remove("view-$id") }.apply()
    }

    private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "task-widget.json"))

    @Synchronized
    fun write(context: Context, value: String?) {
        val file = file(context)
        if (value == null) {
            file.delete()
            return
        }
        // The app is reading this same vault again (a cold start): its last rows stay until the new list comes.
        // Any other vault, or a failed read (no "pending"), replaces them at once.
        val next = JSONObject(value)
        if (next.optBoolean("pending") && keepsRows(file, next.getString("root"))) return
        val out = file.startWrite()
        try {
            out.write(value.toByteArray(Charsets.UTF_8))
            file.finishWrite(out)
        } catch (error: Exception) {
            file.failWrite(out)
            throw error
        }
    }

    private fun keepsRows(file: AtomicFile, root: String): Boolean = try {
        val saved = JSONObject(String(file.readFully(), Charsets.UTF_8))
        saved.optInt("version") == VERSION && saved.optString("root") == root && saved.has("days")
    } catch (_: Exception) {
        false
    }

    @Synchronized
    fun display(context: Context, mode: Mode = Mode.TODAY): Display {
        val stale = Display(status = R.string.task_widget_stale)
        return try {
            val saved = JSONObject(String(file(context).readFully(), Charsets.UTF_8))
            if (saved.optInt("version") != VERSION) return stale
            val root = saved.getString("root")
            if (context.contentResolver.persistedUriPermissions.none { it.isReadPermission && it.uri.toString() == root }) return stale
            val zone = TimeZone.getDefault()
            if (zoneId(zone.id) != zoneId(saved.getString("zone"))) return stale
            val format = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zone }
            val calendar = Calendar.getInstance(zone)
            val date = format.format(calendar.time)
            val days = saved.getJSONObject("days")
            val today = days.getJSONObject(date)
            val overdue = today.getJSONArray("overdue")
            val rows = mutableListOf<Row>()
            fun addTasks(tasks: JSONArray, day: String) {
                for (i in 0 until tasks.length()) rows.add(taskRow(context, tasks.getJSONObject(i), day))
            }
            fun addSection(title: String, tasks: JSONArray, day: String, late: Boolean = false) {
                if (tasks.length() == 0) return
                rows.add(Row(title, overdue = late))
                addTasks(tasks, day)
            }
            if (mode == Mode.TODAY) {
                // without overdue tasks, today's follow the header with no second "Today"
                if (overdue.length() > 0) {
                    addSection(context.getString(R.string.task_widget_overdue), overdue, date, late = true)
                    addSection(context.getString(R.string.task_widget_today), today.getJSONArray("today"), date)
                } else addTasks(today.getJSONArray("today"), date)
            } else {
                addSection(context.getString(R.string.task_widget_overdue), overdue, date, late = true)
                val heading = SimpleDateFormat(DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEdMMMM"), Locale.getDefault())
                    .apply { timeZone = zone }
                for (offset in 0 until UPCOMING_DAYS) {
                    val day = format.format(calendar.time)
                    // a week the app has not worked out yet: the copy is too old to show
                    val tasks = days.optJSONObject(day)?.getJSONArray("today") ?: return stale
                    val title = when (offset) {
                        0 -> context.getString(R.string.task_widget_today)
                        1 -> context.getString(R.string.task_widget_tomorrow)
                        else -> heading.format(calendar.time).replaceFirstChar { it.titlecase(Locale.getDefault()) }
                    }
                    addSection(title, tasks, day)
                    calendar.add(Calendar.DATE, 1)
                }
            }
            Display(root, date, mode.empty, rows)
        } catch (_: FileNotFoundException) {
            Display()
        } catch (_: Exception) {
            stale
        }
    }

    /** A task's row: its time ("09:00–10:00") and the note it belongs to under the title; its priority colours the circle. */
    private fun taskRow(context: Context, task: JSONObject, day: String): Row {
        val title = task.getString("title")
        val time = if (task.has("time")) {
            val start = clock(context, task.getInt("time"))
            if (task.has("end")) "$start–${clock(context, task.getInt("end"))}" else start
        } else null
        val note = task.optString("note").ifEmpty { null }
        val pri = task.optString("pri").ifEmpty { null }
        val meta = listOfNotNull(time, note).joinToString(" · ").ifEmpty { null }
        val description = listOfNotNull(
            title, time, note?.let { context.getString(R.string.task_widget_note, it) },
            pri?.let { context.getString(R.string.task_widget_priority, it) },
        ).joinToString(", ")
        return Row(title, task.getString("id"), date = day, meta = meta, pri = pri, description = description)
    }

    /** Minutes after midnight as the phone shows a time: 24-hour or with AM/PM, as set in its settings. */
    private fun clock(context: Context, minutes: Int): String {
        val pattern = DateFormat.getBestDateTimePattern(Locale.getDefault(), if (DateFormat.is24HourFormat(context)) "Hm" else "hm")
        val utc = TimeZone.getTimeZone("UTC")
        return SimpleDateFormat(pattern, Locale.getDefault()).apply { timeZone = utc }.format(Date(minutes * 60_000L))
    }

    private fun zoneId(id: String): String? =
        IcuTimeZone.getCanonicalID(id)?.let { if (it == "Etc/GMT") "Etc/UTC" else it }

    private fun launcherIntent(context: Context, action: String): Intent? =
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            this.action = action
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }

    @Suppress("DEPRECATION") // The service-backed collection also supports Android 7–11.
    @Synchronized
    fun refresh(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, TaskWidgetProvider::class.java))
        if (ids.isEmpty()) return
        val add = launcherIntent(context, ACTION_ADD) ?: return
        val task = launcherIntent(context, ACTION_TASK) ?: return
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        for (id in ids) {
            val mode = mode(context, id)
            val display = display(context, mode)
            val vaultKey = display.root?.let { UUID.nameUUIDFromBytes(it.toByteArray()).toString() }.orEmpty()
            val open = launcherIntent(context, ACTION_OPEN)?.putExtra(EXTRA_VIEW, mode.key) ?: return
            val views = RemoteViews(context.packageName, R.layout.task_widget)
            val click = PendingIntent.getActivity(context, id, open, flags)
            views.setOnClickPendingIntent(R.id.task_widget_open, click)
            views.setOnClickPendingIntent(R.id.task_widget_status, click)
            val title = context.getString(mode.title)
            views.setTextViewText(R.id.task_widget_title_text, title)
            views.setContentDescription(R.id.task_widget_title, context.getString(R.string.task_widget_switch, title, context.getString(mode.other.title)))
            val switch = Intent(context, TaskWidgetProvider::class.java).setAction(ACTION_SWITCH)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            views.setOnClickPendingIntent(R.id.task_widget_title, PendingIntent.getBroadcast(context, id, switch, flags))
            views.setOnClickPendingIntent(R.id.task_widget_add, PendingIntent.getActivity(context, id, add, flags))
            views.setPendingIntentTemplate(R.id.task_widget_list, PendingIntent.getActivity(context, id, task, mutable))
            val hasRows = display.rows.isNotEmpty()
            views.setViewVisibility(R.id.task_widget_list, if (hasRows) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.task_widget_status, if (hasRows) View.GONE else View.VISIBLE)
            views.setTextViewText(R.id.task_widget_status, context.getString(display.status))
            val adapter = Intent(context, TaskWidgetRows::class.java).apply {
                // A different date, view or vault must not inherit rows cached by the launcher.
                data = Uri.Builder().scheme("supstack-widget").authority("rows")
                    .appendPath(id.toString()).appendPath(display.date)
                    .appendPath(mode.key).appendPath(vaultKey).build()
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            }
            views.setRemoteAdapter(R.id.task_widget_list, adapter)
            manager.updateAppWidget(id, views)
            manager.notifyAppWidgetViewDataChanged(id, R.id.task_widget_list)
        }
        val nextDay = Calendar.getInstance().apply {
            add(Calendar.DATE, 1)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        context.getSystemService(AlarmManager::class.java)
            .setAndAllowWhileIdle(AlarmManager.RTC, nextDay.timeInMillis, refreshIntent(context))
    }

    private fun refreshIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, 0, Intent(context, TaskWidgetProvider::class.java).setAction(ACTION_REFRESH), PendingIntent.FLAG_IMMUTABLE,
    )

    fun cancelRefresh(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(refreshIntent(context))
    }
}

class TaskWidgetProvider : AppWidgetProvider() {
    companion object {
        private val worker = Executors.newSingleThreadExecutor()
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            AppWidgetManager.ACTION_APPWIDGET_DISABLED -> {
                TaskWidget.cancelRefresh(context)
                return
            }
            AppWidgetManager.ACTION_APPWIDGET_DELETED -> {
                intent.getIntArrayExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS)?.let { TaskWidget.forget(context, it) }
                return
            }
        }
        val switched = if (intent.action == TaskWidget.ACTION_SWITCH) {
            intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        } else AppWidgetManager.INVALID_APPWIDGET_ID
        val broadcast = goAsync()
        worker.execute {
            try {
                if (switched != AppWidgetManager.INVALID_APPWIDGET_ID) TaskWidget.switchView(context, switched)
                TaskWidget.refresh(context)
            } finally {
                broadcast.finish()
            }
        }
    }
}

class TaskWidgetRows : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = object : RemoteViewsFactory {
        private var display = TaskWidget.Display()

        override fun onCreate() {}
        override fun onDestroy() {}
        private val widget = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)

        override fun onDataSetChanged() { display = TaskWidget.display(applicationContext, TaskWidget.mode(applicationContext, widget)) }
        override fun getCount() = display.rows.size
        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount() = 2
        override fun getItemId(position: Int) = position.toLong()
        override fun hasStableIds() = false

        override fun getViewAt(position: Int): RemoteViews? {
            val current = display
            val row = current.rows.getOrNull(position) ?: return null
            if (row.id == null) {
                return RemoteViews(packageName, R.layout.task_widget_section).apply {
                    setTextViewText(R.id.task_widget_section, row.title)
                    if (row.overdue) setTextColor(R.id.task_widget_section, getColor(R.color.task_widget_late))
                }
            }
            return RemoteViews(packageName, R.layout.task_widget_row).apply {
                setTextViewText(R.id.task_widget_row_title, row.title)
                setTextViewText(R.id.task_widget_row_meta, row.meta.orEmpty())
                setViewVisibility(R.id.task_widget_row_meta, if (row.meta != null) View.VISIBLE else View.GONE)
                setImageViewResource(R.id.task_widget_row_mark, when (row.pri) {
                    "A" -> R.drawable.task_widget_open_task_a
                    "B" -> R.drawable.task_widget_open_task_b
                    "C" -> R.drawable.task_widget_open_task_c
                    else -> R.drawable.task_widget_open_task
                })
                setContentDescription(R.id.task_widget_row, row.description ?: row.title)
                val hasNextTask = current.rows.getOrNull(position + 1)?.id != null
                setViewVisibility(R.id.task_widget_row_divider, if (hasNextTask) View.VISIBLE else View.GONE)
                setOnClickFillInIntent(R.id.task_widget_row, Intent().apply {
                    putExtra(TaskWidget.EXTRA_TASK_ID, row.id)
                    putExtra(TaskWidget.EXTRA_ROOT, current.root)
                    putExtra(TaskWidget.EXTRA_DATE, row.date)
                })
            }
        }
    }
}
