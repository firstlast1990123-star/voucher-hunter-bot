// js/storage.js
/**
 * Quản lý tab Kho Lưu Trữ
 */

async function loadMyStorage() {
    const container = document.getElementById('storage-grid');
    if (!container) return;

    container.innerHTML = '<div class="col-span-full text-center py-10"><span class="animate-spin text-3xl inline-block">⏳</span><p class="mt-2 text-gray-500">Đang tải kho voucher...</p></div>';

    try {
        const userId = getCurrentUserId();
        const response = await fetch(`${CONFIG.API_BASE_URL}/vouchers/my-storage?user_id=${userId}`);
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
        } else {
            container.innerHTML = `<div class="col-span-full text-center py-10 text-red-500">Lỗi: ${data.message || 'Không thể tải kho'}</div>`;
        }
    } catch (error) {
        console.error("Lỗi tải kho:", error);
        container.innerHTML = `<div class="col-span-full text-center py-10 text-red-500">Lỗi kết nối mạng!</div>`;
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
