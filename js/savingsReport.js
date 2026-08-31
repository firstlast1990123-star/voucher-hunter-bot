// js/savingsReport.js
/**
 * Module Tiết kiệm lũy kế
 */

async function loadSavingsReport() {
    const amountEl = document.getElementById('savings-amount');
    if (!amountEl) return;

    // TODO: cần backend cung cấp API tổng hợp chính xác, hiện tại tính tạm ở frontend chỉ để demo UI
    // Mock fetch my storage and calculate total
    try {
        const userId = getCurrentUserId();
        const response = await fetch(`${CONFIG.API_BASE_URL}/vouchers/my-storage?user_id=${userId}`);
        const data = await response.json();

        let totalSavings = 0;
        
        if (response.ok && data.success && data.data) {
            data.data.forEach(v => {
                // Parse string like "50K" or "10%" or "50.000đ" to number naively for demo
                const valStr = String(v.discount_value || '0');
                if (valStr.includes('%')) {
                    // Ignore % for total naive sum
                } else {
                    const num = parseInt(valStr.replace(/\D/g, ''));
                    if (!isNaN(num)) {
                        // Nếu là K
                        if (valStr.toLowerCase().includes('k') && num < 1000) {
                            totalSavings += num * 1000;
                        } else {
                            totalSavings += num;
                        }
                    }
                }
            });
        }

        // Animation chạy số
        animateValue(amountEl, 0, totalSavings, 1500);

    } catch (error) {
        console.error("Lỗi tính tiết kiệm:", error);
        amountEl.textContent = '0đ';
    }
}

function animateValue(obj, start, end, duration) {
    if (start === end) {
        obj.innerHTML = end.toLocaleString('vi-VN') + 'đ';
        return;
    }
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start).toLocaleString('vi-VN') + 'đ';
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerHTML = end.toLocaleString('vi-VN') + 'đ';
        }
    };
    window.requestAnimationFrame(step);
}

// Chạy khi mở tab storage hoặc khởi tạo
document.addEventListener('DOMContentLoaded', () => {
    // Gọi ngay 1 lần hoặc có thể hook vào tab switch
    const tabStorage = document.getElementById('tab-storage');
    if (tabStorage) {
        tabStorage.addEventListener('click', loadSavingsReport);
    }
});
