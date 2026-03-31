import type { 
  TestSession, InsertTestSession,
  TestResponse, InsertTestResponse,
  Question
} from "../shared/schema";
import questionsData from "./questions.json";

export interface IStorage {
  // Test sessions
  createSession(session: InsertTestSession): Promise<TestSession>;
  getSession(id: number): Promise<TestSession | undefined>;
  updateSession(id: number, updates: Partial<TestSession>): Promise<TestSession | undefined>;
  
  // Test responses
  addResponse(response: InsertTestResponse): Promise<TestResponse>;
  getResponsesBySession(sessionId: number): Promise<TestResponse[]>;
  
  // Questions
  getQuestions(): Question[];
  getQuestionById(id: number): Question | undefined;
}

export class MemStorage implements IStorage {
  private sessions: Map<number, TestSession> = new Map();
  private responses: Map<number, TestResponse> = new Map();
  private sessionCounter = 1;
  private responseCounter = 1;
  private questions: Question[];

  constructor() {
    this.questions = questionsData as Question[];
  }

  async createSession(session: InsertTestSession): Promise<TestSession> {
    const id = this.sessionCounter++;
    const newSession: TestSession = {
      id,
      firstName: session.firstName,
      lastName: session.lastName,
      language: session.language || "en",
      startedAt: new Date(),
      completedAt: null,
      currentTheta: 0,
      standardError: 3,
      diagnosedLevel: null,
      totalQuestions: 0,
      correctAnswers: 0,
      isComplete: false,
      emailSent: false,
    };
    this.sessions.set(id, newSession);
    return newSession;
  }

  async getSession(id: number): Promise<TestSession | undefined> {
    return this.sessions.get(id);
  }

  async updateSession(id: number, updates: Partial<TestSession>): Promise<TestSession | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const updated = { ...session, ...updates };
    this.sessions.set(id, updated);
    return updated;
  }

  async addResponse(response: InsertTestResponse): Promise<TestResponse> {
    const id = this.responseCounter++;
    const newResponse: TestResponse = {
      id,
      sessionId: response.sessionId,
      questionId: response.questionId,
      selectedAnswer: response.selectedAnswer,
      isCorrect: response.isCorrect,
      thetaAfter: response.thetaAfter,
      seAfter: response.seAfter,
      answeredAt: new Date(),
    };
    this.responses.set(id, newResponse);
    return newResponse;
  }

  async getResponsesBySession(sessionId: number): Promise<TestResponse[]> {
    return Array.from(this.responses.values()).filter(r => r.sessionId === sessionId);
  }

  getQuestions(): Question[] {
    return this.questions;
  }

  getQuestionById(id: number): Question | undefined {
    return this.questions.find(q => q.id === id);
  }
}

export const storage = new MemStorage();
