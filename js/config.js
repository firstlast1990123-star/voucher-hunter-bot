// js/config.js
const CONFIG = {
    // Tạm thời trỏ tới backend giả định (để dev/test local). Chỉnh sửa khi chạy thật.
    API_BASE_URL: 'http://localhost:3000/api', 
    
    // Logo Shopee làm ảnh loading
    SHOPEE_LOGO_URL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Shopee.svg/2560px-Shopee.svg.png',
    
    // FEATURE FLAG: Vô hiệu hóa VIP Trial 2 tiếng phía client cho đến khi hoàn thiện Authentication chuẩn ở server
    VIP_TRIAL_ENABLED: false
};

// Hàm tiện ích lấy userId hiện tại (mock). Trong thực tế có thể đọc từ localStorage/cookie/session.
function getCurrentUserId() {
    let userId = localStorage.getItem('user_id');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('user_id', userId);
    }
    return userId;
}
