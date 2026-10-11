// js/pages/tasks.js
(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        let db = await getDb();
        const { page } = renderLayout("tasks");
        if (!page) return;

        let mode = user.role === "employee" ? "mine" : "all";
        let currentPage = 1;
        const rowsPerPage = 10;

        function employeesForRole() {
            if (user.role === "admin") return db.employees;
            if (user.role === "manager") return db.employees.filter((e) => e.department === user.department);
            return [db.employees.find((e) => e.id === user.id)];
        }

        function renderFromFirstPage() {
            currentPage = 1;
            render();
        }

        function resetAllFilters() {
            const filterIds = ["fStatus", "fAssignee", "fProject", "fDeadline", "searchTask", "dateFrom", "dateTo"];
            filterIds.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.value = "";
            });
            renderFromFirstPage();
        }

        async function updateTaskStatus(taskId, newStatus, taskTitle, assigneeId) {
            try {
                const task = db.tasks.find(t => t.id === taskId);
                if (!task) return;
                
                const prevStatus = task.status;
                if (prevStatus === newStatus) return;
                
                await apiRequest(`/tasks/${taskId}`, {
                    method: "PUT",
                    body: JSON.stringify({ status: newStatus })
                });
                
                await addTaskHistory(task, `Статус изменен: ${prevStatus} -> ${newStatus}`, user.fio);
                await addNotification(`Статус задачи "${taskTitle}" изменен на "${newStatus}"`, [assigneeId]);
                
                if (typeof loadAllData === "function") await loadAllData();
                db = await getDb();
                render();
            } catch (err) {
                console.error("Ошибка обновления статуса:", err);
                showToast(`❌ Ошибка: ${err.message || "Неизвестная ошибка"}`, "error");
            }
        }

        async function deleteTask(taskId, taskTitle) {
            openModal(`
                <h3>🗑️ Удаление задачи</h3>
                <p>Вы уверены, что хотите удалить задачу <strong>"${escapeHtml(taskTitle)}"</strong>?</p>
                <p class="muted" style="font-size:12px">Это действие не обратимо.</p>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
                    <button class="btn btn-secondary" id="cancelDeleteTask">Отмена</button>
                    <button class="btn btn-danger" id="confirmDeleteTask">Удалить</button>
                </div>
            `);
            
            document.getElementById("cancelDeleteTask").onclick = closeModal;
            document.getElementById("confirmDeleteTask").onclick = async () => {
                closeModal();
                try {
                    await apiRequest(`/tasks/${taskId}`, { method: "DELETE" });
                    await addNotification(`Задача "${taskTitle}" была удалена`, []);
                    
                    if (typeof loadAllData === "function") await loadAllData();
                    db = await getDb();
                    renderFromFirstPage();
                    showToast(`✅ Задача "${taskTitle}" удалена`, "success");
                } catch (err) {
                    showToast(`❌ Ошибка удаления: ${err.message || "Неизвестная ошибка"}`, "error");
                }
            };
        }

        async function render() {
            const params = {
                status: document.getElementById("fStatus")?.value || "",
                assignee: document.getElementById("fAssignee")?.value || "",
                project: document.getElementById("fProject")?.value || "",
                deadline: document.getElementById("fDeadline")?.value || "",
                search: (document.getElementById("searchTask")?.value || "").trim().toLowerCase(),
                dateFrom: document.getElementById("dateFrom")?.value || "",
                dateTo: document.getElementById("dateTo")?.value || ""
            };

            let tasks = visibleTasksForUser(db, user, mode).filter((t) => {
                const dayFilterOk = (() => {
                    if (!params.deadline) return true;
                    const today = new Date().toISOString().slice(0, 10);
                    if (params.deadline === "today") return t.deadline === today;
                    if (params.deadline === "tomorrow") {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        return t.deadline === d.toISOString().slice(0, 10);
                    }
                    if (params.deadline === "overdue") return t.deadline < today && t.status !== "Закрыта";
                    return t.deadline === params.deadline;
                })();
                return (!params.status || t.status === params.status)
                    && (!params.assignee || t.assigneeId === params.assignee)
                    && (!params.project || t.projectId === params.project)
                    && (!params.search || (t.title || "").toLowerCase().includes(params.search))
                    && (!params.dateFrom || (t.createdAt || "").slice(0, 10) >= params.dateFrom)
                    && (!params.dateTo || (t.createdAt || "").slice(0, 10) <= params.dateTo)
                    && dayFilterOk;
            });

            const totalRows = tasks.length;
            const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
            if (currentPage > totalPages) currentPage = totalPages;
            const startIndex = (currentPage - 1) * rowsPerPage;
            const pagedTasks = tasks.slice(startIndex, startIndex + rowsPerPage);

            const tbody = document.getElementById("rows");
            if (tbody) {
                tbody.innerHTML = pagedTasks.map((t) => {
                    const assignee = db.employees.find((e) => e.id === t.assigneeId)?.fio || "—";
                    const project = db.projects.find((p) => p.id === t.projectId)?.name || "—";
                    const employeeStatuses = [...new Set([t.status, "На проверке"])];
                    const statusOptions = (user.role === "employee" ? employeeStatuses : STATUS)
                        .map((s) => `<option ${s === t.status ? "selected" : ""}>${escapeHtml(s)}</option>`).join("");
                    const today = new Date().toISOString().slice(0, 10);
                    const overdue = t.deadline < today && t.status !== "Закрыта";
                    return `
                        <tr class="${overdue ? "task-overdue" : ""}" data-task-id="${t.id}">
                            <td><a href="task-detail.html?id=${t.id}" style="color:#0d47a1">${escapeHtml(t.title)}</a>${t.estimatedHours ? ` <span class="muted" style="font-size:10px">(${t.estimatedHours}ч)</span>` : ""}</td>
                            ${user.role === "employee" ? "" : `<td>${escapeHtml(assignee)}</td>`}
                            <td>${escapeHtml(project)}</td>
                            <td>${escapeHtml(t.deadline)}</td>
                            <td>${overdue ? "⚠️" : "—"}</td>
                            <td><select data-id="${t.id}" class="statusSelect">${statusOptions}</select></td>
                            ${user.role === "admin" ? `<td><button class="btn btn-danger delete-task-btn" data-id="${t.id}" data-title="${escapeHtml(t.title).replace(/"/g, '&quot;')}">🗑️</button></td>` : ""}
                        </tr>
                    `;
                }).join("");
            }

            document.querySelectorAll(".statusSelect").forEach((sel) => {
                const oldHandler = sel._handler;
                if (oldHandler) sel.removeEventListener("change", oldHandler);
                
                const handler = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const taskId = sel.dataset.id;
                    const newStatus = sel.value;
                    const task = db.tasks.find(t => t.id === taskId);
                    
                    if (!task || task.status === newStatus) return;
                    
                    sel.disabled = true;
                    try {
                        await updateTaskStatus(taskId, newStatus, task.title, task.assigneeId);
                    } catch (err) {
                        sel.value = task.status;
                    } finally {
                        sel.disabled = false;
                    }
                };
                
                sel._handler = handler;
                sel.addEventListener("change", handler);
            });

            document.querySelectorAll(".delete-task-btn").forEach((btn) => {
                const oldHandler = btn._handler;
                if (oldHandler) btn.removeEventListener("click", oldHandler);
                
                const handler = () => {
                    deleteTask(btn.dataset.id, btn.dataset.title);
                };
                btn._handler = handler;
                btn.addEventListener("click", handler);
            });

            const pageInfo = document.getElementById("pageInfo");
            if (pageInfo) {
                const from = totalRows === 0 ? 0 : startIndex + 1;
                const to = Math.min(startIndex + rowsPerPage, totalRows);
                pageInfo.textContent = `Записи ${from}-${to} из ${totalRows}`;
            }
            const pageNum = document.getElementById("pageNum");
            if (pageNum) pageNum.textContent = `Страница ${currentPage} / ${totalPages}`;
            const prevBtn = document.getElementById("prevPage");
            const nextBtn = document.getElementById("nextPage");
            if (prevBtn) prevBtn.disabled = currentPage <= 1;
            if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
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

        page.innerHTML = `
            <h1 class="page-title">Список задач — ${roleLabel(user.role)}</h1>
            <div class="card">
                <div class="toolbar">
                    ${user.role === "employee" ? "" : `
                        <button class="btn btn-secondary" id="modeMine">📋 Мои задачи</button>
                        <button class="btn btn-secondary" id="modeAll">${user.role === "manager" ? "👥 Задачи отдела" : "🌐 Все задачи"}</button>
                    `}
                    <button class="btn btn-primary" id="createTaskBtn">➕ Создать задачу</button>
                </div>
                <div class="toolbar">
                    <input id="searchTask" placeholder="🔍 Поиск по названию..." style="flex:2" />
                    <div style="display:flex; gap:8px; align-items:center;">
                        <span>📅</span>
                        <input id="dateFrom" type="date" placeholder="С даты создания" style="width:140px" />
                        <span>—</span>
                        <input id="dateTo" type="date" placeholder="По дату создания" style="width:140px" />
                    </div>
                    <button id="resetFilters" class="btn btn-secondary">🔄 Сбросить</button>
                </div>
                <div class="grid grid-3">
                    <select id="fStatus"><option value="">📊 Статус</option>${STATUS.map((s) => `<option>${escapeHtml(s)}</option>`).join("")}</select>
                    ${user.role === "employee" ? "" : `<select id="fAssignee"><option value="">👤 Исполнитель</option>${employeesForRole().map((e) => `<option value="${e.id}">${escapeHtml(e.fio)}</option>`).join("")}</select>`}
                    <select id="fProject"><option value="">📁 Проект</option>${db.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}</select>
                    <select id="fDeadline"><option value="">⏰ Срок</option><option value="today">Сегодня</option><option value="tomorrow">Завтра</option><option value="overdue">Просроченные</option></select>
                </div>
            </div>
            <div class="card" style="margin-top:16px;overflow:auto">
                <table style="width:100%">
                    <thead>
                        <tr><th>Задача</th>${user.role === "employee" ? "" : "<th>Исполнитель</th>"}<th>Проект</th><th>Срок</th><th>Просрочено</th><th>Статус</th>${user.role === "admin" ? "<th>🗑️</th>" : ""}</tr>
                    </thead>
                    <tbody id="rows"></tbody>
                </table>
                <div class="toolbar" style="justify-content:space-between;margin-top:10px">
                    <div id="pageInfo" class="muted"></div>
                    <div style="display:flex;gap:8px;align-items:center">
                        <button class="btn btn-secondary" id="prevPage">◀ Предыдущая</button>
                        <span id="pageNum" class="muted"></span>
                        <button class="btn btn-secondary" id="nextPage">Следующая ▶</button>
                    </div>
                </div>
            </div>
        `;

        ["fStatus", "fAssignee", "fProject", "fDeadline"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.onchange = renderFromFirstPage;
        });
        ["searchTask", "dateFrom", "dateTo"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.oninput = renderFromFirstPage;
        });
        
        document.getElementById("resetFilters").onclick = resetAllFilters;
        
        document.getElementById("prevPage").onclick = () => {
            if (currentPage > 1) {
                currentPage -= 1;
                render();
            }
        };
        document.getElementById("nextPage").onclick = () => {
            currentPage += 1;
            render();
        };
        
        document.getElementById("modeMine")?.addEventListener("click", () => { mode = "mine"; renderFromFirstPage(); });
        document.getElementById("modeAll")?.addEventListener("click", () => { mode = "all"; renderFromFirstPage(); });
        
        function showModalError(message) {
            const errorDiv = document.getElementById("modalError");
            if (errorDiv) {
                errorDiv.textContent = message;
                errorDiv.classList.remove("hidden");
            } else {
                showToast(message, "error");
            }
        }

        function hideModalError() {
            const errorDiv = document.getElementById("modalError");
            if (errorDiv) {
                errorDiv.classList.add("hidden");
                errorDiv.textContent = "";
            }
        }

        document.getElementById("createTaskBtn").onclick = () => {
            const preAssignee = new URLSearchParams(location.search).get("assignee") || "";
            openModal(`
                <h3>➕ Создание новой задачи</h3>
                <div id="modalError" class="login-error hidden" style="margin-bottom:12px"></div>
                <div class="grid grid-2">
                    <input id="mTitle" placeholder="Название задачи *" style="grid-column: span 2" />
                    <textarea id="mDesc" placeholder="Описание задачи" style="grid-column: span 2; min-height:80px"></textarea>
                    <select id="mAssignee">
                        <option value="">-- Выберите исполнителя * --</option>
                        ${employeesForRole().map((e) => `<option value="${e.id}" ${preAssignee === e.id ? "selected" : ""}>${escapeHtml(e.fio)}</option>`).join("")}
                    </select>
                    <select id="mProject">
                        <option value="">-- Выберите проект * --</option>
                        ${db.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
                    </select>
                    <select id="mStatus">${STATUS.map((s) => `<option>${escapeHtml(s)}</option>`).join("")}</select>
                    <select id="mHours" style="grid-column: span 2">
                        <option value="0.5">0.5 часа (30 минут)</option>
                        <option value="1" selected>1 час</option>
                        <option value="2">2 часа</option>
                        <option value="4">4 часа (полдня)</option>
                        <option value="8">8 часов (день)</option>
                        <option value="16">16 часов (2 дня)</option>
                        <option value="24">24 часа (3 дня)</option>
                        <option value="40">40 часов (неделя)</option>
                    </select>
                    <input id="mDeadline" type="date" value="${new Date().toISOString().slice(0,10)}"/>
                </div>
                <div style="margin-top:14px; color: var(--muted); font-size:12px">* — обязательные поля</div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
                    <button class="btn btn-secondary" id="cancelCreate">Отмена</button>
                    <button class="btn btn-primary" id="saveCreate">✅ Создать</button>
                </div>
            `);
            
            hideModalError();
            
            document.getElementById("cancelCreate").onclick = closeModal;
            document.getElementById("saveCreate").onclick = async () => {
                hideModalError();
                
                const title = document.getElementById("mTitle")?.value.trim();
                const assigneeId = document.getElementById("mAssignee")?.value;
                const projectId = document.getElementById("mProject")?.value;
                const deadline = document.getElementById("mDeadline")?.value;
                const status = document.getElementById("mStatus")?.value;
                const description = document.getElementById("mDesc")?.value;
                const estimatedHours = parseFloat(document.getElementById("mHours")?.value || 1);
                
                if (!title) {
                    showModalError("❌ Введите название задачи");
                    return;
                }
                if (!assigneeId) {
                    showModalError("❌ Выберите исполнителя");
                    return;
                }
                if (!projectId) {
                    showModalError("❌ Выберите проект");
                    return;
                }
                
                const today = new Date().toISOString().slice(0, 10);
                if (deadline < today) {
                    showModalError("❌ Срок задачи не может быть раньше сегодняшней даты");
                    return;
                }
                
                const newTask = {
                    title: title,
                    assigneeId: assigneeId,
                    projectId: projectId,
                    deadline: deadline,
                    creatorId: user.id,
                    status: status,
                    description: description || "",
                    estimatedHours: estimatedHours,
                    comments: [],
                    createdAt: new Date().toISOString(),
                    history: []
                };
                
                newTask.history = [{
                    id: crypto.randomUUID(),
                    date: new Date().toISOString(),
                    action: "Задача создана",
                    by: user.fio
                }];
                
                try {
                    await apiRequest("/tasks", {
                        method: "POST",
                        body: JSON.stringify(newTask)
                    });
                    await addNotification(`📋 Назначена новая задача "${newTask.title}"`, [newTask.assigneeId]);
                    
                    if (typeof loadAllData === "function") await loadAllData();
                    db = await getDb();
                    closeModal();
                    renderFromFirstPage();
                    showToast(`✅ Задача "${title}" создана`, "success");
                } catch (err) {
                    showModalError(`❌ Ошибка создания: ${err.message || "Неизвестная ошибка"}`);
                }
            };
        };

        if (new URLSearchParams(location.search).get("create") === "1") {
            setTimeout(() => document.getElementById("createTaskBtn")?.click(), 100);
        }
        
        render();
    })();
})();