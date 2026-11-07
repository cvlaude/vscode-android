package cat.soggy.vscodeandroid;

import android.webkit.JavascriptInterface;

/*//////////////////////////////////////////////////////////////////////*/

public class displaybridge {
    private final mainactivity activity;

    public displaybridge(mainactivity value) {
        activity = value;
    }

    @JavascriptInterface
    public void setscale(int value) {
        activity.changescale(value);
    }

    @JavascriptInterface
    public int getscale() {
        return activity.displayscale();
    }

    @JavascriptInterface
    public String getgeometry() {
        return activity.displaygeometry();
    }
}
