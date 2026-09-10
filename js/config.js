// js/config.js
const CONFIG = {
    // Endpoint API tương đối (tự động theo domain hiện tại trên Netlify và Local)
    API_BASE_URL: '/api', 
    
    // Logo Shopee làm ảnh loading
    SHOPEE_LOGO_URL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Shopee.svg/2560px-Shopee.svg.png',
    
    // FEATURE FLAG: Bật lại VIP Trial 2 tiếng do đã được quản lý an toàn tại Server (Single Source of Truth)
    VIP_TRIAL_ENABLED: true
};

// ==========================================
// Quản lý JWT Token và User State phía Client
// ==========================================

function getToken() {
    return localStorage.getItem('vmp_auth_token');
}

function setToken(token) {
    if (token) {
        localStorage.setItem('vmp_auth_token', token);
    } else {
        localStorage.removeItem('vmp_auth_token');
    }
}

function removeToken() {
    localStorage.removeItem('vmp_auth_token');
    localStorage.removeItem('vmp_auth_user');
}

function getCurrentUser() {
    const raw = localStorage.getItem('vmp_auth_user');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function setCurrentUser(user) {
    if (user) {
        localStorage.setItem('vmp_auth_user', JSON.stringify(user));
    } else {
        localStorage.removeItem('vmp_auth_user');
    }
}

function isLoggedIn() {
    return !!getToken();
}

/**
 * Tự động gắn header Authorization: Bearer <token> nếu có token
 */
function getAuthHeaders(headers = {}) {
    const token = getToken();
    const result = { ...headers };
    if (token) {
        result['Authorization'] = `Bearer ${token}`;
    }
    return result;
}

// Hỗ trợ tương thích ngược nếu còn lời gọi cũ
function getCurrentUserId() {
    const user = getCurrentUser();
    return user ? user.id : null;
}
