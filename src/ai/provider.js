import { createDeepSeekProvider } from "./deepseek.js";

export function createAiProvider(llmConfig) {
  if (llmConfig.provider === "deepseek") {
    return createDeepSeekProvider(llmConfig);
  }

  throw new Error(`不支持的 LLM_PROVIDER: ${llmConfig.provider}`);
}
