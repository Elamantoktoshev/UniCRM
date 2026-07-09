import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Plus, Users, Target, TrendingUp, Percent, X, Loader2,
  ArrowLeft, Archive, ArchiveRestore, Pencil, Wallet, UserPlus, AlertTriangle, Check,
  LogOut, History, Shield, Trash2, Search, Paperclip, Inbox, ChevronRight,
} from "lucide-react";
import { supabase } from "./supabaseClient.js";

/* ---------------------------------------------------------
   Данные / константы
--------------------------------------------------------- */

const LEVELS = [
  "Beginner", "Elementary", "Pre-Intermediate", "Intermediate", "Upper-Intermediate",
  "IELTS Prep", "Uni Academy", "Консалтинг",
];
const DEFAULT_MANAGERS = ["Диана", "Венера", "Алия", "Эламан", "Анжелика"];
const PAYMENT_METHODS = ["Наличные", "МБанк", "Бакай Банк"];
const DEFAULT_SOURCES = ["Инстаграм", "Рекомендация", "Друг привёл", "Другое"];
const DEFAULT_TEACHERS = [
  "Aizat", "Asel", "Baiysh", "Green", "Ilyaz", "Madina",
  "Mr Baiysh", "Mr Green", "Mr Madina", "Ms Madina", "Ms Nurzhan",
  "Nargiza", "Nurzhan", "Yan", "mr,Yan",
];
// The 5 top-level P&L groups are a fixed, non-editable structure — only the
// categories living inside each one can be added to by the super-admin.
const EXPENSE_GROUPS = [
  { key: "fixed", label: "Постоянные расходы" },
  { key: "payroll", label: "Расходы на персонал" },
  { key: "marketing", label: "Маркетинг и продажи" },
  { key: "admin", label: "Административные расходы" },
  { key: "cogs", label: "Себестоимость услуг (COGS)" },
];
const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Аренда", group: "fixed" },
  { name: "Коммунальные услуги", group: "fixed" },
  { name: "Подписки", group: "fixed" },
  { name: "Амортизация", group: "fixed" },
  { name: "Зарплата", group: "payroll" },
  { name: "Маркетинг и реклама", group: "marketing" },
  { name: "Кэшбек", group: "marketing" },
  { name: "Офисные расходы", group: "admin" },
  { name: "Прочие расходы", group: "admin" },
  { name: "Образование", group: "cogs" },
  { name: "Активити", group: "cogs" },
];
const GROUP_MAX_SIZE = 15;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmt = (n) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n || 0) + " KGS";
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU");
};
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const totalPaid = (student) => (student.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
const remaining = (student) => (student.contractAmount || 0) - totalPaid(student);

/* ---------------------------------------------------------
   Finance: month helpers, revenue recognition, expenses
--------------------------------------------------------- */

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const currentMonthKey = () => new Date().toISOString().slice(0, 7);
const monthKeyOf = (dateStr) => (dateStr ? dateStr.slice(0, 7) : "");
const monthToIndex = (monthStr) => {
  const [y, m] = monthStr.split("-").map(Number);
  return y * 12 + (m - 1);
};
const indexToMonth = (idx) => {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
};
const shiftMonth = (monthStr, delta) => indexToMonth(monthToIndex(monthStr) + delta);
const formatMonthLabel = (monthStr) => {
  const [y, m] = monthStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] || monthStr} ${y}`;
};
const lastNMonths = (n, endMonth = currentMonthKey()) => {
  const endIdx = monthToIndex(endMonth);
  return Array.from({ length: n }, (_, i) => indexToMonth(endIdx - (n - 1 - i)));
};

function paymentCoversMonth(payment, monthStr) {
  const start = payment.recognitionStartMonth || monthKeyOf(payment.date);
  if (!start) return false;
  const duration = Math.max(1, payment.courseDurationMonths || 1);
  const diff = monthToIndex(monthStr) - monthToIndex(start);
  return diff >= 0 && diff < duration;
}

function getRecognizedRevenueForMonth(students, revenueAdjustments, monthStr) {
  let total = 0;
  for (const student of students) {
    for (const p of student.payments || []) {
      if (paymentCoversMonth(p, monthStr)) {
        total += (p.amount || 0) / Math.max(1, p.courseDurationMonths || 1);
      }
    }
  }
  for (const adj of revenueAdjustments) {
    if (adj.month === monthStr) total -= adj.amount || 0;
  }
  return total;
}

function getCashReceivedForMonth(students, monthStr) {
  let total = 0;
  for (const student of students) {
    for (const p of student.payments || []) {
      if (monthKeyOf(p.date) === monthStr) total += p.amount || 0;
    }
  }
  return total;
}

// Effective expenses for a given month: recurring templates (optionally
// overridden just for this month) plus any genuinely one-off expenses
// logged directly against this month.
function getEffectiveExpensesForMonth(expenses, monthStr) {
  const templates = expenses.filter((e) => e.isRecurring && !e.overridesExpenseId && e.month <= monthStr);
  const overridesForMonth = expenses.filter((e) => e.overridesExpenseId && e.month === monthStr);
  const oneOff = expenses.filter((e) => !e.isRecurring && !e.overridesExpenseId && e.month === monthStr);

  const templateRows = templates.map((template) => {
    const override = overridesForMonth.find((o) => o.overridesExpenseId === template.id);
    if (override) {
      return { ...template, amount: override.amount, note: override.note, _kind: "override", _overrideId: override.id };
    }
    return { ...template, _kind: "template" };
  });

  return [...templateRows, ...oneOff.map((e) => ({ ...e, _kind: "one-off" }))];
}

// null when there's nothing meaningful to compare against (previous period was zero/empty).
function pctChange(current, previous) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/* ---------------------------------------------------------
   Toasts — a plain module-level pub/sub so any component can call
   showToast(...) directly without prop-drilling a callback through the
   whole tree. useToasts() is mounted once, at the top of the app.
--------------------------------------------------------- */

const toastListeners = new Set();
function showToast(message, type = "success") {
  const entry = { id: uid(), message, type };
  toastListeners.forEach((fn) => fn(entry));
}
function useToasts() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const handler = (entry) => {
      setToasts((prev) => [...prev, entry]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== entry.id));
      }, 3500);
    };
    toastListeners.add(handler);
    return () => toastListeners.delete(handler);
  }, []);
  return toasts;
}
function ToastStack({ toasts }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span className="toast-icon">{t.type === "error" ? <AlertTriangle size={14} /> : <Check size={14} />}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, sub, actionLabel, onAction }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon || <Inbox size={22} />}</div>
      <div className="empty-state-title">{title}</div>
      {sub && <div className="empty-state-sub">{sub}</div>}
      {actionLabel && onAction && (
        <button className="btn-primary" style={{ margin: "0 auto" }} onClick={onAction}>
          <Plus size={14} /> {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Стили (ledger / gradebook эстетика)
--------------------------------------------------------- */

const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

    .crm-root {
      --bg: #FAFAF9;
      --surface: #FFFFFF;
      --surface-alt: #F5F1EC;
      --ink: #201A16;
      --ink-soft: #6B6058;
      --line: #E8E1D8;

      --primary: #E8590C;
      --primary-hover: #C94A08;
      --primary-soft: #FDEAE0;

      --success: #2F7D5F;
      --success-soft: #E4F0EA;
      --warning: #C99A2E;
      --warning-soft: #FAF1DC;
      --danger: #B23B2E;
      --danger-soft: #FBE8E4;

      background: var(--bg);
      color: var(--ink);
      font-family: 'Inter', sans-serif;
      min-height: 100%;
      width: 100%;
      display: flex;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid var(--line);
      height: 720px;
      position: relative;
    }
    .crm-root * { box-sizing: border-box; }
    .crm-mono { font-family: 'IBM Plex Mono', monospace; }
    .crm-slab { font-family: 'Manrope', sans-serif; font-weight: 700; }

    a { color: var(--primary); }

    /* Sidebar - binder tabs */
    .crm-sidebar {
      width: 216px;
      flex-shrink: 0;
      background: var(--primary);
      color: #FFFFFF;
      padding: 22px 0 16px;
      display: flex;
      flex-direction: column;
    }
    .crm-brand {
      padding: 0 20px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.3);
      margin-bottom: 14px;
    }
    .crm-brand-title { font-size: 18px; font-weight: 800; letter-spacing: 0.1px; font-family: 'Manrope', sans-serif; color: #FFFFFF; }
    .crm-brand-sub { font-size: 11px; opacity: 0.9; margin-top: 3px; letter-spacing: 0.4px; text-transform: uppercase; color: #FFFFFF; }

    /* Text sits directly on the orange --primary background, so tabs stay
       fully opaque white (measured ~3.6:1 contrast — meets WCAG AA for
       large/UI text, not body text) rather than dimmed like the old dark
       sidebar; the active tab gets a solid white pill for a much stronger,
       unambiguous contrast instead of relying on opacity. */
    .crm-tab {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 20px;
      font-size: 13.5px; font-weight: 600;
      cursor: pointer; border: none; background: transparent; color: #FFFFFF;
      text-align: left; width: 100%;
      border-left: 3px solid transparent;
      transition: all .15s ease;
      min-height: 44px;
    }
    .crm-tab:hover { background: rgba(255,255,255,0.18); }
    .crm-tab.active {
      background: #FFFFFF; color: var(--primary-hover);
      border-radius: 0 8px 8px 0; border-left: 3px solid var(--ink);
      font-weight: 700;
    }

    .crm-main { flex: 1; min-width: 0; background: var(--surface); display: flex; flex-direction: column; max-height: 720px; }
    .crm-topbar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 16px 24px; border-bottom: 1px solid var(--line); flex-wrap: wrap;
    }
    .crm-h1 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; font-family: 'Manrope', sans-serif; }
    .crm-content { padding: 20px 24px; overflow-y: auto; flex: 1; -webkit-overflow-scrolling: touch; }

    /* KPI cards */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .kpi-card { background: var(--surface-alt); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; transition: box-shadow .15s ease; }
    .kpi-label { font-size: 11px; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px; display:flex; align-items:center; gap:6px; }
    .kpi-value { font-size: 21px; font-weight: 700; font-family: 'IBM Plex Mono', monospace; }

    .board { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 10px; }

    .icon-btn {
      border: 1px solid var(--line); background: var(--surface); border-radius: 7px;
      padding: 5px 8px; cursor: pointer; display: flex; align-items: center; gap: 4px;
      font-size: 10.5px; color: var(--ink); transition: all .15s ease; min-height: 30px;
    }
    .icon-btn:hover { background: var(--primary-soft); border-color: var(--primary); color: var(--primary-hover); }
    .icon-btn:active { transform: scale(0.96); }
    .icon-btn.danger { color: var(--danger); border-color: var(--danger-soft); }
    .icon-btn.danger:hover { background: var(--danger); border-color: var(--danger); color: #fff; }

    /* Form */
    .form-card { background: var(--surface-alt); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 20px; }
    .form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: end; }
    .field label { font-size: 11px; color: var(--ink-soft); display: block; margin-bottom: 5px; font-weight: 500; }
    .field input, .field select {
      width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px;
      font-size: 13px; background: var(--surface); font-family: inherit; color: var(--ink);
      transition: border-color .15s ease, box-shadow .15s ease; min-height: 38px;
    }
    .field input:focus, .field select:focus, textarea.notes-field:focus {
      outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft);
    }
    textarea.notes-field {
      width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px;
      font-size: 13px; background: var(--surface); font-family: inherit; resize: vertical;
      min-height: 64px; color: var(--ink);
    }
    .group-title-row { display: flex; align-items: center; gap: 8px; }
    .rename-form { display: flex; align-items: center; gap: 6px; }
    .rename-form input {
      font-size: 19px; font-weight: 700; font-family: 'Manrope', sans-serif;
      padding: 3px 8px; border: 1px solid var(--primary); border-radius: 8px; background: var(--surface);
    }
    .teacher-select {
      border: 1px solid var(--line); background: var(--surface); border-radius: 7px;
      padding: 4px 8px; font-size: 11.5px; color: var(--ink-soft); font-family: inherit; min-height: 30px;
    }
    .btn-primary {
      background: var(--primary); color: white; border: none; border-radius: 9px;
      padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
      transition: all .15s ease; min-height: 40px;
    }
    .btn-primary:hover { background: var(--primary-hover); box-shadow: 0 4px 14px rgba(232,89,12,0.28); }
    .btn-primary:active { transform: scale(0.97); }
    .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; transform: none; }
    .btn-secondary {
      background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 9px;
      padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
      transition: all .15s ease; min-height: 40px;
    }
    .btn-secondary:hover { border-color: var(--primary); color: var(--primary-hover); background: var(--primary-soft); }
    .btn-secondary:active { transform: scale(0.97); }
    .btn-danger {
      background: var(--surface); color: var(--danger); border: 1px solid var(--danger);
      border-radius: 9px; padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
      transition: all .15s ease; min-height: 40px;
    }
    .btn-danger:hover { background: var(--danger); color: #fff; box-shadow: 0 4px 14px rgba(178,59,46,0.25); }
    .btn-danger:active { transform: scale(0.97); }

    /* Table */
    .ledger-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .ledger-table th {
      text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.3px;
      color: var(--ink-soft); padding: 8px 10px; border-bottom: 2px solid var(--ink);
    }
    .ledger-table td { padding: 10px; border-bottom: 1px solid var(--line); }
    .ledger-table tr:hover td { background: var(--surface-alt); }
    .badge { padding: 3px 9px; border-radius: 20px; font-size: 10.5px; font-weight: 600; }
    .badge.paid { background: var(--success-soft); color: var(--success); }
    .badge.lost { background: var(--danger-soft); color: var(--danger); }
    .badge.other { background: var(--warning-soft); color: var(--warning); }
    .badge.full { background: var(--danger-soft); color: var(--danger); }

    .section-title { font-size: 12.5px; font-weight: 700; margin: 24px 0 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--ink-soft); }
    .chart-card { background: var(--surface-alt); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

    .manager-chip {
      display: inline-flex; align-items: center; gap: 6px; background: var(--surface);
      border: 1px solid var(--line); border-radius: 20px; padding: 6px 12px 6px 12px; font-size: 12px; margin: 3px 6px 3px 0;
    }

    .empty-hint { color: var(--ink-soft); font-size: 12px; text-align: center; padding: 20px 0; }
    .loading-wrap { display:flex; align-items:center; justify-content:center; height: 400px; color: var(--ink-soft); gap: 8px; font-size: 13px; }

    /* Empty states */
    .empty-state { text-align: center; padding: 40px 20px; color: var(--ink-soft); }
    .empty-state-icon {
      width: 52px; height: 52px; border-radius: 50%; background: var(--primary-soft); color: var(--primary);
      display: flex; align-items: center; justify-content: center; margin: 0 auto 14px;
    }
    .empty-state-title { font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 4px; }
    .empty-state-sub { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 16px; }

    /* Filter chips */
    .chip-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .chip {
      border: 1px solid var(--line); background: var(--surface); border-radius: 20px;
      padding: 8px 15px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--ink-soft);
      transition: all .15s ease; min-height: 38px;
    }
    .chip:active { transform: scale(0.97); }
    .chip.active { background: var(--primary); color: white; border-color: var(--primary); }

    /* Group cards */
    .group-card {
      background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
      padding: 14px 16px; cursor: pointer; transition: all .15s ease;
    }
    .group-card:hover { border-color: var(--primary); box-shadow: 0 4px 14px rgba(32,26,22,0.07); transform: translateY(-1px); }
    .group-card.archived { opacity: 0.6; }
    .group-card-name { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
    .group-card-meta { font-size: 11.5px; color: var(--ink-soft); margin-bottom: 10px; }
    .group-card-count { font-size: 13px; font-weight: 600; font-family: 'IBM Plex Mono', monospace; }
    .group-card-count.full { color: var(--danger); }
    .group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-bottom: 24px; }

    /* Level accordion (Groups by level) */
    .level-section { margin-bottom: 10px; border: 1px solid transparent; }
    .level-header {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      cursor: pointer; background: none; border: none; width: 100%; padding: 4px 0;
      font: inherit; text-align: left;
    }
    .level-header-left { display: flex; align-items: center; gap: 8px; }
    .level-chevron { transition: transform .15s ease; color: var(--ink-soft); flex-shrink: 0; }
    .level-chevron.open { transform: rotate(90deg); }
    .level-count { font-size: 11px; color: var(--ink-soft); font-family: 'IBM Plex Mono', monospace; }
    .level-body { overflow: hidden; max-height: 3000px; transition: max-height .2s ease; }
    .level-body.collapsed { max-height: 0; }
    /* Desktop keeps the old always-expanded layout: the accordion only
       actually collapses on mobile (see the max-width query below). */
    @media (min-width: 768px) {
      .level-chevron { display: none; }
      .level-body, .level-body.collapsed { max-height: none !important; overflow: visible; }
      .level-header { cursor: default; }
    }

    /* Student cards */
    .student-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
    .student-card {
      background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
      padding: 12px 14px; cursor: pointer; transition: all .15s ease;
    }
    .student-card:hover { border-color: var(--primary); box-shadow: 0 4px 14px rgba(32,26,22,0.06); }
    .student-card.archived { opacity: 0.55; }
    .student-name { font-weight: 600; font-size: 13px; margin-bottom: 3px; }
    .student-meta { font-size: 11px; color: var(--ink-soft); margin-bottom: 8px; }
    .progress-track { background: var(--primary-soft); border-radius: 20px; height: 7px; overflow: hidden; margin-bottom: 5px; }
    .progress-fill { height: 100%; border-radius: 20px; background: var(--success); }
    .progress-fill.over { background: var(--danger); }
    .progress-fill.zero { background: var(--warning); }
    .student-amounts { font-size: 11px; display: flex; justify-content: space-between; font-family: 'IBM Plex Mono', monospace; }

    /* Modal */
    .modal-overlay {
      position: absolute; inset: 0; background: rgba(32,26,22,0.45);
      display: flex; align-items: center; justify-content: center; z-index: 150;
      padding: 20px;
    }
    .modal-panel {
      background: var(--surface); border-radius: 16px; border: 1px solid var(--line);
      width: 100%; max-width: 720px; max-height: 100%; overflow-y: auto;
      padding: 28px 32px; box-shadow: 0 20px 60px rgba(32,26,22,0.2);
    }
    .modal-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
    .modal-title { font-size: 18px; font-weight: 700; font-family: 'Manrope', sans-serif; }
    .modal-close {
      border: none; background: var(--surface-alt); cursor: pointer; color: var(--ink-soft);
      padding: 8px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
      min-width: 34px; min-height: 34px; transition: all .15s ease;
    }
    .modal-close:hover { color: var(--ink); background: var(--line); }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
    .payment-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; gap: 10px; }
    .payment-row:last-child { border-bottom: none; }
    .warn-text { color: var(--danger); font-size: 11.5px; display: flex; align-items: center; gap: 5px; margin-top: 6px; }

    /* Global search */
    .search-wrap { position: relative; }
    .search-panel {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
      background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(32,26,22,0.16); padding: 10px;
      width: 320px; max-width: min(320px, calc(100vw - 32px));
    }
    .search-input {
      width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px;
      font-size: 13px; background: var(--surface-alt); font-family: inherit; min-height: 38px;
    }
    .search-results { margin-top: 8px; max-height: 260px; overflow-y: auto; }
    .search-result-row { padding: 9px; border-radius: 8px; cursor: pointer; font-size: 12.5px; }
    .search-result-row:hover { background: var(--primary-soft); }
    .search-result-name { font-weight: 600; margin-bottom: 2px; }
    .search-result-meta { font-size: 11px; color: var(--ink-soft); }

    /* Login screen */
    .login-root { align-items: center; justify-content: center; padding: 40px; }
    .login-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 30px 32px; width: 100%; max-width: 420px; box-shadow: 0 20px 60px rgba(32,26,22,0.08); }
    .login-title { font-size: 21px; font-weight: 800; margin-bottom: 4px; font-family: 'Manrope', sans-serif; }
    .login-sub { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 22px; }

    /* Sidebar session info */
    .session-info { padding: 0 20px; font-size: 11px; opacity: 0.95; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; color: #FFFFFF; }
    .logout-btn {
      display: flex; align-items: center; gap: 8px; width: calc(100% - 24px); margin: 0 12px 10px;
      background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.35); border-radius: 8px;
      color: #FFFFFF; font-size: 12px; padding: 10px; cursor: pointer; transition: all .15s ease; min-height: 40px;
    }
    .logout-btn:hover { background: rgba(32,26,22,0.35); border-color: var(--ink); }
    .logout-btn:active { transform: scale(0.98); }

    /* Toasts */
    .toast-stack {
      position: fixed; z-index: 200; right: 20px; bottom: 20px;
      display: flex; flex-direction: column; gap: 8px; max-width: min(340px, calc(100vw - 32px));
    }
    .toast {
      display: flex; align-items: flex-start; gap: 9px;
      background: var(--ink); color: #fff; border-radius: 10px; padding: 12px 14px;
      font-size: 12.5px; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      animation: toast-in .18s ease;
    }
    .toast.success { background: var(--success); }
    .toast.error { background: var(--danger); }
    .toast-icon { flex-shrink: 0; margin-top: 1px; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    /* Bottom nav (mobile) */
    .bottom-nav { display: none; }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* ---------------------------------------------------
       Mobile ( < 768px )
    --------------------------------------------------- */
    @media (max-width: 767px) {
      .app-shell { padding: 0 !important; }
      .crm-root {
        height: 100dvh !important; width: 100%; border-radius: 0; border: none;
        flex-direction: column; overflow: hidden;
      }
      .crm-sidebar { display: none; }
      .crm-main { max-height: none; height: 100%; }
      .crm-content { padding: 14px 14px calc(80px + env(safe-area-inset-bottom)); font-size: 14px; }
      .crm-topbar { padding: 12px 14px; }
      .crm-h1 { font-size: 16px; }

      .bottom-nav {
        display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 100;
        background: var(--surface); border-top: 1px solid var(--line);
        padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
        box-shadow: 0 -4px 20px rgba(32,26,22,0.06);
      }
      .bottom-nav-item {
        flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
        padding: 6px 2px; border: none; background: none; color: var(--ink-soft);
        font-size: 10.5px; font-weight: 600; min-height: 48px; border-radius: 10px;
      }
      .bottom-nav-item.active { color: var(--primary); }
      .bottom-nav-item:active { transform: scale(0.95); }

      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .two-col { grid-template-columns: 1fr; }
      .form-grid { grid-template-columns: 1fr; }
      .field-row { grid-template-columns: 1fr; }
      .board { grid-template-columns: 1fr; }

      .btn-primary, .btn-secondary, .btn-danger { min-height: 44px; font-size: 13.5px; }
      .chip { min-height: 44px; }

      .group-grid, .student-grid { grid-template-columns: 1fr; }

      .level-chevron { display: inline-flex; }
      .level-body.collapsed { max-height: 0; }

      /* Modal becomes a full-screen sheet */
      .modal-overlay { padding: 0; align-items: flex-end; }
      .modal-panel {
        max-width: none; width: 100%; height: 100dvh; max-height: none;
        border-radius: 0; padding: 16px 16px calc(24px + env(safe-area-inset-bottom));
      }

      .search-panel { position: fixed; left: 12px; right: 12px; top: 64px; width: auto; max-width: none; }

      /* Tables become stacked cards: header hidden, each row is a card with
         inline field labels pulled from data-label. */
      .ledger-table thead { display: none; }
      .ledger-table, .ledger-table tbody, .ledger-table tr, .ledger-table td { display: block; width: 100%; }
      .ledger-table tr {
        background: var(--surface-alt); border: 1px solid var(--line); border-radius: 12px;
        padding: 10px 12px; margin-bottom: 10px;
      }
      .ledger-table td {
        display: flex; justify-content: space-between; align-items: center; gap: 10px;
        border-bottom: 1px solid var(--line); padding: 8px 0; text-align: right; font-size: 13px;
      }
      .ledger-table td:last-child { border-bottom: none; }
      .ledger-table td[data-label]::before {
        content: attr(data-label); color: var(--ink-soft); font-size: 11px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.3px; text-align: left; flex-shrink: 0;
      }
      .ledger-table td:not([data-label])::before { content: none; }
      .ledger-table td.empty-hint { text-align: center; display: block; }
      .ledger-table td.empty-hint::before { content: none; }
    }
  `}</style>
);

