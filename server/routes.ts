import type { Express } from "express";
import type { Server } from "http";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { insertTestSessionSchema } from "../shared/schema";
import type { CATState, Question } from "../shared/schema";
import { generatePDFReport, updateMasterSheet } from "./report-generator";
import ExcelJS from "exceljs";

const REPORTS_DIR = process.env.REPORTS_DIR || path.join(process.cwd(), "reports");
const ADMIN_PASSWORD = process.env.RESET_PASSWORD || "CSE Recruitment 2026";

function verifyAdminPassword(req: any): boolean {
  const pw = req.headers["x-admin-password"] || "";
  return pw === ADMIN_PASSWORD;
}
import {
  updateTheta,
  selectNextQuestion,
  shouldTerminate,
  diagnoseLevel,
  getLevelConfidence,
  getLevelConfidenceDetails,
  getDomainScores,
} from "./cat-engine";

const TEST_VERSION = "1.0";

export function registerRoutes(server: Server, app: Express) {
  // Start a new test session
  app.post("/api/sessions", async (req, res) => {
    try {
      const parsed = insertTestSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const session = await storage.createSession(parsed.data);
      const lang = parsed.data.language || "en";

      // Get first question (start at theta=0, middle of the scale)
      const questions = storage.getQuestions();
      const state: CATState = {
        theta: 0,
        se: 3,
        answeredIds: [],
        responses: [],
      };
      const nextQuestion = selectNextQuestion(state, questions);

      res.json({
        sessionId: session.id,
        language: lang,
        startedAt: session.startedAt ? new Date(session.startedAt).toISOString() : new Date().toISOString(),
        nextQuestion: nextQuestion
          ? sanitizeQuestion(nextQuestion, lang)
          : null,
        progress: {
          questionsAnswered: 0,
          currentTheta: 0,
          estimatedLevel: diagnoseLevel(0),
          isComplete: false,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get current state and next question (for page reload)
  app.get("/api/sessions/:id/next", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const session = await storage.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.isComplete) {
        return res.json({
          nextQuestion: null,
          progress: {
            questionsAnswered: session.totalQuestions,
            currentTheta: session.currentTheta,
            estimatedLevel: session.diagnosedLevel,
            isComplete: true,
          },
        });
      }

      const prevResponses = await storage.getResponsesBySession(sessionId);
      const questions = storage.getQuestions();
      const state: CATState = {
        theta: session.currentTheta || 0,
        se: session.standardError || 3,
        answeredIds: prevResponses.map((r) => r.questionId),
        responses: prevResponses.map((r) => ({
          questionId: r.questionId,
          correct: r.isCorrect,
        })),
      };

      const lang = session.language || "en";
      const nextQuestion = selectNextQuestion(state, questions);

      res.json({
        language: lang,
        startedAt: session.startedAt ? new Date(session.startedAt).toISOString() : new Date().toISOString(),
        nextQuestion: nextQuestion ? sanitizeQuestion(nextQuestion, lang) : null,
        progress: {
          questionsAnswered: session.totalQuestions || 0,
          currentTheta: session.currentTheta || 0,
          estimatedLevel: diagnoseLevel(session.currentTheta || 0),
          isComplete: false,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Submit an answer (or skip) and get next question
  // Accepts: { questionId, selectedAnswer } OR { questionId, skipped: true }
  // Skipped questions are treated as incorrect for both grading and CAT.
  app.post("/api/sessions/:id/answer", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { questionId, selectedAnswer, skipped } = req.body;

      const session = await storage.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.isComplete) {
        return res.status(400).json({ error: "Test already complete" });
      }

      const question = storage.getQuestionById(questionId);
      if (!question) {
        return res.status(404).json({ error: "Question not found" });
      }

      // Skipped questions are graded as incorrect.
      // Use sentinel value -1 for selectedAnswer so the report can render "Skipped".
      const isSkip = skipped === true;
      const effectiveSelected = isSkip ? -1 : (selectedAnswer ?? -1);
      const isCorrect = !isSkip && effectiveSelected === question.correctAnswer;

      // Get all previous responses
      const prevResponses = await storage.getResponsesBySession(sessionId);
      const questions = storage.getQuestions();

      // Build CAT state
      const state: CATState = {
        theta: session.currentTheta || 0,
        se: session.standardError || 3,
        answeredIds: prevResponses.map((r) => r.questionId).concat(questionId),
        responses: prevResponses
          .map((r) => ({
            questionId: r.questionId,
            correct: r.isCorrect,
          }))
          .concat({ questionId, correct: isCorrect }),
      };

      // Update theta estimate
      const { theta, se } = updateTheta(state, questions);
      state.theta = theta;
      state.se = se;

      // Save the response
      await storage.addResponse({
        sessionId,
        questionId,
        selectedAnswer: effectiveSelected,
        isCorrect,
        thetaAfter: theta,
        seAfter: se,
      });

      // Update session
      const correctCount = (session.correctAnswers || 0) + (isCorrect ? 1 : 0);
      const totalCount = (session.totalQuestions || 0) + 1;

      // Check termination
      const termination = shouldTerminate(state);

      if (termination.terminate) {
        // Test is complete
        const diagnosedLevel = diagnoseLevel(theta);
        const confidenceDetails = getLevelConfidenceDetails(theta, se);
        const confidence = confidenceDetails.confidence;
        const domainScores = getDomainScores(state.responses, questions);

        await storage.updateSession(sessionId, {
          currentTheta: theta,
          standardError: se,
          totalQuestions: totalCount,
          correctAnswers: correctCount,
          diagnosedLevel,
          isComplete: true,
          completedAt: new Date(),
        });

        // Build question-by-question detail for the email report
        const questionDetails: QuestionDetail[] = state.responses.map((resp, idx) => {
          const q = questions.find(qq => qq.id === resp.questionId);
          if (!q) return null;
          // Look up what the candidate actually selected from stored responses
          const storedResp = prevResponses.find(r => r.questionId === resp.questionId);
          // For the current (just-answered) question, use the request body values
          const selAnswer = resp.questionId === questionId ? effectiveSelected : storedResp?.selectedAnswer ?? -1;
          // -1 sentinel = skipped
          const candidateAnswer = selAnswer === -1
            ? "Skipped"
            : (q.options[selAnswer] || `Option ${selAnswer}`);
          return {
            number: idx + 1,
            level: q.level,
            domain: q.domain,
            question: q.question,
            candidateAnswer,
            correctAnswer: q.options[q.correctAnswer] || `Option ${q.correctAnswer}`,
            isCorrect: resp.correct,
          };
        }).filter(Boolean) as QuestionDetail[];

        // Compute time elapsed
        const startTime = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
        const elapsedMs = Date.now() - startTime;
        const elapsedMin = Math.floor(elapsedMs / 60000);
        const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
        const timeElapsed = elapsedMin > 0 ? `${elapsedMin} min ${elapsedSec} sec` : `${elapsedSec} sec`;

        // Fire-and-forget email — send HTTP response immediately, email sends in background
        sendResultsEmail({
          sessionId,
          firstName: session.firstName,
          lastName: session.lastName,
          diagnosedLevel,
          theta,
          se,
          totalQuestions: totalCount,
          correctAnswers: correctCount,
          domainScores,
          levelConfidence: confidence,
          borderline: confidenceDetails.borderline,
          secondaryLevel: confidenceDetails.secondaryLevel,
          questionDetails,
          language: session.language || "en",
          timeElapsed,
          testVersion: TEST_VERSION,
        }).then(async (emailSent) => {
          if (emailSent) {
            try {
              await storage.updateSession(sessionId, { emailSent: true });
            } catch (e) {
              console.error("Failed to update emailSent flag:", e);
            }
          }
        }).catch((e) => {
          console.error("Background email error:", e);
        });

        // Fire-and-forget: generate PDF report and update master Excel sheet
        const reportData = {
          sessionId,
          firstName: session.firstName,
          lastName: session.lastName,
          diagnosedLevel,
          theta,
          se,
          totalQuestions: totalCount,
          correctAnswers: correctCount,
          domainScores,
          levelConfidence: confidence,
          borderline: confidenceDetails.borderline,
          secondaryLevel: confidenceDetails.secondaryLevel,
          questionDetails,
          language: session.language || "en",
          timeElapsed,
          testVersion: TEST_VERSION,
        };
        // Generate PDF first, then pass its filename to the master sheet
        generatePDFReport(reportData).then((pdfPath) => {
          const pdfFileName = path.basename(pdfPath);
          updateMasterSheet(reportData, pdfFileName).catch((e) => console.error("Master sheet update error:", e));
        }).catch((e) => console.error("PDF generation error:", e));

        return res.json({
          nextQuestion: null,
          progress: {
            questionsAnswered: totalCount,
            currentTheta: theta,
            estimatedLevel: diagnosedLevel,
            isComplete: true,
            confidence,
            domainScores,
            correctAnswers: correctCount,
            totalQuestions: totalCount,
          },
        });
      }

      // Select next question
      const lang = session.language || "en";
      const nextQuestion = selectNextQuestion(state, questions);

      await storage.updateSession(sessionId, {
        currentTheta: theta,
        standardError: se,
        totalQuestions: totalCount,
        correctAnswers: correctCount,
      });

      res.json({
        nextQuestion: nextQuestion ? sanitizeQuestion(nextQuestion, lang) : null,
        progress: {
          questionsAnswered: totalCount,
          currentTheta: theta,
          estimatedLevel: diagnoseLevel(theta),
          isComplete: false,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Submit the test early — used by the 30-min "Turn In Test" button
  // and the 60-min hard auto-submit.
  // Generates report regardless of whether minimum questions were reached.
  // If the candidate answered 0 questions, returns an error.
  app.post("/api/sessions/:id/submit-early", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { reason } = req.body || {};   // "manual" | "timeout"

      const session = await storage.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.isComplete) {
        // Already complete — idempotent: return success so the client can navigate to results
        return res.json({
          progress: {
            questionsAnswered: session.totalQuestions,
            currentTheta: session.currentTheta,
            estimatedLevel: session.diagnosedLevel,
            isComplete: true,
          },
        });
      }

      const prevResponses = await storage.getResponsesBySession(sessionId);
      const questions = storage.getQuestions();

      if (prevResponses.length === 0) {
        return res.status(400).json({ error: "No questions have been answered yet." });
      }

      const theta = session.currentTheta || 0;
      const se = session.standardError || 3;

      const responses = prevResponses.map((r) => ({
        questionId: r.questionId,
        correct: r.isCorrect,
      }));

      const totalCount = prevResponses.length;
      const correctCount = prevResponses.filter((r) => r.isCorrect).length;

      const diagnosedLevel = diagnoseLevel(theta);
      const confidenceDetails = getLevelConfidenceDetails(theta, se);
      const confidence = confidenceDetails.confidence;
      const domainScores = getDomainScores(responses, questions);

      // Mark low-confidence flag when the test ended before the minimum question count.
      // Reuses the existing "borderline" channel so reports show a clear note.
      const lowConfidence = totalCount < 30;
      const finalBorderline = confidenceDetails.borderline || lowConfidence;

      await storage.updateSession(sessionId, {
        currentTheta: theta,
        standardError: se,
        totalQuestions: totalCount,
        correctAnswers: correctCount,
        diagnosedLevel,
        isComplete: true,
        completedAt: new Date(),
      });

      // Build question-by-question detail from stored responses
      const questionDetails: QuestionDetail[] = prevResponses.map((resp, idx) => {
        const q = questions.find((qq) => qq.id === resp.questionId);
        if (!q) return null;
        const candidateAnswer =
          resp.selectedAnswer === -1
            ? "Skipped"
            : q.options[resp.selectedAnswer] || `Option ${resp.selectedAnswer}`;
        return {
          number: idx + 1,
          level: q.level,
          domain: q.domain,
          question: q.question,
          candidateAnswer,
          correctAnswer: q.options[q.correctAnswer] || `Option ${q.correctAnswer}`,
          isCorrect: resp.isCorrect,
        };
      }).filter(Boolean) as QuestionDetail[];

      const startTime = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
      const elapsedMs = Date.now() - startTime;
      const elapsedMin = Math.floor(elapsedMs / 60000);
      const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
      const timeElapsed = elapsedMin > 0 ? `${elapsedMin} min ${elapsedSec} sec` : `${elapsedSec} sec`;

      // Append a short note to indicate this was an early submission
      const submissionNote =
        reason === "timeout"
          ? "Time Limit Reached (60 min auto-submit)"
          : "Submitted Early by Candidate (30 min)";

      const reportData = {
        sessionId,
        firstName: session.firstName,
        lastName: session.lastName,
        diagnosedLevel,
        theta,
        se,
        totalQuestions: totalCount,
        correctAnswers: correctCount,
        domainScores,
        levelConfidence: confidence,
        borderline: finalBorderline,
        secondaryLevel: confidenceDetails.secondaryLevel,
        questionDetails,
        language: session.language || "en",
        timeElapsed,
        testVersion: TEST_VERSION,
        lowConfidence,
        submissionNote,
      };

      sendResultsEmail(reportData)
        .then(async (emailSent) => {
          if (emailSent) {
            try {
              await storage.updateSession(sessionId, { emailSent: true });
            } catch (e) {
              console.error("Failed to update emailSent flag:", e);
            }
          }
        })
        .catch((e) => {
          console.error("Background email error:", e);
        });

      generatePDFReport(reportData)
        .then((pdfPath) => {
          const pdfFileName = path.basename(pdfPath);
          updateMasterSheet(reportData, pdfFileName).catch((e) =>
            console.error("Master sheet update error:", e)
          );
        })
        .catch((e) => console.error("PDF generation error:", e));

      return res.json({
        progress: {
          questionsAnswered: totalCount,
          currentTheta: theta,
          estimatedLevel: diagnosedLevel,
          isComplete: true,
          confidence,
          domainScores,
          correctAnswers: correctCount,
          totalQuestions: totalCount,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Verify reset password to unlock completed test
  app.post("/api/verify-reset", async (req, res) => {
    const { password } = req.body;
    const RESET_PASSWORD = process.env.RESET_PASSWORD || "CSE Recruitment 2026";
    if (password === RESET_PASSWORD) {
      return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: "Invalid password" });
  });

  // Get session results (for results page)
  app.get("/api/sessions/:id/results", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const session = await storage.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (!session.isComplete) {
        return res.status(400).json({ error: "Test not complete" });
      }

      const responses = await storage.getResponsesBySession(sessionId);
      const questions = storage.getQuestions();
      const domainScores = getDomainScores(
        responses.map((r) => ({
          questionId: r.questionId,
          correct: r.isCorrect,
        })),
        questions
      );

      res.json({
        sessionId,
        firstName: session.firstName,
        lastName: session.lastName,
        diagnosedLevel: session.diagnosedLevel,
        theta: session.currentTheta,
        se: session.standardError,
        totalQuestions: session.totalQuestions,
        correctAnswers: session.correctAnswers,
        domainScores,
        levelConfidence: getLevelConfidence(
          session.currentTheta || 0,
          session.standardError || 1
        ),
        emailSent: session.emailSent,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Admin API ────────────────────────────────────────────────────────────

  // Verify admin password
  app.post("/api/admin/verify", (req, res) => {
    if (verifyAdminPassword(req)) {
      return res.json({ success: true });
    }
    return res.status(401).json({ success: false });
  });

  // List all reports (master sheet + PDFs organized by year/month)
  // Also reads the master sheet to include diagnosed level for each candidate
  app.get("/api/admin/reports", async (req, res) => {
    if (!verifyAdminPassword(req)) return res.status(401).json({ error: "Unauthorized" });

    try {
      const result: {
        masterSheet: boolean;
        levels: string[];
        years: { year: string; months: { month: string; files: { name: string; path: string; size: number; modified: string; level: string; version: string }[] }[] }[];
      } = { masterSheet: false, levels: [], years: [] };

      // Check for master sheet and build file-based lookup
      const masterPath = path.join(REPORTS_DIR, "Assessment_Master_Sheet.xlsx");
      result.masterSheet = fs.existsSync(masterPath);

      // Primary lookup: exact PDF filename → {level, version}
      // Fallback lookup: "lastname_firstname" → {level, version} (for legacy rows without filename)
      const fileLookup: Record<string, { level: string; version: string }> = {};
      const nameLookup: Record<string, { level: string; version: string }> = {};
      const allLevels = new Set<string>();
      if (result.masterSheet) {
        try {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.readFile(masterPath);
          const sheet = wb.getWorksheet("All Candidates");
          if (sheet) {
            const headerRow = sheet.getRow(1);
            let fileCol = -1, nameCol = -1, levelCol = -1, versionCol = -1;
            headerRow.eachCell((cell, colNum) => {
              const val = String(cell.value || "").toLowerCase().trim();
              if (val === "pdf file") fileCol = colNum;
              if (val === "name") nameCol = colNum;
              if (val === "diagnosed level") levelCol = colNum;
              if (val === "test version") versionCol = colNum;
            });
            if (levelCol > 0) {
              sheet.eachRow((row, rowNum) => {
                if (rowNum === 1) return;
                const level = String(row.getCell(levelCol).value || "").trim();
                const version = versionCol > 0 ? String(row.getCell(versionCol).value || "").trim() : "";
                if (!level) return;
                allLevels.add(level);

                // Primary: exact filename match
                if (fileCol > 0) {
                  const pdfFile = String(row.getCell(fileCol).value || "").trim();
                  if (pdfFile) {
                    fileLookup[pdfFile.toLowerCase()] = { level, version };
                  }
                }

                // Fallback: name-based match for legacy rows
                if (nameCol > 0) {
                  const fullName = String(row.getCell(nameCol).value || "").trim();
                  if (fullName) {
                    let key = "";
                    if (fullName.includes(",")) {
                      const [last, first] = fullName.split(",").map(s => s.trim());
                      if (last && first) key = `${last}_${first}`.toLowerCase();
                    } else {
                      const parts = fullName.split(/\s+/);
                      if (parts.length >= 2) {
                        key = `${parts.slice(1).join(" ")}_${parts[0]}`.toLowerCase();
                      }
                    }
                    if (key) nameLookup[key] = { level, version };
                  }
                }
              });
            }
          }
        } catch (e) {
          // If master sheet is unreadable, continue without levels
        }
      }

      // Canonical level order for the filter dropdown
      const levelOrder = ["Wireman 1", "Wireman 2", "Wireman 3", "Wireman 4", "Journeyman", "Leadman", "Foreman", "Superintendent"];
      result.levels = levelOrder.filter(l => allLevels.has(l));

      if (!fs.existsSync(REPORTS_DIR)) return res.json(result);

      // Walk year → month → files
      const years = fs.readdirSync(REPORTS_DIR)
        .filter(y => /^\d{4}$/.test(y) && fs.statSync(path.join(REPORTS_DIR, y)).isDirectory())
        .sort().reverse();

      for (const year of years) {
        const yearPath = path.join(REPORTS_DIR, year);
        const months = fs.readdirSync(yearPath)
          .filter(m => fs.statSync(path.join(yearPath, m)).isDirectory())
          .sort().reverse();

        const yearEntry: typeof result.years[0] = { year, months: [] };

        for (const month of months) {
          const monthPath = path.join(yearPath, month);
          const files = fs.readdirSync(monthPath)
            .filter(f => f.endsWith(".pdf"))
            .sort().reverse()
            .map(f => {
              const stat = fs.statSync(path.join(monthPath, f));
              // Match to master sheet: try exact filename first, then name-based fallback
              let level = "";
              let version = "";
              const exactMatch = fileLookup[f.toLowerCase()];
              if (exactMatch) {
                level = exactMatch.level;
                version = exactMatch.version;
              } else {
                // Fallback: parse name from filename
                // Supports both "DATE_Last_First.pdf" and "DATE_Last_First_HHMMSS.pdf"
                const withoutExt = f.replace(/\.pdf$/, "");
                const parts = withoutExt.split("_");
                if (parts.length >= 3) {
                  const lookupKey = `${parts[1]}_${parts[2]}`.toLowerCase();
                  const nameMatch = nameLookup[lookupKey];
                  if (nameMatch) {
                    level = nameMatch.level;
                    version = nameMatch.version;
                  }
                }
              }
              return {
                name: f,
                path: `${year}/${month}/${f}`,
                size: stat.size,
                modified: stat.mtime.toISOString(),
                level,
                version,
              };
            });
          if (files.length > 0) yearEntry.months.push({ month, files });
        }

        if (yearEntry.months.length > 0) result.years.push(yearEntry);
      }

      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Download master sheet
  app.get("/api/admin/master-sheet", (req, res) => {
    if (!verifyAdminPassword(req)) return res.status(401).json({ error: "Unauthorized" });
    const masterPath = path.join(REPORTS_DIR, "Assessment_Master_Sheet.xlsx");
    if (!fs.existsSync(masterPath)) return res.status(404).json({ error: "Master sheet not found" });
    res.download(masterPath, "Assessment_Master_Sheet.xlsx");
  });

  // Download a specific PDF report
  app.get("/api/admin/download", (req, res) => {
    if (!verifyAdminPassword(req)) return res.status(401).json({ error: "Unauthorized" });
    const filePath = req.query.file as string;
    if (!filePath) return res.status(400).json({ error: "No file specified" });

    // Security: ensure the path stays within REPORTS_DIR
    const resolved = path.resolve(REPORTS_DIR, filePath);
    if (!resolved.startsWith(path.resolve(REPORTS_DIR))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: "File not found" });
    res.download(resolved);
  });
}

// Remove correct answer from question before sending to client
// Optionally localize to Spanish
function sanitizeQuestion(q: Question, language: string = "en") {
  return {
    id: q.id,
    level: q.level,
    domain: q.domain,
    type: q.type,
    question: language === "es" && q.question_es ? q.question_es : q.question,
    options: language === "es" && q.options_es ? q.options_es : q.options,
    imageUrl: q.imageUrl,
  };
}

// Build branded HTML email body
function buildEmailBody(result: EmailResult): string {
  const overallPct = Math.round((result.correctAnswers / result.totalQuestions) * 100);
  const languageLabel = result.language === "es" ? "Spanish" : "English";
  const dateStr = new Date().toLocaleDateString("en-US", { timeZone: "America/Phoenix", year: "numeric", month: "long", day: "numeric" });
  const timeStr = new Date().toLocaleTimeString("en-US", { timeZone: "America/Phoenix", hour: "numeric", minute: "2-digit" });
  const levelLabel = result.diagnosedLevel.replace(/wireman(\d)/i, "Wireman $1").replace(/journeyman/i, "Journeyman").replace(/leadman/i, "Leadman").replace(/foreman/i, "Foreman").replace(/superintendent/i, "Superintendent");

  // Domain rows
  const domainRows = Object.entries(result.domainScores).map(([domain, scores]) => {
    const pct = Math.round((scores.correct / scores.total) * 100);
    const domainName = domain.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const barColor = pct >= 70 ? "#00944F" : pct >= 40 ? "#FFCA3A" : "#D94040";
    return `<tr>
      <td style="padding:8px 12px;color:#c8d6e5;font-size:14px;border-bottom:1px solid #1e3a5f;">${domainName}</td>
      <td style="padding:8px 12px;color:#fff;font-size:14px;border-bottom:1px solid #1e3a5f;text-align:center;">${scores.correct}/${scores.total}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1e3a5f;width:120px;">
        <div style="background:#0d2137;border-radius:4px;height:8px;width:100%;">
          <div style="background:${barColor};border-radius:4px;height:8px;width:${pct}%;"></div>
        </div>
      </td>
      <td style="padding:8px 12px;color:#fff;font-size:14px;border-bottom:1px solid #1e3a5f;text-align:right;font-weight:600;">${pct}%</td>
    </tr>`;
  }).join("");

  // Level breakdown rows — group questions by level and count correct/total
  const levelScoresEmail: Record<string, { correct: number; total: number }> = {};
  for (const qd of result.questionDetails) {
    const lev = qd.level || "Unknown";
    if (!levelScoresEmail[lev]) levelScoresEmail[lev] = { correct: 0, total: 0 };
    levelScoresEmail[lev].total++;
    if (qd.isCorrect) levelScoresEmail[lev].correct++;
  }
  const levelOrderEmail = ["Wireman 1", "Wireman 2", "Wireman 3", "Wireman 4", "Journeyman", "Leadman", "Foreman", "Superintendent"];
  const levelRows = Object.entries(levelScoresEmail)
    .sort((a, b) => {
      const ai = levelOrderEmail.indexOf(a[0]);
      const bi = levelOrderEmail.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([level, scores]) => {
      const pct = Math.round((scores.correct / scores.total) * 100);
      const barColor = pct >= 70 ? "#00944F" : pct >= 40 ? "#FFCA3A" : "#D94040";
      const levelName = level.replace(/wireman(\d)/i, "Wireman $1");
      return `<tr>
        <td style="padding:8px 12px;color:#c8d6e5;font-size:14px;border-bottom:1px solid #1e3a5f;">${levelName}</td>
        <td style="padding:8px 12px;color:#fff;font-size:14px;border-bottom:1px solid #1e3a5f;text-align:center;">${scores.correct}/${scores.total}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e3a5f;width:120px;">
          <div style="background:#0d2137;border-radius:4px;height:8px;width:100%;">
            <div style="background:${barColor};border-radius:4px;height:8px;width:${pct}%;"></div>
          </div>
        </td>
        <td style="padding:8px 12px;color:#fff;font-size:14px;border-bottom:1px solid #1e3a5f;text-align:right;font-weight:600;">${pct}%</td>
      </tr>`;
    }).join("");

  // Question detail rows
  const questionRows = result.questionDetails.map((qd) => {
    const qLevelLabel = qd.level.replace(/wireman(\d)/i, "Wireman $1").replace(/journeyman/i, "Journeyman").replace(/leadman/i, "Leadman").replace(/foreman/i, "Foreman").replace(/superintendent/i, "Superintendent");
    const domainLabel = qd.domain.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const statusColor = qd.isCorrect ? "#00944F" : "#D94040";
    const statusIcon = qd.isCorrect ? "&#10003;" : "&#10007;";
    const statusText = qd.isCorrect ? "Correct" : "Incorrect";
    const incorrectRow = !qd.isCorrect ? `<div style="color:#6adb90;font-size:12px;margin-top:4px;">Correct answer: ${qd.correctAnswer}</div>` : "";
    return `<tr>
      <td style="padding:12px;border-bottom:1px solid #1e3a5f;vertical-align:top;width:110px;">
        <div style="color:${statusColor};font-size:12px;font-weight:700;">${statusIcon} ${statusText}</div>
        <div style="color:#8faabe;font-size:11px;margin-top:6px;">${qLevelLabel}</div>
        <div style="color:#6a8ea5;font-size:10px;">${domainLabel}</div>
      </td>
      <td style="padding:12px;border-bottom:1px solid #1e3a5f;vertical-align:top;">
        <div style="color:#e8edf2;font-size:14px;line-height:1.4;">${qd.question}</div>
        <div style="color:#9db8cc;font-size:13px;margin-top:6px;">Answer: <span style="color:${qd.isCorrect ? '#6adb90' : '#f07070'};font-weight:600;">${qd.candidateAnswer}</span></div>
        ${incorrectRow}
      </td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a1929;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1929;padding:24px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#0d2a4a;border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;border-bottom:3px solid #136BAC;">
    <div style="width:56px;height:56px;background:#fff;border-radius:50%;margin:0 auto 16px;line-height:56px;text-align:center;">
      <span style="color:#0d2a4a;font-weight:800;font-size:20px;">CSE</span>
    </div>
    <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:3px;text-transform:uppercase;">Canyon State Electric</div>
    <div style="font-size:12px;font-weight:600;color:#FFCA3A;letter-spacing:2px;text-transform:uppercase;margin-top:6px;">Skills Assessment Report</div>
    <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:8px;">Test Version ${result.testVersion}</div>
  </td></tr>

  <!-- Candidate Info -->
  <tr><td style="background:#0f2d4f;padding:24px 40px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="color:#8faabe;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;">Candidate</td>
        <td style="color:#8faabe;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;text-align:right;">Date</td>
      </tr>
      <tr>
        <td style="color:#fff;font-size:18px;font-weight:700;padding-bottom:12px;">${result.firstName} ${result.lastName}</td>
        <td style="color:#c8d6e5;font-size:14px;padding-bottom:12px;text-align:right;">${dateStr} &middot; ${timeStr}</td>
      </tr>
      <tr>
        <td style="color:#8faabe;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;">Language</td>
        <td style="color:#8faabe;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;text-align:right;">Time Elapsed</td>
      </tr>
      <tr>
        <td style="color:#c8d6e5;font-size:14px;">${languageLabel}</td>
        <td style="color:#c8d6e5;font-size:14px;text-align:right;">${result.timeElapsed}</td>
      </tr>
      <tr>
        <td colspan="2" style="color:#8faabe;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding-top:12px;padding-bottom:4px;">Test Version</td>
      </tr>
      <tr>
        <td colspan="2" style="color:#c8d6e5;font-size:14px;">${result.testVersion}</td>
      </tr>
    </table>
  </td></tr>

  <!-- Diagnosed Level Banner -->
  <tr><td style="background:#136BAC;padding:20px 40px;text-align:center;">
    <div style="color:rgba(255,255,255,0.7);font-size:11px;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;">Diagnosed Level</div>
    <div style="color:#fff;font-size:28px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">${levelLabel}</div>
    <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:4px;">Confidence: ${result.levelConfidence}%</div>
    ${result.borderline && result.secondaryLevel ? `<div style="color:#FFCA3A;font-size:12px;margin-top:6px;">Borderline &mdash; possible range: ${levelLabel} to ${result.secondaryLevel.replace(/wireman(\d)/i, 'Wireman $1')}</div>` : ''}
    ${result.submissionNote ? `<div style="color:#FFCA3A;font-size:12px;margin-top:6px;font-weight:600;">${result.submissionNote}</div>` : ''}
    ${result.lowConfidence ? `<div style="color:#FFCA3A;font-size:11px;margin-top:4px;">Low Confidence \u2014 fewer than 30 questions answered</div>` : ''}
  </td></tr>

  <!-- Summary Stats -->
  <tr><td style="background:#0f2d4f;padding:24px 40px;">
    <div style="color:#FFCA3A;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;">Summary</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px;">
          <div style="color:#fff;font-size:28px;font-weight:800;">${result.totalQuestions}</div>
          <div style="color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Questions</div>
        </td>
        <td align="center" style="padding:8px;">
          <div style="color:#fff;font-size:28px;font-weight:800;">${result.correctAnswers}</div>
          <div style="color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Correct</div>
        </td>
        <td align="center" style="padding:8px;">
          <div style="color:#00944F;font-size:28px;font-weight:800;">${overallPct}%</div>
          <div style="color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Score</div>
        </td>
        <td align="center" style="padding:8px;">
          <div style="color:#fff;font-size:28px;font-weight:800;">${result.theta.toFixed(1)}</div>
          <div style="color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Ability (&theta;)</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Domain Breakdown -->
  <tr><td style="background:#0d2a4a;padding:24px 40px;">
    <div style="color:#FFCA3A;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;">Domain Breakdown</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:6px 12px;color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #1e3a5f;">Domain</td>
        <td style="padding:6px 12px;color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #1e3a5f;text-align:center;">Score</td>
        <td style="padding:6px 12px;color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #1e3a5f;">Progress</td>
        <td style="padding:6px 12px;color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #1e3a5f;text-align:right;">%</td>
      </tr>
      ${domainRows}
    </table>
  </td></tr>

  <!-- Level Breakdown -->
  <tr><td style="background:#0f2d4f;padding:24px 40px;">
    <div style="color:#FFCA3A;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;">Performance by Level</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:6px 12px;color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #1e3a5f;">Level</td>
        <td style="padding:6px 12px;color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #1e3a5f;text-align:center;">Score</td>
        <td style="padding:6px 12px;color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #1e3a5f;">Progress</td>
        <td style="padding:6px 12px;color:#8faabe;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #1e3a5f;text-align:right;">%</td>
      </tr>
      ${levelRows}
    </table>
  </td></tr>

  <!-- Question Detail -->
  <tr><td style="background:#0d2a4a;padding:24px 40px;">
    <div style="color:#FFCA3A;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px;">Question-by-Question Detail</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${questionRows}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#0d2a4a;border-radius:0 0 12px 12px;padding:20px 40px;text-align:center;border-top:1px solid #1e3a5f;">
    <div style="color:#5a7a8f;font-size:12px;">Canyon State Electric &mdash; Employee Owned</div>
    <div style="color:#3d5a6f;font-size:11px;margin-top:4px;">Adaptive Skills Assessment System &middot; v${result.testVersion}</div>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}


interface QuestionDetail {
  number: number;
  level: string;
  domain: string;
  question: string;
  candidateAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
}

interface EmailResult {
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
  borderline: boolean;
  secondaryLevel: string | null;
  questionDetails: QuestionDetail[];
  language: string;
  timeElapsed: string;
  testVersion: string;
  lowConfidence?: boolean;
  submissionNote?: string;
}

// Primary: Brevo HTTP API (works on all cloud platforms including Railway)
async function sendViaBrevoAPI(result: EmailResult, emailBody: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("BREVO_API_KEY environment variable not set");
  const subject = `Skills Assessment: ${result.firstName} ${result.lastName} \u2014 ${result.diagnosedLevel}`;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Canyon State Electric Assessment", email: "info@cseci.com" },
      to: [{ email: "careers@cseci.com", name: "CSE Careers" }],
      subject,
      htmlContent: emailBody,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Brevo API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  console.log(`[Brevo API] Email sent for session ${result.sessionId}: messageId=${data.messageId}`);
  return true;
}

// Fallback: SMTP via nodemailer (port 465 SSL)
async function sendViaSMTP(result: EmailResult, emailBody: string): Promise<boolean> {
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  await transporter.sendMail({
    from: `"Canyon State Electric Assessment" <info@cseci.com>`,
    to: "careers@cseci.com",
    subject: `Skills Assessment: ${result.firstName} ${result.lastName} \u2014 ${result.diagnosedLevel}`,
    html: emailBody,
  });

  console.log(`[SMTP:465] Email sent for session ${result.sessionId}`);
  return true;
}

// Send results via email — tries Brevo HTTP API first (Railway blocks SMTP), then SMTP as fallback
async function sendResultsEmail(result: EmailResult): Promise<boolean> {
  const emailBody = buildEmailBody(result);

  // Try Brevo HTTP API first (works over HTTPS port 443, not blocked by Railway)
  try {
    return await sendViaBrevoAPI(result, emailBody);
  } catch (err: any) {
    console.error("[Brevo API] Failed:", err.message);
  }

  // Fallback to SMTP on port 465 (SSL) — works in non-Railway environments
  try {
    return await sendViaSMTP(result, emailBody);
  } catch (err: any) {
    console.error("[SMTP:465] Failed:", err.message);
  }

  console.error(`All email methods failed for session ${result.sessionId}`);
  return false;
}
