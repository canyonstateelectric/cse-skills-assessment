import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertTestSessionSchema } from "../shared/schema";
import type { CATState, Question } from "../shared/schema";
import {
  updateTheta,
  selectNextQuestion,
  shouldTerminate,
  diagnoseLevel,
  getLevelConfidence,
  getDomainScores,
} from "./cat-engine";

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

  // Submit an answer and get next question
  app.post("/api/sessions/:id/answer", async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { questionId, selectedAnswer } = req.body;

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

      // Check correctness
      const isCorrect = selectedAnswer === question.correctAnswer;

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
        selectedAnswer,
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
        const confidence = getLevelConfidence(theta, se);
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
          const selAnswer = resp.questionId === questionId ? selectedAnswer : storedResp?.selectedAnswer ?? 0;
          return {
            number: idx + 1,
            level: q.level,
            domain: q.domain,
            question: q.question,
            candidateAnswer: q.options[selAnswer] || `Option ${selAnswer}`,
            correctAnswer: q.options[q.correctAnswer] || `Option ${q.correctAnswer}`,
            isCorrect: resp.correct,
          };
        }).filter(Boolean) as QuestionDetail[];

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
          questionDetails,
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

// Build email body text
function buildEmailBody(result: EmailResult): string {
  const domainBreakdown = Object.entries(result.domainScores)
    .map(([domain, scores]) => {
      const pct = Math.round((scores.correct / scores.total) * 100);
      const domainName = domain.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      return `  ${domainName}: ${scores.correct}/${scores.total} (${pct}%)`;
    })
    .join("\n");

  // Build question-by-question detail
  const questionLines = result.questionDetails.map((qd) => {
    const status = qd.isCorrect ? "✓ CORRECT" : "✗ INCORRECT";
    const levelLabel = qd.level.replace(/wireman/i, "Wireman ").replace(/journeyman/i, "Journeyman").replace(/leadman/i, "Leadman").replace(/foreman/i, "Foreman").replace(/superintendent/i, "Superintendent");
    const domainLabel = qd.domain.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    let line = `  Q${qd.number}. [${levelLabel}] [${domainLabel}] ${status}\n`;
    line += `      Question: ${qd.question}\n`;
    line += `      Candidate's Answer: ${qd.candidateAnswer}\n`;
    if (!qd.isCorrect) {
      line += `      Correct Answer: ${qd.correctAnswer}\n`;
    }
    return line;
  }).join("\n");

  return `
CANYON STATE ELECTRIC — ELECTRICIAN SKILLS ASSESSMENT RESULTS
═══════════════════════════════════════════════════════════════

Candidate: ${result.firstName} ${result.lastName}
Date: ${new Date().toLocaleDateString("en-US", { timeZone: "America/Phoenix" })}
Time: ${new Date().toLocaleTimeString("en-US", { timeZone: "America/Phoenix" })}

═══════════════════════════════════════════════════════════════
DIAGNOSED LEVEL: ${result.diagnosedLevel.toUpperCase()}
Confidence: ${result.levelConfidence}%
═══════════════════════════════════════════════════════════════

SUMMARY
  Questions Answered: ${result.totalQuestions}
  Correct Answers: ${result.correctAnswers}
  Overall Score: ${Math.round((result.correctAnswers / result.totalQuestions) * 100)}%
  Ability Estimate (θ): ${result.theta.toFixed(2)}
  Standard Error: ${result.se.toFixed(2)}

DOMAIN BREAKDOWN
${domainBreakdown}

═══════════════════════════════════════════════════════════════
QUESTION-BY-QUESTION DETAIL
═══════════════════════════════════════════════════════════════

${questionLines}

═══════════════════════════════════════════════════════════════
This assessment was administered via the Canyon State Electric
Adaptive Skills Assessment System.
═══════════════════════════════════════════════════════════════
  `.trim();
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
  questionDetails: QuestionDetail[];
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
      textContent: emailBody,
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
    text: emailBody,
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