/* ---------------------------------------------------------
   Supabase data layer

   Groups/students/payments/managers/teachers/activity log all live in
   Supabase (shared across everyone). "Who am I" now comes from real
   Supabase Auth (supabase.auth.signInWithPassword) plus a `profiles` row
   keyed by auth.users.id that carries the app-level role/manager_name —
   Supabase's client manages the session token itself, so the app doesn't
   persist anything auth-related on its own.
--------------------------------------------------------- */

const ACTIVITY_LOG_LIMIT = 500;

const rowToGroup = (r) => ({
  id: r.id, level: r.level, name: r.name, teacher: r.teacher, time: r.time,
  maxSize: r.max_size, status: r.status, notes: r.notes || "",
});
const rowToStudent = (r, payments) => ({
  id: r.id, name: r.name, phone: r.phone || "", level: r.level, groupId: r.group_id,
  manager: r.manager || "", contractAmount: Number(r.contract_amount) || 0,
  payments, status: r.status, notes: r.notes || "", createdAt: r.created_at,
  parentPhone: r.parent_phone || "", address: r.address || "",
  source: r.source || "", referrerName: r.referrer_name || "",
});
const rowToPayment = (r) => ({
  id: r.id, amount: Number(r.amount) || 0, date: r.date, note: r.note || "",
  courseDurationMonths: r.course_duration_months || 1,
  recognitionStartMonth: r.recognition_start_month || monthKeyOf(r.date),
  paymentMethod: r.payment_method || "", receiptPath: r.receipt_path || "",
});
const rowToActivity = (r) => ({
  id: r.id, timestamp: r.timestamp, actor: r.actor, action: r.action,
  entityType: r.entity_type, entityId: r.entity_id,
});
const rowToExpense = (r) => ({
  id: r.id, category: r.category, amount: Number(r.amount) || 0, month: r.month, note: r.note || "",
  isRecurring: !!r.is_recurring, overridesExpenseId: r.overrides_expense_id || null,
  createdBy: r.created_by || "", createdAt: r.created_at,
});
const rowToExpenseCategory = (r) => ({ name: r.name, group: r.group_key });
const rowToRevenueAdjustment = (r) => ({
  id: r.id, studentId: r.student_id || null, amount: Number(r.amount) || 0, month: r.month,
  note: r.note || "", createdBy: r.created_by || "", createdAt: r.created_at,
});

const GROUP_PATCH_MAP = { maxSize: "max_size" };
const STUDENT_PATCH_MAP = { groupId: "group_id", contractAmount: "contract_amount", parentPhone: "parent_phone", referrerName: "referrer_name" };
const PAYMENT_PATCH_MAP = {
  courseDurationMonths: "course_duration_months", recognitionStartMonth: "recognition_start_month",
  paymentMethod: "payment_method", receiptPath: "receipt_path",
};
function toRowPatch(patch, map) {
  const row = {};
  for (const [k, v] of Object.entries(patch)) row[map[k] || k] = v;
  return row;
}

