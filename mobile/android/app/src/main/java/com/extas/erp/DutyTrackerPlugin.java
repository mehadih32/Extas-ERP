package com.extas.erp;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.CookieManager;
import androidx.core.location.LocationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * What the Extas ERP pages call (components/hr/location-client.ts) to keep sending the phone's
 * position while the person is checked in: start, stop, status and permissions. The sending is
 * done by DutyTrackerService, a foreground service that keeps going with the screen off or the
 * app closed, until the server answers that the person has checked out.
 */
@CapacitorPlugin(
    name = "DutyTracker",
    permissions = {
        @Permission(
            alias = DutyTrackerPlugin.LOCATION,
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(alias = DutyTrackerPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class DutyTrackerPlugin extends Plugin {

    static final String LOCATION = "location";
    static final String NOTIFICATIONS = "notifications";
    private static final String ASKED_BATTERY = "askedBattery";

    /** start({ endpoint, pingEverySeconds, sendEverySeconds }): asks for location if needed, then starts. */
    @PluginMethod
    public void start(PluginCall call) {
        if (call.getString("endpoint") == null) {
            call.reject("The endpoint is missing.");
            return;
        }
        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            requestPermissionForAlias(LOCATION, call, "afterLocationForStart");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void afterLocationForStart(PluginCall call) {
        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            call.resolve(status());
            return;
        }
        begin(call);
    }

    private void begin(PluginCall call) {
        // Android 13+: the "Sharing your location" notice needs this; tracking works either way.
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState(NOTIFICATIONS) == PermissionState.PROMPT) {
            requestPermissionForAlias(NOTIFICATIONS, call, "afterNotifications");
            return;
        }
        launch(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        launch(call);
    }

    private void launch(PluginCall call) {
        Context context = getContext();
        // The service sends with the web app's sign-in cookie: make sure it is on disk.
        CookieManager.getInstance().flush();
        DutyTrackerService.start(
            context,
            call.getString("endpoint"),
            call.getInt("pingEverySeconds", 30),
            call.getInt("sendEverySeconds", 60)
        );
        askToRunInBackgroundOnce(context);
        call.resolve(status());
    }

    /**
     * Some phones stop background work to save battery. Ask once to let Extas ERP keep running
     * (the app is installed directly, not from Play, so this is allowed).
     */
    @SuppressLint("BatteryLife")
    private void askToRunInBackgroundOnce(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(DutyTrackerService.PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean(ASKED_BATTERY, false)) return;
        prefs.edit().putBoolean(ASKED_BATTERY, true).apply();
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (power == null || power.isIgnoringBatteryOptimizations(context.getPackageName())) return;
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            getActivity().startActivity(intent);
        } catch (Exception ignored) {
            // Not offered on this phone.
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        DutyTrackerService.stop(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    /** Asks for location again (after "Try again"); opens the app's settings once refused for good. */
    @PluginMethod
    public void permissions(PluginCall call) {
        PermissionState state = getPermissionState(LOCATION);
        if (state == PermissionState.GRANTED) {
            call.resolve(status());
        } else if (state == PermissionState.DENIED) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            } catch (Exception ignored) {
                // No settings screen: the page explains what to do.
            }
            call.resolve(status());
        } else {
            requestPermissionForAlias(LOCATION, call, "afterPermissions");
        }
    }

    @PermissionCallback
    private void afterPermissions(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        Context context = getContext();
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        JSObject result = new JSObject();
        result.put("running", DutyTrackerService.isRunning());
        result.put("locationOn", manager != null && LocationManagerCompat.isLocationEnabled(manager));
        result.put("permission", permissionText(getPermissionState(LOCATION)));
        result.put("waiting", DutyTrackerService.waiting(context));
        return result;
    }

    private static String permissionText(PermissionState state) {
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt";
    }
}
