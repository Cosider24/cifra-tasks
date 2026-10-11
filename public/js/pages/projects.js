// js/pages/projects.js
(() => {
    (async () => {
        const user = await requireAuth();
        if (!user) return;

        let db = await getDb();
        const { page } = renderLayout("projects");
        if (!page) return;

        // Кто может создавать проекты
        const canCreateProject = ['admin', 'project_manager', 'client_manager', 
            'head_data', 'head_dev', 'head_qa'].includes(user.role);

        // Кто может видеть архивированные проекты
        const canViewArchived = user.role === 'admin' || user.role === 'project_manager';

        let showArchived = false;

        async function renderProjects() {
            // Получаем проекты в зависимости от режима
            let projects;
            if (showArchived) {
                const archivedRes = await fetch("https://cifra-tasks.onrender.com/api/projects/archived", {
                    headers: { "Authorization": `Bearer ${getStoredToken()}` }
                });
                if (archivedRes.ok) {
                    projects = await archivedRes.json();
                } else {
                    projects = [];
                }
            } else {
                projects = db.projects.filter(p => p.status !== 'archived');
            }
            
            const cardsContainer = document.getElementById("projectCards");
            if (!cardsContainer) return;
            
            if (projects.length === 0) {
                cardsContainer.innerHTML = `
                    <div class="empty-projects">
                        <p class="muted">${showArchived ? 'Нет архивных проектов' : 'Нет активных проектов'}</p>
                        ${canCreateProject && !showArchived ? '<button class="btn btn-primary" id="createFirstProjectBtn">Создать первый проект</button>' : ''}
                    </div>
                `;
                if (canCreateProject && !showArchived) {
                    document.getElementById("createFirstProjectBtn")?.addEventListener("click", () => openCreateProjectModal());
                }
                return;
            }
            
            cardsContainer.innerHTML = projects.map(p => {
                const creator = db.employees.find(e => e.id === p.createdBy);
                return `
                    <article class="card project-card">
                        <h3>${escapeHtml(p.name)}</h3>
                        <p class="muted">${escapeHtml(p.description || 'Нет описания')}</p>
                        <div class="project-meta">
                            <span class="project-meta-item">Дедлайн: ${p.deadline || '—'}</span>
                            <span class="project-meta-item">Создал: ${creator?.fio || '—'}</span>
                        </div>
                        <div class="project-actions">
                            <a class="btn btn-primary" href="project-detail.html?id=${p.id}">Открыть канбан</a>
                            ${!showArchived && (user.role === 'admin' || user.id === p.createdBy || user.role === 'project_manager') ? 
                                `<button class="btn btn-secondary edit-project-btn" data-id="${p.id}">Редактировать</button>
                                 <button class="btn btn-warning archive-project-btn" data-id="${p.id}">Архив</button>` : ''}
                            ${showArchived && canViewArchived ? 
                                `<button class="btn btn-secondary restore-project-btn" data-id="${p.id}">Восстановить</button>` : ''}
                        </div>
                    </article>
                `;
            }).join("");
            
            // Обработчики кнопок редактирования
            document.querySelectorAll(".edit-project-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    const projectId = btn.dataset.id;
                    const project = db.projects.find(p => p.id === projectId);
                    if (project) openEditProjectModal(project);
                });
            });
            
            // Обработчики кнопок архивации (с красивым подтверждением)
            document.querySelectorAll(".archive-project-btn").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const projectId = btn.dataset.id;
                    const project = db.projects.find(p => p.id === projectId);
                    
                    const confirmed = await confirmAction({
                        title: "Архивация проекта",
                        message: `Вы уверены, что хотите архивировать проект "${project?.name}"? Он переместится в архив и перестанет отображаться в активных проектах.`,
                        confirmText: "Архивировать",
                        cancelText: "Отмена",
                        confirmStyle: "warning"
                    });
                    
                    if (confirmed) {
                        await apiRequest(`/projects/${projectId}`, { method: "DELETE" });
                        await refreshData();
                        renderProjects();
                        showToast("Проект архивирован", "success");
                    }
                });
            });
            
            // Обработчики кнопок восстановления (с красивым подтверждением)
            document.querySelectorAll(".restore-project-btn").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const projectId = btn.dataset.id;
                    const project = db.projects.find(p => p.id === projectId);
                    
                    const confirmed = await confirmAction({
                        title: "Восстановление проекта",
                        message: `Восстановить проект "${project?.name}" из архива? Он снова появится в списке активных проектов.`,
                        confirmText: "Восстановить",
                        cancelText: "Отмена",
                        confirmStyle: "primary"
                    });
                    
                    if (confirmed) {
                        await apiRequest(`/projects/${projectId}`, {
                            method: "PUT",
                            body: JSON.stringify({ status: "active" })
                        });
                        await refreshData();
                        renderProjects();
                        showToast("Проект восстановлен", "success");
                    }
                });
            });
        }

        function openCreateProjectModal() {
            openModal(`
                <h3>Создание нового проекта</h3>
                <div id="modalError" class="login-error hidden"></div>
                <div class="modal-form">
                    <label>Название проекта *</label>
                    <input id="projectName" type="text" placeholder="Введите название проекта" />
                    
                    <label>Описание</label>
                    <textarea id="projectDesc" rows="3" placeholder="Краткое описание проекта"></textarea>
                    
                    <label>Дедлайн</label>
                    <input id="projectDeadline" type="date" value="${new Date().toISOString().slice(0, 10)}" />
                </div>
                <div class="modal-buttons">
                    <button class="btn btn-secondary" id="cancelCreateProject">Отмена</button>
                    <button class="btn btn-primary" id="saveCreateProject">Создать</button>
                </div>
            `);
            
            document.getElementById("cancelCreateProject").onclick = closeModal;
            document.getElementById("saveCreateProject").onclick = async () => {
                const name = document.getElementById("projectName").value.trim();
                const description = document.getElementById("projectDesc").value;
                const deadline = document.getElementById("projectDeadline").value;
                
                if (!name) {
                    showModalError("Введите название проекта");
                    return;
                }
                
                try {
                    await apiRequest("/projects", {
                        method: "POST",
                        body: JSON.stringify({ name, description, deadline })
                    });
                    
                    await refreshData();
                    closeModal();
                    renderProjects();
                    showToast(`Проект "${name}" создан`, "success");
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

        function openEditProjectModal(project) {
            openModal(`
                <h3>Редактирование проекта</h3>
                <div class="modal-form">
                    <label>Название проекта</label>
                    <input id="editProjectName" type="text" value="${escapeHtml(project.name)}" />
                    
                    <label>Описание</label>
                    <textarea id="editProjectDesc" rows="3">${escapeHtml(project.description || '')}</textarea>
                    
                    <label>Дедлайн</label>
                    <input id="editProjectDeadline" type="date" value="${project.deadline || ''}" />
                </div>
                <div class="modal-buttons">
                    <button class="btn btn-secondary" id="cancelEditProject">Отмена</button>
                    <button class="btn btn-primary" id="saveEditProject">Сохранить</button>
                </div>
            `);
            
            document.getElementById("cancelEditProject").onclick = closeModal;
            document.getElementById("saveEditProject").onclick = async () => {
                const name = document.getElementById("editProjectName").value.trim();
                const description = document.getElementById("editProjectDesc").value;
                const deadline = document.getElementById("editProjectDeadline").value;
                
                if (!name) {
                    showToast("Название проекта обязательно", "error");
                    return;
                }
                
                try {
                    await apiRequest(`/projects/${project.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ name, description, deadline })
                    });
                    
                    await refreshData();
                    closeModal();
                    renderProjects();
                    showToast("Проект обновлен", "success");
                } catch (err) {
                    showToast(`Ошибка: ${err.message}`, "error");
                }
            };
        }

        async function refreshData() {
            if (typeof loadAllData === "function") await loadAllData();
            db = await getDb();
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
            <h1 class="page-title">Проекты — ${roleLabel(user.role)}</h1>
            <div class="card">
                <div class="toolbar">
                    ${canCreateProject ? `<button class="btn btn-primary" id="createProjectBtn">Создать проект</button>` : ''}
                    ${canViewArchived ? `
                        <button class="btn btn-secondary" id="toggleArchivedBtn">
                            ${showArchived ? 'Показать активные' : 'Показать архив'}
                        </button>
                    ` : ''}
                </div>
                <div id="projectCards" class="grid grid-3" style="margin-top: 16px;"></div>
            </div>
        `;

        document.getElementById("createProjectBtn")?.addEventListener("click", openCreateProjectModal);
        document.getElementById("toggleArchivedBtn")?.addEventListener("click", () => {
            showArchived = !showArchived;
            const btn = document.getElementById("toggleArchivedBtn");
            if (btn) {
                btn.textContent = showArchived ? 'Показать активные' : 'Показать архив';
            }
            renderProjects();
        });

        await renderProjects();
    })();
})();