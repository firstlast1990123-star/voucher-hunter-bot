import os
from dotenv import load_dotenv

# Đọc file .env nếu có
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME", "voucher_db")

ACCESSTRADE_API_KEY = os.getenv("ACCESSTRADE_API_KEY", "")
ACCESSTRADE_ENDPOINT = os.getenv("ACCESSTRADE_ENDPOINT", "https://api.accesstrade.vn/v1/offers/coupons")

HUNTER_INTERVAL = int(os.getenv("HUNTER_INTERVAL", 900))  # Mặc định 15 phút
VALIDATOR_INTERVAL = int(os.getenv("VALIDATOR_INTERVAL", 300))  # Mặc định 5 phút

# Danh sách các site whitelist để scraping (ví dụ minh hoạ)
WHITELIST_URLS = [
    "https://example-coupon-site.com/shopee-vouchers",
    "https://another-promo-site.net/shopee"
]

# Các từ khóa báo hiệu voucher lỗi/hết hạn trên landing page
INVALID_KEYWORDS = [
    "hết lượt",
    "hết mã",
    "đã hết hạn",
    "không khả dụng",
    "voucher không tồn tại",
    "out of stock",
    "expired"
]
