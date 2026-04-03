import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

const TEST_VERSION = "1.0";

// Report storage base directory (configurable via env)
const REPORTS_DIR = process.env.REPORTS_DIR || path.join(process.cwd(), "reports");

interface QuestionDetail {
  number: number;
  level: string;
  domain: string;
  question: string;
  candidateAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
}

interface ReportData {
  sessionId: number;
  firstName: string;
  lastName: string;
  diagnosedLevel: string;
  theta: number;
  se: number;
  totalQuestions: number;
  correctAnswers: number;
  domainScores: Record<string, { correct: number; total: number }>;
  levelConfidence: number;
  questionDetails: QuestionDetail[];
  language: string;
  timeElapsed: string;
  testVersion: string;
}

// ----- Formatting helpers -----

function formatLevel(level: string): string {
  return level
    .replace(/wireman(\d)/i, "Wireman $1")
    .replace(/journeyman/i, "Journeyman")
    .replace(/leadman/i, "Leadman")
    .replace(/foreman/i, "Foreman")
    .replace(/superintendent/i, "Superintendent");
}

function formatDomain(domain: string): string {
  return domain.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ----- PDF Generation -----

export async function generatePDFReport(data: ReportData): Promise<string> {
  const now = new Date();
  const year = now.toLocaleDateString("en-US", { timeZone: "America/Phoenix", year: "numeric" });
  const month = now.toLocaleDateString("en-US", { timeZone: "America/Phoenix", month: "2-digit" });
  const monthName = now.toLocaleDateString("en-US", { timeZone: "America/Phoenix", month: "long" });
  const dateStr = now.toLocaleDateString("en-US", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
  const dateDisplay = now.toLocaleDateString("en-US", { timeZone: "America/Phoenix", year: "numeric", month: "long", day: "numeric" });
  const timeDisplay = now.toLocaleTimeString("en-US", { timeZone: "America/Phoenix", hour: "numeric", minute: "2-digit" });

  const folderPath = path.join(REPORTS_DIR, year, `${month} - ${monthName}`);
  ensureDir(folderPath);

  const fileName = `${dateStr}_${data.lastName}_${data.firstName}.pdf`;
  const filePath = path.join(folderPath, fileName);

  const overallPct = Math.round((data.correctAnswers / data.totalQuestions) * 100);
  const levelLabel = formatLevel(data.diagnosedLevel);
  const languageLabel = data.language === "es" ? "Spanish" : "English";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ----- Colors -----
    const cseBlue = "#136BAC";
    const darkBg = "#0c2340";
    const cardBg = "#0f2d4f";
    const gold = "#FFCA3A";
    const white = "#FFFFFF";
    const muted = "#8faabe";
    const textLight = "#c8d6e5";
    const green = "#00944F";
    const red = "#D94040";
    const yellowBar = "#FFCA3A";

    const pageW = 612 - 100; // letter width minus margins

    // ----- Header -----
    doc.rect(0, 0, 612, 120).fill(darkBg);
    // CSE circle
    doc.circle(306, 45, 22).fill(white);
    doc.fontSize(14).font("Helvetica-Bold").fillColor(darkBg).text("CSE", 286, 37, { width: 40, align: "center" });
    // Title
    doc.fontSize(16).font("Helvetica-Bold").fillColor(white).text("CANYON STATE ELECTRIC", 0, 75, { width: 612, align: "center" });
    doc.fontSize(9).fillColor(gold).text("SKILLS ASSESSMENT REPORT", 0, 95, { width: 612, align: "center" });
    doc.fontSize(7).fillColor("#5a7a8f").text(`Test Version ${data.testVersion}`, 0, 108, { width: 612, align: "center" });

    let y = 135;

    // ----- Candidate Info -----
    doc.fontSize(8).font("Helvetica").fillColor(muted);
    doc.text("CANDIDATE", 50, y);
    doc.text("DATE", 400, y, { width: 162, align: "right" });
    y += 12;
    doc.fontSize(13).font("Helvetica-Bold").fillColor("#1a3a5c");
    doc.text(`${data.firstName} ${data.lastName}`, 50, y);
    doc.fontSize(10).font("Helvetica").fillColor("#4a6a8a");
    doc.text(`${dateDisplay} · ${timeDisplay}`, 300, y + 2, { width: 262, align: "right" });
    y += 20;

    doc.fontSize(8).font("Helvetica").fillColor(muted);
    doc.text("LANGUAGE", 50, y);
    doc.text("TIME ELAPSED", 400, y, { width: 162, align: "right" });
    y += 12;
    doc.fontSize(10).font("Helvetica").fillColor("#4a6a8a");
    doc.text(languageLabel, 50, y);
    doc.text(data.timeElapsed, 400, y, { width: 162, align: "right" });
    y += 25;

    // ----- Diagnosed Level Banner -----
    doc.rect(50, y, pageW, 55).fill(cseBlue);
    doc.fontSize(7).font("Helvetica").fillColor("rgba(255,255,255,0.7)");
    doc.text("DIAGNOSED LEVEL", 50, y + 8, { width: pageW, align: "center" });
    doc.fontSize(22).font("Helvetica-Bold").fillColor(white);
    doc.text(levelLabel.toUpperCase(), 50, y + 19, { width: pageW, align: "center" });
    doc.fontSize(9).font("Helvetica").fillColor("rgba(255,255,255,0.8)");
    doc.text(`Confidence: ${data.levelConfidence}%`, 50, y + 43, { width: pageW, align: "center" });
    y += 70;

    // ----- Summary Stats -----
    doc.fontSize(8).font("Helvetica-Bold").fillColor(gold);
    doc.text("SUMMARY", 50, y);
    y += 16;

    const statW = pageW / 4;
    const stats = [
      { value: `${data.totalQuestions}`, label: "QUESTIONS" },
      { value: `${data.correctAnswers}`, label: "CORRECT" },
      { value: `${overallPct}%`, label: "SCORE", color: green },
      { value: data.theta.toFixed(1), label: "ABILITY" },
    ];

    stats.forEach((stat, i) => {
      const x = 50 + i * statW;
      doc.fontSize(20).font("Helvetica-Bold").fillColor(stat.color || "#1a3a5c");
      doc.text(stat.value, x, y, { width: statW, align: "center" });
      doc.fontSize(7).font("Helvetica").fillColor(muted);
      doc.text(stat.label, x, y + 22, { width: statW, align: "center" });
    });
    y += 45;

    // ----- Domain Breakdown -----
    doc.fontSize(8).font("Helvetica-Bold").fillColor(gold);
    doc.text("DOMAIN BREAKDOWN", 50, y);
    y += 14;

    // Table header
    doc.fontSize(7).font("Helvetica").fillColor(muted);
    doc.text("DOMAIN", 50, y);
    doc.text("SCORE", 310, y, { width: 50, align: "center" });
    doc.text("%", 480, y, { width: 32, align: "right" });
    y += 4;
    doc.moveTo(50, y + 8).lineTo(50 + pageW, y + 8).strokeColor("#d0d8e0").lineWidth(0.5).stroke();
    y += 14;

    Object.entries(data.domainScores).forEach(([domain, scores]) => {
      const pct = Math.round((scores.correct / scores.total) * 100);
      const barColor = pct >= 70 ? green : pct >= 40 ? yellowBar : red;

      doc.fontSize(9).font("Helvetica").fillColor("#2a4a6a");
      doc.text(formatDomain(domain), 50, y);
      doc.text(`${scores.correct}/${scores.total}`, 310, y, { width: 50, align: "center" });

      // Progress bar
      doc.rect(380, y + 2, 90, 7).fill("#e0e8f0");
      doc.rect(380, y + 2, 90 * (pct / 100), 7).fill(barColor);

      doc.fontSize(9).font("Helvetica-Bold").fillColor("#2a4a6a");
      doc.text(`${pct}%`, 480, y, { width: 32, align: "right" });

      y += 18;
    });

    y += 10;

    // ----- Question-by-Question Detail -----
    doc.fontSize(8).font("Helvetica-Bold").fillColor(gold);
    doc.text("QUESTION-BY-QUESTION DETAIL", 50, y);
    y += 14;

    data.questionDetails.forEach((qd) => {
      // Check if we need a new page
      if (y > 680) {
        doc.addPage();
        y = 50;
      }

      const statusColor = qd.isCorrect ? green : red;
      const statusText = qd.isCorrect ? "✓ Correct" : "✗ Incorrect";
      const qLevel = formatLevel(qd.level);
      const qDomain = formatDomain(qd.domain);

      // Status + level
      doc.fontSize(8).font("Helvetica-Bold").fillColor(statusColor);
      doc.text(statusText, 50, y);
      doc.fontSize(7).font("Helvetica").fillColor(muted);
      doc.text(`${qLevel} · ${qDomain}`, 50, y + 11);

      // Question text
      doc.fontSize(9).font("Helvetica").fillColor("#2a4a6a");
      const questionHeight = doc.heightOfString(qd.question, { width: 350 });
      doc.text(qd.question, 160, y, { width: 350 });

      const answerY = y + Math.max(questionHeight, 12) + 2;
      doc.fontSize(8).font("Helvetica").fillColor("#6a8a9a");
      doc.text("Answer: ", 160, answerY);
      doc.font("Helvetica-Bold").fillColor(qd.isCorrect ? green : red);
      doc.text(qd.candidateAnswer, 200, answerY);

      let rowBottom = answerY + 12;
      if (!qd.isCorrect) {
        doc.fontSize(7).font("Helvetica").fillColor(green);
        doc.text(`Correct: ${qd.correctAnswer}`, 160, rowBottom);
        rowBottom += 10;
      }

      // Divider
      doc.moveTo(50, rowBottom + 4).lineTo(50 + pageW, rowBottom + 4).strokeColor("#e0e8f0").lineWidth(0.3).stroke();
      y = rowBottom + 10;
    });

    // ----- Footer -----
    y += 10;
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    doc.fontSize(8).font("Helvetica").fillColor(muted);
    doc.text("Canyon State Electric — Employee Owned", 50, y, { width: pageW, align: "center" });
    doc.fontSize(7).fillColor("#a0b4c8");
    doc.text(`Adaptive Skills Assessment System · v${data.testVersion}`, 50, y + 12, { width: pageW, align: "center" });

    doc.end();

    stream.on("finish", () => {
      console.log(`[Report] PDF saved: ${filePath}`);
      resolve(filePath);
    });
    stream.on("error", reject);
  });
}

