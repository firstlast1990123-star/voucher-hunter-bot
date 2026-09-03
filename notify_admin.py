import os
import logging
from telegram_core import send_telegram_message

logger = logging.getLogger("NotifyAdmin")

def notify_admin(title: str, message: str, priority: str = "default"):
    """
    Gửi cảnh báo tới Telegram admin qua Bot API.
    priority: 'default' | 'high' | 'urgent' (🔵 / 🟡 / 🔴)
    """
    chat_id = os.environ.get("TELEGRAM_ADMIN_CHAT_ID")
    
    if not chat_id:
        logger.warning("TELEGRAM_ADMIN_CHAT_ID chưa được cấu hình. Bỏ qua gửi thông báo.")
        return

    emoji = "🔵"
    if priority == "high":
        emoji = "🟡"
    elif priority == "urgent":
        emoji = "🔴"

    text = f"{emoji} <b>{title}</b>\n\n{message}"
    send_telegram_message(chat_id, text)

# TODO: notify_user(chat_id, message) cho tính năng báo mã mới, cần bảng user_telegram_subscriptions
