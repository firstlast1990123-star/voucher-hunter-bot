#!/usr/bin/env python3
import os
import time
import logging
from pymongo import MongoClient
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
import config

load_dotenv()

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s')
logger = logging.getLogger("DeletionCron")

def get_db():
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        return client[config.DB_NAME]
    except Exception as e:
        logger.error(f"MongoDB connection failed: {e}")
        return None

def process_deletions():
    db = get_db()
    if not db:
        return
        
    logger.info("Scanning for accounts requested to be deleted...")
    
    # Người dùng yêu cầu xóa 7 ngày trước
    cutoff_time = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    
    users_to_delete = list(db.users.find({
        "deletion_requested": True,
        "deletion_requested_at": {"$lte": cutoff_time}
    }))
    
    if not users_to_delete:
        logger.info("No accounts to delete at this time.")
        return
        
    for user in users_to_delete:
        user_id = user["_id"]
        logger.info(f"Processing deletion for user_id: {user_id}")
        
        try:
            # 1. Xóa user
            db.users.delete_one({"_id": user_id})
            
            # 2. Xóa telegram_subscriptions
            db.telegram_subscriptions.delete_many({"user_id": user_id})
            
            # 3. Xóa saved vouchers
            db.saved_vouchers.delete_many({"user_id": user_id})
            
            # 4. Ẩn danh hóa payment_orders (giữ lại vì lý do kế toán, nhưng xóa dấu vết cá nhân)
            db.payment_orders.update_many(
                {"user_id": user_id},
                {"$set": {
                    "user_id": "anonymized",
                    "anonymized_at": datetime.now(timezone.utc).isoformat()
                }}
            )
            
            logger.info(f"Successfully deleted and anonymized data for user_id: {user_id}")
        except Exception as e:
            logger.error(f"Error processing deletion for user_id {user_id}: {e}")

if __name__ == "__main__":
    process_deletions()