// ----- Excel Master Sheet -----

export async function updateMasterSheet(data: ReportData): Promise<string> {
  const now = new Date();
  const dateDisplay = now.toLocaleDateString("en-US", { timeZone: "America/Phoenix", year: "numeric", month: "long", day: "numeric" });
  const timeDisplay = now.toLocaleTimeString("en-US", { timeZone: "America/Phoenix", hour: "numeric", minute: "2-digit" });
  const overallPct = Math.round((data.correctAnswers / data.totalQuestions) * 100);
  const languageLabel = data.language === "es" ? "Spanish" : "English";
  const levelLabel = formatLevel(data.diagnosedLevel);

  ensureDir(REPORTS_DIR);
  const masterPath = path.join(REPORTS_DIR, "Assessment_Master_Sheet.xlsx");

  let workbook: ExcelJS.Workbook;
  let sheet: ExcelJS.Worksheet;

  const columns = [
    { header: "Name", key: "name", width: 25 },
    { header: "Date", key: "date", width: 22 },
    { header: "Test Version", key: "testVersion", width: 12 },
    { header: "Language", key: "language", width: 10 },
    { header: "Time Elapsed", key: "timeElapsed", width: 14 },
    { header: "Diagnosed Level", key: "diagnosedLevel", width: 18 },
    { header: "Confidence %", key: "confidence", width: 13 },
    { header: "Total Questions", key: "totalQuestions", width: 14 },
    { header: "Correct Answers", key: "correctAnswers", width: 14 },
    { header: "Overall Score %", key: "overallScore", width: 14 },
    { header: "Ability (θ)", key: "theta", width: 11 },
    { header: "Electrical Theory %", key: "electrical_theory", width: 18 },
    { header: "NEC Code Application %", key: "nec_code_application", width: 20 },
    { header: "Installation Methods %", key: "installation_methods", width: 20 },
    { header: "Safety Procedures %", key: "safety_procedures", width: 18 },
    { header: "Tools & Equipment %", key: "tools_and_equipment", width: 18 },
    { header: "Blueprint Reading %", key: "blueprint_reading", width: 18 },
    { header: "Troubleshooting %", key: "troubleshooting", width: 16 },
  ];

  if (fs.existsSync(masterPath)) {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(masterPath);
    sheet = workbook.getWorksheet("All Candidates") || workbook.addWorksheet("All Candidates");
  } else {
    workbook = new ExcelJS.Workbook();
    workbook.creator = "Canyon State Electric";
    workbook.created = new Date();
    sheet = workbook.addWorksheet("All Candidates");
    sheet.columns = columns;

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF136BAC" },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 24;

    // Freeze header row
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    // Auto-filter
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  // Calculate domain percentages
  function domainPct(domainKey: string): number | string {
    const d = data.domainScores[domainKey];
    if (!d || d.total === 0) return "N/A";
    return Math.round((d.correct / d.total) * 100);
  }

  // Add new row
  const row = sheet.addRow({
    name: `${data.lastName}, ${data.firstName}`,
    date: `${dateDisplay} · ${timeDisplay}`,
    testVersion: data.testVersion,
    language: languageLabel,
    timeElapsed: data.timeElapsed,
    diagnosedLevel: levelLabel,
    confidence: data.levelConfidence,
    totalQuestions: data.totalQuestions,
    correctAnswers: data.correctAnswers,
    overallScore: overallPct,
    theta: parseFloat(data.theta.toFixed(2)),
    electrical_theory: domainPct("electrical_theory"),
    nec_code_application: domainPct("nec_code_application"),
    installation_methods: domainPct("installation_methods"),
    safety_procedures: domainPct("safety_procedures"),
    tools_and_equipment: domainPct("tools_and_equipment"),
    blueprint_reading: domainPct("blueprint_reading"),
    troubleshooting: domainPct("troubleshooting"),
  });

  // Alternate row coloring
  const rowIndex = row.number;
  if (rowIndex % 2 === 0) {
    row.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF0F4F8" },
    };
  }

  row.alignment = { vertical: "middle" };

  await workbook.xlsx.writeFile(masterPath);
  console.log(`[Report] Master sheet updated: ${masterPath} (row ${rowIndex})`);
  return masterPath;
}
