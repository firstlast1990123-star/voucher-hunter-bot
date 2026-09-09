#!/usr/bin/env python3
import os
import logging
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
import config
from notify_admin import notify_admin

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s')
logger = logging.getLogger("CleanupLogs")

def get_db():
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        return client[config.DB_NAME]
    except Exception as e:
        logger.error(f"MongoDB connection failed: {e}")
        return None

def main():
    logger.info("Khởi động Cleanup Logs...")

    db = get_db()
    if db is None:
        logger.error("Không kết nối được DB, thoát...")
        import sys
        sys.exit(1)

    dry_run = os.getenv("DRY_RUN", "true").lower() == "true"
    if dry_run:
        logger.info("=== CHẾ ĐỘ DRY_RUN: Chỉ đếm, không xóa ===")

    now = datetime.now(timezone.utc)

    # Nhóm A
    tasks = [
        {
            "collection": "verification_logs",
            "filter": {"checked_at": {"$lt": (now - timedelta(days=90)).isoformat()}},
            "desc": "bản ghi cũ hơn 90 ngày"
        },
        {
            "collection": "telegram_notification_queue",
            "filter": {"sent": True, "created_at": {"$lt": (now - timedelta(days=30)).isoformat()}},
            "desc": "bản ghi đã gửi, cũ hơn 30 ngày"
        },
        {
            "collection": "voucher_reports",
            "filter": {"reported_at": {"$lt": (now - timedelta(days=60)).isoformat()}},
            "desc": "bản ghi cũ hơn 60 ngày"
        },
        {
            "collection": "telegram_link_codes",
            "filter": {"$or": [{"used": True}, {"expires_at": {"$lt": (now - timedelta(days=7)).isoformat()}}]},
            "desc": "bản ghi đã dùng hoặc hết hạn quá 7 ngày"
        },
        {
            "collection": "priority_recheck_queue",
            "filter": {"added_at": {"$lt": (now - timedelta(days=3)).isoformat()}},
            "desc": "bản ghi sót lại quá 3 ngày"
        }
    ]

    for task in tasks:
        col_name = task["collection"]
        try:
            count = db[col_name].count_documents(task["filter"])
            if dry_run:
                logger.info(f"[DỌN DẸP - DRY_RUN] {col_name}: sẽ xóa {count} {task['desc']}")
            else:
                if count > 0:
                    res = db[col_name].delete_many(task["filter"])
                    logger.info(f"[DỌN DẸP] {col_name}: đã xóa {res.deleted_count} {task['desc']}")
                else:
                    logger.info(f"[DỌN DẸP] {col_name}: Không có dữ liệu cần xóa ({task['desc']})")
        except Exception as e:
            logger.error(f"Lỗi khi xử lý {col_name}: {e}")

    # Kiểm tra dung lượng
    try:
        stats = db.command("dbStats")
        data_size = stats.get("dataSize", 0) + stats.get("indexSize", 0)
        # Giới hạn 512MB
        limit_bytes = 512 * 1024 * 1024
        used_percent = (data_size / limit_bytes) * 100

        logger.info(f"Dung lượng DB hiện tại: {used_percent:.2f}% ({(data_size / 1024 / 1024):.2f} MB / 512 MB)")

        if used_percent > 80:
            notify_admin(
                "Cảnh báo Dung lượng DB",
                f"⚠️ Database đã dùng {used_percent:.2f}% dung lượng free tier (512MB), cân nhắc nâng cấp hoặc kiểm tra lại dữ liệu.",
                priority="urgent"
            )
    except Exception as e:
        logger.error(f"Lỗi kiểm tra dung lượng DB: {e}")

    logger.info("Hoàn thành Cleanup Logs.")
    import sys
    sys.exit(0)

if __name__ == "__main__":
    main()