async function loadAll() {
  const [
    groupsRes, studentsRes, paymentsRes, managersRes, teachersRes, sourcesRes, activityRes,
    expensesRes, expenseCategoriesRes, revenueAdjustmentsRes,
  ] = await Promise.all([
    supabase.from("groups").select("*").order("created_at", { ascending: true }),
    supabase.from("students").select("*").order("created_at", { ascending: true }),
    supabase.from("payments").select("*"),
    supabase.from("managers").select("name").order("name", { ascending: true }),
    supabase.from("teachers").select("name").order("name", { ascending: true }),
    supabase.from("sources").select("name").order("name", { ascending: true }),
    supabase.from("activity_log").select("*").order("timestamp", { ascending: false }).limit(ACTIVITY_LOG_LIMIT),
    supabase.from("expenses").select("*"),
    supabase.from("expense_categories").select("*").order("name", { ascending: true }),
    supabase.from("revenue_adjustments").select("*"),
  ]);

  for (const res of [
    groupsRes, studentsRes, paymentsRes, managersRes, teachersRes, sourcesRes, activityRes,
    expensesRes, expenseCategoriesRes, revenueAdjustmentsRes,
  ]) {
    if (res.error) console.error("Supabase load error:", res.error);
  }

  const paymentsByStudent = {};
  for (const p of paymentsRes.data || []) {
    (paymentsByStudent[p.student_id] ||= []).push(rowToPayment(p));
  }

  return {
    groups: (groupsRes.data || []).map(rowToGroup),
    students: (studentsRes.data || []).map((r) => rowToStudent(r, paymentsByStudent[r.id] || [])),
    managers: (managersRes.data || []).map((r) => r.name),
    teachers: (teachersRes.data || []).map((r) => r.name),
    sources: (sourcesRes.data || []).map((r) => r.name),
    activityLog: (activityRes.data || []).map(rowToActivity),
    expenses: (expensesRes.data || []).map(rowToExpense),
    expenseCategories: (expenseCategoriesRes.data || []).map(rowToExpenseCategory),
    revenueAdjustments: (revenueAdjustmentsRes.data || []).map(rowToRevenueAdjustment),
  };
}

async function dbInsertGroup(g) {
  const { error } = await supabase.from("groups").insert({
    id: g.id, level: g.level, name: g.name, teacher: g.teacher, time: g.time,
    max_size: g.maxSize, status: g.status, notes: g.notes,
  });
  if (error) console.error("insert group failed", error);
}
async function dbUpdateGroup(id, patch) {
  const { error } = await supabase.from("groups").update(toRowPatch(patch, GROUP_PATCH_MAP)).eq("id", id);
  if (error) console.error("update group failed", error);
}
async function dbInsertStudent(s) {
  const { error } = await supabase.from("students").insert({
    id: s.id, name: s.name, phone: s.phone, level: s.level, group_id: s.groupId,
    manager: s.manager, contract_amount: s.contractAmount, status: s.status, notes: s.notes,
    parent_phone: s.parentPhone || "", address: s.address || "",
    source: s.source || "", referrer_name: s.referrerName || "",
  });
  if (error) console.error("insert student failed", error);
}
async function dbUpdateStudent(id, patch) {
  const { error } = await supabase.from("students").update(toRowPatch(patch, STUDENT_PATCH_MAP)).eq("id", id);
  if (error) console.error("update student failed", error);
}
async function dbInsertPayment(p, studentId) {
  const { error } = await supabase.from("payments").insert({
    id: p.id, student_id: studentId, amount: p.amount, date: p.date, note: p.note,
    course_duration_months: p.courseDurationMonths, recognition_start_month: p.recognitionStartMonth,
    payment_method: p.paymentMethod, receipt_path: p.receiptPath,
  });
  if (error) console.error("insert payment failed", error);
}
async function uploadReceipt(studentId, file) {
  const safeName = file.name.replace(/\s+/g, "_");
  const path = `${studentId}/${uid()}-${safeName}`;
  const { error } = await supabase.storage.from("receipts").upload(path, file);
  if (error) throw error;
  return path;
}
async function getReceiptUrl(path) {
  const { data, error } = await supabase.storage.from("receipts").createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}
async function dbUpdatePayment(id, patch) {
  const { error } = await supabase.from("payments").update(toRowPatch(patch, PAYMENT_PATCH_MAP)).eq("id", id);
  if (error) console.error("update payment failed", error);
}
async function dbDeletePayment(id) {
  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) console.error("delete payment failed", error);
}
async function dbInsertManager(name) {
  const { error } = await supabase.from("managers").insert({ name });
  if (error) console.error("insert manager failed", error);
}
async function dbInsertTeacher(name) {
  const { error } = await supabase.from("teachers").insert({ name });
  if (error) console.error("insert teacher failed", error);
}
async function dbInsertSource(name) {
  const { error } = await supabase.from("sources").insert({ name });
  if (error) console.error("insert source failed", error);
}
async function dbInsertActivity(entry) {
  const { error } = await supabase.from("activity_log").insert({
    id: entry.id, timestamp: entry.timestamp, actor: entry.actor, action: entry.action,
    entity_type: entry.entityType, entity_id: entry.entityId,
  });
  if (error) console.error("insert activity failed", error);
}
async function dbInsertExpenseCategory(name, group) {
  const { error } = await supabase.from("expense_categories").insert({ name, group_key: group });
  if (error) console.error("insert expense category failed", error);
}
async function dbInsertExpense(e) {
  const { error } = await supabase.from("expenses").insert({
    id: e.id, category: e.category, amount: e.amount, month: e.month, note: e.note,
    is_recurring: e.isRecurring, overrides_expense_id: e.overridesExpenseId, created_by: e.createdBy,
  });
  if (error) console.error("insert expense failed", error);
}
async function dbUpdateExpense(id, patch) {
  const row = {};
  if ("category" in patch) row.category = patch.category;
  if ("amount" in patch) row.amount = patch.amount;
  if ("month" in patch) row.month = patch.month;
  if ("note" in patch) row.note = patch.note;
  if ("isRecurring" in patch) row.is_recurring = patch.isRecurring;
  const { error } = await supabase.from("expenses").update(row).eq("id", id);
  if (error) console.error("update expense failed", error);
}
async function dbDeleteExpense(id) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) console.error("delete expense failed", error);
}
async function dbInsertRevenueAdjustment(a) {
  const { error } = await supabase.from("revenue_adjustments").insert({
    id: a.id, student_id: a.studentId, amount: a.amount, month: a.month, note: a.note, created_by: a.createdBy,
  });
  if (error) console.error("insert revenue adjustment failed", error);
}
async function dbDeleteRevenueAdjustment(id) {
  const { error } = await supabase.from("revenue_adjustments").delete().eq("id", id);
  if (error) console.error("delete revenue adjustment failed", error);
}

/* ---------------------------------------------------------
   Main component
--------------------------------------------------------- */

