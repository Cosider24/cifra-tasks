// js/pages/team.js
(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        let db = await getDb();
        const { page } = renderLayout("team");
        if (!page) return;

        let employees = user.role === "admin"
            ? db.employees
            : user.role === "manager"
                ? db.employees.filter((e) => e.department === user.department)
                : db.employees.filter((e) => e.id === user.id);

        async function renderRows() {
            const dep = document.getElementById("teamDepFilter")?.value || "";
            const filtered = employees.filter((e) => !dep || e.department === dep);
            const tbody = document.getElementById("teamRows");
            if (!tbody) return;
            
            tbody.innerHTML = filtered.map((e) => {
                const active = db.tasks.filter((t) => t.assigneeId === e.id && t.status !== "Закрыта");
                return `
                    <tr>
                        <td>${e.fio}</td>
                        <td>${e.position}</td>
                        <td>${e.department}</td>
                        <td>${e.email || `${e.id}@cifra-soft.local`}</td>
                        <td><a href="#" class="openActive" data-id="${e.id}" style="color:#0d47a1">${active.length}</a></td>
                        <td>${user.role === "employee" ? "—" : `<button class="btn btn-secondary assignBtn" data-id="${e.id}">Назначить задачу</button>`}</td>
                    </tr>
                `;
            }).join("");
            
            document.querySelectorAll(".openActive").forEach((a) => {
                a.onclick = (ev) => {
                    ev.preventDefault();
                    const eid = a.dataset.id;
                    const activeTasks = db.tasks.filter((t) => t.assigneeId === eid && t.status !== "Закрыта");
                    openModal(`
                        <h3>Активные задачи</h3>
                        ${activeTasks.map((t) => `<p><a href="task-detail.html?id=${t.id}" style="color:#0d47a1">${t.title}</a></p>`).join("") || "<p class='muted'>Нет активных задач</p>"}
                        <div style="display:flex;justify-content:flex-end"><button class="btn btn-secondary" id="closeActive">Закрыть</button></div>
                    `);
                    document.getElementById("closeActive").onclick = closeModal;
                };
            });
            
            document.querySelectorAll(".assignBtn").forEach((b) => {
                b.onclick = () => location.href = `tasks.html?create=1&assignee=${b.dataset.id}`;
            });
        }

        page.innerHTML = `
            <h1 class="page-title">Команда — ${roleLabel(user.role)}</h1>
            <div class="toolbar">
                <select id="teamDepFilter">
                    <option value="">Все отделы</option>
                    ${[...new Set(employees.map(e=>e.department))].map(d=>`<option>${d}</option>`).join("")}
                </select>
                ${user.role === "admin" ? `<button class="btn btn-primary" id="addEmp">Добавить сотрудника</button>` : ""}
            </div>
            <div class="card" style="overflow-x:auto">
                <table style="width:100%">
                    <thead>
                        <tr><th>ФИО</th><th>Должность</th><th>Отдел</th><th>Email</th><th>Активные задачи</th><th>Действия</th></tr>
                    </thead>
                    <tbody id="teamRows"></tbody>
                </table>
            </div>
        `;
        
        document.getElementById("teamDepFilter").onchange = renderRows;
        
        document.getElementById("addEmp")?.addEventListener("click", () => {
            openModal(`
                <h3>Добавить сотрудника</h3>
                <div class="grid grid-2">
                    <input id="newFio" placeholder="ФИО"/>
                    <input id="newPos" placeholder="Должность"/>
                    <input id="newDep" placeholder="Отдел"/>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
                    <button class="btn btn-secondary" id="empCancel">Отмена</button>
                    <button class="btn btn-primary" id="empSave">Добавить</button>
                </div>
            `);
            
            document.getElementById("empCancel").onclick = closeModal;
            document.getElementById("empSave").onclick = async () => {
                const fio = document.getElementById("newFio").value.trim();
                const pos = document.getElementById("newPos").value.trim();
                const dep = document.getElementById("newDep").value.trim();
                if (!fio || !pos || !dep) {
                    showToast("❌ Заполните все поля", "error");
                    return;
                }
                db.employees.push({ 
                    id: crypto.randomUUID(), 
                    fio, 
                    position: pos, 
                    department: dep, 
                    role: "employee", 
                    email: `${Date.now()}@cifra-soft.local` 
                });
                await setDb(db);
                db = await getDb();
                employees = user.role === "admin"
                    ? db.employees
                    : user.role === "manager"
                        ? db.employees.filter((e) => e.department === user.department)
                        : db.employees.filter((e) => e.id === user.id);
                closeModal();
                await renderRows();
            };
        });
        
        await renderRows();
    })();
})();