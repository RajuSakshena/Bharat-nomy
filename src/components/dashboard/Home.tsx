import React from "react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type ElementType } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import {
  ResponsiveContainer,
  AreaChart as RAreaChart,
  Area as RArea,
  BarChart as RBarChart,
  Bar as RBar,
  XAxis as RXAxis,
  YAxis as RYAxis,
  CartesianGrid as RCartesianGrid,
  Tooltip as RTooltip,
  ReferenceLine as RReferenceLine,
  Cell as RCell,
  LineChart as RLineChart,
  Line as RLine,
  PieChart as RPieChart,
  Pie as RPie,
} from "recharts";
import {
  Search,
  RefreshCw,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  TrendingUp,
  TrendingDown,
  Users,
  Layers,
  Lock,
  Landmark,
  LineChart as LineChartIcon,
  Shapes,
  CircleDollarSign,
  ListTree,
  BarChart3,
  PieChart as PieChartIcon,
  Grid3x3,
  Trophy,
  ArrowUpToLine,
  ArrowDownToLine,
  Rocket,
  Sparkles,
  Flame,
  Boxes,
  ArrowUpDown,
  FileDown,
  Activity,
  Crown,
  CalendarDays,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Info,
} from "lucide-react";

/* ============================================================================
 * TYPES
 * ==========================================================================*/

/** Raw shape of /public/data/master.json */
interface MasterJson {
  metadata: {
    total_months: number;
    first_month: string;
    latest_month: string;
    /** ISO timestamp the source dataset itself was generated/published at — the
     *  only trustworthy "data updated" time; NOT when the browser fetched it. */
    generated_at?: string;
    [key: string]: unknown;
  };
  history: Record<string, MonthEntry>;
}

interface MonthEntry {
  year: number;
  month: string;
  month_number: number;
  data: {
    metadata?: Record<string, unknown>;
    sheets: Record<string, RawSheetRow[]>;
  };
}

/** Raw shape of the live AMFI scraper JSON (single latest month, flat — no "history" wrapper). */
interface LiveJson {
  metadata: {
    source?: string;
    file_name?: string;
    generated_at?: string;
    sheet_count?: number;
    sheet_names?: string[];
    [key: string]: unknown;
  };
  sheets: Record<string, RawSheetRow[]>;
}

type DataSource = "historical" | "live";

/** A raw row can arrive either as a positional array (most common export shape)
 *  or as a plain object keyed by column header. The parser below supports both. */
type RawCell = string | number | null | undefined;
type RawSheetRow = RawCell[] | Record<string, RawCell>;

type SchemeSection = "Open Ended" | "Close Ended" | "Interval" | "Other";

interface SchemeRow {
  schemeName: string;
  noOfSchemes: number;
  noOfFolios: number;
  fundsMobilized: number;
  repurchase: number;
  netFlow: number;
  aum: number;
  avgAum: number;
  segregatedCount: number;
  segregatedAssets: number;
  section: SchemeSection;
  isTotalRow: boolean;
  isSectionHeaderRow: boolean;
  categoryLabel: string | null;
}

type SchemeMetricKey =
  | "noOfSchemes"
  | "noOfFolios"
  | "fundsMobilized"
  | "repurchase"
  | "netFlow"
  | "aum"
  | "avgAum"
  | "segregatedCount"
  | "segregatedAssets";

interface MonthlyRecord {
  key: string; // "2021-01"
  year: number;
  monthNumber: number;
  monthName: string; // "January"
  monthLabel: string; // "Jan 2021"
  rows: SchemeRow[];
  grandTotal: SchemeRow | null;
  openEndedTotal: SchemeRow | null;
  closeEndedTotal: SchemeRow | null;
  categories: SchemeRow[];
  /** Which dataset this record came from — drives the HISTORICAL/LIVE badge in the UI. */
  source: DataSource;
  /** The source dataset's own generated_at for THIS record (master.json's for historical
   *  months, the live scraper JSON's for the live month) — never the browser fetch time. */
  sourceGeneratedAt?: string;
}

type LoadStatus = "loading" | "loaded" | "error";

/* ============================================================================
 * PARSER CONSTANTS
 * ==========================================================================*/

const HEADER_PATTERNS: Record<Exclude<keyof SchemeRow, "section" | "isTotalRow" | "isSectionHeaderRow" | "categoryLabel">, string[]> = {
  schemeName: ["scheme name", "scheme category", "category", "particulars"],
  noOfSchemes: ["no. of schemes", "no of schemes", "number of schemes"],
  noOfFolios: ["no. of folios", "no of folios", "folios"],
  fundsMobilized: ["funds mobilised", "funds mobilized"],
  repurchase: ["repurchase", "redemption"],
  netFlow: ["net inflow", "net outflow", "netinflow", "net flow"],
  aum: ["net assets under management", "net aum", "assets under management as on", "aum as on"],
  avgAum: ["average net assets", "average aum", "avg net assets", "average net asset"],
  segregatedCount: ["no. of segregated portfolios", "segregated portfolios created", "number of segregated"],
  segregatedAssets: ["net assets in segregated", "net assets under segregated", "assets under segregated"],
};

/** Known AMFI category groupings we look for inside each month's sheet. */
const CATEGORY_PATTERNS: { label: string; test: RegExp }[] = [
  { label: "Income/Debt Oriented Schemes", test: /income\s*\/?\s*debt|debt\s*oriented/i },
  { label: "Growth/Equity Oriented Schemes", test: /growth\s*\/?\s*equity|equity\s*oriented/i },
  { label: "Hybrid Schemes", test: /hybrid/i },
  { label: "Solution Oriented Schemes", test: /solution\s*oriented/i },
  { label: "Other Schemes", test: /^other\s*schemes/i },
];

const FILTER_MONTHS: Record<string, number | null> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
  "3Y": 36,
  "5Y": 60,
  ALL: null,
};

const timeFilters = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "ALL"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ============================================================================
 * PARSER HELPERS
 * ==========================================================================*/

