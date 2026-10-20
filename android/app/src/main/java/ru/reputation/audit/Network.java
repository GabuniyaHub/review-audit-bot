package ru.reputation.audit;

import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class Network {
  private volatile HttpsURLConnection active;
  private volatile boolean cancelled;
  void reset() { cancelled = false; }
  void cancel() { cancelled = true; HttpsURLConnection connection = active; if (connection != null) connection.disconnect(); }
  String request(String address, JSONObject body, String key) throws Exception {
    if (cancelled) throw new Exception("Операция отменена.");
    URL url = new URL(address);
    if (!"https".equals(url.getProtocol())) throw new Exception("Разрешён только HTTPS.");
    String host = url.getHost();
    if (!host.equals("openrouter.ai") && !host.equals("yandex.ru") && !host.equals("2gis.ru")) throw new Exception("Неизвестный источник.");
    HttpsURLConnection connection = (HttpsURLConnection) url.openConnection(); active = connection;
    connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(120000);
    connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36");
    connection.setRequestProperty("Accept-Language", "ru-RU,ru;q=0.9");
    if (body != null) {
      connection.setRequestMethod("POST"); connection.setDoOutput(true);
      connection.setRequestProperty("Authorization", "Bearer " + key);
      connection.setRequestProperty("Content-Type", "application/json");
      byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(bytes.length);
      try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
    }
    try {
      int code = connection.getResponseCode();
      if (code != 200) {
        if (code == 401) throw new Exception("Ключ OpenRouter не принят (401). Проверьте ключ в настройках.");
        if (code == 403) throw new Exception("Доступ запрещён (403). Возможна блокировка сети, региона или площадки.");
        if (code == 429) throw new Exception("Лимит запросов (429). Подождите несколько минут и продолжите анализ.");
        if (code == 404 && host.equals("openrouter.ai")) throw new Exception("Выбранная модель недоступна у провайдера (404). Это не обязательно ошибка ключа. Повторите позже; без сети доступен локальный алгоритм.");
        if (code >= 300 && code < 400) throw new Exception("Площадка перенаправила запрос: возможна CAPTCHA. Используйте импорт отзывов.");
        throw new Exception("Сервис ответил HTTP " + code + ". Попробуйте позже.");
      }
      try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
        byte[] buffer = new byte[8192]; int read;
        while ((read = input.read(buffer)) != -1) {
          if (cancelled) throw new Exception("Операция отменена.");
          if (output.size() + read > 8_000_000) throw new Exception("Ответ площадки слишком большой.");
          output.write(buffer, 0, read);
        }
        return output.toString("UTF-8");
      }
    } finally { connection.disconnect(); active = null; }
  }
}
