// js/pages/settings.js
(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        let db = await getDb();
        const { page } = renderLayout("settings");
        if (!page) return;

        if (user.role !== "admin") {
            page.innerHTML = `<div class="card"><h2>Доступ запрещен</h2><p class="muted">Настройки доступны только администратору.</p></div>`;
            return;
        }

        page.innerHTML = `
            <h1 class="page-title">Настройки — Администратор</h1>
            <div class="card">
                <div class="toolbar">
                    <button class="btn btn-secondary tabBtn" data-tab="users">Пользователи</button>
                    <button class="btn btn-secondary tabBtn" data-tab="notify">Настройки уведомлений</button>
                </div>
                <div id="tabUsers"></div>
                <div id="tabDict" class="hidden"></div>
                <div id="tabNotify" class="hidden"></div>
                <div style="margin-top:14px;display:flex;gap:8px"><button class="btn btn-danger" id="resetDb">Сбросить локальную сессию</button></div>
            </div>
        `;

        async function renderUsers() {
            const container = document.getElementById("tabUsers");
            if (!container) return;
            
            container.innerHTML = `
                <div class="toolbar" style="margin-bottom:10px">
                    <button class="btn btn-primary" id="addUserBtn">➕ Добавить сотрудника</button>
                </div>
                <table style="width:100%">
                    <thead>
                        <tr><th>ФИО</th><th>Email</th><th>Роль</th><th>Отдел</th><th>Должность</th><th>Действия</th></tr>
                    </thead>
                    <tbody>
                        ${db.employees.map((e) => `
                            <tr>
                                <td>${escapeHtml(e.fio)}</td>
                                <td>${escapeHtml(e.email) || "—"}</td>
                                <td>
                                    <select class="roleSel" data-id="${e.id}">
                                        <option value="employee" ${e.role === "employee" ? "selected" : ""}>Сотрудник</option>
                                        <option value="manager" ${e.role === "manager" ? "selected" : ""}>Руководитель</option>
                                        <option value="admin" ${e.role === "admin" ? "selected" : ""}>Администратор</option>
                                    </select>
                                 </td>
                                <td>${escapeHtml(e.department)}</td>
                                <td>${escapeHtml(e.position) || "—"}</td>
                                <td style="display:flex;gap:8px">
                                    <button class="btn btn-secondary changePwd" data-id="${e.id}" data-fio="${escapeHtml(e.fio)}">Сменить пароль</button>
                                    <button class="btn btn-danger delUser" data-id="${e.id}" data-fio="${escapeHtml(e.fio)}">Удалить</button>
                                </td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;

            async function refreshUsers() {
                if (typeof loadAllData === "function") await loadAllData();
                db = await getDb();
                await renderUsers();
            }

            document.getElementById("addUserBtn").onclick = () => {
                openModal(`
                    <h3>Добавление сотрудника</h3>
                    <div style="display:grid;gap:10px">
                        <label>ФИО (обязательно)<br/><input id="newFio" type="text" style="width:100%" /></label>
                        <label>Email (обязательно)<br/><input id="newEmail" type="email" style="width:100%" /></label>
                        <label>Отдел<br/><input id="newDepartment" type="text" style="width:100%" /></label>
                        <label>Должность<br/><input id="newPosition" type="text" style="width:100%" /></label>
                        <label>Роль<br/>
                            <select id="newRole" style="width:100%">
                                <option value="employee">Сотрудник</option>
                                <option value="manager">Руководитель</option>
                            </select>
                        </label>
                        <label>Пароль<br/><input id="newPassword" type="password" placeholder="По умолчанию 123456" style="width:100%" /></label>
                    </div>
                    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
                        <button class="btn btn-secondary" id="cancelCreateUser">Отмена</button>
                        <button class="btn btn-primary" id="saveCreateUser">Создать</button>
                    </div>
                `);

                document.getElementById("cancelCreateUser").onclick = closeModal;
                document.getElementById("saveCreateUser").onclick = async () => {
                    const fio = document.getElementById("newFio").value.trim();
                    const email = document.getElementById("newEmail").value.trim().toLowerCase();
                    const department = document.getElementById("newDepartment").value.trim();
                    const position = document.getElementById("newPosition").value.trim();
                    const role = document.getElementById("newRole").value;
                    const passwordRaw = document.getElementById("newPassword").value;
                    const password = passwordRaw && passwordRaw.trim() ? passwordRaw.trim() : "123456";

                    if (!fio || !email) {
                        showToast("❌ Поля ФИО и Email обязательны", "error");
                        return;
                    }

                    try {
                        const token = getStoredToken();
                        const response = await fetch("https://cifra-tasks.onrender.com/api/auth/register", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${token}`
                            },
                            body: JSON.stringify({ email, password, fio, role, department, position })
                        });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(data.error || data.message || `Ошибка: ${response.status}`);
                        
                        closeModal();
                        await refreshUsers();
                        showToast(`✅ Сотрудник ${fio} добавлен`, "success");
                    } catch (err) {
                        showToast(err.message || "❌ Не удалось создать сотрудника", "error");
                    }
                };
            };
            
            document.querySelectorAll(".roleSel").forEach((s) => {
                s.onchange = async () => {
                    const emp = db.employees.find((e) => e.id === s.dataset.id);
                    if (emp) {
                        emp.role = s.value;
                        await setDb(db);
                        db = await getDb();
                        showToast(`✅ Роль изменена`, "success");
                    }
                };
            });

            document.querySelectorAll(".changePwd").forEach((b) => {
                b.onclick = () => {
                    openModal(`
                        <h3>Смена пароля</h3>
                        <p class="muted">${b.dataset.fio}</p>
                        <label>Новый пароль<br/><input id="newEmpPassword" type="password" style="width:100%" /></label>
                        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
                            <button class="btn btn-secondary" id="cancelPwd">Отмена</button>
                            <button class="btn btn-primary" id="savePwd">Сохранить</button>
                        </div>
                    `);
                    document.getElementById("cancelPwd").onclick = closeModal;
                    document.getElementById("savePwd").onclick = async () => {
                        const newPassword = document.getElementById("newEmpPassword").value.trim();
                        if (!newPassword) {
                            showToast("❌ Введите новый пароль", "error");
                            return;
                        }
                        try {
                            await apiRequest(`/employees/${b.dataset.id}`, {
                                method: "PUT",
                                body: JSON.stringify({ password: newPassword })
                            });
                            closeModal();
                            showToast("✅ Пароль успешно обновлен", "success");
                        } catch (err) {
                            showToast(err.message || "❌ Не удалось сменить пароль", "error");
                        }
                    };
                };
            });
            
            document.querySelectorAll(".delUser").forEach((b) => {
                b.onclick = () => {
                    const fio = b.dataset.fio;
                    openModal(`
                        <h3>🗑️ Удаление сотрудника</h3>
                        <p>Вы уверены, что хотите удалить сотрудника <strong>"${escapeHtml(fio)}"</strong>?</p>
                        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
                            <button class="btn btn-secondary" id="cancelDelUser">Отмена</button>
                            <button class="btn btn-danger" id="confirmDelUser">Удалить</button>
                        </div>
                    `);
                    document.getElementById("cancelDelUser").onclick = closeModal;
                    document.getElementById("confirmDelUser").onclick = async () => {
                        closeModal();
                        try {
                            await apiRequest(`/employees/${b.dataset.id}`, { method: "DELETE" });
                            await refreshUsers();
                            showToast(`✅ Сотрудник удален`, "success");
                        } catch (err) {
                            showToast(err.message || "❌ Не удалось удалить сотрудника", "error");
                        }
                    };
                };
            });
        }

        function renderDict() {
            const container = document.getElementById("tabDict");
            if (!container) return;
            
            container.innerHTML = `
                <h3>Приоритеты</h3>
                <div id="priorityList">${db.dictionaries.priorities.map((p, i) => `<div class="toolbar"><input value="${escapeHtml(p)}" data-index="${i}" class="priorityInput" style="flex:1"/><button class="btn btn-danger delPriority" data-index="${i}">Удалить</button></div>`).join("")}</div>
                <button class="btn btn-secondary" id="addPriority">Добавить приоритет</button>
                <h3>Статусы</h3>
                <div id="statusList">${db.dictionaries.statuses.map((s, i) => `<div class="toolbar"><input value="${escapeHtml(s)}" data-index="${i}" class="statusInput" style="flex:1"/><button class="btn btn-danger delStatus" data-index="${i}">Удалить</button></div>`).join("")}</div>
                <button class="btn btn-secondary" id="addStatus">Добавить статус</button>
                <div style="margin-top:10px"><button class="btn btn-primary" id="saveDict">Сохранить справочники</button></div>
            `;
            
            document.getElementById("addPriority").onclick = () => { 
                db.dictionaries.priorities.push("Новый приоритет"); 
                renderDict(); 
            };
            document.getElementById("addStatus").onclick = () => { 
                db.dictionaries.statuses.push("Новый статус"); 
                renderDict(); 
            };
            
            document.querySelectorAll(".delPriority").forEach((b) => b.onclick = () => { 
                db.dictionaries.priorities.splice(Number(b.dataset.index), 1); 
                renderDict(); 
            });
            document.querySelectorAll(".delStatus").forEach((b) => b.onclick = () => { 
                db.dictionaries.statuses.splice(Number(b.dataset.index), 1); 
                renderDict(); 
            });
            
            document.getElementById("saveDict").onclick = async () => {
                db.dictionaries.priorities = Array.from(document.querySelectorAll(".priorityInput")).map((x) => x.value.trim()).filter(Boolean);
                db.dictionaries.statuses = Array.from(document.querySelectorAll(".statusInput")).map((x) => x.value.trim()).filter(Boolean);
                await setDb(db);
                showToast("✅ Справочники сохранены", "success");
            };
        }

        function renderNotify() {
            const container = document.getElementById("tabNotify");
            if (!container) return;
            
            const prefs = JSON.parse(localStorage.getItem("notify_prefs") || "{\"email\":true,\"telegram\":false}");
            container.innerHTML = `
                <label style="display:block;margin:8px 0"><input type="checkbox" id="notifyEmail" ${prefs.email ? "checked" : ""}/> Email уведомления</label>
                <label style="display:block;margin:8px 0"><input type="checkbox" id="notifyTelegram" ${prefs.telegram ? "checked" : ""}/> Telegram уведомления</label>
                <div style="margin-top:10px"><button class="btn btn-primary" id="saveNotify">Сохранить</button></div>
            `;
            
            document.getElementById("saveNotify").onclick = () => {
                localStorage.setItem("notify_prefs", JSON.stringify({
                    email: document.getElementById("notifyEmail").checked,
                    telegram: document.getElementById("notifyTelegram").checked
                }));
                showToast("✅ Настройки уведомлений сохранены", "success");
            };
        }

        function switchTab(tab) {
            document.getElementById("tabUsers").classList.toggle("hidden", tab !== "users");
            document.getElementById("tabDict").classList.toggle("hidden", tab !== "dict");
            document.getElementById("tabNotify").classList.toggle("hidden", tab !== "notify");
        }

        document.querySelectorAll(".tabBtn").forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
        document.getElementById("resetDb").onclick = () => {
            openModal(`
                <h3>🔄 Сброс локальной сессии</h3>
                <p>Вы уверены, что хотите сбросить локальные данные сессии?</p>
                <p class="muted" style="font-size:12px">Это не затронет базу данных на сервере. Потребуется повторный вход.</p>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
                    <button class="btn btn-secondary" id="cancelReset">Отмена</button>
                    <button class="btn btn-danger" id="confirmReset">Сбросить</button>
                </div>
            `);
            document.getElementById("cancelReset").onclick = closeModal;
            document.getElementById("confirmReset").onclick = () => {
                closeModal();
                localStorage.removeItem("cifra_soft_user");
                localStorage.removeItem("cifra_soft_token");
                sessionStorage.removeItem("cifra_soft_user");
                sessionStorage.removeItem("cifra_soft_token");
                showToast("✅ Сессия сброшена", "success");
                setTimeout(() => location.reload(), 1000);
            };
        };
        
        function escapeHtml(str) {
            if (!str) return "";
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }
        
        await renderUsers();
        renderNotify();
        switchTab("users");
    })();
})();