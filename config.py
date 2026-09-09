import os
from dotenv import load_dotenv

# Đọc file .env nếu có
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME", "voucher_db")

ACCESSTRADE_API_KEY = os.getenv("ACCESSTRADE_API_KEY", "")
ACCESSTRADE_ENDPOINT = os.getenv("ACCESSTRADE_ENDPOINT", "https://api.accesstrade.vn/v1/offers_informations/coupon")

# Configuration cho Bots
HUNTER_INTERVAL = 30 * 60  # 30 phút cào 1 lần
VALIDATOR_INTERVAL = 5 * 60  # 5 phút duyệt 1 lần
VIP_EARLY_ACCESS_MINUTES = 15 # Thời gian VIP được xem/nhận thông báo trước

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
