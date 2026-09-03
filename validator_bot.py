#!/usr/bin/env python3
"""
Validator Bot - Kiểm duyệt và xuất bản voucher
Nguyên tắc "fail-closed", chỉ publish các mã chắc chắn hợp lệ.
Bao gồm cơ chế Re-check ưu tiên mã sắp hết hạn.
"""

import time
import requests
import logging
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

import config
import voucher_validator_core
from notify_admin import notify_admin

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
logger = logging.getLogger("ValidatorBot")
MAX_RETRY_ATTEMPTS = 3

def get_db():
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
        return client[config.DB_NAME]
    except Exception as e:
        return None

def process_pending_vouchers(db):
    cursor = db.pending_vouchers.find({})
    for voucher in cursor:
        doc_id, code, merchant = voucher['_id'], voucher.get('code'), voucher.get('merchant')
        
        try:
            is_valid, reason = voucher_validator_core.validate_voucher_core(voucher, db, "validator_bot")
            
            if is_valid:
                # Kiểm tra xem mã này đã từng có trong live_vouchers chưa
                existing = db.live_vouchers.find_one({"code": code})
                is_new_publish = existing is None
                
                db.live_vouchers.update_one(
                    {"code": code},
                    {"$set": {
                        "merchant": merchant,
                        "code": code,
                        "title": voucher.get('title'),
                        "voucher_type": voucher.get('voucher_type'),
                        "discount_type": voucher.get('discount_type'),
                        "discount_value": voucher.get('discount_value'),
                        "discount_max_value": voucher.get('discount_max_value'),
                        "min_order_value": voucher.get('min_order_value'),
                        "valid_to": voucher.get('valid_to'),
                        "remain_count": voucher.get('remain_count'),
                        "landing_url": voucher.get('landing_url'),
                        "verified_at": datetime.now(timezone.utc).isoformat(),
                        "published_at": datetime.now(timezone.utc).isoformat(),
                        "status": "live"
                    }},
                    upsert=True
                )
                logger.info(f"[ĐÃ XUẤT BẢN - MÃ XÀI ĐƯỢC] Mã: {code} | Merchant: {merchant} | HSD: {voucher.get('valid_to')}")
                
                # Nếu là mã mới hoàn toàn -> Trigger hàng đợi thông báo Telegram
                if is_new_publish:
                    subs = list(db.telegram_subscriptions.find({"merchant": merchant}))
                    if subs:
                        now_str = datetime.now(timezone.utc).isoformat()
                        published_at = datetime.now(timezone.utc)
                        delayed_time = (published_at + timedelta(minutes=config.VIP_EARLY_ACCESS_MINUTES)).isoformat()
                        
                        queue_docs = []
                        for sub in subs:
                            is_vip = False
                            user_id = sub.get("user_id")
                            if user_id:
                                user = db.users.find_one({"_id": user_id})
                                if user and user.get("membership") == "vip":
                                    vip_expired = user.get("vip_expired_at")
                                    if vip_expired:
                                        vip_expired_dt = voucher_validator_core.parse_iso_datetime(vip_expired)
                                        if vip_expired_dt and vip_expired_dt > datetime.now(timezone.utc):
                                            is_vip = True
                                            
                            priority = "instant" if is_vip else "delayed"
                            eligible_send_at = now_str if is_vip else delayed_time
                            
                            queue_docs.append({
                                "chat_id": sub["chat_id"],
                                "voucher_code": code,
                                "title": voucher.get('title'),
                                "merchant": merchant,
                                "priority": priority,
                                "eligible_send_at": eligible_send_at,
                                "created_at": now_str,
                                "sent": False
                            })
                        db.telegram_notification_queue.insert_many(queue_docs)
                        logger.info(f"Đã thêm {len(subs)} task báo mã mới vào queue.")
            else:
                logger.info(f"[ĐÃ LOẠI BỎ] Mã: {code} | Lý do: {reason}")
                
            db.pending_vouchers.delete_one({"_id": doc_id})
                
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            retry_count = voucher.get('retry_count', 0) + 1
            if retry_count >= MAX_RETRY_ATTEMPTS:
                logger.info(f"[ĐÃ LOẠI BỎ] Mã: {code} | Lý do: Quá số lần thử lại mạng")
                db.pending_vouchers.delete_one({"_id": doc_id})
            else:
                db.pending_vouchers.update_one({"_id": doc_id}, {"$set": {"retry_count": retry_count}})

def process_priority_queue(db):
    """Xử lý hàng đợi VIP ưu tiên"""
    now = datetime.now(timezone.utc)
    queue = list(db.priority_recheck_queue.find({}))
    if not queue:
        return
        
    logger.info(f"Đang xử lý {len(queue)} mã trong priority queue...")
    removed = 0
    for q in queue:
        code = q['_id']
        voucher = db.live_vouchers.find_one({"code": code, "status": "live"})
        if voucher:
            try:
                is_valid, reason = voucher_validator_core.validate_voucher_core(voucher, db, "priority_recheck")
                if is_valid:
                    db.live_vouchers.update_one(
                        {"_id": voucher['_id']},
                        {"$set": {"verified_at": now.isoformat()}}
                    )
                else:
                    db.live_vouchers.delete_one({"_id": voucher['_id']})
                    logger.info(f"[GỠ BỎ - PRIORITY RE-CHECK] Mã: {code} | Lý do: {reason}")
                    removed += 1
            except Exception as e:
                logger.error(f"Lỗi priority check mã {code}: {e}")
        # Xoá khỏi queue sau khi xử lý (kể cả không tìm thấy voucher)
        db.priority_recheck_queue.delete_one({"_id": code})
        
    if removed > 0:
        logger.info(f"[Priority Re-check] Đã gỡ bỏ {removed} mã hỏng.")

