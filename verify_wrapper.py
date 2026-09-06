#!/usr/bin/env python3
import sys
import json
import os
import config
import voucher_validator_core
from pymongo import MongoClient
from datetime import datetime, timezone

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"valid": False, "reason": "No code provided"}))
        sys.exit(1)
        
    code = sys.argv[1]
    
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
        db = client[config.DB_NAME]
        
        voucher = db.live_vouchers.find_one({"code": code, "status": "live"})
        if not voucher:
            print(json.dumps({"valid": False, "reason": "Voucher không tồn tại hoặc đã bị xóa"}))
            sys.exit(0)
            
        is_valid, reason = voucher_validator_core.validate_voucher_core(voucher, db, "verify_on_click")
        
        if is_valid:
            db.live_vouchers.update_one(
                {"_id": voucher["_id"]},
                {"$set": {"verified_at": datetime.now(timezone.utc).isoformat()}}
            )
        else:
            db.live_vouchers.delete_one({"_id": voucher["_id"]})
            # Ghi log ra stderr để theo dõi nếu cần
            print(f"[GỠ BỎ - VALIDATE ON CLICK] Mã: {code} | Lý do: {reason}", file=sys.stderr)
            
        print(json.dumps({"valid": is_valid, "reason": reason}))
        
    except Exception as e:
        # Fail-closed: nghi ngờ voucher hoặc lỗi hệ thống -> loại bỏ
        print(json.dumps({"valid": False, "reason": f"Lỗi hệ thống: {e}"}))
        sys.exit(0)

if __name__ == "__main__":
    main()
