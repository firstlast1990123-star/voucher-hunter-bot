#!/usr/bin/env python3
"""
Telegram Notifier - Xử lý hàng đợi thông báo người dùng
Chạy theo chu kỳ (GitHub Actions cron 2 phút), gom nhóm và gửi tin nhắn Telegram.
"""
import sys
import time
import logging
from pymongo import MongoClient
from datetime import datetime, timezone
from dotenv import load_dotenv

import config
from telegram_core import send_telegram_message
from notify_admin import notify_admin

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("TelegramNotifier")

def get_db():
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        return client[config.DB_NAME]
    except Exception as e:
        logger.error(f"Không thể kết nối MongoDB: {e}")
        return None

def process_queue(db) -> tuple[int, list[str]]:
    """
    Quét và gửi các thông báo trong hàng đợi đến giờ gửi.
    Trả về: (số nhóm gửi thành công, danh sách lỗi nếu có)
    """
    now_str = datetime.now(timezone.utc).isoformat()
    errors = []
    success_count = 0

    # 1. Tìm các bản ghi chưa gửi và đã đến hạn (eligible_send_at <= now)
    unsent = list(db.telegram_notification_queue.find({
        "sent": False,
        "eligible_send_at": {"$lte": now_str}
    }))

    if not unsent:
        logger.info("Không có thông báo nào cần gửi trong chu kỳ này.")
        return 0, []

    logger.info(f"Tìm thấy {len(unsent)} bản ghi voucher cần gửi thông báo.")

    # 2. Gom nhóm theo chat_id
    grouped = {}
    for doc in unsent:
        chat_id = doc.get("chat_id")
        if not chat_id:
            continue
        if chat_id not in grouped:
            grouped[chat_id] = []
        grouped[chat_id].append(doc)

    logger.info(f"Đã gom thành {len(grouped)} nhóm người nhận (chat_id).")

    # 3. Gửi tin nhắn cho từng chat_id
    for chat_id, docs in grouped.items():
        count = len(docs)
        text = f"🎉 <b>Có {count} mã mới cho các shop bạn theo dõi:</b>\n\n"

        for doc in docs:
            merchant = doc.get("merchant", "Shop")
            code = doc.get("voucher_code", "")
            title = doc.get("title", "")
            text += f"🛍️ <b>{merchant}</b>: {code} ({title})\n"

        doc_ids = [d["_id"] for d in docs]
        send_time = datetime.now(timezone.utc).isoformat()

        try:
            success = send_telegram_message(chat_id, text)
            if success:
                success_count += 1
                db.telegram_notification_queue.update_many(
                    {"_id": {"$in": doc_ids}},
                    {"$set": {
                        "sent": True,
                        "sent_at": send_time,
                        "success": True
                    }}
                )
                logger.info(f"✅ Gửi thành công {count} mã cho chat_id {chat_id}")
            else:
                err_detail = f"Gửi thất bại cho chat_id {chat_id} (send_telegram_message trả về False)"
                logger.warning(err_detail)
                errors.append(err_detail)
                # Đánh dấu sent: True, success: False để không retry vô tận nếu bot bị chặn
                db.telegram_notification_queue.update_many(
                    {"_id": {"$in": doc_ids}},
                    {"$set": {
                        "sent": True,
                        "sent_at": send_time,
                        "success": False,
                        "error": "Gửi thất bại hoặc người dùng đã chặn bot"
                    }}
                )
        except Exception as send_err:
            err_detail = f"Lỗi ngoại lệ gửi tin nhắn chat_id {chat_id}: {send_err}"
            logger.exception(err_detail)
            errors.append(err_detail)
            db.telegram_notification_queue.update_many(
                {"_id": {"$in": doc_ids}},
                {"$set": {
                    "sent": True,
                    "sent_at": send_time,
                    "success": False,
                    "error": str(send_err)
                }}
            )

        # Throttle 0.05s để tránh Telegram API rate limit
        time.sleep(0.05)

    return success_count, errors

def main():
    logger.info("=" * 50)
    logger.info("Bắt đầu chu kỳ xử lý Telegram Notifier (One-shot)...")

    db = get_db()
    if db is None:
        logger.error("Không thể kết nối MongoDB, thoát...")
        sys.exit(1)

    # Tạo index cho hàng đợi nếu chưa có
    try:
        db.telegram_notification_queue.create_index([("sent", 1), ("eligible_send_at", 1)])
    except Exception as idx_err:
        logger.warning(f"Lỗi tạo index cho telegram_notification_queue: {idx_err}")

    # Ghi nhận heartbeat bắt đầu chu kỳ
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        db.bot_health.update_one(
            {"_id": "telegram_notifier"},
            {"$set": {"last_heartbeat": now_iso}},
            upsert=True
        )
    except Exception as hb_err:
        logger.warning(f"Lỗi ghi heartbeat ban đầu: {hb_err}")

    try:
        success_count, errors = process_queue(db)
        final_completed_at = datetime.now(timezone.utc).isoformat()

        # Xác định kết quả chu kỳ
        if errors:
            cycle_result = "error" if success_count == 0 else "partial_error"
            error_message = "; ".join(errors)
        else:
            cycle_result = "success"
            error_message = None

        # Cập nhật kết quả chu kỳ vào bot_health
        db.bot_health.update_one(
            {"_id": "telegram_notifier"},
            {"$set": {
                "last_cycle_result": cycle_result,
                "last_error_message": error_message,
                "last_notifications_sent": success_count,
                "last_completed_at": final_completed_at
            }},
            upsert=True
        )

        logger.info(
            f"Hoàn thành chu kỳ. Kết quả: {cycle_result} | Đã gửi: {success_count} nhóm | Lỗi: {error_message or 'Không có'}"
        )

        if cycle_result == "error" and errors:
            logger.error(f"Chu kỳ thất bại: {error_message}")
            sys.exit(1)

        sys.exit(0)

    except Exception as e:
        err_str = f"Lỗi crash Telegram Notifier: {e}"
        logger.exception(err_str)
        try:
            db.bot_health.update_one(
                {"_id": "telegram_notifier"},
                {"$set": {
                    "last_cycle_result": "error",
                    "last_error_message": err_str,
                    "last_completed_at": datetime.now(timezone.utc).isoformat()
                }},
                upsert=True
            )
        except Exception:
            pass

        notify_admin("Telegram Notifier Crash", f"Bot gặp lỗi nghiêm trọng:\n{e}", priority="urgent")
        sys.exit(1)

if __name__ == "__main__":
    main()
