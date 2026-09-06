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
from typing import List, Dict, Any, Optional
from bs4 import BeautifulSoup
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

# ... [Tránh thay đổi mã không cần thiết, nên sửa cụ thể từng block] ...

def parse_discount(discount_str):
    if not discount_str: return "fixed", 0, None
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
        if unit == 'k' or (num < 1000 and not unit): num *= 1000
        return "fixed", num, None
    return "fixed", 0, None

def fetch_accesstrade(db) -> int:
    """Lấy voucher từ AccessTrade API"""
    if not config.ACCESSTRADE_API_KEY:
        logger.warning("Chưa cấu hình ACCESSTRADE_API_KEY")
        return 0

    headers = {
        "Authorization": f"TOKEN {config.ACCESSTRADE_API_KEY}",
        "Content-Type": "application/json"
    }
    
    # Retry mechanism
    for attempt in range(3):
        try:
            logger.info(f"Đang cào AccessTrade (lần thử {attempt + 1})...")
            res = requests.get(
                f"{config.ACCESSTRADE_ENDPOINT}?merchant=shopee&limit=100",
                headers=headers,
                timeout=15
            )
            res.raise_for_status()
            data = res.json()
            raw_coupons = data.get("data", [])
            break
        except requests.exceptions.Timeout:
            logger.error("AccessTrade API Timeout")
        except requests.exceptions.ConnectionError:
            logger.error("AccessTrade API Connection Error")
        except requests.exceptions.HTTPError as e:
            logger.error(f"AccessTrade API HTTP Error: {e.response.status_code}")
        except Exception as e:
            logger.exception(f"Lỗi không xác định khi gọi AccessTrade: {e}")
        
        if attempt < 2:
            time.sleep(2 ** attempt)  # Exponential backoff
        else:
            return 0

    count_inserted = 0
    count_skipped = 0
    now = datetime.now(timezone.utc)

    for c in raw_coupons:
        try:
            code_list = c.get("coupons", [])
            code = code_list[0].get("coupon_code", "") if code_list else ""
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
            
            landing_url = c.get("link") or "https://shopee.vn"
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
    return count_inserted

def scrape_example_coupon_site_com(db, url: str) -> int:
    """Hàm scraper ví dụ cho 1 trang cụ thể"""
    # Vì trang whitelist không có thật, đây là code minh hoạ
    logger.info(f"Đang scrape {url}...")
    try:
        # res = requests.get(url, timeout=10)
        # res.raise_for_status()
        # soup = BeautifulSoup(res.text, 'html.parser')
        # ... logic bóc tách HTML ...
        pass
    except Exception as e:
        logger.error(f"Lỗi cào {url}: {e}")
    """Hàm scraper ví dụ cho 1 trang cụ thể (chưa có cấu hình site thật)"""
    # TODO: Chưa có site whitelist nào được cấu hình, hiện tại chỉ thu thập từ AccessTrade API
    logger.info(f"Bỏ qua scrape {url} (chưa cấu hình parser thực tế)")
    return 0

def fetch_whitelist(db) -> int:
    """Lấy voucher từ các site whitelist bằng requests + bs4"""
    """
    Lấy voucher từ các site whitelist bằng requests + bs4
    TODO: Chưa có site whitelist nào được cấu hình, hiện tại chỉ thu thập từ AccessTrade API
    """
    total_inserted = 0
    if not config.WHITELIST_URLS:
        logger.info("WHITELIST_URLS trống, bỏ qua cào whitelist.")
        return 0

    for url in config.WHITELIST_URLS:
        if "example-coupon-site.com" in url:
            total_inserted += scrape_example_coupon_site_com(db, url)
        # Thêm logic cho các site khác ở đây
        else:
            logger.info(f"Chưa có logic scrape cho {url}")
            
    return total_inserted

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
        
        error_message = None
        try:
            fetch_accesstrade(db)
            fetch_whitelist(db)
        except Exception as e:
            error_message = str(e)
            logger.exception("Lỗi trong chu kỳ thu thập dữ liệu")
            
        # Ghi kết quả sau khi xong
        try:
            db.bot_health.update_one(
                {"_id": "hunter_bot"},
                {"$set": {
                    "last_cycle_result": "error" if error_message else "success",
                    "last_error_message": error_message
                }},
                upsert=True
            )
        except Exception as e:
            logger.error(f"Lỗi cập nhật kết quả heartbeat: {e}")
        
        logger.info("Hoàn thành chu kỳ.")
        import sys
        if error_message:
            sys.exit(1)
        sys.exit(0)
            
    except Exception as e:
        logger.exception(f"Lỗi crash bot: {e}")
        notify_admin("Hunter Bot Crash", f"Bot đã dừng hoạt động do lỗi không thể phục hồi:\n{e}", priority="urgent")
        import sys
        sys.exit(1)

if __name__ == "__main__":
    main()
