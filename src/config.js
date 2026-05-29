function parseBoolean(value, defaultValue = false) {
  if (value == null || value === "") {
    return defaultValue;
  }

  return value === "true";
}

function parseInteger(value, fieldName, defaultValue) {
  if (value == null || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${fieldName} 必须是整数`);
  }

  return parsed;
}

function parseNumber(value, fieldName, defaultValue) {
  if (value == null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${fieldName} 必须是数字`);
  }

  return parsed;
}

function getRequired(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`缺少必要环境变量: ${name}`);
  }

  return value;
}

function getLlmConfig() {
  const enabled = parseBoolean(process.env.LLM_ENABLED, false);
  const provider = process.env.LLM_PROVIDER ?? "deepseek";

  if (!enabled) {
    return {
      enabled,
      provider,
      timeoutMs: parseInteger(process.env.LLM_TIMEOUT_MS, "LLM_TIMEOUT_MS", 20000),
      temperature: parseNumber(process.env.LLM_TEMPERATURE, "LLM_TEMPERATURE", 0.2),
      maxNotesChars: parseInteger(
        process.env.LLM_MAX_NOTES_CHARS,
        "LLM_MAX_NOTES_CHARS",
        12000
      ),
      deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY ?? "",
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
        model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat"
      }
    };
  }

  if (provider !== "deepseek") {
    throw new Error(`当前仅支持 LLM_PROVIDER=deepseek，收到: ${provider}`);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error("启用 LLM 时必须提供 DEEPSEEK_API_KEY");
  }

  return {
    enabled,
    provider,
    timeoutMs: parseInteger(process.env.LLM_TIMEOUT_MS, "LLM_TIMEOUT_MS", 20000),
    temperature: parseNumber(process.env.LLM_TEMPERATURE, "LLM_TEMPERATURE", 0.2),
    maxNotesChars: parseInteger(
      process.env.LLM_MAX_NOTES_CHARS,
      "LLM_MAX_NOTES_CHARS",
      12000
    ),
    deepseek: {
      apiKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat"
    }
  };
}

export function getAppConfig() {
  return {
    githubToken: getRequired("GH_STAR_MONITOR_TOKEN"),
    telegramBotToken: getRequired("TELEGRAM_BOT_TOKEN"),
    telegramChatId: getRequired("TELEGRAM_CHAT_ID"),
    sendEmptySummary: parseBoolean(process.env.SEND_EMPTY_SUMMARY, false),
    llm: getLlmConfig()
  };
}
