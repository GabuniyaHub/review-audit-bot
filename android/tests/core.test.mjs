import { test } from "node:test";
import assert from "node:assert/strict";
import "../app/src/main/assets/core.js";
const C = globalThis.AuditCore;

test("512 демонстрационных отзывов, четыре организации и полный локальный цикл", () => {
  const state = C.demo();
  assert.equal(state.reviews.length, 512);
  assert.equal(
    state.companies.filter((company) => company.role === "own").length,
    1,
  );
  assert.equal(new Set(state.reviews.map((review) => review.id)).size, 512);
  const started = performance.now();
  const results = state.reviews.map(C.localAnalyze);
  C.validateBatch(
    results,
    state.reviews.map((review) => ({
      reviewId: review.id,
      text: C.redact(review.text),
    })),
  );
  C.applyBatch(state, results, "local");
  const report = C.report(state);
  assert.equal(report.entries.length, 4);
  assert.equal(
    report.entries.reduce((sum, entry) => sum + entry.metrics.analyzed, 0),
    512,
  );
  assert.ok(report.warnings.some((warning) => warning.includes("вымышленные")));
  assert.ok(
    report.warnings.some((warning) => warning.includes("а не нейросеть")),
  );
  assert.ok(report.recommendations.length > 0);
  for (const action of report.recommendations) {
    assert.ok(action.evidence.length > 0);
    for (const evidence of action.evidence)
      assert.ok(
        C.redact(
          state.reviews.find((review) => review.id === evidence.reviewId).text,
        ).includes(evidence.quote),
      );
  }
  assert.match(C.markdown(report), /Локальный алгоритм \(без ИИ\)/);
  console.log(
    `512-review local pipeline: ${Math.round(performance.now() - started)} ms (not LLM).`,
  );
});
test("проверка карточек блокирует другой домен и принимает конкретный филиал", () => {
  assert.equal(
    C.cardId("https://yandex.ru/maps/org/coffee/123456789/reviews/", "yandex"),
    "123456789",
  );
  assert.equal(
    C.cardId("https://2gis.ru/tyumen/firm/123456789", "2gis"),
    "123456789",
  );
  assert.throws(() =>
    C.cardId("https://yandex.ru.evil.example/maps/org/12345", "yandex"),
  );
  assert.throws(() => C.cardId("http://yandex.ru/maps/org/12345", "yandex"));
  assert.throws(() => C.cardId("https://yandex.ru/maps/search/кофе", "yandex"));
});
test("импорт дедуплицирует и инвалидирует анализ изменённого текста", () => {
  const state = C.demo();
  const original = state.reviews[0];
  C.applyBatch(state, [C.localAnalyze(original)], "local");
  const duplicate = C.mergeReviews(state, [original]);
  assert.equal(duplicate.duplicates, 1);
  assert.equal(state.reviews.length, 512);
  const result = C.mergeReviews(state, [
    { ...original, text: "изменённый отзыв, обслуживание плохое" },
  ]);
  assert.equal(result.updated, 1);
  assert.equal(state.reviews[0].analysis, null);
});
test("неправильный импорт не меняет проект частично", () => {
  const state = C.demo(),
    before = JSON.stringify(state);
  assert.throws(() =>
    C.mergeReviews(state, [
      { ...state.reviews[0], text: "новый текст" },
      { text: "нет компании", companyId: "missing" },
    ]),
  );
  assert.equal(JSON.stringify(state), before);
  assert.throws(() =>
    C.mergeReviews(state, [{ ...state.reviews[0], rating: 10 }]),
  );
});
test("неподтверждённые цитаты, чужие и повторные ID отклоняются", () => {
  const input = [{ reviewId: "one", text: "кофе вкусный" }];
  const valid = {
    reviewId: "one",
    sentiment: "positive",
    topics: [{ topic: "product", sentiment: "positive", evidence: "вкусный" }],
  };
  C.validateBatch([valid], input);
  assert.throws(() =>
    C.validateBatch([{ ...valid, reviewId: "wrong" }], input),
  );
  assert.throws(() =>
    C.validateBatch(
      [
        {
          ...valid,
          topics: [
            {
              topic: "product",
              sentiment: "positive",
              evidence: "придуманная цитата",
            },
          ],
        },
      ],
      input,
    ),
  );
  assert.throws(() => C.validateBatch([valid, valid], input));
});
test("смена режима не выдаёт локальные результаты за ИИ", () => {
  const state = C.demo();
  C.applyBatch(state, [C.localAnalyze(state.reviews[0])], "local");
  assert.ok(C.currentAnalysis(state.reviews[0], "local"));
  assert.equal(C.currentAnalysis(state.reviews[0], "openrouter"), false);
  state.engine = "openrouter";
  assert.throws(() => C.report(state));
});
test("период исключает неизвестную дату, средние считает код", () => {
  const state = C.demo();
  state.reviews = state.reviews.slice(0, 2);
  state.reviews[0].publishedAt = null;
  state.reviews[0].rating = 1;
  state.reviews[1].rating = 5;
  C.applyBatch(state, state.reviews.map(C.localAnalyze), "local");
  assert.equal(C.stats(state, state.companies[0].id).average, 3);
  const result = C.stats(state, state.companies[0].id, {
    from: "2026-09-01",
    to: "2026-09-30",
  });
  assert.equal(result.total, 1);
  assert.equal(result.average, 5);
  assert.equal(result.unknownDates, 1);
  assert.throws(() =>
    C.report(state, { from: "2026-10-20", to: "2026-01-01" }),
  );
});
test("персональные маркеры не попадают в отправляемый текст", () => {
  const text = C.redact(
    "Иван написал test@example.org +7 (999) 123-45-67 https://example.org @nickname",
  );
  for (const value of [
    "Иван",
    "test@example.org",
    "999",
    "example.org",
    "nickname",
  ])
    assert.ok(!text.includes(value));
});
