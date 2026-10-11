// js/pages/task-detail.js
(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        let db = await getDb();
        const { page } = renderLayout("tasks");
        if (!page) return;

        const id = new URLSearchParams(location.search).get("id");
        if (!id) {
            page.innerHTML = "<div class='card'>Задача не найдена.</div>";
            return;
        }

        function currentTask() {
            return db.tasks.find((t) => t.id === id);
        }

        // Функция проверки прав на редактирование задачи (аналогичная бэкенду)
        function canEditTask(task) {
            if (!task) return false;
            if (user.role === 'admin') return true;
            if (task.assigneeId === user.id) return true;

            const assignee = db.employees.find((e) => e.id === task.assigneeId);
            if (assignee && assignee.department === user.department && user.role.startsWith('head_')) {
                return true;
            }

            const project = db.projects.find((p) => p.id === task.projectId);
            if (project && user.id === project.createdBy) return true;

            return user.role === 'project_manager';
        }

        async function updateStatus(s) {
            const task = currentTask();
            if (!task) return;
            if (!canEditTask(task)) {
                showToast("❌ У вас нет прав на изменение статуса", "error");
                return;
            }
            const prev = task.status;
            task.status = s;
            await addTaskHistory(task, `Статус изменен: ${prev} -> ${s}`, user.fio);
            await setDb(db);
            await addNotification(`Задача "${task.title}" переведена в статус "${s}"`, [task.assigneeId]);
            if (typeof loadAllData === "function") await loadAllData();
            db = await getDb();
            render();
            showToast(`✅ Статус изменен на "${s}"`, "success");
        }

        async function deleteCurrentTask() {
            const task = currentTask();
            if (!task) return;
            if (!canEditTask(task)) {
                showToast("❌ У вас нет прав на удаление задачи", "error");
                return;
            }

            openModal(`
                <h3>🗑️ Удаление задачи</h3>
                <p>Вы уверены, что хотите удалить задачу <strong>"${escapeHtml(task.title)}"</strong>?</p>
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
                    await apiRequest(`/tasks/${task.id}`, { method: "DELETE" });
                    await addNotification(`Задача "${task.title}" была удалена`, []);
                    showToast(`✅ Задача "${task.title}" удалена`, "success");
                    window.location.href = "tasks.html";
                } catch (err) {
                    showToast(`❌ Ошибка удаления: ${err.message || "Неизвестная ошибка"}`, "error");
                }
            };
        }

        async function render() {
            const task = currentTask();
            if (!task) {
                page.innerHTML = "<div class='card'>Задача не найдена.</div>";
                return;
            }
            const assignee = db.employees.find((e) => e.id === task.assigneeId);
            const creator = db.employees.find((e) => e.id === task.creatorId);
            const editable = canEditTask(task);

            page.innerHTML = `
                <h1 class="page-title">📋 Карточка задачи — ${roleLabel(user.role)}</h1>
                <div class="card">
                    <h2>${escapeHtml(task.title)}</h2>
                    <p class="muted">${escapeHtml(task.description) || "Описание не заполнено"}</p>
                    <p><b>👤 Исполнитель:</b> ${assignee?.fio || "—"} · <b>📁 Проект:</b> ${db.projects.find(p=>p.id===task.projectId)?.name || "—"}</p>
                    <p><b>✏️ Создал:</b> ${creator?.fio || "—"} · <b>📅 Создана:</b> ${task.createdAt ? new Date(task.createdAt).toLocaleDateString("ru-RU") : "—"}</p>
                    <p><b>⏱️ Оценка времени:</b> ${task.estimatedHours || 1} час(ов) · <b>⏰ Срок:</b> ${task.deadline}</p>
                    <p><b>📊 Статус:</b> <span class="status-chip ${statusClass(task.status)}">${escapeHtml(task.status)}</span></p>
                    ${editable ? `
                    <div class="toolbar">
                        <button class="btn btn-secondary" id="toWork">▶ В работу</button>
                        <button class="btn btn-primary" id="toReview">🔍 На проверке</button>
                        <button class="btn btn-primary" id="closeTask">✅ Закрыть задачу</button>
                        ${user.role !== 'employee' ? `<button class="btn btn-secondary" id="reassign">🔄 Переложить задачу</button>` : ''}
                        ${user.role !== 'employee' ? `<button class="btn btn-danger" id="rework">↩️ На доработку</button>` : ''}
                        ${user.role === "admin" ? `<button class="btn btn-danger" id="deleteTask">🗑️ Удалить задачу</button>` : ''}
                    </div>
                    ` : `
                    <div class="muted" style="margin-top:10px">⛔ У вас нет прав на изменение этой задачи</div>
                    `}
                </div>
                <div class="card" style="margin-top:16px">
                    <button class="btn btn-secondary" id="toggleHistory">📜 История изменений</button>
                    <div id="historyBlock" class="hidden" style="margin-top:10px">
                        ${(task.history || []).map(h => `<p><b>${new Date(h.date).toLocaleString("ru-RU")}</b> — ${escapeHtml(h.action)} <span class="muted">(${escapeHtml(h.by)})</span></p>`).join("") || "<p class='muted'>История пока пустая</p>"}
                    </div>
                </div>
                <div class="card" style="margin-top:16px">
                    <h3>💬 Комментарии</h3>
                    <div id="comments">${(task.comments || []).map(c => `<p><b>${escapeHtml(c.author)}</b>: ${escapeHtml(c.text)} <span class="muted">${new Date(c.date).toLocaleString("ru-RU")}</span></p>`).join("") || "<p class='muted'>Комментариев пока нет</p>"}</div>
                    <div class="toolbar">
                        <input id="commentText" placeholder="💬 Введите комментарий..." style="flex:1" />
                        <button class="btn btn-primary" id="addComment">📝 Добавить</button>
                    </div>
                </div>
            `;

            // Навешиваем обработчики только если есть права на редактирование
            if (editable) {
                document.getElementById("toWork")?.addEventListener("click", () => updateStatus("В работе"));
                document.getElementById("toReview")?.addEventListener("click", () => updateStatus("На проверке"));
                document.getElementById("closeTask")?.addEventListener("click", () => updateStatus("Закрыта"));
                document.getElementById("deleteTask")?.addEventListener("click", deleteCurrentTask);

                document.getElementById("rework")?.addEventListener("click", () => {
                    openModal(`
                        <h3>↩️ Отправка на доработку</h3>
                        <textarea id="rwReason" placeholder="Причина доработки..." style="width:100%;height:80px"></textarea>
                        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
                            <button class="btn btn-secondary" id="rwCancel">Отмена</button>
                            <button class="btn btn-primary" id="rwSave">Отправить</button>
                        </div>
                    `);
                    document.getElementById("rwCancel").onclick = closeModal;
                    document.getElementById("rwSave").onclick = async () => {
                        const reason = document.getElementById("rwReason").value.trim();
                        if (reason) await addTaskHistory(task, `Отправлено на доработку: ${reason}`, user.fio);
                        await updateStatus("В работе");
                        closeModal();
                    };
                });

                document.getElementById("reassign")?.addEventListener("click", () => {
                    const list = user.role === "admin" ? db.employees : db.employees.filter(e => e.department === user.department);
                    openModal(`
                        <h3>🔄 Переложить задачу</h3>
                        <select id="newAssignee" style="width:100%">
                            ${list.map(e=>`<option value="${e.id}">${escapeHtml(e.fio)}</option>`).join("")}
                        </select>
                        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
                            <button class="btn btn-secondary" id="raCancel">Отмена</button>
                            <button class="btn btn-primary" id="raSave">Переложить</button>
                        </div>
                    `);
                    document.getElementById("raCancel").onclick = closeModal;
                    document.getElementById("raSave").onclick = async () => {
                        const prevAssignee = db.employees.find((e) => e.id === task.assigneeId)?.fio || "";
                        task.assigneeId = document.getElementById("newAssignee").value;
                        const nextAssignee = db.employees.find((e) => e.id === task.assigneeId)?.fio || "";
                        await addTaskHistory(task, `Исполнитель изменен: ${prevAssignee} -> ${nextAssignee}`, user.fio);
                        await setDb(db);
                        await addNotification(`Вам назначена задача "${task.title}"`, [task.assigneeId]);
                        closeModal();
                        if (typeof loadAllData === "function") await loadAllData();
                        db = await getDb();
                        render();
                        showToast(`✅ Задача переложена на ${nextAssignee}`, "success");
                    };
                });
            }

            // Комментарии доступны всем
            document.getElementById("addComment")?.addEventListener("click", async () => {
                const txt = document.getElementById("commentText").value.trim();
                if (!txt) return;
                task.comments = task.comments || [];
                task.comments.push({
                    author: getCurrentUser().fio,
                    text: txt,
                    date: new Date().toISOString()
                });
                await addTaskHistory(task, "Добавлен комментарий", getCurrentUser().fio);
                await setDb(db);
                if (typeof loadAllData === "function") await loadAllData();
                db = await getDb();
                render();
                showToast(`💬 Комментарий добавлен`, "success");
            });

            document.getElementById("toggleHistory")?.addEventListener("click", () =>
                document.getElementById("historyBlock").classList.toggle("hidden")
            );
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

        render();
    })();
})();