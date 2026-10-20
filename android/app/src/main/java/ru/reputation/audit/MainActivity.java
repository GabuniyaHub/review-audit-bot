package ru.reputation.audit;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.graphics.Color;
import android.view.View;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public class MainActivity extends Activity {
  private static final String ORIGIN = "https://appassets.androidplatform.net/";
  private WebView web;
  private Store store;
  private SharedPreferences preferences;
  private final Network network = new Network();
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private String pendingImport, pendingExport, exportText;

  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved);
    store = new Store(this); preferences = getSharedPreferences("settings", MODE_PRIVATE);
    getWindow().setStatusBarColor(Color.rgb(245,247,250)); getWindow().setNavigationBarColor(Color.WHITE);
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    FrameLayout root = new FrameLayout(this); root.setBackgroundColor(Color.rgb(245,247,250));
    if (Build.VERSION.SDK_INT >= 30) {
      getWindow().setDecorFitsSystemWindows(false);
      root.setOnApplyWindowInsetsListener((view, insets) -> {
        android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
        view.setPadding(bars.left,bars.top,bars.right,bars.bottom); return WindowInsets.CONSUMED;
      });
    }
    web = new WebView(this); root.addView(web,new FrameLayout.LayoutParams(-1,-1)); setContentView(root);
    WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setSupportMultipleWindows(false); settings.setDefaultTextEncodingName("UTF-8");
    web.setBackgroundColor(Color.rgb(245,247,250));
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !request.getUrl().toString().startsWith(ORIGIN); }
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String address = request.getUrl().toString();
        if (!address.startsWith(ORIGIN)) return new WebResourceResponse("text/plain","UTF-8",null);
        String file = request.getUrl().getPath();
        if (file == null || file.equals("/")) file = "/index.html";
        if (file.contains("..") || !file.matches("/[a-zA-Z0-9_./-]+")) return new WebResourceResponse("text/plain","UTF-8",null);
        String mime=file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":file.endsWith(".json")?"application/json":"text/html";
        try { return new WebResourceResponse(mime,"UTF-8",getAssets().open(file.substring(1))); }
        catch (Exception error) { return new WebResourceResponse("text/plain","UTF-8",null); }
      }
    });
    web.addJavascriptInterface(new Bridge(),"Android"); web.loadUrl(ORIGIN);
  }
  private String key() { return preferences.getString("openrouterKey", BuildSecrets.OPENROUTER_KEY); }
  private void complete(String id, Object data, String error) {
    try {
      JSONObject response = new JSONObject().put("id",id).put("data",data == null ? JSONObject.NULL : data).put("error",error == null ? JSONObject.NULL : error);
      String script="window.Native.receive("+response.toString()+")";
      runOnUiThread(() -> { if (web != null) web.evaluateJavascript(script,null); });
    } catch (Exception ignored) {}
  }
  final class Bridge {
    @JavascriptInterface public void invoke(String id, String command, String payload) {
      if (id.length()>80 || payload.length()>10_000_000) { complete(id,null,"Запрос слишком большой."); return; }
      if (command.equals("cancel")) { network.cancel(); complete(id,true,null); return; }
      executor.execute(() -> {
        try {
          JSONObject data = new JSONObject(payload);
          Object result = true;
          switch(command) {
            case "load": result=store.load().put("keyConfigured",!key().isEmpty()); break;
            case "save": store.save(data); break;
            case "analyze": network.reset(); result=new OpenRouterClient(network).analyze(data.getJSONArray("reviews"),key(),data.optString("model",OpenRouterClient.MODEL)); break;
            case "collect": network.reset(); result=new ReviewCollector(network).collect(data.getString("provider"),data.getString("externalId")); break;
            case "setKey":
              String entered=data.getString("key").trim();
              if (!entered.isEmpty() && !entered.matches("sk-or-v1-[a-zA-Z0-9_-]+")) throw new Exception("Неверный формат ключа.");
              preferences.edit().putString("openrouterKey",entered).apply(); result=!entered.isEmpty(); break;
            case "import":
              runOnUiThread(() -> {
                pendingImport=id;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(intent,100); } catch (Exception error) { pendingImport=null; complete(id,null,"Не удалось открыть выбор файла."); }
              }); return;
            case "export":
              String filename=data.getString("filename"); exportText=data.getString("text");
              runOnUiThread(() -> {
                pendingExport=id;
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(filename.endsWith(".json")?"application/json":"text/markdown").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,filename);
                try { startActivityForResult(intent,101); } catch (Exception error) { pendingExport=null; exportText=null; complete(id,null,"Не удалось открыть сохранение файла."); }
              }); return;
            case "open":
              String address=data.getString("url"); Uri uri=Uri.parse(address); String host=uri.getHost();
              if (!"https".equals(uri.getScheme()) || host==null || !(host.equals("yandex.ru")||host.endsWith(".yandex.ru")||host.equals("yandex.com")||host.equals("2gis.ru")||host.equals("openrouter.ai"))) throw new Exception("Ссылка не разрешена.");
              runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); } catch (Exception ignored) {} }); break;
            default: throw new Exception("Неизвестная команда.");
          }
          complete(id,result,null);
        } catch (Exception error) {
          String message=error.getMessage();
          if (error instanceof java.net.SocketTimeoutException) message="Сервис не ответил вовремя. Сохранённые данные не потеряны; попробуйте продолжить позже.";
          else if (error instanceof java.io.IOException) message="Нет соединения с площадкой. Проверьте интернет и доступ к OpenRouter из вашей сети.";
          complete(id,null,message==null?"Не удалось выполнить операцию.":message);
        }
      });
    }
  }
  @Override protected void onActivityResult(int request, int result, Intent intent) {
    super.onActivityResult(request,result,intent);
    if (request==100) {
      String id=pendingImport; pendingImport=null;
      if (id==null) return;
      if (result!=RESULT_OK || intent==null || intent.getData()==null) { complete(id,null,"Выбор файла отменён."); return; }
      Uri uri=intent.getData();
      executor.execute(() -> {
        try (InputStream input=getContentResolver().openInputStream(uri); ByteArrayOutputStream output=new ByteArrayOutputStream()) {
          byte[] bytes=new byte[8192]; int read;
          while((read=input.read(bytes))!=-1) { if(output.size()+read>5_000_000) throw new Exception("Файл больше 5 МБ."); output.write(bytes,0,read); }
          complete(id,output.toString("UTF-8"),null);
        } catch (Exception error) { complete(id,null,"Не удалось прочитать файл: "+error.getMessage()); }
      });
    } else if (request==101) {
      String id=pendingExport, text=exportText; pendingExport=null; exportText=null;
      if (id==null) return;
      if (result!=RESULT_OK || intent==null || intent.getData()==null) { complete(id,null,"Сохранение отменено."); return; }
      Uri uri=intent.getData();
      executor.execute(() -> {
        try (OutputStream output=getContentResolver().openOutputStream(uri,"wt")) { output.write(text.getBytes(StandardCharsets.UTF_8)); complete(id,true,null); }
        catch (Exception error) { complete(id,null,"Не удалось сохранить файл."); }
      });
    }
  }
  @Override public void onBackPressed() { if (web!=null) web.evaluateJavascript("window.App && App.back()",null); else super.onBackPressed(); }
  @Override protected void onDestroy() { network.cancel(); executor.shutdown(); if(web!=null) { web.removeJavascriptInterface("Android"); web.destroy(); web=null; } store.close(); super.onDestroy(); }
}
