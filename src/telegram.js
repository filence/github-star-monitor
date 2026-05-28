const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

export async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  parseMode = "HTML"
}) {
  const url = `${TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    })
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(`Telegram 消息发送失败: ${JSON.stringify(result)}`);
  }

  return result;
}
