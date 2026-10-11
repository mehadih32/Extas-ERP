package com.extas.erp;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.webkit.CookieManager;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import androidx.core.location.LocationManagerCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Keeps sending the phone's position to Extas ERP while the person is checked in (GPS
 * attendance), with the screen off or the app closed. A position is taken about every
 * pingEverySeconds (sooner after moving 50 m) and the positions are sent each
 * sendEverySeconds with the app's sign-in cookie. Positions taken with no network are kept
 * (on the phone, up to MAX_WAITING) and sent when it is back. It stops when the server
 * answers that the person is no longer on duty (checked out), or when sign-in has ended.
 */
public class DutyTrackerService extends Service {

    static final String PREFS = "extas_duty";
    private static final String ACTION_START = "com.extas.erp.duty.START";
    private static final String ACTION_STOP = "com.extas.erp.duty.STOP";
    private static final String CHANNEL = "duty";
    private static final int NOTICE_ID = 4801;
    private static final int SIGNED_OUT_ID = 4802;
    private static final int MAX_WAITING = 2000;
    private static final int BATCH = 300;
    private static final float MOVED_METRES = 50f;

    private static volatile boolean running = false;

    private HandlerThread thread;
    private Handler handler;
    private LocationManager locations;
    private String endpoint;
    private long pingMs = 30_000;
    private long sendMs = 60_000;
    private Location lastKept;
    private JSONArray waiting = new JSONArray();
    private boolean locationOff = false;

    // --- Started and stopped by DutyTrackerPlugin -----------------------------------------

    static void start(Context context, String endpoint, int pingEverySeconds, int sendEverySeconds) {
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("endpoint", endpoint)
            .putInt("ping", Math.max(10, pingEverySeconds))
            .putInt("send", Math.max(15, sendEverySeconds))
            .apply();
        Intent intent = new Intent(context, DutyTrackerService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(context, intent);
    }

    static void stop(Context context) {
        if (!running) return;
        Intent intent = new Intent(context, DutyTrackerService.class).setAction(ACTION_STOP);
        context.startService(intent);
    }

    static boolean isRunning() {
        return running;
    }

    /** Positions taken and not yet sent. */
    static int waiting(Context context) {
        try {
            String saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("waiting", "[]");
            return new JSONArray(saved).length();
        } catch (JSONException e) {
            return 0;
        }
    }

    // --- The service ------------------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("extas-duty");
        thread.start();
        handler = new Handler(thread.getLooper());
        locations = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        // Sets up the web app's cookie store here, on the main thread, before the sender reads it.
        CookieManager.getInstance();
        createChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            handler.post(() -> {
                send(true);
                finish();
            });
            return START_NOT_STICKY;
        }
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        endpoint = prefs.getString("endpoint", null);
        pingMs = prefs.getInt("ping", 30) * 1000L;
        sendMs = prefs.getInt("send", 60) * 1000L;
        if (endpoint == null || !hasLocationPermission()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // Must come within seconds of being started, before anything else.
        try {
            ServiceCompat.startForeground(
                this,
                NOTICE_ID,
                notice(),
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0
            );
        } catch (RuntimeException e) {
            // Android refused (started from the background): nothing can be tracked now.
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!running) {
            running = true;
            handler.post(this::begin);
        }
        // Started again by Android after it was stopped for memory: carry on.
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (locations != null) locations.removeUpdates(listener);
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    @SuppressLint("MissingPermission")
    private void begin() {
        try {
            waiting = new JSONArray(getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("waiting", "[]"));
        } catch (JSONException e) {
            waiting = new JSONArray();
        }
        if (!hasLocationPermission()) {
            finish();
            return;
        }
        // GPS outdoors, the mobile network and Wi-Fi indoors; no Google Play services needed.
        for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
            if (!locations.getAllProviders().contains(provider)) continue;
            locations.requestLocationUpdates(provider, pingMs, 0f, listener, thread.getLooper());
        }
        locationOff = !LocationManagerCompat.isLocationEnabled(locations);
        updateNotice();
        handler.postDelayed(sender, sendMs);
    }

    private final Runnable sender = new Runnable() {
        @Override
        public void run() {
            send(false);
            if (running) handler.postDelayed(this, sendMs);
        }
    };

    private final LocationListener listener = new LocationListener() {
        @Override
        public void onLocationChanged(@NonNull Location location) {
            keep(location);
        }

        // Older Android versions need all four.
        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {}

        @Override
        public void onProviderEnabled(@NonNull String provider) {
            locationChanged();
        }

        @Override
        public void onProviderDisabled(@NonNull String provider) {
            locationChanged();
        }
    };

    private void locationChanged() {
        boolean off = !LocationManagerCompat.isLocationEnabled(locations);
        if (off != locationOff) {
            locationOff = off;
            updateNotice();
        }
    }

