import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Lock, Download, FileText, Table, ChevronDown, ChevronRight, LogOut, FolderOpen, Filter } from "lucide-react";
import { TEST_VERSION } from "@shared/constants";

interface ReportFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  level: string;
  version: string;
}

interface MonthEntry {
  month: string;
  files: ReportFile[];
}

interface YearEntry {
  year: string;
  months: MonthEntry[];
}

interface ReportsData {
  masterSheet: boolean;
  levels: string[];
  years: YearEntry[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileName(name: string): string {
  // "04-03-2026_Rodriguez_Maria.pdf" -> "Maria Rodriguez"
  const withoutExt = name.replace(/\.pdf$/, "");
  const parts = withoutExt.split("_");
  if (parts.length >= 3) {
    const last = parts[1];
    const first = parts[2];
    return `${first} ${last}`;
  }
  return withoutExt;
}

function formatDate(modified: string): string {
  return new Date(modified).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Level badge colors — maps diagnosed level to a color scheme
const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Wireman 1":      { bg: "#1a2a3a", text: "#7a9ab5", border: "#2a4a6a" },
  "Wireman 2":      { bg: "#1a2a3a", text: "#8ab0cc", border: "#2a5070" },
  "Wireman 3":      { bg: "#0f2a1f", text: "#5cc08a", border: "#1a4a30" },
  "Wireman 4":      { bg: "#0f2a1f", text: "#3dd68c", border: "#1a5a35" },
  "Journeyman":     { bg: "#1a2510", text: "#a0c060", border: "#3a5520" },
  "Leadman":        { bg: "#2a2510", text: "#FFCA3A", border: "#5a4a10" },
  "Foreman":        { bg: "#2a1a10", text: "#f0a050", border: "#5a3520" },
  "Superintendent": { bg: "#2a1020", text: "#f06080", border: "#5a2040" },
};

function LevelBadge({ level }: { level: string }) {
  if (!level) return null;
  const colors = LEVEL_COLORS[level] || { bg: "#1a2a3a", text: "#8faabe", border: "#2a4a6a" };
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
      style={{
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        fontFamily: "Montserrat, sans-serif",
      }}
    >
      {level}
    </span>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (pw: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest("POST", "/api/admin/verify", undefined, {
        "x-admin-password": password,
      });
      if (res.ok) {
        onLogin(password);
      } else {
        setError("Invalid password. Please try again.");
      }
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "#0c1f35" }}
    >
      {/* Header */}
      <div className="text-center mb-8">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: "#fff" }}
        >
          <span
            className="font-black text-lg"
            style={{ color: "#0c2340", fontFamily: "Montserrat, sans-serif" }}
          >
            CSE
          </span>
        </div>
        <h1
          className="text-xl font-black text-white tracking-widest uppercase mb-1"
          style={{ fontFamily: "Montserrat, sans-serif" }}
        >
          Canyon State Electric
        </h1>
        <p
          className="text-xs font-bold tracking-widest uppercase"
          style={{ color: "#FFCA3A", fontFamily: "Montserrat, sans-serif" }}
        >
          Report Repository
        </p>
      </div>

      {/* Card */}
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl p-8"
        style={{ background: "#0f2d4f" }}
      >
        <div className="flex items-center gap-2 mb-6">
          <Lock size={16} className="text-blue-400" />
          <h2
            className="text-white font-bold text-base"
            style={{ fontFamily: "Montserrat, sans-serif" }}
          >
            Administrator Access
          </h2>
        </div>

        <label
          className="block text-xs font-semibold uppercase tracking-widest mb-2"
          style={{ color: "#8faabe", fontFamily: "Montserrat, sans-serif" }}
        >
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg px-4 py-3 text-white text-sm outline-none mb-4"
          style={{
            background: "#0d2a4a",
            border: "1px solid #1e4a7a",
            fontFamily: "Merriweather, serif",
          }}
          placeholder="Enter admin password"
          autoFocus
        />

        {error && (
          <p className="text-red-400 text-xs mb-4" style={{ fontFamily: "Merriweather, serif" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          className="w-full py-3 rounded-lg font-bold text-sm uppercase tracking-widest text-white transition-all"
          style={{
            background: loading || !password ? "#1e4a7a" : "#136BAC",
            fontFamily: "Montserrat, sans-serif",
            cursor: loading || !password ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Verifying..." : "Access Repository"}
        </button>
      </form>

      <p
        className="mt-6 text-xs"
        style={{ color: "#3a5a7a", fontFamily: "Montserrat, sans-serif" }}
      >
        Canyon State Electric — Employee Owned
      </p>
      <p
        className="text-[10px] mt-1"
        style={{ color: "#2a4060", fontFamily: "Montserrat, sans-serif" }}
      >
        Test Version {TEST_VERSION}
      </p>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const [levelFilter, setLevelFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery<ReportsData>({
    queryKey: ["/api/admin/reports"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/reports", undefined, {
        "x-admin-password": password,
      });
      return res.json();
    },
  });

  // Apply level filter to data
  const filteredData = useMemo(() => {
    if (!data || levelFilter === "all") return data;

    const filtered: ReportsData = {
      masterSheet: data.masterSheet,
      levels: data.levels,
      years: [],
    };

    for (const yearEntry of data.years) {
      const filteredMonths: MonthEntry[] = [];
      for (const monthEntry of yearEntry.months) {
        const filteredFiles = monthEntry.files.filter(f => f.level === levelFilter);
        if (filteredFiles.length > 0) {
          filteredMonths.push({ month: monthEntry.month, files: filteredFiles });
        }
      }
      if (filteredMonths.length > 0) {
        filtered.years.push({ year: yearEntry.year, months: filteredMonths });
      }
    }

    return filtered;
  }, [data, levelFilter]);

  const totalFiles =
    filteredData?.years.reduce(
      (sum, y) => sum + y.months.reduce((s, m) => s + m.files.length, 0),
      0
    ) ?? 0;

  const totalAllFiles =
    data?.years.reduce(
      (sum, y) => sum + y.months.reduce((s, m) => s + m.files.length, 0),
      0
    ) ?? 0;

  function toggleYear(year: string) {
    setExpandedYears((prev) => ({ ...prev, [year]: !prev[year] }));
  }

  function toggleMonth(key: string) {
    setExpandedMonths((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function downloadFile(filePath: string, fileName: string) {
    const url = `/api/admin/download?file=${encodeURIComponent(filePath)}`;
    fetch(url, { headers: { "x-admin-password": password } })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  function downloadMasterSheet() {
    fetch("/api/admin/master-sheet", { headers: { "x-admin-password": password } })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "Assessment_Master_Sheet.xlsx";
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  return (
    <div className="min-h-screen" style={{ background: "#0c1f35" }}>
      {/* Top bar */}
      <div
        className="px-6 py-4 flex items-center justify-between"
        style={{ background: "#0d2a4a", borderBottom: "2px solid #136BAC" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "#fff" }}
          >
            <span
              className="font-black text-xs"
              style={{ color: "#0c2340", fontFamily: "Montserrat, sans-serif" }}
            >
              CSE
            </span>
          </div>
          <div>
            <p
              className="text-white font-black text-sm tracking-wider uppercase"
              style={{ fontFamily: "Montserrat, sans-serif" }}
            >
              Report Repository
            </p>
            <p
              className="text-xs"
              style={{ color: "#FFCA3A", fontFamily: "Montserrat, sans-serif" }}
            >
              Canyon State Electric — Admin
            </p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
          style={{
            background: "#0c2340",
            color: "#8faabe",
            border: "1px solid #1e4a7a",
            fontFamily: "Montserrat, sans-serif",
          }}
        >
          <LogOut size={13} />
          Sign Out
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {isLoading && (
          <p className="text-center" style={{ color: "#8faabe" }}>
            Loading reports...
          </p>
        )}

        {error && (
          <p className="text-center text-red-400">
            Error loading reports. Please refresh the page.
          </p>
        )}

        {data && (
          <>
            {/* Summary bar */}
            <div
              className="rounded-xl p-5 mb-6 flex flex-wrap items-center gap-6"
              style={{ background: "#0f2d4f" }}
            >
              <div>
                <p
                  className="text-xs uppercase tracking-widest mb-1"
                  style={{ color: "#8faabe", fontFamily: "Montserrat, sans-serif" }}
                >
                  {levelFilter === "all" ? "Total Reports" : "Filtered Reports"}
                </p>
                <p
                  className="text-3xl font-black text-white"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  {totalFiles}
                  {levelFilter !== "all" && (
                    <span className="text-base font-normal ml-2" style={{ color: "#4a6a8a" }}>
                      / {totalAllFiles}
                    </span>
                  )}
                </p>
              </div>
              <div
                className="w-px self-stretch"
                style={{ background: "#1e4a7a" }}
              />
              <div>
                <p
                  className="text-xs uppercase tracking-widest mb-1"
                  style={{ color: "#8faabe", fontFamily: "Montserrat, sans-serif" }}
                >
                  Years on Record
                </p>
                <p
                  className="text-3xl font-black text-white"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  {data.years.length}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3 flex-wrap">
                {/* Master Sheet download */}
                {data.masterSheet ? (
                  <button
                    onClick={downloadMasterSheet}
                    className="flex items-center gap-2 px-5 py-3 rounded-lg font-bold text-sm uppercase tracking-wider text-white transition-all"
                    style={{
                      background: "#00944F",
                      fontFamily: "Montserrat, sans-serif",
                    }}
                  >
                    <Table size={15} />
                    Download Master Sheet
                  </button>
                ) : (
                  <div
                    className="px-5 py-3 rounded-lg text-xs text-center"
                    style={{
                      background: "#0d2a4a",
                      color: "#4a6a8a",
                      fontFamily: "Montserrat, sans-serif",
                    }}
                  >
                    No master sheet yet
                  </div>
                )}
              </div>
            </div>

            {/* Filter bar */}
            {data.levels.length > 0 && (
              <div
                className="rounded-xl px-5 py-4 mb-6 flex items-center gap-4"
                style={{ background: "#0f2d4f", border: "1px solid #1e4a7a" }}
              >
                <Filter size={14} style={{ color: "#8faabe", flexShrink: 0 }} />
                <p
                  className="text-xs font-bold uppercase tracking-widest"
                  style={{ color: "#8faabe", fontFamily: "Montserrat, sans-serif", flexShrink: 0 }}
                >
                  Filter by Level
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setLevelFilter("all")}
                    className="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all"
                    style={{
                      background: levelFilter === "all" ? "#136BAC" : "#0d2a4a",
                      color: levelFilter === "all" ? "#fff" : "#6a8aaa",
                      border: `1px solid ${levelFilter === "all" ? "#136BAC" : "#1e4a7a"}`,
                      fontFamily: "Montserrat, sans-serif",
                    }}
                  >
                    All
                  </button>
                  {data.levels.map((level) => {
                    const isActive = levelFilter === level;
                    const colors = LEVEL_COLORS[level] || { bg: "#1a2a3a", text: "#8faabe", border: "#2a4a6a" };
                    return (
                      <button
                        key={level}
                        onClick={() => setLevelFilter(isActive ? "all" : level)}
                        className="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all"
                        style={{
                          background: isActive ? colors.text : colors.bg,
                          color: isActive ? "#0c1f35" : colors.text,
                          border: `1px solid ${isActive ? colors.text : colors.border}`,
                          fontFamily: "Montserrat, sans-serif",
                        }}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No reports yet */}
            {filteredData && filteredData.years.length === 0 && (
              <div
                className="rounded-xl p-12 text-center"
                style={{ background: "#0f2d4f" }}
              >
                <FolderOpen size={40} className="mx-auto mb-4" style={{ color: "#2a4a6a" }} />
                <p
                  className="text-base font-bold mb-2"
                  style={{ color: "#8faabe", fontFamily: "Montserrat, sans-serif" }}
                >
                  {levelFilter === "all" ? "No Reports Yet" : `No ${levelFilter} Reports`}
                </p>
                <p
                  className="text-sm"
                  style={{ color: "#4a6a8a", fontFamily: "Merriweather, serif" }}
                >
                  {levelFilter === "all"
                    ? "Reports will appear here after candidates complete the assessment."
                    : "No candidates have been diagnosed at this level yet."}
                </p>
                {levelFilter !== "all" && (
                  <button
                    onClick={() => setLevelFilter("all")}
                    className="mt-4 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                    style={{
                      background: "#0d2a4a",
                      color: "#136BAC",
                      border: "1px solid #136BAC",
                      fontFamily: "Montserrat, sans-serif",
                    }}
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            )}

            {/* Year / Month / File tree */}
            {filteredData && filteredData.years.map((yearEntry) => (
              <div key={yearEntry.year} className="mb-4">
                {/* Year header */}
                <button
                  onClick={() => toggleYear(yearEntry.year)}
                  className="w-full flex items-center gap-3 px-5 py-4 rounded-xl text-left transition-all"
                  style={{
                    background: "#0f2d4f",
                    border: "1px solid #1e4a7a",
                  }}
                >
                  {expandedYears[yearEntry.year] ? (
                    <ChevronDown size={16} style={{ color: "#136BAC" }} />
                  ) : (
                    <ChevronRight size={16} style={{ color: "#136BAC" }} />
                  )}
                  <span
                    className="text-white font-black text-base tracking-wider"
                    style={{ fontFamily: "Montserrat, sans-serif" }}
                  >
                    {yearEntry.year}
                  </span>
                  <span
                    className="ml-auto text-xs font-semibold px-3 py-1 rounded-full"
                    style={{
                      background: "#0d2a4a",
                      color: "#8faabe",
                      fontFamily: "Montserrat, sans-serif",
                    }}
                  >
                    {yearEntry.months.reduce((s, m) => s + m.files.length, 0)} reports
                  </span>
                </button>

                {/* Months */}
                {expandedYears[yearEntry.year] && (
                  <div className="ml-6 mt-2 space-y-2">
                    {yearEntry.months.map((monthEntry) => {
                      const key = `${yearEntry.year}-${monthEntry.month}`;
                      return (
                        <div key={key}>
                          {/* Month header */}
                          <button
                            onClick={() => toggleMonth(key)}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all"
                            style={{
                              background: "#0d2a4a",
                              border: "1px solid #1a3a5a",
                            }}
                          >
                            {expandedMonths[key] ? (
                              <ChevronDown size={14} style={{ color: "#FFCA3A" }} />
                            ) : (
                              <ChevronRight size={14} style={{ color: "#FFCA3A" }} />
                            )}
                            <span
                              className="font-bold text-sm"
                              style={{ color: "#c8d6e5", fontFamily: "Montserrat, sans-serif" }}
                            >
                              {monthEntry.month}
                            </span>
                            <span
                              className="ml-auto text-xs"
                              style={{ color: "#4a6a8a", fontFamily: "Montserrat, sans-serif" }}
                            >
                              {monthEntry.files.length}{" "}
                              {monthEntry.files.length === 1 ? "report" : "reports"}
                            </span>
                          </button>

                          {/* Files */}
                          {expandedMonths[key] && (
                            <div className="ml-5 mt-1 space-y-1">
                              {monthEntry.files.map((file) => (
                                <div
                                  key={file.path}
                                  className="flex items-center gap-4 px-4 py-3 rounded-lg"
                                  style={{
                                    background: "#0c1f35",
                                    border: "1px solid #152a40",
                                  }}
                                >
                                  <FileText
                                    size={15}
                                    style={{ color: "#136BAC", flexShrink: 0 }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2.5 flex-wrap">
                                      <p
                                        className="font-semibold text-sm text-white truncate"
                                        style={{ fontFamily: "Montserrat, sans-serif" }}
                                      >
                                        {formatFileName(file.name)}
                                      </p>
                                      <LevelBadge level={file.level} />
                                      {file.version && (
                                        <span
                                          className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                                          style={{
                                            background: "#0d2a4a",
                                            color: "#4a6a8a",
                                            border: "1px solid #1e3a5a",
                                            fontFamily: "Montserrat, sans-serif",
                                          }}
                                        >
                                          v{file.version}
                                        </span>
                                      )}
                                    </div>
                                    <p
                                      className="text-xs mt-0.5"
                                      style={{
                                        color: "#4a6a8a",
                                        fontFamily: "Merriweather, serif",
                                      }}
                                    >
                                      {formatDate(file.modified)} &middot;{" "}
                                      {formatBytes(file.size)}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => downloadFile(file.path, file.name)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                                    style={{
                                      background: "#0f2d4f",
                                      color: "#136BAC",
                                      border: "1px solid #136BAC",
                                      fontFamily: "Montserrat, sans-serif",
                                    }}
                                  >
                                    <Download size={12} />
                                    PDF
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="text-center pb-8">
        <p
          className="text-xs"
          style={{ color: "#2a4060", fontFamily: "Montserrat, sans-serif" }}
        >
          Canyon State Electric — Employee Owned &middot; Test Version {TEST_VERSION}
        </p>
      </div>
    </div>
  );
}

// ─── Admin Page root ──────────────────────────────────────────────────────────

export default function AdminPage() {
  const [password, setPassword] = useState<string | null>(null);

  if (!password) {
    return <LoginScreen onLogin={setPassword} />;
  }

  return <Dashboard password={password} onLogout={() => setPassword(null)} />;
}
