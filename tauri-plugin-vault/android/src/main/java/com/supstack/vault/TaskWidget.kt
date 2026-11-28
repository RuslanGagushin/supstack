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
import android.util.AtomicFile
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
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
    private const val ACTION_REFRESH = "com.supstack.vault.REFRESH_TASK_WIDGET"

    data class Row(val title: String, val id: String? = null, val overdue: Boolean = false)
    data class Display(val root: String? = null, val date: String = "", val status: Int = R.string.task_widget_first_load, val rows: List<Row> = emptyList())

    private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "task-widget.json"))

    @Synchronized
    fun write(context: Context, value: String?) {
        val file = file(context)
        if (value == null) {
            file.delete()
            return
        }
        val out = file.startWrite()
        try {
            out.write(value.toByteArray(Charsets.UTF_8))
            file.finishWrite(out)
        } catch (error: Exception) {
            file.failWrite(out)
            throw error
        }
    }

    @Synchronized
    fun display(context: Context): Display {
        val stale = Display(status = R.string.task_widget_stale)
        return try {
            val saved = JSONObject(String(file(context).readFully(), Charsets.UTF_8))
            if (saved.optInt("version") != 1) return stale
            val root = saved.getString("root")
            if (context.contentResolver.persistedUriPermissions.none { it.isReadPermission && it.uri.toString() == root }) return stale
            val zone = TimeZone.getDefault()
            val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zone }.format(Date())
            if (zoneId(zone.id) != zoneId(saved.getString("zone"))) return stale
            val day = saved.getJSONObject("days").getJSONObject(date)
            val hasOverdue = day.getJSONArray("overdue").length() > 0
            val rows = buildList {
                for (overdue in listOf(true, false)) {
                    val tasks = day.getJSONArray(if (overdue) "overdue" else "today")
                    if (tasks.length() == 0) continue
                    if (hasOverdue) {
                        add(Row(context.getString(if (overdue) R.string.task_widget_overdue else R.string.task_widget_today), overdue = overdue))
                    }
                    for (i in 0 until tasks.length()) {
                        val task = tasks.getJSONObject(i)
                        add(Row(task.getString("title"), task.getString("id")))
                    }
                }
            }
            Display(root, date, R.string.task_widget_empty, rows)
        } catch (_: FileNotFoundException) {
            Display()
        } catch (_: Exception) {
            stale
        }
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
        val display = display(context)
        val open = launcherIntent(context, ACTION_OPEN) ?: return
        val add = launcherIntent(context, ACTION_ADD) ?: return
        val task = launcherIntent(context, ACTION_TASK) ?: return
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        val vaultKey = display.root?.let { UUID.nameUUIDFromBytes(it.toByteArray()).toString() }.orEmpty()
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.task_widget)
            val click = PendingIntent.getActivity(context, id, open, flags)
            views.setOnClickPendingIntent(R.id.task_widget_title, click)
            views.setOnClickPendingIntent(R.id.task_widget_status, click)
            views.setOnClickPendingIntent(R.id.task_widget_add, PendingIntent.getActivity(context, id, add, flags))
            views.setPendingIntentTemplate(R.id.task_widget_list, PendingIntent.getActivity(context, id, task, mutable))
            val hasRows = display.rows.isNotEmpty()
            views.setViewVisibility(R.id.task_widget_list, if (hasRows) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.task_widget_status, if (hasRows) View.GONE else View.VISIBLE)
            views.setTextViewText(R.id.task_widget_status, context.getString(display.status))
            val adapter = Intent(context, TaskWidgetRows::class.java).apply {
                // A different date or vault must not inherit rows cached by the launcher.
                data = Uri.Builder().scheme("supstack-widget").authority("rows")
                    .appendPath(id.toString()).appendPath(display.date)
                    .appendPath(vaultKey).build()
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
        if (intent.action == AppWidgetManager.ACTION_APPWIDGET_DISABLED) {
            TaskWidget.cancelRefresh(context)
            return
        }
        val broadcast = goAsync()
        worker.execute {
            try {
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
        override fun onDataSetChanged() { display = TaskWidget.display(applicationContext) }
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
                val hasNextTask = current.rows.getOrNull(position + 1)?.id != null
                setViewVisibility(R.id.task_widget_row_divider, if (hasNextTask) View.VISIBLE else View.GONE)
                setOnClickFillInIntent(R.id.task_widget_row, Intent().apply {
                    putExtra(TaskWidget.EXTRA_TASK_ID, row.id)
                    putExtra(TaskWidget.EXTRA_ROOT, current.root)
                })
            }
        }
    }
}
