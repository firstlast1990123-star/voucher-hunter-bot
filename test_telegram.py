#!/usr/bin/env python3
from dotenv import load_dotenv
import logging

# Load cấu hình từ .env
load_dotenv()

from notify_admin import notify_admin

logging.basicConfig(level=logging.INFO)

def main():
    print("Đang gửi test message tới Telegram...")
    notify_admin(
        title="Test Notification",
        message="Kết nối Telegram Bot thành công!",
        priority="high"
    )
    print("Xong. Hãy kiểm tra ứng dụng Telegram của bạn.")

if __name__ == "__main__":
    main()
