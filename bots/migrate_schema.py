#!/usr/bin/env python3
"""
Migrate Schema: Cập nhật dữ liệu cũ cho live_vouchers và pending_vouchers
- Bổ sung voucher_type: 'code' hoặc 'deeplink'
- Bổ sung discount_type: 'fixed' hoặc 'percent'
- Chuẩn hóa discount_value và discount_max_value
"""

import re
from datetime import datetime, timezone
import config
from pymongo import MongoClient

def parse_discount(discount_str):
    if not discount_str:
        return "fixed", 0, None

    d_str = str(discount_str).lower().replace('.', '').replace(',', '')

    # Tìm %
    percent_match = re.search(r'(\d+)%', d_str)
    if percent_match:
        discount_type = "percent"
        discount_value = float(percent_match.group(1))

        # Tìm "tối đa Xk" hoặc "tối đa Xđ"
        max_val = None
        max_match = re.search(r'tối đa\s*(\d+)(k|đ)?', d_str)
        if max_match:
            num = float(max_match.group(1))
            unit = max_match.group(2)
            if unit == 'k':
                num *= 1000
            max_val = num
        return discount_type, discount_value, max_val

    # Tìm số tiền fixed
    fixed_match = re.search(r'(\d+)(k|đ)?', d_str)
    if fixed_match:
        discount_type = "fixed"
        num = float(fixed_match.group(1))
        unit = fixed_match.group(2)
        if unit == 'k':
            num *= 1000
        # Nếu lớn hơn 100 và không có unit, giả sử là VNĐ
        if num < 1000 and not unit:
            num *= 1000  # Đoán là K nếu số quá nhỏ
        return discount_type, num, None

    return "fixed", 0, None

def migrate():
    client = MongoClient(config.MONGO_URI)
    db = client[config.DB_NAME]

    collections = ['pending_vouchers', 'live_vouchers']

    for coll_name in collections:
        print(f"Đang migrate collection: {coll_name}")
        cursor = db[coll_name].find({})
        updated = 0

        for doc in cursor:
            updates = {}

            # 1. Migrate voucher_type
            if 'voucher_type' not in doc:
                code = doc.get('code', '')
                if code and len(code) < 30 and 'http' not in code:
                    updates['voucher_type'] = 'code'
                else:
                    updates['voucher_type'] = 'deeplink'

            # 2. Migrate discount fields
            if 'discount_type' not in doc:
                old_val = doc.get('discount_value', '')
                dtype, dval, dmax = parse_discount(old_val)
                updates['discount_type'] = dtype
                updates['discount_value'] = dval
                updates['discount_max_value'] = dmax

            # 3. Migrate published_at
            if 'published_at' not in doc:
                updates['published_at'] = datetime.now(timezone.utc).isoformat()

            if updates:
                db[coll_name].update_one({'_id': doc['_id']}, {'$set': updates})
                updated += 1

        print(f"-> Đã update {updated} documents trong {coll_name}")

if __name__ == '__main__':
    migrate()
