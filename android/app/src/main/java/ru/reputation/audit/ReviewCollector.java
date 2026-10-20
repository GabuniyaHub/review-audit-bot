package ru.reputation.audit;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Iterator;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

final class ReviewCollector {
  private final Network network;
  ReviewCollector(Network network) { this.network = network; }
  JSONArray collect(String provider, String id) throws Exception {
    if (!id.matches("[0-9]{1,20}")) throw new Exception("Нужна ссылка на конкретную карточку организации.");
    if (provider.equals("2gis")) {
      String html = network.request("https://2gis.ru/tyumen/firm/" + id + "/tab/reviews", null, null);
      if (html.toLowerCase().contains("captcha") || html.contains("Подтвердите, что вы")) throw new Exception("2ГИС запросил CAPTCHA. Используйте импорт JSON; автоматического обхода нет.");
      throw new Exception("Публичная страница 2ГИС не предоставляет надёжную выгрузку на телефоне. Используйте импорт JSON.");
    }
    String html = network.request("https://yandex.ru/maps/org/" + id + "/reviews/?sort_by=by_time", null, null);
    if (html.contains("showcaptcha") || html.contains("CheckboxCaptcha")) throw new Exception("Яндекс запросил CAPTCHA. Попробуйте другую сеть или импортируйте отзывы.");
    Pattern pattern = Pattern.compile("<script\\b([^>]*)>([\\s\\S]*?)</script>", Pattern.CASE_INSENSITIVE);
    Matcher matcher = pattern.matcher(html); JSONObject card = null;
    while (matcher.find()) {
      if (!matcher.group(1).contains("state-view") || !matcher.group(1).contains("application/json")) continue;
      try { card = find(new JSONObject(matcher.group(2)), id, 0); if (card != null) break; } catch (Exception ignored) {}
    }
    if (card == null) throw new Exception("Разметка Яндекса недоступна или изменилась. Можно импортировать JSON.");
    JSONArray rows = card.getJSONObject("reviewResults").getJSONArray("reviews");
    if (rows.length() == 0 && card.optJSONObject("ratingData") != null && card.getJSONObject("ratingData").optInt("reviewCount") > 0) throw new Exception("Отзывы есть, но страница не отдала их. Используйте импорт.");
    JSONArray result = new JSONArray();
    for (int i=0; i<rows.length(); i++) {
      JSONObject row = rows.getJSONObject(i);
      if (row.has("businessId") && !id.equals(row.optString("businessId"))) throw new Exception("Площадка вернула отзывы другого филиала.");
      String text = row.optString("text", "").trim(); if (text.isEmpty()) continue;
      result.put(new JSONObject().put("externalId",row.optString("reviewId"))
        .put("text",text).put("rating",row.opt("rating")).put("source","yandex")
        .put("url",row.optString("url", "https://yandex.ru/maps/org/"+id+"/reviews/"))
        .put("publishedAt",JSONObject.NULL).put("rawDate",row.optString("updatedTime")));
    }
    return result;
  }
  private JSONObject find(Object value, String id, int depth) throws Exception {
    if (depth > 60) return null;
    if (value instanceof JSONObject) {
      JSONObject record = (JSONObject)value;
      if (id.equals(record.optString("id")) && record.has("reviewResults")) return record;
      Iterator<String> keys = record.keys();
      while (keys.hasNext()) { JSONObject found = find(record.opt(keys.next()), id, depth+1); if (found != null) return found; }
    } else if (value instanceof JSONArray) {
      JSONArray array=(JSONArray)value; for (int i=0; i<array.length(); i++) { JSONObject found=find(array.opt(i),id,depth+1); if (found!=null) return found; }
    }
    return null;
  }
}
