// js/pages/project-detail.js
// Канбан-доска как в Trello

(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        let db = await getDb();
        const { page } = renderLayout("projects");
        if (!page) return;

        const projectId = new URLSearchParams(location.search).get("id");
        if (!projectId) {
            page.innerHTML = "<div class='card'>Проект не выбран. Вернитесь к списку проектов.</div>";
            return;
        }

        const project = db.projects.find((p) => p.id === projectId);
        if (!project) {
            page.innerHTML = "<div class='card'>Проект не найден.</div>";
            return;
        }

        // Статусы задач в порядке колонок
        const COLUMNS = [
            { id: "new", title: "📥 Новая", status: "Новая", color: "#e3f2fd" },
            { id: "inprogress", title: "▶ В работе", status: "В работе", color: "#fff3e0" },
            { id: "review", title: "🔍 На проверке", status: "На проверке", color: "#ede7f6" },
            { id: "done", title: "✅ Готово", status: "Закрыта", color: "#e8f5e9" }
        ];

        // Доступные метки
        const LABELS = [
            { id: "bug", name: "🐛 Баг", color: "#f44336" },
            { id: "feature", name: "✨ Фича", color: "#4caf50" },
            { id: "docs", name: "📝 Документация", color: "#2196f3" },
            { id: "urgent", name: "🔥 Срочно", color: "#ff9800" },
            { id: "waiting", name: "🤔 На согласовании", color: "#ffc107" },
            { id: "refactor", name: "🔄 Рефакторинг", color: "#9c27b0" },
            { id: "test", name: "🧪 Тестирование", color: "#00bcd4" },
            { id: "data", name: "📊 Данные", color: "#607d8b" }
        ];

        let currentFilterAssignee = "";
        let currentFilterLabel = "";
        let currentGroupBy = "none"; // none, assignee

        function getInitials(fio) {
            if (!fio) return "??";
            const parts = fio.split(" ");
            if (parts.length >= 2) {
                return (parts[0][0] + parts[1][0]).toUpperCase();
            }
            return fio.slice(0, 2).toUpperCase();
        }

        function getAvatarColor(name) {
            let hash = 0;
            for (let i = 0; i < name.length; i++) {
                hash = name.charCodeAt(i) + ((hash << 5) - hash);
            }
            const hue = Math.abs(hash % 360);
            return `hsl(${hue}, 60%, 45%)`;
        }

        function formatDate(dateStr) {
            if (!dateStr) return "";
            const d = new Date(dateStr);
            return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}`;
        }

        function isOverdue(deadline) {
            if (!deadline) return false;
            const today = new Date().toISOString().slice(0, 10);
            return deadline < today;
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

        async function updateTaskStatus(taskId, newStatus) {
            const task = db.tasks.find((t) => t.id === taskId);
            if (!task) return false;
            if (task.status === newStatus) return false;

            // Проверка прав
            if (!canEditTask(task, user, db)) {
                showToast("❌ У вас нет прав на изменение статуса задачи", "error");
                return false;
            }

            const prevStatus = task.status;

            try {
                await apiRequest(`/tasks/${taskId}`, {
                    method: "PUT",
                    body: JSON.stringify({ status: newStatus })
                });

                await addTaskHistory(task, `Канбан: ${prevStatus} → ${newStatus}`, user.fio);
                await addNotification(`Задача "${task.title}" перемещена в "${newStatus}"`, [task.assigneeId]);

                if (typeof loadAllData === "function") await loadAllData();
                db = await getDb();
                renderKanban();
                return true;
            } catch (err) {
                console.error("Ошибка обновления статуса:", err);
                showToast(`❌ Ошибка: ${err.message || "Неизвестная ошибка"}`, "error");
                return false;
            }
        }

        function canEditTask(task, user, db) {
            if (user.role === "admin") return true;
            if (task.assigneeId === user.id) return true;

            const assignee = db.employees.find((e) => e.id === task.assigneeId);
            if (assignee && assignee.department === user.department && user.role.startsWith("head_")) {
                return true;
            }

            const project = db.projects.find((p) => p.id === task.projectId);
            if (project && user.id === project.createdBy) return true;

            return user.role === "project_manager";
        }

        function getFilteredTasks() {
            let tasks = db.tasks.filter((t) => t.projectId === project.id);

            if (currentFilterAssignee) {
                tasks = tasks.filter((t) => t.assigneeId === currentFilterAssignee);
            }

            if (currentFilterLabel) {
                tasks = tasks.filter((t) => t.labels && t.labels.includes(currentFilterLabel));
            }

            return tasks;
        }

        function renderTaskCard(task) {
            const assignee = db.employees.find((e) => e.id === task.assigneeId);
            const assigneeName = assignee ? assignee.fio : "Не назначен";
            const initials = getInitials(assigneeName);
            const avatarColor = getAvatarColor(assigneeName);
            const overdue = isOverdue(task.deadline);
            const taskLabels = task.labels || [];

            return `
                <div class="task-card" data-task-id="${task.id}" draggable="true">
                    <div class="task-card-title">
                        <a href="task-detail.html?id=${task.id}">${escapeHtml(task.title)}</a>
                    </div>
                    <div class="task-card-labels">
                        ${taskLabels.map(labelId => {
                            const label = LABELS.find(l => l.id === labelId);
                            return label ? `<span class="task-label" style="background:${label.color}20; color:${label.color}; border-left:3px solid ${label.color}">${label.name}</span>` : "";
                        }).join("")}
                    </div>
                    <div class="task-card-footer">
                        <div class="task-card-avatar" style="background:${avatarColor}" title="${escapeHtml(assigneeName)}">
                            ${initials}
                        </div>
                        <div class="task-card-deadline ${overdue ? "overdue" : ""}">
                            ${task.deadline ? `📅 ${formatDate(task.deadline)}` : "—"}
                        </div>
                    </div>
                </div>
            `;
        }

        function renderColumn(column, tasks) {
            const columnTasks = tasks.filter((t) => t.status === column.status);
            
            return `
                <div class="kanban-column" data-status="${column.status}" data-column-id="${column.id}">
                    <div class="column-header">
                        <h3>${column.title} <span class="column-count">${columnTasks.length}</span></h3>
                        <button class="add-task-btn" data-status="${column.status}" title="Создать задачу">+</button>
                    </div>
                    <div class="column-tasks" data-status="${column.status}">
                        ${columnTasks.map(task => renderTaskCard(task)).join("")}
                        ${columnTasks.length === 0 ? '<div class="empty-column">Нет задач</div>' : ""}
                    </div>
                </div>
            `;
        }

        function renderGroupedByAssignee(columns, tasks) {
            // Получаем всех исполнителей, у которых есть задачи в этом проекте
            const assigneesWithTasks = [...new Set(tasks.map(t => t.assigneeId).filter(Boolean))];
            const assignees = assigneesWithTasks.map(id => db.employees.find(e => e.id === id)).filter(Boolean);
            
            if (assignees.length === 0) {
                return `<div class="kanban-empty">Нет задач для отображения</div>`;
            }
            
            let html = `<div class="kanban-swimlanes">`;
            
            for (const assignee of assignees) {
                const assigneeTasks = tasks.filter(t => t.assigneeId === assignee.id);
                const initials = getInitials(assignee.fio);
                const avatarColor = getAvatarColor(assignee.fio);
                
                html += `
                    <div class="swimlane">
                        <div class="swimlane-header">
                            <div class="swimlane-avatar" style="background:${avatarColor}">${initials}</div>
                            <span class="swimlane-name">${escapeHtml(assignee.fio)}</span>
                            <span class="swimlane-count">${assigneeTasks.length} задач</span>
                        </div>
                        <div class="swimlane-columns">
                            <div class="kanban-board-inline">
                                ${columns.map(col => {
                                    const colTasks = assigneeTasks.filter(t => t.status === col.status);
                                    return `
                                        <div class="kanban-column-small" data-status="${col.status}">
                                            <div class="column-header-small">${col.title} <span class="column-count">${colTasks.length}</span></div>
                                            <div class="column-tasks-small">
                                                ${colTasks.map(task => renderTaskCard(task)).join("")}
                                            </div>
                                        </div>
                                    `;
                                }).join("")}
                            </div>
                        </div>
                    </div>
                `;
            }
            
            html += `</div>`;
            return html;
        }

        async function renderKanban() {
            const tasks = getFilteredTasks();
            const canCreateProject = window.canCreateProject ? window.canCreateProject(user) : 
                ['admin', 'project_manager', 'client_manager', 'head_data', 'head_dev', 'head_qa'].includes(user.role);
            
            // Получаем список сотрудников для фильтра
            const employees = db.employees;
            
            page.innerHTML = `
                <div class="kanban-container">
                    <div class="kanban-header">
                        <h1 class="page-title">📋 ${escapeHtml(project.name)}</h1>
                        ${canCreateProject ? `<button class="btn btn-secondary" id="editProjectBtn">✏️ Редактировать проект</button>` : ""}
                        <button class="btn btn-secondary" id="backToProjectsBtn">← Все проекты</button>
                    </div>
                    
                    <div class="kanban-filters">
                        <div class="filter-group">
                            <label>👤 Исполнитель:</label>
                            <select id="filterAssignee">
                                <option value="">Все</option>
                                ${employees.map(e => `<option value="${e.id}" ${currentFilterAssignee === e.id ? "selected" : ""}>${escapeHtml(e.fio)}</option>`).join("")}
                            </select>
                        </div>
                        <div class="filter-group">
                            <label>🏷️ Метка:</label>
                            <select id="filterLabel">
                                <option value="">Все</option>
                                ${LABELS.map(l => `<option value="${l.id}" ${currentFilterLabel === l.id ? "selected" : ""}>${l.name}</option>`).join("")}
                            </select>
                        </div>
                        <div class="filter-group">
                            <label>📊 Группировка:</label>
                            <select id="groupBy">
                                <option value="none" ${currentGroupBy === "none" ? "selected" : ""}>Нет</option>
                                <option value="assignee" ${currentGroupBy === "assignee" ? "selected" : ""}>По исполнителям</option>
                            </select>
                        </div>
                        <button class="btn btn-secondary" id="resetFiltersBtn">🔄 Сбросить</button>
                    </div>
                    
                    <div class="kanban-board" id="kanbanBoard">
                        ${currentGroupBy === "assignee" 
                            ? renderGroupedByAssignee(COLUMNS, tasks)
                            : `<div class="kanban-columns">
                                ${COLUMNS.map(col => renderColumn(col, tasks)).join("")}
                               </div>`
                        }
                    </div>
                </div>
            `;

            // Настройка drag-and-drop (только если не в режиме группировки)
            if (currentGroupBy !== "assignee") {
                setupDragAndDrop();
            }

            // Обработчики фильтров
            document.getElementById("filterAssignee")?.addEventListener("change", (e) => {
                currentFilterAssignee = e.target.value;
                renderKanban();
            });
            
            document.getElementById("filterLabel")?.addEventListener("change", (e) => {
                currentFilterLabel = e.target.value;
                renderKanban();
            });
            
            document.getElementById("groupBy")?.addEventListener("change", (e) => {
                currentGroupBy = e.target.value;
                renderKanban();
            });
            
            document.getElementById("resetFiltersBtn")?.addEventListener("click", () => {
                currentFilterAssignee = "";
                currentFilterLabel = "";
                currentGroupBy = "none";
                renderKanban();
            });
            
            document.getElementById("backToProjectsBtn")?.addEventListener("click", () => {
                window.location.href = "projects.html";
            });
            
            document.getElementById("editProjectBtn")?.addEventListener("click", () => {
                openEditProjectModal();
            });
            
            // Обработчики кнопок создания задач
            document.querySelectorAll(".add-task-btn").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    const status = btn.dataset.status;
                    openCreateTaskModal(status);
                });
            });
        }

        function setupDragAndDrop() {
            const cards = document.querySelectorAll(".task-card");
            const columns = document.querySelectorAll(".column-tasks");

            cards.forEach(card => {
                card.setAttribute("draggable", "true");
                
                card.addEventListener("dragstart", (e) => {
                    e.dataTransfer.setData("text/plain", card.dataset.taskId);
                    card.classList.add("dragging");
                });
                
                card.addEventListener("dragend", (e) => {
                    card.classList.remove("dragging");
                });
            });

            columns.forEach(column => {
                column.addEventListener("dragover", (e) => {
                    e.preventDefault();
                    column.classList.add("drag-over");
                });
                
                column.addEventListener("dragleave", () => {
                    column.classList.remove("drag-over");
                });
                
                column.addEventListener("drop", async (e) => {
                    e.preventDefault();
                    column.classList.remove("drag-over");
                    
                    const taskId = e.dataTransfer.getData("text/plain");
                    const newStatus = column.dataset.status;
                    
                    if (taskId && newStatus) {
                        const task = db.tasks.find(t => t.id === taskId);
                        if (task && task.status !== newStatus) {
                            const loadingDiv = document.createElement("div");
                            loadingDiv.className = "drag-loading";
                            loadingDiv.textContent = "⏳";
                            document.body.appendChild(loadingDiv);
                            
                            await updateTaskStatus(taskId, newStatus);
                            
                            loadingDiv.remove();
                        }
                    }
                });
            });
        }

        function openCreateTaskModal(defaultStatus = "Новая") {
            const employees = db.employees;
            
            openModal(`
                <h3>➕ Создать задачу</h3>
                <div id="modalError" class="login-error hidden"></div>
                <div class="modal-form">
                    <label>Название задачи *</label>
                    <input id="taskTitle" type="text" placeholder="Введите название" />
                    
                    <label>Описание</label>
                    <textarea id="taskDesc" placeholder="Описание задачи" rows="3"></textarea>
                    
                    <label>Исполнитель *</label>
                    <select id="taskAssignee">
                        <option value="">-- Выберите --</option>
                        ${employees.map(e => `<option value="${e.id}">${escapeHtml(e.fio)} (${escapeHtml(e.department)})</option>`).join("")}
                    </select>
                    
                    <label>Метки</label>
                    <div class="labels-selector">
                        ${LABELS.map(l => `
                            <label class="label-option">
                                <input type="checkbox" value="${l.id}" class="label-checkbox">
                                <span style="background:${l.color}20; color:${l.color}; padding:2px 8px; border-radius:12px; font-size:12px;">${l.name}</span>
                            </label>
                        `).join("")}
                    </div>
                    
                    <label>Оценка времени</label>
                    <select id="taskHours">
                        <option value="0.5">0.5 часа</option>
                        <option value="1" selected>1 час</option>
                        <option value="2">2 часа</option>
                        <option value="4">4 часа</option>
                        <option value="8">8 часов</option>
                    </select>
                    
                    <label>Дедлайн</label>
                    <input id="taskDeadline" type="date" value="${new Date().toISOString().slice(0, 10)}" />
                    
                    <label>Статус</label>
                    <select id="taskStatus">
                        <option value="Новая" ${defaultStatus === "Новая" ? "selected" : ""}>Новая</option>
                        <option value="В работе" ${defaultStatus === "В работе" ? "selected" : ""}>В работе</option>
                        <option value="На проверке" ${defaultStatus === "На проверке" ? "selected" : ""}>На проверке</option>
                        <option value="Закрыта" ${defaultStatus === "Закрыта" ? "selected" : ""}>Закрыта</option>
                    </select>
                </div>
                <div class="modal-buttons">
                    <button class="btn btn-secondary" id="cancelModal">Отмена</button>
                    <button class="btn btn-primary" id="saveTaskBtn">✅ Создать</button>
                </div>
            `);
            
            document.getElementById("cancelModal").onclick = closeModal;
            document.getElementById("saveTaskBtn").onclick = async () => {
                const title = document.getElementById("taskTitle").value.trim();
                const assigneeId = document.getElementById("taskAssignee").value;
                const deadline = document.getElementById("taskDeadline").value;
                const status = document.getElementById("taskStatus").value;
                const description = document.getElementById("taskDesc").value;
                const estimatedHours = parseFloat(document.getElementById("taskHours").value);
                
                const selectedLabels = Array.from(document.querySelectorAll(".label-checkbox:checked")).map(cb => cb.value);
                
                if (!title) {
                    showModalError("Введите название задачи");
                    return;
                }
                if (!assigneeId) {
                    showModalError("Выберите исполнителя");
                    return;
                }
                
                const today = new Date().toISOString().slice(0, 10);
                if (deadline < today) {
                    showModalError("Дедлайн не может быть раньше сегодня");
                    return;
                }
                
                try {
                    await apiRequest("/tasks", {
                        method: "POST",
                        body: JSON.stringify({
                            title,
                            description,
                            assigneeId,
                            creatorId: user.id,
                            projectId: project.id,
                            deadline,
                            estimatedHours,
                            labels: selectedLabels,
                            status
                        })
                    });
                    
                    await addNotification(`📋 Новая задача "${title}" в проекте ${project.name}`, [assigneeId]);
                    
                    if (typeof loadAllData === "function") await loadAllData();
                    db = await getDb();
                    closeModal();
                    renderKanban();
                    showToast(`✅ Задача "${title}" создана`, "success");
                } catch (err) {
                    showModalError(`Ошибка: ${err.message}`);
                }
            };
            
            function showModalError(msg) {
                const errDiv = document.getElementById("modalError");
                errDiv.textContent = msg;
                errDiv.classList.remove("hidden");
            }
        }

        function openEditProjectModal() {
            openModal(`
                <h3>✏️ Редактирование проекта</h3>
                <div class="modal-form">
                    <label>Название проекта</label>
                    <input id="editProjectName" type="text" value="${escapeHtml(project.name)}" />
                    
                    <label>Описание</label>
                    <textarea id="editProjectDesc" rows="3">${escapeHtml(project.description || "")}</textarea>
                    
                    <label>Дедлайн</label>
                    <input id="editProjectDeadline" type="date" value="${project.deadline || ""}" />
                    
                    <label>Статус</label>
                    <select id="editProjectStatus">
                        <option value="active" ${project.status === "active" ? "selected" : ""}>Активный</option>
                        <option value="archived" ${project.status === "archived" ? "selected" : ""}>Архивный</option>
                    </select>
                </div>
                <div class="modal-buttons">
                    <button class="btn btn-secondary" id="cancelEdit">Отмена</button>
                    <button class="btn btn-primary" id="saveEdit">💾 Сохранить</button>
                    ${user.role === "admin" || user.id === project.createdBy ? `<button class="btn btn-danger" id="archiveProjectBtn"> Архивировать</button>` : ""}
                </div>
            `);
            
            document.getElementById("cancelEdit").onclick = closeModal;
            document.getElementById("saveEdit").onclick = async () => {
                const name = document.getElementById("editProjectName").value.trim();
                const description = document.getElementById("editProjectDesc").value;
                const deadline = document.getElementById("editProjectDeadline").value;
                const status = document.getElementById("editProjectStatus").value;
                
                if (!name) {
                    showToast("❌ Название проекта обязательно", "error");
                    return;
                }
                
                try {
                    await apiRequest(`/projects/${project.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ name, description, deadline, status })
                    });
                    
                    if (typeof loadAllData === "function") await loadAllData();
                    db = await getDb();
                    closeModal();
                    
                    if (status === "archived") {
                        window.location.href = "projects.html";
                    } else {
                        renderKanban();
                    }
                    showToast("✅ Проект обновлен", "success");
                } catch (err) {
                    showToast(`❌ Ошибка: ${err.message}`, "error");
                }
            };
            
            document.getElementById("archiveProjectBtn")?.addEventListener("click", async () => {
                if (confirm("Архивировать проект? Он переместится в архив.")) {
                    try {
                        await apiRequest(`/projects/${project.id}`, { method: "DELETE" });
                        if (typeof loadAllData === "function") await loadAllData();
                        window.location.href = "projects.html";
                    } catch (err) {
                        showToast(`❌ Ошибка: ${err.message}`, "error");
                    }
                }
            });
        }

        await renderKanban();
    })();
})();