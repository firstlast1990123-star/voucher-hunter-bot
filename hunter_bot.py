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
import hashlib
import urllib.parse
from bs4 import BeautifulSoup
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

def parse_discount(discount_str, extra_text=""):
    if not discount_str and not extra_text:
        return "fixed", 0.0, None
    full_str = f"{discount_str or ''} {extra_text or ''}".lower().replace('.', '').replace(',', '')
    
    # 1. Percent
    percent_match = re.search(r'(\d+)\s*%', full_str)
    if percent_match:
        max_val = None
        max_match = re.search(r'tối đa\s*(\d+)\s*(k|đ|triệu|tr)?', full_str)
        if max_match:
            num, unit = float(max_match.group(1)), max_match.group(2)
            if unit == 'k':
                max_val = num * 1000
            elif unit in ('triệu', 'tr'):
                max_val = num * 1000000
            elif num < 1000 and unit != 'đ':
                max_val = num * 1000
            else:
                max_val = num
        return "percent", float(percent_match.group(1)), max_val

    # 2. Triệu / Tr
    triệu_match = re.search(r'(\d+)\s*(?:triệu|tr)', full_str)
    if triệu_match:
        return "fixed", float(triệu_match.group(1)) * 1000000, None

    # 3. Fixed k/đ
    fixed_match = re.search(r'(\d+)\s*(k|đ)', full_str)
    if fixed_match:
        num, unit = float(fixed_match.group(1)), fixed_match.group(2)
        val = num * 1000 if unit == 'k' else num
        if val < 1000 and unit != 'đ':
            val *= 1000
        return "fixed", val, None

    # 4. Plain number (>= 1000)
    plain_match = re.search(r'(\d{4,})', full_str)
    if plain_match:
        return "fixed", float(plain_match.group(1)), None

    return "fixed", 0.0, None

def parse_expiry(time_str, now=None):
    if now is None:
        now = datetime.now(timezone.utc)
    if not time_str:
        return (now + timedelta(days=7)).replace(hour=23, minute=59, second=59, microsecond=0).isoformat()
    t_str = str(time_str).lower().strip()
    day_match = re.search(r'(\d+)\s*(?:days?|ngày)', t_str)
    if day_match:
        days = int(day_match.group(1))
        return (now + timedelta(days=days)).replace(hour=23, minute=59, second=59, microsecond=0).isoformat()
    hour_match = re.search(r'(\d+)\s*(?:hours?|giờ)', t_str)
    if hour_match:
        hours = int(hour_match.group(1))
        return (now + timedelta(hours=hours)).replace(microsecond=0).isoformat()
    month_match = re.search(r'(\d+)\s*(?:months?|tháng)', t_str)
    if month_match:
        months = int(month_match.group(1))
        return (now + timedelta(days=months * 30)).replace(hour=23, minute=59, second=59, microsecond=0).isoformat()
    return (now + timedelta(days=7)).replace(hour=23, minute=59, second=59, microsecond=0).isoformat()

