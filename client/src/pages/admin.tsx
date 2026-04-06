import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Lock, Download, FileText, Table, ChevronDown, ChevronRight, LogOut, FolderOpen } from "lucide-react";
import { TEST_VERSION } from "@shared/constants";

interface ReportFile {
  name: string;
  path: string;
  size: number;
  modified: string;
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

  const { data, isLoading, error } = useQuery<ReportsData>({
    queryKey: ["/api/admin/reports"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/reports", undefined, {
        "x-admin-password": password,
      });
      return res.json();
    },
  });

  const totalFiles =
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
    // Create a hidden link with the password header via fetch
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
              className="rounded-xl p-5 mb-6 flex items-center gap-6"
              style={{ background: "#0f2d4f" }}
            >
              <div>
                <p
                  className="text-xs uppercase tracking-widest mb-1"
                  style={{ color: "#8faabe", fontFamily: "Montserrat, sans-serif" }}
                >
                  Total Reports
                </p>
                <p
                  className="text-3xl font-black text-white"
                  style={{ fontFamily: "Montserrat, sans-serif" }}
                >
                  {totalFiles}
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
              <div className="ml-auto">
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

            {/* No reports yet */}
            {data.years.length === 0 && (
              <div
                className="rounded-xl p-12 text-center"
                style={{ background: "#0f2d4f" }}
              >
                <FolderOpen size={40} className="mx-auto mb-4" style={{ color: "#2a4a6a" }} />
                <p
                  className="text-base font-bold mb-2"
                  style={{ color: "#8faabe", fontFamily: "Montserrat, sans-serif" }}
                >
                  No Reports Yet
                </p>
                <p
                  className="text-sm"
                  style={{ color: "#4a6a8a", fontFamily: "Merriweather, serif" }}
                >
                  Reports will appear here after candidates complete the assessment.
                </p>
              </div>
            )}

            {/* Year / Month / File tree */}
            {data.years.map((yearEntry) => (
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
                                    <p
                                      className="font-semibold text-sm text-white truncate"
                                      style={{ fontFamily: "Montserrat, sans-serif" }}
                                    >
                                      {formatFileName(file.name)}
                                    </p>
                                    <p
                                      className="text-xs"
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
