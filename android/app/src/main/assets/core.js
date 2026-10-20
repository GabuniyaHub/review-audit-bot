(function (root) {
  "use strict";
  const MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
  const MODELS = {
    [MODEL]: "Nemotron 3 Super · исходная",
    "nvidia/nemotron-3.5-lightning:free": "Nemotron 3.5 Lightning · запасная",
  };
  const VERSION = "mobile-ru-v1";
  const TOPICS = {
    product: "Продукт и качество",
    service: "Обслуживание",
    waiting: "Время ожидания",
    price: "Цена",
    atmosphere: "Атмосфера",
    cleanliness: "Чистота",
    accessibility: "Доступность",
    other: "Прочее",
  };
  const SENTIMENTS = {
    positive: "Позитив",
    negative: "Негатив",
    neutral: "Нейтрально",
    mixed: "Смешанно",
  };
  function uid(prefix = "id") {
    return (
      prefix +
      "-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10)
    );
  }
  function clean(text) {
    return String(text || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
  }
  function hash(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++)
      value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return (value >>> 0).toString(16);
  }
  function empty() {
    return {
      schemaVersion: 1,
      id: uid("project"),
      companies: [],
      reviews: [],
      reports: [],
      events: [],
      engine: "openrouter",
      model: MODEL,
      demo: false,
    };
  }
  function redact(text) {
    return text
      .replace(
        /https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu,
        "[скрыто]",
      )
      .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[скрыто]")
      .replace(/@[\p{L}\d_]+/gu, "[скрыто]")
      .replace(/\b[A-Z][a-z]+\b|[А-ЯЁ][а-яё]+/gu, "[скрыто]");
  }
  function cardId(value, source) {
    if (!value) return "";
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Нужна полная HTTPS-ссылка на карточку.");
    }
    const allowed =
      source === "yandex"
        ? ["yandex.ru", "yandex.com", "www.yandex.ru"]
        : ["2gis.ru", "www.2gis.ru"];
    if (
      url.protocol !== "https:" ||
      !allowed.includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error(
        "Неверный домен карточки " +
          (source === "yandex" ? "Яндекса." : "2ГИС."),
      );
    const match =
      source === "yandex"
        ? url.pathname.match(/\/org\/(?:[^/]+\/)?(\d{1,20})(?:\/|$)/)
        : url.pathname.match(/\/firm\/(\d{1,20})(?:\/|$)/);
    if (!match)
      throw new Error(
        "Нужна карточка конкретного филиала, не поиск или короткая ссылка.",
      );
    return match[1];
  }
  function validateCompany(input) {
    const company = {
      id: input.id || uid("company"),
      name: clean(input.name),
      city: clean(input.city),
      address: clean(input.address),
      yandex: String(input.yandex || "").trim(),
      twoGis: String(input.twoGis || "").trim(),
      role: input.role === "own" ? "own" : "competitor",
      confirmed: input.confirmed === true,
    };
    if (
      company.name.length < 2 ||
      company.name.length > 100 ||
      !company.city ||
      company.city.length > 100 ||
      company.address.length > 250
    )
      throw new Error("Укажите название (2–100 символов) и город.");
    cardId(company.yandex, "yandex");
    cardId(company.twoGis, "2gis");
    return company;
  }
  function normalizeReview(value, companies, defaultCompany) {
    if (!value || typeof value !== "object")
      throw new Error("Отзыв должен быть объектом.");
    const companyId = String(value.companyId || defaultCompany || "");
    if (!companies.some((company) => company.id === companyId))
      throw new Error(
        "Компания отзыва не найдена. Выберите компанию для импорта.",
      );
    const text = clean(value.text);
    if (!text || text.length > 12000)
      throw new Error("Текст отзыва должен содержать 1–12000 символов.");
    const source = ["yandex", "2gis", "demo", "import"].includes(value.source)
      ? value.source
      : "import";
    const rawRating =
      value.rating == null || value.rating === "" ? null : Number(value.rating);
    if (
      rawRating !== null &&
      (!Number.isFinite(rawRating) || rawRating < 1 || rawRating > 5)
    )
      throw new Error("Оценка должна быть от 1 до 5 или null.");
    const date = value.publishedAt ? String(value.publishedAt) : null;
    if (
      date &&
      (date.length < 10 ||
        !/^\d{4}-\d{2}-\d{2}/.test(date) ||
        Number.isNaN(Date.parse(date)))
    )
      throw new Error("Неверная дата отзыва; используйте ISO 8601.");
    let url = "";
    if (value.url || value.sourceUrl) {
      try {
        const candidate = new URL(value.url || value.sourceUrl);
        if (
          candidate.protocol === "https:" &&
          !candidate.username &&
          !candidate.password &&
          [
            "yandex.ru",
            "www.yandex.ru",
            "yandex.com",
            "2gis.ru",
            "www.2gis.ru",
          ].includes(candidate.hostname)
        )
          url = candidate.href;
      } catch {}
    }
    const externalId =
      value.externalId == null ? "" : String(value.externalId).slice(0, 150);
    const identity = companyId + "|" + source + "|" + (externalId || text);
    return {
      id: "review-" + hash(identity),
      companyId,
      source,
      externalId,
      identity,
      text,
      rating: rawRating,
      publishedAt: date,
      rawDate: String(value.rawDate || "").slice(0, 100),
      url,
      importedAt: new Date().toISOString(),
      analysis: null,
    };
  }
  function mergeReviews(state, incoming, defaultCompany, maxInput = 2000) {
    if (!Array.isArray(incoming) || incoming.length > maxInput)
      throw new Error("Слишком много отзывов в одном импорте.");
    // Validate the entire input before mutating the current project.
    const normalized = incoming.map((value) =>
      normalizeReview(value, state.companies, defaultCompany),
    );
    const identities = new Set(state.reviews.map((review) => review.identity));
    for (const review of normalized) identities.add(review.identity);
    if (identities.size > 5000)
      throw new Error("В проекте может быть не более 5000 отзывов.");
    let added = 0,
      updated = 0,
      duplicates = 0;
    for (const review of normalized) {
      const previous = state.reviews.find(
        (item) => item.identity === review.identity,
      );
      if (previous) {
        if (
          previous.text === review.text &&
          previous.rating === review.rating &&
          previous.publishedAt === review.publishedAt
        ) {
          duplicates++;
          continue;
        }
        const analysis =
          previous.text === review.text ? previous.analysis : null;
        Object.assign(previous, review, { id: previous.id, analysis });
        updated++;
      } else {
        if (state.reviews.some((item) => item.id === review.id))
          review.id = uid("review");
        state.reviews.push(review);
        added++;
      }
    }
    const seen = new Map();
    for (const review of state.reviews) {
      const key = review.companyId + "|" + review.text.toLocaleLowerCase("ru");
      const previous = seen.get(key);
      review.crossSourceDuplicate =
        !!previous && previous.source !== review.source;
      if (review.crossSourceDuplicate) previous.crossSourceDuplicate = true;
      if (!previous) seen.set(key, review);
    }
    return { added, updated, duplicates };
  }
  function currentAnalysis(review, engine, model = MODEL) {
    const analysis = review.analysis;
    return (
      !!analysis &&
      analysis.text === redact(review.text) &&
      analysis.version === VERSION &&
      analysis.engine === engine &&
      (engine !== "openrouter" || analysis.model === model)
    );
  }
  function validateBatch(results, inputs) {
    if (!Array.isArray(results) || results.length !== inputs.length)
      throw new Error("Неполный ответ модели.");
    const seen = new Set();
    for (const result of results) {
      const input = inputs.find((item) => item.reviewId === result.reviewId);
      if (
        !input ||
        seen.has(result.reviewId) ||
        !Object.hasOwn(SENTIMENTS, result.sentiment) ||
        !Array.isArray(result.topics) ||
        result.topics.length > 8
      )
        throw new Error("Неверный формат анализа.");
      seen.add(result.reviewId);
      const topics = new Set();
      for (const item of result.topics) {
        if (
          !Object.hasOwn(TOPICS, item.topic) ||
          topics.has(item.topic) ||
          !Object.hasOwn(SENTIMENTS, item.sentiment) ||
          typeof item.evidence !== "string" ||
          !item.evidence.trim() ||
          item.evidence.length > 300 ||
          !input.text.includes(item.evidence) ||
          item.evidence === "[скрыто]"
        )
          throw new Error("Цитата анализа не подтверждена текстом.");
        topics.add(item.topic);
      }
    }
    return results;
  }
  function localAnalyze(review) {
    const text = redact(review.text);
    const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
    const rules = {
      product: /кофе|вкус|напит|десерт|еда|булоч|продукт|капучино|латте/i,
      service: /обслуж|персонал|бариста|официант|вежлив|груб|помог|сотрудник/i,
      waiting: /ждал|ждать|ожидан|очеред|быстр|долго|минут|медлен/i,
      price: /цена|цене|дорого|дёшево|дешево|стоимост|скидк/i,
      atmosphere: /атмосфер|уют|музык|интерьер|шум|спокойно/i,
      cleanliness: /чист|гряз|стол|уборк/i,
      accessibility: /вход|пандус|парковк|доступ|коляск/i,
    };
    function sentiment(value) {
      const positive =
        /вкусн|приятн|хорош|отлич|вежлив|понрав|уютн|быстро|чисто|чистый|доступн|спокойно|помог|свеж|справедлив/i.test(
          value,
        );
      const negative =
        /невкус|плох|груб|долго|холодн|гряз|дорого|шумн|не понрав|горьк|тесн|нет пандус|медлен|пересуш|завыш|забыли/i.test(
          value,
        );
      return positive && negative
        ? "mixed"
        : negative
          ? "negative"
          : positive
            ? "positive"
            : "neutral";
    }
    const topics = [];
    for (const [topic, pattern] of Object.entries(rules)) {
      const sentence = sentences.find((part) => pattern.test(part));
      if (sentence)
        topics.push({
          topic,
          sentiment: sentiment(sentence),
          evidence: sentence.trim().slice(0, 300),
        });
    }
    if (!topics.length)
      topics.push({
        topic: "other",
        sentiment: sentiment(text),
        evidence: text.slice(0, 300),
      });
    return { reviewId: review.id, sentiment: sentiment(text), topics };
  }
  function applyBatch(state, results, engine) {
    for (const result of results) {
      const review = state.reviews.find((item) => item.id === result.reviewId);
      if (!review) throw new Error("Отзыв не найден.");
      review.analysis = {
        ...result,
        engine,
        text: redact(review.text),
        model: engine === "openrouter" ? state.model || MODEL : "rules-v1",
        version: VERSION,
        analyzedAt: new Date().toISOString(),
      };
    }
  }
  function stats(state, companyId, period) {
    let reviews = state.reviews.filter(
      (review) => review.companyId === companyId,
    );
    const unknownDates = reviews.filter((review) => !review.publishedAt).length;
    if (period?.from || period?.to)
      reviews = reviews.filter(
        (review) =>
          review.publishedAt &&
          (!period.from || review.publishedAt.slice(0, 10) >= period.from) &&
          (!period.to || review.publishedAt.slice(0, 10) <= period.to),
      );
    const analyzed = reviews.filter((review) =>
      currentAnalysis(review, state.engine, state.model),
    );
    const ratings = reviews.filter((review) => review.rating !== null);
    const sentiment = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    const topics = Object.fromEntries(
      Object.keys(TOPICS).map((topic) => [
        topic,
        {
          total: 0,
          negative: 0,
          positive: 0,
          mixed: 0,
          neutral: 0,
          evidence: [],
        },
      ]),
    );
    for (const review of analyzed) {
      sentiment[review.analysis.sentiment]++;
      for (const topic of review.analysis.topics) {
        const record = topics[topic.topic];
        record.total++;
        record[topic.sentiment]++;
        if (
          record.evidence.filter((item) => item.sentiment === topic.sentiment)
            .length < 3
        )
          record.evidence.push({
            reviewId: review.id,
            quote: topic.evidence,
            sentiment: topic.sentiment,
            url: review.url,
          });
      }
    }
    return {
      total: reviews.length,
      analyzed: analyzed.length,
      average: ratings.length
        ? ratings.reduce((sum, review) => sum + review.rating, 0) /
          ratings.length
        : null,
      positiveShare: analyzed.length
        ? sentiment.positive / analyzed.length
        : null,
      negativeShare: analyzed.length
        ? sentiment.negative / analyzed.length
        : null,
      unknownDates,
      sentiment,
      topics,
      crossSourceDuplicates: reviews.filter(
        (review) => review.crossSourceDuplicate,
      ).length,
    };
  }
  const ACTIONS = {
    product:
      "Проверить повторяющиеся замечания к качеству продукта и провести выборочную проверку заказа.",
    service:
      "Разобрать с командой примеры обслуживания из отзывов и согласовать стандарт общения.",
    waiting:
      "Замерить время выполнения заказа в часы пик и проверить загрузку смены.",
    price:
      "Проверить понятность меню, состава заказа и информации о стоимости.",
    atmosphere:
      "Проверить уровень шума и комфорт посадочных мест в загруженные часы.",
    cleanliness:
      "Проверить график уборки и ответственность за столы и общие зоны.",
    accessibility:
      "Проверить доступность входа и точность информации о парковке и проходе.",
    other:
      "Уточнить контекст повторяющихся замечаний и обсудить их с ответственным сотрудником.",
  };
  function report(state, period = {}) {
    if (!state.companies.some((company) => company.role === "own"))
      throw new Error("Сначала добавьте свою компанию.");
    if (period.from && period.to && period.from > period.to)
      throw new Error("Дата начала позже даты окончания.");
    const entries = state.companies.map((company) => ({
      company: { ...company },
      metrics: stats(state, company.id, period),
    }));
    if (!entries.some((entry) => entry.metrics.analyzed))
      throw new Error(
        "Сначала проанализируйте отзывы в выбранном режиме и периоде.",
      );
    const own = entries.find((entry) => entry.company.role === "own");
    const recommendations = Object.entries(own.metrics.topics)
      .filter(([, metric]) => metric.negative + metric.mixed > 0)
      .sort((a, b) => b[1].negative + b[1].mixed - (a[1].negative + a[1].mixed))
      .slice(0, 5)
      .map(([topic, metric]) => ({
        topic,
        title: TOPICS[topic],
        text: ACTIONS[topic],
        count: metric.negative + metric.mixed,
        evidence: metric.evidence
          .filter((item) => ["negative", "mixed"].includes(item.sentiment))
          .slice(0, 3),
      }));
    const warnings = [
      "Сравнение описывает только собранную выборку, а не всю репутацию компании.",
    ];
    if (state.demo || state.reviews.some((review) => review.source === "demo"))
      warnings.unshift(
        "В отчёте есть вымышленные демонстрационные отзывы. Это не исследование реальных организаций.",
      );
    if (state.engine === "local")
      warnings.push(
        "Применён локальный алгоритм по словарным правилам, а не нейросеть. Возможны ошибки контекста и отрицаний.",
      );
    if (entries.some((entry) => entry.metrics.analyzed < 30))
      warnings.push(
        "У одной или нескольких компаний меньше 30 анализов; численные выводы о превосходстве не делаются.",
      );
    if (entries.some((entry) => entry.metrics.unknownDates))
      warnings.push(
        "Есть отзывы без даты публикации. В отчёт за период они не включаются.",
      );
    if (entries.some((entry) => entry.metrics.analyzed < entry.metrics.total))
      warnings.push(
        "Анализ покрывает не все отзывы. Доли рассчитываются только по проанализированным текстам.",
      );
    if (entries.some((entry) => entry.metrics.crossSourceDuplicates))
      warnings.push(
        "Найдены совпадения между источниками; они помечены и могут влиять на выборку.",
      );
    return {
      id: uid("report"),
      createdAt: new Date().toISOString(),
      period,
      engine: state.engine,
      model: state.engine === "openrouter" ? state.model || MODEL : "rules-v1",
      entries,
      recommendations,
      warnings,
      demo: !!state.demo,
    };
  }
  function markdown(report) {
    const safe = (value) => String(value).replace(/[|\n\r]/g, " ");
    const lines = [
      "# Репутационный аудит",
      "",
      "Дата: " + report.createdAt,
      "Режим: " +
        (report.engine === "openrouter"
          ? "OpenRouter / " + report.model
          : "Локальный алгоритм (без ИИ)"),
      "Период: " +
        (report.period.from || "все даты") +
        " — " +
        (report.period.to || "все даты"),
      "",
      ...report.warnings.map((text) => "> " + text),
      "",
      "| Компания | Отзывов | Анализов | Средняя оценка выборки | Позитив | Негатив |",
      "|---|---:|---:|---:|---:|---:|",
    ];
    for (const { company, metrics } of report.entries)
      lines.push(
        `| ${safe(company.name)} | ${metrics.total} | ${metrics.analyzed} | ${metrics.average === null ? "—" : metrics.average.toFixed(2)} | ${metrics.positiveShare === null ? "—" : Math.round(metrics.positiveShare * 100) + "%"} | ${metrics.negativeShare === null ? "—" : Math.round(metrics.negativeShare * 100) + "%"} |`,
      );
    for (const { company, metrics } of report.entries) {
      lines.push(
        "",
        "## " + safe(company.name),
        "",
        "| Тема | Упоминаний | Негатив | Позитив |",
        "|---|---:|---:|---:|",
      );
      for (const [topic, record] of Object.entries(metrics.topics)
        .filter(([, record]) => record.total > 0)
        .sort((a, b) => b[1].total - a[1].total))
        lines.push(
          `| ${TOPICS[topic]} | ${record.total} | ${record.negative} | ${record.positive} |`,
        );
    }
    lines.push("", "## Рекомендации своей компании");
    if (!report.recommendations.length)
      lines.push(
        "В проанализированных отзывах не найдено оснований для рекомендаций по жалобам.",
      );
    for (const action of report.recommendations) {
      lines.push(
        "",
        "### " + action.title,
        action.text,
        "Основание: " +
          action.count +
          " упоминаний в негативном или смешанном контексте.",
      );
      for (const evidence of action.evidence)
        lines.push(
          "> " + safe(evidence.quote),
          "Отзыв: " +
            evidence.reviewId +
            (evidence.url ? " — " + evidence.url : ""),
        );
    }
    return lines.join("\n") + "\n";
  }
  function demo() {
    const state = empty();
    state.demo = true;
    state.engine = "local";
    state.companies = [
      "Кофе и утро",
      "Тёплая чашка",
      "Пенка",
      "Зёрна рядом",
    ].map((name, index) => ({
      id: "demo-company-" + index,
      name,
      city: "Тюмень",
      address: "Учебная организация — адрес не задан",
      role: index === 0 ? "own" : "competitor",
      yandex: "",
      twoGis: "",
      confirmed: false,
    }));
    const products = [
      "Кофе вкусный и свежий.",
      "Десерт оказался пересушенным.",
      "Латте приятный, понравился вкус.",
      "Напиток подали холодным.",
      "Капучино отличный, взял ещё один.",
      "Булочка свежая и вкусная.",
      "Кофе слишком горький.",
      "Вкус напитка обычный, без особенностей.",
    ];
    const service = [
      "Бариста вежливый и помог с выбором.",
      "В очереди ждал долго.",
      "Заказ приготовили быстро.",
      "Персонал грубый, впечатление плохое.",
    ];
    const contexts = [
      "Зашёл утром в будний день.",
      "Пришёл после обеда.",
      "Был вечером после работы.",
      "Заходил днём в выходной.",
    ];
    const features = [
      "В зале уютно, стол чистый.",
      "Цены завышены, слишком дорого.",
      "Атмосфера приятная, музыка спокойная.",
      "В зале шумно, стол грязный.",
    ];
    const raw = [];
    state.companies.forEach((company, index) => {
      for (let n = 0; n < 128; n++) {
        const p = (n + index * 2) % 8,
          s = (Math.floor(n / 8) + index) % 4,
          c = Math.floor(n / 32) % 4;
        const text =
          contexts[c] +
          " " +
          products[p] +
          " " +
          service[s] +
          " " +
          features[(c + index) % 4];
        raw.push({
          companyId: company.id,
          externalId: "sample-" + index + "-" + n,
          source: "demo",
          text,
          rating: [2, 4, 5, 3][(p + s + index) % 4],
          publishedAt:
            "2026-09-" + String((n % 28) + 1).padStart(2, "0") + "T10:00:00Z",
        });
      }
    });
    mergeReviews(state, raw);
    return state;
  }
  root.AuditCore = {
    MODEL,
    MODELS,
    VERSION,
    TOPICS,
    SENTIMENTS,
    uid,
    clean,
    empty,
    redact,
    cardId,
    validateCompany,
    normalizeReview,
    mergeReviews,
    currentAnalysis,
    validateBatch,
    localAnalyze,
    applyBatch,
    stats,
    report,
    markdown,
    demo,
  };
})(globalThis);
