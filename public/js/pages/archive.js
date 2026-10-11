// js/pages/archive.js
(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        let db = await getDb();
        const { page } = renderLayout("archive");
        if (!page) return;

        const canViewArchivedProjects = user.role === 'admin' || user.role === 'project_manager';
        
        let activeTab = 'projects';
        let archivedProjects = [];
        
        async function loadArchivedProjects() {
            try {
                const res = await fetch("https://cifra-tasks.onrender.com/api/projects/archived", {
                    headers: { "Authorization": `Bearer ${getStoredToken()}` }
                });
                if (res.ok) {
                    archivedProjects = await res.json();
                } else {
                    archivedProjects = [];
                }
            } catch (e) {
                console.error("Ошибка загрузки архивных проектов:", e);
                archivedProjects = [];
            }
        }
        
        function getArchivedNotifications() {
            const allNotifications = db.notifications;
            const archived = allNotifications.filter(n => {
                const isForUser = !n.userIds.length || n.userIds.includes(user.id);
                const isRead = n.readBy.includes(user.id);
                return isForUser && isRead;
            });
            return archived.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        
        async function restoreProject(projectId) {
            try {
                await apiRequest(`/projects/${projectId}`, {
                    method: "PUT",
                    body: JSON.stringify({ status: "active" })
                });
                await loadArchivedProjects();
                if (typeof loadAllData === "function") await loadAllData();
                db = await getDb();
                renderArchive();
                showToast("✅ Проект восстановлен", "success");
            } catch (err) {
                showToast(`❌ Ошибка: ${err.message}`, "error");
            }
        }
        
        async function deleteNotificationPermanently(notificationId) {
            try {
                await apiRequest(`/notifications/${notificationId}`, { method: "DELETE" });
                if (typeof loadAllData === "function") await loadAllData();
                db = await getDb();
                renderArchive();
                showToast("✅ Уведомление удалено", "success");
            } catch (err) {
                showToast(`❌ Ошибка: ${err.message}`, "error");
            }
        }
        
        async function clearAllArchivedNotifications() {
            const archivedNotifs = getArchivedNotifications();
            if (archivedNotifs.length === 0) {
                showToast("📭 Нет архивных уведомлений", "info");
                return;
            }
            
            openModal(`
                <h3>🗑️ Очистка архива уведомлений</h3>
                <p>Вы уверены, что хотите удалить <strong>${archivedNotifs.length}</strong> уведомлений?</p>
                <p class="muted" style="font-size:12px">Это действие не обратимо.</p>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
                    <button class="btn btn-secondary" id="cancelClear">Отмена</button>
                    <button class="btn btn-danger" id="confirmClear">Удалить все</button>
                </div>
            `);
            
            document.getElementById("cancelClear").onclick = closeModal;
            document.getElementById("confirmClear").onclick = async () => {
                closeModal();
                try {
                    for (const notif of archivedNotifs) {
                        await apiRequest(`/notifications/${notif.id}`, { method: "DELETE" });
                    }
                    if (typeof loadAllData === "function") await loadAllData();
                    db = await getDb();
                    renderArchive();
                    showToast("✅ Все уведомления удалены", "success");
                } catch (err) {
                    showToast(`❌ Ошибка: ${err.message}`, "error");
                }
            };
        }
        
        function escapeHtml(str) {
            if (!str) return "";
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }
        
        function renderArchive() {
            const archivedNotifs = getArchivedNotifications();
            
            let projectsHtml = '';
            let notificationsHtml = '';
            
            if (!canViewArchivedProjects) {
                projectsHtml = `
                    <div class="empty-archive">
                        <p class="muted">🔒 У вас нет прав на просмотр архивных проектов</p>
                    </div>
                `;
            } else if (archivedProjects.length === 0) {
                projectsHtml = `
                    <div class="empty-archive">
                        <p class="muted">📦 Нет архивных проектов</p>
                    </div>
                `;
            } else {
                projectsHtml = `
                    <div class="archive-list">
                        ${archivedProjects.map(p => {
                            const creator = db.employees.find(e => e.id === p.createdBy);
                            return `
                                <div class="archive-item">
                                    <div class="archive-item-info">
                                        <h3>📁 ${escapeHtml(p.name)}</h3>
                                        <p class="muted">${escapeHtml(p.description || 'Нет описания')}</p>
                                        <div class="archive-item-meta">
                                            <span>📅 Дедлайн: ${p.deadline || '—'}</span>
                                            <span>👤 Создал: ${creator?.fio || '—'}</span>
                                            <span>🗓️ Архивирован: ${p.createdAt ? new Date(p.createdAt).toLocaleDateString('ru-RU') : '—'}</span>
                                        </div>
                                    </div>
                                    <div class="archive-item-actions">
                                        <button class="btn btn-primary restore-project" data-id="${p.id}">↩️ Восстановить</button>
                                    </div>
                                </div>
                            `;
                        }).join("")}
                    </div>
                `;
            }
            
            if (archivedNotifs.length === 0) {
                notificationsHtml = `
                    <div class="empty-archive">
                        <p class="muted">📭 Нет архивных уведомлений</p>
                    </div>
                `;
            } else {
                notificationsHtml = `
                    <div class="archive-toolbar" style="margin-bottom: 16px;">
                        <button class="btn btn-danger" id="clearAllNotifsBtn">🗑️ Очистить все</button>
                    </div>
                    <div class="archive-list">
                        ${archivedNotifs.map(n => `
                            <div class="archive-item notification-item">
                                <div class="archive-item-info">
                                    <div class="notification-text">${escapeHtml(n.text)}</div>
                                    <div class="archive-item-meta">
                                        <span>📅 ${new Date(n.createdAt).toLocaleString('ru-RU')}</span>
                                    </div>
                                </div>
                                <div class="archive-item-actions">
                                    <button class="btn btn-danger delete-notif" data-id="${n.id}">🗑️ Удалить</button>
                                </div>
                            </div>
                        `).join("")}
                    </div>
                `;
            }
            
            page.innerHTML = `
                <h1 class="page-title">Архив</h1>
                <div class="card">
                    <div class="archive-tabs">
                        <button class="tab-btn ${activeTab === 'projects' ? 'active' : ''}" data-tab="projects">
                            📁 Архивные проекты ${canViewArchivedProjects ? `(${archivedProjects.length})` : ''}
                        </button>
                        <button class="tab-btn ${activeTab === 'notifications' ? 'active' : ''}" data-tab="notifications">
                            📬 Архив уведомлений (${archivedNotifs.length})
                        </button>
                    </div>
                    <div id="archiveContent" class="archive-content">
                        ${activeTab === 'projects' ? projectsHtml : notificationsHtml}
                    </div>
                </div>
            `;
            
            document.querySelectorAll(".tab-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    activeTab = btn.dataset.tab;
                    renderArchive();
                });
            });
            
            document.querySelectorAll(".restore-project").forEach(btn => {
                btn.addEventListener("click", () => restoreProject(btn.dataset.id));
            });
            
            document.querySelectorAll(".delete-notif").forEach(btn => {
                btn.addEventListener("click", () => deleteNotificationPermanently(btn.dataset.id));
            });
            
            document.getElementById("clearAllNotifsBtn")?.addEventListener("click", clearAllArchivedNotifications);
        }
        
        await loadArchivedProjects();
        renderArchive();
    })();
})();