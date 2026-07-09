// One-off import: merge students/payments from "Копия_Intensive.xlsx" into
// the existing Supabase data, without duplicating students or payments that
// are already there. See the write-up handed to the user for the exact
// business rules this implements (multi-month vs single-column payment
// splitting, manager/group matching, dedup keys, etc).
//
// Usage:
//   node scripts/import_intensive.mjs            -> dry run only, writes a report, touches nothing
//   node scripts/import_intensive.mjs --apply     -> performs the real Supabase writes
//
// Requires .env with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (same file the app uses).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

// ---------------------------------------------------------------------
// .env (plain parse — this is a standalone Node script, not Vite)
// ---------------------------------------------------------------------
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  const text = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
const SHEET_LEVEL_MAP = {
  Beginner: "Beginner",
  Elementary: "Elementary",
  "Pre-Inter": "Pre-Intermediate",
  Inter: "Intermediate",
  Upper: "Upper-Intermediate",
  IELTS: "IELTS Prep",
};
// "individual" sheet's own sub-blocks are labeled by level, not by class —
// map their (typo'd) labels to the same canonical level names.
const INDIVIDUAL_BLOCK_LEVEL_MAP = {
  bedinner: "Beginner",
  beginner: "Beginner",
  "pre-inter": "Pre-Intermediate",
  inter: "Intermediate",
  upper: "Upper-Intermediate",
  ielts: "IELTS Prep",
};

const MONTH_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MONTH_RU_LABEL = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const DEFAULT_YEAR = 2026; // the whole workbook is this summer's intensive term

