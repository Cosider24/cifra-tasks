// js/api.js
const API_URL = "https://cifra-tasks.onrender.com/api/api";
const TOKEN_KEY = "cifra_soft_token";
const USER_KEY = "cifra_soft_user";

let cachedData = null;

function getAuthToken() {
    let token = localStorage.getItem(TOKEN_KEY);
    if (token) return token;
    token = sessionStorage.getItem(TOKEN_KEY);
    return token;
}

function authHeaders() {
    const headers = { "Content-Type": "application/json" };
    const token = getAuthToken();
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
}

async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: {
            ...authHeaders(),
            ...(options.headers || {}),
        },
    });

    if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_KEY);
        window.location.href = "login.html";
        throw new Error("Unauthorized");
    }

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
}

async function loadAllData() {
    const [employees, projects, tasks, notifications] = await Promise.all([
        apiRequest("/employees"),
        apiRequest("/projects"),
        apiRequest("/tasks"),
        apiRequest("/notifications"),
    ]);
    cachedData = {
        employees,
        projects,
        tasks: tasks.map((t) => ({
            ...t,
            comments: t.comments || [],
            history: t.history || [],
            labels: t.labels || []
        })),
        notifications,
        dictionaries: {
            statuses: ["Новая", "В работе", "На проверке", "Закрыта"],
        },
    };
    return cachedData;
}

async function getDb() {
    if (!cachedData) {
        await loadAllData();
    }
    return cachedData;
}

async function saveTask(task) {
    if (task.id && !task.id.startsWith("t")) {
        await apiRequest(`/tasks/${task.id}`, {
            method: "PUT",
            body: JSON.stringify(task),
        });
    } else {
        const newId = task.id || ("t" + Date.now());
        task.id = newId;
        await apiRequest("/tasks", {
            method: "POST",
            body: JSON.stringify(task),
        });
    }
    await loadAllData();
}

async function setDb(newData) {
    console.warn("setDb: частичное обновление через API");
    if (newData.tasks) {
        for (const task of newData.tasks) {
            await saveTask(task);
        }
    }
    if (newData.employees) {
        for (const emp of newData.employees) {
            await apiRequest(`/employees/${emp.id}`, {
                method: "PUT",
                body: JSON.stringify(emp),
            });
        }
    }
    await loadAllData();
}

async function addNotification(text, userIds = []) {
    await apiRequest("/notifications", {
        method: "POST",
        body: JSON.stringify({ text, userIds }),
    });
    await loadAllData();
    
    if (typeof updateNotifBadge === 'function') {
        updateNotifBadge();
    }
}

async function addTaskHistory(task, action, by) {
    if (!task || !task.id) return;
    
    task.history = task.history || [];
    task.history.unshift({
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        action,
        by,
    });
    
    try {
        await apiRequest(`/tasks/${task.id}`, {
            method: "PUT",
            body: JSON.stringify({ history: task.history })
        });
    } catch (err) {
        console.error("Ошибка добавления истории:", err);
    }
}