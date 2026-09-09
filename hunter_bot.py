#!/usr/bin/env python3
"""
Hunter Bot - Thu thập dữ liệu voucher thô
Chạy độc lập, thu thập từ AccessTrade và Whitelist sites, đẩy vào MongoDB (pending_vouchers).
"""

import re
import time
import requests
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure

import config
from notify_admin import notify_admin

# Cấu hình logging ra console
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("HunterBot")

def get_db():
    """Kết nối MongoDB"""
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        return client[config.DB_NAME]
    except ConnectionFailure as e:
        logger.error(f"Không thể kết nối MongoDB: {e}")
        return None
    except Exception as e:
        logger.error(f"Lỗi MongoDB: {e}")
        return None

def parse_discount(discount_str):
    if not discount_str:
        return "fixed", 0, None
    d_str = str(discount_str).lower().replace('.', '').replace(',', '')
    percent_match = re.search(r'(\d+)%', d_str)
    if percent_match:
        max_val = None
        max_match = re.search(r'tối đa\s*(\d+)(k|đ)?', d_str)
        if max_match:
            num, unit = float(max_match.group(1)), max_match.group(2)
            max_val = num * 1000 if unit == 'k' else num
        return "percent", float(percent_match.group(1)), max_val
    fixed_match = re.search(r'(\d+)(k|đ)?', d_str)
    if fixed_match:
        num, unit = float(fixed_match.group(1)), fixed_match.group(2)
        if unit == 'k' or (num < 1000 and not unit):
            num *= 1000
        return "fixed", num, None
    return "fixed", 0, None

def fetch_accesstrade(db) -> tuple[int, Optional[str]]:
    """Lấy voucher từ AccessTrade API"""
    if not config.ACCESSTRADE_API_KEY:
        msg = "Chưa cấu hình ACCESSTRADE_API_KEY trong .env / GitHub Secrets"
        logger.warning(msg)
        return 0, msg

    headers = {
        "Authorization": f"Token {config.ACCESSTRADE_API_KEY}",
        "Content-Type": "application/json"
    }

    raw_coupons = []
    last_err = None

    # Retry mechanism
    for attempt in range(3):
        try:
            logger.info(f"Đang gọi AccessTrade API (lần thử {attempt + 1}/3)...")
            res = requests.get(
                f"{config.ACCESSTRADE_ENDPOINT}?merchant=shopee&limit=100",
                headers=headers,
                timeout=15
            )
            res.raise_for_status()
            data = res.json()
            raw_coupons = data.get("data", [])
            last_err = None
            break
        except requests.exceptions.Timeout:
            last_err = "AccessTrade API Timeout: Hết thời gian chờ phản hồi"
            logger.error(f"[Lần thử {attempt + 1}] {last_err}")
        except requests.exceptions.ConnectionError:
            last_err = "AccessTrade API Connection Error: Lỗi kết nối mạng"
            logger.error(f"[Lần thử {attempt + 1}] {last_err}")
        except requests.exceptions.HTTPError as e:
            status_code = e.response.status_code if e.response is not None else "Unknown"
            if status_code == 401:
                last_err = "AccessTrade API HTTP 401: API Key không hợp lệ hoặc hết hạn"
            elif status_code == 403:
                last_err = "AccessTrade API HTTP 403: Quyền truy cập bị từ chối (có thể chiến dịch Shopee chưa được duyệt hoặc sai token)"
            elif status_code == 404:
                last_err = "AccessTrade API HTTP 404: Endpoint không tồn tại"
            else:
                resp_text = e.response.text[:100] if e.response is not None else str(e)
                last_err = f"AccessTrade API HTTP {status_code}: {resp_text}"
            logger.error(f"[Lần thử {attempt + 1}] {last_err}")
            # Các lỗi 401/403/404 thử lại vô ích, break luôn
            if status_code in (401, 403, 404):
                break
        except Exception as e:
            last_err = f"Lỗi không xác định khi gọi AccessTrade: {e}"
            logger.exception(f"[Lần thử {attempt + 1}] {last_err}")

        if attempt < 2:
            time.sleep(2 ** attempt)  # Exponential backoff

    if last_err:
        logger.error(f"Thất bại khi thu thập từ AccessTrade: {last_err}")
        return 0, last_err

    if not raw_coupons:
        logger.warning("AccessTrade API trả về danh sách rỗng (có thể tài khoản chưa liên kết chiến dịch Shopee hoặc chưa có ưu đãi mới)")

    count_inserted = 0
    count_skipped = 0
    now = datetime.now(timezone.utc)

    for c in raw_coupons:
        try:
            # Hỗ trợ cả định dạng mảng coupons lẫn coupon_code trực tiếp
            code_list = c.get("coupons", [])
            code = code_list[0].get("coupon_code", "") if code_list else (c.get("coupon_code") or c.get("code") or "")
            if not code:
                continue

            merchant = "Shopee"

            # Kiểm tra trùng lặp
            # Giả định nếu fetched_at cách đây dưới 24h thì không thêm lại
            yesterday = now - timedelta(days=1)
            exists = db.pending_vouchers.find_one({
                "code": code,
                "merchant": merchant,
                "fetched_at": {"$gte": yesterday.isoformat()}
            })

            if exists:
                count_skipped += 1
                continue

            min_amount = c.get("min_amount")

            # Chuẩn hóa end_time, start_time về ISO có Z
            end_time = c.get("end_time")
            start_time = c.get("start_time")

            landing_url = c.get("link") or c.get("aff_link") or "https://shopee.vn"
            voucher_type = 'code' if code and len(code) < 30 and 'http' not in code else 'deeplink'

            discount_raw = c.get("discount") or c.get("max_discount")
            dtype, dval, dmax = parse_discount(discount_raw)

            doc = {
                "source": "accesstrade",
                "merchant": merchant,
                "code": code,
                "title": c.get("name") or c.get("title") or "",
                "voucher_type": voucher_type,
                "discount_type": dtype,
                "discount_value": dval,
                "discount_max_value": dmax,
                "min_order_value": float(min_amount) if min_amount is not None else 0.0,
                "valid_from": start_time,
                "valid_to": end_time,
                "remain_count": int(c.get("remain")) if c.get("remain") is not None else None,
                "landing_url": landing_url,
                "raw_payload": c,
                "fetched_at": now.isoformat(),
                "retry_count": 0
            }

            db.pending_vouchers.insert_one(doc)
            count_inserted += 1
        except Exception as e:
            logger.error(f"Lỗi parse dữ liệu AccessTrade: {e}")
            continue

    logger.info(f"[AccessTrade] Thêm mới: {count_inserted} | Bỏ qua (trùng): {count_skipped}")
    return count_inserted, None

