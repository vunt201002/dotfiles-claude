import { readJson, writeJsonAtomic } from './store';

export interface PendingQuestion {
  id: string;
  taskId: string;
  project?: string;
  issue?: string;
  text: string;
  createdAt: number;
}

export interface PendingApproval {
  shortId: string;
  taskId: string;
  action: string;
  detail?: string;
  diff?: string;
  chatId?: string;
  messageId?: number;
  resolved: boolean;
  createdAt: number;
}

interface PendingShape {
  questions: PendingQuestion[];
  approvals: PendingApproval[];
  seq: number;
}

const APPROVAL_KEEP = 200;

/**
 * Open questions (numbered for `"1: ..."` replies) and open approvals
 * (short ids keep Telegram callback_data inside its 64-byte budget).
 */
export class PendingStore {
  private questions: PendingQuestion[];
  private approvals: PendingApproval[];
  private seq: number;

  private constructor(private readonly file: string, shape: PendingShape) {
    this.questions = shape.questions;
    this.approvals = shape.approvals;
    this.seq = shape.seq;
  }

  static load(file: string): PendingStore {
    const result = readJson<PendingShape>(file);
    if (!result.ok && result.kind === 'error') {
      throw new Error(`cannot read pending Telegram actions: ${result.reason}`);
    }
    const shape = result.ok ? result.value : { questions: [], approvals: [], seq: 0 };
    return new PendingStore(file, {
      questions: Array.isArray(shape.questions) ? shape.questions : [],
      approvals: Array.isArray(shape.approvals) ? shape.approvals : [],
      seq: Number.isFinite(shape.seq) ? shape.seq : 0,
    });
  }

  listQuestions(): readonly PendingQuestion[] {
    return this.questions;
  }

  get questionCount(): number {
    return this.questions.length;
  }

  addQuestion(input: Omit<PendingQuestion, 'id' | 'createdAt'>): PendingQuestion {
    const existing = this.questions.find((q) => q.taskId === input.taskId && q.text === input.text);
    if (existing) return existing;
    this.seq += 1;
    const question: PendingQuestion = { ...input, id: `q${this.seq}`, createdAt: Date.now() };
    this.questions.push(question);
    this.persist();
    return question;
  }

  questionAt(oneBasedIndex: number): PendingQuestion | undefined {
    return this.questions[oneBasedIndex - 1];
  }

  removeQuestion(id: string): void {
    const before = this.questions.length;
    this.questions = this.questions.filter((q) => q.id !== id);
    if (this.questions.length !== before) this.persist();
  }

  addApproval(input: Omit<PendingApproval, 'shortId' | 'resolved' | 'createdAt'>): PendingApproval {
    this.seq += 1;
    const approval: PendingApproval = {
      ...input,
      shortId: `k${this.seq}`,
      resolved: false,
      createdAt: Date.now(),
    };
    this.approvals.push(approval);
    if (this.approvals.length > APPROVAL_KEEP) {
      this.approvals = this.approvals.slice(-APPROVAL_KEEP);
    }
    this.persist();
    return approval;
  }

  getApproval(shortId: string): PendingApproval | undefined {
    return this.approvals.find((a) => a.shortId === shortId);
  }

  setApprovalMessage(shortId: string, chatId: string, messageId: number): void {
    const approval = this.getApproval(shortId);
    if (!approval) return;
    approval.chatId = chatId;
    approval.messageId = messageId;
    this.persist();
  }

  resolveApproval(shortId: string): boolean {
    const approval = this.getApproval(shortId);
    if (!approval || approval.resolved) return false;
    approval.resolved = true;
    this.persist();
    return true;
  }

  private persist(): void {
    writeJsonAtomic(this.file, { questions: this.questions, approvals: this.approvals, seq: this.seq });
  }
}
