#!/usr/bin/env python3
import os
import time
import logging
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
from pymongo import MongoClient
from datetime import datetime, timezone
from dotenv import load_dotenv
import config

load_dotenv()

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s')
logger = logging.getLogger("SubscriberBot")

bot = telebot.TeleBot(os.environ.get("TELEGRAM_BOT_TOKEN", ""))

def get_db():
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        return client[config.DB_NAME]
    except Exception as e:
        logger.error(f"MongoDB connection failed: {e}")
        return None

db = get_db()

@bot.message_handler(commands=['start'])
def send_welcome(message):
    try:
        chat_id = message.chat.id
        bot.send_message(
            chat_id,
            "👋 Chào mừng bạn đến với hệ thống cảnh báo Voucher!\n\n"
            "Hãy chọn tên shop bạn muốn theo dõi để nhận thông báo ngay khi có mã mới nhé.",
            reply_markup=get_merchants_keyboard()
        )
    except Exception as e:
        logger.error(f"Error in /start: {e}")

def get_merchants_keyboard():
    markup = InlineKeyboardMarkup()
    if db is None:
        return markup
    try:
        merchants = db.live_vouchers.distinct("merchant")
        # TODO: Add pagination if len(merchants) > 20
        merchants = merchants[:20] 
        
        for merchant in merchants:
            if merchant:
                markup.add(InlineKeyboardButton(text=merchant, callback_data=f"toggle_{merchant}"))
        return markup
    except Exception as e:
        logger.error(f"Error fetching merchants: {e}")
        return markup

@bot.callback_query_handler(func=lambda call: call.data.startswith('toggle_'))
def handle_merchant_toggle(call):
    if db is None:
        return
        
    try:
        merchant = call.data.split('toggle_')[1]
        chat_id = call.message.chat.id
        
        sub = db.telegram_subscriptions.find_one({"chat_id": chat_id, "merchant": merchant})
        
        if sub:
            db.telegram_subscriptions.delete_one({"_id": sub["_id"]})
            bot.answer_callback_query(call.id, f"❌ Đã hủy theo dõi {merchant}")
            bot.send_message(chat_id, f"❌ Bạn đã hủy nhận thông báo từ <b>{merchant}</b>.", parse_mode="HTML")
        else:
            db.telegram_subscriptions.insert_one({
                "chat_id": chat_id,
                "merchant": merchant,
                "user_id": None,
                "subscribed_at": datetime.now(timezone.utc).isoformat()
            })
            bot.answer_callback_query(call.id, f"✅ Đã theo dõi {merchant}")
            bot.send_message(chat_id, f"✅ Bạn sẽ nhận được thông báo khi <b>{merchant}</b> có mã mới!", parse_mode="HTML")
            
    except Exception as e:
        logger.error(f"Error handling callback: {e}")

@bot.message_handler(commands=['mysubs'])
def list_subs(message):
    if db is None:
        return
    try:
        chat_id = message.chat.id
        subs = db.telegram_subscriptions.find({"chat_id": chat_id})
        merchants = [sub["merchant"] for sub in subs]
        
        if merchants:
            text = "📋 Bạn đang theo dõi các shop sau:\n" + "\n".join([f"- {m}" for m in merchants])
        else:
            text = "Bạn chưa theo dõi shop nào. Gõ /start để chọn shop nhé."
            
        bot.send_message(chat_id, text)
    except Exception as e:
        logger.error(f"Error in /mysubs: {e}")

@bot.message_handler(commands=['stop'])
def stop_subs(message):
    if db is None:
        return
    try:
        chat_id = message.chat.id
        res = db.telegram_subscriptions.delete_many({"chat_id": chat_id})
        
        if res.deleted_count > 0:
            bot.send_message(chat_id, f"❌ Đã hủy toàn bộ {res.deleted_count} shop đang theo dõi.")
        else:
            bot.send_message(chat_id, "Bạn chưa theo dõi shop nào.")
    except Exception as e:
        logger.error(f"Error in /stop: {e}")

@bot.message_handler(commands=['lienket'])
def link_account(message):
    if db is None:
        return
    try:
        chat_id = message.chat.id
        parts = message.text.split()
        if len(parts) != 2:
            bot.send_message(chat_id, "⚠️ Cú pháp không hợp lệ. Vui lòng gõ: /lienket [Mã_6_Số]")
            return
            
        code = parts[1]
        now = datetime.now(timezone.utc).isoformat()
        
        # Check code
        link_record = db.telegram_link_codes.find_one({
            "_id": code,
            "used": False,
            "expires_at": {"$gt": now}
        })
        
        if not link_record:
            bot.send_message(chat_id, "❌ Mã không hợp lệ hoặc đã hết hạn, vào lại trang Tài khoản để lấy mã mới.")
            return
            
        user_id = link_record["user_id"]
        
        # Update subscriptions
        db.telegram_subscriptions.update_many(
            {"chat_id": chat_id},
            {"$set": {"user_id": user_id}}
        )
        
        # Mark used
        db.telegram_link_codes.update_one(
            {"_id": code},
            {"$set": {"used": True}}
        )
        
        bot.send_message(chat_id, "✅ Đã liên kết thành công với tài khoản web của bạn! Giờ đây nếu là VIP, bạn sẽ nhận được thông báo sớm nhất.")
        
    except Exception as e:
        logger.error(f"Error in /lienket: {e}")

if __name__ == "__main__":
    if db and os.environ.get("TELEGRAM_BOT_TOKEN"):
        logger.info("Subscriber Bot is running with long polling...")
        # Đảm bảo có index
        db.telegram_subscriptions.create_index([("chat_id", 1), ("merchant", 1)], unique=True)
        try:
            bot.infinity_polling(timeout=10, long_polling_timeout=5)
        except Exception as e:
            logger.error(f"Bot polling crashed: {e}")
    else:
        logger.error("Missing Database connection or TELEGRAM_BOT_TOKEN.")