def fetch_whitelist(db) -> tuple[int, Optional[str]]:
    """
    Thu thập voucher từ các trang web whitelist công khai.
    Hiện tại chưa có trang whitelist cụ thể nào được cấu hình,
    ghi log rõ ràng và bỏ qua bước này thay vì im lặng pass.
    """
    real_urls = [
        u for u in getattr(config, 'WHITELIST_URLS', [])
        if "example-coupon-site.com" not in u and "another-promo-site.net" not in u
    ]

    if not real_urls:
        logger.info("Chưa cấu hình trang whitelist thật, bỏ qua bước này")
        return 0, None

    total_inserted = 0
    errors = []
    for url in real_urls:
        try:
            logger.info(f"Chưa cấu hình parser cho trang {url}, bỏ qua bước này")
        except Exception as e:
            err_msg = f"Lỗi cào whitelist {url}: {e}"
            logger.error(err_msg)
            errors.append(err_msg)

    combined_err = "; ".join(errors) if errors else None
    return total_inserted, combined_err

def main():
    logger.info("Khởi động Hunter Bot...")

    db = get_db()
    if db is None:
        logger.error("Không kết nối được DB, thoát...")
        import sys
        sys.exit(1)

    try:
        now = datetime.now(timezone.utc).isoformat()

        # Ghi heartbeat trước khi bắt đầu
        try:
            db.bot_health.update_one(
                {"_id": "hunter_bot"},
                {"$set": {
                    "last_heartbeat_at": now,
                    "cycle_count": 1
                }},
                upsert=True
            )
        except Exception as e:
            logger.error(f"Lỗi ghi heartbeat: {e}")

        logger.info("="*50)
        logger.info("Bắt đầu chu kỳ thu thập dữ liệu...")

        collected_errors = []
        total_inserted = 0

        # 1. Thu thập từ AccessTrade
        try:
            at_inserted, at_error = fetch_accesstrade(db)
            total_inserted += at_inserted
            if at_error:
                collected_errors.append(at_error)
        except Exception as e:
            err_msg = f"Lỗi nghiêm trọng AccessTrade: {e}"
            logger.exception(err_msg)
            collected_errors.append(err_msg)

        # 2. Thu thập từ Whitelist Sites (vẫn chạy kể cả khi AccessTrade lỗi)
        try:
            wl_inserted, wl_error = fetch_whitelist(db)
            total_inserted += wl_inserted
            if wl_error:
                collected_errors.append(wl_error)
        except Exception as e:
            err_msg = f"Lỗi nghiêm trọng Whitelist: {e}"
            logger.exception(err_msg)
            collected_errors.append(err_msg)

        final_error_message = "; ".join(collected_errors) if collected_errors else None

        # Xác định trạng thái kết quả chu kỳ:
        # Nếu có lỗi và không thêm được mã nào -> "error"
        # Nếu có lỗi nhưng vẫn thêm được mã từ nguồn khác -> "partial_error"
        # Nếu không có lỗi -> "success"
        if collected_errors:
            cycle_result = "error" if total_inserted == 0 else "partial_error"
        else:
            cycle_result = "success"

        # Ghi kết quả vào bot_health
        try:
            db.bot_health.update_one(
                {"_id": "hunter_bot"},
                {"$set": {
                    "last_cycle_result": cycle_result,
                    "last_error_message": final_error_message,
                    "last_vouchers_inserted": total_inserted,
                    "last_completed_at": datetime.now(timezone.utc).isoformat()
                }},
                upsert=True
            )
        except Exception as e:
            logger.error(f"Lỗi cập nhật kết quả heartbeat: {e}")

        logger.info(f"Hoàn thành chu kỳ. Kết quả: {cycle_result} | Thêm mới: {total_inserted} mã | Lỗi: {final_error_message or 'Không có'}")

        import sys
        if cycle_result == "error":
            logger.error(f"Chu kỳ thất bại: {final_error_message}")
            sys.exit(1)
        sys.exit(0)

    except Exception as e:
        logger.exception(f"Lỗi crash bot: {e}")
        notify_admin("Hunter Bot Crash", f"Bot đã dừng hoạt động do lỗi không thể phục hồi:\n{e}", priority="urgent")
        import sys
        sys.exit(1)

if __name__ == "__main__":
    main()
