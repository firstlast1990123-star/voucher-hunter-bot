#!/usr/bin/env python3
import os
from flask import Flask, jsonify
from pymongo import MongoClient
from datetime import datetime, timezone
import config

app = Flask(__name__)

# Ngưỡng cảnh báo (tính bằng giây)
# Hunter: interval 15 phút -> threshold 45 phút
# Validator: interval 5 phút -> threshold 15 phút
HUNTER_THRESHOLD = 45 * 60
VALIDATOR_THRESHOLD = 15 * 60

def get_db():
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        return client[config.DB_NAME]
    except Exception as e:
        return None

def check_bot_health(bot_id, threshold):
    db = get_db()
    if not db:
        # Nếu mất kết nối DB, trả về 500 nhưng server vẫn phải sống
        return jsonify({"status": "unknown", "error": "Database connection failed"}), 500
        
    try:
        health_record = db.bot_health.find_one({"_id": bot_id})
        if not health_record:
            return jsonify({"status": "down", "error": "No heartbeat record found"}), 503
            
        last_heartbeat_str = health_record.get("last_heartbeat_at")
        if not last_heartbeat_str:
            return jsonify({"status": "down", "error": "Invalid heartbeat record"}), 503
            
        last_heartbeat = datetime.fromisoformat(last_heartbeat_str)
        now = datetime.now(timezone.utc)
        
        diff = (now - last_heartbeat).total_seconds()
        
        if diff > threshold:
            return jsonify({
                "status": "down", 
                "error": f"Heartbeat is too old: {int(diff)} seconds",
                "last_heartbeat_at": last_heartbeat_str,
                "last_cycle_result": health_record.get("last_cycle_result")
            }), 503
            
        return jsonify({
            "status": "alive",
            "last_heartbeat_at": last_heartbeat_str,
            "cycle_count": health_record.get("cycle_count"),
            "last_cycle_result": health_record.get("last_cycle_result")
        }), 200
        
    except Exception as e:
        return jsonify({"status": "unknown", "error": str(e)}), 500

@app.route('/health/hunter', methods=['GET'])
def health_hunter():
    return check_bot_health("hunter_bot", HUNTER_THRESHOLD)

@app.route('/health/validator', methods=['GET'])
def health_validator():
    return check_bot_health("validator_bot", VALIDATOR_THRESHOLD)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
