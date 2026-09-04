import requests
from datetime import datetime, timezone
import config

def parse_iso_datetime(dt_str: str):
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace('Z', '+00:00'))
    except ValueError:
        return None

def validate_voucher_core(voucher: dict, db=None, source: str = "unknown") -> tuple[bool, str]:
    """
    Thực hiện kiểm duyệt fail-closed 4 bước.
    Nếu có db, tự động log kết quả vào verification_logs.
    """
    now = datetime.now(timezone.utc)
    is_valid = True
    reason = "Hợp lệ"
    
    def return_result(val, res):
        if db is not None:
            db.verification_logs.insert_one({
                "voucher_code": voucher.get('code'),
                "result": "valid" if val else "invalid",
                "checked_by": source,
                "checked_at": now.isoformat()
            })
        return val, res
    
    # 1. Kiểm tra thời hạn
    valid_from = parse_iso_datetime(voucher.get('valid_from'))
    valid_to = parse_iso_datetime(voucher.get('valid_to'))
    
    if valid_from and valid_from > now:
        return return_result(False, "Chưa tới hạn (valid_from)")
    if valid_to and valid_to < now:
        return return_result(False, "Hết hạn (valid_to)")
    if not valid_to:
        return return_result(False, "Không có ngày hết hạn (fail-closed)")

    # 2. Kiểm tra lượt dùng
    remain = voucher.get('remain_count')
    if remain is not None and remain <= 0:
        return return_result(False, "Hết lượt (remain_count <= 0)")

    # 3. Ping xác thực thực tế (landing_url)
    url = voucher.get('landing_url')
    if not url or url == "https://shopee.vn":
        return return_result(False, "Không có landing_url cụ thể để kiểm chứng")
        
    try:
        res = requests.get(url, timeout=10)
        if res.status_code != 200:
            return return_result(False, f"Landing page lỗi HTTP {res.status_code}")
            
        html_content = res.text.lower()
        
        # Kiểm tra keyword lỗi
        for kw in config.INVALID_KEYWORDS:
            if kw.lower() in html_content:
                return return_result(False, f"Landing page chứa keyword lỗi: '{kw}'")
                
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
        raise e
    except requests.exceptions.HTTPError as e:
        return return_result(False, f"HTTP Error: {e.response.status_code}")
    except Exception as e:
        return return_result(False, f"Lỗi không xác định khi ping: {e}")

    # 4. Đối chiếu điều kiện đơn hàng tối thiểu
    min_order = voucher.get('min_order_value')
    if min_order is None or float(min_order) < 0:
        return return_result(False, "Điều kiện đơn tối thiểu không hợp lệ (null hoặc âm)")

    return return_result(True, "Hợp lệ")
