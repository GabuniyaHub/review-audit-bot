(function () {
  "use strict";
  const C = AuditCore;
  const pending = new Map();
  let counter = 0;
  window.Native = {
    receive(message) {
      const promise = pending.get(message.id);
      if (!promise) return;
      pending.delete(message.id);
      message.error
        ? promise.reject(new Error(message.error))
        : promise.resolve(message.data);
    },
    call(command, data = {}) {
      if (!window.Android) return browserAdapter(command, data);
      return new Promise((resolve, reject) => {
        const id = "call-" + ++counter;
        pending.set(id, { resolve, reject });
        try {
          Android.invoke(id, command, JSON.stringify(data));
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
  };
  async function browserAdapter(command, data) {
    if (command === "load")
      return (
        JSON.parse(localStorage.getItem("audit-preview") || "null") || C.empty()
      );
    if (command === "save") {
      localStorage.setItem("audit-preview", JSON.stringify(data));
      return true;
    }
    if (command === "cancel") return true;
    throw new Error("Эта функция доступна в установленном Android APK.");
  }
  const icons = {
    home: '<path d="M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7"/>',
    companies:
      '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 8h2m4 0h2M8 12h2m4 0h2M10 21v-5h4v5"/>',
    reviews:
      '<path d="M20 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3zM7 8h9M7 12h6"/>',
    reports: '<path d="M5 3h10l5 5v13H5zM14 3v6h6M9 17v-4m4 4v-6m4 6v-3"/>',
    settings:
      '<circle cx="12" cy="12" r="4"/><path d="m10 3-1 3-3 1-3-1-1 4 2 2-1 3 3 3 3-1 2 3 4-1 1-3 3-1 1-4-3-2-1-3-4-1z"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
    refresh: '<path d="M20 8a9 9 0 1 0 1 7M20 3v6h-6"/>',
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  const pct = (value) => (value === null ? "—" : Math.round(value * 100) + "%");
  const date = (value) =>
    value
      ? new Date(value).toLocaleString("ru-RU", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  const button = (
    action,
    text,
    type = "primary",
    symbol = "arrow",
    extra = "",
  ) =>
    `<button type="button" class="button ${type}" data-action="${action}" ${busy && action !== "cancel" ? "disabled" : ""} ${extra}>${esc(text)}${icon(symbol)}</button>`;
  let state = C.empty(),
    page = "home",
    busy = false,
    cancelled = false,
    toastTimer,
    reviewLimit = 30;
  let filter = { company: "", sentiment: "", source: "", search: "" };
  let selectedReport = "",
    period = { from: "", to: "" };
  const content = document.querySelector("#content");
  const NAV = [
    ["home", "Обзор"],
    ["companies", "Компании"],
    ["reviews", "Отзывы"],
    ["reports", "Отчёты"],
    ["settings", "Ещё"],
  ];
  function notify(text, error = false) {
    const element = document.querySelector("#toast");
    element.textContent = text;
    element.className = error ? "error" : "";
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        element.hidden = true;
      },
      error ? 8000 : 4000,
    );
  }
  function progress(text, done = 0, total = 0) {
    const element = document.querySelector("#task");
    element.hidden = false;
    element.innerHTML = `<div><span class="spinner"></span><strong>${esc(text)}</strong><button class="task-cancel" data-action="cancel" aria-label="Остановить">✕</button></div>${total ? `<p>${done} из ${total} · Можно перейти в другой раздел</p><progress max="${total}" value="${done}"></progress>` : "<p>Не закрывайте приложение до завершения</p>"}`;
  }
  async function persist() {
    await Native.call("save", state);
  }
  function logEvent(text, type = "info") {
    state.events.unshift({
      id: C.uid("event"),
      text,
      type,
      time: new Date().toISOString(),
    });
    state.events = state.events.slice(0, 40);
  }
  function setPage(next) {
    page = NAV.some(([name]) => name === next) ? next : "home";
    reviewLimit = 30;
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    document.querySelector("#navigation").innerHTML = NAV.map(
      ([name, title]) =>
        `<button class="nav-item ${page === name ? "active" : ""}" data-page="${name}" ${page === name ? 'aria-current="page"' : ""}>${icon(name)}<span>${title}</span></button>`,
    ).join("");
    content.innerHTML = {
      home: homePage,
      companies: companiesPage,
      reviews: reviewsPage,
      reports: reportsPage,
      settings: settingsPage,
    }[page]();
  }
  function heading(kicker, title, description = "") {
    return `<div class="page-heading"><p class="kicker">${esc(kicker)}</p><h1>${esc(title)}</h1>${description ? `<p class="muted">${esc(description)}</p>` : ""}</div>`;
  }
  function engineTag(engine = state.engine) {
    return `<span class="tag ${engine === "openrouter" ? "blue" : "amber"}">${engine === "openrouter" ? "ИИ · OpenRouter" : "Локально · без ИИ"}</span>`;
  }
  function companyOptions(selected = "", all = true) {
    return (
      (all ? '<option value="">Все компании</option>' : "") +
      state.companies
        .map(
          (company) =>
            `<option value="${esc(company.id)}" ${company.id === selected ? "selected" : ""}>${esc(company.name)}</option>`,
        )
        .join("")
    );
  }
  function homePage() {
    const own = state.companies.find((company) => company.role === "own");
    const analyzed = state.reviews.filter((review) =>
      C.currentAnalysis(review, state.engine, state.model),
    ).length;
    const coverage = state.reviews.length
      ? Math.round((analyzed * 100) / state.reviews.length)
      : 0;
    if (!own)
      return `${heading("МОБИЛЬНЫЙ РЕПУТАЦИОННЫЙ АУДИТ", "Отзывы становятся понятнее", "Ваша компания, три конкурента и выводы, подкреплённые цитатами.")}<section class="welcome-card"><span class="welcome-symbol">↗</span><span class="tag inverse">Работает прямо на Android</span><h2>Всё для аудита.<br>В одном приложении.</h2><p>Данные остаются на телефоне. Для нейросети нужен только интернет — сервер запускать не нужно.</p>${button("demo", "Открыть учебный пример", "light", "spark")}<small>4 вымышленные кофейни Тюмени · 512 отзывов</small></section><div class="section-label"><h2>Или начните со своей компании</h2></div>${button("add-own", "Добавить компанию", "outline", "plus")}<div class="note"><strong>Прозрачный результат</strong><p>Демонстрационные данные помечены. Результаты локального алгоритма и ИИ различаются в отчёте.</p></div>`;
    const metrics = C.stats(state, own.id);
    return `<section class="overview-hero"><div class="hero-top"><span class="tag inverse">${state.demo ? "Учебный проект" : "Ваш проект"}</span><span class="local-dot">На устройстве</span></div><p class="hero-city">${esc(own.city)}</p><h1>${esc(own.name)}</h1><p>Репутация в деталях, решения — по данным.</p><div class="hero-stats"><div><strong>${state.reviews.length}</strong><span>отзывов</span></div><div><strong>${state.companies.length}</strong><span>компании</span></div><div><strong>${metrics.average === null ? "—" : metrics.average.toFixed(1)}<small> / 5</small></strong><span>средняя выборки</span></div></div></section>
      ${state.demo ? '<div class="demo-banner"><span>ДЕМО</span> Вымышленные кофейни и отзывы. Не реальные результаты бизнеса.</div>' : ""}
      <div class="section-label"><h2>Ваш следующий шаг</h2>${engineTag()}</div><div class="card analysis-card"><div class="row"><div><strong>${analyzed ? "Анализ отзывов" : "Разберём, что говорят клиенты"}</strong><p class="muted">${analyzed} из ${state.reviews.length} · ${coverage}% обработано</p></div><span class="round-icon">${icon("spark")}</span></div><progress max="100" value="${coverage}"></progress><div class="actions">${button("collect", "Собрать", "outline", "refresh")}${button("analyze", analyzed === state.reviews.length && analyzed ? "Всё разобрано" : "Анализировать", "primary", "spark")}</div>${button("create-report", "Сформировать отчёт", "quiet", "reports")}</div>
      <div class="section-label"><h2>Компании в сравнении</h2><button class="text-button" data-page="companies">Все ${state.companies.length} →</button></div><div class="card compare-list">${state.companies
        .map((company, index) => {
          const stats = C.stats(state, company.id);
          return `<div class="compare-row"><span class="avatar color-${index}">${esc(company.name.slice(0, 1))}</span><div class="grow"><strong>${esc(company.name)}</strong><span class="muted">${company.role === "own" ? "Ваша компания" : "Конкурент"} · ${stats.total} отзывов</span></div><div class="right"><strong>${stats.average === null ? "—" : stats.average.toFixed(1)} <span class="star">★</span></strong><span class="muted">${pct(stats.positiveShare)} позитив</span></div></div>`;
        })
        .join("")}</div>
      <div class="section-label"><h2>Последние действия</h2></div><div class="card activity-list">${
        state.events
          .slice(0, 4)
          .map(
            (item) =>
              `<div class="activity"><span class="activity-dot ${item.type}"></span><div><p>${esc(item.text)}</p><small>${date(item.time)}</small></div></div>`,
          )
          .join("") ||
        '<p class="muted">Здесь появится история сбора и анализа.</p>'
      }</div>`;
  }
  function companiesPage() {
    const hasOwn = state.companies.some((company) => company.role === "own");
    return `${heading("ПРОЕКТ НА УСТРОЙСТВЕ", "Ваш рынок", "Одна своя компания и до трёх конкурентов. Ссылки — на конкретные филиалы.")}<div class="company-list">${state.companies.map((company, index) => `<article class="card company-card"><div class="row"><span class="avatar color-${index}">${esc(company.name.slice(0, 1))}</span><div class="grow"><strong>${esc(company.name)}</strong><span class="muted">${company.role === "own" ? "Ваша компания" : "Конкурент"}</span></div><button class="text-button" data-action="edit-company" data-id="${esc(company.id)}" ${busy ? "disabled" : ""}>Изменить</button></div><p class="address">${esc(company.city)}${company.address ? " · " + esc(company.address) : ""}</p><div class="source-tags">${company.yandex ? '<span class="tag">Яндекс</span>' : ""}${company.twoGis ? '<span class="tag">2ГИС</span>' : ""}${!company.yandex && !company.twoGis ? '<span class="tag amber">Импорт из файла</span>' : ""}<span class="tag ${company.confirmed ? "green" : "subtle"}">${company.confirmed ? "Филиалы проверены" : "Проверьте филиалы"}</span></div><div class="card-footer"><span>${C.stats(state, company.id).total} отзывов на устройстве</span><button class="text-button" data-action="delete-company" data-id="${esc(company.id)}" ${busy ? "disabled" : ""}>Удалить</button></div></article>`).join("")}</div>${state.companies.length < 4 ? button(hasOwn ? "add-competitor" : "add-own", hasOwn ? "Добавить конкурента" : "Добавить свою компанию", "outline full", "plus") : '<p class="muted center">Добавлены все четыре компании.</p>'}<div class="note"><strong>Проверьте адреса перед сбором</strong><p>Совпадение названий не означает, что это один филиал. Сбор доступен для карточек, которые вы подтвердили. При отсутствии ссылок используйте импорт.</p></div>`;
  }
  function reviewsPage() {
    let rows = state.reviews.filter(
      (review) =>
        (!filter.company || review.companyId === filter.company) &&
        (!filter.source || review.source === filter.source) &&
        (!filter.sentiment ||
          (C.currentAnalysis(review, state.engine, state.model) &&
            review.analysis.sentiment === filter.sentiment)) &&
        (!filter.search ||
          review.text
            .toLocaleLowerCase("ru")
            .includes(filter.search.toLocaleLowerCase("ru"))),
    );
    return `${heading("ИСХОДНЫЕ ДАННЫЕ", "Голос клиентов", "Текст, источник и результат анализа — рядом.")}<div class="actions">${button("import", "Импорт JSON", "outline", "download")}${button("collect", "Собрать отзывы", "primary", "refresh")}</div><div class="filters"><select aria-label="Компания" id="filter-company">${companyOptions(filter.company)}</select><select aria-label="Тональность" id="filter-sentiment"><option value="">Любая тональность</option>${Object.entries(
      C.SENTIMENTS,
    )
      .map(
        ([key, name]) =>
          `<option value="${key}" ${filter.sentiment === key ? "selected" : ""}>${name}</option>`,
      )
      .join(
        "",
      )}</select><select aria-label="Источник" id="filter-source"><option value="">Все источники</option>${[
      ["yandex", "Яндекс"],
      ["2gis", "2ГИС"],
      ["import", "Импорт"],
      ["demo", "Демо"],
    ]
      .map(
        ([key, label]) =>
          `<option value="${key}" ${filter.source === key ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select><label class="search-field"><span>⌕</span><input type="search" id="filter-search" placeholder="Поиск по отзывам" value="${esc(filter.search)}"></label></div><p class="list-count">Найдено ${rows.length} · показано ${Math.min(rows.length, reviewLimit)}</p><div class="review-list">${rows.slice(0, reviewLimit).map(reviewCard).join("") || '<div class="empty-state">Пока нет подходящих отзывов.<br>Загрузите учебный пример или импортируйте данные.</div>'}</div>${rows.length > reviewLimit ? button("more-reviews", "Показать ещё 30", "outline full", "plus") : ""}`;
  }
  function reviewCard(review) {
    const company = state.companies.find(
      (item) => item.id === review.companyId,
    );
    const analysis = C.currentAnalysis(review, state.engine, state.model)
      ? review.analysis
      : null;
    return `<article class="card review-card"><div class="row"><strong class="small grow">${esc(company?.name || "Компания")}</strong><span class="rating">${review.rating === null ? "Без оценки" : review.rating + " ★"}</span></div><p class="review-text">${esc(review.text)}</p><div class="source-tags"><span class="tag subtle">${{ yandex: "Яндекс", "2gis": "2ГИС", import: "Импорт", demo: "Демо" }[review.source]}</span>${analysis ? `<span class="tag sentiment-${analysis.sentiment}">${C.SENTIMENTS[analysis.sentiment]}</span>` : '<span class="tag subtle">Не разобран</span>'}${review.crossSourceDuplicate ? '<span class="tag amber">Совпадение источников</span>' : ""}</div>${analysis ? `<div class="topic-pills">${analysis.topics.map((topic) => `<span>${esc(C.TOPICS[topic.topic])}</span>`).join("")}</div>` : ""}<div class="review-footer"><small>${review.publishedAt ? date(review.publishedAt) : "Дата публикации неизвестна"}</small>${review.url ? `<button class="text-button" data-action="open-review" data-id="${esc(review.id)}">Источник ↗</button>` : ""}</div></article>`;
  }
  function reportsPage() {
    const report =
      state.reports.find((item) => item.id === selectedReport) ||
      state.reports[0];
    return `${heading("ВЫВОДЫ И ДЕЙСТВИЯ", "Репутационный отчёт", "Сравнение по одной методике и рекомендации с основаниями.")}<div class="card period-card"><strong>Период публикации отзывов</strong><div class="form-row"><label>С<input type="date" id="period-from" value="${esc(period.from)}"></label><label>По<input type="date" id="period-to" value="${esc(period.to)}"></label></div><p class="muted small">Оставьте даты пустыми для всех отзывов. Неизвестные даты исключаются из периода.</p>${button("create-report", "Сформировать", "primary full", "reports")}</div>${state.reports.length > 1 ? `<label class="history-select">История отчётов<select id="report-history">${state.reports.map((item) => `<option value="${esc(item.id)}" ${item.id === report?.id ? "selected" : ""}>${date(item.createdAt)} · ${item.engine === "openrouter" ? "ИИ" : "Локальный"}</option>`).join("")}</select></label>` : ""}${report ? reportView(report) : '<div class="empty-state">Отчёт появится после анализа отзывов.<br>Сначала откройте «Обзор» → «Анализировать».</div>'}`;
  }
  function reportView(report) {
    const own = report.entries.find((entry) => entry.company.role === "own");
    return `<div class="report-toolbar">${engineTag(report.engine)}<small>${date(report.createdAt)}</small></div>${report.engine === "openrouter" ? `<p class="model-name">${esc(report.model)}</p>` : ""}<div class="report-summary"><p class="kicker">${esc(own.company.name)}</p><h2>Что видят<br>ваши клиенты</h2><div class="summary-grid"><div><strong>${own.metrics.analyzed}</strong><span>разобрано</span></div><div><strong>${pct(own.metrics.positiveShare)}</strong><span>позитив</span></div><div><strong>${pct(own.metrics.negativeShare)}</strong><span>негатив</span></div></div></div><div class="warning-box">${report.warnings.map((text) => `<p>${esc(text)}</p>`).join("")}</div><div class="section-label"><h2>Рядом с конкурентами</h2></div><div class="table-scroll"><table><thead><tr><th>Компания</th><th>Отзывы</th><th>Анализ</th><th>Оценка</th><th>Позитив</th></tr></thead><tbody>${report.entries.map((entry) => `<tr><td>${esc(entry.company.name)}${entry.company.role === "own" ? "<small>Ваша</small>" : ""}</td><td>${entry.metrics.total}</td><td>${entry.metrics.analyzed}</td><td>${entry.metrics.average === null ? "—" : entry.metrics.average.toFixed(2)}</td><td>${pct(entry.metrics.positiveShare)}</td></tr>`).join("")}</tbody></table></div><p class="muted small">Оценки и доли относятся к выборке, а не к рейтингу всей площадки.</p><div class="section-label"><h2>Темы своей компании</h2></div><div class="card topic-chart">${
      Object.entries(own.metrics.topics)
        .filter(([, metric]) => metric.total > 0)
        .sort((a, b) => b[1].total - a[1].total)
        .map(
          ([topic, metric]) =>
            `<div class="topic-row"><div class="row"><strong>${C.TOPICS[topic]}</strong><span>${metric.total}</span></div><progress value="${metric.total}" max="${own.metrics.analyzed || 1}"></progress><div class="topic-legend"><span>${metric.positive} позитив</span><span>${metric.negative} негатив</span><span>${metric.mixed} смешанно</span></div></div>`,
        )
        .join("") || '<p class="muted">Темы не определены.</p>'
    }</div><div class="section-label"><h2>Что можно улучшить</h2><span class="tag">${report.recommendations.length} действий</span></div>${report.recommendations.map((action, index) => `<article class="card recommendation"><span class="action-number">0${index + 1}</span><h3>${esc(action.title)}</h3><p>${esc(action.text)}</p><small>${action.count} упоминаний в негативном или смешанном контексте</small>${action.evidence.map((evidence) => `<blockquote>«${esc(evidence.quote)}»<cite>${esc(evidence.reviewId)}</cite></blockquote>`).join("")}</article>`).join("") || '<div class="card"><p>Оснований для рекомендаций по жалобам нет. Дополнительные проблемы не выдумываются.</p></div>'}${button("export-report", "Сохранить отчёт .md", "primary full", "download", `data-id="${esc(report.id)}"`)}`;
  }
  function settingsPage() {
    return `${heading("ПРИЛОЖЕНИЕ БЕЗ СЕРВЕРА", "Всё под контролем", "Локальная база SQLite. Прямое подключение к OpenRouter.")}<div class="card settings-card"><div class="row"><span class="round-icon">${icon("spark")}</span><div><strong>Режим анализа</strong><p class="muted small">Один режим для всего текущего отчёта</p></div></div><label class="radio-label"><input type="radio" name="engine" value="openrouter" ${state.engine === "openrouter" ? "checked" : ""} ${busy ? "disabled" : ""}><span><strong>ИИ · OpenRouter</strong><small>Прямой запрос с телефона. Нужен интернет.</small></span></label><label class="radio-label"><input type="radio" name="engine" value="local" ${state.engine === "local" ? "checked" : ""} ${busy ? "disabled" : ""}><span><strong>Локальный алгоритм</strong><small>Без сети, по словарным правилам. Это не ИИ.</small></span></label><label>Бесплатная модель<select id="model-choice" ${busy ? "disabled" : ""}>${Object.entries(
      C.MODELS,
    )
      .map(
        ([id, title]) =>
          `<option value="${esc(id)}" ${id === (state.model || C.MODEL) ? "selected" : ""}>${esc(title)}</option>`,
      )
      .join(
        "",
      )}</select></label><p class="model-name">${esc(state.model || C.MODEL)}</p><p class="small muted">Исходная модель сейчас может отвечать 404. Запасная выбирается вручную; платные модели не используются.</p></div><div class="card settings-card"><div class="row"><strong class="grow">Подключение OpenRouter</strong><span class="tag ${state.keyConfigured ? "green" : "amber"}">${state.keyConfigured ? "Ключ задан" : "Нужен ключ"}</span></div><p class="muted small">Ключ включён в эту локальную сборку либо задан ниже. Проверка выполняет настоящий запрос на вымышленном тексте.</p><label>Новый ключ<input type="password" id="api-key" placeholder="sk-or-v1-…" autocomplete="off"></label><div class="actions">${button("save-key", "Сохранить ключ", "outline", "check")}${button("test-llm", "Проверить ИИ", "primary", "spark")}</div><p class="small muted">Тексты перед отправкой маскируются. Это эвристика: не импортируйте персональные или конфиденциальные сведения.</p></div><div class="card settings-card"><strong>Перенос данных</strong><p class="muted small">Резервная копия включает компании, отзывы, анализ и отчёты. Ключ в неё не попадает.</p><div class="stack">${button("export-data", "Сохранить копию JSON", "outline", "download")}${button("import", "Импорт / восстановление", "outline", "refresh")}</div></div><div class="card settings-card"><strong>Учебная демонстрация</strong><p class="muted small">Четыре вымышленные кофейни Тюмени, 512 отзывов. Загружаются отдельным проектом вместо текущих данных.</p>${button("demo", "Загрузить пример", "outline full", "spark")}</div><details class="help"><summary>Как показать работу приложения</summary><ol><li>Загрузите учебный пример.</li><li>В локальном режиме запустите анализ 512 отзывов.</li><li>Сформируйте отчёт, посмотрите темы и цитаты.</li><li>Для нейросети выберите режим ИИ, проверьте ключ и запустите анализ. Сохраняется каждый завершённый пакет; можно остановить и продолжить.</li><li>Для реальной организации добавьте карточки и подтвердите филиалы либо импортируйте JSON.</li><li>Сохраните отчёт или резервную копию в файлы телефона.</li></ol><p>Сбор с Яндекса зависит от доступности страницы и возвращает только выданную площадкой часть отзывов. 2ГИС может потребовать CAPTCHA; используйте импорт. Фонового сбора при закрытом приложении нет.</p></details><div class="about"><span class="brand-mark">↗</span><strong>Репутация 1.0</strong><p>Android 8+ · данные на устройстве</p>${!window.Android ? "<p>Открыт браузерный просмотр. Сбор, ИИ и работа с файлами доступны в APK.</p>" : ""}</div>${button("clear", "Очистить текущий проект", "danger full", "refresh")}`;
  }
  function modal(title, body, footer = "") {
    document.querySelector("#modal-root").innerHTML =
      `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-heading"><h2>${esc(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Закрыть">✕</button></div>${body}${footer}</section></div>`;
  }
  function closeModal() {
    document.querySelector("#modal-root").innerHTML = "";
  }
  function confirmAction(title, text) {
    return new Promise((resolve) => {
      modal(
        title,
        `<p>${esc(text)}</p>`,
        '<div class="actions"><button class="button outline" id="confirm-no">Отмена</button><button class="button primary" id="confirm-yes">Продолжить</button></div>',
      );
      const finish = (value) => {
        closeModal();
        resolve(value);
      };
      document.querySelector("#confirm-no").onclick = () => finish(false);
      document.querySelector("#confirm-yes").onclick = () => finish(true);
      document.querySelector("[data-action=close-modal]").onclick = (event) => {
        event.stopPropagation();
        finish(false);
      };
    });
  }
  function editCompany(id, role) {
    const company = state.companies.find((item) => item.id === id) || {
      name: "",
      city: "Тюмень",
      role,
      address: "",
      yandex: "",
      twoGis: "",
    };
    modal(
      company.id
        ? "Изменить компанию"
        : company.role === "own"
          ? "Ваша компания"
          : "Новый конкурент",
      `<form id="company-form"><input type="hidden" name="id" value="${esc(company.id || "")}"><input type="hidden" name="role" value="${esc(company.role)}"><label>Название<input name="name" value="${esc(company.name)}" maxlength="100" minlength="2" required placeholder="Название организации"></label><div class="form-row"><label>Город<input name="city" value="${esc(company.city)}" maxlength="100" required></label><label>Адрес<input name="address" value="${esc(company.address)}" maxlength="250" placeholder="Улица и дом"></label></div><label>Карточка Яндекс.Карт<input name="yandex" type="url" value="${esc(company.yandex)}" placeholder="https://yandex.ru/maps/org/…"></label><label>Карточка 2ГИС<input name="twoGis" type="url" value="${esc(company.twoGis)}" placeholder="https://2gis.ru/tyumen/firm/…"></label><p class="muted small">Ссылки необязательны для импорта файла. Для автоматического сбора нужна хотя бы одна карточка.</p><label class="checkbox-label"><input type="checkbox" name="confirmed" ${company.confirmed ? "checked" : ""}><span>Проверил адреса: карточки относятся к нужному филиалу.</span></label><button class="button primary full" type="submit">Сохранить компанию ${icon("check")}</button></form>`,
    );
  }
  async function task(title, work) {
    if (busy) return notify("Дождитесь текущей операции или остановите её.");
    busy = true;
    cancelled = false;
    render();
    progress(title);
    try {
      await work();
    } catch (error) {
      logEvent(error.message, "error");
      try {
        await persist();
      } catch {}
      notify(error.message, true);
    } finally {
      busy = false;
      document.querySelector("#task").hidden = true;
      render();
    }
  }
  async function analyze() {
    const todo = state.reviews.filter(
      (review) => !C.currentAnalysis(review, state.engine, state.model),
    );
    if (!todo.length)
      return notify(
        state.reviews.length
          ? "Все отзывы уже разобраны в этом режиме."
          : "Сначала загрузите отзывы.",
      );
    if (state.engine === "openrouter" && !state.keyConfigured)
      return setPage("settings");
    const engine = state.engine;
    if (
      engine === "openrouter" &&
      !(await confirmAction(
        "Анализ через OpenRouter",
        `${todo.length} текстов будут обработаны пакетами. В OpenRouter отправляются замаскированные тексты без имён авторов, оценок и карточек. Бесплатная модель может отвечать долго или ограничить запросы. Продолжить?`,
      ))
    )
      return;
    await task("Анализируем отзывы", async () => {
      const started = performance.now();
      let done = 0;
      const batchSize = engine === "openrouter" ? 8 : 64;
      for (let offset = 0; offset < todo.length; offset += batchSize) {
        if (cancelled) break;
        progress(
          engine === "openrouter"
            ? "Nemotron читает отзывы…"
            : "Локальный разбор…",
          done,
          todo.length,
        );
        const reviews = todo.slice(offset, offset + batchSize);
        const inputs = reviews.map((review) => ({
          reviewId: review.id,
          text: C.redact(review.text),
        }));
        const results =
          engine === "openrouter"
            ? await Native.call("analyze", {
                reviews: inputs,
                model: state.model || C.MODEL,
              })
            : reviews.map(C.localAnalyze);
        C.validateBatch(results, inputs);
        C.applyBatch(state, results, engine);
        done += results.length;
        await persist();
        progress("Сохраняем результат…", done, todo.length);
        await new Promise((resolve) =>
          setTimeout(resolve, engine === "openrouter" ? 3100 : 20),
        );
      }
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      logEvent(
        `${cancelled ? "Остановлено" : "Анализ завершён"}: ${done} отзывов за ${seconds} с. ${engine === "openrouter" ? "OpenRouter" : "Локальный алгоритм"}.`,
      );
      await persist();
      notify(`${done} отзывов обработано. Результат сохранён.`);
    });
  }
  async function collect() {
    const targets = state.companies.filter(
      (company) => company.confirmed && (company.yandex || company.twoGis),
    );
    if (!targets.length) {
      setPage("companies");
      return notify("Добавьте карточку организации и подтвердите филиал.");
    }
    await task("Собираем доступные отзывы", async () => {
      let total = 0,
        errors = 0;
      for (const company of targets)
        for (const [field, provider] of [
          ["yandex", "yandex"],
          ["twoGis", "2gis"],
        ]) {
          if (cancelled) break;
          if (!company[field]) continue;
          progress(
            company.name + " · " + (provider === "yandex" ? "Яндекс" : "2ГИС"),
          );
          try {
            const rows = await Native.call("collect", {
              provider,
              externalId: C.cardId(company[field], provider),
            });
            const result = C.mergeReviews(state, rows, company.id);
            total += result.added;
            logEvent(
              `${company.name}: ${result.added} новых, ${result.updated} обновлено (${provider}). Сбор частичный.`,
            );
          } catch (error) {
            errors++;
            logEvent(company.name + ": " + error.message, "error");
          }
          await persist();
        }
      notify(
        `Сохранено новых: ${total}. Ошибок источников: ${errors}. Подробности — в истории.`,
      );
    });
  }
  async function importFile() {
    if (busy) return;
    const raw = await Native.call("import");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("Нужен JSON-файл, не CSV или HTML.");
    }
    if (data.format === "reputation-audit-backup-v1") {
      if (
        !(await confirmAction(
          "Восстановить проект?",
          "Текущие данные будут заменены резервной копией. Сначала можно сохранить собственную копию.",
        ))
      )
        return;
      const restored = data.state;
      if (
        !restored ||
        !Array.isArray(restored.companies) ||
        restored.companies.length < 1 ||
        restored.companies.length > 4 ||
        !Array.isArray(restored.reviews) ||
        restored.reviews.length > 5000
      )
        throw new Error("Неверный формат резервной копии.");
      const candidate = C.empty();
      candidate.id = C.uid("restored");
      candidate.companies = restored.companies.map(C.validateCompany);
      if (
        candidate.companies.filter((company) => company.role === "own")
          .length !== 1 ||
        new Set(candidate.companies.map((company) => company.id)).size !==
          candidate.companies.length
      )
        throw new Error(
          "В копии должна быть ровно одна своя компания и уникальные ID.",
        );
      C.mergeReviews(candidate, restored.reviews, undefined, 5000);
      candidate.demo = candidate.reviews.some(
        (review) => review.source === "demo",
      );
      candidate.model = Object.hasOwn(C.MODELS, restored.model)
        ? restored.model
        : C.MODEL;
      candidate.engine = restored.engine === "local" ? "local" : "openrouter";
      // Revalidate cached analysis against the imported text; never trust imported metrics/reports.
      for (const original of restored.reviews) {
        const review = candidate.reviews.find(
          (item) =>
            item.identity ===
            C.normalizeReview(original, candidate.companies).identity,
        );
        if (
          review &&
          original.analysis &&
          original.analysis.text === C.redact(review.text) &&
          original.analysis.version === C.VERSION &&
          ["local", "openrouter"].includes(original.analysis.engine)
        ) {
          try {
            C.validateBatch(
              [original.analysis],
              [
                {
                  reviewId: original.analysis.reviewId,
                  text: C.redact(review.text),
                },
              ],
            );
            review.analysis = { ...original.analysis, reviewId: review.id };
          } catch {}
        }
      }
      candidate.keyConfigured = state.keyConfigured;
      state = candidate;
      logEvent("Проект восстановлен. Отчёты можно сформировать заново.");
      await persist();
      render();
      return notify("Резервная копия восстановлена.");
    }
    const rows = Array.isArray(data) ? data : data.reviews;
    if (!state.companies.length) {
      setPage("companies");
      return notify(
        "Добавьте свою компанию перед импортом отзывов. Для восстановления используйте полную резервную копию.",
      );
    }
    if (!Array.isArray(rows))
      throw new Error(
        "В JSON нужен массив отзывов или объект с полем reviews.",
      );
    modal(
      "Компания для импорта",
      `<p class="muted">Для строк без companyId будет использована выбранная компания.</p><label>Компания<select id="import-company">${companyOptions("", false)}</select></label><p class="small muted">До 2000 отзывов за импорт, до 5 МБ. Авторы не импортируются.</p><button class="button primary full" id="finish-import">Импортировать ${rows.length} отзывов</button>`,
    );
    document.querySelector("#finish-import").onclick = async () => {
      try {
        const company = document.querySelector("#import-company").value;
        const candidate = JSON.parse(JSON.stringify(state));
        const result = C.mergeReviews(candidate, rows, company);
        candidate.demo ||= candidate.reviews.some(
          (review) => review.source === "demo",
        );
        state = candidate;
        logEvent(
          `Импорт: ${result.added} новых, ${result.updated} обновлено, ${result.duplicates} повторов.`,
        );
        await persist();
        closeModal();
        setPage("reviews");
        notify(`Добавлено ${result.added} отзывов.`);
      } catch (error) {
        notify(error.message, true);
      }
    };
  }
  const actions = {
    "add-own": () => editCompany("", "own"),
    "add-competitor": () => editCompany("", "competitor"),
    "edit-company": (element) => editCompany(element.dataset.id),
    "close-modal": closeModal,
    "delete-company": async (element) => {
      const company = state.companies.find(
        (item) => item.id === element.dataset.id,
      );
      if (
        company &&
        (await confirmAction(
          "Удалить компанию?",
          `Компания «${company.name}» и её отзывы будут удалены из текущего проекта. Старые отчёты останутся снимками предыдущих данных.`,
        ))
      ) {
        state.companies = state.companies.filter(
          (item) => item.id !== company.id,
        );
        state.reviews = state.reviews.filter(
          (item) => item.companyId !== company.id,
        );
        await persist();
        render();
      }
    },
    demo: async () => {
      if (
        state.reviews.length &&
        !(await confirmAction(
          "Открыть учебный проект?",
          "Текущий проект будет заменён. Если данные нужны, сначала сохраните резервную копию в разделе «Ещё».",
        ))
      )
        return;
      const configured = state.keyConfigured;
      state = C.demo();
      state.keyConfigured = configured;
      logEvent("Загружено 512 вымышленных отзывов о четырёх учебных кофейнях.");
      await persist();
      setPage("home");
      notify("Учебный проект готов. Можно запустить локальный анализ.");
    },
    collect,
    analyze,
    cancel: async () => {
      cancelled = true;
      await Native.call("cancel");
      notify("Останавливаем. Завершённые пакеты сохранены.");
    },
    "create-report": async () => {
      const report = C.report(state, { ...period });
      state.reports.unshift(report);
      state.reports = state.reports.slice(0, 20);
      selectedReport = report.id;
      logEvent(
        "Сформирован отчёт: " +
          report.entries.reduce(
            (sum, entry) => sum + entry.metrics.analyzed,
            0,
          ) +
          " анализов.",
      );
      await persist();
      setPage("reports");
    },
    "more-reviews": () => {
      reviewLimit += 30;
      const position = window.scrollY;
      render();
      window.scrollTo(0, position);
    },
    "open-review": (element) =>
      Native.call("open", {
        url: state.reviews.find((review) => review.id === element.dataset.id)
          .url,
      }),
    import: importFile,
    "export-report": async (element) => {
      const report = state.reports.find(
        (item) => item.id === element.dataset.id,
      );
      if (!report) throw new Error("Отчёт не найден.");
      await Native.call("export", {
        filename: "reputation-audit-" + report.createdAt.slice(0, 10) + ".md",
        text: C.markdown(report),
      });
      notify("Отчёт сохранён.");
    },
    "export-data": async () => {
      const copy = JSON.parse(JSON.stringify(state));
      delete copy.keyConfigured;
      await Native.call("export", {
        filename:
          "reputation-backup-" +
          new Date().toISOString().slice(0, 10) +
          ".json",
        text: JSON.stringify(
          { format: "reputation-audit-backup-v1", state: copy },
          null,
          2,
        ),
      });
      notify("Копия сохранена без API-ключа.");
    },
    "save-key": async () => {
      const key = document.querySelector("#api-key").value.trim();
      if (!key) throw new Error("Введите новый ключ.");
      state.keyConfigured = await Native.call("setKey", { key });
      document.querySelector("#api-key").value = "";
      render();
      notify("Ключ сохранён только на устройстве.");
    },
    "test-llm": async () =>
      task("Проверяем настоящий ответ ИИ", async () => {
        const inputs = [
          {
            reviewId: "connection-check",
            text: "кофе вкусный, но заказ ждал долго.",
          },
        ];
        const results = await Native.call("analyze", {
          reviews: inputs,
          model: state.model || C.MODEL,
        });
        C.validateBatch(results, inputs);
        logEvent(
          "Проверка OpenRouter: корректный ответ " + (state.model || C.MODEL),
        );
        await persist();
        notify("ИИ работает: получен корректный ответ выбранной модели.");
      }),
    clear: async () => {
      if (
        !(await confirmAction(
          "Очистить проект?",
          "Будут удалены компании, отзывы и отчёты на этом устройстве. API-ключ останется. Сохраните копию, если данные нужны.",
        ))
      )
        return;
      const configured = state.keyConfigured;
      state = C.empty();
      state.keyConfigured = configured;
      await persist();
      setPage("home");
    },
  };
  document.addEventListener("click", (event) => {
    const navigation = event.target.closest("[data-page]");
    if (navigation) return setPage(navigation.dataset.page);
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    if (busy && action !== "cancel" && action !== "close-modal")
      return notify("Сначала завершите или остановите текущую операцию.");
    Promise.resolve()
      .then(() => actions[action]?.(target))
      .catch((error) => notify(error.message, true));
  });
  document.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (event.target.id !== "company-form" || busy) return;
    try {
      const data = Object.fromEntries(new FormData(event.target));
      data.confirmed = data.confirmed === "on";
      const company = C.validateCompany(data);
      const index = state.companies.findIndex((item) => item.id === company.id);
      if (index < 0 && state.companies.length >= 4)
        throw new Error("Доступно не более четырёх компаний.");
      if (
        company.role === "own" &&
        state.companies.some(
          (item) => item.role === "own" && item.id !== company.id,
        )
      )
        throw new Error("Своя компания может быть только одна.");
      if (index >= 0) state.companies[index] = company;
      else state.companies.push(company);
      logEvent("Сохранена компания: " + company.name);
      await persist();
      closeModal();
      render();
      notify("Компания сохранена.");
    } catch (error) {
      notify(error.message, true);
    }
  });
  document.addEventListener("change", async (event) => {
    const target = event.target;
    try {
      if (target.name === "engine" && !busy) {
        state.engine = target.value === "local" ? "local" : "openrouter";
        await persist();
        render();
      } else if (target.id === "model-choice" && !busy) {
        if (!Object.hasOwn(C.MODELS, target.value))
          throw new Error("Неизвестная модель.");
        state.model = target.value;
        await persist();
        render();
      } else if (target.id === "filter-company") {
        filter.company = target.value;
        reviewLimit = 30;
        render();
      } else if (target.id === "filter-sentiment") {
        filter.sentiment = target.value;
        reviewLimit = 30;
        render();
      } else if (target.id === "filter-source") {
        filter.source = target.value;
        reviewLimit = 30;
        render();
      } else if (target.id === "period-from") period.from = target.value;
      else if (target.id === "period-to") period.to = target.value;
      else if (target.id === "report-history") {
        selectedReport = target.value;
        render();
      }
    } catch (error) {
      notify(error.message, true);
    }
  });
  let searchTimer;
  document.addEventListener("input", (event) => {
    if (event.target.id !== "filter-search") return;
    const value = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filter.search = value;
      reviewLimit = 30;
      render();
      const input = document.querySelector("#filter-search");
      input.focus();
      input.setSelectionRange?.(value.length, value.length);
    }, 450);
  });
  document.querySelector("#settings-shortcut").onclick = () =>
    setPage("settings");
  window.App = {
    back() {
      if (document.querySelector("#modal-root").children.length) closeModal();
      else setPage("home");
    },
  };
  Native.call("load")
    .then((loaded) => {
      state = { ...C.empty(), ...loaded };
      state.events ||= [];
      state.reports ||= [];
      render();
    })
    .catch((error) => {
      content.innerHTML =
        '<div class="empty-state">Не удалось открыть локальную базу. Закройте и снова откройте приложение.</div>';
      notify(error.message, true);
    });
})();
