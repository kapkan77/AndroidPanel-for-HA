package local.home.hmi;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/** Receives configuration from an authorized ADB shell, not ordinary Android apps.
 * Android enforces the android.permission.DUMP sender permission in the manifest.
 * This receiver never receives or replaces the user's PIN.
 */
public class ProvisionReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!"local.home.hmi.PROVISION".equals(intent.getAction())) {
            setResultCode(2);setResultData("invalid_action");return;
        }
        String url=PanelUrl.normalize(intent.getStringExtra("start_url"));
        if(url==null){setResultCode(2);setResultData("invalid_url");return;}
        SharedPreferences prefs=context.getSharedPreferences("panel",Context.MODE_PRIVATE);
        SharedPreferences.Editor edit=prefs.edit().putString("start_url",url);
        // The first PIN will activate protection. Existing protection is not turned off.
        if(intent.getBooleanExtra("enable_lock",true))edit.putBoolean("child_lock",true);
        boolean saved=edit.commit();
        setResultCode(saved?0:3);
        setResultData(!saved?"save_failed":prefs.contains("pin_hash")?"home_panel_configured":"home_panel_configured_pin_needed");
    }
}
