package local.home.hmi;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Collections;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.io.ByteArrayInputStream;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private SharedPreferences prefs;
    private DevicePolicyManager policy;
    private ComponentName admin;
    private WebView browser;
    private NumericPinDialog pinDialog;
    private Dialog pinSettingsDialog;
    private boolean trustedPage;
    private long blockedUntil, gestureStarted;
    private int failures, taps;
    private final PinAccess pinAccess=new PinAccess();
    private final ExecutorService pinWorker=Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("panel", MODE_PRIVATE);
        policy = (DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
        admin = new ComponentName(this, PanelAdmin.class);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setBrightnessValue(.4f);
        browser = new WebView(this);
        browser.setBackgroundColor(Color.rgb(16,20,24));
        browser.getSettings().setJavaScriptEnabled(true);
        browser.getSettings().setDomStorageEnabled(true);
        browser.getSettings().setTextZoom(100);
        browser.getSettings().setAllowFileAccess(false);
        browser.getSettings().setAllowContentAccess(false);
        browser.getSettings().setUserAgentString(browser.getSettings().getUserAgentString() + " HmiKiosk/1.3.0");
        CookieManager.getInstance().setAcceptCookie(true);
        browser.addJavascriptInterface(new Bridge(), "HmiKiosk");
        browser.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri target=request.getUrl();
                if (("http".equals(target.getScheme()) || "https".equals(target.getScheme())) && !isAllowed(target)) {
                    return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isAllowed(request.getUrl())) return false;
                toast("Открытие внешних ссылок отключено"); return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) { trustedPage = isAllowed(Uri.parse(url)); }
            @Override public void onPageFinished(WebView view, String url) { trustedPage = isAllowed(Uri.parse(url)); stateChanged(); }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                handler.postDelayed(() -> { finish(); startActivity(new Intent(MainActivity.this,MainActivity.class)); },500);
                return true;
            }
        });
        setContentView(browser);
        immersive();
        if (startUrl().isEmpty()) handler.postDelayed(() -> {if(hasPin())withAuth(()->editUrl(true));else editUrl(true);},300);
        else {browser.loadUrl(startUrl());if (!hasPin()) handler.postDelayed(this::setupPin,500);}
    }

    @Override protected void onResume() { super.onResume(); immersive(); if (prefs != null) applyProtection(); }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);setIntent(intent);
        if(intent.getBooleanExtra("refresh_url",false)&&browser!=null&&!startUrl().isEmpty()){
            pinAccess.invalidate();trustedPage=false;browser.stopLoading();browser.loadUrl(startUrl());applyProtection();
        }
    }
    @Override public void onWindowFocusChanged(boolean focus) { super.onWindowFocusChanged(focus); if(focus)immersive(); }
    @Override public void onBackPressed() { if (locked()) withAuth(this::nativeMenu); else nativeMenu(); }
    @Override protected void onDestroy() { if(pinDialog!=null)pinDialog.dismiss();if(pinSettingsDialog!=null)pinSettingsDialog.dismiss();pinWorker.shutdownNow();handler.removeCallbacksAndMessages(null); if(browser!=null){browser.removeJavascriptInterface("HmiKiosk"); browser.destroy();} super.onDestroy(); }
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getAction()==MotionEvent.ACTION_DOWN && event.getX()<48 && event.getY()<48) {
            long now=SystemClock.elapsedRealtime();
            if(now-gestureStarted>2500){gestureStarted=now;taps=0;}
            if(++taps>=5){taps=0;withAuth(this::nativeMenu);return true;}
        }
        return super.dispatchTouchEvent(event);
    }
    private void immersive() { getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE); }
    private boolean owner() { return policy!=null && policy.isDeviceOwnerApp(getPackageName()); }
    private boolean hasPin() { return prefs.contains("pin_hash"); }
    private boolean locked() { return prefs!=null && prefs.getBoolean("child_lock",false); }
    private String startUrl() { return prefs.getString("start_url",""); }
    private boolean isAllowed(Uri target) {
        Uri base=Uri.parse(startUrl());
        return target.getScheme()!=null && target.getScheme().equalsIgnoreCase(base.getScheme()) && target.getHost()!=null && target.getHost().equalsIgnoreCase(base.getHost()) && effectivePort(target)==effectivePort(base);
    }
    private int effectivePort(Uri uri){return uri.getPort()!=-1?uri.getPort():"https".equalsIgnoreCase(uri.getScheme())?443:80;}
    private void setBrightnessValue(float value) {
        WindowManager.LayoutParams params=getWindow().getAttributes();
        params.screenBrightness=Math.max(.035f,Math.min(.9f,value));getWindow().setAttributes(params);
    }
    private void applyProtection() {
        if (!owner() || !hasPin()) { stateChanged(); return; }
        try {
            policy.setLockTaskPackages(admin,new String[]{getPackageName()});
            if(Build.VERSION.SDK_INT>=28)policy.setLockTaskFeatures(admin,DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
            policy.setKeyguardDisabled(admin,true);
            policy.setStatusBarDisabled(admin,locked());
            if(locked()) {
                setPreferredHome(new ComponentName(this,MainActivity.class));
                if(!isInLockTask())startLockTask();
            } else if(isInLockTask())stopLockTask();
        } catch(RuntimeException error) { toast("Не удалось применить защиту"); }
        stateChanged();
    }
    private boolean isInLockTask() { return ((android.app.ActivityManager)getSystemService(ACTIVITY_SERVICE)).getLockTaskModeState()!=android.app.ActivityManager.LOCK_TASK_MODE_NONE; }
    private void stateChanged() { if(browser!=null)browser.evaluateJavascript("window.dispatchEvent(new CustomEvent('hmi-kiosk-state'));",null); }
    private void webSettings() {pinAccess.openSession();browser.evaluateJavascript("window.dispatchEvent(new CustomEvent('hmi-admin'));",null);}
    private void toast(String text) { Toast.makeText(this,text,Toast.LENGTH_LONG).show(); }
    private LinearLayout fields(EditText... inputs) { LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);int p=(int)(20*getResources().getDisplayMetrics().density);box.setPadding(p,0,p,0);for(EditText field:inputs)box.addView(field);return box; }
    private void setupPin() {
        if(hasPin()||isFinishing())return;
        changePin(false);
    }
    private byte[] derive(String pin,byte[] salt) throws Exception { PBEKeySpec spec=new PBEKeySpec(pin.toCharArray(),salt,100000,256);try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();}finally{spec.clearPassword();} }
    private boolean verify(String pin) {if(!PinAccess.validPin(pin))return false;try{byte[] salt=Base64.decode(prefs.getString("pin_salt",""),Base64.NO_WRAP);byte[] hash=Base64.decode(prefs.getString("pin_hash",""),Base64.NO_WRAP);return MessageDigest.isEqual(hash,derive(pin,salt));}catch(Exception e){return false;} }
    private int pinGraceSeconds(){return PinAccess.graceSeconds(prefs.getInt("pin_grace_seconds",0));}
    private String graceLabel(){switch(pinGraceSeconds()){case 30:return "30 секунд";case 60:return "1 минута";case 300:return "5 минут";case 600:return "10 минут";default:return "Запрашивать каждый раз";}}
    private void endSession(){pinAccess.closeSession();}
    private boolean pinBlocked(){if(SystemClock.elapsedRealtime()<blockedUntil){toast("Подождите минуту перед следующей попыткой");return true;}return false;}
    private void failedPin(NumericPinDialog dialog){if(++failures>=5){blockedUntil=SystemClock.elapsedRealtime()+60000;failures=0;dialog.dismiss();toast("Подождите минуту перед следующей попыткой");}else dialog.error("Неверный PIN");}
    private void withAuth(Runnable action) {
        if(!hasPin()){setupPin();return;}
        if(pinBlocked())return;
        if(pinAccess.allows(SystemClock.elapsedRealtime(),locked(),pinGraceSeconds())){action.run();return;}
        if(pinDialog!=null&&pinDialog.isShowing())return;
        pinDialog=new NumericPinDialog(this,"Доступ к настройкам","Введите PIN · 4 цифры","Открыть",true,(candidate,ui)->{
            ui.busy("Проверка…");pinWorker.execute(()->{boolean ok=verify(candidate);handler.post(()->{if(isFinishing()||!ui.isShowing())return;if(ok){failures=0;pinAccess.verified(SystemClock.elapsedRealtime());ui.dismiss();action.run();}else failedPin(ui);});});
        });
        final NumericPinDialog current=pinDialog;current.onDismiss(()->{if(pinDialog==current)pinDialog=null;});current.show();
    }
    private void changePin(boolean requireCurrent){
        if(isFinishing()||pinBlocked()||(pinDialog!=null&&pinDialog.isShowing()))return;
        final int[] step={requireCurrent?0:1};final String[] first={null};
        pinDialog=new NumericPinDialog(this,requireCurrent?"Смена PIN":"Создание PIN",requireCurrent?"Шаг 1 из 3 · текущий PIN":"Новый PIN · 4 цифры","Далее",requireCurrent,(candidate,ui)->{
            if(step[0]==0){ui.busy("Проверка…");pinWorker.execute(()->{boolean ok=verify(candidate);handler.post(()->{if(isFinishing()||!ui.isShowing())return;if(ok){failures=0;step[0]=1;ui.prompt("Новый PIN","Шаг 2 из 3 · только 4 цифры","Далее");}else failedPin(ui);});});return;}
            if(step[0]==1){first[0]=candidate;step[0]=2;ui.prompt("Повторите новый PIN",requireCurrent?"Шаг 3 из 3 · подтвердите код":"Подтвердите PIN · 4 цифры","Сохранить");return;}
            if(!candidate.equals(first[0])){first[0]=null;step[0]=1;ui.prompt("Новый PIN","Только 4 цифры","Далее");ui.error("PIN не совпали. Введите новый код");return;}
            final String value=first[0];first[0]=null;ui.busy("Сохранение…");
            pinWorker.execute(()->{boolean saved=false;try{byte[] salt=new byte[16];new SecureRandom().nextBytes(salt);saved=prefs.edit().putString("pin_salt",Base64.encodeToString(salt,Base64.NO_WRAP)).putString("pin_hash",Base64.encodeToString(derive(value,salt),Base64.NO_WRAP)).commit();}catch(Exception ignored){}final boolean ok=saved;handler.post(()->{if(isFinishing()||!ui.isShowing())return;if(ok){pinAccess.invalidate();ui.dismiss();applyProtection();toast("PIN сохранён");}else{step[0]=1;ui.prompt("Новый PIN","Только 4 цифры","Далее");ui.error("Не удалось сохранить PIN");}});});
        });
        final NumericPinDialog current=pinDialog;current.onDismiss(()->{first[0]=null;if(pinDialog==current)pinDialog=null;});current.show();
    }
    private int uiPx(float size){return Math.round(size*Math.min(getResources().getDisplayMetrics().widthPixels,getResources().getDisplayMetrics().heightPixels)/480f);}
    private GradientDrawable pinSurface(String color,int radius){GradientDrawable shape=new GradientDrawable();shape.setColor(Color.parseColor(color));shape.setCornerRadius(uiPx(radius));return shape;}
    private TextView pinText(String label,int size,String color){TextView text=new TextView(this);text.setText(label);text.setTextSize(TypedValue.COMPLEX_UNIT_PX,uiPx(size));text.setTextColor(Color.parseColor(color));text.setGravity(Gravity.CENTER);text.setIncludeFontPadding(false);return text;}
    private Button pinButton(String label){Button button=new Button(this);button.setAllCaps(false);button.setText(label);button.setTextSize(TypedValue.COMPLEX_UNIT_PX,uiPx(16));button.setTextColor(Color.parseColor("#f1f3f5"));button.setBackground(pinSurface("#26313c",11));button.setPadding(0,0,0,0);button.setMinimumHeight(0);button.setMinHeight(0);button.setStateListAnimator(null);return button;}
    private void pinSettings(){
        if(pinSettingsDialog!=null&&pinSettingsDialog.isShowing())return;
        final boolean parentSession=pinAccess.allows(SystemClock.elapsedRealtime(),true,0);pinAccess.openSession();
        Dialog dialog=new Dialog(this);dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);pinSettingsDialog=dialog;
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(uiPx(16),uiPx(12),uiPx(16),uiPx(12));root.setBackground(pinSurface("#151b23",20));
        TextView title=pinText("PIN и доступ",22,"#f1f3f5");title.setTypeface(Typeface.DEFAULT,Typeface.BOLD);root.addView(title,new LinearLayout.LayoutParams(-1,uiPx(32)));
        root.addView(pinText("Не запрашивать PIN после успешного ввода:",13,"#b4c3d3"),new LinearLayout.LayoutParams(-1,uiPx(24)));
        final int[] values={0,30,60,300,600};final String[] labels={"Запрашивать каждый раз","30 секунд","1 минута","5 минут","10 минут"};final ArrayList<Button> choices=new ArrayList<>();
        Runnable refresh=()->{for(int i=0;i<choices.size();i++){boolean selected=values[i]==pinGraceSeconds();choices.get(i).setText((selected?"●  ":"○  ")+labels[i]);choices.get(i).setTextColor(Color.parseColor(selected?"#f4b679":"#f1f3f5"));}};
        for(int i=0;i<values.length;i++){final int value=values[i];Button choice=pinButton(labels[i]);choices.add(choice);LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,uiPx(40));params.topMargin=uiPx(6);root.addView(choice,params);choice.setOnClickListener(v->{prefs.edit().putInt("pin_grace_seconds",value).apply();refresh.run();stateChanged();});}
        refresh.run();Button change=pinButton("Изменить PIN");LinearLayout.LayoutParams changeParams=new LinearLayout.LayoutParams(-1,uiPx(46));changeParams.topMargin=uiPx(12);root.addView(change,changeParams);change.setOnClickListener(v->{dialog.dismiss();changePin(true);});
        Button done=pinButton("Готово");LinearLayout.LayoutParams doneParams=new LinearLayout.LayoutParams(-1,uiPx(42));doneParams.topMargin=uiPx(8);root.addView(done,doneParams);done.setOnClickListener(v->dialog.dismiss());
        dialog.setContentView(root);dialog.setCanceledOnTouchOutside(false);dialog.setOnDismissListener(d->{pinSettingsDialog=null;if(!parentSession)endSession();});dialog.show();
        if(dialog.getWindow()!=null){dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));dialog.getWindow().setLayout(uiPx(448),WindowManager.LayoutParams.WRAP_CONTENT);dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM|WindowManager.LayoutParams.FLAG_DIM_BEHIND);dialog.getWindow().setDimAmount(.7f);dialog.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);}
    }
    private void nativeMenu() {
        pinAccess.openSession();
        String[] choices={"Обновить интерфейс","PIN и доступ","Настройки Android","Адрес панели","Выйти из киоска"};
        AlertDialog menu=new AlertDialog.Builder(this).setTitle("Служебное меню").setItems(choices,(d,index)->{
            if(index==0)browser.reload();
            if(index==1)pinSettings();
            if(index==2){if(isInLockTask())stopLockTask();startActivity(new Intent(Settings.ACTION_SETTINGS));}
            if(index==3)editUrl(false);
            if(index==4)leaveKiosk();
        }).setNegativeButton("Назад",null).create();
        menu.setOnDismissListener(d->endSession());menu.show();
    }
    private void editUrl(boolean firstRun) {
        EditText field=new EditText(this);field.setSingleLine(true);field.setText(startUrl());
        field.setHint("https://homeassistant.local:8123/…");field.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);
        AlertDialog.Builder builder=new AlertDialog.Builder(this).setTitle(firstRun?"Первый запуск · адрес панели":"Адрес панели Home Assistant").setView(fields(field)).setPositiveButton("Открыть",null);
        if(!firstRun)builder.setNegativeButton("Отмена",null);
        AlertDialog dialog=builder.create();dialog.setCancelable(!firstRun);dialog.setCanceledOnTouchOutside(false);
        dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{String url=PanelUrl.normalize(field.getText().toString());if(url==null){field.setError("Укажите http:// или https:// без логина и пароля в адресе");return;}prefs.edit().putString("start_url",url).apply();trustedPage=false;browser.loadUrl(url);dialog.dismiss();if(!hasPin())handler.postDelayed(this::setupPin,300);}));dialog.show();
    }
    private void leaveKiosk() {
        prefs.edit().putBoolean("child_lock",false).apply();applyProtection();
        Intent home=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ComponentName systemHome=systemHome();
        if(systemHome!=null) {
            home.setComponent(systemHome);
            if(owner())setPreferredHome(systemHome);
        }
        startActivity(home);finish();
    }
    private ComponentName systemHome() {
        Intent home=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for(ResolveInfo candidate:getPackageManager().queryIntentActivities(home,0)) {
            if(!getPackageName().equals(candidate.activityInfo.packageName) && (candidate.activityInfo.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM)!=0) {
                return new ComponentName(candidate.activityInfo.packageName,candidate.activityInfo.name);
            }
        }
        return null;
    }
    private void setPreferredHome(ComponentName target) {
        policy.clearPackagePersistentPreferredActivities(admin,getPackageName());
        ComponentName original=systemHome();
        if(original!=null)policy.clearPackagePersistentPreferredActivities(admin,original.getPackageName());
        IntentFilter filter=new IntentFilter(Intent.ACTION_MAIN);filter.addCategory(Intent.CATEGORY_HOME);filter.addCategory(Intent.CATEGORY_DEFAULT);
        policy.addPersistentPreferredActivity(admin,filter,target);
    }
    private final class Bridge {
        @JavascriptInterface public String getState() {try{int mode=((android.app.ActivityManager)getSystemService(ACTIVITY_SERVICE)).getLockTaskModeState();return new JSONObject().put("owner",owner()).put("locked",locked() && mode==android.app.ActivityManager.LOCK_TASK_MODE_LOCKED).put("lockTaskMode",mode).put("hasPin",hasPin()).put("pinUiVersion",2).put("pinGraceSeconds",pinGraceSeconds()).put("pinGraceLabel",graceLabel()).toString();}catch(Exception e){return "{}";} }
        @JavascriptInterface public void requestSettings() {runOnUiThread(()->{if(trustedPage)withAuth(MainActivity.this::webSettings);});}
        @JavascriptInterface public void openPinSettings() {runOnUiThread(()->{if(trustedPage)withAuth(MainActivity.this::pinSettings);});}
        @JavascriptInterface public void setChildLock(boolean enabled) {runOnUiThread(()->{if(!trustedPage)return;if(!owner()){toast("Режим владельца устройства не настроен");return;}Runnable apply=()->{prefs.edit().putBoolean("child_lock",enabled).apply();applyProtection();};if(enabled)apply.run();else withAuth(apply);});}
        @JavascriptInterface public void exitKiosk() {runOnUiThread(()->{if(trustedPage)withAuth(MainActivity.this::leaveKiosk);});}
        @JavascriptInterface public void endAdminSession() {runOnUiThread(MainActivity.this::endSession);}
        @JavascriptInterface public void setBrightness(double value) {runOnUiThread(()->{if(trustedPage&&Double.isFinite(value))setBrightnessValue((float)value);});}
    }
}
