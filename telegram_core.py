import os
import requests
import logging

logger = logging.getLogger("TelegramCore")

def send_telegram_message(chat_id: str, text: str) -> bool:
    """
    Hàm lõi gửi tin nhắn Telegram. Bọc try/except an toàn.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token or not chat_id:
        logger.warning(f"Thiếu token hoặc chat_id ({chat_id}). Bỏ qua gửi tin nhắn.")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }

    try:
        res = requests.post(url, json=payload, timeout=10)
        res.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        logger.error(f"Lỗi khi gửi Telegram message tới {chat_id}: {e}")
        return False
