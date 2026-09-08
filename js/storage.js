// js/storage.js
/**
 * Quản lý tab Kho Lưu Trữ
 */

async function loadMyStorage() {
    const container = document.getElementById('storage-grid');
    if (!container) return;

    if (!isLoggedIn()) {
        container.innerHTML = `
            <div class="col-span-full text-center py-10 text-gray-600 bg-orange-50 rounded-xl border border-orange-200 p-6">
                <div class="text-4xl mb-2">🔐</div>
                <p class="font-bold text-lg mb-2">Vui lòng đăng nhập để xem Kho Voucher của bạn</p>
                <button onclick="openAuthModal('login')" class="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-6 rounded-lg transition shadow-sm">
                    Đăng nhập ngay
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = '<div class="col-span-full text-center py-10"><span class="animate-spin text-3xl inline-block">⏳</span><p class="mt-2 text-gray-500">Đang tải kho voucher...</p></div>';

    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/vouchers/my-storage`, {
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (response.ok && data.success) {
            if (!data.data || data.data.length === 0) {
                container.innerHTML = `
                    <div class="col-span-full text-center py-10 text-gray-500 bg-gray-50 rounded border border-dashed">
                        Kho của bạn đang trống. Hãy quét và lưu thêm mã nhé!
                    </div>
                `;
                return;
            }

            let html = '';
            data.data.forEach(v => {
                html += renderVoucherCard(v);
            });
            container.innerHTML = html;
        } else if (response.status === 401) {
            removeToken();
            loadMyStorage();
        } else {
            container.innerHTML = `<div class="col-span-full text-center py-10 text-red-500">Lỗi: ${data.message || 'Không thể tải kho'}</div>`;
        }
    } catch (error) {
        console.error("Lỗi tải kho:", error);
        container.innerHTML = `<div class="col-span-full text-center py-10 text-red-500">Lỗi kết nối mạng!</div>`;
    }
}

// Gọi API sinh mã liên kết Telegram
async function generateTelegramLink() {
    if (!isLoggedIn()) {
        showToast("Vui lòng đăng nhập để liên kết Telegram", "warning");
        openAuthModal('login');
        return;
    }

    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/user/generate-telegram-link-code`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        
        if (data.success) {
            const container = document.getElementById('telegram-link-container');
            const codeSpan = document.getElementById('telegram-link-code');
            const placeholders = document.querySelectorAll('.tg-code-placeholder');
            
            codeSpan.textContent = data.code;
            placeholders.forEach(el => el.textContent = data.code);
            
            container.classList.remove('hidden');
            showToast('Đã tạo mã liên kết thành công!', 'success');
        } else {
            showToast(data.error || 'Lỗi tạo mã liên kết', 'error');
        }
    } catch (e) {
        showToast('Lỗi mạng', 'error');
    }
}

// Data Subject Rights
async function exportMyData() {
    if (!isLoggedIn()) {
        showToast("Vui lòng đăng nhập để tải dữ liệu cá nhân", "warning");
        openAuthModal('login');
        return;
    }

    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/user/export-my-data`, {
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (res.ok && data.success) {
            const userId = (getCurrentUser() && getCurrentUser().id) || 'me';
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data.data, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `my_data_${userId}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            showToast('Đã tải xuống dữ liệu cá nhân!', 'success');
        } else {
            showToast(data.error || 'Lỗi tải dữ liệu', 'error');
        }
    } catch (e) {
        showToast('Lỗi mạng', 'error');
    }
}

async function requestAccountDeletion() {
    if (!isLoggedIn()) {
        showToast("Vui lòng đăng nhập để yêu cầu xóa tài khoản", "warning");
        openAuthModal('login');
        return;
    }

    if (!confirm("Bạn có chắc chắn muốn yêu cầu xóa tài khoản? Quá trình này sẽ không thể hoàn tác sau 7 ngày.")) {
        return;
    }
    // Double confirmation to prevent accidental clicks
    if (!confirm("CẢNH BÁO LẦN 2: Toàn bộ dữ liệu của bạn, bao gồm các voucher đã lưu và gói VIP sẽ bị vô hiệu hóa. Đồng ý xóa?")) {
        return;
    }
    
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/user/request-deletion`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast(data.message, 'success');
            removeToken();
            updateAuthUI();
        } else {
            showToast(data.error || 'Lỗi gửi yêu cầu xóa', 'error');
        }
    } catch (e) {
        showToast('Lỗi mạng', 'error');
    }
}

// Xử lý chuyển tab
function switchTab(tabId) {
    const tabs = ['tab-scanner', 'tab-storage'];
    const views = ['view-scanner', 'view-storage'];

    // Update nút
    tabs.forEach(t => {
        const el = document.getElementById(t);
        if (el) {
            if (t === tabId) {
                el.classList.add('text-orange-500', 'border-orange-500');
                el.classList.remove('text-gray-500', 'border-transparent');
            } else {
                el.classList.remove('text-orange-500', 'border-orange-500');
                el.classList.add('text-gray-500', 'border-transparent');
            }
        }
    });

    // Update view
    views.forEach(v => {
        const viewId = v.split('-')[1];
        const el = document.getElementById(v);
        if (el) {
            if (tabId.includes(viewId)) {
                el.classList.remove('hidden');
                // Nếu là tab storage, gọi API tải dữ liệu
                if (viewId === 'storage') loadMyStorage();
            } else {
                el.classList.add('hidden');
            }
        }
    });
}

// Gán sự kiện click cho tab khi DOM load
document.addEventListener('DOMContentLoaded', () => {
    const tabScanner = document.getElementById('tab-scanner');
    const tabStorage = document.getElementById('tab-storage');
    
    if (tabScanner) tabScanner.addEventListener('click', () => switchTab('tab-scanner'));
    if (tabStorage) tabStorage.addEventListener('click', () => switchTab('tab-storage'));
});
