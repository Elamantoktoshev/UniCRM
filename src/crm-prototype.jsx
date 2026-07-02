import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Plus, Users, Target, TrendingUp, Percent, X, Loader2,
  ArrowLeft, Archive, ArchiveRestore, Pencil, Wallet, UserPlus, AlertTriangle, Check,
  LogOut, History, Shield, Trash2, Search,
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
const DEFAULT_TEACHERS = [
  "Aizat", "Asel", "Baiysh", "Green", "Ilyaz", "Madina",
  "Mr Baiysh", "Mr Green", "Mr Madina", "Ms Madina", "Ms Nurzhan",
  "Nargiza", "Nurzhan", "Yan", "mr,Yan",
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
   Стили (ledger / gradebook эстетика)
--------------------------------------------------------- */

const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

    .crm-root {
      --bg: #EEF1EA;
      --paper: #FBFAF6;
      --ink: #1F2E2C;
      --ink-soft: #5B6B66;
      --line: #D9D4C3;
      --primary: #24544A;
      --primary-soft: #DDE7DF;
      --amber: #B0793B;
      --amber-soft: #F3E3CC;
      --brick: #A23F31;
      --brick-soft: #F2DCD6;
      --gold: #C9A227;

      background: var(--bg);
      color: var(--ink);
      font-family: 'Inter', sans-serif;
      min-height: 100%;
      width: 100%;
      display: flex;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--line);
    }
    .crm-root * { box-sizing: border-box; }
    .crm-mono { font-family: 'IBM Plex Mono', monospace; }
    .crm-slab { font-family: 'Zilla Slab', serif; }

    /* Sidebar - binder tabs */
    .crm-sidebar {
      width: 208px;
      flex-shrink: 0;
      background: var(--primary);
      color: #EFEFE8;
      padding: 22px 0 16px;
      display: flex;
      flex-direction: column;
    }
    .crm-brand {
      padding: 0 20px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.15);
      margin-bottom: 14px;
    }
    .crm-brand-title { font-size: 17px; font-weight: 700; letter-spacing: 0.2px; }
    .crm-brand-sub { font-size: 11px; opacity: 0.65; margin-top: 3px; letter-spacing: 0.4px; text-transform: uppercase; }

    .crm-tab {
      display: flex; align-items: center; gap: 9px;
      padding: 11px 20px;
      font-size: 13.5px; font-weight: 500;
      cursor: pointer; border: none; background: transparent; color: #EFEFE8;
      opacity: 0.72; text-align: left; width: 100%;
      border-left: 3px solid transparent;
      transition: all .15s ease;
    }
    .crm-tab:hover { opacity: 0.95; background: rgba(255,255,255,0.06); }
    .crm-tab.active {
      opacity: 1; background: var(--paper); color: var(--primary);
      border-radius: 0 8px 8px 0; border-left: 3px solid var(--gold);
      font-weight: 600;
    }

    .crm-main { flex: 1; min-width: 0; background: var(--paper); display: flex; flex-direction: column; max-height: 720px; }
    .crm-topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 24px; border-bottom: 1px solid var(--line);
    }
    .crm-h1 { font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .crm-content { padding: 20px 24px; overflow-y: auto; flex: 1; }

    /* KPI cards */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .kpi-card { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
    .kpi-label { font-size: 11px; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px; display:flex; align-items:center; gap:6px; }
    .kpi-value { font-size: 20px; font-weight: 600; }

    .board { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 10px; }

    .icon-btn {
      border: 1px solid var(--line); background: var(--paper); border-radius: 5px;
      padding: 3px 6px; cursor: pointer; display: flex; align-items: center; gap: 3px;
      font-size: 10.5px; color: var(--ink);
    }
    .icon-btn:hover { background: var(--primary-soft); border-color: var(--primary); }
    .icon-btn.danger:hover { background: var(--brick-soft); border-color: var(--brick); color: var(--brick); }

    /* Form */
    .form-card { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; }
    .form-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; align-items: end; }
    .field label { font-size: 11px; color: var(--ink-soft); display: block; margin-bottom: 4px; }
    .field input, .field select {
      width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px;
      font-size: 12.5px; background: var(--paper); font-family: inherit;
    }
    textarea.notes-field {
      width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px;
      font-size: 12.5px; background: var(--paper); font-family: inherit; resize: vertical;
      min-height: 60px;
    }
    .group-title-row { display: flex; align-items: center; gap: 8px; }
    .rename-form { display: flex; align-items: center; gap: 6px; }
    .rename-form input {
      font-size: 19px; font-weight: 700; font-family: 'Zilla Slab', serif;
      padding: 3px 8px; border: 1px solid var(--primary); border-radius: 6px; background: var(--paper);
    }
    .teacher-select {
      border: 1px solid var(--line); background: var(--paper); border-radius: 5px;
      padding: 2px 6px; font-size: 11.5px; color: var(--ink-soft); font-family: inherit;
    }
    .btn-primary {
      background: var(--primary); color: white; border: none; border-radius: 6px;
      padding: 8px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; gap: 6px; white-space: nowrap;
    }
    .btn-primary:hover { background: #1b433b; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: var(--paper); color: var(--ink); border: 1px solid var(--line); border-radius: 6px;
      padding: 8px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; gap: 6px; white-space: nowrap;
    }
    .btn-secondary:hover { background: var(--primary-soft); border-color: var(--primary); }

    /* Table */
    .ledger-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .ledger-table th {
      text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.3px;
      color: var(--ink-soft); padding: 6px 10px; border-bottom: 2px solid var(--primary);
    }
    .ledger-table td { padding: 8px 10px; border-bottom: 1px solid var(--line); }
    .ledger-table tr:hover td { background: var(--bg); }
    .badge { padding: 2px 8px; border-radius: 20px; font-size: 10.5px; font-weight: 600; }
    .badge.paid { background: var(--primary-soft); color: var(--primary); }
    .badge.lost { background: var(--brick-soft); color: var(--brick); }
    .badge.other { background: var(--amber-soft); color: var(--amber); }
    .badge.full { background: var(--brick-soft); color: var(--brick); }

    .section-title { font-size: 13px; font-weight: 700; margin: 22px 0 10px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--ink-soft); }
    .chart-card { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

    .manager-chip {
      display: inline-flex; align-items: center; gap: 6px; background: var(--bg);
      border: 1px solid var(--line); border-radius: 20px; padding: 5px 10px 5px 12px; font-size: 12px; margin: 3px 5px 3px 0;
    }

    .empty-hint { color: var(--ink-soft); font-size: 11.5px; text-align: center; padding: 20px 0; }
    .loading-wrap { display:flex; align-items:center; justify-content:center; height: 400px; color: var(--ink-soft); gap: 8px; font-size: 13px; }

    /* Filter chips */
    .chip-row { display: flex; gap: 8px; margin-bottom: 16px; }
    .chip {
      border: 1px solid var(--line); background: var(--paper); border-radius: 20px;
      padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--ink-soft);
    }
    .chip.active { background: var(--primary); color: white; border-color: var(--primary); }

    /* Group cards */
    .group-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px;
      padding: 14px 16px; cursor: pointer; transition: all .15s ease;
    }
    .group-card:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .group-card.archived { opacity: 0.6; }
    .group-card-name { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
    .group-card-meta { font-size: 11.5px; color: var(--ink-soft); margin-bottom: 10px; }
    .group-card-count { font-size: 13px; font-weight: 600; }
    .group-card-count.full { color: var(--brick); }
    .group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-bottom: 24px; }

    /* Student cards */
    .student-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
    .student-card {
      background: var(--paper); border: 1px solid var(--line); border-radius: 8px;
      padding: 11px 13px; cursor: pointer; transition: all .15s ease;
    }
    .student-card:hover { border-color: var(--primary); }
    .student-card.archived { opacity: 0.55; }
    .student-name { font-weight: 600; font-size: 13px; margin-bottom: 3px; }
    .student-meta { font-size: 11px; color: var(--ink-soft); margin-bottom: 8px; }
    .progress-track { background: var(--primary-soft); border-radius: 20px; height: 7px; overflow: hidden; margin-bottom: 5px; }
    .progress-fill { height: 100%; border-radius: 20px; background: var(--primary); }
    .progress-fill.over { background: var(--brick); }
    .progress-fill.zero { background: var(--amber); }
    .student-amounts { font-size: 11px; display: flex; justify-content: space-between; }

    /* Modal */
    .modal-overlay {
      position: absolute; inset: 0; background: rgba(31,46,44,0.45);
      display: flex; align-items: center; justify-content: center; z-index: 50;
      padding: 20px;
    }
    .modal-panel {
      background: var(--paper); border-radius: 12px; border: 1px solid var(--line);
      width: 100%; max-width: 520px; max-height: 100%; overflow-y: auto;
      padding: 20px 22px;
    }
    .modal-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .modal-title { font-size: 16px; font-weight: 700; }
    .modal-close { border: none; background: transparent; cursor: pointer; color: var(--ink-soft); padding: 4px; }
    .modal-close:hover { color: var(--ink); }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .payment-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
    .payment-row:last-child { border-bottom: none; }
    .warn-text { color: var(--brick); font-size: 11.5px; display: flex; align-items: center; gap: 5px; margin-top: 6px; }

    /* Global search */
    .search-wrap { position: relative; }
    .search-panel {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
      background: var(--paper); border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.14); padding: 10px; width: 320px;
    }
    .search-input {
      width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px;
      font-size: 12.5px; background: var(--bg); font-family: inherit;
    }
    .search-results { margin-top: 8px; max-height: 260px; overflow-y: auto; }
    .search-result-row { padding: 8px 9px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
    .search-result-row:hover { background: var(--primary-soft); }
    .search-result-name { font-weight: 600; margin-bottom: 2px; }
    .search-result-meta { font-size: 11px; color: var(--ink-soft); }

    /* Login screen */
    .login-root { align-items: center; justify-content: center; padding: 40px; }
    .login-card { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 28px 30px; width: 100%; max-width: 420px; }
    .login-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .login-sub { font-size: 12px; color: var(--ink-soft); margin-bottom: 22px; }
    .role-option {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
      padding: 12px 14px; margin-bottom: 10px; cursor: pointer; font-size: 13px; font-weight: 600;
      color: var(--ink);
    }
    .role-option:hover { border-color: var(--primary); background: var(--primary-soft); }

    /* Sidebar session info */
    .session-info { padding: 0 20px; font-size: 11px; opacity: 0.75; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
    .logout-btn {
      display: flex; align-items: center; gap: 8px; width: calc(100% - 24px); margin: 0 12px 10px;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
      color: #EFEFE8; font-size: 12px; padding: 8px 10px; cursor: pointer;
    }
    .logout-btn:hover { background: rgba(162,63,49,0.35); border-color: var(--brick); }
  `}</style>
);

/* ---------------------------------------------------------
   Supabase data layer

   Groups/students/payments/managers/teachers/activity log all live in
   Supabase now (shared across everyone). Only the session — "who am I in
   this browser" — stays in localStorage, since it's per-device, not
   shared app data.
--------------------------------------------------------- */

const SESSION_KEY = "crm-session";
const ACTIVITY_LOG_LIMIT = 500;

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    console.error("session save failed", e);
  }
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

const rowToGroup = (r) => ({
  id: r.id, level: r.level, name: r.name, teacher: r.teacher, time: r.time,
  maxSize: r.max_size, status: r.status, notes: r.notes || "",
});
const rowToStudent = (r, payments) => ({
  id: r.id, name: r.name, phone: r.phone || "", level: r.level, groupId: r.group_id,
  manager: r.manager || "", contractAmount: Number(r.contract_amount) || 0,
  payments, status: r.status, notes: r.notes || "",
});
const rowToPayment = (r) => ({ id: r.id, amount: Number(r.amount) || 0, date: r.date, note: r.note || "" });
const rowToActivity = (r) => ({
  id: r.id, timestamp: r.timestamp, actor: r.actor, action: r.action,
  entityType: r.entity_type, entityId: r.entity_id,
});

const GROUP_PATCH_MAP = { maxSize: "max_size" };
const STUDENT_PATCH_MAP = { groupId: "group_id", contractAmount: "contract_amount" };
function toRowPatch(patch, map) {
  const row = {};
  for (const [k, v] of Object.entries(patch)) row[map[k] || k] = v;
  return row;
}

async function loadAll() {
  const [groupsRes, studentsRes, paymentsRes, managersRes, teachersRes, activityRes] = await Promise.all([
    supabase.from("groups").select("*").order("created_at", { ascending: true }),
    supabase.from("students").select("*").order("created_at", { ascending: true }),
    supabase.from("payments").select("*"),
    supabase.from("managers").select("name").order("name", { ascending: true }),
    supabase.from("teachers").select("name").order("name", { ascending: true }),
    supabase.from("activity_log").select("*").order("timestamp", { ascending: false }).limit(ACTIVITY_LOG_LIMIT),
  ]);

  for (const res of [groupsRes, studentsRes, paymentsRes, managersRes, teachersRes, activityRes]) {
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
    activityLog: (activityRes.data || []).map(rowToActivity),
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
  });
  if (error) console.error("insert payment failed", error);
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
async function dbInsertActivity(entry) {
  const { error } = await supabase.from("activity_log").insert({
    id: entry.id, timestamp: entry.timestamp, actor: entry.actor, action: entry.action,
    entity_type: entry.entityType, entity_id: entry.entityId,
  });
  if (error) console.error("insert activity failed", error);
}

/* ---------------------------------------------------------
   Main component
--------------------------------------------------------- */

export default function CRM() {
  const [session, setSession] = useState(loadSession);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("groups");
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [managers, setManagers] = useState(DEFAULT_MANAGERS);
  const [teachers, setTeachers] = useState(DEFAULT_TEACHERS);
  const [activityLog, setActivityLog] = useState([]);

  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [studentFilter, setStudentFilter] = useState("active");
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [showNewStudentForm, setShowNewStudentForm] = useState(false);
  const [newManagerName, setNewManagerName] = useState("");
  const [newTeacherName, setNewTeacherName] = useState("");

  useEffect(() => {
    (async () => {
      const { groups, students, managers, teachers, activityLog } = await loadAll();
      setGroups(groups);
      setStudents(students);
      setManagers(managers.length ? managers : DEFAULT_MANAGERS);
      setTeachers(teachers.length ? teachers : DEFAULT_TEACHERS);
      setActivityLog(activityLog);
      setLoading(false);
    })();
  }, []);

  const login = (newSession) => {
    setSession(newSession);
    saveSession(newSession);
  };
  const logout = () => {
    setSession(null);
    clearSession();
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

  const addPayment = (studentId, amount) => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    const student = students.find((s) => s.id === studentId);
    const payment = { id: uid(), amount: amt, date: new Date().toISOString().slice(0, 10), note: "Оплата" };
    setStudents(
      students.map((s) => (s.id === studentId ? { ...s, payments: [...(s.payments || []), payment] } : s))
    );
    dbInsertPayment(payment, studentId);
    if (student) {
      logActivity({ action: `Добавил оплату ${fmt(amt)} — ${student.name}`, entityType: "student", entityId: studentId });
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
  };

  const addTeacher = () => {
    const n = newTeacherName.trim();
    if (!n || teachers.includes(n)) return;
    setTeachers([...teachers, n]);
    dbInsertTeacher(n);
    setNewTeacherName("");
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

  if (!session) {
    return <LoginScreen managers={managers} onLogin={login} />;
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

  return (
    <div className="crm-root" style={{ height: 720, position: "relative" }}>
      <Styles />

      {/* Sidebar */}
      <div className="crm-sidebar">
        <div className="crm-brand">
          <div className="crm-brand-title crm-slab">Osh Language CRM</div>
          <div className="crm-brand-sub">Учёт студентов</div>
        </div>
        <button
          className={`crm-tab ${view === "groups" ? "active" : ""}`}
          onClick={() => { setView("groups"); setSelectedGroupId(null); }}
        >
          <Users size={15} /> Группы
        </button>
        {session.role === "admin" && (
          <>
            <button className={`crm-tab ${view === "cfo" ? "active" : ""}`} onClick={() => setView("cfo")}>
              <TrendingUp size={15} /> CFO — аналитика
            </button>
            <button className={`crm-tab ${view === "activity" ? "active" : ""}`} onClick={() => setView("activity")}>
              <History size={15} /> Журнал изменений
            </button>
          </>
        )}
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
                totalRevenue={totalRevenue}
                totalDebt={totalDebt}
                activeStudentsCount={activeStudentsCount}
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
          activityLog={activityLog}
          session={session}
          onClose={() => setSelectedStudentId(null)}
          updateStudent={updateStudent}
          addPayment={addPayment}
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
   Login screen — simple role picker, no real auth
--------------------------------------------------------- */

function LoginScreen({ managers, onLogin }) {
  const [step, setStep] = useState(null); // null | "admin" | "manager"
  const [adminName, setAdminName] = useState("Эламан");
  const [managerName, setManagerName] = useState(managers[0] || "");

  return (
    <div className="crm-root login-root" style={{ height: 500 }}>
      <Styles />
      <div className="login-card">
        <div className="login-title crm-slab">Osh Language CRM</div>
        <div className="login-sub">Выберите, кто вы, чтобы продолжить</div>

        {step === null && (
          <>
            <button className="role-option" onClick={() => setStep("admin")}>
              <Shield size={16} /> Я супер-админ (CFO)
            </button>
            <button className="role-option" onClick={() => setStep("manager")}>
              <Users size={16} /> Я менеджер
            </button>
          </>
        )}

        {step === "admin" && (
          <>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Ваше имя</label>
              <input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Эламан" />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" onClick={() => setStep(null)}>Назад</button>
              <button
                className="btn-primary"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => onLogin({ role: "admin", name: adminName.trim() || "Эламан" })}
              >
                Войти как супер-админ
              </button>
            </div>
          </>
        )}

        {step === "manager" && (
          <>
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Кто вы</label>
              <select value={managerName} onChange={(e) => setManagerName(e.target.value)}>
                {managers.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" onClick={() => setStep(null)}>Назад</button>
              <button
                className="btn-primary"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => onLogin({ role: "manager", name: managerName })}
                disabled={!managerName}
              >
                Войти как менеджер
              </button>
            </div>
          </>
        )}
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
        return (
          <div key={level} style={{ marginBottom: 8 }}>
            <div className="section-title">{level}</div>
            <div className="group-grid">
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
        );
      })}
      {groups.length === 0 && <div className="empty-hint">Групп пока нет — создайте первую</div>}
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
                <span style={{ color: rem > 0 ? "var(--ink-soft)" : rem < 0 ? "var(--brick)" : "var(--primary)" }}>
                  {rem > 0 ? `ост. ${fmt(rem)}` : rem < 0 ? `перепл. ${fmt(-rem)}` : "оплачено"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {groupStudents.length === 0 && (
        <div className="empty-hint">
          {studentFilter === "active" ? "В группе пока нет активных студентов" : "В архиве этой группы никого нет"}
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------
   Student profile modal
--------------------------------------------------------- */

function StudentModal({ student, groups, managers, activityLog, session, onClose, updateStudent, addPayment, deletePayment, transferStudent, archiveStudent, restoreStudent }) {
  const [name, setName] = useState(student.name);
  const [phone, setPhone] = useState(student.phone);
  const [manager, setManager] = useState(student.manager);
  const [contractAmount, setContractAmount] = useState(String(student.contractAmount || 0));
  const [transferTarget, setTransferTarget] = useState(student.groupId);
  const [newPaymentAmount, setNewPaymentAmount] = useState("");
  const [notes, setNotes] = useState(student.notes || "");

  const studentLog = useMemo(
    () => activityLog.filter((e) => e.entityId === student.id).slice(0, 8),
    [activityLog, student.id]
  );

  useEffect(() => {
    setName(student.name);
    setPhone(student.phone);
    setManager(student.manager);
    setContractAmount(String(student.contractAmount || 0));
    setTransferTarget(student.groupId);
    setNotes(student.notes || "");
  }, [student.id]);

  const group = groups.find((g) => g.id === student.groupId);
  const paid = totalPaid(student);
  const rem = remaining(student);
  const pct = student.contractAmount > 0 ? Math.min(100, Math.round((paid / student.contractAmount) * 100)) : 0;
  const fillClass = rem < 0 ? "over" : paid === 0 ? "zero" : "";

  const saveField = (patch, actionLabel) => updateStudent(student.id, patch, actionLabel);

  const submitPayment = () => {
    addPayment(student.id, newPaymentAmount);
    setNewPaymentAmount("");
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
        <div className="chart-card" style={{ marginBottom: 10 }}>
          {(student.payments || []).length === 0 && <div className="empty-hint">Платежей пока нет</div>}
          {(student.payments || []).map((p) => (
            <div key={p.id} className="payment-row">
              <span>{fmtDate(p.date)}{p.note ? ` · ${p.note}` : ""}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="crm-mono">{fmt(p.amount)}</span>
                {session.role === "admin" && (
                  <button className="icon-btn danger" onClick={() => handleDeletePayment(p)} title="Удалить платёж">
                    <Trash2 size={11} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input
            type="number" className="crm-mono" placeholder="Сумма оплаты"
            style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5 }}
            value={newPaymentAmount} onChange={(e) => setNewPaymentAmount(e.target.value)}
          />
          <button className="btn-primary" onClick={submitPayment} disabled={!newPaymentAmount}>
            <Wallet size={13} /> Добавить оплату
          </button>
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
   CFO view — analytics dashboard
--------------------------------------------------------- */

function CfoView({
  groups, students, managers, teachers, newManagerName, setNewManagerName, addManager,
  newTeacherName, setNewTeacherName, addTeacher, totalRevenue, totalDebt, activeStudentsCount,
}) {
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
              <td>{m.name}</td>
              <td className="crm-mono">{m.count}</td>
              <td className="crm-mono">{fmt(m.paid)}</td>
              <td className="crm-mono" style={{ color: m.debt > 0 ? "var(--brick)" : "var(--ink)" }}>{fmt(m.debt)}</td>
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
              <td>{l.level}</td>
              <td className="crm-mono">{l.students}</td>
              <td className="crm-mono">{l.groups}</td>
              <td className="crm-mono">{fmt(l.revenue)}</td>
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
                <td>{g.name}{g.status === "archived" ? " (закрыта)" : ""}</td>
                <td>{g.level}</td>
                <td>{g.teacher}</td>
                <td>
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
              <td className="crm-mono">{fmtDateTime(e.timestamp)}</td>
              <td>{e.actor}</td>
              <td>{e.action}</td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={3} className="empty-hint">Записей пока нет</td></tr>}
        </tbody>
      </table>
    </>
  );
}
