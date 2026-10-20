package ru.reputation.audit;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;

final class Store extends SQLiteOpenHelper {
  Store(Context context) { super(context, "reputation.db", null, 1); }
  @Override public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE config (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    db.execSQL("CREATE TABLE reviews (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
    db.execSQL("CREATE TABLE reports (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  }
  @Override public void onUpgrade(SQLiteDatabase db, int from, int to) {}
  synchronized JSONObject load() throws Exception {
    SQLiteDatabase db = getReadableDatabase();
    JSONObject state = new JSONObject().put("companies", new JSONArray()).put("events", new JSONArray()).put("engine", "openrouter");
    try (Cursor cursor = db.rawQuery("SELECT body FROM config WHERE id=1", null)) { if (cursor.moveToFirst()) state = new JSONObject(cursor.getString(0)); }
    for (String table : new String[]{"reviews", "reports"}) {
      JSONArray rows = new JSONArray();
      try (Cursor cursor = db.rawQuery("SELECT body FROM " + table + " ORDER BY rowid", null)) { while (cursor.moveToNext()) rows.put(new JSONObject(cursor.getString(0))); }
      state.put(table, rows);
    }
    return state;
  }
  synchronized void save(JSONObject state) throws Exception {
    SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
    try {
      JSONObject config = new JSONObject(state.toString()); config.remove("reviews"); config.remove("reports"); config.remove("keyConfigured");
      ContentValues values = new ContentValues(); values.put("id", 1); values.put("body", config.toString()); db.insertWithOnConflict("config", null, values, SQLiteDatabase.CONFLICT_REPLACE);
      for (String table : new String[]{"reviews", "reports"}) {
        db.delete(table, null, null);
        JSONArray rows = state.optJSONArray(table);
        if (rows == null) continue;
        for (int i=0; i<rows.length(); i++) {
          JSONObject row = rows.getJSONObject(i);
          ContentValues record = new ContentValues(); record.put("id", row.getString("id")); record.put("body", row.toString());
          db.insertOrThrow(table, null, record);
        }
      }
      db.setTransactionSuccessful();
    } finally { db.endTransaction(); }
  }
}