export default function CRM() {
  const toasts = useToasts();
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("groups");
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [managers, setManagers] = useState(DEFAULT_MANAGERS);
  const [teachers, setTeachers] = useState(DEFAULT_TEACHERS);
  const [sources, setSources] = useState(DEFAULT_SOURCES);
  const [activityLog, setActivityLog] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState(DEFAULT_EXPENSE_CATEGORIES);
  const [revenueAdjustments, setRevenueAdjustments] = useState([]);

  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [studentFilter, setStudentFilter] = useState("active");
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [showNewStudentForm, setShowNewStudentForm] = useState(false);
  const [newManagerName, setNewManagerName] = useState("");
  const [newTeacherName, setNewTeacherName] = useState("");
  const [newSourceName, setNewSourceName] = useState("");
  const [newExpenseCategoryName, setNewExpenseCategoryName] = useState("");

  useEffect(() => {
    (async () => {
      const { groups, students, managers, teachers, sources, activityLog, expenses, expenseCategories, revenueAdjustments } = await loadAll();
      setGroups(groups);
      setStudents(students);
      setManagers(managers.length ? managers : DEFAULT_MANAGERS);
      setTeachers(teachers.length ? teachers : DEFAULT_TEACHERS);
      setSources(sources.length ? sources : DEFAULT_SOURCES);
      setActivityLog(activityLog);
      setExpenses(expenses);
      setExpenseCategories(expenseCategories.length ? expenseCategories : DEFAULT_EXPENSE_CATEGORIES);
      setRevenueAdjustments(revenueAdjustments);
      setLoading(false);
    })();
  }, []);

  // Supabase Auth owns the session token (its own storage, its own refresh) —
  // we just react to whichever user it currently has, then load the app-level
  // role/manager_name for that user from `profiles`.
  useEffect(() => {
    let cancelled = false;

    const loadProfileFor = async (user) => {
      if (!user) {
        if (!cancelled) {
          setProfile(null);
          setAuthUser(null);
          setAuthLoading(false);
        }
        return;
      }
      const { data, error } = await supabase.from("profiles").select("role, manager_name").eq("id", user.id).single();
      if (cancelled) return;
      if (error) {
        console.error("profile load failed", error);
        setProfile(null);
      } else {
        setProfile(data);
      }
      setAuthUser(user);
      setAuthLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => loadProfileFor(data.session?.user ?? null));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      loadProfileFor(newSession?.user ?? null);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Everything below still talks to a plain { role, name } shape, exactly
  // like before — only how it gets populated changed.
  const session = authUser && profile
    ? { role: profile.role, name: profile.role === "admin" ? authUser.email.split("@")[0] : (profile.manager_name || authUser.email) }
    : null;

  const login = async (email, password) => {
    setLoginPending(true);
    setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoginError("Неверный email или пароль");
    }
    setLoginPending(false);
  };
  const logout = () => {
    supabase.auth.signOut();
    setView("groups");
    setSelectedGroupId(null);
    setSelectedStudentId(null);
    setStudentFilter("active");
  };

  const logActivity = ({ action, entityType, entityId }) => {
    const entry = {
      id: uid(),
      timestamp: new Date().toISOString(),
      actor: session?.name || "—",
      action,
      entityType,
      entityId,
    };
    setActivityLog((prev) => [entry, ...prev].slice(0, ACTIVITY_LOG_LIMIT));
    dbInsertActivity(entry);
    showToast(action);
  };

  const addGroup = ({ level, time, name, teacher }) => {
    const g = {
      id: uid(),
      level,
      name: name.trim() || time.trim() || "Новая группа",
      time: time.trim() || "-",
      teacher: teacher || "-",
      maxSize: GROUP_MAX_SIZE,
      status: "active",
      notes: "",
    };
    setGroups([g, ...groups]);
    dbInsertGroup(g);
    logActivity({ action: `Создал группу «${g.name}» (${level})`, entityType: "group", entityId: g.id });
    return g;
  };

  const updateGroup = (id, patch, actionLabel) => {
    const group = groups.find((g) => g.id === id);
    setGroups(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    dbUpdateGroup(id, patch);
    if (actionLabel && group) {
      logActivity({ action: actionLabel, entityType: "group", entityId: id });
    }
  };

  const addStudent = (groupId, { name, phone, manager, contractAmount }) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group || !name.trim()) return;
    const effectiveManager = session.role === "manager" ? session.name : (manager || managers[0] || "");
    const s = {
      id: uid(),
      name: name.trim(),
      phone: phone.trim(),
      level: group.level,
      groupId,
      manager: effectiveManager,
      contractAmount: Number(contractAmount) || 0,
      payments: [],
      status: "active",
      notes: "",
    };
    setStudents([s, ...students]);
    dbInsertStudent(s);
    logActivity({ action: `Добавил студента — ${s.name} (${group.name})`, entityType: "student", entityId: s.id });
  };

  const updateStudent = (id, patch, actionLabel) => {
    const student = students.find((s) => s.id === id);
    setStudents(students.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    dbUpdateStudent(id, patch);
    if (actionLabel && student) {
      logActivity({ action: actionLabel, entityType: "student", entityId: id });
    }
  };

  const addPayment = (studentId, amount, courseDurationMonths, paymentMethod, receiptPath, date, recognitionStartMonth) => {
    const amt = Number(amount);
    if (!amt || amt <= 0 || !paymentMethod) return;
    const student = students.find((s) => s.id === studentId);
    const paymentDate = date || new Date().toISOString().slice(0, 10);
    const duration = Math.max(1, Number(courseDurationMonths) || 1);
    const payment = {
      id: uid(), amount: amt, date: paymentDate, note: "Оплата",
      courseDurationMonths: duration, recognitionStartMonth: recognitionStartMonth || monthKeyOf(paymentDate),
      paymentMethod, receiptPath,
    };
    setStudents(
      students.map((s) => (s.id === studentId ? { ...s, payments: [...(s.payments || []), payment] } : s))
    );
    dbInsertPayment(payment, studentId);
    if (student) {
      const durationNote = duration > 1 ? ` (признание выручки: ${duration} мес.)` : "";
      logActivity({ action: `Добавил оплату ${fmt(amt)} (${paymentMethod}) — ${student.name}${durationNote}`, entityType: "student", entityId: studentId });
    }
  };

  const updatePayment = (studentId, paymentId, patch) => {
    if (session.role !== "admin") return;
    const student = students.find((s) => s.id === studentId);
    if (!student) return;
    const payment = (student.payments || []).find((p) => p.id === paymentId);
    if (!payment) return;
    const updated = { ...payment, ...patch };
    setStudents(
      students.map((s) =>
        s.id === studentId
          ? { ...s, payments: (s.payments || []).map((p) => (p.id === paymentId ? updated : p)) }
          : s
      )
    );
    dbUpdatePayment(paymentId, patch);

    const diffs = [];
    if (patch.amount !== undefined && Number(patch.amount) !== payment.amount) {
      diffs.push(`сумма ${fmt(payment.amount)}→${fmt(Number(patch.amount))}`);
    }
    if (patch.paymentMethod !== undefined && patch.paymentMethod !== payment.paymentMethod) {
      diffs.push(`способ «${payment.paymentMethod}»→«${patch.paymentMethod}»`);
    }
    if (patch.date !== undefined && patch.date !== payment.date) {
      diffs.push(`дата ${fmtDate(payment.date)}→${fmtDate(patch.date)}`);
    }
    if (patch.recognitionStartMonth !== undefined && patch.recognitionStartMonth !== payment.recognitionStartMonth) {
      diffs.push(`месяц признания ${formatMonthLabel(payment.recognitionStartMonth)}→${formatMonthLabel(patch.recognitionStartMonth)}`);
    }
    if (patch.courseDurationMonths !== undefined && Number(patch.courseDurationMonths) !== payment.courseDurationMonths) {
      diffs.push(`длительность ${payment.courseDurationMonths}→${Number(patch.courseDurationMonths)} мес.`);
    }
    if (patch.receiptPath !== undefined && patch.receiptPath !== payment.receiptPath) {
      diffs.push("чек заменён");
    }
    if (diffs.length) {
      logActivity({ action: `Изменил оплату — ${student.name}: ${diffs.join(", ")}`, entityType: "student", entityId: studentId });
    }
  };

  const deletePayment = (studentId, paymentId) => {
    if (session.role !== "admin") return;
    const student = students.find((s) => s.id === studentId);
    if (!student) return;
    const payment = (student.payments || []).find((p) => p.id === paymentId);
    if (!payment) return;
    setStudents(
      students.map((s) =>
        s.id === studentId ? { ...s, payments: (s.payments || []).filter((p) => p.id !== paymentId) } : s
      )
    );
    dbDeletePayment(paymentId);
    logActivity({ action: `Удалил оплату ${fmt(payment.amount)} — ${student.name}`, entityType: "student", entityId: studentId });
  };

  const transferStudent = (studentId, newGroupId) => {
    const student = students.find((s) => s.id === studentId);
    const group = groups.find((g) => g.id === newGroupId);
    if (!group || !student) return;
    updateStudent(studentId, { groupId: newGroupId, level: group.level }, `Перевёл студента ${student.name} в группу «${group.name}»`);
  };

  const archiveStudent = (id) => {
    const student = students.find((s) => s.id === id);
    updateStudent(id, { status: "archived" }, student ? `Архивировал студента — ${student.name}` : undefined);
  };
  const restoreStudent = (id) => {
    const student = students.find((s) => s.id === id);
    updateStudent(id, { status: "active" }, student ? `Восстановил из архива — ${student.name}` : undefined);
  };

  const addManager = () => {
    const n = newManagerName.trim();
    if (!n || managers.includes(n)) return;
    setManagers([...managers, n]);
    dbInsertManager(n);
    setNewManagerName("");
    showToast(`Менеджер «${n}» добавлен`);
  };

  const addTeacher = () => {
    const n = newTeacherName.trim();
    if (!n || teachers.includes(n)) return;
    setTeachers([...teachers, n]);
    dbInsertTeacher(n);
    setNewTeacherName("");
    showToast(`Преподаватель «${n}» добавлен`);
  };

  const addSource = () => {
    const n = newSourceName.trim();
    if (!n || sources.includes(n)) return;
    setSources([...sources, n]);
    dbInsertSource(n);
    setNewSourceName("");
    showToast(`Источник «${n}» добавлен`);
  };

  const addExpenseCategory = (group) => {
    const n = newExpenseCategoryName.trim();
    if (!n || expenseCategories.some((c) => c.name === n)) return;
    const category = { name: n, group };
    setExpenseCategories([...expenseCategories, category]);
    dbInsertExpenseCategory(n, group);
    setNewExpenseCategoryName("");
    logActivity({ action: `Добавил категорию расходов «${n}» в группу «${EXPENSE_GROUPS.find((g) => g.key === group)?.label || group}»`, entityType: "expense_category", entityId: n });
  };

  const addExpense = ({ category, amount, month, note, isRecurring }) => {
    const amt = Number(amount);
    if (!amt || amt <= 0 || !category || !month) return;
    const e = {
      id: uid(), category, amount: amt, month, note: note || "",
      isRecurring: !!isRecurring, overridesExpenseId: null,
      createdBy: session.name, createdAt: new Date().toISOString(),
    };
    setExpenses((prev) => [e, ...prev]);
    dbInsertExpense(e);
    const recurringNote = e.isRecurring ? " (повторяющийся)" : "";
    logActivity({ action: `Добавил расход «${category}» ${fmt(amt)}${recurringNote} — ${formatMonthLabel(month)}`, entityType: "expense", entityId: e.id });
  };

  // Save an edit made while viewing `viewedMonth`. For a plain one-off
  // expense or an existing override this just updates that row directly.
  // For an unmodified recurring template, `asOverride` decides whether the
  // change applies only to `viewedMonth` (creates a new override row) or to
  // the template itself (every month that doesn't already have its own
  // override).
  const saveExpenseEdit = (row, patch, viewedMonth, asOverride) => {
    if (row._kind === "template" && asOverride) {
      const override = {
        id: uid(), category: row.category, amount: Number(patch.amount) || row.amount,
        month: viewedMonth, note: patch.note ?? row.note, isRecurring: false,
        overridesExpenseId: row.id, createdBy: session.name, createdAt: new Date().toISOString(),
      };
      setExpenses((prev) => [override, ...prev]);
      dbInsertExpense(override);
      logActivity({
        action: `Переопределил расход «${row.category}» на ${formatMonthLabel(viewedMonth)}: ${fmt(row.amount)} → ${fmt(override.amount)}`,
        entityType: "expense", entityId: row.id,
      });
      return;
    }
    const targetId = row._kind === "override" ? row._overrideId : row.id;
    const cleanPatch = { amount: Number(patch.amount) || row.amount, note: patch.note ?? row.note };
    setExpenses((prev) => prev.map((e) => (e.id === targetId ? { ...e, ...cleanPatch } : e)));
    dbUpdateExpense(targetId, cleanPatch);
    const label = row._kind === "template" ? `Изменил шаблон расхода «${row.category}»` : `Изменил расход «${row.category}»`;
    logActivity({ action: `${label}: ${fmt(row.amount)} → ${fmt(cleanPatch.amount)}`, entityType: "expense", entityId: targetId });
  };

  const deleteExpenseRow = (row) => {
    const targetId = row._kind === "override" ? row._overrideId : row.id;
    setExpenses((prev) => prev.filter((e) => e.id !== targetId));
    dbDeleteExpense(targetId);
    const label = row._kind === "template"
      ? `Остановил повторяющийся расход «${row.category}» (${fmt(row.amount)}/мес.)`
      : `Удалил расход «${row.category}» ${fmt(row.amount)}`;
    logActivity({ action: label, entityType: "expense", entityId: targetId });
  };

  const addRevenueAdjustment = ({ studentId, amount, month, note }) => {
    const amt = Number(amount);
    if (!amt || amt <= 0 || !month) return;
    const student = studentId ? students.find((s) => s.id === studentId) : null;
    const a = {
      id: uid(), studentId: studentId || null, amount: amt, month, note: note || "",
      createdBy: session.name, createdAt: new Date().toISOString(),
    };
    setRevenueAdjustments((prev) => [a, ...prev]);
    dbInsertRevenueAdjustment(a);
    const who = student ? ` — ${student.name}` : "";
    logActivity({ action: `Оформил возврат ${fmt(amt)}${who} (${formatMonthLabel(month)})`, entityType: "revenue_adjustment", entityId: a.id });
  };

  const deleteRevenueAdjustment = (id) => {
    const a = revenueAdjustments.find((r) => r.id === id);
    setRevenueAdjustments((prev) => prev.filter((r) => r.id !== id));
    dbDeleteRevenueAdjustment(id);
    if (a) {
      logActivity({ action: `Удалил возврат ${fmt(a.amount)} (${formatMonthLabel(a.month)})`, entityType: "revenue_adjustment", entityId: id });
    }
  };

  /* ---- derived ---- */
  const isVisibleToUser = useCallback(
    (student) => !session || session.role === "admin" || student.manager === session.name,
    [session]
  );
  const activeStudentsCount = useMemo(
    () => students.filter((s) => s.status === "active" && isVisibleToUser(s)).length,
    [students, isVisibleToUser]
  );
  const totalRevenue = useMemo(() => students.reduce((s, st) => s + totalPaid(st), 0), [students]);
  const totalDebt = useMemo(
    () => students.filter((s) => s.status === "active").reduce((s, st) => s + Math.max(0, remaining(st)), 0),
    [students]
  );

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) || null;
  const selectedStudent = students.find((s) => s.id === selectedStudentId) || null;

  if (authLoading) {
    return (
      <div className="crm-root" style={{ height: 500 }}>
        <Styles />
        <div className="loading-wrap" style={{ width: "100%" }}>
          <Loader2 size={16} className="spin" style={{ animation: "spin 1s linear infinite" }} />
          Проверяем сессию…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!authUser) {
    return <LoginScreen onLogin={login} loading={loginPending} error={loginError} />;
  }

  if (!profile) {
    return (
      <div className="crm-root login-root" style={{ height: 500 }}>
        <Styles />
        <div className="login-card">
          <div className="login-title crm-slab">Профиль не найден</div>
          <div className="login-sub">
            Вы вошли как {authUser.email}, но для этого пользователя нет строки в таблице <code>profiles</code>.
            Обратитесь к супер-админу, чтобы её добавили.
          </div>
          <button className="btn-secondary" style={{ width: "100%", justifyContent: "center" }} onClick={logout}>
            <LogOut size={13} /> Выйти
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="crm-root" style={{ height: 500 }}>
        <Styles />
        <div className="loading-wrap" style={{ width: "100%" }}>
          <Loader2 size={16} className="spin" style={{ animation: "spin 1s linear infinite" }} />
          Загрузка CRM…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const tabs = session.role === "admin"
    ? [
        { key: "groups", label: "Группы", fullLabel: "Группы", icon: Users },
        { key: "cfo", label: "CFO", fullLabel: "CFO — аналитика", icon: TrendingUp },
        { key: "finance", label: "Финансы", fullLabel: "Финансы", icon: Wallet },
        { key: "activity", label: "Журнал", fullLabel: "Журнал изменений", icon: History },
      ]
    : [
        { key: "groups", label: "Группы", fullLabel: "Группы", icon: Users },
        { key: "my-analytics", label: "Моя", fullLabel: "Моя аналитика", icon: TrendingUp },
      ];
  const goToTab = (key) => {
    setView(key);
    if (key === "groups") setSelectedGroupId(null);
  };

  return (
    <div className="crm-root" style={{ height: 720, position: "relative" }}>
      <Styles />
      <ToastStack toasts={toasts} />

      {/* Sidebar (desktop) */}
      <div className="crm-sidebar">
        <div className="crm-brand">
          <div className="crm-brand-title crm-slab">Uni Language Hub</div>
          <div className="crm-brand-sub">Учебный центр</div>
        </div>
        {tabs.map((t) => (
          <button key={t.key} className={`crm-tab ${view === t.key ? "active" : ""}`} onClick={() => goToTab(t.key)}>
            <t.icon size={15} /> {t.fullLabel}
          </button>
        ))}
        <div style={{ marginTop: "auto" }}>
          <div className="session-info">
            {session.role === "admin" ? <Shield size={12} /> : <Users size={12} />}
            {session.name} · {session.role === "admin" ? "супер-админ" : "менеджер"}
          </div>
          <button className="logout-btn" onClick={logout}>
            <LogOut size={13} /> Выйти / сменить пользователя
          </button>
          <div style={{ padding: "0 20px", fontSize: 10.5, opacity: 0.5, lineHeight: 1.5 }}>
            Данные общие для команды и сохраняются автоматически.
          </div>
        </div>
      </div>

      {/* Bottom nav (mobile) */}
      <div className="bottom-nav">
        {tabs.map((t) => (
          <button key={t.key} className={`bottom-nav-item ${view === t.key ? "active" : ""}`} onClick={() => goToTab(t.key)}>
            <t.icon size={19} />
            {t.label}
          </button>
        ))}
        <button className="bottom-nav-item" onClick={logout}>
          <LogOut size={19} />
          Выйти
        </button>
      </div>

      {/* Main */}
      <div className="crm-main">
        <div className="crm-topbar">
          <div className="crm-h1 crm-slab">
            {view === "groups" ? (
              selectedGroup ? (
                <>
                  <button className="icon-btn" onClick={() => setSelectedGroupId(null)} title="Назад к группам">
                    <ArrowLeft size={13} />
                  </button>
                  {selectedGroup.name} · {selectedGroup.level}
                </>
              ) : (
                "Группы"
              )
            ) : view === "cfo" ? (
              "Финансовая панель CFO"
            ) : view === "finance" ? (
              "Финансы"
            ) : view === "my-analytics" ? (
              "Моя аналитика"
            ) : (
              "Журнал изменений"
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="crm-mono" style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              Активных студентов: {activeStudentsCount} · Групп: {groups.filter((g) => g.status === "active").length}
            </div>
            <GlobalSearch
              students={students}
              groups={groups}
              isVisibleToUser={isVisibleToUser}
              onSelectStudent={setSelectedStudentId}
            />
          </div>
        </div>

        <div className="crm-content">
          {view === "groups" ? (
            selectedGroup ? (
              <GroupDetail
                group={selectedGroup}
                groups={groups}
                students={students}
                managers={managers}
                teachers={teachers}
                session={session}
                isVisibleToUser={isVisibleToUser}
                studentFilter={studentFilter}
                setStudentFilter={setStudentFilter}
                showNewStudentForm={showNewStudentForm}
                setShowNewStudentForm={setShowNewStudentForm}
                addStudent={addStudent}
                updateGroup={updateGroup}
                onSelectStudent={setSelectedStudentId}
              />
            ) : (
              <GroupsList
                groups={groups}
                students={students}
                teachers={teachers}
                showNewGroupForm={showNewGroupForm}
                setShowNewGroupForm={setShowNewGroupForm}
                addGroup={addGroup}
                onSelectGroup={setSelectedGroupId}
              />
            )
          ) : view === "cfo" ? (
            session.role === "admin" && (
              <CfoView
                groups={groups}
                students={students}
                managers={managers}
                teachers={teachers}
                newManagerName={newManagerName}
                setNewManagerName={setNewManagerName}
                addManager={addManager}
                newTeacherName={newTeacherName}
                setNewTeacherName={setNewTeacherName}
                addTeacher={addTeacher}
                sources={sources}
                newSourceName={newSourceName}
                setNewSourceName={setNewSourceName}
                addSource={addSource}
                totalRevenue={totalRevenue}
                totalDebt={totalDebt}
                activeStudentsCount={activeStudentsCount}
                revenueAdjustments={revenueAdjustments}
              />
            )
          ) : view === "finance" ? (
            session.role === "admin" && (
              <FinanceView
                students={students}
                expenses={expenses}
                expenseCategories={expenseCategories}
                newExpenseCategoryName={newExpenseCategoryName}
                setNewExpenseCategoryName={setNewExpenseCategoryName}
                addExpenseCategory={addExpenseCategory}
                addExpense={addExpense}
                saveExpenseEdit={saveExpenseEdit}
                deleteExpenseRow={deleteExpenseRow}
                revenueAdjustments={revenueAdjustments}
                addRevenueAdjustment={addRevenueAdjustment}
                deleteRevenueAdjustment={deleteRevenueAdjustment}
              />
            )
          ) : view === "my-analytics" ? (
            session.role === "manager" && (
              <ManagerAnalyticsView
                managerName={session.name}
                students={students}
                groups={groups}
                revenueAdjustments={revenueAdjustments}
              />
            )
          ) : (
            session.role === "admin" && (
              <ActivityLogView activityLog={activityLog} managers={managers} />
            )
          )}
        </div>
      </div>

      {selectedStudent && (
        <StudentModal
          student={selectedStudent}
          groups={groups}
          managers={managers}
          sources={sources}
          activityLog={activityLog}
          session={session}
          onClose={() => setSelectedStudentId(null)}
          updateStudent={updateStudent}
          addPayment={addPayment}
          updatePayment={updatePayment}
          deletePayment={deletePayment}
          transferStudent={transferStudent}
          archiveStudent={archiveStudent}
          restoreStudent={restoreStudent}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Login screen — real Supabase Auth (email + password)
--------------------------------------------------------- */

function LoginScreen({ onLogin, loading, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    onLogin(email.trim(), password);
  };

  return (
    <div className="crm-root login-root" style={{ height: 500 }}>
      <Styles />
      <div className="login-card">
        <div className="login-title crm-slab">Uni Language Hub</div>
        <div className="login-sub">Войдите, чтобы продолжить</div>

        <form onSubmit={submit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Email</label>
            <input
              type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="manager@oshlanguage.kg"
            />
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Пароль</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && (
            <div className="warn-text" style={{ marginBottom: 12 }}>
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          <button
            type="submit" className="btn-primary" style={{ width: "100%", justifyContent: "center" }}
            disabled={loading || !email.trim() || !password}
          >
            {loading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : null}
            {loading ? "Входим…" : "Войти"}
          </button>
        </form>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Global search — students only, scoped by visibility
--------------------------------------------------------- */

function GlobalSearch({ students, groups, isVisibleToUser, onSelectStudent }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
    }
  }, [open]);

  const groupsById = useMemo(() => {
    const map = {};
    for (const g of groups) map[g.id] = g;
    return map;
  }, [groups]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(isVisibleToUser)
      .filter((s) => {
        const group = groupsById[s.groupId];
        const haystack = [s.name, s.phone, s.level, s.manager, group ? group.name : ""]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 20);
  }, [students, groupsById, query, isVisibleToUser]);

  const openStudent = (id) => {
    onSelectStudent(id);
    setOpen(false);
  };

  return (
    <div className="search-wrap" ref={containerRef}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} title="Поиск студентов">
        <Search size={14} />
      </button>
      {open && (
        <div className="search-panel">
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Имя, телефон, группа, уровень, менеджер…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          />
          {query.trim() && (
            <div className="search-results">
              {results.length === 0 && <div className="empty-hint">Ничего не найдено</div>}
              {results.map((s) => {
                const group = groupsById[s.groupId];
                return (
                  <div key={s.id} className="search-result-row" onClick={() => openStudent(s.id)}>
                    <div className="search-result-name">{s.name}</div>
                    <div className="search-result-meta">{s.level} · {group ? group.name : "—"} · {s.manager || "менеджер не указан"}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------
   Groups list view
--------------------------------------------------------- */

function GroupsList({ groups, students, teachers, showNewGroupForm, setShowNewGroupForm, addGroup, onSelectGroup }) {
  const [form, setForm] = useState({ level: LEVELS[0], time: "", name: "", teacher: teachers[0] || "" });
  // Expanded by default (matches the old always-open layout on desktop,
  // where a CSS rule forces the body open regardless of this state anyway).
  // On mobile this becomes a real accordion — tap a level to collapse it.
  const [expandedLevels, setExpandedLevels] = useState(() => new Set(LEVELS));
  const toggleLevel = (level) => {
    setExpandedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level); else next.add(level);
      return next;
    });
  };

  const activeCount = (groupId) => students.filter((s) => s.groupId === groupId && s.status === "active").length;

  const byLevel = useMemo(() => {
    const map = {};
    for (const level of LEVELS) map[level] = [];
    for (const g of groups) {
      if (!map[g.level]) map[g.level] = [];
      map[g.level].push(g);
    }
    return map;
  }, [groups]);

  const submit = () => {
    if (!form.time.trim() && !form.name.trim()) return;
    addGroup(form);
    setForm({ level: LEVELS[0], time: "", name: "", teacher: teachers[0] || "" });
    setShowNewGroupForm(false);
  };

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <button className="btn-primary" onClick={() => setShowNewGroupForm((v) => !v)}>
          <Plus size={14} /> Создать группу
        </button>
      </div>

      {showNewGroupForm && (
        <div className="form-card">
          <div className="form-grid">
            <div className="field">
              <label>Уровень</label>
              <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
                {LEVELS.map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Название группы</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Утро 10:30-12:00" />
            </div>
            <div className="field">
              <label>Время</label>
              <input value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="10:30-12:00" />
            </div>
            <div className="field">
              <label>Преподаватель</label>
              <select value={form.teacher} onChange={(e) => setForm({ ...form, teacher: e.target.value })}>
                <option value="-">—</option>
                {teachers.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn-primary" onClick={submit}>
              <Plus size={14} /> Сохранить группу
            </button>
          </div>
        </div>
      )}

      {LEVELS.map((level) => {
        const levelGroups = byLevel[level] || [];
        if (levelGroups.length === 0) return null;
        const isOpen = expandedLevels.has(level);
        return (
          <div key={level} className="level-section">
            <button className="level-header" onClick={() => toggleLevel(level)}>
              <span className="level-header-left">
                <ChevronRight size={15} className={`level-chevron ${isOpen ? "open" : ""}`} />
                <span className="section-title" style={{ margin: 0 }}>{level}</span>
              </span>
              <span className="level-count">{levelGroups.length}</span>
            </button>
            <div className={`level-body ${isOpen ? "" : "collapsed"}`}>
              <div className="group-grid" style={{ marginTop: 10 }}>
                {levelGroups.map((g) => {
                  const cnt = activeCount(g.id);
                  const full = cnt >= g.maxSize;
                  return (
                    <div
                      key={g.id}
                      className={`group-card ${g.status === "archived" ? "archived" : ""}`}
                      onClick={() => onSelectGroup(g.id)}
                    >
                      <div className="group-card-name">{g.name}</div>
                      <div className="group-card-meta">{g.time} · {g.teacher}{g.status === "archived" ? " · закрыта" : ""}</div>
                      <div className={`group-card-count ${full ? "full" : ""}`}>{cnt} / {g.maxSize} студентов</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      {groups.length === 0 && (
        <EmptyState
          icon={<Users size={22} />}
          title="Групп пока нет"
          sub="Создайте первую группу, чтобы начать добавлять студентов"
          actionLabel="Создать группу"
          onAction={() => setShowNewGroupForm(true)}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------
   Group detail view — student roster
--------------------------------------------------------- */

function GroupDetail({
  group, groups, students, managers, teachers, session, isVisibleToUser, studentFilter, setStudentFilter,
  showNewStudentForm, setShowNewStudentForm, addStudent, updateGroup, onSelectStudent,
}) {
  const [form, setForm] = useState({ name: "", phone: "", manager: managers[0] || "", contractAmount: "" });
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(group.name);
  const [notes, setNotes] = useState(group.notes || "");

  const startRename = () => {
    setNameInput(group.name);
    setRenaming(true);
  };
  const saveRename = () => {
    const n = nameInput.trim();
    if (n && n !== group.name) updateGroup(group.id, { name: n }, `Переименовал группу «${group.name}» → «${n}»`);
    setRenaming(false);
  };

  const groupStudents = useMemo(
    () => students.filter((s) => s.groupId === group.id && s.status === studentFilter && isVisibleToUser(s)),
    [students, group.id, studentFilter, isVisibleToUser]
  );
  const activeCount = useMemo(
    () => students.filter((s) => s.groupId === group.id && s.status === "active").length,
    [students, group.id]
  );

  const submit = () => {
    if (!form.name.trim()) return;
    addStudent(group.id, form);
    setForm({ name: "", phone: "", manager: managers[0] || "", contractAmount: "" });
    setShowNewStudentForm(false);
  };

  return (
    <>
      <div className="form-card">
        <div className="group-title-row" style={{ marginBottom: 10 }}>
          {renaming ? (
            <div className="rename-form">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(false); }}
                autoFocus
              />
              <button className="icon-btn" onClick={saveRename} title="Сохранить"><Check size={13} /></button>
              <button className="icon-btn" onClick={() => setRenaming(false)} title="Отмена"><X size={13} /></button>
            </div>
          ) : (
            <>
              <span className="crm-slab" style={{ fontSize: 16, fontWeight: 700 }}>{group.name}</span>
              <button className="icon-btn" onClick={startRename} title="Изменить название"><Pencil size={12} /></button>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
          <span>Время: <b style={{ color: "var(--ink)" }}>{group.time}</b></span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Преподаватель:
            <select
              className="teacher-select"
              value={group.teacher}
              onChange={(e) => updateGroup(group.id, { teacher: e.target.value }, `Изменил преподавателя группы «${group.name}»: ${group.teacher} → ${e.target.value}`)}
            >
              <option value="-">—</option>
              {teachers.map((t) => <option key={t}>{t}</option>)}
            </select>
          </span>
          {group.status === "archived" && <span className="badge lost">закрыта</span>}
        </div>
        <div className="field">
          <label>Заметки о группе</label>
          <textarea
            className="notes-field"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== (group.notes || "")) updateGroup(group.id, { notes }, `Изменил заметку группы «${group.name}»`);
            }}
            placeholder="Например: группа переезжает на новое время, нужен ассистент…"
          />
        </div>
      </div>

      <div className="chip-row">
        <button className={`chip ${studentFilter === "active" ? "active" : ""}`} onClick={() => setStudentFilter("active")}>
          Активные
        </button>
        <button className={`chip ${studentFilter === "archived" ? "active" : ""}`} onClick={() => setStudentFilter("archived")}>
          Архив
        </button>
        <div style={{ marginLeft: "auto" }}>
          <button className="btn-primary" onClick={() => setShowNewStudentForm((v) => !v)}>
            <UserPlus size={14} /> Добавить студента
          </button>
        </div>
      </div>

      {showNewStudentForm && (
        <div className="form-card">
          {activeCount >= group.maxSize && (
            <div className="warn-text" style={{ marginBottom: 10 }}>
              <AlertTriangle size={13} /> В группе уже {activeCount} / {group.maxSize} студентов
            </div>
          )}
          <div className="form-grid">
            <div className="field">
              <label>Имя студента</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Азамат уулу Бек" />
            </div>
            <div className="field">
              <label>Телефон</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+996 700 000 000" />
            </div>
            {session.role === "admin" ? (
              <div className="field">
                <label>Менеджер</label>
                <select value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })}>
                  {managers.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            ) : (
              <div className="field">
                <label>Менеджер</label>
                <div style={{ padding: "7px 9px", fontSize: 12.5 }}>{session.name}</div>
              </div>
            )}
            <div className="field">
              <label>Сумма контракта (KGS)</label>
              <input type="number" value={form.contractAmount} onChange={(e) => setForm({ ...form, contractAmount: e.target.value })} placeholder="24000" />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn-primary" onClick={submit} disabled={!form.name.trim()}>
              <Plus size={14} /> Добавить
            </button>
          </div>
        </div>
      )}

      <div className="student-grid">
        {groupStudents.map((s) => {
          const paid = totalPaid(s);
          const rem = remaining(s);
          const pct = s.contractAmount > 0 ? Math.min(100, Math.round((paid / s.contractAmount) * 100)) : 0;
          const fillClass = rem < 0 ? "over" : paid === 0 ? "zero" : "";
          return (
            <div key={s.id} className={`student-card ${s.status === "archived" ? "archived" : ""}`} onClick={() => onSelectStudent(s.id)}>
              <div className="student-name">{s.name}</div>
              <div className="student-meta">{s.manager || "менеджер не указан"}{s.phone ? ` · ${s.phone}` : ""}</div>
              <div className="progress-track">
                <div className={`progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="student-amounts crm-mono">
                <span>{fmt(paid)}</span>
                <span style={{ color: rem > 0 ? "var(--ink-soft)" : rem < 0 ? "var(--danger)" : "var(--primary)" }}>
                  {rem > 0 ? `ост. ${fmt(rem)}` : rem < 0 ? `перепл. ${fmt(-rem)}` : "оплачено"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {groupStudents.length === 0 && (
        studentFilter === "active" ? (
          <EmptyState
            icon={<UserPlus size={22} />}
            title="В группе пока нет активных студентов"
            sub="Добавьте первого студента в эту группу"
            actionLabel="Добавить студента"
            onAction={() => setShowNewStudentForm(true)}
          />
        ) : (
          <EmptyState icon={<Archive size={22} />} title="В архиве этой группы никого нет" />
        )
      )}
    </>
  );
}

/* ---------------------------------------------------------
   Student profile modal
--------------------------------------------------------- */

function StudentModal({ student, groups, managers, sources, activityLog, session, onClose, updateStudent, addPayment, updatePayment, deletePayment, transferStudent, archiveStudent, restoreStudent }) {
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const [name, setName] = useState(student.name);
  const [phone, setPhone] = useState(student.phone);
  const [parentPhone, setParentPhone] = useState(student.parentPhone || "");
  const [address, setAddress] = useState(student.address || "");
  const [source, setSource] = useState(student.source || "");
  const [referrerName, setReferrerName] = useState(student.referrerName || "");
  const [manager, setManager] = useState(student.manager);
  const [contractAmount, setContractAmount] = useState(String(student.contractAmount || 0));
  const [transferTarget, setTransferTarget] = useState(student.groupId);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [newPaymentAmount, setNewPaymentAmount] = useState("");
  const [newPaymentDuration, setNewPaymentDuration] = useState("1");
  const [newPaymentMethod, setNewPaymentMethod] = useState("");
  const [newPaymentDate, setNewPaymentDate] = useState(todayStr());
  const [newPaymentRecognitionMonth, setNewPaymentRecognitionMonth] = useState(monthKeyOf(todayStr()));
  const [newReceiptFile, setNewReceiptFile] = useState(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [notes, setNotes] = useState(student.notes || "");

  const studentLog = useMemo(
    () => activityLog.filter((e) => e.entityId === student.id).slice(0, 8),
    [activityLog, student.id]
  );

  const resetPaymentForm = () => {
    setEditingPaymentId(null);
    setNewPaymentAmount("");
    setNewPaymentDuration("1");
    setNewPaymentMethod("");
    setNewReceiptFile(null);
    setReceiptError("");
    const t = todayStr();
    setNewPaymentDate(t);
    setNewPaymentRecognitionMonth(monthKeyOf(t));
  };

  useEffect(() => {
    setName(student.name);
    setPhone(student.phone);
    setParentPhone(student.parentPhone || "");
    setAddress(student.address || "");
    setSource(student.source || "");
    setReferrerName(student.referrerName || "");
    setManager(student.manager);
    setContractAmount(String(student.contractAmount || 0));
    setTransferTarget(student.groupId);
    setNotes(student.notes || "");
    resetPaymentForm();
  }, [student.id]);

  const group = groups.find((g) => g.id === student.groupId);
  const paid = totalPaid(student);
  const rem = remaining(student);
  const pct = student.contractAmount > 0 ? Math.min(100, Math.round((paid / student.contractAmount) * 100)) : 0;
  const fillClass = rem < 0 ? "over" : paid === 0 ? "zero" : "";

  const saveField = (patch, actionLabel) => updateStudent(student.id, patch, actionLabel);

  const submitPayment = async () => {
    if (!newPaymentAmount || !newPaymentMethod) return;
    setReceiptError("");
    setUploadingReceipt(true);
    try {
      const duration = editingPaymentId ? Math.max(1, Number(newPaymentDuration) || 1) : 1;
      if (editingPaymentId) {
        const existing = (student.payments || []).find((p) => p.id === editingPaymentId);
        const receiptPath = newReceiptFile ? await uploadReceipt(student.id, newReceiptFile) : existing?.receiptPath || "";
        updatePayment(student.id, editingPaymentId, {
          amount: Number(newPaymentAmount),
          courseDurationMonths: duration,
          paymentMethod: newPaymentMethod,
          date: newPaymentDate,
          recognitionStartMonth: newPaymentRecognitionMonth,
          receiptPath,
        });
      } else {
        const receiptPath = newReceiptFile ? await uploadReceipt(student.id, newReceiptFile) : "";
        addPayment(student.id, newPaymentAmount, duration, newPaymentMethod, receiptPath, newPaymentDate, newPaymentRecognitionMonth);
      }
      resetPaymentForm();
    } catch (e) {
      console.error("receipt upload failed", e);
      setReceiptError("Не удалось загрузить чек, попробуйте ещё раз");
      showToast("Не удалось загрузить чек", "error");
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleEditPayment = (payment) => {
    setEditingPaymentId(payment.id);
    setNewPaymentAmount(String(payment.amount));
    setNewPaymentDuration(String(payment.courseDurationMonths || 1));
    setNewPaymentMethod(payment.paymentMethod || "");
    setNewPaymentDate(payment.date || todayStr());
    setNewPaymentRecognitionMonth(payment.recognitionStartMonth || monthKeyOf(payment.date || todayStr()));
    setNewReceiptFile(null);
    setReceiptError("");
  };

  const openReceipt = async (payment) => {
    try {
      const url = await getReceiptUrl(payment.receiptPath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("receipt open failed", e);
      showToast("Не удалось открыть чек", "error");
    }
  };

  const handleDeletePayment = (payment) => {
    if (window.confirm(`Удалить платёж ${fmt(payment.amount)} от ${fmtDate(payment.date)}?`)) {
      deletePayment(student.id, payment.id);
    }
  };

  const submitTransfer = () => {
    if (transferTarget && transferTarget !== student.groupId) {
      transferStudent(student.id, transferTarget);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title crm-slab">Профиль студента</div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Имя</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const n = name.trim() || student.name;
                if (n !== student.name) saveField({ name: n }, `Изменил имя студента — ${student.name} → ${n}`);
              }}
            />
          </div>
          <div className="field">
            <label>Телефон</label>
            <input
              value={phone} onChange={(e) => setPhone(e.target.value)}
              onBlur={() => { if (phone !== student.phone) saveField({ phone }, `Изменил телефон — ${student.name}`); }}
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Телефон родителя</label>
            <input
              value={parentPhone} onChange={(e) => setParentPhone(e.target.value)}
              onBlur={() => { if (parentPhone !== (student.parentPhone || "")) saveField({ parentPhone }, `Изменил телефон родителя — ${student.name}`); }}
            />
          </div>
          <div className="field">
            <label>Адрес</label>
            <input
              value={address} onChange={(e) => setAddress(e.target.value)}
              onBlur={() => { if (address !== (student.address || "")) saveField({ address }, `Изменил адрес — ${student.name}`); }}
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Менеджер</label>
            <select
              value={manager}
              onChange={(e) => {
                const val = e.target.value;
                setManager(val);
                saveField({ manager: val }, `Изменил менеджера — ${student.name}: ${student.manager} → ${val}`);
              }}
            >
              {managers.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Сумма контракта (KGS)</label>
            <input
              type="number" className="crm-mono" value={contractAmount}
              onChange={(e) => setContractAmount(e.target.value)}
              onBlur={() => {
                const val = Number(contractAmount) || 0;
                const old = student.contractAmount || 0;
                if (val !== old) saveField({ contractAmount: val }, `Изменил сумму контракта — ${student.name}: ${fmt(old)} → ${fmt(val)}`);
              }}
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field" style={source === "Друг привёл" ? undefined : { gridColumn: "1 / -1" }}>
            <label>Откуда пришёл</label>
            <select
              value={source}
              onChange={(e) => {
                const val = e.target.value;
                setSource(val);
                saveField({ source: val }, `Изменил источник — ${student.name}: ${student.source || "—"} → ${val}`);
              }}
            >
              <option value="">— выберите —</option>
              {sources.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          {source === "Друг привёл" && (
            <div className="field">
              <label>Имя друга</label>
              <input
                value={referrerName} onChange={(e) => setReferrerName(e.target.value)}
                placeholder="Необязательно"
                onBlur={() => {
                  if (referrerName !== (student.referrerName || "")) saveField({ referrerName }, `Изменил имя друга — ${student.name}`);
                }}
              />
            </div>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 14 }}>
          Уровень: <b style={{ color: "var(--ink)" }}>{student.level}</b> · Группа: <b style={{ color: "var(--ink)" }}>{group ? group.name : "—"}</b>
          {student.status === "archived" && <span className="badge lost" style={{ marginLeft: 8 }}>в архиве</span>}
        </div>

        <div className="chart-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            <span>Оплата курса</span>
            <span className="crm-mono">{pct}%</span>
          </div>
          <div className="progress-track" style={{ height: 10 }}>
            <div className={`progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="student-amounts crm-mono" style={{ marginTop: 8, fontSize: 12 }}>
            <span>Оплачено: {fmt(paid)}</span>
            <span>{rem >= 0 ? `Остаток: ${fmt(rem)}` : `Переплата: ${fmt(-rem)}`}</span>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 0 }}>История платежей</div>
        <div className="chart-card" style={{ marginBottom: 14 }}>
          {(student.payments || []).length === 0 && <div className="empty-hint">Платежей пока нет</div>}
          {(student.payments || []).map((p) => (
            <div key={p.id} className="payment-row" style={p.id === editingPaymentId ? { background: "var(--primary-soft)", borderRadius: 6 } : undefined}>
              <span>
                {fmtDate(p.date)}{p.note ? ` · ${p.note}` : ""}{p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
                {p.courseDurationMonths > 1 ? ` · за ${formatMonthLabel(p.recognitionStartMonth)} (${p.courseDurationMonths} мес.)` : ""}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="crm-mono">{fmt(p.amount)}</span>
                {p.receiptPath && (
                  <button className="icon-btn" onClick={() => openReceipt(p)} title="Открыть чек">
                    <Paperclip size={11} /> Чек
                  </button>
                )}
                {session.role === "admin" && (
                  <button className="icon-btn" onClick={() => handleEditPayment(p)} title="Изменить платёж">
                    <Pencil size={11} /> Изменить
                  </button>
                )}
                {session.role === "admin" && (
                  <button className="icon-btn danger" onClick={() => handleDeletePayment(p)} title="Удалить платёж">
                    <Trash2 size={11} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
        {editingPaymentId && (
          <div className="warn-text" style={{ marginBottom: 8, color: "var(--primary-hover)" }}>
            <Pencil size={13} /> Редактирование платежа — изменения обновят существующую запись
          </div>
        )}
        <div className="form-grid" style={{ marginBottom: 6 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Сумма оплаты</label>
            <input
              type="number" className="crm-mono" placeholder="10000"
              value={newPaymentAmount} onChange={(e) => setNewPaymentAmount(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Способ оплаты</label>
            <select value={newPaymentMethod} onChange={(e) => setNewPaymentMethod(e.target.value)}>
              <option value="">— выберите —</option>
              {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Дата оплаты</label>
            <input
              type="date" className="crm-mono"
              value={newPaymentDate} onChange={(e) => setNewPaymentDate(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>За какой месяц</label>
            <input
              type="month" className="crm-mono"
              value={newPaymentRecognitionMonth} onChange={(e) => setNewPaymentRecognitionMonth(e.target.value)}
            />
          </div>
          {editingPaymentId && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Длительность курса (мес.)</label>
              <input
                type="number" min="1" className="crm-mono"
                value={newPaymentDuration} onChange={(e) => setNewPaymentDuration(e.target.value)}
              />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Чек (фото или PDF, необязательно)</label>
            <input
              type="file" accept="image/*,.pdf"
              onChange={(e) => setNewReceiptFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>
        <div style={{ marginBottom: 6, display: "flex", gap: 8 }}>
          <button
            className="btn-primary" onClick={submitPayment}
            disabled={!newPaymentAmount || !newPaymentMethod || uploadingReceipt}
          >
            {uploadingReceipt ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Wallet size={13} />}
            {uploadingReceipt ? "Сохраняем…" : editingPaymentId ? "Сохранить изменения" : "Добавить оплату"}
          </button>
          {editingPaymentId && (
            <button className="btn-secondary" onClick={resetPaymentForm}>Отмена</button>
          )}
        </div>
        {receiptError && (
          <div className="warn-text" style={{ marginBottom: 10 }}>
            <AlertTriangle size={13} /> {receiptError}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 20 }}>
          «Дата оплаты» — когда деньги реально получены (для кассы). «За какой месяц» — с какого месяца засчитывается выручка. Новая оплата всегда засчитывается за один месяц; если это оплата за несколько месяцев (пакет), укажите длительность позже через «Изменить» — админ сможет распределить сумму равными долями вперёд. Способ оплаты обязателен, чек — по желанию.
        </div>

        <div className="section-title">Перевести в другую группу</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <select
            style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5 }}
            value={transferTarget} onChange={(e) => setTransferTarget(e.target.value)}
          >
            {groups.map((g) => <option key={g.id} value={g.id}>{g.level} · {g.name}</option>)}
          </select>
          <button className="btn-secondary" onClick={submitTransfer}><Pencil size={13} /> Перевести</button>
        </div>

        <div className="section-title">Заметки</div>
        <div className="field" style={{ marginBottom: 20 }}>
          <textarea
            className="notes-field"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== (student.notes || "")) saveField({ notes }, `Изменил заметку — ${student.name}`);
            }}
            placeholder="Например: скидка 50%, платит папа, перенёс занятие…"
          />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {student.status === "active" ? (
            <button className="btn-secondary" onClick={() => archiveStudent(student.id)}>
              <Archive size={13} /> Архивировать
            </button>
          ) : (
            <button className="btn-secondary" onClick={() => restoreStudent(student.id)}>
              <ArchiveRestore size={13} /> Восстановить
            </button>
          )}
        </div>

        <div className="section-title">История изменений</div>
        <div className="chart-card">
          {studentLog.length === 0 && <div className="empty-hint">Изменений пока нет</div>}
          {studentLog.map((e) => (
            <div key={e.id} className="payment-row">
              <span>{fmtDateTime(e.timestamp)} · {e.actor}</span>
              <span style={{ fontSize: 11.5 }}>{e.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Per-manager analytics — used both as the manager's own "Моя аналитика"
   tab and, embedded in CfoView, as the admin's per-manager drill-down.
--------------------------------------------------------- */

function KpiCard({ icon, label, current, previous, format = (v) => fmt(v) }) {
  const change = pctChange(current, previous);
  return (
    <div className="kpi-card">
      <div className="kpi-label">{icon} {label}</div>
      <div className="kpi-value crm-mono">{format(current)}</div>
      {change !== null && (
        <div style={{ fontSize: 10.5, marginTop: 4, color: change >= 0 ? "var(--primary)" : "var(--danger)" }}>
          {change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(1)}% к прошлому месяцу
        </div>
      )}
    </div>
  );
}

function ManagerAnalyticsView({ managerName, students, groups, revenueAdjustments }) {
  const [month, setMonth] = useState(currentMonthKey());
  const prevMonth = shiftMonth(month, -1);
  const barColors = ["#24544A", "#3E7A6C", "#B0793B", "#C9A227", "#5B6B66", "#A23F31"];

  const groupsById = useMemo(() => {
    const map = {};
    for (const g of groups) map[g.id] = g;
    return map;
  }, [groups]);

  const managerStudents = useMemo(() => students.filter((s) => s.manager === managerName), [students, managerName]);
  const managerStudentIds = useMemo(() => new Set(managerStudents.map((s) => s.id)), [managerStudents]);
  const managerAdjustments = useMemo(
    () => revenueAdjustments.filter((a) => a.studentId && managerStudentIds.has(a.studentId)),
    [revenueAdjustments, managerStudentIds]
  );
  const activeManagerStudents = useMemo(() => managerStudents.filter((s) => s.status === "active"), [managerStudents]);

  const newThisMonth = useMemo(() => managerStudents.filter((s) => monthKeyOf(s.createdAt) === month), [managerStudents, month]);
  const newPrevMonth = useMemo(() => managerStudents.filter((s) => monthKeyOf(s.createdAt) === prevMonth), [managerStudents, prevMonth]);

  const recognizedRevenue = useMemo(
    () => getRecognizedRevenueForMonth(managerStudents, managerAdjustments, month),
    [managerStudents, managerAdjustments, month]
  );
  const recognizedRevenuePrev = useMemo(
    () => getRecognizedRevenueForMonth(managerStudents, managerAdjustments, prevMonth),
    [managerStudents, managerAdjustments, prevMonth]
  );
  const cashReceived = useMemo(() => getCashReceivedForMonth(managerStudents, month), [managerStudents, month]);
  const cashReceivedPrev = useMemo(() => getCashReceivedForMonth(managerStudents, prevMonth), [managerStudents, prevMonth]);

  const conversion = newThisMonth.length > 0
    ? (newThisMonth.filter((s) => remaining(s) <= 0).length / newThisMonth.length) * 100
    : 0;
  const conversionPrev = newPrevMonth.length > 0
    ? (newPrevMonth.filter((s) => remaining(s) <= 0).length / newPrevMonth.length) * 100
    : 0;

  const avgCheck = activeManagerStudents.length > 0 ? recognizedRevenue / activeManagerStudents.length : 0;
  const avgCheckPrev = activeManagerStudents.length > 0 ? recognizedRevenuePrev / activeManagerStudents.length : 0;

  const totalDebt = useMemo(
    () => activeManagerStudents.reduce((s, st) => s + Math.max(0, remaining(st)), 0),
    [activeManagerStudents]
  );

  const revenueTrend = useMemo(() => lastNMonths(6, month).map((m) => ({
    name: formatMonthShort(m),
    value: getRecognizedRevenueForMonth(managerStudents, managerAdjustments, m),
  })), [managerStudents, managerAdjustments, month]);

  const byLevel = useMemo(() => {
    const map = {};
    for (const s of activeManagerStudents) map[s.level] = (map[s.level] || 0) + 1;
    return LEVELS.map((level) => ({ name: level, value: map[level] || 0 })).filter((l) => l.value > 0);
  }, [activeManagerStudents]);

  const byGroup = useMemo(() => {
    const map = {};
    for (const s of activeManagerStudents) {
      const key = s.groupId || "—";
      if (!map[key]) map[key] = { count: 0, cash: 0 };
      map[key].count += 1;
    }
    for (const s of managerStudents) {
      const cashThisMonth = (s.payments || []).filter((p) => monthKeyOf(p.date) === month).reduce((sum, p) => sum + p.amount, 0);
      if (cashThisMonth > 0) {
        const key = s.groupId || "—";
        if (!map[key]) map[key] = { count: 0, cash: 0 };
        map[key].cash += cashThisMonth;
      }
    }
    return Object.entries(map)
      .map(([groupId, v]) => ({ groupId, name: groupsById[groupId] ? groupsById[groupId].name : "—", ...v }))
      .sort((a, b) => b.count - a.count);
  }, [managerStudents, activeManagerStudents, groupsById, month]);

  const monthlyStudents = useMemo(() => {
    return managerStudents
      .filter((s) => monthKeyOf(s.createdAt) === month || (s.payments || []).some((p) => monthKeyOf(p.date) === month))
      .map((s) => {
        const group = groupsById[s.groupId];
        const paymentThisMonth = (s.payments || []).filter((p) => monthKeyOf(p.date) === month).reduce((sum, p) => sum + p.amount, 0);
        return { ...s, groupName: group ? group.name : "—", paymentThisMonth };
      });
  }, [managerStudents, groupsById, month]);

  return (
    <>
      <div className="chart-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 20 }}>
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} title="Предыдущий месяц">
          <ArrowLeft size={13} />
        </button>
        <div className="crm-slab" style={{ fontSize: 16, fontWeight: 700, minWidth: 170, textAlign: "center" }}>
          {formatMonthLabel(month)}
        </div>
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} title="Следующий месяц">
          <ArrowLeft size={13} style={{ transform: "rotate(180deg)" }} />
        </button>
      </div>

      <div className="kpi-grid">
        <KpiCard icon={<UserPlus size={12} />} label="Новых студентов" current={newThisMonth.length} previous={newPrevMonth.length} format={(v) => String(v)} />
        <KpiCard icon={<TrendingUp size={12} />} label="Признанная выручка" current={recognizedRevenue} previous={recognizedRevenuePrev} />
        <KpiCard icon={<Wallet size={12} />} label="Получено оплат" current={cashReceived} previous={cashReceivedPrev} />
        <KpiCard icon={<Percent size={12} />} label="Конверсия (оплатили полностью)" current={conversion} previous={conversionPrev} format={(v) => `${v.toFixed(0)}%`} />
        <KpiCard icon={<Target size={12} />} label="Средний чек" current={avgCheck} previous={avgCheckPrev} />
        <div className="kpi-card">
          <div className="kpi-label"><Users size={12} /> Активных студентов всего</div>
          <div className="kpi-value crm-mono">{activeManagerStudents.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label"><AlertTriangle size={12} /> Долг студентов</div>
          <div className="kpi-value crm-mono">{fmt(totalDebt)}</div>
        </div>
      </div>

      <div className="two-col" style={{ marginBottom: 20 }}>
        <div className="chart-card">
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Признанная выручка — 6 месяцев</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={revenueTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9D4C3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={55} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {revenueTrend.map((_, i) => <Cell key={i} fill={barColors[i % barColors.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card">
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Студенты по уровням</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byLevel}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9D4C3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} width={30} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {byLevel.map((_, i) => <Cell key={i} fill={barColors[(i + 2) % barColors.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {byLevel.length === 0 && <div className="empty-hint">Нет активных студентов</div>}
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Разбивка по группам</div>
      <table className="ledger-table" style={{ marginBottom: 20 }}>
        <thead>
          <tr><th>Группа</th><th>Студентов</th><th>Оплат в {formatMonthLabel(month)}</th></tr>
        </thead>
        <tbody>
          {byGroup.map((g) => (
            <tr key={g.groupId}>
              <td data-label="Группа">{g.name}</td>
              <td className="crm-mono" data-label="Студентов">{g.count}</td>
              <td className="crm-mono" data-label={`Оплат в ${formatMonthLabel(month)}`}>{fmt(g.cash)}</td>
            </tr>
          ))}
          {byGroup.length === 0 && <tr><td colSpan={3} className="empty-hint">Нет активных студентов</td></tr>}
        </tbody>
      </table>

      <div className="section-title">Мои студенты за {formatMonthLabel(month)}</div>
      <table className="ledger-table">
        <thead>
          <tr><th>Студент</th><th>Уровень</th><th>Группа</th><th>Оплата в этом месяце</th><th>Статус</th></tr>
        </thead>
        <tbody>
          {monthlyStudents.map((s) => (
            <tr key={s.id}>
              <td data-label="Студент">{s.name}</td>
              <td data-label="Уровень">{s.level}</td>
              <td data-label="Группа">{s.groupName}</td>
              <td className="crm-mono" data-label="Оплата в этом месяце">{s.paymentThisMonth > 0 ? fmt(s.paymentThisMonth) : "—"}</td>
              <td data-label="Статус"><span className={`badge ${s.status === "archived" ? "lost" : "paid"}`}>{s.status === "archived" ? "в архиве" : "активен"}</span></td>
            </tr>
          ))}
          {monthlyStudents.length === 0 && <tr><td colSpan={5} className="empty-hint">Нет студентов за этот месяц</td></tr>}
        </tbody>
      </table>
    </>
  );
}

/* ---------------------------------------------------------
   CFO view — analytics dashboard
--------------------------------------------------------- */

function CfoView({
  groups, students, managers, teachers, newManagerName, setNewManagerName, addManager,
  newTeacherName, setNewTeacherName, addTeacher, sources, newSourceName, setNewSourceName, addSource,
  totalRevenue, totalDebt, activeStudentsCount, revenueAdjustments,
}) {
  const [viewManager, setViewManager] = useState("all");
  const activeStudents = useMemo(() => students.filter((s) => s.status === "active"), [students]);

  const byManager = useMemo(() => {
    return managers.map((m) => {
      const list = activeStudents.filter((s) => s.manager === m);
      return {
        name: m,
        count: list.length,
        paid: list.reduce((s, st) => s + totalPaid(st), 0),
        debt: list.reduce((s, st) => s + Math.max(0, remaining(st)), 0),
      };
    });
  }, [managers, activeStudents]);

  const byLevel = useMemo(() => {
    return LEVELS.map((level) => {
      const levelStudents = activeStudents.filter((s) => s.level === level);
      const levelGroups = groups.filter((g) => g.level === level);
      return {
        level,
        students: levelStudents.length,
        groups: levelGroups.length,
        revenue: levelStudents.reduce((s, st) => s + totalPaid(st), 0),
      };
    }).filter((l) => l.students > 0 || l.groups > 0);
  }, [groups, activeStudents]);

  const barColors = ["#24544A", "#3E7A6C", "#B0793B", "#C9A227", "#5B6B66", "#A23F31"];

  const revenueByManagerChart = byManager.map((m) => ({ name: m.name, value: m.paid }));
  const studentsByLevelChart = byLevel.map((l) => ({ name: l.level, value: l.students }));

  return (
    <>
      <div className="form-card" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ fontSize: 12, color: "var(--ink-soft)" }}>Показать аналитику менеджера:</label>
        <select value={viewManager} onChange={(e) => setViewManager(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="all">Все</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {viewManager !== "all" ? (
        <ManagerAnalyticsView
          managerName={viewManager}
          students={students}
          groups={groups}
          revenueAdjustments={revenueAdjustments}
        />
      ) : (
        <>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label"><Users size={12} /> Активных студентов</div>
          <div className="kpi-value crm-mono">{activeStudentsCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label"><TrendingUp size={12} /> Общая выручка</div>
          <div className="kpi-value crm-mono">{fmt(totalRevenue)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label"><Percent size={12} /> Долг активных студентов</div>
          <div className="kpi-value crm-mono">{fmt(totalDebt)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label"><Target size={12} /> Групп всего</div>
          <div className="kpi-value crm-mono">{groups.length}</div>
        </div>
      </div>

      <div className="two-col" style={{ marginBottom: 20 }}>
        <div className="chart-card">
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Оплачено по менеджерам</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={revenueByManagerChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9D4C3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {revenueByManagerChart.map((_, i) => <Cell key={i} fill={barColors[i % barColors.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card">
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Студентов по уровням</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={studentsByLevelChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9D4C3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9.5 }} />
              <YAxis tick={{ fontSize: 10 }} width={30} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {studentsByLevelChart.map((_, i) => <Cell key={i} fill={barColors[(i + 2) % barColors.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Отчёт по менеджерам</div>
      <table className="ledger-table" style={{ marginBottom: 20 }}>
        <thead>
          <tr><th>Менеджер</th><th>Студентов</th><th>Оплачено</th><th>Долг</th></tr>
        </thead>
        <tbody>
          {byManager.map((m) => (
            <tr key={m.name}>
              <td data-label="Менеджер">{m.name}</td>
              <td className="crm-mono" data-label="Студентов">{m.count}</td>
              <td className="crm-mono" data-label="Оплачено">{fmt(m.paid)}</td>
              <td className="crm-mono" data-label="Долг" style={{ color: m.debt > 0 ? "var(--danger)" : "var(--ink)" }}>{fmt(m.debt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-title">Отчёт по уровням</div>
      <table className="ledger-table" style={{ marginBottom: 20 }}>
        <thead>
          <tr><th>Уровень</th><th>Студентов</th><th>Групп</th><th>Выручка</th></tr>
        </thead>
        <tbody>
          {byLevel.map((l) => (
            <tr key={l.level}>
              <td data-label="Уровень">{l.level}</td>
              <td className="crm-mono" data-label="Студентов">{l.students}</td>
              <td className="crm-mono" data-label="Групп">{l.groups}</td>
              <td className="crm-mono" data-label="Выручка">{fmt(l.revenue)}</td>
            </tr>
          ))}
          {byLevel.length === 0 && <tr><td colSpan={4} className="empty-hint">Пока нет данных</td></tr>}
        </tbody>
      </table>

      <div className="section-title">Заполненность групп</div>
      <table className="ledger-table" style={{ marginBottom: 20 }}>
        <thead>
          <tr><th>Группа</th><th>Уровень</th><th>Преподаватель</th><th>Заполненность</th></tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const cnt = students.filter((s) => s.groupId === g.id && s.status === "active").length;
            const full = cnt >= g.maxSize;
            return (
              <tr key={g.id}>
                <td data-label="Группа">{g.name}{g.status === "archived" ? " (закрыта)" : ""}</td>
                <td data-label="Уровень">{g.level}</td>
                <td data-label="Преподаватель">{g.teacher}</td>
                <td data-label="Заполненность">
                  <span className={`badge ${full ? "full" : "other"}`}>{cnt} / {g.maxSize}</span>
                </td>
              </tr>
            );
          })}
          {groups.length === 0 && <tr><td colSpan={4} className="empty-hint">Групп пока нет</td></tr>}
        </tbody>
      </table>

      <div className="section-title">Менеджеры команды</div>
      <div className="chart-card">
        {managers.map((m) => <span key={m} className="manager-chip">{m}</span>)}
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <input
            style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5 }}
            placeholder="Новый менеджер"
            value={newManagerName}
            onChange={(e) => setNewManagerName(e.target.value)}
          />
          <button className="btn-primary" onClick={addManager}><Plus size={13} /> Добавить</button>
        </div>
      </div>

      <div className="section-title">Преподаватели</div>
      <div className="chart-card">
        {teachers.map((t) => <span key={t} className="manager-chip">{t}</span>)}
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <input
            style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5 }}
            placeholder="Новый преподаватель"
            value={newTeacherName}
            onChange={(e) => setNewTeacherName(e.target.value)}
          />
          <button className="btn-primary" onClick={addTeacher}><Plus size={13} /> Добавить</button>
        </div>
      </div>

      <div className="section-title">Источники студентов</div>
      <div className="chart-card">
        {sources.map((s) => <span key={s} className="manager-chip">{s}</span>)}
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <input
            style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5 }}
            placeholder="Новый источник"
            value={newSourceName}
            onChange={(e) => setNewSourceName(e.target.value)}
          />
          <button className="btn-primary" onClick={addSource}><Plus size={13} /> Добавить</button>
        </div>
      </div>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------
   Finance view — P&L: revenue recognition + expenses, admin only
--------------------------------------------------------- */

const formatMonthShort = (monthStr) => {
  const [y, m] = monthStr.split("-").map(Number);
  return `${(MONTH_NAMES[m - 1] || monthStr).slice(0, 3)} ${String(y).slice(2)}`;
};

function FinanceView({
  students, expenses, expenseCategories,
  newExpenseCategoryName, setNewExpenseCategoryName, addExpenseCategory,
  addExpense, saveExpenseEdit, deleteExpenseRow,
  revenueAdjustments, addRevenueAdjustment, deleteRevenueAdjustment,
}) {
  const [month, setMonth] = useState(currentMonthKey());
  const [showAddForm, setShowAddForm] = useState(false);
  const firstCategory = expenseCategories[0] || { name: "", group: EXPENSE_GROUPS[0].key };
  const [form, setForm] = useState({ group: firstCategory.group, category: firstCategory.name, amount: "", month: currentMonthKey(), note: "", isRecurring: false });
  const [editingRow, setEditingRow] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [newCategoryGroup, setNewCategoryGroup] = useState(EXPENSE_GROUPS[0].key);

  const [showAddRefund, setShowAddRefund] = useState(false);
  const [refundForm, setRefundForm] = useState({ studentId: "", amount: "", month: currentMonthKey(), note: "" });

  const barColors = ["#24544A", "#3E7A6C", "#B0793B", "#C9A227", "#5B6B66", "#A23F31"];

  const monthExpenses = useMemo(() => getEffectiveExpensesForMonth(expenses, month), [expenses, month]);
  const totalExpenses = useMemo(() => monthExpenses.reduce((s, e) => s + e.amount, 0), [monthExpenses]);
  const recognizedRevenue = useMemo(() => getRecognizedRevenueForMonth(students, revenueAdjustments, month), [students, revenueAdjustments, month]);
  const cashReceived = useMemo(() => getCashReceivedForMonth(students, month), [students, month]);
  const deferredDiff = cashReceived - recognizedRevenue;
  const netProfit = recognizedRevenue - totalExpenses;
  const margin = recognizedRevenue > 0 ? (netProfit / recognizedRevenue) * 100 : 0;
  const monthRefunds = useMemo(() => revenueAdjustments.filter((a) => a.month === month), [revenueAdjustments, month]);
  const studentsById = useMemo(() => {
    const map = {};
    for (const s of students) map[s.id] = s;
    return map;
  }, [students]);

  const byCategory = useMemo(() => {
    const map = {};
    for (const e of monthExpenses) map[e.category] = (map[e.category] || 0) + e.amount;
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [monthExpenses]);

  const trendData = useMemo(() => {
    return lastNMonths(12, month).map((m) => {
      const rev = getRecognizedRevenueForMonth(students, revenueAdjustments, m);
      const exp = getEffectiveExpensesForMonth(expenses, m).reduce((s, e) => s + e.amount, 0);
      return { name: formatMonthShort(m), value: rev - exp };
    });
  }, [students, expenses, revenueAdjustments, month]);

  const categoriesInGroup = (group) => expenseCategories.filter((c) => c.group === group);

  const openAddForm = () => {
    const first = expenseCategories[0] || { name: "", group: EXPENSE_GROUPS[0].key };
    setForm({ group: first.group, category: first.name, amount: "", month, note: "", isRecurring: false });
    setShowAddForm(true);
  };
  const submitExpense = () => {
    addExpense(form);
    setShowAddForm(false);
  };
  const changeFormGroup = (group) => {
    const first = categoriesInGroup(group)[0];
    setForm({ ...form, group, category: first ? first.name : "" });
  };

  const openAddRefund = () => {
    setRefundForm({ studentId: "", amount: "", month, note: "" });
    setShowAddRefund(true);
  };
  const submitRefund = () => {
    addRevenueAdjustment(refundForm);
    setShowAddRefund(false);
  };
  const handleDeleteRefund = (a) => {
    const who = a.studentId && studentsById[a.studentId] ? ` — ${studentsById[a.studentId].name}` : "";
    if (window.confirm(`Удалить возврат ${fmt(a.amount)}${who}?`)) deleteRevenueAdjustment(a.id);
  };

  const startEdit = (row) => {
    setEditingRow(row);
    setEditAmount(String(row.amount));
    setEditNote(row.note || "");
  };
  const confirmEdit = (asOverride) => {
    saveExpenseEdit(editingRow, { amount: editAmount, note: editNote }, month, asOverride);
    setEditingRow(null);
  };
  const handleDelete = (row) => {
    const msg = row._kind === "template"
      ? `Остановить повторяющийся расход «${row.category}» на все месяцы?`
      : `Удалить расход «${row.category}» (${fmt(row.amount)})?`;
    if (window.confirm(msg)) deleteExpenseRow(row);
  };

  return (
    <>
      <div className="chart-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 20 }}>
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} title="Предыдущий месяц">
          <ArrowLeft size={13} />
        </button>
        <div className="crm-slab" style={{ fontSize: 16, fontWeight: 700, minWidth: 170, textAlign: "center" }}>
          {formatMonthLabel(month)}
        </div>
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} title="Следующий месяц">
          <ArrowLeft size={13} style={{ transform: "rotate(180deg)" }} />
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label"><TrendingUp size={12} /> Признанная выручка</div>
          <div className="kpi-value crm-mono">{fmt(recognizedRevenue)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label"><Wallet size={12} /> Получено денег</div>
          <div className="kpi-value crm-mono">{fmt(cashReceived)}</div>
          {Math.abs(deferredDiff) >= 1 && (
            <div style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 4 }}>
              {deferredDiff > 0
                ? `Отложенная выручка: ${fmt(deferredDiff)} — деньги уже получены, признаются в будущих месяцах`
                : `Признано сверх кассы на ${fmt(-deferredDiff)} — доход от прошлых пакетных оплат`}
            </div>
          )}
        </div>
        <div className="kpi-card">
          <div className="kpi-label"><Target size={12} /> Расходы всего</div>
          <div className="kpi-value crm-mono">{fmt(totalExpenses)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label"><Percent size={12} /> Чистая прибыль</div>
          <div className="kpi-value crm-mono" style={{ color: netProfit >= 0 ? "var(--primary)" : "var(--danger)" }}>{fmt(netProfit)}</div>
          <div style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 4 }}>Маржа: {margin.toFixed(1)}%</div>
        </div>
      </div>

      <div className="two-col" style={{ marginBottom: 20 }}>
        <div className="chart-card">
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Расходы по категориям</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byCategory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9D4C3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={55} />
              <YAxis tick={{ fontSize: 10 }} width={50} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {byCategory.map((_, i) => <Cell key={i} fill={barColors[i % barColors.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {byCategory.length === 0 && <div className="empty-hint">Расходов за этот месяц нет</div>}
        </div>
        <div className="chart-card">
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Чистая прибыль — 12 месяцев</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9D4C3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9.5 }} />
              <YAxis tick={{ fontSize: 10 }} width={55} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {trendData.map((d, i) => <Cell key={i} fill={d.value >= 0 ? "#24544A" : "#A23F31"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Расходы за {formatMonthLabel(month)}</div>
      <div style={{ marginBottom: 12 }}>
        <button className="btn-primary" onClick={openAddForm}>
          <Plus size={14} /> Добавить расход
        </button>
      </div>

      {showAddForm && (
        <div className="form-card">
          <div className="form-grid">
            <div className="field">
              <label>Группа</label>
              <select value={form.group} onChange={(e) => changeFormGroup(e.target.value)}>
                {EXPENSE_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Категория</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categoriesInGroup(form.group).length === 0 && <option value="">— нет категорий —</option>}
                {categoriesInGroup(form.group).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Сумма (KGS)</label>
              <input type="number" className="crm-mono" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="50000" />
            </div>
            <div className="field">
              <label>Месяц</label>
              <input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Заметка</label>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Необязательно" />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginTop: 10 }}>
            <input type="checkbox" checked={form.isRecurring} onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })} />
            Повторять ежемесячно
          </label>
          <div style={{ marginTop: 10 }}>
            <button className="btn-primary" onClick={submitExpense} disabled={!form.amount || !form.category}>
              <Plus size={14} /> Сохранить расход
            </button>
          </div>
        </div>
      )}

      {editingRow && (
        <div className="form-card">
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Изменить: {editingRow.category}</div>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label>Сумма</label>
              <input type="number" className="crm-mono" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <div className="field">
              <label>Заметка</label>
              <input value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {editingRow._kind === "template" ? (
              <>
                <button className="btn-primary" onClick={() => confirmEdit(true)}>
                  Сохранить только для {formatMonthLabel(month)}
                </button>
                <button className="btn-secondary" onClick={() => confirmEdit(false)}>
                  Изменить шаблон (все месяцы)
                </button>
              </>
            ) : (
              <button className="btn-primary" onClick={() => confirmEdit(false)}>Сохранить</button>
            )}
            <button className="btn-secondary" onClick={() => setEditingRow(null)}>Отмена</button>
          </div>
        </div>
      )}

      <table className="ledger-table" style={{ marginBottom: 20 }}>
        <thead>
          <tr><th>Категория</th><th>Сумма</th><th>Заметка</th><th>Кто добавил</th><th>Тип</th><th></th></tr>
        </thead>
        <tbody>
          {monthExpenses.map((row) => (
            <tr key={`${row.id}-${row._kind}`}>
              <td data-label="Категория">{row.category}</td>
              <td className="crm-mono" data-label="Сумма">{fmt(row.amount)}</td>
              <td data-label="Заметка">{row.note || "—"}</td>
              <td data-label="Кто добавил">{row.createdBy || "—"}</td>
              <td data-label="Тип"><span className={`badge ${row._kind === "one-off" ? "other" : "paid"}`}>{row._kind === "one-off" ? "разовый" : "повторяющийся"}</span></td>
              <td>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button className="icon-btn" onClick={() => startEdit(row)} title="Изменить"><Pencil size={11} /></button>
                  <button className="icon-btn danger" onClick={() => handleDelete(row)} title="Удалить"><Trash2 size={11} /></button>
                </div>
              </td>
            </tr>
          ))}
          {monthExpenses.length === 0 && <tr><td colSpan={6} className="empty-hint">Расходов за этот месяц нет</td></tr>}
        </tbody>
      </table>

      <div className="section-title" style={{ marginTop: 0 }}>Возвраты за {formatMonthLabel(month)}</div>
      <div style={{ marginBottom: 12 }}>
        <button className="btn-secondary" onClick={openAddRefund}>
          <Plus size={14} /> Добавить возврат
        </button>
      </div>

      {showAddRefund && (
        <div className="form-card">
          <div className="form-grid">
            <div className="field">
              <label>Студент (необязательно)</label>
              <select value={refundForm.studentId} onChange={(e) => setRefundForm({ ...refundForm, studentId: e.target.value })}>
                <option value="">— не привязан —</option>
                {[...students].sort((a, b) => a.name.localeCompare(b.name, "ru")).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Сумма (KGS)</label>
              <input type="number" className="crm-mono" value={refundForm.amount} onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })} placeholder="10000" />
            </div>
            <div className="field">
              <label>Месяц</label>
              <input type="month" value={refundForm.month} onChange={(e) => setRefundForm({ ...refundForm, month: e.target.value })} />
            </div>
            <div className="field">
              <label>Заметка</label>
              <input value={refundForm.note} onChange={(e) => setRefundForm({ ...refundForm, note: e.target.value })} placeholder="Необязательно" />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn-primary" onClick={submitRefund} disabled={!refundForm.amount}>
              <Plus size={14} /> Сохранить возврат
            </button>
          </div>
        </div>
      )}

      <table className="ledger-table" style={{ marginBottom: 20 }}>
        <thead>
          <tr><th>Студент</th><th>Сумма</th><th>Заметка</th><th>Кто оформил</th><th></th></tr>
        </thead>
        <tbody>
          {monthRefunds.map((a) => (
            <tr key={a.id}>
              <td data-label="Студент">{a.studentId && studentsById[a.studentId] ? studentsById[a.studentId].name : "—"}</td>
              <td className="crm-mono" data-label="Сумма" style={{ color: "var(--danger)" }}>−{fmt(a.amount)}</td>
              <td data-label="Заметка">{a.note || "—"}</td>
              <td data-label="Кто оформил">{a.createdBy || "—"}</td>
              <td>
                <button className="icon-btn danger" onClick={() => handleDeleteRefund(a)} title="Удалить"><Trash2 size={11} /></button>
              </td>
            </tr>
          ))}
          {monthRefunds.length === 0 && <tr><td colSpan={5} className="empty-hint">Возвратов за этот месяц нет</td></tr>}
        </tbody>
      </table>

      <div className="section-title">Категории расходов</div>
      {EXPENSE_GROUPS.map((g) => (
        <div key={g.key} className="chart-card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{g.label}</div>
          {categoriesInGroup(g.key).map((c) => <span key={c.name} className="manager-chip">{c.name}</span>)}
          {categoriesInGroup(g.key).length === 0 && <div className="empty-hint">Категорий пока нет</div>}
        </div>
      ))}
      <div className="chart-card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Добавить категорию</div>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={newCategoryGroup} onChange={(e) => setNewCategoryGroup(e.target.value)} style={{ maxWidth: 220 }}>
            {EXPENSE_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
          <input
            style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5 }}
            placeholder="Новая категория"
            value={newExpenseCategoryName}
            onChange={(e) => setNewExpenseCategoryName(e.target.value)}
          />
          <button className="btn-primary" onClick={() => addExpenseCategory(newCategoryGroup)}><Plus size={13} /> Добавить</button>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------
   Activity log view — admin only
--------------------------------------------------------- */

function ActivityLogView({ activityLog, managers }) {
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    const list = filter === "all" ? activityLog : activityLog.filter((e) => e.actor === filter);
    return [...list].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [activityLog, filter]);

  return (
    <>
      <div className="form-card" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ fontSize: 12, color: "var(--ink-soft)" }}>Фильтр по менеджеру:</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="all">Все</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <table className="ledger-table">
        <thead>
          <tr><th>Дата / время</th><th>Кто сделал</th><th>Что сделал</th></tr>
        </thead>
        <tbody>
          {filtered.map((e) => (
            <tr key={e.id}>
              <td className="crm-mono" data-label="Дата / время">{fmtDateTime(e.timestamp)}</td>
              <td data-label="Кто сделал">{e.actor}</td>
              <td data-label="Что сделал">{e.action}</td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={3} className="empty-hint">Записей пока нет</td></tr>}
        </tbody>
      </table>
    </>
  );
}