/** Safely coerce any raw cell value (number, "1,234.56", "-", null, undefined, "") into a number. */
function normalizeNumber(value: RawCell): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === "-" || trimmed.toLowerCase() === "na" || trimmed.toLowerCase() === "n/a") return 0;
  const cleaned = trimmed.replace(/,/g, "").replace(/[^\d.+-]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function normalizeText(value: RawCell): string {
  return String(value ?? "").trim();
}

function normalizedLower(value: RawCell): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

/** Returns the first sheet (array of rows) found inside a month entry, regardless of its key name. */
function getMainSheet(entry: MonthEntry | undefined): RawSheetRow[] {
  if (!entry?.data?.sheets) return [];
  const keys = Object.keys(entry.data.sheets);
  if (keys.length === 0) return [];
  return entry.data.sheets[keys[0]] ?? [];
}

/** Builds a column-name -> index map from a positional header row using fuzzy substring matching. */
function buildColumnMap(headerRow: RawCell[]): Record<string, number> {
  const map: Record<string, number> = {};
  const normalizedHeaders = headerRow.map((cell) => normalizedLower(cell));
  (Object.keys(HEADER_PATTERNS) as (keyof typeof HEADER_PATTERNS)[]).forEach((field) => {
    const patterns = HEADER_PATTERNS[field];
    const idx = normalizedHeaders.findIndex((h) => patterns.some((p) => h.includes(p)));
    map[field] = idx;
  });
  return map;
}

function detectSection(name: string, current: SchemeSection): { section: SchemeSection; isHeader: boolean } {
  const lower = name.toLowerCase();
  if (/open\s*ended/.test(lower) && !/total/.test(lower)) return { section: "Open Ended", isHeader: true };
  if (/close\s*ended/.test(lower) && !/total/.test(lower)) return { section: "Close Ended", isHeader: true };
  if (/interval/.test(lower) && !/total/.test(lower)) return { section: "Interval", isHeader: true };
  return { section: current, isHeader: false };
}

/**
 * Locates the real header row inside a raw AMFI sheet.
 *
 * AMFI exports typically start with a title row ("Monthly Report for the
 * month of January 2021"), followed by several blank/unit rows, and only
 * THEN the actual header row containing "Scheme Name". Row 0 is NOT the
 * header, so we search the first 50 rows for the row containing that cell.
 */
function findHeaderRowIndex(rawRows: RawSheetRow[]): number {
  const searchLimit = Math.min(rawRows.length, 50);
  for (let i = 0; i < searchLimit; i++) {
    const row = rawRows[i];
    if (Array.isArray(row)) {
      const hasSchemeNameCell = row.some(
        (cell) => typeof cell === "string" && cell.trim().toLowerCase().includes("scheme name"),
      );
      if (hasSchemeNameCell) return i;
    } else if (row && typeof row === "object") {
      const keys = Object.keys(row as Record<string, RawCell>);
      const hasSchemeNameKey = keys.some((k) => k.trim().toLowerCase().includes("scheme name"));
      if (hasSchemeNameKey) return i;
    }
  }
  return -1;
}

/** Parses one month's raw sheet into a clean, typed array of SchemeRow records. */
function parseSheet(rawRows: RawSheetRow[]): SchemeRow[] {
  if (!rawRows || rawRows.length === 0) return [];

  const headerIndex = findHeaderRowIndex(rawRows);
  if (headerIndex === -1) return [];

  const isArrayShape = Array.isArray(rawRows[headerIndex]);
  let headerRow: RawCell[];
  let dataRows: RawSheetRow[];

  if (isArrayShape) {
    headerRow = rawRows[headerIndex] as RawCell[];
    dataRows = rawRows.slice(headerIndex + 1);
  } else {
    headerRow = Object.keys(rawRows[headerIndex] as Record<string, RawCell>);
    dataRows = rawRows.slice(headerIndex + 1);
  }

  const colMap = buildColumnMap(headerRow);

  const getCell = (row: RawSheetRow, field: keyof typeof HEADER_PATTERNS): RawCell => {
    const idx = colMap[field];
    if (Array.isArray(row)) {
      return idx >= 0 && idx < row.length ? row[idx] : undefined;
    }
    if (idx >= 0 && idx < headerRow.length) {
      const key = headerRow[idx] as string;
      return (row as Record<string, RawCell>)[key];
    }
    return undefined;
  };

  const rows: SchemeRow[] = [];
  let currentSection: SchemeSection = "Other";

  for (const raw of dataRows) {
    const schemeName = normalizeText(getCell(raw, "schemeName"));
    if (!schemeName) continue;

    const { section, isHeader } = detectSection(schemeName, currentSection);
    currentSection = section;

    const lower = schemeName.toLowerCase();
    const isTotalRow = lower.includes("total");

    const category = CATEGORY_PATTERNS.find((c) => c.test.test(schemeName));

    rows.push({
      schemeName,
      noOfSchemes: normalizeNumber(getCell(raw, "noOfSchemes")),
      noOfFolios: normalizeNumber(getCell(raw, "noOfFolios")),
      fundsMobilized: normalizeNumber(getCell(raw, "fundsMobilized")),
      repurchase: normalizeNumber(getCell(raw, "repurchase")),
      netFlow: normalizeNumber(getCell(raw, "netFlow")),
      aum: normalizeNumber(getCell(raw, "aum")),
      avgAum: normalizeNumber(getCell(raw, "avgAum")),
      segregatedCount: normalizeNumber(getCell(raw, "segregatedCount")),
      segregatedAssets: normalizeNumber(getCell(raw, "segregatedAssets")),
      section,
      isTotalRow,
      isSectionHeaderRow: isHeader,
      categoryLabel: category ? category.label : null,
    });
  }

  return rows;
}

function findGrandTotalRow(rows: SchemeRow[]): SchemeRow | null {
  return rows.find((r) => /grand\s*total/i.test(r.schemeName)) ?? null;
}

function findTotalOpenEndedRow(rows: SchemeRow[]): SchemeRow | null {
  return rows.find((r) => r.isTotalRow && /open/i.test(r.schemeName)) ?? null;
}

function findTotalCloseEndedRow(rows: SchemeRow[]): SchemeRow | null {
  return rows.find((r) => r.isTotalRow && /close/i.test(r.schemeName)) ?? null;
}

/**
 * AMFI sheets list a category HEADING row (e.g. "Income/Debt Oriented
 * Schemes") followed by its individual schemes, and only the SUBTOTAL row
 * beneath them ("Sub Total - I", "Sub Total - II", ...) carries the actual
 * aggregated aum / folios / netFlow / etc. for that category. We must read
 * the subtotal row's metrics, not the heading row's (which are blank/zero).
 */
/**
 * AMFI sheets carry the actual category-level aum/folios/schemes/netFlow on
 * the "Sub Total - I / II / III / IV / V (...)" rows — NOT on the plain
 * category heading rows (those are blank/zero), and NOT flagged for
 * exclusion just because isTotalRow is true. The trailing "(i+ii+...)" suffix
 * varies month to month, so we only anchor on "Sub Total - <roman numeral>".
 */
function findCategoryRows(rows: SchemeRow[]): SchemeRow[] {
  const categorySubtotals: { label: string; pattern: RegExp }[] = [
    { label: "Income/Debt Oriented Schemes", pattern: /^sub\s*total\s*-\s*i\s*\(/i },
    { label: "Growth/Equity Oriented Schemes", pattern: /^sub\s*total\s*-\s*ii\s*\(/i },
    { label: "Hybrid Schemes", pattern: /^sub\s*total\s*-\s*iii\s*\(/i },
    { label: "Solution Oriented Schemes", pattern: /^sub\s*total\s*-\s*iv\s*\(/i },
    { label: "Other Schemes", pattern: /^sub\s*total\s*-\s*v\s*\(/i },
  ];

  const bySubtotal: (SchemeRow | null)[] = categorySubtotals.map(({ label, pattern }) => {
    const row = rows.find((r) => r.section === "Open Ended" && pattern.test(r.schemeName.trim()));
    if (!row) return null;
    const resolved: SchemeRow = { ...row, categoryLabel: label };
    return resolved;
  });
  const resolvedSubtotal = bySubtotal.filter((row): row is SchemeRow => row !== null);
  if (resolvedSubtotal.length > 0) return resolvedSubtotal;

  // Fallback 1: same roman-numeral "Sub Total - <n>" anchor, but without
  // requiring the trailing "(" or the "Open Ended" section tag, in case a
  // given month's formatting or section detection drifts slightly.
  const looseSubtotals: { label: string; pattern: RegExp }[] = [
    { label: "Income/Debt Oriented Schemes", pattern: /^sub\s*total\s*-\s*i\b/i },
    { label: "Growth/Equity Oriented Schemes", pattern: /^sub\s*total\s*-\s*ii\b/i },
    { label: "Hybrid Schemes", pattern: /^sub\s*total\s*-\s*iii\b/i },
    { label: "Solution Oriented Schemes", pattern: /^sub\s*total\s*-\s*iv\b/i },
    { label: "Other Schemes", pattern: /^sub\s*total\s*-\s*v\b/i },
  ];
  const byLooseSubtotal: (SchemeRow | null)[] = looseSubtotals.map(({ label, pattern }) => {
    const row = rows.find((r) => pattern.test(r.schemeName.trim()));
    if (!row) return null;
    const resolved: SchemeRow = { ...row, categoryLabel: label };
    return resolved;
  });
  const resolvedLoose = byLooseSubtotal.filter((row): row is SchemeRow => row !== null);
  if (resolvedLoose.length > 0) return resolvedLoose;

  // Fallback 2 (last resort): match a totals row against the category name
  // itself, for source months that don't use "Sub Total" naming at all.
  const fallback: SchemeRow[] = [];
  for (const pattern of CATEGORY_PATTERNS) {
    const match = rows.find((r) => r.isTotalRow && pattern.test.test(r.schemeName));
    if (match) fallback.push({ ...match, categoryLabel: pattern.label });
  }
  return fallback;
}

function getMetricFromRow(row: SchemeRow | null | undefined, metric: SchemeMetricKey): number {
  return row ? row[metric] : 0;
}

/** Builds the full sorted list of MonthlyRecord entries from the raw master.json. */
function getMonthlyRecords(json: MasterJson | null): MonthlyRecord[] {
  if (!json?.history) return [];
  const keys = Object.keys(json.history).sort();
  return keys.map((key) => {
    const entry = json.history[key];
    const sheet = getMainSheet(entry);
    const rows = parseSheet(sheet);
    const monthName = entry.month;
    return {
      key,
      year: entry.year,
      monthNumber: entry.month_number,
      monthName,
      monthLabel: `${MONTH_ABBR[Math.max(0, Math.min(11, entry.month_number - 1))]} ${entry.year}`,
      rows,
      grandTotal: findGrandTotalRow(rows),
      openEndedTotal: findTotalOpenEndedRow(rows),
      closeEndedTotal: findTotalCloseEndedRow(rows),
      categories: findCategoryRows(rows),
      source: "historical",
      sourceGeneratedAt: json.metadata?.generated_at,
    };
  });
}

const MONTH_FULL_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * The live scraper JSON has no explicit year/month_number field — it's derived
 * from the sheet's own title row, e.g. "Monthly Report for the month of June 2026".
 * Falls back to metadata.file_name (e.g. "amjun2026repo.xls") if the title row
 * can't be located. Returns null (never a guess) if neither can be parsed.
 */
function extractLiveMonthYear(rawRows: RawSheetRow[], fileName?: string): { year: number; monthNumber: number } | null {
  const searchLimit = Math.min(rawRows.length, 5);
  for (let i = 0; i < searchLimit; i++) {
    const row = rawRows[i];
    const cells = Array.isArray(row) ? row : Object.values(row ?? {});
    for (const cell of cells) {
      if (typeof cell !== "string") continue;
      const match = cell.match(/month of\s+([A-Za-z]+)\s+(\d{4})/i);
      if (match) {
        const monthIdx = MONTH_FULL_NAMES.indexOf(match[1].toLowerCase());
        if (monthIdx >= 0) return { year: Number(match[2]), monthNumber: monthIdx + 1 };
      }
    }
  }
  if (fileName) {
    const match = fileName.match(/([a-z]{3})([a-z]{3})(\d{4})/i);
    if (match) {
      const monthIdx = MONTH_ABBR.findIndex((m) => m.toLowerCase() === match[2].toLowerCase());
      if (monthIdx >= 0) return { year: Number(match[3]), monthNumber: monthIdx + 1 };
    }
  }
  return null;
}

/**
 * Builds a single MonthlyRecord from the live scraper JSON. Reuses the exact
 * same parseSheet/findGrandTotalRow/etc. logic as the historical parser since
 * the "MCR Monthly Report" sheet shares the same AMFI column layout. Returns
 * null if the live JSON is missing, malformed, or its month can't be
 * identified — callers must treat null as "not structurally valid" and fall
 * back to historical data only, per the merge rules.
 */
function parseLiveMonthlyRecord(json: LiveJson | null): MonthlyRecord | null {
  if (!json?.sheets) return null;
  const sheetNames = Object.keys(json.sheets);
  if (sheetNames.length === 0) return null;

  // Prefer the sheet literally named like AMFI's main monthly report; fall back to
  // the first sheet so a source that renames it slightly still parses.
  const mainSheetName = sheetNames.find((n) => /monthly report/i.test(n)) ?? sheetNames[0];
  const rawRows = json.sheets[mainSheetName] ?? [];
  if (rawRows.length === 0) return null;

  const monthYear = extractLiveMonthYear(rawRows, json.metadata?.file_name);
  if (!monthYear) return null;

  const rows = parseSheet(rawRows);
  const grandTotal = findGrandTotalRow(rows);
  if (!grandTotal) return null; // structurally invalid — no usable totals row

  const { year, monthNumber } = monthYear;
  const key = `${year}-${String(monthNumber).padStart(2, "0")}`;

  return {
    key,
    year,
    monthNumber,
    monthName: MONTH_FULL_NAMES[monthNumber - 1]?.replace(/^./, (c) => c.toUpperCase()) ?? "",
    monthLabel: `${MONTH_ABBR[monthNumber - 1]} ${year}`,
    rows,
    grandTotal,
    openEndedTotal: findTotalOpenEndedRow(rows),
    closeEndedTotal: findTotalCloseEndedRow(rows),
    categories: findCategoryRows(rows),
    source: "live",
    sourceGeneratedAt: json.metadata?.generated_at,
  };
}

/**
 * Merges historical + live monthly records into one sorted, de-duplicated
 * list. Historical months are always preserved; the live month is only used
 * when it is structurally valid (parseLiveMonthlyRecord already enforces
 * that by returning null otherwise), and a month is NEVER duplicated — if
 * the live month's key already exists historically, the live version
 * replaces it instead of being appended alongside it.
 */
function mergeMonthlyRecords(historical: MonthlyRecord[], live: MonthlyRecord | null): MonthlyRecord[] {
  if (!live) return historical;
  const idx = historical.findIndex((r) => r.key === live.key);
  if (idx === -1) {
    return [...historical, live].sort((a, b) => a.key.localeCompare(b.key));
  }
  const merged = historical.slice();
  merged[idx] = live;
  return merged;
}

/* ============================================================================
 * FORMATTING HELPERS
 * ==========================================================================*/

/** Formats a ₹ Crore value (source data convention) with Lakh Cr rollover for large numbers. */
function formatCrore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 100000) {
    return `${sign}₹ ${(abs / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} Lakh Cr`;
  }
  return `${sign}₹ ${Math.round(abs).toLocaleString("en-IN")} Cr`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-IN");
}

/** Formats raw counts (e.g. folios) using Indian Lakh/Crore compact notation. */
function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)} Lakh`;
  return `${sign}${Math.round(abs).toLocaleString("en-IN")}`;
}

function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Formats master.json's own `metadata.generated_at` — the timestamp the
 * SOURCE dataset was produced at — for display. Returns null (not "—") when
 * the field is missing or unparsable, so callers can omit the whole
 * "data updated" block instead of showing a misleading placeholder.
 *
 * This intentionally never touches Date.now() / the browser clock: repeated
 * Refresh clicks against an unchanged master.json must show the same value.
 */
function formatSourceGeneratedAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Builds a filesystem-safe slug from a label like "Jun 2026" -> "Jun-2026" or "Open Ended" -> "Open-Ended". */
function slugifyLabel(label: string | null | undefined): string {
  if (!label) return "export";
  return label.trim().replace(/\s+/g, "-");
}

/* ============================================================================
 * SMALL PRESENTATIONAL HELPERS
 * ==========================================================================*/

function buildSparklinePath(values: number[]): { line: string; area: string } {
  if (values.length < 2) {
    return { line: "M0 20 L120 20", area: "M0 20 L120 20 L120 40 L0 40 Z" };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = 120 / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = 34 - ((v - min) / range) * 28;
    return [x, y];
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L120 40 L0 40 Z`;
  return { line, area };
}

const Sparkline = ({ values, positive, heightClass = "h-10" }: { values: number[]; positive: boolean; heightClass?: string }) => {
  const { line, area } = buildSparklinePath(values);
  const colorClass = positive ? "text-emerald-500" : "text-rose-500";
  return (
    <svg viewBox="0 0 120 40" className={clsx(heightClass, "w-full overflow-visible")} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${positive ? "up" : "down"}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${positive ? "up" : "down"})`} className={colorClass} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={colorClass} />
    </svg>
  );
};

const SectionHeading = ({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: ElementType;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) => (
  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 ring-1 ring-inset ring-indigo-100">
        <Icon className="h-4 w-4 text-indigo-600" strokeWidth={2.25} />
      </div>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">{title}</h2>
        {subtitle && <p className="text-xs font-medium text-slate-500">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={clsx("rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60", className)}>{children}</div>
);

const ChangePill = ({ value, digits = 2 }: { value: number | null; digits?: number }) => {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">N/A</span>
    );
  }
  const positive = value >= 0;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        positive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600",
      )}
    >
      {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {formatPercent(value, digits)}
    </span>
  );
};

const SkeletonBar = ({ className }: { className?: string }) => <div className={clsx("animate-pulse rounded-md bg-slate-200", className)} />;

/* ============================================================================
 * CHART TOOLTIPS
 * ==========================================================================*/

interface AumChartPoint {
  key: string;
  label: string;
  aum: number;
}

interface FlowChartPoint {
  key: string;
  label: string;
  netFlow: number;
  fundsMobilized: number;
  repurchase: number;
}

function AumTooltip({ active, payload }: { active?: boolean; payload?: { payload: AumChartPoint }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-slate-500">{p.label}</p>
      <p className="mt-1 text-sm font-bold text-slate-900">{formatCrore(p.aum)}</p>
    </div>
  );
}

function FlowTooltip({ active, payload }: { active?: boolean; payload?: { payload: FlowChartPoint }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-slate-500">{p.label}</p>
      <p className={clsx("mt-1 text-sm font-bold", p.netFlow >= 0 ? "text-emerald-600" : "text-rose-600")}>Net Flow: {formatCrore(p.netFlow)}</p>
      <p className="mt-0.5 text-xs text-slate-500">Mobilized: {formatCrore(p.fundsMobilized)}</p>
      <p className="text-xs text-slate-500">Redemption: {formatCrore(p.repurchase)}</p>
    </div>
  );
}

/* ============================================================================
 * MAIN COMPONENT
 * ==========================================================================*/

type LiveStatus = "historical" | "connecting" | "connected" | "unavailable";

const LIVE_SOURCE_URL = "https://raw.githubusercontent.com/RajuSakshena/MutualfundScraper-AMFI/main/output/amfi_monthly_data.json";

const Home = () => {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [masterJson, setMasterJson] = useState<MasterJson | null>(null);

  // Live scraper source is tracked separately from the historical master.json
  // load: a failed/unavailable live fetch must never block or error out the
  // historical dashboard, and must never be reported as "LIVE".
  const [liveJson, setLiveJson] = useState<LiveJson | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("historical");

  // "Last checked" is the browser-side fetch-attempt time; it is ALWAYS kept
  // separate from sourceGeneratedAtLabel (the source dataset's own
  // generated_at), which is the only thing ever shown as "Source updated".
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshLockRef = useRef(false);

  const [activeFilter, setActiveFilter] = useState("1Y");
  const [activeYear, setActiveYear] = useState<string>("");
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>("");

  const [tableSearch, setTableSearch] = useState("");
  const [tableCategoryFilter, setTableCategoryFilter] = useState("All");
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);

  const loadData = async () => {
    // Guard against duplicate concurrent refreshes (e.g. rapid double-clicks):
    // a refresh already in flight is never restarted, and multiple clicks
    // within the same second can never produce two different "last checked"
    // updates for the same underlying fetch.
    if (refreshLockRef.current) return;
    refreshLockRef.current = true;
    setIsRefreshing(true);
    setStatus((prev) => (prev === "loaded" ? prev : "loading"));
    setErrorMessage("");
    setLiveStatus((prev) => (prev === "historical" ? "connecting" : prev));

    const historicalPromise = (async () => {
      const response = await fetch(`/data/master.json?ts=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} while fetching master.json`);
      return (await response.json()) as MasterJson;
    })();

    // The live source is fetched independently — a failure here must never
    // fail the historical load or surface as the dashboard's error state.
    const livePromise = (async () => {
      const response = await fetch(`${LIVE_SOURCE_URL}?ts=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} while fetching live source`);
      return (await response.json()) as LiveJson;
    })();

    const [historicalResult, liveResult] = await Promise.allSettled([historicalPromise, livePromise]);

    if (historicalResult.status === "fulfilled") {
      setMasterJson(historicalResult.value);
      setStatus("loaded");
    } else {
      // eslint-disable-next-line no-console
      console.error("Failed to load AMFI historical data:", historicalResult.reason);
      setErrorMessage(historicalResult.reason instanceof Error ? historicalResult.reason.message : String(historicalResult.reason));
      setStatus("error");
    }

    if (liveResult.status === "fulfilled") {
      const liveRecord = parseLiveMonthlyRecord(liveResult.value);
      if (liveRecord) {
        setLiveJson(liveResult.value);
        setLiveStatus("connected");
      } else {
        // Fetched successfully but the payload wasn't structurally usable
        // (no identifiable month, no Grand Total row, etc.) — never claim LIVE.
        setLiveJson(null);
        setLiveStatus("unavailable");
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn("Live AMFI source unavailable:", liveResult.reason);
      setLiveJson(null);
      setLiveStatus("unavailable");
    }

    setLastCheckedAt(new Date());
    setIsRefreshing(false);
    refreshLockRef.current = false;
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const historicalRecords = useMemo(() => getMonthlyRecords(masterJson), [masterJson]);
  const liveRecord = useMemo(() => parseLiveMonthlyRecord(liveJson), [liveJson]);

  // Single merged, de-duplicated list — historical months are always kept;
  // the live month only overrides/extends them when structurally valid.
  const monthlyRecords = useMemo(
    () => mergeMonthlyRecords(historicalRecords, liveRecord),
    [historicalRecords, liveRecord],
  );

  // Derived from the merged list itself (not masterJson.metadata.latest_month alone) so
  // that a newer, structurally-valid live month correctly becomes "latest".
  const latestMonthKey = monthlyRecords.length ? monthlyRecords[monthlyRecords.length - 1].key : "";

  const latestRecord = useMemo(
    () => monthlyRecords.find((r) => r.key === latestMonthKey) ?? monthlyRecords[monthlyRecords.length - 1] ?? null,
    [monthlyRecords, latestMonthKey],
  );
  const latestIndex = latestRecord ? monthlyRecords.findIndex((r) => r.key === latestRecord.key) : -1;
  const prevMonthRecord = latestIndex > 0 ? monthlyRecords[latestIndex - 1] : null;
  const prevYearRecord = latestIndex >= 12 ? monthlyRecords[latestIndex - 12] : null;
  const firstRecord = monthlyRecords[0] ?? null;

  // The only trustworthy "data updated" time is the SOURCE dataset's own
  // generated_at for whichever record is currently "latest" — never the
  // browser clock / fetch completion time. Repeated Refresh clicks against
  // an unchanged source therefore always show an unchanged value.
  const sourceGeneratedAtLabel = useMemo(
    () => formatSourceGeneratedAt(latestRecord?.sourceGeneratedAt),
    [latestRecord],
  );

  // "Last checked" is separate on purpose: it's the browser-side fetch
  // attempt time, and updates on every Refresh even if the source itself
  // hasn't changed.
  const lastCheckedLabel = useMemo(
    () => (lastCheckedAt ? lastCheckedAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null),
    [lastCheckedAt],
  );

  // Initialize year/month selectors once data is available.
  useEffect(() => {
    if (latestRecord && !activeYear) setActiveYear(String(latestRecord.year));
    if (latestRecord && !selectedMonthKey) setSelectedMonthKey(latestRecord.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRecord]);

  const availableYears = useMemo(() => {
    const years = new Set(monthlyRecords.map((r) => String(r.year)));
    return Array.from(years).sort();
  }, [monthlyRecords]);

  const monthsForActiveYear = useMemo(
    () => monthlyRecords.filter((r) => String(r.year) === activeYear).sort((a, b) => a.monthNumber - b.monthNumber),
    [monthlyRecords, activeYear],
  );

  const selectedMonthRecord = useMemo(
    () => monthlyRecords.find((r) => r.key === selectedMonthKey) ?? null,
    [monthlyRecords, selectedMonthKey],
  );

  // Yearly rollup: latest available month per calendar year.
  const yearlyRecords = useMemo(() => {
    const byYear = new Map<number, MonthlyRecord>();
    for (const r of monthlyRecords) {
      const existing = byYear.get(r.year);
      if (!existing || r.monthNumber > existing.monthNumber) byYear.set(r.year, r);
    }
    return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  }, [monthlyRecords]);

  // Single source of truth for "current visualization time range" — used by
  // aumChartData, flowChartData, AND the dashboard CSV export below, so the
  // charts and the export can never drift apart.
  const filteredMonthlyRecords = useMemo(() => {
    const months = FILTER_MONTHS[activeFilter];
    return months ? monthlyRecords.slice(-months) : monthlyRecords;
  }, [monthlyRecords, activeFilter]);

  // Chart series filtered by the active time range.
  const aumChartData: AumChartPoint[] = useMemo(() => {
    return filteredMonthlyRecords
      .filter((r) => r.grandTotal)
      .map((r) => ({ key: r.key, label: r.monthLabel, aum: getMetricFromRow(r.grandTotal, "aum") }));
  }, [filteredMonthlyRecords]);

  const flowChartData: FlowChartPoint[] = useMemo(() => {
    return filteredMonthlyRecords
      .filter((r) => r.grandTotal)
      .map((r) => ({
        key: r.key,
        label: r.monthLabel,
        netFlow: getMetricFromRow(r.grandTotal, "netFlow"),
        fundsMobilized: getMetricFromRow(r.grandTotal, "fundsMobilized"),
        repurchase: getMetricFromRow(r.grandTotal, "repurchase"),
      }));
  }, [filteredMonthlyRecords]);

  const yearlyChartData = useMemo(
    () =>
      yearlyRecords.map((r) => ({
        year: String(r.year),
        aum: getMetricFromRow(r.grandTotal, "aum"),
        netFlow: getMetricFromRow(r.grandTotal, "netFlow"),
        folios: getMetricFromRow(r.grandTotal, "noOfFolios"),
      })),
    [yearlyRecords],
  );

  // Category allocation for the latest month.
  const categoryAllocation = useMemo(() => {
    if (!latestRecord) return [];
    const palette = ["#6366f1", "#10b981", "#a855f7", "#f59e0b", "#0ea5e9"];
    return latestRecord.categories.map((c, i) => ({
      label: c.categoryLabel ?? c.schemeName,
      aum: c.aum,
      color: palette[i % palette.length],
    }));
  }, [latestRecord]);

  const categoryTotalAum = categoryAllocation.reduce((sum, c) => sum + c.aum, 0);

  // Month-over-month AUM growth series, used by the heatmap and insights.
  const momGrowthSeries = useMemo(() => {
    return monthlyRecords.map((r, i) => {
      const prev = i > 0 ? monthlyRecords[i - 1] : null;
      const aum = getMetricFromRow(r.grandTotal, "aum");
      const prevAum = prev ? getMetricFromRow(prev.grandTotal, "aum") : null;
      const growth = prevAum ? pctChange(aum, prevAum) : null;
      return { key: r.key, record: r, growth };
    });
  }, [monthlyRecords]);

  const heatmapMatrix = useMemo(() => {
    const byKey = new Map(momGrowthSeries.map((g) => [g.key, g]));
    return availableYears.map((year) => ({
      year,
      months: Array.from({ length: 12 }, (_, i) => {
        const key = `${year}-${String(i + 1).padStart(2, "0")}`;
        const entry = byKey.get(key);
        return { key, monthAbbr: MONTH_ABBR[i], growth: entry?.growth ?? null, record: entry?.record ?? null };
      }),
    }));
  }, [momGrowthSeries, availableYears]);

  function colorForGrowth(pct: number | null): string {
    if (pct === null) return "#f1f5f9";
    const clamp = Math.max(-5, Math.min(5, pct));
    const t = Math.min(1, Math.abs(clamp) / 5);
    const base = { r: 226, g: 232, b: 240 }; // slate-200
    const target = clamp >= 0 ? { r: 16, g: 185, b: 129 } : { r: 244, g: 63, b: 94 }; // emerald-500 / rose-500
    const r = Math.round(base.r + (target.r - base.r) * t);
    const g = Math.round(base.g + (target.g - base.g) * t);
    const b = Math.round(base.b + (target.b - base.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Today's Highlights / insights panel.
  const insights = useMemo(() => {
    const withData = momGrowthSeries.filter((g) => g.growth !== null);
    const highestGrowth = withData.length ? withData.reduce((a, b) => ((b.growth ?? -Infinity) > (a.growth ?? -Infinity) ? b : a)) : null;
    const withFlow = monthlyRecords.filter((r) => r.grandTotal);
    const highestInflow = withFlow.length
      ? withFlow.reduce((a, b) => (getMetricFromRow(b.grandTotal, "netFlow") > getMetricFromRow(a.grandTotal, "netFlow") ? b : a))
      : null;
    const lowestFlow = withFlow.length
      ? withFlow.reduce((a, b) => (getMetricFromRow(b.grandTotal, "netFlow") < getMetricFromRow(a.grandTotal, "netFlow") ? b : a))
      : null;
    const highestAum = withFlow.length
      ? withFlow.reduce((a, b) => (getMetricFromRow(b.grandTotal, "aum") > getMetricFromRow(a.grandTotal, "aum") ? b : a))
      : null;

    let fastestCategory: { label: string; growth: number } | null = null;
    if (latestRecord && prevMonthRecord) {
      for (const cat of latestRecord.categories) {
        const prevCat = prevMonthRecord.categories.find((c) => c.categoryLabel === cat.categoryLabel);
        if (!prevCat || prevCat.aum === 0) continue;
        const growth = pctChange(cat.aum, prevCat.aum);
        if (growth !== null && (!fastestCategory || growth > fastestCategory.growth)) {
          fastestCategory = { label: cat.categoryLabel ?? cat.schemeName, growth };
        }
      }
    }

    return { highestGrowth, highestInflow, lowestFlow, highestAum, fastestCategory };
  }, [momGrowthSeries, monthlyRecords, latestRecord, prevMonthRecord]);

  // Year-over-year comparison (first available year vs latest available year).
  const yoyComparison = useMemo(() => {
    if (!firstRecord || !latestRecord || yearlyRecords.length < 1) return null;
    const first = yearlyRecords[0];
    const latest = yearlyRecords[yearlyRecords.length - 1];
    const firstAum = getMetricFromRow(first.grandTotal, "aum");
    const latestAum = getMetricFromRow(latest.grandTotal, "aum");
    const firstFolios = getMetricFromRow(first.grandTotal, "noOfFolios");
    const latestFolios = getMetricFromRow(latest.grandTotal, "noOfFolios");
    const yearsSpan = latest.year - first.year;
    const cagr = yearsSpan > 0 && firstAum > 0 ? (Math.pow(latestAum / firstAum, 1 / yearsSpan) - 1) * 100 : null;
    return {
      first,
      latest,
      aumGrowth: pctChange(latestAum, firstAum),
      foliosGrowth: pctChange(latestFolios, firstFolios),
      cagr,
      firstNetFlow: getMetricFromRow(first.grandTotal, "netFlow"),
      latestNetFlow: getMetricFromRow(latest.grandTotal, "netFlow"),
    };
  }, [firstRecord, latestRecord, yearlyRecords]);

  // Scheme / category table for the latest month.
  const tableSourceRows = useMemo(() => {
    if (!latestRecord) return [];
    return latestRecord.rows.filter((r) => !r.isTotalRow && !r.isSectionHeaderRow);
  }, [latestRecord]);

  const tableCategories = useMemo(() => {
    const set = new Set(tableSourceRows.map((r) => r.section));
    return ["All", ...Array.from(set)];
  }, [tableSourceRows]);

  const filteredTableRows = useMemo(() => {
    let rows = tableSourceRows;
    if (tableCategoryFilter !== "All") rows = rows.filter((r) => r.section === tableCategoryFilter);
    if (tableSearch.trim()) {
      const q = tableSearch.trim().toLowerCase();
      rows = rows.filter((r) => r.schemeName.toLowerCase().includes(q));
    }
    return rows;
  }, [tableSourceRows, tableCategoryFilter, tableSearch]);

  const totalTablePages = Math.max(1, Math.ceil(filteredTableRows.length / tablePageSize));
  const pagedTableRows = filteredTableRows.slice((tablePage - 1) * tablePageSize, tablePage * tablePageSize);

  // Dashboard-level export: mirrors the visualization exactly — same
  // filteredMonthlyRecords the AUM/Net Flow charts render, so this can never
  // drift from what's on screen for the selected 1M/3M/.../ALL filter.
  // Reusable, defensive scroll helper for the "View full report" action — the
  // target section carries id="scheme-data" (see the Scheme Data section
  // below) and its own scroll-mt-24 so it isn't hidden behind the sticky header.
  const scrollToSchemeData = () => {
    const target = document.getElementById("scheme-data");
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleExportCsv = () => {
    const header = ["Month", "Source", "AUM (Rs Cr)", "Folios", "Net Flow (Rs Cr)", "Funds Mobilized (Rs Cr)", "Redemption (Rs Cr)", "Schemes"];
    const lines = filteredMonthlyRecords.map((r) =>
      [
        r.monthLabel,
        r.source === "live" ? "LIVE" : "HISTORICAL",
        getMetricFromRow(r.grandTotal, "aum"),
        getMetricFromRow(r.grandTotal, "noOfFolios"),
        getMetricFromRow(r.grandTotal, "netFlow"),
        getMetricFromRow(r.grandTotal, "fundsMobilized"),
        getMetricFromRow(r.grandTotal, "repurchase"),
        getMetricFromRow(r.grandTotal, "noOfSchemes"),
      ].join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const monthSlug = slugifyLabel(latestRecord?.monthLabel ?? filteredMonthlyRecords[filteredMonthlyRecords.length - 1]?.monthLabel);
    a.download = `amfi-summary-${activeFilter}-${monthSlug}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Table-level export: independent of the visualization time-range filter.
  // Exports every row matching the Scheme Data table's own current search +
  // category filters (filteredTableRows) — NOT just the current page.
  const handleExportTableCsv = () => {
    const header = ["Scheme Name", "Category", "No. of Schemes", "Folios", "Funds Mobilized (Rs Cr)", "Redemption (Rs Cr)", "Net Flow (Rs Cr)", "AUM (Rs Cr)"];
    const escapeCsvField = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = filteredTableRows.map((row) =>
      [
        escapeCsvField(row.schemeName),
        escapeCsvField(row.section),
        row.noOfSchemes,
        row.noOfFolios,
        row.fundsMobilized,
        row.repurchase,
        row.netFlow,
        row.aum,
      ].join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const monthSlug = slugifyLabel(latestRecord?.monthLabel);
    const categorySlug = tableCategoryFilter === "All" ? "all-categories" : slugifyLabel(tableCategoryFilter);
    a.download = `amfi-scheme-data-${monthSlug}-${categorySlug}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ------------------------------------------------------------------------
   * Derived metric values for the Market Snapshot cards.
   * ----------------------------------------------------------------------*/
  const totalAum = getMetricFromRow(latestRecord?.grandTotal, "aum");
  const prevAum = prevMonthRecord ? getMetricFromRow(prevMonthRecord.grandTotal, "aum") : null;
  const prevYearAum = prevYearRecord ? getMetricFromRow(prevYearRecord.grandTotal, "aum") : null;
  const monthlyGrowth = pctChange(totalAum, prevAum);
  const yearlyGrowth = pctChange(totalAum, prevYearAum);
  const netInflow = getMetricFromRow(latestRecord?.grandTotal, "netFlow");
  const netOutflow = getMetricFromRow(latestRecord?.grandTotal, "repurchase");
  const totalFolios = getMetricFromRow(latestRecord?.grandTotal, "noOfFolios");
  const openSchemes = getMetricFromRow(latestRecord?.openEndedTotal, "noOfSchemes");
  const closeSchemes = getMetricFromRow(latestRecord?.closeEndedTotal, "noOfSchemes");

  const aumSeries = monthlyRecords.slice(-12).map((r) => getMetricFromRow(r.grandTotal, "aum"));
  const folioSeries = monthlyRecords.slice(-12).map((r) => getMetricFromRow(r.grandTotal, "noOfFolios"));
  const netFlowSeries = monthlyRecords.slice(-12).map((r) => getMetricFromRow(r.grandTotal, "netFlow"));
  const outflowSeries = monthlyRecords.slice(-12).map((r) => getMetricFromRow(r.grandTotal, "repurchase"));

  const marketSnapshotCards: {
    label: string;
    icon: ElementType;
    accent: string;
    value: string;
    change: number | null;
    sparkline: number[];
    positive: boolean;
    note?: string;
  }[] = [
    {
      label: "Total AUM",
      icon: Wallet,
      accent: "from-indigo-500 to-violet-500",
      value: formatCrore(totalAum),
      change: monthlyGrowth,
      sparkline: aumSeries,
      positive: (monthlyGrowth ?? 0) >= 0,
    },
    {
      label: "Monthly Growth",
      icon: TrendingUp,
      accent: "from-emerald-500 to-teal-500",
      value: formatPercent(monthlyGrowth),
      change: monthlyGrowth,
      sparkline: aumSeries,
      positive: (monthlyGrowth ?? 0) >= 0,
    },
    {
      label: "Yearly Growth",
      icon: Rocket,
      accent: "from-blue-500 to-cyan-500",
      value: formatPercent(yearlyGrowth),
      change: yearlyGrowth,
      sparkline: aumSeries,
      positive: (yearlyGrowth ?? 0) >= 0,
    },
    {
      label: "Net Inflow",
      icon: ArrowUpToLine,
      accent: "from-teal-500 to-emerald-500",
      value: formatCrore(netInflow),
      change: pctChange(netInflow, prevMonthRecord ? getMetricFromRow(prevMonthRecord.grandTotal, "netFlow") : null),
      sparkline: netFlowSeries,
      positive: netInflow >= 0,
    },
    {
      label: "Net Outflow",
      icon: ArrowDownToLine,
      accent: "from-rose-500 to-orange-500",
      value: formatCrore(netOutflow),
      change: pctChange(netOutflow, prevMonthRecord ? getMetricFromRow(prevMonthRecord.grandTotal, "repurchase") : null),
      sparkline: outflowSeries,
      positive: false,
    },
    {
      label: "Total Folios",
      icon: Users,
      accent: "from-sky-500 to-blue-500",
      value: formatCompact(totalFolios),
      change: pctChange(totalFolios, prevMonthRecord ? getMetricFromRow(prevMonthRecord.grandTotal, "noOfFolios") : null),
      sparkline: folioSeries,
      positive: true,
    },
    {
      label: "Open Schemes",
      icon: Layers,
      accent: "from-purple-500 to-indigo-500",
      value: formatNumber(openSchemes),
      change: null,
      sparkline: monthlyRecords.slice(-12).map((r) => getMetricFromRow(r.openEndedTotal, "noOfSchemes")),
      positive: true,
    },
    {
      label: "Close Ended Schemes",
      icon: Lock,
      accent: "from-fuchsia-500 to-purple-500",
      value: formatNumber(closeSchemes),
      change: null,
      sparkline: monthlyRecords.slice(-12).map((r) => getMetricFromRow(r.closeEndedTotal, "noOfSchemes")),
      positive: true,
    },
    // NOTE: No SIP Collection card. Neither master.json nor the live AMFI
    // scraper source (checked across every sheet — "MCR Monthly Report" and
    // "New Scheme Report") contains any SIP/contribution field. AMFI's
    // monthly report has never published SIP figures; that data is released
    // separately by AMFI/AFI and isn't part of either source this dashboard
    // reads from. Do not re-add this card unless a source that actually
    // contains SIP data is wired in.
  ];

  /* ------------------------------------------------------------------------
   * RENDER
   * ----------------------------------------------------------------------*/

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 antialiased">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 shadow-lg shadow-indigo-500/25">
              <BarChart3 className="h-5 w-5 text-white" strokeWidth={2.25} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">AMFI Analytics</h1>
              <p className="text-xs font-medium text-slate-500">Mutual fund industry intelligence platform</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                aria-label="Search schemes and categories"
                placeholder="Search schemes, categories..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-500">
                <CalendarDays className="h-3.5 w-3.5 text-indigo-500" />
                {latestRecord ? latestRecord.monthLabel : "—"}
                {latestRecord && (
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      latestRecord.source === "live" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600",
                    )}
                  >
                    {latestRecord.source === "live" ? "Live" : "Historical"}
                  </span>
                )}
                {sourceGeneratedAtLabel && (
                  <>
                    <span className="h-3.5 w-px bg-slate-200" />
                    <span title="Timestamp reported by the AMFI source dataset itself, not your browser's clock">
                      Source updated {sourceGeneratedAtLabel}
                    </span>
                  </>
                )}
                {lastCheckedLabel && (
                  <>
                    <span className="h-3.5 w-px bg-slate-200" />
                    <span title="When your browser last attempted to fetch the source — not when the source data itself changed">
                      Last checked {lastCheckedLabel}
                    </span>
                  </>
                )}
              </div>

              <div
                className={clsx(
                  "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold",
                  liveStatus === "connected" && "bg-emerald-50 text-emerald-700",
                  liveStatus === "connecting" && "bg-indigo-50 text-indigo-600",
                  liveStatus === "unavailable" && "bg-amber-50 text-amber-700",
                  liveStatus === "historical" && "bg-slate-100 text-slate-500",
                )}
              >
                <span
                  className={clsx(
                    "h-1.5 w-1.5 rounded-full",
                    liveStatus === "connected" && "bg-emerald-500",
                    liveStatus === "connecting" && "animate-pulse bg-indigo-500",
                    liveStatus === "unavailable" && "bg-amber-500",
                    liveStatus === "historical" && "bg-slate-400",
                  )}
                />
                {liveStatus === "connected" && "Live data connected"}
                {liveStatus === "connecting" && "Connecting…"}
                {liveStatus === "unavailable" && "Live source unavailable"}
                {liveStatus === "historical" && "Historical dataset"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadData}
                disabled={isRefreshing}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={clsx("h-4 w-4", isRefreshing && "animate-spin")} />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={monthlyRecords.length === 0}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-3.5 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export</span>
              </button>

              <button
                type="button"
                aria-label="Profile"
                className="ml-1 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 text-sm font-semibold text-white shadow-sm"
              >
                AM
              </button>
            </div>
          </div>
        </div>
      </header>

      {status === "error" && (
        <div className="mx-auto max-w-[1600px] px-4 pt-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-700">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Unable to load AMFI historical data
            </div>
            <details className="text-xs text-rose-600">
              <summary className="cursor-pointer font-medium">Show error details</summary>
              <p className="mt-1">{errorMessage}</p>
            </details>
            <button
              type="button"
              onClick={loadData}
              className="mt-2 inline-flex w-fit items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        </div>
      )}

      {status === "loading" && (
        <div className="mx-auto max-w-[1600px] px-4 pt-8 sm:px-6 lg:px-8">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
            Loading AMFI historical data…
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <Card key={i}>
                <SkeletonBar className="h-10 w-10 rounded-xl" />
                <SkeletonBar className="mt-4 h-4 w-24" />
                <SkeletonBar className="mt-2 h-7 w-28" />
              </Card>
            ))}
          </div>
        </div>
      )}

      {status === "loaded" && (
        <div className="relative mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-6 sm:px-6 lg:px-8 xl:grid-cols-[1fr_320px]">
          <main className="min-w-0 space-y-6">
            {/* Market Snapshot */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Market Snapshot</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">Industry overview</h2>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
                {marketSnapshotCards.map((card) => (
                  <div
                    key={card.label}
                    className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
                  >
                    <div className={clsx("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", card.accent)} />
                    <div className="flex items-start justify-between">
                      <div className={clsx("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm", card.accent)}>
                        <card.icon className="h-4 w-4 text-white" strokeWidth={2.25} />
                      </div>
                      <ChangePill value={card.change} />
                    </div>

                    <p className="mt-2 text-xs font-medium text-slate-500">{card.label}</p>
                    <p className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">{card.value}</p>
                    {card.note && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-400">
                        <Info className="h-3 w-3" />
                        {card.note}
                      </p>
                    )}

                    {card.sparkline.length > 1 && (
                      <div className="mt-2">
                        <Sparkline values={card.sparkline} positive={card.positive} heightClass="h-7" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.section>

            {/* 5 Year AUM Trend */}
            <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
              <Card>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-indigo-600" />
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight text-slate-900">AUM Trend</h2>
                      <p className="text-xs font-medium text-slate-500">Industry-wide assets under management</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                    {timeFilters.map((range) => (
                      <button
                        key={range}
                        type="button"
                        onClick={() => setActiveFilter(range)}
                        className={clsx(
                          "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                          activeFilter === range ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-white hover:text-slate-800",
                        )}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-[420px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RAreaChart data={aumChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="aumFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <RCartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <RXAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} minTickGap={30} />
                      <RYAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v: number) => `₹${(v / 100000).toFixed(1)}L`}
                        width={56}
                      />
                      <RTooltip content={<AumTooltip />} />
                      <RArea type="monotone" dataKey="aum" stroke="#6366f1" strokeWidth={2.5} fill="url(#aumFill)" animationDuration={600} />
                    </RAreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </motion.section>

            {/* Monthly Net Flow + Category Allocation */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              className="grid grid-cols-1 gap-6 lg:grid-cols-2"
            >
              <Card>
                <SectionHeading icon={TrendingUp} title="Monthly Net Flow Trend" subtitle="Inflow vs outflow by month" />
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RBarChart data={flowChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <RCartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <RXAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} minTickGap={24} />
                      <RYAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}`} width={50} />
                      <RTooltip content={<FlowTooltip />} />
                      <RReferenceLine y={0} stroke="#94a3b8" />
                      <RBar dataKey="netFlow" radius={[4, 4, 4, 4]}>
                        {flowChartData.map((d) => (
                          <RCell key={d.key} fill={d.netFlow >= 0 ? "#10b981" : "#f43f5e"} />
                        ))}
                      </RBar>
                    </RBarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card>
                <SectionHeading icon={PieChartIcon} title="Category Allocation" subtitle="AUM distributed by fund category, latest month" />
                {categoryAllocation.length === 0 ? (
                  <div className="flex h-[320px] flex-col items-center justify-center gap-2 text-slate-400">
                    <PieChartIcon className="h-8 w-8" strokeWidth={1.5} />
                    <p className="text-sm font-medium">No category rows detected for the latest month</p>
                  </div>
                ) : (
                  <div className="flex h-[320px] items-center gap-6">
                    <div className="h-full w-1/2">
                      <ResponsiveContainer width="100%" height="100%">
                        <RPieChart>
                          <RPie data={categoryAllocation} dataKey="aum" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                            {categoryAllocation.map((c) => (
                              <RCell key={c.label} fill={c.color} />
                            ))}
                          </RPie>
                          <RTooltip formatter={(value: unknown) => formatCrore(typeof value === "number" ? value : Number(value))} />
                        </RPieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-2.5">
                      {categoryAllocation.map((c) => (
                        <div key={c.label} className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 text-slate-600">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                            {c.label}
                          </div>
                          <div className="text-right font-semibold text-slate-800">
                            {categoryTotalAum > 0 ? `${((c.aum / categoryTotalAum) * 100).toFixed(1)}%` : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </motion.section>

            {/* Performance Analytics */}
            <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
              <SectionHeading icon={ShieldCheck} title="Performance Analytics" subtitle="Standout metrics across the industry" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  {
                    label: "Highest AUM Month",
                    icon: Trophy,
                    accent: "text-amber-500",
                    value: insights.highestAum ? insights.highestAum.monthLabel : "—",
                    sub: insights.highestAum ? formatCrore(getMetricFromRow(insights.highestAum.grandTotal, "aum")) : "",
                  },
                  {
                    label: "Highest Growth Month",
                    icon: ArrowUpToLine,
                    accent: "text-emerald-500",
                    value: insights.highestGrowth ? insights.highestGrowth.record.monthLabel : "—",
                    sub: insights.highestGrowth ? formatPercent(insights.highestGrowth.growth) : "",
                  },
                  {
                    label: "Largest Net Inflow",
                    icon: ArrowUpToLine,
                    accent: "text-teal-500",
                    value: insights.highestInflow ? insights.highestInflow.monthLabel : "—",
                    sub: insights.highestInflow ? formatCrore(getMetricFromRow(insights.highestInflow.grandTotal, "netFlow")) : "",
                  },
                  {
                    label: "Lowest Net Flow Month",
                    icon: ArrowDownToLine,
                    accent: "text-rose-500",
                    value: insights.lowestFlow ? insights.lowestFlow.monthLabel : "—",
                    sub: insights.lowestFlow ? formatCrore(getMetricFromRow(insights.lowestFlow.grandTotal, "netFlow")) : "",
                  },
                  {
                    label: "Fastest Growing Category",
                    icon: Flame,
                    accent: "text-orange-500",
                    value: insights.fastestCategory ? insights.fastestCategory.label : "—",
                    sub: insights.fastestCategory ? formatPercent(insights.fastestCategory.growth) : "",
                  },
                ].map((card) => (
                  <div key={card.label} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
                    <div className="flex items-center justify-between">
                      <card.icon className={clsx("h-5 w-5", card.accent)} strokeWidth={2.25} />
                    </div>
                    <p className="mt-4 text-sm font-medium text-slate-500">{card.label}</p>
                    <p className="mt-1 text-base font-bold text-slate-900">{card.value}</p>
                    {card.sub && <p className="mt-1 text-xs font-semibold text-slate-500">{card.sub}</p>}
                  </div>
                ))}
              </div>
            </motion.section>

            {/* Historical Timeline */}
            <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
              <Card>
                <SectionHeading icon={CalendarDays} title="Historical Timeline" subtitle="Browse industry data month by month" />

                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {availableYears.map((year) => (
                    <button
                      key={year}
                      type="button"
                      onClick={() => setActiveYear(year)}
                      className={clsx(
                        "shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                        activeYear === year ? "bg-indigo-600 text-white shadow-sm" : "border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100",
                      )}
                    >
                      {year}
                    </button>
                  ))}
                </div>

                <div className="relative mt-5">
                  <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-slate-200" />
                  <div className="relative flex items-center gap-4 overflow-x-auto pb-3">
                    {monthsForActiveYear.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setSelectedMonthKey(r.key)}
                        className="group flex shrink-0 flex-col items-center gap-2"
                      >
                        <span
                          className={clsx(
                            "h-3 w-3 rounded-full border-2 bg-white transition-colors",
                            selectedMonthKey === r.key ? "border-indigo-600 bg-indigo-600" : "border-indigo-300 group-hover:bg-indigo-100",
                          )}
                        />
                        <span
                          className={clsx(
                            "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                            selectedMonthKey === r.key
                              ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 bg-slate-50 text-slate-500 group-hover:border-indigo-200 group-hover:text-slate-800",
                          )}
                        >
                          {MONTH_ABBR[r.monthNumber - 1]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {selectedMonthRecord && selectedMonthRecord.grandTotal && (
                  <div className="mt-6 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <p className="text-[11px] font-medium uppercase text-slate-400">Month</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{selectedMonthRecord.monthLabel}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase text-slate-400">AUM</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{formatCrore(getMetricFromRow(selectedMonthRecord.grandTotal, "aum"))}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase text-slate-400">Folios</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{formatCompact(getMetricFromRow(selectedMonthRecord.grandTotal, "noOfFolios"))}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase text-slate-400">Net Flow</p>
                      <p
                        className={clsx(
                          "mt-1 text-sm font-bold",
                          getMetricFromRow(selectedMonthRecord.grandTotal, "netFlow") >= 0 ? "text-emerald-600" : "text-rose-600",
                        )}
                      >
                        {formatCrore(getMetricFromRow(selectedMonthRecord.grandTotal, "netFlow"))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase text-slate-400">Funds Mobilized</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{formatCrore(getMetricFromRow(selectedMonthRecord.grandTotal, "fundsMobilized"))}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase text-slate-400">Redemption</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{formatCrore(getMetricFromRow(selectedMonthRecord.grandTotal, "repurchase"))}</p>
                    </div>
                  </div>
                )}
              </Card>
            </motion.section>

            {/* Year Comparison */}
            <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
              <Card>
                <SectionHeading
                  icon={ArrowUpDown}
                  title="Year Comparison"
                  subtitle={yoyComparison ? `${yoyComparison.first.year} vs ${yoyComparison.latest.year} industry performance` : "Industry performance"}
                />

                {yoyComparison && (
                  <>
                    <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{yoyComparison.first.year}</p>
                        <p className="mt-3 text-2xl font-bold text-slate-900">{formatCrore(getMetricFromRow(yoyComparison.first.grandTotal, "aum"))}</p>
                      </div>

                      <div className="flex items-center justify-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-md">
                          VS
                        </div>
                      </div>

                      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6">
                        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{yoyComparison.latest.year}</p>
                        <p className="mt-3 text-2xl font-bold text-slate-900">{formatCrore(getMetricFromRow(yoyComparison.latest.grandTotal, "aum"))}</p>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                      {[
                        { label: "AUM Growth", value: formatPercent(yoyComparison.aumGrowth) },
                        { label: "CAGR", value: yoyComparison.cagr !== null ? formatPercent(yoyComparison.cagr) : "N/A" },
                        { label: "Folios Growth", value: formatPercent(yoyComparison.foliosGrowth) },
                        {
                          label: "Net Flow Δ",
                          value: formatCrore(yoyComparison.latestNetFlow - yoyComparison.firstNetFlow),
                        },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                          <p className="mt-2 text-sm font-bold text-slate-900">{stat.value}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            </motion.section>

            {/* Yearly Trend */}
            <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
              <Card>
                <SectionHeading icon={LineChartIcon} title="Yearly Trend" subtitle="AUM and net flow by year, latest available month" />
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RLineChart data={yearlyChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <RCartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <RXAxis dataKey="year" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                      <RYAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `₹${(v / 100000).toFixed(1)}L`} width={56} />
                      <RTooltip formatter={(value: unknown) => formatCrore(typeof value === "number" ? value : Number(value))} />
                      <RLine type="monotone" dataKey="aum" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} />
                    </RLineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </motion.section>

            {/* Performance Heatmap */}
            <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
              <Card>
                <SectionHeading icon={Grid3x3} title="Performance Heatmap" subtitle="Month-over-month AUM growth, year over year" />

                <div className="space-y-2 overflow-x-auto">
                  {heatmapMatrix.map((row) => (
                    <div key={row.year} className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-xs font-medium text-slate-500">{row.year}</span>
                      <div className="flex gap-1.5">
                        {row.months.map((cell) => (
                          <button
                            key={cell.key}
                            type="button"
                            disabled={!cell.record}
                            aria-label={`${cell.monthAbbr} ${row.year}${cell.growth !== null ? `: ${formatPercent(cell.growth)}` : ""}`}
                            title={
                              cell.record
                                ? `${cell.record.monthLabel} · AUM ${formatCrore(getMetricFromRow(cell.record.grandTotal, "aum"))} · MoM ${
                                    cell.growth !== null ? formatPercent(cell.growth) : "N/A"
                                  } · Net Flow ${formatCrore(getMetricFromRow(cell.record.grandTotal, "netFlow"))}`
                                : "No data"
                            }
                            style={{ backgroundColor: colorForGrowth(cell.growth) }}
                            className={clsx(
                              "h-4 w-4 shrink-0 rounded-[4px] transition-transform",
                              cell.record ? "hover:scale-125" : "cursor-not-allowed opacity-40",
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-end gap-2 text-xs font-medium text-slate-500">
                  Negative
                  <div className="flex gap-1">
                    <span className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: colorForGrowth(-5) }} />
                    <span className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: colorForGrowth(-2) }} />
                    <span className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: colorForGrowth(0) }} />
                    <span className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: colorForGrowth(2) }} />
                    <span className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: colorForGrowth(5) }} />
                  </div>
                  Positive
                </div>
              </Card>
            </motion.section>

            {/* Category Explorer */}
            <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
              <SectionHeading icon={Boxes} title="Category Explorer" subtitle="Drill into each fund category" />
              {categoryAllocation.length === 0 ? (
                <Card>
                  <p className="text-sm font-medium text-slate-400">No category-level rows detected in the latest month's sheet.</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {categoryAllocation.map((cat, i) => {
                    const series = monthlyRecords
                      .slice(-12)
                      .map((r) => r.categories.find((c) => c.categoryLabel === cat.label)?.aum ?? 0);
                    const prevVal = series.length > 1 ? series[series.length - 2] : null;
                    const growth = pctChange(cat.aum, prevVal);
                    const icons = [Landmark, LineChartIcon, Shapes, CircleDollarSign, Boxes];
                    const Icon = icons[i % icons.length];
                    return (
                      <div key={cat.label} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
                        <div className="flex items-center justify-between">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm" style={{ backgroundColor: cat.color }}>
                            <Icon className="h-5 w-5 text-white" strokeWidth={2.25} />
                          </div>
                          <ChangePill value={growth} />
                        </div>
                        <p className="mt-4 text-sm font-medium text-slate-500">{cat.label}</p>
                        <p className="mt-1 text-xl font-bold tracking-tight text-slate-900">{formatCrore(cat.aum)}</p>
                        <div className="mt-4 text-indigo-500">
                          <Sparkline values={series} positive={(growth ?? 0) >= 0} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.section>

            {/* Scheme / category table */}
            <motion.section
              id="scheme-data"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              className="scroll-mt-24"
            >
              <Card>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <SectionHeading icon={ListTree} title="Scheme Data" subtitle={`Latest month: ${latestRecord?.monthLabel ?? "—"}`} />
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        aria-label="Search table rows"
                        placeholder="Search rows..."
                        value={tableSearch}
                        onChange={(e) => {
                          setTableSearch(e.target.value);
                          setTablePage(1);
                        }}
                        className="w-52 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      />
                    </div>
                    <select
                      value={tableCategoryFilter}
                      onChange={(e) => {
                        setTableCategoryFilter(e.target.value);
                        setTablePage(1);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400"
                    >
                      {tableCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <select
                      value={tablePageSize}
                      onChange={(e) => {
                        setTablePageSize(Number(e.target.value));
                        setTablePage(1);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400"
                    >
                      {[10, 20, 50].map((n) => (
                        <option key={n} value={n}>
                          {n} rows
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleExportTableCsv}
                      disabled={filteredTableRows.length === 0}
                      className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <FileDown className="h-4 w-4" />
                      Export CSV
                    </button>
                  </div>
                </div>

                <div className="max-h-[600px] overflow-hidden rounded-xl border border-slate-200">
                  <div className="max-h-[600px] overflow-auto">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50">
                        <tr>
                          {["Scheme Name", "Category", "No. of Schemes", "Folios", "Funds Mobilized", "Redemption", "Net Flow", "AUM"].map((column) => (
                            <th key={column} className="whitespace-nowrap px-4 py-3 font-semibold text-slate-600">
                              <span className="inline-flex items-center gap-1.5">
                                {column}
                                <ArrowUpDown className="h-3 w-3 text-slate-300" />
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedTableRows.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                              No rows match the current filters.
                            </td>
                          </tr>
                        )}
                        {pagedTableRows.map((row, idx) => (
                          <tr key={`${row.schemeName}-${idx}`} className="border-t border-slate-100 transition-colors hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-800">{row.schemeName}</td>
                            <td className="px-4 py-3 text-slate-500">{row.section}</td>
                            <td className="px-4 py-3 text-slate-600">{formatNumber(row.noOfSchemes)}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCompact(row.noOfFolios)}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCrore(row.fundsMobilized)}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCrore(row.repurchase)}</td>
                            <td className={clsx("px-4 py-3 font-semibold", row.netFlow >= 0 ? "text-emerald-600" : "text-rose-600")}>{formatCrore(row.netFlow)}</td>
                            <td className="px-4 py-3 font-semibold text-slate-900">{formatCrore(row.aum)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-medium text-slate-500">
                    Showing {pagedTableRows.length} of {filteredTableRows.length} rows
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Previous page"
                      disabled={tablePage <= 1}
                      onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="px-2 text-sm font-medium text-slate-600">
                      Page {tablePage} of {totalTablePages}
                    </span>
                    <button
                      type="button"
                      aria-label="Next page"
                      disabled={tablePage >= totalTablePages}
                      onClick={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </Card>
            </motion.section>
          </main>

          {/* Right Insights Panel */}
          <motion.aside
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            className="xl:sticky xl:top-24 xl:h-fit"
          >
            <Card className="border-indigo-100 bg-gradient-to-b from-indigo-50/70 to-white !p-4">
              <div className="mb-3.5 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <h3 className="text-sm font-semibold tracking-tight text-slate-900">Today's Highlights</h3>
              </div>

              <div className="space-y-2">
                {[
                  {
                    label: "Highest Growth",
                    icon: Rocket,
                    accent: "text-emerald-500",
                    value: insights.highestGrowth ? `${insights.highestGrowth.record.monthLabel} · ${formatPercent(insights.highestGrowth.growth)}` : "N/A",
                  },
                  {
                    label: "Highest Inflow",
                    icon: ArrowUpToLine,
                    accent: "text-teal-500",
                    value: insights.highestInflow ? insights.highestInflow.monthLabel : "N/A",
                  },
                  {
                    label: "Lowest Month",
                    icon: TrendingDown,
                    accent: "text-rose-500",
                    value: insights.lowestFlow ? insights.lowestFlow.monthLabel : "N/A",
                  },
                  {
                    label: "Largest Category",
                    icon: Crown,
                    accent: "text-amber-500",
                    value:
                      categoryAllocation.length > 0
                        ? categoryAllocation.reduce((a, b) => (b.aum > a.aum ? b : a)).label
                        : "N/A",
                  },
                  {
                    label: "Fastest Growing Category",
                    icon: Flame,
                    accent: "text-orange-500",
                    value: insights.fastestCategory ? insights.fastestCategory.label : "N/A",
                  },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-indigo-200">
                    <div className="flex items-center gap-2.5">
                      <item.icon className={clsx("h-4 w-4 shrink-0", item.accent)} strokeWidth={2.25} />
                      <span className="text-xs font-medium text-slate-500">{item.label}</span>
                    </div>
                    <span className="text-right text-xs font-semibold text-slate-800">{item.value}</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={scrollToSchemeData}
                className="group mt-5 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-600 transition-all hover:border-indigo-200 hover:bg-slate-50 hover:text-indigo-600"
              >
                View full report
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-hover:translate-y-0.5" />
              </button>
            </Card>
          </motion.aside>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-3 px-4 py-8 sm:flex-row sm:px-6 lg:px-8">
          <p className="text-sm font-medium text-slate-500">AMFI Analytics Dashboard</p>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-400">
            <span>React 18</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>TypeScript</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>Tailwind CSS</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;