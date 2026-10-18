package com.dsh.android.node

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that keeps the Node.js agent host alive while the app
 * is in the background (long-running agent tasks, waiting for tool
 * approvals, streaming replies, ...).
 */
class NodeService : Service() {

    override fun onCreate() {
        super.onCreate()
        startInForeground()
        // The runtime is started from the UI when settings are available;
        // this service mainly pins the process. Startup is idempotent.
    }

    private fun startInForeground() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Agent runtime",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("DeepSeek Harness")
            .setContentText("Agent runtime is active")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth) // placeholder icon; themed icon in release builds
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "dsh_agent_runtime"
        private const val NOTIFICATION_ID = 42

        fun start(context: Context) {
            val intent = Intent(context, NodeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
