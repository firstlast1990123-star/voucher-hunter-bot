// js/toast.js
/**
 * Hiển thị Toast Notification xếp chồng
 * @param {string} message - Nội dung thông báo
 * @param {string} type - 'success' | 'error' | 'info'
 */
function showToast(message, type = 'success') {
    const containerId = 'toast-container';
    let container = document.getElementById(containerId);
    
    // Tạo container nếu chưa có
    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none';
        document.body.appendChild(container);
    }

    // Tạo toast item
    const toast = document.createElement('div');
    
    let bgColor = 'bg-green-600';
    let icon = '✅';
    
    if (type === 'error') {
        bgColor = 'bg-red-600';
        icon = '❌';
    } else if (type === 'info') {
        bgColor = 'bg-blue-600';
        icon = 'ℹ️';
    }

    toast.className = `flex items-center gap-3 px-4 py-3 rounded shadow-lg text-white font-medium transition-all duration-300 transform translate-y-full opacity-0 ${bgColor}`;
    toast.innerHTML = `
        <span>${icon}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Animation xuất hiện
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-full', 'opacity-0');
    });

    // Tự động xóa sau 3s
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-full');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300); // Đợi animation CSS kết thúc
    }, 3000);
}
