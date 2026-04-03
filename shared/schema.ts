import { pgTable, text, serial, integer, real, json, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Test sessions track each candidate's adaptive test
export const testSessions = pgTable("test_sessions", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  language: text("language").default("en"),
  testVersion: text("test_version").default("1.0"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  currentTheta: real("current_theta").default(0),
  standardError: real("standard_error").default(3),
  diagnosedLevel: text("diagnosed_level"),
  totalQuestions: integer("total_questions").default(0),
  correctAnswers: integer("correct_answers").default(0),
  isComplete: boolean("is_complete").default(false),
  emailSent: boolean("email_sent").default(false),
});

// Individual responses for each question answered
export const testResponses = pgTable("test_responses", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  questionId: integer("question_id").notNull(),
  selectedAnswer: integer("selected_answer").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  thetaAfter: real("theta_after").notNull(),
  seAfter: real("se_after").notNull(),
  answeredAt: timestamp("answered_at").defaultNow(),
});

export const insertTestSessionSchema = createInsertSchema(testSessions).omit({
  id: true,
  startedAt: true,
  completedAt: true,
  currentTheta: true,
  standardError: true,
  diagnosedLevel: true,
  totalQuestions: true,
  correctAnswers: true,
  isComplete: true,
  emailSent: true,
}).extend({
  language: z.enum(["en", "es"]).optional().default("en"),
});

export const insertTestResponseSchema = createInsertSchema(testResponses).omit({
  id: true,
  answeredAt: true,
});

export type InsertTestSession = z.infer<typeof insertTestSessionSchema>;
export type TestSession = typeof testSessions.$inferSelect;
export type InsertTestResponse = z.infer<typeof insertTestResponseSchema>;
export type TestResponse = typeof testResponses.$inferSelect;

// Types for the question bank (not stored in DB, loaded from JSON)
export interface Question {
  id: number;
  level: string;
  domain: string;
  type: string;
  question: string;
  options: string[];
  question_es: string;
  options_es: string[];
  correctAnswer: number;
  difficulty: number;
  discrimination: number;
  imageUrl: string | null;
}

// CAT algorithm types
export interface CATState {
  theta: number;        // Current ability estimate
  se: number;           // Standard error
  answeredIds: number[]; // Questions already shown
  responses: Array<{questionId: number; correct: boolean}>;
}

export interface TestResult {
  sessionId: number;
  firstName: string;
  lastName: string;
  diagnosedLevel: string;
  theta: number;
  se: number;
  totalQuestions: number;
  correctAnswers: number;
  domainScores: Record<string, {correct: number; total: number}>;
  levelConfidence: number;
}
