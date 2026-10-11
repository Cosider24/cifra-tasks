// js/pages/notifications.js

(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        // Функция для принудительной перезагрузки данных
        async function refreshData() {
            if (typeof loadAllData === "function") {
                if (window.cachedData) window.cachedData = null;
                await loadAllData();
            }
            return await getDb();
        }

        // Загружаем свежие данные
        let db = await refreshData();
        const { page } = renderLayout("notifications");
        if (!page) return;

        // Архивирование ВСЕХ видимых уведомлений пользователя
        async function archiveAllVisibleNotifications() {
            // Берем свежие данные из БД
            const freshNotifs = await (async () => {
                const token = getStoredToken();
                const res = await fetch("https://cifra-tasks.onrender.com/api/api/notifications", {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if (res.ok) return await res.json();
                return db.notifications;
            })();
            
            const toArchive = freshNotifs.filter(n => {
                const isForUser = !n.userIds.length || n.userIds.includes(user.id);
                const isArchived = n.isArchived === true;
                return isForUser && !isArchived;
            });
            
            if (toArchive.length === 0) return;
            
            try {
                for (const n of toArchive) {
                    await apiRequest(`/notifications/${n.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ isArchived: true })
                    });
                }
                // Обновляем данные после архивации
                db = await refreshData();
                if (typeof updateNotifBadge === 'function') updateNotifBadge();
            } catch (err) {
                console.error("Ошибка архивации:", err);
            }
        }

        // Отметка всех как прочитанных
        async function markAllAsRead() {
            const toRead = db.notifications.filter(n => {
                const isForUser = !n.userIds.length || n.userIds.includes(user.id);
                const isRead = n.readBy.includes(user.id);
                const isArchived = n.isArchived === true;
                return isForUser && !isRead && !isArchived;
            });
            
            if (toRead.length === 0) return;
            
            try {
                for (const n of toRead) {
                    if (!n.readBy.includes(user.id)) {
                        n.readBy.push(user.id);
                        await apiRequest(`/notifications/${n.id}/read`, {
                            method: "PUT",
                            body: JSON.stringify({ readBy: n.readBy })
                        });
                    }
                }
                db = await refreshData();
                if (typeof updateNotifBadge === 'function') updateNotifBadge();
            } catch (err) {
                console.error("Ошибка:", err);
            }
        }

        function renderNotifications() {
            // Показываем ТОЛЬКО НЕархивные уведомления
            const activeNotifications = db.notifications.filter(n => {
                const isForUser = !n.userIds.length || n.userIds.includes(user.id);
                const isArchived = n.isArchived === true;
                return isForUser && !isArchived;
            });
            activeNotifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            
            page.innerHTML = `
                <h1 class="page-title">Уведомления</h1>
                <div class="card">
                    <div style="margin-top: 16px;">
                        ${activeNotifications.length === 0 ? 
                            '<p class="muted" style="text-align:center; padding:40px;">Нет уведомлений</p>' : 
                            activeNotifications.map(n => {
                                const isRead = n.readBy.includes(user.id);
                                return `
                                    <div style="
                                        padding: 12px;
                                        margin-bottom: 8px;
                                        border-bottom: 1px solid #eee;
                                        background: ${isRead ? 'transparent' : '#fff3e0'};
                                        border-left: 3px solid ${isRead ? 'transparent' : '#ff9800'};
                                        padding-left: 12px;
                                    ">
                                        <div>
                                            <div style="font-weight: ${isRead ? 'normal' : 'bold'}">${escapeHtml(n.text)}</div>
                                            <div class="muted" style="font-size: 12px; margin-top: 4px;">
                                                ${new Date(n.createdAt).toLocaleString("ru-RU")}
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }).join('')
                        }
                    </div>
                    <div class="muted" style="margin-top: 16px; font-size: 12px; text-align: center;">
                        💡 Уведомления автоматически архивируются при выходе
                    </div>
                </div>
            `;
        }

        function escapeHtml(str) {
            if (!str) return "";
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        // При загрузке страницы
        await markAllAsRead();
        renderNotifications();
        
        // При уходе со страницы — архивируем
        async function beforeUnloadHandler() {
            await archiveAllVisibleNotifications();
        }
        
        // Перехватываем клики по ссылкам
        document.body.addEventListener("click", async (e) => {
            const link = e.target.closest("a");
            if (!link) return;
            
            const href = link.getAttribute("href");
            if (href && !href.startsWith("#") && href !== "" && href !== "javascript:void(0)") {
                const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";
                if (href === currentPage) return;
                
                e.preventDefault();
                await archiveAllVisibleNotifications();
                window.location.href = href;
            }
        });
        
        // Обработка ухода через кнопку "Выход"
        const logoutBtn = document.getElementById("logoutBtn");
        if (logoutBtn) {
            logoutBtn.onclick = async (e) => {
                e.preventDefault();
                await archiveAllVisibleNotifications();
                logout();
            };
        }
        
        // Также обрабатываем закрытие вкладки
        window.addEventListener("beforeunload", beforeUnloadHandler);
    })();
})();