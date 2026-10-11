// js/common.js
function roleLabel(role) {
    const roleMap = {
        'admin': 'Администратор',
        'project_manager': 'Руководитель проектов',
        'client_manager': 'Руководитель отдела по работе с клиентами',
        'head_data': 'Начальник отдела обработки данных',
        'head_dev': 'Начальник отдела разработки',
        'head_qa': 'Начальник отдела тестирования',
        'employee': 'Сотрудник'
    };
    return roleMap[role] || role;
}

function getCurrentUser() {
    const userRaw = localStorage.getItem("cifra_soft_user") || sessionStorage.getItem("cifra_soft_user");
    return userRaw ? JSON.parse(userRaw) : null;
}

function getStoredToken() {
    return localStorage.getItem("cifra_soft_token") || sessionStorage.getItem("cifra_soft_token");
}

function clearSession() {
    localStorage.removeItem("cifra_soft_token");
    localStorage.removeItem("cifra_soft_user");
    sessionStorage.removeItem("cifra_soft_token");
    sessionStorage.removeItem("cifra_soft_user");
}

function logout() {
    clearSession();
    window.location.href = "login.html";
}

function canViewDepartment(user, targetDepartment) {
    if (!targetDepartment) return true;
    if (user.role === 'admin') return true;
    if (user.role.startsWith('head_')) return user.department === targetDepartment;
    if (user.role === 'project_manager') return true;
    if (user.role === 'client_manager') return user.department === targetDepartment;
    return user.department === targetDepartment;
}

function visibleTasksForUser(db, user, mode = "all") {
    if (user.role === 'admin') {
        return mode === "mine" ? db.tasks.filter(t => t.assigneeId === user.id) : db.tasks;
    }
    if (user.role === 'project_manager') {
        return mode === "mine" ? db.tasks.filter(t => t.assigneeId === user.id) : db.tasks;
    }
    if (user.role.startsWith('head_')) {
        const department = user.department;
        const departmentEmployees = db.employees.filter(e => e.department === department).map(e => e.id);
        if (mode === "mine") {
            return db.tasks.filter(t => t.assigneeId === user.id);
        }
        return db.tasks.filter(t => departmentEmployees.includes(t.assigneeId));
    }
    if (user.role === 'client_manager') {
        const department = user.department;
        const departmentEmployees = db.employees.filter(e => e.department === department).map(e => e.id);
        if (mode === "mine") {
            return db.tasks.filter(t => t.assigneeId === user.id);
        }
        return db.tasks.filter(t => departmentEmployees.includes(t.assigneeId));
    }
    return db.tasks.filter(t => t.assigneeId === user.id);
}

function renderLayout(activePage) {
    const user = getCurrentUser();
    if (!user) return { user: null, page: null };
    
    const root = document.getElementById("app");
    const links = [
        ["dashboard.html", "Дашборд", "dashboard"],
        ["tasks.html", "Задачи", "tasks"],
        ["projects.html", "Проекты", "projects"],
        ["reports.html", "Отчеты", "reports"],
        ["team.html", "Команда", "team"],
    ];
    
    if (user.role === "admin") links.push(["settings.html", "Настройки", "settings"]);

    root.innerHTML = `
        <header class="topbar">
            <div class="topbar-inner container">
                <div class="brand">Цифра Софт — ${roleLabel(user.role)}</div>
                <nav class="nav">
                    ${links.map(([href, title, key]) => `<a href="${href}" class="${activePage === key ? "active" : ""}">${title}</a>`).join("")}
                    <a href="archive.html" class="${activePage === "archive" ? "active" : ""}" id="archiveLink">
                        Архив
                    </a>
                    <a href="notifications.html" class="${activePage === "notifications" ? "active" : ""}" id="notificationsLink" style="position:relative">
                        Уведомления
                        <span id="notifBadge" style="display:none; position:absolute; top:-5px; right:-10px; background:#c62828; color:white; border-radius:50%; min-width:18px; height:18px; padding:0 5px; font-size:10px; font-weight:bold; line-height:18px; text-align:center;"></span>
                    </a>
                </nav>
                <button class="btn btn-secondary" id="logoutBtn">Выход</button>
            </div>
        </header>
        <main class="container" id="page"></main>
        <div class="modal" id="globalModal"><div class="modal-content" id="globalModalBody"></div></div>
    `;
    
    document.getElementById("logoutBtn").onclick = logout;
    
    updateNotifBadge();
    
    if (window.badgeInterval) clearInterval(window.badgeInterval);
    window.badgeInterval = setInterval(updateNotifBadge, 30000);
    
    return { user, page: document.getElementById("page") };
}

async function updateNotifBadge() {
    const user = getCurrentUser();
    if (!user) return;
    
    try {
        const db = await getDb();
        const notifications = db.notifications.filter((n) => !n.userIds.length || n.userIds.includes(user.id));
        const unreadCount = notifications.filter(n => !n.readBy.includes(user.id)).length;
        
        const badge = document.getElementById("notifBadge");
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch(e) {
        console.error("Ошибка обновления бейджа:", e);
    }
}

function openModal(html) {
    const modal = document.getElementById("globalModal");
    const body = document.getElementById("globalModalBody");
    body.innerHTML = html;
    modal.classList.add("open");
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

function closeModal() {
    document.getElementById("globalModal").classList.remove("open");
}

function statusClass(status) {
    if (status === "Новая") return "status-new";
    if (status === "В работе") return "status-progress";
    if (status === "На проверке") return "status-review";
    if (status === "Закрыта") return "status-done";
    return "status-overdue";
}

function showToast(message, type = "info") {
    const oldToast = document.querySelector(".cifra-toast");
    if (oldToast) oldToast.remove();
    
    const colors = {
        success: "#2e7d32",
        error: "#c62828",
        info: "#1976d2",
        warning: "#ed6c02"
    };
    
    const toast = document.createElement("div");
    toast.className = "cifra-toast";
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease;
        cursor: pointer;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        if (toast && toast.parentNode) toast.remove();
    }, 3000);
    
    toast.onclick = () => toast.remove();
}

if (!document.querySelector("#toastStyle")) {
    const style = document.createElement("style");
    style.id = "toastStyle";
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

// Универсальное модальное окно подтверждения
function confirmAction(options) {
    return new Promise((resolve) => {
        const { title, message, confirmText = "Да", cancelText = "Отмена", confirmStyle = "danger" } = options;
        
        const modalHtml = `
            <div class="confirm-modal">
                <h3 class="confirm-title">${title}</h3>
                <p class="confirm-message">${message}</p>
                <div class="confirm-buttons">
                    <button class="btn btn-secondary confirm-cancel">${cancelText}</button>
                    <button class="btn btn-${confirmStyle} confirm-ok">${confirmText}</button>
                </div>
            </div>
        `;
        
        openModal(modalHtml);
        
        const modal = document.getElementById("globalModal");
        const modalBody = document.getElementById("globalModalBody");
        
        const handleConfirm = () => {
            closeModal();
            resolve(true);
        };
        
        const handleCancel = () => {
            closeModal();
            resolve(false);
        };
        
        modalBody.querySelector(".confirm-ok")?.addEventListener("click", handleConfirm);
        modalBody.querySelector(".confirm-cancel")?.addEventListener("click", handleCancel);
        
        // Закрытие по клику на фон
        modal.onclick = (e) => {
            if (e.target === modal) {
                handleCancel();
            }
        };
    });
}