const MANAGER_ALIASES = {
  "диана": "Диана", "венера": "Венера", "алия": "Алия", "allia": "Алия",
  "эламан": "Эламан", "анжелика": "Анжелика", "анжелика ": "Анжелика",
};
const KNOWN_TEACHERS = [
  "Aizat", "Asel", "Baiysh", "Green", "Ilyaz", "Madina",
  "Mr Baiysh", "Mr Green", "Mr Madina", "Ms Madina", "Ms Nurzhan",
  "Nargiza", "Nurzhan", "Yan", "mr,Yan",
];

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
function cleanStr(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}
// Zero-width space/joiners, word joiner, LTR/RTL marks, BOM.
const INVISIBLE_CHARS_RE = /[​-‏⁠﻿]/g;
function cleanName(v) {
  let s = cleanStr(v).replace(INVISIBLE_CHARS_RE, "");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/^\d+\.\s*/, ""); // strip leading "3. "
  return s.trim();
}
function normalizeKey(v) {
  return cleanStr(v).toLowerCase().replace(/\s+/g, " ").trim();
}
function normalizePhone(v) {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  const firstSegment = s.split("/")[0];
  const digits = (firstSegment.match(/\d+/g) || []).join("");
  return digits;
}
function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
function excelSerialToISODate(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function parseDateOfSignCell(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return excelSerialToISODate(v);
  const s = String(v).trim();
  // formats seen: "29.05,2026", "13.07.2026", "29.06,2026"
  const m = s.match(/(\d{1,2})[.,](\d{1,2})[.,](\d{4})/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}
function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}
function monthLabel(year, month) {
  return `${MONTH_RU_LABEL[month]} ${year}`;
}

// Looks for "СТАРТ 02,06,2026" / "старт 29.06.2026" / "start: 13.07.2026" —
// requires a 4-digit year so it never confuses a "Time: start 10:30-12:00"
// phrase (no year there) for a start date.
function parseStartMonth(blockText) {
  const m = blockText.match(/(?:старт|start)\D{0,3}(\d{1,2})[.,](\d{1,2})[.,](\d{4})/i);
  if (!m) return null;
  const [, , mm, yyyy] = m;
  return { year: Number(yyyy), month: Number(mm) };
}
function parseTeacher(blockText) {
  const m = blockText.match(/Teacher:\s*([^\n]*?)\s*(?:СТАРТ|старт|start|з?\s*этаж|\d|\(|$)/i);
  if (!m) return "";
  let t = m[1].trim().replace(/^-+/, "").trim();
  return t;
}
function parseTime(blockText) {
  const m = blockText.match(/Time:\s*([^\n]*?)\s*(?:class|Teacher|Day|$)/i);
  if (!m) return "";
  return m[1].trim();
}
function parseMorningEvening(blockText) {
  const t = blockText.toLowerCase();
  if (t.includes("morning") || t.includes("утро")) return "Утро";
  if (t.includes("evening") || t.includes("вечер")) return "Вечер";
  return "";
}
// "ГРУППА ЗАКРЫТА" / "ГРУППА ЖАБЫК" (ru/ky for "group closed") can appear
// anywhere else in the block-header row (a separate cell from the
// "Grpoup: ..." descriptor cell), so this scans the whole row, not just c0.
function rowHasClosedFlag(row) {
  return row.some((c) => {
    const s = normalizeKey(c);
    return s.includes("закрыта") || s.includes("жабык");
  });
}
function findManagerInRow(row, fromCol) {
  for (let c = fromCol; c < row.length; c++) {
    const key = normalizeKey(row[c]);
    if (key && MANAGER_ALIASES[key]) return MANAGER_ALIASES[key];
  }
  return "";
}
function matchTeacherCasing(raw) {
  const norm = normalizeKey(raw);
  const found = KNOWN_TEACHERS.find((t) => normalizeKey(t) === norm);
  return found || cleanStr(raw);
}

// ---------------------------------------------------------------------
// Header row detection: scan a few rows after the block marker for the
// row that actually contains "Date of sign" / "Contract" labels — some
// blocks have off-by-one glitches (e.g. col0 holds "1" instead of "N").
// ---------------------------------------------------------------------
function findHeaderRow(rows, blockIdx) {
  for (let i = blockIdx + 1; i <= Math.min(blockIdx + 4, rows.length - 1); i++) {
    const row = rows[i] || [];
    const norms = row.map(normalizeKey);
    if (norms.includes("date of sign") || norms.includes("contract")) {
      return { rowIdx: i, row };
    }
  }
  return null;
}
function buildColumnMap(headerRow) {
  const map = { name: -1, phone: -1, dateOfSign: -1, contract: -1, bron: -1 };
  const monthCols = [];
  headerRow.forEach((cell, idx) => {
    const norm = normalizeKey(cell);
    if (!norm) return;
    if (norm === "date of sign") map.dateOfSign = idx;
    else if (norm === "contract") map.contract = idx;
    else if (norm.includes("name")) map.name = idx;
    else if (norm.includes("phone")) map.phone = idx;
    else if (norm === "bron") map.bron = idx;
    else if (MONTH_EN[norm]) monthCols.push({ col: idx, month: MONTH_EN[norm] });
  });
  // Some blocks blank out the "Name / Surname" header (just spaces) — it's
  // always the column immediately between Contract and Phone number, so
  // fall back to that position instead of dropping the whole block.
  if (map.name === -1 && map.contract !== -1 && map.phone !== -1 && map.phone === map.contract + 2) {
    map.name = map.contract + 1;
  }
  return { map, monthCols };
}

// ---------------------------------------------------------------------
// Parse one workbook sheet into a flat list of { level, group, student, payments, warnings }
// ---------------------------------------------------------------------
function parseSheet(sheetName, rows, level, isIndividualSheet) {
  const results = [];
  const warnings = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const c0 = row[0];
    const rowText = row.filter((c) => typeof c === "string").join(" ");
    const isBlockRow = (typeof c0 === "string" && c0.toLowerCase().includes("grpoup")) ||
      rowText.toLowerCase().includes("grpoup:");
    if (!isBlockRow) continue;

    // The "Grpoup: ... Time: ... Teacher: ..." descriptor always lives in a
    // single cell (c0, or whichever cell contained "grpoup:"); other cells
    // in this same row hold unrelated stray values (group total, "ГРУППА
    // ЗАКРЫТА" flag) that must NOT leak into the teacher/time regex parsing.
    const blockCell = typeof c0 === "string" && c0.toLowerCase().includes("grpoup")
      ? c0
      : (row.find((c) => typeof c === "string" && c.toLowerCase().includes("grpoup:")) || "");
    const blockText = String(blockCell);
    const isClosed = rowHasClosedFlag(row);
    let blockLevel = level;
    if (isIndividualSheet) {
      const m = blockText.match(/grpoup:\s*([a-zA-Zа-яА-Я-]+)/i);
      const label = m ? normalizeKey(m[1]) : "";
      blockLevel = INDIVIDUAL_BLOCK_LEVEL_MAP[label] || null;
      if (!blockLevel) {
        warnings.push(`[${sheetName}] row ${i}: unrecognized individual block label "${m ? m[1] : blockText}", skipped`);
        continue;
      }
    }

    const teacherRaw = parseTeacher(blockText);
    const teacher = isIndividualSheet ? "-" : (matchTeacherCasing(teacherRaw) || teacherRaw);
    const time = isIndividualSheet ? "-" : parseTime(blockText);
    const morningEvening = isIndividualSheet ? "" : parseMorningEvening(blockText);
    const startInfo = parseStartMonth(blockText);

    const header = findHeaderRow(rows, i);
    if (!header) {
      warnings.push(`[${sheetName}] row ${i}: block "${blockText.slice(0, 60)}..." has no recognizable header row, skipped`);
      continue;
    }
    const { map: colMap, monthCols } = buildColumnMap(header.row);
    if (colMap.name === -1 || colMap.contract === -1) {
      warnings.push(`[${sheetName}] row ${header.rowIdx}: header missing name/contract column, block skipped`);
      continue;
    }

    const groupKey = isIndividualSheet
      ? `individual::${blockLevel}`
      : `${blockLevel}::${normalizeKey(teacher)}::${normalizeKey(time)}`;
    const groupInfo = {
      key: groupKey, level: blockLevel, teacher, time, morningEvening,
      startInfo, isIndividual: isIndividualSheet, isClosed, blockText: blockText.slice(0, 120),
    };

    // student rows: from header.rowIdx+1 until next block marker or 2
    // consecutive fully-blank rows.
    let blankStreak = 0;
    let r = header.rowIdx + 1;
    for (; r < rows.length; r++) {
      const row2 = rows[r] || [];
      const c0b = row2[0];
      const rowText2 = row2.filter((c) => typeof c === "string").join(" ");
      if ((typeof c0b === "string" && c0b.toLowerCase().includes("grpoup")) || rowText2.toLowerCase().includes("grpoup:")) {
        break; // next block starts
      }
      const isBlank = row2.every((c) => c === null || c === undefined || cleanStr(c) === "");
      if (isBlank) {
        blankStreak++;
        if (blankStreak >= 2) break;
        continue;
      }
      blankStreak = 0;

      const name = cleanName(row2[colMap.name]);
      if (!name) continue; // no name -> not a real student row

      const phone = colMap.phone !== -1 ? normalizePhone(row2[colMap.phone]) : "";
      const contractInstallment = toNumberOrNull(row2[colMap.contract]);
      let contractTotal = colMap.bron !== -1 ? toNumberOrNull(row2[colMap.bron]) : null;
      if (contractTotal === null) contractTotal = contractInstallment;
      const paymentDate = colMap.dateOfSign !== -1 ? parseDateOfSignCell(row2[colMap.dateOfSign]) : null;
      const manager = findManagerInRow(row2, colMap.bron !== -1 ? colMap.bron + 1 : 8);

      const rowWarnings = [];
      if (contractInstallment === null) {
        rowWarnings.push(`Contract value not numeric ("${row2[colMap.contract]}")`);
      }
      if (!manager) rowWarnings.push("no manager matched in row");
      if (!phone) rowWarnings.push("no phone");

      const filled = monthCols
        .map(({ col, month }) => ({ month, value: toNumberOrNull(row2[col]) }))
        .filter((m) => m.value !== null && m.value > 0);

      let payments = [];
      if (filled.length > 1) {
        // Rule 1: several month columns filled -> one payment per column,
        // using that column's own value.
        payments = filled.map(({ month, value }) => ({
          amount: value,
          recognitionMonth: monthKey(DEFAULT_YEAR, month),
          recognitionMonthLabel: monthLabel(DEFAULT_YEAR, month),
        }));
      } else {
        // Rule 2: 0 or 1 month cell filled -> derive duration from contract math.
        const inst = contractInstallment || 0;
        const total = contractTotal || 0;
        let duration = inst > 0 ? Math.round(total / inst) : 1;
        if (duration < 1) duration = 1;
        if (duration > 3) {
          rowWarnings.push(`computed duration=${duration} (>3), capped at 3 for safety — needs manual review`);
          duration = 3;
        }
        let startYear = DEFAULT_YEAR;
        let startMonth = 6; // default June 2026
        if (startInfo) { startYear = startInfo.year; startMonth = startInfo.month; }
        const amountEach = duration > 1 ? inst : (total || inst);
        for (let k = 0; k < duration; k++) {
          const mIdx = startMonth + k;
          const y = startYear + Math.floor((mIdx - 1) / 12);
          const m = ((mIdx - 1) % 12) + 1;
          payments.push({
            amount: amountEach,
            recognitionMonth: monthKey(y, m),
            recognitionMonthLabel: monthLabel(y, m),
          });
        }
      }

      // Neither Contract nor Bron gave us a usable number -> would otherwise
      // produce a bogus 0 KGS payment; drop it and flag for manual entry.
      const hadPaymentsBeforeFilter = payments.length;
      payments = payments.filter((p) => p.amount > 0);
      if (hadPaymentsBeforeFilter > 0 && payments.length === 0) {
        rowWarnings.push("Contract and Bron both missing/invalid — no payment amount could be derived, student created without a payment");
      }

      // payment date assignment: first payment gets the real "Date of sign";
      // later ones (multi-month spread) default to the 1st of their own
      // recognition month, since we have no better data for when those
      // later installments actually landed in cash.
      payments = payments.map((p, idx) => ({
        ...p,
        paymentDate: idx === 0 ? (paymentDate || `${p.recognitionMonth}-01`) : `${p.recognitionMonth}-01`,
      }));

      if (payments.length === 0 && (contractInstallment || contractTotal)) {
        rowWarnings.push("no payments derived despite a contract amount present");
      }

      results.push({
        sheet: sheetName, sourceRow: r + 1, level: blockLevel, group: groupInfo,
        name, phone, manager, contractInstallment: contractInstallment || 0,
        contractTotal: contractTotal || contractInstallment || 0,
        payments, warnings: rowWarnings,
      });
    }
    i = r - 1; // continue outer loop scan from where the block ended
  }

  return { results, warnings };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  const wb = XLSX.readFile(path.join(ROOT, "Копия_Intensive.xlsx"));
  let allResults = [];
  let allWarnings = [];

  for (const sheetName of wb.SheetNames) {
    const isIndividual = sheetName === "individual";
    const level = SHEET_LEVEL_MAP[sheetName] || null;
    if (!isIndividual && !level) {
      allWarnings.push(`Sheet "${sheetName}" has no level mapping, skipped entirely`);
      continue;
    }
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const { results, warnings } = parseSheet(sheetName, rows, level, isIndividual);
    if (results.length === 0) {
      allWarnings.push(`Sheet "${sheetName}": 0 students parsed (no usable group blocks found)`);
    }
    allResults.push(...results);
    allWarnings.push(...warnings);
  }

  // -------------------------------------------------------------
  // In-file dedup: same name+phone within the same level -> merge,
  // keep last occurrence's profile fields, union all unique payments.
  // -------------------------------------------------------------
  const byStudentKey = new Map();
  for (const r of allResults) {
    const key = `${r.level}::${normalizeKey(r.name)}::${r.phone}`;
    if (!byStudentKey.has(key)) {
      byStudentKey.set(key, { ...r, payments: [...r.payments], _occurrences: 1 });
    } else {
      const existing = byStudentKey.get(key);
      // last occurrence wins for profile fields
      existing.manager = r.manager || existing.manager;
      existing.contractInstallment = r.contractInstallment || existing.contractInstallment;
      existing.contractTotal = r.contractTotal || existing.contractTotal;
      existing.group = r.group;
      existing._occurrences++;
      for (const p of r.payments) {
        const dup = existing.payments.find((x) => x.amount === p.amount && x.recognitionMonth === p.recognitionMonth);
        if (!dup) existing.payments.push(p);
      }
      existing.warnings.push(...r.warnings);
    }
  }
  const dedupedStudents = [...byStudentKey.values()];
  const inFileDupesCollapsed = allResults.length - dedupedStudents.length;

  // -------------------------------------------------------------
  // Load existing DB state for matching
  // -------------------------------------------------------------
  const { data: existingStudents, error: se } = await supabase
    .from("students").select("id,name,phone,level,manager,contract_amount,group_id");
  if (se) throw se;
  const { data: existingPayments, error: pe } = await supabase
    .from("payments").select("id,student_id,amount,recognition_start_month");
  if (pe) throw pe;
  const { data: existingGroups, error: ge } = await supabase
    .from("groups").select("id,level,name,teacher,time,status");
  if (ge) throw ge;

  const paymentsByStudent = new Map();
  for (const p of existingPayments) {
    if (!paymentsByStudent.has(p.student_id)) paymentsByStudent.set(p.student_id, []);
    paymentsByStudent.get(p.student_id).push(p);
  }

  function findExistingStudent(level, name, phone) {
    const nName = normalizeKey(name);
    const nPhone = phone;
    return existingStudents.find((s) => {
      if (s.level !== level) return false;
      const sameName = normalizeKey(s.name) === nName && nName !== "";
      const samePhone = nPhone !== "" && normalizePhone(s.phone) === nPhone;
      return sameName || samePhone;
    });
  }
  function findExistingGroup(level, teacher, time) {
    const nTeacher = normalizeKey(teacher);
    const nTime = normalizeKey(time);
    return existingGroups.find((g) =>
      g.level === level && normalizeKey(g.teacher) === nTeacher && normalizeKey(g.time) === nTime
    );
  }

  // -------------------------------------------------------------
  // Build the plan
  // -------------------------------------------------------------
  const groupPlan = new Map(); // groupKey -> { action: reuse|create, id, ...groupInfo }
  const studentPlan = [];

  for (const s of dedupedStudents) {
    const g = s.group;
    let groupEntry = groupPlan.get(g.key);
    if (!groupEntry) {
      if (g.isIndividual) {
        const existingIndivGroup = existingGroups.find((gr) =>
          gr.level === g.level && normalizeKey(gr.name) === "индивидуальные"
        );
        groupEntry = existingIndivGroup
          ? { action: "reuse", id: existingIndivGroup.id, level: g.level, name: existingIndivGroup.name, teacher: "-", time: "-" }
          : { action: "create", id: uid(), level: g.level, name: "Индивидуальные", teacher: "-", time: "-", status: "active", notes: "Импорт из Копия_Intensive.xlsx (лист individual)" };
      } else {
        const existingG = findExistingGroup(g.level, g.teacher, g.time);
        if (existingG) {
          groupEntry = { action: "reuse", id: existingG.id, level: g.level, name: existingG.name, teacher: g.teacher, time: g.time };
        } else {
          const name = g.time ? `${g.morningEvening || "Группа"} ${g.time}`.trim() : (g.morningEvening || "Группа");
          const startNote = g.startInfo ? `; старт ${monthLabel(g.startInfo.year, g.startInfo.month)}` : "";
          groupEntry = {
            action: "create", id: uid(), level: g.level, name, teacher: g.teacher || "-", time: g.time || "-",
            status: g.isClosed ? "archived" : "active", notes: `Импорт из Копия_Intensive.xlsx${startNote}`,
          };
        }
      }
      groupPlan.set(g.key, groupEntry);
    }

    const existing = findExistingStudent(s.level, s.name, s.phone);
    const plannedPayments = [];
    let skippedDupPayments = 0;
    const existingPaymentsForStudent = existing ? (paymentsByStudent.get(existing.id) || []) : [];
    for (const p of s.payments) {
      const alreadyThere = existingPaymentsForStudent.some(
        (ep) => Number(ep.amount) === p.amount && ep.recognition_start_month === p.recognitionMonth
      );
      if (alreadyThere) { skippedDupPayments++; continue; }
      plannedPayments.push(p);
    }

    studentPlan.push({
      ...s,
      action: existing ? "existing" : "new",
      existingId: existing ? existing.id : null,
      groupKey: g.key,
      plannedPayments,
      skippedDupPayments,
    });
  }

  // -------------------------------------------------------------
  // Report
  // -------------------------------------------------------------
  const newStudents = studentPlan.filter((s) => s.action === "new");
  const existingStudentsMatched = studentPlan.filter((s) => s.action === "existing");
  const totalNewPayments = studentPlan.reduce((acc, s) => acc + s.plannedPayments.length, 0);
  const totalSkippedDupPayments = studentPlan.reduce((acc, s) => acc + s.skippedDupPayments, 0);
  const newGroups = [...groupPlan.values()].filter((g) => g.action === "create");
  const reusedGroups = [...groupPlan.values()].filter((g) => g.action === "reuse");

  const allRowWarnings = studentPlan.flatMap((s) =>
    s.warnings.map((w) => `[${s.sheet}] row ${s.sourceRow} (${s.name}): ${w}`)
  );

  const byLevel = {};
  for (const s of studentPlan) {
    byLevel[s.level] ||= { newStudents: 0, existingMatched: 0, newPayments: 0 };
    byLevel[s.level][s.action === "new" ? "newStudents" : "existingMatched"]++;
    byLevel[s.level].newPayments += s.plannedPayments.length;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "APPLY" : "DRY_RUN",
    totals: {
      rowsParsedBeforeDedup: allResults.length,
      inFileDuplicatesCollapsed: inFileDupesCollapsed,
      studentsAfterDedup: dedupedStudents.length,
      newStudents: newStudents.length,
      existingStudentsMatched: existingStudentsMatched.length,
      newGroupsToCreate: newGroups.length,
      existingGroupsReused: reusedGroups.length,
      newPaymentsToCreate: totalNewPayments,
      duplicatePaymentsSkipped: totalSkippedDupPayments,
      sheetLevelWarnings: allWarnings.length,
      rowLevelWarnings: allRowWarnings.length,
    },
    byLevel,
    newGroups,
    sheetLevelWarnings: allWarnings,
    rowLevelWarningsSample: allRowWarnings.slice(0, 60),
    newStudentsSample: newStudents.slice(0, 25).map((s) => ({
      sheet: s.sheet, level: s.level, name: s.name, phone: s.phone, manager: s.manager,
      contractInstallment: s.contractInstallment, contractTotal: s.contractTotal,
      payments: s.plannedPayments,
    })),
    existingStudentsMatchedSample: existingStudentsMatched.slice(0, 25).map((s) => ({
      sheet: s.sheet, level: s.level, name: s.name, phone: s.phone,
      newPayments: s.plannedPayments, skippedDupPayments: s.skippedDupPayments,
    })),
  };

  const reportPath = path.join(ROOT, "scripts", "import_intensive_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  const fullWarningsPath = path.join(ROOT, "scripts", "import_intensive_warnings_full.txt");
  fs.writeFileSync(fullWarningsPath, [...allWarnings, ...allRowWarnings].join("\n"), "utf8");

  console.log("=== SUMMARY (" + report.mode + ") ===");
  console.log(JSON.stringify(report.totals, null, 2));
  console.log("Report written to: " + reportPath);

  if (!APPLY) {
    console.log("\nDry run only — no writes performed. Re-run with --apply to execute.");
    return;
  }

  // -------------------------------------------------------------
  // APPLY
  // -------------------------------------------------------------
  console.log("\nApplying to Supabase...");

  for (const g of newGroups) {
    const { error } = await supabase.from("groups").insert({
      id: g.id, level: g.level, name: g.name, teacher: g.teacher, time: g.time,
      status: g.status, notes: g.notes,
    });
    if (error) throw error;
  }

  let createdStudentCount = 0;
  let createdPaymentCount = 0;

  for (const s of studentPlan) {
    let studentId = s.existingId;
    if (s.action === "new") {
      studentId = uid();
      const groupEntry = groupPlan.get(s.groupKey);
      const { error } = await supabase.from("students").insert({
        id: studentId, name: s.name, phone: s.phone, level: s.level, group_id: groupEntry.id,
        manager: s.manager, contract_amount: s.contractTotal, status: "active", notes: "",
      });
      if (error) throw error;
      createdStudentCount++;
    }
    for (const p of s.plannedPayments) {
      const { error } = await supabase.from("payments").insert({
        id: uid(), student_id: studentId, amount: p.amount, date: p.paymentDate, note: "Оплата",
        course_duration_months: 1, recognition_start_month: p.recognitionMonth,
        payment_method: "", receipt_path: "",
      });
      if (error) throw error;
      createdPaymentCount++;
    }
  }

  const { error: logError } = await supabase.from("activity_log").insert({
    id: uid(), timestamp: new Date().toISOString(), actor: "import-script",
    action: `Массовый импорт из Копия_Intensive.xlsx: добавлено ${createdStudentCount} студентов, ${createdPaymentCount} платежей (${totalSkippedDupPayments} дублей пропущено)`,
    entity_type: "import", entity_id: null,
  });
  if (logError) throw logError;

  console.log(`Done. Created ${createdStudentCount} students, ${createdPaymentCount} payments, ${newGroups.length} groups.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
