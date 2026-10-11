package com.extas.erp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** The Extas ERP web app, with the DutyTracker plugin for background GPS while checked in. */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DutyTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