def recheck_live_vouchers(db):
    """Ưu tiên quét lại mã sắp hết hạn đã có trong live_vouchers"""
    now = datetime.now(timezone.utc)
    cursor = db.live_vouchers.find({"status": "live"})
    
    recheck_count = 0
    removed_count = 0
    
    for voucher in cursor:
        valid_to = voucher_validator_core.parse_iso_datetime(voucher.get('valid_to'))
        verified_at = voucher_validator_core.parse_iso_datetime(voucher.get('verified_at'))
        
        if not valid_to or not verified_at:
            continue
            
        time_to_expire = (valid_to - now).total_seconds()
        time_since_verify = (now - verified_at).total_seconds()
        
        # Bỏ qua nếu mới được verify trong 2 phút gần nhất (validate-on-click)
        if time_since_verify < 120:
            continue
            
        # Xác định ngưỡng re-check
        needs_check = False
        if time_to_expire < 6 * 3600:
            if time_since_verify > 10 * 60:
                needs_check = True
        elif time_to_expire < 24 * 3600:
            if time_since_verify > 30 * 60:
                needs_check = True
        else:
            if time_since_verify > 2 * 3600:
                needs_check = True
                
        if needs_check:
            recheck_count += 1
            code = voucher.get('code')
            try:
                is_valid, reason = voucher_validator_core.validate_voucher_core(voucher, db, "recheck_periodic")
                if is_valid:
                    db.live_vouchers.update_one(
                        {"_id": voucher['_id']},
                        {"$set": {"verified_at": now.isoformat()}}
                    )
                else:
                    db.live_vouchers.delete_one({"_id": voucher['_id']})
                    logger.info(f"[GỠ BỎ - RE-CHECK ĐỊNH KỲ] Mã: {code} | Lý do: {reason}")
                    removed_count += 1
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
                pass # Bỏ qua chờ lượt sau
            except Exception as e:
                logger.error(f"Lỗi recheck mã {code}: {e}")
                
    if recheck_count > 0:
        logger.info(f"[Re-check] Đã quét lại {recheck_count} mã. Gỡ bỏ: {removed_count} mã.")

last_stats_update = 0
def update_site_stats(db):
    global last_stats_update
    now = time.time()
    # Chạy mỗi giờ
    if now - last_stats_update < 3600:
        return
    try:
        past_7_days = datetime.fromtimestamp(now - 7 * 86400, timezone.utc).isoformat()
        total = db.verification_logs.count_documents({"checked_at": {"$gte": past_7_days}})
        valid = db.verification_logs.count_documents({"checked_at": {"$gte": past_7_days}, "result": "valid"})
        
        rate = (valid / total * 100) if total > 0 else 0
        
        db.site_stats.update_one(
            {"_id": "global_stats"},
            {"$set": {
                "success_rate": round(rate, 1),
                "period_days": 7,
                "low_sample": total < 30,
                "total_checks": total,
                "last_updated": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
        logger.info(f"Đã cập nhật site_stats: {rate}% ({valid}/{total})")
        last_stats_update = now
    except Exception as e:
        logger.error(f"Lỗi cập nhật site_stats: {e}")

def main():
    logger.info("Khởi động Validator Bot...")
    db = None
    while not db:
        db = get_db()
        if not db: time.sleep(5)
            
    cycle_count = 0
    try:
        while True:
            cycle_count += 1
            now = datetime.now(timezone.utc).isoformat()
            
            try:
                db.bot_health.update_one(
                    {"_id": "validator_bot"},
                    {"$set": {
                        "last_heartbeat_at": now,
                        "cycle_count": cycle_count
                    }},
                    upsert=True
                )
            except Exception as e:
                logger.error(f"Lỗi ghi heartbeat: {e}")
                
            error_message = None
            try:
                update_site_stats(db)
                process_priority_queue(db)
                process_pending_vouchers(db)
                recheck_live_vouchers(db)
            except Exception as e:
                error_message = str(e)
                logger.exception("Lỗi trong chu kỳ kiểm duyệt")
                
            try:
                db.bot_health.update_one(
                    {"_id": "validator_bot"},
                    {"$set": {
                        "last_cycle_result": "error" if error_message else "success",
                        "last_error_message": error_message
                    }},
                    upsert=True
                )
            except Exception as e:
                logger.error(f"Lỗi cập nhật kết quả heartbeat: {e}")
                
            time.sleep(config.VALIDATOR_INTERVAL)
    except KeyboardInterrupt:
        logger.info("Tắt Validator Bot...")
    except Exception as e:
        logger.exception(f"Lỗi crash bot: {e}")
        notify_admin("Validator Bot Crash", f"Bot đã dừng hoạt động do lỗi không thể phục hồi:\n{e}", priority="urgent")

if __name__ == "__main__":
    main()
