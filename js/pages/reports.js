// js/pages/reports.js
(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        let db = await getDb();
        const { page } = renderLayout("reports");
        if (!page) return;

        let tasks = visibleTasksForUser(db, user, user.role === "employee" ? "mine" : "all");
        const templateKey = `report_template_${user.id}`;

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
            <h1 class="page-title">Отчеты — ${user.role === "manager" ? "Руководитель отдела" : roleLabel(user.role)}</h1>
            <div class="card">
                <div class="toolbar" style="flex-wrap: wrap; gap: 10px;">
                    <select id="reportType" style="min-width: 160px;">
                        <option>📋 Загрузка сотрудников</option>
                        <option>✅ Выполненные задачи</option>
                        <option>⚠️ Просроченные задачи</option>
                        <option>📁 Отчёт по проекту</option>
                    </select>
                    
                    <div style="display:flex; gap:8px; align-items:center; background: #f5f7fa; padding: 4px 12px; border-radius: var(--radius);">
                        <span>📅</span>
                        <input id="dateFrom" type="date" placeholder="С даты создания" style="width:130px" />
                        <span>—</span>
                        <input id="dateTo" type="date" placeholder="По дату создания" style="width:130px" />
                    </div>
                    
                    ${user.role === "admin" ? 
                        `<select id="depFilter" style="min-width: 140px;">
                            <option value="">🏢 Все отделы</option>
                            ${[...new Set(db.employees.map(e=>e.department))].filter(d=>d).map(d=>`<option>${escapeHtml(d)}</option>`).join("")}
                        </select>` : 
                        `<input type="text" id="depFilter" disabled value="${user.department || '—'}" style="background:#e9ecef" />`
                    }
                    
                    <select id="assigneeFilter" style="min-width: 160px;">
                        <option value="">👤 Все исполнители</option>
                        ${db.employees.filter(e => user.role === "admin" || e.department === user.department).map(e=>`<option value="${e.id}">${escapeHtml(e.fio)}</option>`).join("")}
                    </select>
                    
                    <select id="projectFilter" style="min-width: 160px;">
                        <option value="">📁 Все проекты</option>
                        ${db.projects.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}
                    </select>
                </div>
                
                <div class="toolbar" style="margin-top: 12px; justify-content: space-between;">
                    <div style="display: flex; gap: 8px;">
                        ${user.role === "employee" ? "" : `<button class="btn btn-secondary" id="saveTemplate">💾 Сохранить шаблон</button>`}
                        <button class="btn btn-primary" id="csvBtn">📎 Выгрузить в CSV</button>
                        <button class="btn btn-secondary" id="copyTableBtn">📋 Копировать таблицу</button>
                    </div>
                    <button class="btn btn-secondary" id="resetReportFilters">🔄 Сбросить фильтры</button>
                </div>
                
                <div style="overflow-x:auto; margin-top: 16px;">
                    <table style="width:100%">
                        <thead>
                            <tr>
                                <th>📌 Задача</th>
                                <th>👤 Исполнитель</th>
                                <th>📁 Проект</th>
                                <th>📊 Статус</th>
                                <th>⏰ Срок</th>
                                <th>📅 Создана</th>
                            </tr>
                        </thead>
                        <tbody id="repRows"></tbody>
                    </table>
                </div>
                
                <div class="toolbar" style="justify-content: space-between; margin-top: 12px;">
                    <div id="reportStats" class="muted"></div>
                    <div id="reportPageInfo" class="muted"></div>
                </div>
            </div>
        `;

        let currentPage = 1;
        const rowsPerPage = 15;
        let filteredTasks = [];

        function renderRows() {
            const tbody = document.getElementById("repRows");
            if (!tbody) return;
            
            const totalRows = filteredTasks.length;
            const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
            if (currentPage > totalPages) currentPage = totalPages;
            const startIndex = (currentPage - 1) * rowsPerPage;
            const pagedTasks = filteredTasks.slice(startIndex, startIndex + rowsPerPage);
            
            tbody.innerHTML = pagedTasks.map(t => `
                <tr>
                    <td><a href="task-detail.html?id=${t.id}" style="color:#0d47a1">${escapeHtml(t.title)}</a></td>
                    <td>${escapeHtml(db.employees.find(e=>e.id===t.assigneeId)?.fio || "—")}</td>
                    <td>${escapeHtml(db.projects.find(p=>p.id===t.projectId)?.name || "—")}</td>
                    <td><span class="status-chip ${statusClass(t.status)}">${escapeHtml(t.status)}</span></td>
                    <td>${t.deadline}</td>
                    <td>${t.createdAt ? new Date(t.createdAt).toLocaleDateString("ru-RU") : "—"}</td>
                </tr>
            `).join("");
            
            // Статистика
            const stats = document.getElementById("reportStats");
            if (stats) {
                const closedCount = filteredTasks.filter(t => t.status === "Закрыта").length;
                const overdueCount = filteredTasks.filter(t => t.deadline < new Date().toISOString().slice(0, 10) && t.status !== "Закрыта").length;
                stats.innerHTML = `📊 Всего: ${totalRows} задач | ✅ Закрыто: ${closedCount} | ⚠️ Просрочено: ${overdueCount}`;
            }
            
            const pageInfo = document.getElementById("reportPageInfo");
            if (pageInfo && totalRows > 0) {
                const from = startIndex + 1;
                const to = Math.min(startIndex + rowsPerPage, totalRows);
                pageInfo.innerHTML = `📄 Показаны ${from}-${to} из ${totalRows}`;
            } else if (pageInfo) {
                pageInfo.innerHTML = "📄 Нет данных";
            }
        }

        function resetReportFilters() {
            const filterIds = ["reportType", "dateFrom", "dateTo", "depFilter", "assigneeFilter", "projectFilter"];
            filterIds.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.value = "";
            });
            currentPage = 1;
            applyFilters();
        }

        function applyFilters() {
            const type = document.getElementById("reportType").value;
            const from = document.getElementById("dateFrom").value;
            const to = document.getElementById("dateTo").value;
            const dep = document.getElementById("depFilter")?.value || "";
            const assignee = document.getElementById("assigneeFilter").value;
            const project = document.getElementById("projectFilter").value;
            
            const base = visibleTasksForUser(db, user, user.role === "employee" ? "mine" : "all");
            
            filteredTasks = base.filter((t) => {
                const taskDep = db.employees.find((e) => e.id === t.assigneeId)?.department;
                const createdAt = t.createdAt ? t.createdAt.slice(0, 10) : "";
                return (!from || createdAt >= from)
                    && (!to || createdAt <= to)
                    && (!dep || taskDep === dep)
                    && (!assignee || t.assigneeId === assignee)
                    && (!project || t.projectId === project);
            });
            
            // Применяем тип отчёта
            if (type === "✅ Выполненные задачи") {
                filteredTasks = filteredTasks.filter((t) => t.status === "Закрыта");
            } else if (type === "⚠️ Просроченные задачи") {
                const today = new Date().toISOString().slice(0, 10);
                filteredTasks = filteredTasks.filter((t) => t.deadline < today && t.status !== "Закрыта");
            } else if (type === "📁 Отчёт по проекту") {
                // Добавляем группировку по проектам
                const projectId = document.getElementById("projectFilter").value;
                if (projectId) {
                    filteredTasks = filteredTasks.filter(t => t.projectId === projectId);
                }
            }
            
            currentPage = 1;
            renderRows();
        }

        // Пагинация для отчётов
        function changePage(delta) {
            const totalRows = filteredTasks.length;
            const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
            const newPage = currentPage + delta;
            if (newPage >= 1 && newPage <= totalPages) {
                currentPage = newPage;
                renderRows();
            }
        }

        // Добавляем кнопки пагинации
        function addPaginationButtons() {
            const container = document.getElementById("reportPageInfo");
            if (!container) return;
            
            const existingBtns = document.querySelector(".report-pagination");
            if (existingBtns) existingBtns.remove();
            
            const paginationDiv = document.createElement("div");
            paginationDiv.className = "toolbar report-pagination";
            paginationDiv.style.justifyContent = "flex-end";
            paginationDiv.style.marginTop = "8px";
            paginationDiv.innerHTML = `
                <button class="btn btn-secondary" id="reportPrevPage" style="padding: 4px 12px;">◀</button>
                <span id="reportCurrentPage" class="muted" style="margin: 0 8px;"></span>
                <button class="btn btn-secondary" id="reportNextPage" style="padding: 4px 12px;">▶</button>
            `;
            container.parentNode.insertBefore(paginationDiv, container.nextSibling);
            
            const updatePageDisplay = () => {
                const totalRows = filteredTasks.length;
                const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
                const pageSpan = document.getElementById("reportCurrentPage");
                if (pageSpan) pageSpan.textContent = `Стр. ${currentPage} / ${totalPages}`;
                
                const prevBtn = document.getElementById("reportPrevPage");
                const nextBtn = document.getElementById("reportNextPage");
                if (prevBtn) prevBtn.disabled = currentPage <= 1;
                if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
            };
            
            document.getElementById("reportPrevPage")?.addEventListener("click", () => {
                changePage(-1);
                updatePageDisplay();
            });
            document.getElementById("reportNextPage")?.addEventListener("click", () => {
                changePage(1);
                updatePageDisplay();
            });
            
            updatePageDisplay();
        }

        // Назначаем обработчики
        ["reportType", "dateFrom", "dateTo", "depFilter", "assigneeFilter", "projectFilter"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener("change", applyFilters);
        });
        
        document.getElementById("resetReportFilters")?.addEventListener("click", resetReportFilters);
        
        document.getElementById("saveTemplate")?.addEventListener("click", () => {
            const model = {
                reportType: document.getElementById("reportType").value,
                dateFrom: document.getElementById("dateFrom").value,
                dateTo: document.getElementById("dateTo").value,
                depFilter: document.getElementById("depFilter")?.value || "",
                assigneeFilter: document.getElementById("assigneeFilter").value,
                projectFilter: document.getElementById("projectFilter").value
            };
            localStorage.setItem(templateKey, JSON.stringify(model));
            showToast("💾 Шаблон отчёта сохранён", "success");
        });
        
        document.getElementById("csvBtn").addEventListener("click", () => {
            const rows = [
                ["Задача", "Исполнитель", "Проект", "Статус", "Срок", "Создана"], 
                ...filteredTasks.map(t => [
                    t.title, 
                    db.employees.find(e=>e.id===t.assigneeId)?.fio || "", 
                    db.projects.find(p=>p.id===t.projectId)?.name || "", 
                    t.status, 
                    t.deadline,
                    t.createdAt ? new Date(t.createdAt).toLocaleDateString("ru-RU") : ""
                ])
            ];
            const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
            const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `report_${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
        });

        document.getElementById("copyTableBtn").addEventListener("click", async () => {
            const header = ["Задача", "Исполнитель", "Проект", "Статус", "Срок", "Создана"];
            const lines = filteredTasks.map((t) => [
                t.title,
                db.employees.find((e) => e.id === t.assigneeId)?.fio || "",
                db.projects.find((p) => p.id === t.projectId)?.name || "",
                t.status,
                t.deadline,
                t.createdAt ? new Date(t.createdAt).toLocaleDateString("ru-RU") : ""
            ]);
            const text = [header, ...lines].map((row) => row.join("\t")).join("\n");
            try {
                await navigator.clipboard.writeText(text);
                showToast("📋 Таблица скопирована в буфер обмена", "success");
            } catch (_) {
                const ta = document.createElement("textarea");
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                ta.remove();
                showToast("📋 Таблица скопирована в буфер обмена", "success");
            }
        });
        
        // Восстановление сохранённого шаблона
        const saved = localStorage.getItem(templateKey);
        if (saved) {
            try {
                const model = JSON.parse(saved);
                Object.entries(model).forEach(([k, v]) => {
                    const el = document.getElementById(k);
                    if (el) el.value = v;
                });
            } catch(e) {}
        }
        
        applyFilters();
        addPaginationButtons();
    })();
})();