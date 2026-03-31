/**
 * Computerized Adaptive Testing (CAT) Engine
 * Uses Item Response Theory (IRT) 2-Parameter Logistic Model
 * to adaptively select questions and estimate candidate ability.
 */

import type { Question, CATState } from "../shared/schema";

// 2PL IRT probability of correct response
function probability(theta: number, difficulty: number, discrimination: number): number {
  const exponent = discrimination * (theta - difficulty);
  return 1 / (1 + Math.exp(-exponent));
}

// Fisher information for a question at a given theta
function fisherInformation(theta: number, question: Question): number {
  const p = probability(theta, question.difficulty, question.discrimination);
  const q = 1 - p;
  return question.discrimination * question.discrimination * p * q;
}

// Update theta using Newton-Raphson method (MLE with Bayesian prior)
export function updateTheta(state: CATState, questions: Question[]): { theta: number; se: number } {
  let theta = state.theta;

  // Use EAP (Expected A Posteriori) estimation with normal prior
  const priorMean = 0;
  const priorVariance = 4; // Wide prior SD=2

  for (let iteration = 0; iteration < 30; iteration++) {
    let numerator = (priorMean - theta) / priorVariance; // Prior contribution
    let denominator = 1 / priorVariance;

    for (const resp of state.responses) {
      const q = questions.find(qq => qq.id === resp.questionId);
      if (!q) continue;

      const p = probability(theta, q.difficulty, q.discrimination);
      const u = resp.correct ? 1 : 0;

      numerator += q.discrimination * (u - p);
      denominator += q.discrimination * q.discrimination * p * (1 - p);
    }

    if (denominator === 0) break;

    const delta = numerator / denominator;
    theta += delta;

    // Clamp theta to reasonable range
    theta = Math.max(-4, Math.min(4, theta));

    if (Math.abs(delta) < 0.001) break;
  }

  // Calculate standard error
  let information = 1 / priorVariance;
  for (const resp of state.responses) {
    const q = questions.find(qq => qq.id === resp.questionId);
    if (!q) continue;
    information += fisherInformation(theta, q);
  }
  const se = 1 / Math.sqrt(information);

  return { theta, se };
}

// Fisher-Yates shuffle helper
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Level-to-theta mapping: questions from a level are only eligible
// when the candidate's theta is at or above the level's lower boundary.
// This prevents low-level candidates from seeing management/leadership questions.
const LEVEL_THETA_GATE: Record<string, number> = {
  wireman1: -4,      // always eligible
  wireman2: -1.5,
  wireman3: -0.5,
  wireman4: 0.5,
  journeyman: 1.0,
  leadman: 1.5,
  foreman: 2.0,
  superintendent: 2.5,
};

// Select the next best question using Maximum Fisher Information
// with level gating and randomization among top candidates
export function selectNextQuestion(state: CATState, questions: Question[]): Question | null {
  // Filter out already-answered questions
  let available = questions.filter(q => !state.answeredIds.includes(q.id));

  if (available.length === 0) return null;

  // Level gating: only allow questions from levels the candidate has reached.
  // A candidate must have theta >= the level's lower boundary to receive questions from that level.
  // We also always allow questions from one level above current theta to probe upward.
  const currentLevel = diagnoseLevel(state.theta);
  const levelOrder = ["wireman1", "wireman2", "wireman3", "wireman4", "journeyman", "leadman", "foreman", "superintendent"];
  const currentLevelIndex = levelOrder.indexOf(currentLevel.toLowerCase().replace(/\s+/g, ''));
  const maxAllowedLevelIndex = Math.min(currentLevelIndex + 1, levelOrder.length - 1);

  available = available.filter(q => {
    const qLevelIndex = levelOrder.indexOf(q.level);
    return qLevelIndex >= 0 && qLevelIndex <= maxAllowedLevelIndex;
  });

  if (available.length === 0) {
    // Fallback: if no questions available after gating, use all unanswered
    available = questions.filter(q => !state.answeredIds.includes(q.id));
    if (available.length === 0) return null;
  }

  // Score all available questions by Fisher information with domain balancing
  const scored = available.map(q => {
    const info = fisherInformation(state.theta, q);

    // Add content balancing: slightly penalize domains that have been over-tested
    const domainCount = state.responses.filter(r => {
      const rq = questions.find(qq => qq.id === r.questionId);
      return rq && rq.domain === q.domain;
    }).length;
    const domainPenalty = domainCount * 0.05;

    return { question: q, adjustedInfo: info - domainPenalty };
  });

  // Sort by adjusted information (descending)
  scored.sort((a, b) => b.adjustedInfo - a.adjustedInfo);

  // Take the top candidates that are within 80% of the best information value.
  // This creates a pool of similarly-informative questions from which we randomly select,
  // achieving randomization within each difficulty tier/level.
  const bestInfo = scored[0].adjustedInfo;
  const threshold = bestInfo * 0.8;
  const topCandidates = scored.filter(s => s.adjustedInfo >= threshold);

  // Shuffle the top candidates and pick the first one
  const shuffled = shuffleArray(topCandidates);
  return shuffled[0]?.question || scored[0]?.question || null;
}

