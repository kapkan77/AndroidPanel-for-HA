package local.home.hmi;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;

/** A numeric keypad drawn by the kiosk. It contains no editable text field or IME. */
final class NumericPinDialog {
    interface Listener {void submit(String candidate, NumericPinDialog dialog);}
    private final Activity activity;
    private final Dialog dialog;
    private final float scale;
    private final boolean cancellable;
    private final Listener listener;
    private final StringBuilder digits=new StringBuilder();
    private final ArrayList<Button> keys=new ArrayList<>();
    private final TextView title, hint, dots, status;
    private final Button submit, cancel;
    private boolean busy;
    private Runnable onDismiss;

    NumericPinDialog(Activity activity, String heading, String helper, String action, boolean canCancel, Listener listener) {
        this.activity=activity;this.listener=listener;this.cancellable=canCancel;
        scale=Math.min(activity.getResources().getDisplayMetrics().widthPixels,activity.getResources().getDisplayMetrics().heightPixels)/480f;
        dialog=new Dialog(activity);dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(px(14),px(10),px(14),px(10));root.setBackground(surface("#151b23",20));
        title=text(20,"#f1f3f5");title.setTypeface(Typeface.DEFAULT,Typeface.BOLD);root.addView(title,new LinearLayout.LayoutParams(-1,px(26)));
        hint=text(13,"#b4c3d3");root.addView(hint,new LinearLayout.LayoutParams(-1,px(18)));
        dots=text(28,"#f4b679");dots.setLetterSpacing(.18f);root.addView(dots,new LinearLayout.LayoutParams(-1,px(30)));
        status=text(12,"#ffb8ac");status.setSingleLine(true);root.addView(status,new LinearLayout.LayoutParams(-1,px(20)));
        String[] labels={"1","2","3","4","5","6","7","8","9","C","0","⌫"};
        for(int row=0;row<4;row++) {
            LinearLayout line=new LinearLayout(activity);line.setOrientation(LinearLayout.HORIZONTAL);
            LinearLayout.LayoutParams rowParams=new LinearLayout.LayoutParams(-1,px(44));if(row>0)rowParams.topMargin=px(6);root.addView(line,rowParams);
            for(int col=0;col<3;col++) {
                final String value=labels[row*3+col];Button key=button(value,22,false);key.setContentDescription(value.equals("C")?"Очистить код":value.equals("⌫")?"Удалить цифру":value);
                LinearLayout.LayoutParams keyParams=new LinearLayout.LayoutParams(0,-1,1);if(col>0)keyParams.leftMargin=px(6);line.addView(key,keyParams);keys.add(key);key.setOnClickListener(v->press(value));
            }
        }
        LinearLayout footer=new LinearLayout(activity);footer.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams footerParams=new LinearLayout.LayoutParams(-1,px(42));footerParams.topMargin=px(8);root.addView(footer,footerParams);
        cancel=button("Отмена",16,false);cancel.setEnabled(canCancel);cancel.setOnClickListener(v->dialog.cancel());footer.addView(cancel,new LinearLayout.LayoutParams(0,-1,1));
        submit=button(action,16,true);LinearLayout.LayoutParams submitParams=new LinearLayout.LayoutParams(0,-1,1);submitParams.leftMargin=px(6);footer.addView(submit,submitParams);submit.setOnClickListener(v->submit());
        dialog.setContentView(root);dialog.setCancelable(canCancel);dialog.setCanceledOnTouchOutside(false);
        dialog.setOnDismissListener(d->{digits.setLength(0);if(onDismiss!=null)onDismiss.run();});
        dialog.setOnKeyListener((d,code,event)->{
            if(code==KeyEvent.KEYCODE_BACK){if(event.getAction()==KeyEvent.ACTION_UP && cancellable && !busy)dialog.cancel();return true;}
            if(event.getAction()!=KeyEvent.ACTION_UP)return true;
            if(code>=KeyEvent.KEYCODE_0 && code<=KeyEvent.KEYCODE_9)press(String.valueOf(code-KeyEvent.KEYCODE_0));
            else if(code>=KeyEvent.KEYCODE_NUMPAD_0 && code<=KeyEvent.KEYCODE_NUMPAD_9)press(String.valueOf(code-KeyEvent.KEYCODE_NUMPAD_0));
            else if(code==KeyEvent.KEYCODE_DEL)press("⌫");else if(code==KeyEvent.KEYCODE_ENTER || code==KeyEvent.KEYCODE_NUMPAD_ENTER)submit();
            return true;
        });
        prompt(heading,helper,action);
    }
    private int px(float value){return Math.round(value*scale);}
    private GradientDrawable surface(String color,float radius){GradientDrawable shape=new GradientDrawable();shape.setColor(Color.parseColor(color));shape.setCornerRadius(px(radius));return shape;}
    private TextView text(float size,String color){TextView view=new TextView(activity);view.setTextSize(TypedValue.COMPLEX_UNIT_PX,px(size));view.setTextColor(Color.parseColor(color));view.setGravity(Gravity.CENTER);view.setIncludeFontPadding(false);return view;}
    private Button button(String label,float size,boolean primary){Button button=new Button(activity);button.setAllCaps(false);button.setText(label);button.setTextSize(TypedValue.COMPLEX_UNIT_PX,px(size));button.setTextColor(Color.parseColor(primary?"#211b14":"#f1f3f5"));button.setBackground(surface(primary?"#f4b679":"#26313c",11));button.setMinimumHeight(0);button.setMinHeight(0);button.setMinimumWidth(0);button.setMinWidth(0);button.setPadding(0,0,0,0);button.setStateListAnimator(null);return button;}
    void show(){dialog.show();Window window=dialog.getWindow();if(window!=null){window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));window.setLayout(px(448),WindowManager.LayoutParams.WRAP_CONTENT);window.addFlags(WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM|WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);window.setDimAmount(.7f);window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);}}
    void prompt(String heading,String helper,String action){busy=false;digits.setLength(0);title.setText(heading);hint.setText(helper);submit.setText(action);status.setText("");render();}
    void error(String message){busy=false;digits.setLength(0);status.setText(message);render();}
    void busy(String message){busy=true;status.setText(message);render();}
    void onDismiss(Runnable action){onDismiss=action;}
    boolean isShowing(){return dialog.isShowing();}
    void dismiss(){digits.setLength(0);dialog.dismiss();}
    private void render(){StringBuilder masked=new StringBuilder();int count=PinAccess.PIN_LENGTH;for(int i=0;i<count;i++){if(i>0)masked.append(' ');masked.append(i<digits.length()?'●':'○');}dots.setText(masked);dots.setContentDescription("Введено цифр: "+digits.length());for(Button key:keys){String value=key.getText().toString();key.setEnabled(!busy&&(digits.length()<PinAccess.PIN_LENGTH||value.equals("C")||value.equals("⌫")));key.setAlpha(key.isEnabled()?1f:.4f);}cancel.setEnabled(cancellable&&!busy);cancel.setAlpha(cancel.isEnabled()?1f:.4f);submit.setEnabled(!busy&&PinAccess.validPin(digits.toString()));submit.setAlpha(submit.isEnabled()?1f:.4f);dialog.setCancelable(cancellable&&!busy);}
    private void press(String value){if(busy)return;if(value.equals("C"))digits.setLength(0);else if(value.equals("⌫")){if(digits.length()>0)digits.deleteCharAt(digits.length()-1);}else if(value.length()==1&&value.charAt(0)>='0'&&value.charAt(0)<='9'&&digits.length()<PinAccess.PIN_LENGTH)digits.append(value);status.setText("");render();}
    private void submit(){if(busy||!PinAccess.validPin(digits.toString()))return;String candidate=digits.toString();digits.setLength(0);render();listener.submit(candidate,this);}
}