    /** Keeps a position about every pingMs, or sooner after moving; the more exact of two close ones. */
    private void keep(Location location) {
        if (locationOff) locationChanged();
        if (location.hasAccuracy() && location.getAccuracy() > 1000f) return;
        if (lastKept != null) {
            long gap = location.getTime() - lastKept.getTime();
            if (gap <= 0) return;
            boolean soon = gap < pingMs * 0.8;
            boolean moved = location.distanceTo(lastKept) >= MOVED_METRES;
            if (soon && (!moved || worse(location, lastKept))) return;
        }
        lastKept = location;
        try {
            JSONObject point = new JSONObject();
            point.put("at", location.getTime());
            point.put("lat", location.getLatitude());
            point.put("lng", location.getLongitude());
            if (location.hasAccuracy()) point.put("accuracy", Math.round(location.getAccuracy()));
            if (location.hasSpeed()) point.put("speed", Math.min(300.0, location.getSpeed()));
            int battery = batteryLevel();
            if (battery >= 0) point.put("battery", battery);
            waiting.put(point);
            while (waiting.length() > MAX_WAITING) waiting.remove(0);
            save();
        } catch (JSONException ignored) {
            // A position that cannot be written is skipped.
        }
    }

    private static boolean worse(Location a, Location b) {
        return a.hasAccuracy() && b.hasAccuracy() && a.getAccuracy() > b.getAccuracy();
    }

    private int batteryLevel() {
        BatteryManager battery = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
        if (battery == null) return -1;
        int level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        return level >= 0 && level <= 100 ? level : -1;
    }

    private void save() {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("waiting", waiting.toString()).apply();
    }

    /** Sends what is waiting, oldest first, a batch at a time. */
    private void send(boolean lastTime) {
        if (endpoint == null) return;
        while (waiting.length() > 0) {
            int count = Math.min(BATCH, waiting.length());
            JSONArray points = new JSONArray();
            for (int i = 0; i < count; i++) points.put(waiting.opt(i));
            int answer = post(points);
            if (answer == ANSWER_RETRY) return;
            for (int i = 0; i < count; i++) waiting.remove(0);
            save();
            if (answer == ANSWER_OFF_DUTY && !lastTime) {
                finish();
                return;
            }
            if (answer == ANSWER_SIGNED_OUT) {
                if (!lastTime) {
                    signedOutNotice();
                    finish();
                }
                return;
            }
        }
        if (!lastTime && waiting.length() == 0) {
            // Nothing to send: still ask, so a check-out on another device stops the tracking.
            if (post(new JSONArray()) == ANSWER_OFF_DUTY) finish();
        }
    }

    private static final int ANSWER_SENT = 0;
    private static final int ANSWER_OFF_DUTY = 1;
    private static final int ANSWER_SIGNED_OUT = 2;
    private static final int ANSWER_RETRY = 3;

    private int post(JSONArray points) {
        HttpURLConnection connection = null;
        try {
            JSONObject body = new JSONObject();
            body.put("source", "ANDROID");
            body.put("points", points);
            connection = (HttpURLConnection) new URL(points.length() == 0 ? dutyUrl() : endpoint).openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(20_000);
            connection.setRequestProperty("Accept", "application/json");
            String cookie = CookieManager.getInstance().getCookie(endpoint);
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            if (points.length() > 0) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) return ANSWER_SIGNED_OUT;
            if (status >= 500 || status == 408 || status == 429) return ANSWER_RETRY;
            if (status >= 400) return ANSWER_SENT; // Not acceptable: dropped, not retried for ever.
            JSONObject answer = new JSONObject(read(connection.getInputStream()));
            JSONObject data = answer.optJSONObject("data");
            // The duty question answers null when GPS attendance no longer applies.
            if (data == null || !data.optBoolean("onDuty", false)) return ANSWER_OFF_DUTY;
            return ANSWER_SENT;
        } catch (Exception e) {
            return ANSWER_RETRY;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** /api/portal/location/duty next to the pings address. */
    private String dutyUrl() {
        return endpoint.replaceFirst("/pings$", "/duty");
    }

    private static String read(InputStream in) throws java.io.IOException {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int n;
            while ((n = stream.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toString("UTF-8");
        }
    }

    private void finish() {
        running = false;
        if (locations != null) locations.removeUpdates(listener);
        handler.removeCallbacksAndMessages(null);
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private boolean hasLocationPermission() {
        return (
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        );
    }

    // --- The notice in the status bar --------------------------------------------------------

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Checked in", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shows while Extas ERP shares your location during your shift.");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private PendingIntent openApp() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification notice() {
        String text = locationOff
            ? "Location is off. Turn it on: you are still checked in."
            : "You are checked in. Your location is shared until you check out.";
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_location)
            .setContentTitle(locationOff ? "Turn on your location" : "Sharing your location")
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(locationOff ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openApp())
            .build();
    }

    private void updateNotice() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTICE_ID, notice());
    }

    private void signedOutNotice() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.notify(
            SIGNED_OUT_ID,
            new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_location)
                .setContentTitle("Location sharing stopped")
                .setContentText("Open Extas ERP and sign in again.")
                .setAutoCancel(true)
                .setContentIntent(openApp())
                .build()
        );
    }
}