def parse_min_order(title, desc=""):
    full = f"{title or ''} {desc or ''}".lower().replace('.', '').replace(',', '')
    m = re.search(r'đơn\s*(?:hàng)?\s*(?:từ|tối thiểu)\s*(\d+)\s*(k|đ|triệu|tr)?', full)
    if m:
        val = float(m.group(1))
        u = m.group(2)
        if u == 'k':
            val *= 1000
        elif u in ('triệu', 'tr'):
            val *= 1000000
        elif val < 1000 and u != 'đ':
            val *= 1000
        return val
    return 0.0

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
    Thu thập voucher từ các trang web whitelist công khai (nguồn chính: iPrice.vn).
    Chỉ lấy dữ liệu ưu đãi, tuyệt đối không lưu link affiliate/tracking của iPrice.
    """
    real_urls = [
        u for u in getattr(config, 'WHITELIST_URLS', [])
        if "example-coupon-site.com" not in u and "another-promo-site.net" not in u
    ]

    if not real_urls:
        logger.info("Chưa cấu hình trang whitelist thật, bỏ qua bước này")
        return 0, None

    total_inserted = 0
    total_skipped = 0
    errors = []
    now = datetime.now(timezone.utc)
    yesterday = now - timedelta(days=1)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
    }

    for url in real_urls:
        try:
            logger.info(f"Đang thu thập từ trang whitelist: {url}")
            res = requests.get(url, headers=headers, timeout=15)
            res.raise_for_status()

            soup = BeautifulSoup(res.text, 'html.parser')
            items = soup.find_all(class_='rh_offer_list')

            if not items:
                logger.warning(f"Không tìm thấy thẻ ưu đãi (.rh_offer_list) trên trang: {url}")
                continue

            logger.info(f"Tìm thấy {len(items)} thẻ ưu đãi trên {url}. Bắt đầu bóc tách...")

            for i, item in enumerate(items):
                try:
                    title_el = item.find('h2')
                    title = title_el.get_text(strip=True) if title_el else ""
                    if not title:
                        continue

                    tag_el = item.find(class_='sale_letter')
                    tag = tag_el.get_text(strip=True) if tag_el else ""

                    desc_el = item.find(class_='rh_gr_middle_desc')
                    desc = desc_el.get_text(strip=True) if desc_el else ""

                    time_el = item.find(class_='listtimeleft')
                    time_str = time_el.get_text(strip=True) if time_el else ""

                    # 1. Trích xuất mã code text (nếu có)
                    coupon_btn = item.find(class_='coupon_btn')
                    raw_code = None
                    if coupon_btn and coupon_btn.has_attr('data-clipboard-text'):
                        raw_code = coupon_btn['data-clipboard-text'].strip()

                    is_coupon_code = bool(raw_code)
                    if is_coupon_code:
                        code = raw_code
                        voucher_type = "code"
                    else:
                        # Sinh code định danh ổn định cho deal/deeplink
                        slug_clean = re.sub(r'[^a-zA-Z0-9]+', '_', title).strip('_').upper()
                        h = hashlib.md5(f"{title}_{tag}".encode()).hexdigest()[:6].upper()
                        code = f"DEAL_{slug_clean[:18]}_{h}"
                        voucher_type = "deeplink"

                    merchant = "Shopee"

                    # 2. Kiểm tra trùng lặp (Idempotency)
                    if db is not None:
                        exists_pending = db.pending_vouchers.find_one({
                            "code": code,
                            "merchant": merchant,
                            "fetched_at": {"$gte": yesterday.isoformat()}
                        })
                        exists_live = db.live_vouchers.find_one({
                            "code": code
                        })
                        if exists_pending or exists_live:
                            total_skipped += 1
                            continue

                    # 3. Trích xuất và vệ sinh URL (Tuyệt đối không lưu link affiliate/tracking của iPrice)
                    btn = item.find(class_='btn_offer_block')
                    href = btn.get('href', '') if btn else ''
                    parsed_qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                    target_url = parsed_qs.get('url', [''])[0]

                    if not target_url or target_url.rstrip('/') == 'https://shopee.vn':
                        # Fallback về trang Mã Giảm Giá chính thức của Shopee
                        landing_url = "https://shopee.vn/m/ma-giam-gia"
                    else:
                        p_t = urllib.parse.urlparse(target_url)
                        landing_url = f"{p_t.scheme}://{p_t.netloc}{p_t.path}"

                    # Bảo vệ nhiều lớp chống rò rỉ domain hoặc tracking iPrice
                    if any(bad in landing_url.lower() for bad in ["iprice", "grogu", "aff_", "utm_"]):
                        landing_url = "https://shopee.vn/m/ma-giam-gia"

                    dtype, dval, dmax = parse_discount(tag, title)
                    min_order = parse_min_order(title, desc)
                    valid_to = parse_expiry(time_str, now)

                    doc = {
                        "source": "iprice_vn",
                        "merchant": merchant,
                        "code": code,
                        "title": title,
                        "voucher_type": voucher_type,
                        "discount_type": dtype,
                        "discount_value": dval,
                        "discount_max_value": dmax,
                        "min_order_value": min_order,
                        "valid_from": now.isoformat(),
                        "valid_to": valid_to,
                        "remain_count": None,
                        "landing_url": landing_url,
                        "raw_payload": {
                            "title": title,
                            "tag": tag,
                            "time_str": time_str,
                            "source_page": url
                        },
                        "fetched_at": now.isoformat(),
                        "retry_count": 0
                    }

                    if db is not None:
                        db.pending_vouchers.insert_one(doc)
                    total_inserted += 1

                except Exception as parse_err:
                    logger.warning(f"Lỗi parse thẻ ưu đãi #{i+1}: {parse_err}")
                    continue

        except Exception as e:
            err_msg = f"Lỗi cào whitelist {url}: {e}"
            logger.error(err_msg)
            errors.append(err_msg)

    logger.info(f"[Whitelist iPrice] Thêm mới: {total_inserted} | Bỏ qua (trùng): {total_skipped}")
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
