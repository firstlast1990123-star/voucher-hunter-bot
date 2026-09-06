#!/usr/bin/env python3
import os
import time
import logging
from pymongo import MongoClient
from datetime import datetime, timezone
from dotenv import load_dotenv
import config
from telegram_core import send_telegram_message

load_dotenv()

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s')
logger = logging.getLogger("TelegramNotifier")

def get_db():
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        return client[config.DB_NAME]
    except Exception as e:
        logger.error(f"MongoDB connection failed: {e}")
        return None

def main():
    import sys
    db = get_db()
    if db is None:
        return
        logger.error("Không thể kết nối MongoDB, thoát...")
        sys.exit(1)
        
    # Tạo index cho queue
    db.telegram_notification_queue.create_index([("sent", 1), ("eligible_send_at", 1)])
    
    logger.info("Starting Telegram Notifier loop...")
    try:
        while True:
            process_queue(db)
            logger.info("Finished batch. Sleeping for 1 minute...")
            time.sleep(60)
    except KeyboardInterrupt:
        logger.info("Notifier stopped.")
        # Tạo index cho queue nếu chưa có
        db.telegram_notification_queue.create_index([("sent", 1), ("eligible_send_at", 1)])
        
        logger.info("Bắt đầu xử lý hàng đợi thông báo Telegram...")
        sent_count = process_queue(db)
        logger.info(f"Hoàn thành chu kỳ gửi thông báo Telegram. Đã gửi: {sent_count} nhóm.")
        sys.exit(0)
    except Exception as e:
        logger.exception(f"Lỗi khi xử lý hàng đợi Telegram: {e}")
        sys.exit(1)

def process_queue(db):
    try:
        now_str = datetime.now(timezone.utc).isoformat()
        
        # Tìm các record chưa gửi và đến giờ gửi (eligible_send_at <= now)
        unsent = list(db.telegram_notification_queue.find({
            "sent": False,
            "eligible_send_at": {"$lte": now_str}
        }))
        if not unsent:
            return
            return 0
            
        # Gom nhóm theo chat_id
        grouped = {}
        for doc in unsent:
            chat_id = doc.get("chat_id")
            if chat_id not in grouped:
                grouped[chat_id] = []
            grouped[chat_id].append(doc)
            
        for chat_id, docs in grouped.items():
            # Gom các voucher thành 1 tin nhắn
            count = len(docs)
            text = f"🎉 <b>Có {count} mã mới cho các shop bạn theo dõi:</b>\n\n"
            
            for doc in docs:
                merchant = doc.get("merchant", "Shop")
                code = doc.get("voucher_code", "")
                title = doc.get("title", "")
                text += f"🛍️ <b>{merchant}</b>: {code} ({title})\n"
                
            success = send_telegram_message(chat_id, text)
            
            # Cập nhật sent: true kể cả khi fail? User yêu cầu "Nếu gửi cho 1 chat_id bị lỗi -> log lại, không dừng, gửi tiếp"
            # Nếu user block bot thì fail, nên mark sent=true để không gửi lại mãi.
            doc_ids = [d["_id"] for d in docs]
            db.telegram_notification_queue.update_many(
                {"_id": {"$in": doc_ids}},
                {"$set": {"sent": True, "sent_at": datetime.now(timezone.utc).isoformat(), "success": success}}
            )
            
            # Throttle
            time.sleep(0.05)
            
        return len(grouped)
            
    except Exception as e:
        logger.error(f"Error processing queue: {e}")
        return 0

if __name__ == "__main__":
    main()
