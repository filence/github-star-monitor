function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    }
  };
}

function shouldRetry(error) {
  return error?.name === "AbortError" || error?.status === 429 || error?.status >= 500;
}

async function requestDeepSeek({ baseUrl, apiKey, model, timeoutMs, temperature, prompt }) {
  const { signal, cleanup } = createTimeoutController(timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      signal
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`DeepSeek 请求失败 (${response.status} ${response.statusText}): ${text}`);
      error.status = response.status;
      throw error;
    }

    const result = await response.json();
    return result?.choices?.[0]?.message?.content ?? "";
  } finally {
    cleanup();
  }
}

export function createDeepSeekProvider(llmConfig) {
  const { deepseek } = llmConfig;

  return {
    async generateText(prompt) {
      let attempt = 0;
      let lastError;

      while (attempt < 2) {
        try {
          return await requestDeepSeek({
            baseUrl: deepseek.baseUrl,
            apiKey: deepseek.apiKey,
            model: deepseek.model,
            timeoutMs: llmConfig.timeoutMs,
            temperature: llmConfig.temperature,
            prompt
          });
        } catch (error) {
          lastError = error;

          if (!shouldRetry(error) || attempt === 1) {
            throw lastError;
          }
        }

        attempt += 1;
      }

      throw lastError;
    }
  };
}