// Check if we should stop the test
// Minimum raised to 25 to ensure adequate sampling across levels;
// candidates at higher levels must answer enough questions to demonstrate breadth.
export function shouldTerminate(state: CATState, minQuestions: number = 25, maxQuestions: number = 50): {
  terminate: boolean;
  reason: string;
} {
  const numAnswered = state.responses.length;

  // Minimum questions not met
  if (numAnswered < minQuestions) {
    return { terminate: false, reason: "minimum_not_reached" };
  }

  // Maximum questions reached
  if (numAnswered >= maxQuestions) {
    return { terminate: true, reason: "max_questions" };
  }

  // Standard error is small enough for confident classification
  if (state.se < 0.30) {
    return { terminate: true, reason: "precision_reached" };
  }

  // If after 35 questions SE is still moderate, check if classification is stable
  if (numAnswered >= 35 && state.se < 0.45) {
    return { terminate: true, reason: "adequate_precision" };
  }

  return { terminate: false, reason: "continuing" };
}

// Map theta to diagnosed level
export function diagnoseLevel(theta: number): string {
  // Level boundaries based on IRT difficulty ranges
  if (theta < -1.5) return "Wireman 1";
  if (theta < -0.5) return "Wireman 2";
  if (theta < 0.5) return "Wireman 3";
  if (theta < 1.0) return "Wireman 4";
  if (theta < 1.5) return "Journeyman";
  if (theta < 2.0) return "Leadman";
  if (theta < 2.5) return "Foreman";
  return "Superintendent";
}

// Get level confidence as a percentage
export function getLevelConfidence(theta: number, se: number): number {
  const level = diagnoseLevel(theta);
  const boundaries = getLevelBoundaries(level);

  // Probability that true ability falls within the diagnosed level's range
  const lowerZ = (boundaries.lower - theta) / se;
  const upperZ = (boundaries.upper - theta) / se;

  const pLower = normalCDF(lowerZ);
  const pUpper = normalCDF(upperZ);

  return Math.round((pUpper - pLower) * 100);
}

function getLevelBoundaries(level: string): { lower: number; upper: number } {
  const boundaries: Record<string, { lower: number; upper: number }> = {
    "Wireman 1": { lower: -4, upper: -1.5 },
    "Wireman 2": { lower: -1.5, upper: -0.5 },
    "Wireman 3": { lower: -0.5, upper: 0.5 },
    "Wireman 4": { lower: 0.5, upper: 1.0 },
    "Journeyman": { lower: 1.0, upper: 1.5 },
    "Leadman": { lower: 1.5, upper: 2.0 },
    "Foreman": { lower: 2.0, upper: 2.5 },
    "Superintendent": { lower: 2.5, upper: 4 },
  };
  return boundaries[level] || { lower: -4, upper: 4 };
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// Calculate domain-level breakdown
export function getDomainScores(
  responses: Array<{ questionId: number; correct: boolean }>,
  questions: Question[]
): Record<string, { correct: number; total: number }> {
  const scores: Record<string, { correct: number; total: number }> = {};

  for (const resp of responses) {
    const q = questions.find(qq => qq.id === resp.questionId);
    if (!q) continue;

    if (!scores[q.domain]) {
      scores[q.domain] = { correct: 0, total: 0 };
    }
    scores[q.domain].total++;
    if (resp.correct) {
      scores[q.domain].correct++;
    }
  }

  return scores;
}
