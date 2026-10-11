// js/pages/dashboard.js
(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        let db = await getDb();
        const { page } = renderLayout("dashboard");
        if (!page) return;

        const isoToday = new Date().toISOString().slice(0, 10);
        
        // ========== ОПРЕДЕЛЯЕМ КОГО ПОКАЗЫВАТЬ ==========
        let employeesToShow = [];
        let tasksToShow = [];
        
        if (user.role === 'admin') {
            // Админ видит всех
            employeesToShow = db.employees;
            tasksToShow = db.tasks;
        } 
        else if (user.role.startsWith('head_')) {
            // Начальник отдела видит только свой отдел
            employeesToShow = db.employees.filter(e => e.department === user.department);
            tasksToShow = db.tasks.filter(t => {
                const assignee = db.employees.find(e => e.id === t.assigneeId);
                return assignee && assignee.department === user.department;
            });
        }
        else if (user.role === 'project_manager') {
            // Руководитель проектов видит все задачи (как админ, но с ограниченными правами)
            employeesToShow = db.employees;
            tasksToShow = db.tasks;
        }
        else if (user.role === 'client_manager') {
            // Руководитель отдела по работе с клиентами — только свой отдел
            employeesToShow = db.employees.filter(e => e.department === user.department);
            tasksToShow = db.tasks.filter(t => {
                const assignee = db.employees.find(e => e.id === t.assigneeId);
                return assignee && assignee.department === user.department;
            });
        }
        else {
            // Обычный сотрудник видит только свои задачи
            employeesToShow = [user];
            tasksToShow = db.tasks.filter(t => t.assigneeId === user.id);
        }

        // Задачи для текущего пользователя (назначенные на него)
        const myTasks = db.tasks.filter(t => t.assigneeId === user.id);
        
        // Мои задачи на сегодня
        const myTasksToday = myTasks.filter(t => t.deadline === isoToday);
        
        // Мои просроченные задачи
        const myOverdueTasks = myTasks.filter(t => t.deadline < isoToday && t.status !== "Закрыта");
        
        // Просроченные задачи (все, которые видны)
        const overdueTasks = tasksToShow.filter(t => t.deadline < isoToday && t.status !== "Закрыта");
        
        // Новые задачи за 24 часа
        const newTasks24h = tasksToShow.filter(t => {
            if (!t.createdAt) return false;
            return new Date(t.createdAt).getTime() >= Date.now() - 24 * 60 * 60 * 1000;
        });
        
        // Приближающиеся дедлайны (следующие 24 часа)
        const soonTasks = tasksToShow.filter(t => {
            if (!t.deadline || t.status === "Закрыта") return false;
            const delta = new Date(t.deadline).getTime() - Date.now();
            return delta > 0 && delta < 24 * 60 * 60 * 1000;
        });
        
        // Задачи на сегодня по отделу/компании
        const todayTasks = tasksToShow.filter(t => t.deadline === isoToday);

        // ========== НОРМЫ ЗАГРУЗКИ ==========
        const LOAD_NORM = { low: 20, medium: 40 };
        
        function calculateEmployeeLoad(employeeId) {
            const employeeTasks = db.tasks.filter(t => 
                t.assigneeId === employeeId && 
                t.status !== "Закрыта"
            );
            
            let totalHours = 0;
            let overdueHours = 0;
            
            employeeTasks.forEach(task => {
                let hours = task.estimatedHours || 1.0;
                totalHours += hours;
                if (task.deadline < isoToday) {
                    totalHours += hours * 0.5;
                    overdueHours += hours;
                }
            });
            
            return {
                totalHours: Math.round(totalHours * 10) / 10,
                taskCount: employeeTasks.length,
                overdueCount: employeeTasks.filter(t => t.deadline < isoToday).length,
                overdueHours: Math.round(overdueHours * 10) / 10
            };
        }
        
        function getLoadColor(hours) {
            if (hours < LOAD_NORM.low) return "#2e7d32";
            if (hours < LOAD_NORM.medium) return "#ed6c02";
            return "#c62828";
        }

        // ========== ОПРЕДЕЛЯЕМ ЗАГОЛОВОК ==========
        let title = "Дашборд";
        let scopeLabel = "";
        
        if (user.role === 'admin') {
            title = "Дашборд — Администратор";
            scopeLabel = "компании";
        } 
        else if (user.role === 'project_manager') {
            title = "Дашборд — Руководитель проектов";
            scopeLabel = "всех проектов";
        }
        else if (user.role === 'client_manager') {
            title = "Дашборд — Руководитель отдела по работе с клиентами";
            scopeLabel = "отдела";
        }
        else if (user.role.startsWith('head_')) {
            const deptName = user.department || "отдела";
            title = `Дашборд — Начальник ${deptName}`;
            scopeLabel = "отдела";
        }
        else {
            title = "Дашборд — Сотрудник";
            scopeLabel = "личные";
        }

        // ========== РЕНДЕРИНГ ==========
        page.innerHTML = `
            <h1 class="page-title">${title}</h1>
            <div class="dashboard-grid">
                <div class="grid">
                    <section class="card">
                        <h3>📅 ${user.role === 'employee' ? 'Мои задачи на сегодня' : `Задачи ${scopeLabel} на сегодня`}</h3>
                        <ul class="widget-list">
                            ${(user.role === 'employee' ? myTasksToday : todayTasks).slice(0, 5).map(t => {
                                const assignee = db.employees.find(e => e.id === t.assigneeId);
                                return `<li><a href="task-detail.html?id=${t.id}" style="color:#0d47a1">${escapeHtml(t.title)}</a> <span class="muted">${assignee ? `(${escapeHtml(assignee.fio.split(' ')[0])})` : ''} ${t.deadline}</span></li>`;
                            }).join("") || "<li class='muted'>Нет задач на сегодня</li>"}
                        </ul>
                    </section>
                    
                    <section class="card">
                        <h3>⚠️ ${user.role === 'employee' ? 'Мои просроченные задачи' : `Просроченные задачи ${scopeLabel}`}</h3>
                        <div class="metric metric-danger">${user.role === 'employee' ? myOverdueTasks.length : overdueTasks.length}</div>
                        <ul class="widget-list">
                            ${(user.role === 'employee' ? myOverdueTasks : overdueTasks).slice(0, 5).map(t => {
                                const days = Math.ceil((new Date(isoToday) - new Date(t.deadline)) / (1000 * 60 * 60 * 24));
                                return `<li><a href="task-detail.html?id=${t.id}" style="color:#b71c1c">${escapeHtml(t.title)}</a> <span class="muted">(просрочена на ${days} дн.)</span></li>`;
                            }).join("") || "<li class='muted'>Нет просроченных</li>"}
                        </ul>
                    </section>
                    
                    <section class="card">
                        <h3>${user.role === 'employee' ? "🆕 Новые задачи за 24 часа" : "⏰ Приближающиеся дедлайны"}</h3>
                        <div class="metric ${user.role === 'employee' ? "" : "metric-warn"}">${user.role === 'employee' ? newTasks24h.length : soonTasks.length}</div>
                        <ul class="widget-list">
                            ${(user.role === 'employee' ? newTasks24h : soonTasks).slice(0, 5).map(t => {
                                const assignee = db.employees.find(e => e.id === t.assigneeId);
                                return `<li><a href="task-detail.html?id=${t.id}" style="color:#0d47a1">${escapeHtml(t.title)}</a> <span class="muted">(${t.deadline})</span></li>`;
                            }).join("") || "<li class='muted'>Пусто</li>"}
                        </ul>
                    </section>
                </div>
                
                <div class="grid">
                    <section class="card">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <h3 style="margin:0">📊 Загрузка ${scopeLabel || 'сотрудников'}</h3>
                            <button id="loadInfoBtn" style="background:none; border:none; cursor:pointer; font-size:18px; color:#717783;" title="Как считается загрузка?">ⓘ</button>
                        </div>
                        <div id="loadChartContainer" style="position: relative; min-height: 300px;">
                            <canvas id="loadChart" width="500" height="300" style="width:100%; height:auto; max-width:500px;"></canvas>
                        </div>
                    </section>
                    
                    <section class="card">
                        <h3>📅 Календарь</h3>
                        <div id="calendarGrid" class="calendar"></div>
                        ${user.role !== 'employee' ? `<div style="margin-top:10px"><button class="btn btn-primary" id="quickCreate">➕ Быстрое создание задачи</button></div>` : ""}
                    </section>
                </div>
            </div>
        `;

        // ========== ИНФО КНОПКА ==========
        document.getElementById("loadInfoBtn")?.addEventListener("click", () => {
            openModal(`
                <h3>ℹ️ Как считается загрузка?</h3>
                <div style="line-height: 1.6;">
                    <p><strong>Загрузка сотрудника = сумма часов всех активных задач + штраф за просрочку</strong></p>
                    <ul style="margin: 12px 0; padding-left: 20px;">
                        <li>📊 <strong>База:</strong> каждая задача имеет оценку времени в часах</li>
                        <li>⚠️ <strong>Штраф за просрочку:</strong> +50% к часам просроченной задачи</li>
                        <li>✅ <strong>Учитываются только активные задачи</strong> (статус не "Закрыта")</li>
                    </ul>
                    <p><strong>Нормы загрузки:</strong></p>
                    <ul style="margin: 12px 0; padding-left: 20px;">
                        <li>🟢 <strong>Низкая</strong> — менее 20 часов</li>
                        <li>🟠 <strong>Средняя</strong> — 20-40 часов</li>
                        <li>🔴 <strong>Высокая</strong> — более 40 часов</li>
                    </ul>
                </div>
                <div style="display:flex; justify-content:flex-end; margin-top:16px;">
                    <button class="btn btn-secondary" onclick="closeModal()">Понятно</button>
                </div>
            `);
        });

        // ========== ОТРИСОВКА ГРАФИКОВ ==========
        function drawEmployeeLoadChart() {
            const c = document.getElementById("loadChart");
            if (!c) return;
            const ctx = c.getContext("2d");
            c.width = 500;
            c.height = 350;
            ctx.clearRect(0, 0, c.width, c.height);
            
            if (employeesToShow.length === 1 && user.role === 'employee') {
                // Круговая диаграмма для сотрудника
                const loadData = calculateEmployeeLoad(user.id);
                const maxLoad = LOAD_NORM.medium;
                const loadPercent = Math.min(100, (loadData.totalHours / maxLoad) * 100);
                
                const radius = 80;
                const centerX = 150;
                const centerY = 150;
                
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.fillStyle = "#e3edf8";
                ctx.fill();
                
                const angle = (loadPercent / 100) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + angle);
                ctx.closePath();
                ctx.fillStyle = getLoadColor(loadData.totalHours);
                ctx.fill();
                
                ctx.fillStyle = "#1a1c1c";
                ctx.font = "bold 20px Inter, sans-serif";
                ctx.fillText(`${Math.round(loadPercent)}%`, centerX - 25, centerY + 8);
                
                ctx.font = "12px Inter, sans-serif";
                ctx.fillStyle = "#2e7d32";
                ctx.fillText(`📊 ${loadData.totalHours} ч`, 280, 120);
                ctx.fillStyle = "#0d47a1";
                ctx.fillText(`📋 ${loadData.taskCount} задач`, 280, 140);
                if (loadData.overdueCount > 0) {
                    ctx.fillStyle = "#c62828";
                    ctx.fillText(`⚠️ Просрочено: ${loadData.overdueCount}`, 280, 160);
                }
            } else {
                // Столбчатая диаграмма для нескольких сотрудников
                const loadDataList = employeesToShow.map(m => {
                    const load = calculateEmployeeLoad(m.id);
                    return {
                        id: m.id,
                        name: m.fio.split(' ').slice(0, 2).join(' '),
                        fullName: m.fio,
                        totalHours: load.totalHours,
                        taskCount: load.taskCount,
                        overdueCount: load.overdueCount
                    };
                }).sort((a, b) => b.totalHours - a.totalHours);
                
                const maxHours = Math.max(1, ...loadDataList.map(l => l.totalHours));
                const maxHoursForScale = Math.max(LOAD_NORM.medium, Math.ceil(maxHours / 10) * 10);
                
                const barHeight = 28;
                const startY = 30;
                const labelX = 5;
                const barStartX = 160;
                const maxBarWidth = 300;
                
                loadDataList.forEach((item, idx) => {
                    const y = startY + idx * (barHeight + 8);
                    const barWidth = (item.totalHours / maxHoursForScale) * maxBarWidth;
                    
                    ctx.fillStyle = "#1a1c1c";
                    ctx.font = "11px Inter, sans-serif";
                    ctx.fillText(item.name.length > 18 ? item.name.slice(0, 15) + "..." : item.name, labelX, y + 18);
                    
                    ctx.fillStyle = getLoadColor(item.totalHours);
                    ctx.fillRect(barStartX, y, barWidth, barHeight - 4);
                    
                    ctx.fillStyle = "#0d47a1";
                    ctx.font = "bold 10px Inter, sans-serif";
                    ctx.fillText(`${item.totalHours} ч`, barStartX + barWidth + 5, y + 18);
                    
                    if (item.overdueCount > 0) {
                        ctx.fillStyle = "#c62828";
                        ctx.font = "9px Inter, sans-serif";
                        ctx.fillText(`⚠️${item.overdueCount}`, barStartX - 22, y + 18);
                    }
                });
                
                ctx.fillStyle = "#717783";
                ctx.font = "9px Inter, sans-serif";
                for (let i = 0; i <= 4; i++) {
                    const hoursValue = Math.round((maxHoursForScale * i) / 4);
                    const x = barStartX + (hoursValue / maxHoursForScale) * maxBarWidth;
                    ctx.fillText(`${hoursValue} ч`, x - 8, startY + loadDataList.length * (barHeight + 8) + 15);
                }
                
                if (loadDataList.length === 0) {
                    ctx.fillStyle = "#717783";
                    ctx.font = "12px Inter, sans-serif";
                    ctx.fillText("Нет сотрудников для отображения", 50, 150);
                }
            }
        }

        // ========== КАЛЕНДАРЬ ==========
        function renderCalendar() {
            const now = new Date();
            const y = now.getFullYear();
            const m = now.getMonth();
            const firstDayOfMonth = new Date(y, m, 1);
            let firstDayIndex = firstDayOfMonth.getDay();
            firstDayIndex = firstDayIndex === 0 ? 7 : firstDayIndex;
            
            const daysInMonth = new Date(y, m + 1, 0).getDate();
            const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
            
            let cells = weekdays.map(day => `<div class="calendar-cell" style="background:#e3edf8; font-weight:600">${day}</div>`);
            
            for (let i = 1; i < firstDayIndex; i++) {
                cells.push("<div class='calendar-cell'></div>");
            }
            
            for (let d = 1; d <= daysInMonth; d++) {
                const hasTask = tasksToShow.some(t => {
                    const taskDate = t.deadline;
                    if (!taskDate) return false;
                    const [year, month, day] = taskDate.split('-');
                    return parseInt(year) === y && parseInt(month) === m + 1 && parseInt(day) === d;
                });
                cells.push(`<div class="calendar-cell ${d === now.getDate() ? "today" : ""} ${hasTask ? "has-task" : ""}" title="${hasTask ? 'Есть задачи' : ''}">${d}</div>`);
            }
            
            const calendarGrid = document.getElementById("calendarGrid");
            if (calendarGrid) calendarGrid.innerHTML = cells.join("");
        }

        // ========== ХЕЛПЕРЫ ==========
        function escapeHtml(str) {
            if (!str) return "";
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        // ========== ЗАПУСК ==========
        drawEmployeeLoadChart();
        renderCalendar();
        
        document.getElementById("quickCreate")?.addEventListener("click", () => {
            window.location.href = "tasks.html?create=1";
        });
        
        // Обновляем график при изменении размера окна (опционально)
        window.addEventListener('resize', () => {
            setTimeout(drawEmployeeLoadChart, 100);
        });
    })();
})();