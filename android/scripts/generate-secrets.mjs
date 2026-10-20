import { readFileSync, writeFileSync } from "node:fs";
let key = process.env.OPENROUTER_API_KEY || "";
try {
  const text = readFileSync("secrets.properties", "utf8");
  key ||= text.match(/^OPENROUTER_API_KEY\s*=\s*(.*)$/m)?.[1]?.trim() || "";
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (key && !/^sk-or-v1-[a-zA-Z0-9_-]+$/.test(key))
  throw new Error("Invalid key format.");
writeFileSync(
  "build/generated/ru/reputation/audit/BuildSecrets.java",
  `package ru.reputation.audit; final class BuildSecrets { static final String OPENROUTER_KEY = ${JSON.stringify(key)}; }\n`,
  { mode: 0o600 },
);
console.log(
  key
    ? "Local API key included (not printed)."
    : "No bundled key: set it in app settings.",
);
