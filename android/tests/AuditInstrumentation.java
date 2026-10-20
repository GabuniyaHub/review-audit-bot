package ru.reputation.audit;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import android.graphics.Bitmap;
import org.json.JSONObject;
import org.json.JSONArray;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;

public class AuditInstrumentation extends Instrumentation {
  private Activity activity;
  private WebView web;
  private boolean liveLlm = true;
  private String evaluation(String script) throws Exception {
    CountDownLatch latch=new CountDownLatch(1); String[] result={null};
    runOnMainSync(() -> web.evaluateJavascript(script,value -> { result[0]=value; latch.countDown(); }));
    if (!latch.await(15,TimeUnit.SECONDS)) throw new Exception("JavaScript evaluation timed out");
    return result[0];
  }
  private void until(String script,String expected) throws Exception {
    for(int i=0;i<800;i++) { if(expected.equals(evaluation(script))) return; Thread.sleep(150); }
    throw new Exception("Condition failed: "+script+" / "+evaluation(script));
  }
  private void screenshot(String name) throws Exception {
    Thread.sleep(500);
    Bitmap image=getUiAutomation().takeScreenshot();
    File directory=getTargetContext().getExternalFilesDir(null);
    try(FileOutputStream output=new FileOutputStream(new File(directory,name))) { image.compress(Bitmap.CompressFormat.PNG,100,output); }
  }
  @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); liveLlm = arguments == null || !"false".equals(arguments.getString("live", "true")); start(); }
  @Override public void onStart() {
    Bundle results=new Bundle();
    try {
      Store database=new Store(getTargetContext());
      database.save(new JSONObject().put("companies",new JSONArray()).put("reviews",new JSONArray()).put("reports",new JSONArray()).put("events",new JSONArray()).put("engine","local")); database.close();
      Intent intent=new Intent(Intent.ACTION_MAIN).setClassName("ru.reputation.audit","ru.reputation.audit.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      activity=startActivitySync(intent); Field field=MainActivity.class.getDeclaredField("web"); field.setAccessible(true); web=(WebView)field.get(activity);
      until("typeof window.App === 'object' && !!document.querySelector('[data-action=demo]')","true");
      screenshot("01-welcome.png");
      evaluation("document.querySelector('[data-action=demo]').click()");
      until("document.body.innerText.includes('512') && !!document.querySelector('[data-action=analyze]')","true");
      evaluation("document.querySelector('[data-action=analyze]').click()");
      until("document.body.innerText.includes('512 из 512') && document.querySelector('#task').hidden","true");
      screenshot("02-dashboard.png");
      evaluation("document.querySelector('[data-action=create-report]').click()");
      until("!!document.querySelector('.report-summary')","true");
      screenshot("03-report.png");
      evaluation("window.testResult=null; Native.call('load').then(state=>window.testResult=JSON.stringify({reviews:state.reviews.length,reports:state.reports.length,analyzed:state.reviews.filter(r=>r.analysis).length,key:state.keyConfigured}))");
      until("window.testResult !== null","true");
      String encoded=evaluation("window.testResult"); String decoded=(String)new JSONArray("["+encoded+"]").get(0);
      JSONObject stored=new JSONObject(decoded);
      if(stored.getInt("reviews")!=512 || stored.getInt("analyzed")!=512 || stored.getInt("reports")!=1 || (liveLlm && !stored.getBoolean("key"))) throw new Exception("SQLite persistence mismatch: "+stored);
      // Reopen the activity and confirm that SQLite data survives a fresh WebView.
      runOnMainSync(()->activity.finish());
      activity=startActivitySync(intent); web=(WebView)field.get(activity);
      until("document.body.innerText.includes('512 из 512')","true");
      evaluation("document.querySelector('[data-page=companies]').click()");
      until("document.querySelectorAll('.company-card').length === 4","true");
      screenshot("04-companies.png");
      evaluation("document.querySelector('[data-page=reviews]').click()");
      until("document.querySelectorAll('.review-card').length === 30","true");
      screenshot("05-reviews.png");
      evaluation("document.querySelector('[data-page=settings]').click()");
      until("!!document.querySelector('#model-choice')","true");
      evaluation("var select=document.querySelector('#model-choice');select.value='nvidia/nemotron-3.5-lightning:free';select.dispatchEvent(new Event('change',{bubbles:true}))");
      until("document.querySelector('.model-name').innerText === 'nvidia/nemotron-3.5-lightning:free'","true");
      if (liveLlm) {
        evaluation("document.querySelector('[data-action=test-llm]').click()");
        until("document.querySelector('#task').hidden && document.querySelector('#toast').innerText.includes('ИИ работает')","true");
      }
      screenshot("06-settings.png");
      File exported=new File(getTargetContext().getCacheDir(),"export-test.md");
      IntentFilter exportFilter=new IntentFilter(Intent.ACTION_CREATE_DOCUMENT); exportFilter.addCategory(Intent.CATEGORY_OPENABLE); exportFilter.addDataType("*/*");
      ActivityMonitor exportMonitor=addMonitor(exportFilter,new ActivityResult(Activity.RESULT_OK,new Intent().setData(Uri.fromFile(exported))),true);
      evaluation("window.exportTest=null; Native.call('export',{filename:'test.md',text:'# Проверка отчёта\\nЦитата из отзыва.'}).then(()=>window.exportTest=true).catch(e=>window.exportTest=e.message)");
      until("window.exportTest === true","true"); removeMonitor(exportMonitor);
      String exportedText=new String(Files.readAllBytes(exported.toPath()),"UTF-8");
      if(!exportedText.equals("# Проверка отчёта\nЦитата из отзыва.")) throw new Exception("Export encoding mismatch");
      File imported=new File(getTargetContext().getCacheDir(),"import-test.json");
      try(FileOutputStream output=new FileOutputStream(imported)) { output.write("{\"reviews\":[{\"text\":\"Импорт: кофе вкусный\",\"rating\":5}]}".getBytes("UTF-8")); }
      IntentFilter importFilter=new IntentFilter(Intent.ACTION_OPEN_DOCUMENT); importFilter.addCategory(Intent.CATEGORY_OPENABLE); importFilter.addDataType("*/*");
      ActivityMonitor importMonitor=addMonitor(importFilter,new ActivityResult(Activity.RESULT_OK,new Intent().setData(Uri.fromFile(imported))),true);
      evaluation("window.importTest=null; Native.call('import').then(text=>window.importTest=JSON.parse(text).reviews[0].text).catch(e=>window.importTest=e.message)");
      until("window.importTest === 'Импорт: кофе вкусный'","true"); removeMonitor(importMonitor);
      results.putString("result","PASS: APK launch, native bridge, 512 review analysis, report, SQLite persistence, activity recreation, four companies, mobile review pagination, selected fallback model, import/export native document callbacks and UTF-8. Live OpenRouter: " + (liveLlm ? "verified" : "not requested (offline CI)"));
      finish(Activity.RESULT_OK,results);
    } catch(Throwable error) {
      results.putString("error",error.getClass().getSimpleName()+": "+error.getMessage());
      try { results.putString("page",evaluation("document.body.innerText.slice(0,2000)")); } catch(Exception ignored) {}
      finish(Activity.RESULT_CANCELED,results);
    }
  }
}
