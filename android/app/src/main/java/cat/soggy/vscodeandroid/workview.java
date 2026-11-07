package cat.soggy.vscodeandroid;

import android.content.Context;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.webkit.WebView;

/*//////////////////////////////////////////////////////////////////////*/

public class workview extends WebView {
    public workview(Context context) {super(context);}

    @Override
    public InputConnection onCreateInputConnection(EditorInfo info) {
        InputConnection connection = super.onCreateInputConnection(info);
        info.imeOptions |= EditorInfo.IME_FLAG_NO_EXTRACT_UI | EditorInfo.IME_FLAG_NO_FULLSCREEN;
        return connection;
    }
}
