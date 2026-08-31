#!/usr/bin/env python3
"""
VoucherMyProXMax — Bot Cào Dữ Liệu Mã Giảm Giá Tốc Độ Cao
Chạy ngầm 24/7, quét AccessTrade API mỗi 10 phút.
Auto-validate: loại mã hết hạn, hết lượt, không đủ điều kiện.
"""

import requests
import json
import time
from datetime import datetime

# ============================================================
# CẤU HÌNH — ĐIỀN THÔNG TIN CỦA BẠN VÀO ĐÂY
# ============================================================
ACCESSTRADE_API_KEY = "2IaMVbe2jWph_xuDnZNDydH2RPLYLDd0"
ACCESSTRADE_COUPON_URL = "https://api.accesstrade.vn/v1/offers/coupons"

# ---- TELEGRAM BOT (Điền vào ngày mai) ----
# Bước 1: Tìm @BotFather trên Telegram, gõ /newbot, lấy TOKEN
# Bước 2: Gửi tin nhắn vào bot, truy cập https://api.telegram.org/bot<TOKEN>/getUpdates để lấy Chat ID
TELEGRAM_BOT_TOKEN = ""   # <-- ĐIỀN TOKEN BOT TELEGRAM VÀO ĐÂY
TELEGRAM_CHAT_ID = ""     # <-- ĐIỀN CHAT ID VÀO ĐÂY

SYNC_INTERVAL = 600  # 10 phút (giây)
OUTPUT_FILE = "vouchers_cache.json"


def send_telegram_alert(message: str):
    """
    Gửi cảnh báo qua Telegram Bot.
    Hướng dẫn thiết lập:
      1. Mở Telegram, tìm @BotFather
      2. Gõ /newbot → đặt tên → nhận TOKEN
      3. Gửi 1 tin nhắn bất kỳ cho bot
      4. Truy cập: https://api.telegram.org/bot<TOKEN>/getUpdates
      5. Tìm "chat":{"id": 123456} → đó là CHAT_ID
      6. Điền TOKEN và CHAT_ID vào biến ở đầu file
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[TELEGRAM] (Chưa cấu hình) {message}")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "HTML"
    }
    try:
        res = requests.post(url, json=payload, timeout=10)
        return res.status_code == 200
    except Exception as e:
        print(f"[TELEGRAM ERROR] {e}")
        return False


def classify_voucher(name: str, desc: str) -> str:
    """Phân loại mã theo nội dung."""
    combined = (name + " " + desc).lower()
    if any(k in combined for k in ["freeship", "vận chuyển", "ship", "giao hàng"]):
        return "freeship"
    if any(k in combined for k in ["hoàn xu", "xu", "cashback", "coins"]):
        return "cashback"
    if "%" in combined:
        return "percent"
    if any(k in combined for k in ["thương hiệu", "brand", "mall", "official"]):
        return "brand"
    return "direct"


def validate_voucher(coupon: dict) -> dict | None:
    """
    Auto-Validation: Kiểm tra và loại bỏ mã không hợp lệ.
    Returns None nếu mã bị loại.
    """
    now = datetime.now()

    # Loại mã hết hạn
    end_time = coupon.get("end_time")
    if end_time:
        try:
            exp = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            if exp.replace(tzinfo=None) < now:
                print(f"  ✗ HẾT HẠN: {coupon.get('name', 'N/A')}")
                return None
        except:
            pass

    # Loại mã hết lượt
    remain = coupon.get("remain")
    if remain is not None and int(remain) <= 0:
        print(f"  ✗ HẾT LƯỢT: {coupon.get('name', 'N/A')}")
        return None

    # Bóc tách điều kiện
    min_amount = coupon.get("min_amount", 0)
    max_discount = coupon.get("max_discount")
    code_list = coupon.get("coupons", [])
    code = code_list[0].get("coupon_code", "") if code_list else ""

    name = coupon.get("name") or coupon.get("title") or "Mã Giảm Giá"
    desc = coupon.get("content") or coupon.get("description") or ""
    smart_cat = classify_voucher(name, desc)

    categories = coupon.get("categories", [])
    cat_names = ", ".join([c.get("category_name_show", "") for c in categories]) if categories else "Toàn Sàn"

    return {
        "id": f"api_{coupon.get('id', 0)}",
        "title": name,
        "code": code,
        "smartCategory": smart_cat,
        "discountVal": coupon.get("discount", "Khuyến Mãi"),
        "minSpendAmount": int(min_amount) if min_amount else 0,
        "minSpend": f"Đơn tối thiểu {int(min_amount):,}đ".replace(",", ".") if min_amount else "Áp dụng toàn sàn",
        "maxDiscount": f"Giảm tối đa {int(max_discount):,}đ".replace(",", ".") if max_discount else None,
        "startTime": coupon.get("start_time"),
        "endTime": end_time,
        "content": desc,
        "targetCategories": cat_names,
        "remain": remain,
        "source": "AccessTrade",
        "validatedAt": now.isoformat()
    }


def fetch_and_validate():
    """Gọi API AccessTrade, validate từng mã, trả về danh sách mã sạch."""
    print(f"\n{'='*60}")
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 🔄 Bắt đầu quét AccessTrade...")
    print(f"{'='*60}")

    headers = {
        "Authorization": f"TOKEN {ACCESSTRADE_API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        res = requests.get(
            f"{ACCESSTRADE_COUPON_URL}?merchant=shopee&limit=30",
            headers=headers,
            timeout=15
        )
        data = res.json()
    except Exception as e:
        print(f"[LỖI API] {e}")
        send_telegram_alert(f"⚠️ <b>Lỗi kết nối API</b>\n{e}")
        return []

    raw_coupons = data.get("data", [])
    print(f"📦 Nhận được {len(raw_coupons)} mã thô từ API")

    valid = []
    for c in raw_coupons:
        result = validate_voucher(c)
        if result:
            valid.append(result)
            print(f"  ✓ OK: {result['title'][:50]} | {result['code']} | {result['smartCategory']}")

    print(f"\n📊 Kết quả: {len(valid)}/{len(raw_coupons)} mã hợp lệ")

    # Lưu cache ra file JSON
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "vouchers": valid,
            "syncedAt": datetime.now().isoformat(),
            "totalRaw": len(raw_coupons),
            "totalValid": len(valid)
        }, f, ensure_ascii=False, indent=2)
    print(f"💾 Đã lưu vào {OUTPUT_FILE}")

    # Gửi Telegram (nếu đã cấu hình)
    if valid:
        msg = (
            f"✅ <b>Đồng bộ thành công</b>\n"
            f"📦 {len(valid)}/{len(raw_coupons)} mã hợp lệ\n"
            f"🕐 {datetime.now().strftime('%H:%M %d/%m/%Y')}"
        )
        send_telegram_alert(msg)

    return valid


def run_forever():
    """Chạy bot liên tục 24/7."""
    print("🚀 VoucherMyProXMax Bot — Khởi động!")
    print(f"⏱  Chu kỳ quét: mỗi {SYNC_INTERVAL // 60} phút")
    print(f"📁 File cache: {OUTPUT_FILE}")
    if not TELEGRAM_BOT_TOKEN:
        print("⚠️  Telegram chưa cấu hình — chỉ in ra terminal")
    print()

    while True:
        try:
            fetch_and_validate()
        except Exception as e:
            print(f"[CRITICAL ERROR] {e}")
            send_telegram_alert(f"🔴 <b>Bot lỗi nghiêm trọng</b>\n{e}")

        print(f"\n⏳ Chờ {SYNC_INTERVAL // 60} phút đến lần quét tiếp...")
        time.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    run_forever()
