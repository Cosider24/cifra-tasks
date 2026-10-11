// js/data.js
const STATUS = ["Новая", "В работе", "На проверке", "Закрыта"];

// Предустановленные варианты времени (часы)
const ESTIMATED_HOURS_OPTIONS = [0.5, 1, 2, 4, 8, 16, 24, 40];

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}