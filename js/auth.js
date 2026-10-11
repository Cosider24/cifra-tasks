// js/auth.js
const AUTH_TOKEN_KEY = "cifra_soft_token";
const AUTH_USER_KEY = "cifra_soft_user";
const AUTH_API_URL = "https://cifra-tasks.onrender.com/api/api";

function getStoredToken() {
    // Сначала проверяем localStorage
    let token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) return token;
    
    // Потом sessionStorage
    token = sessionStorage.getItem(AUTH_TOKEN_KEY);
    return token;
}

function getStoredUser() {
    // Сначала проверяем localStorage
    let userRaw = localStorage.getItem(AUTH_USER_KEY);
    if (userRaw) return JSON.parse(userRaw);
    
    // Потом sessionStorage
    userRaw = sessionStorage.getItem(AUTH_USER_KEY);
    return userRaw ? JSON.parse(userRaw) : null;
}

function getCurrentUser() {
    return getStoredUser();
}

function clearSession() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
}

function logout() {
    clearSession();
    window.location.href = "login.html";
}

async function loginWithEmailPassword(email, password, rememberMe = false) {
    const res = await fetch(`${AUTH_API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
        throw new Error(data.message || "Ошибка входа");
    }
    
    // Сохраняем последний email
    localStorage.setItem("last_user_email", email.trim().toLowerCase());
    localStorage.setItem("last_remember_me", rememberMe);
    
    // Сохраняем токен в нужное хранилище
    if (rememberMe) {
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        sessionStorage.removeItem(AUTH_USER_KEY);
    } else {
        sessionStorage.setItem(AUTH_TOKEN_KEY, data.token);
        sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
    }
    
    return data;
}

async function requireAuth() {
    const token = getStoredToken();
    if (!token) {
        window.location.href = "login.html";
        return null;
    }
    
    try {
        const res = await fetch(`${AUTH_API_URL}/auth/me`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        
        if (!res.ok) {
            // Только при 401 - разлогиниваем
            if (res.status === 401) {
                clearSession();
                window.location.href = "login.html";
                return null;
            }
            throw new Error();
        }
        
        const data = await res.json();
        
        // Обновляем данные пользователя в том же хранилище, откуда взяли
        const tokenFromLocal = localStorage.getItem(AUTH_TOKEN_KEY);
        if (tokenFromLocal === token) {
            localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
        } else {
            sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
        }
        
        return data.user;
    } catch(e) {
        // Ошибка сети - не разлогиниваем, просто возвращаем текущего пользователя из хранилища
        const storedUser = getStoredUser();
        if (storedUser) return storedUser;
        
        clearSession();
        window.location.href = "login.html";
        return null;
    }
}

// Функция для проверки активной сессии (без редиректа)
function hasActiveSession() {
    const token = getStoredToken();
    const user = getStoredUser();
    return !!(token && user);
}