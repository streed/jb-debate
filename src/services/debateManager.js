import { generateDebateResponse, generateOpeningArgument, analyzeForFallacies } from './ollama.js';
import { logger } from './logger.js';

const FALLACY_THRESHOLD = 3;  // Fewer fallacies needed - be aggressive
const MIN_RESPONSE_LENGTH = 20;
const WEAK_ARGUMENT_THRESHOLD = 2;  // Consecutive weak responses = loss

export class DebateManager {
  constructor() {
    this.debates = new Map();
  }

  createDebate(threadId, participantId, subject) {
    const debate = {
      threadId,
      participantId,
      subject,
      messages: [],
      status: 'active',
      fallacyCount: 0,
      opponentInactiveCount: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.debates.set(threadId, debate);
    return debate;
  }

  getDebate(threadId) {
    return this.debates.get(threadId);
  }

  endDebate(threadId) {
    const debate = this.debates.get(threadId);
    if (debate) {
      debate.status = 'ended';
      setTimeout(() => this.debates.delete(threadId), 3600000);
    }
  }

  async generateResponse(debate, opponentMessage, isOpening = false, threadHistory = null) {
    debate.lastActivity = Date.now();

    if (isOpening) {
      // formatWithSources already handles condensing
      return await generateOpeningArgument(debate.subject);
    }

    // Check for non-substantive response
    if (this.isNonSubstantive(opponentMessage)) {
      debate.opponentInactiveCount++;
    } else {
      debate.opponentInactiveCount = 0;
    }

    // Analyze for fallacies
    const fallacyAnalysis = await analyzeForFallacies(opponentMessage);
    if (fallacyAnalysis && !fallacyAnalysis.includes('No significant fallacies')) {
      debate.fallacyCount++;
      logger.debate('fallacy_detected', { count: debate.fallacyCount });
    }

    if (debate.fallacyCount >= FALLACY_THRESHOLD) {
      debate.status = 'won';
    }

    // Use thread history if provided, otherwise fall back to internal tracking
    const messages = threadHistory
      ? threadHistory.map(m => ({ role: m.role, content: m.content }))
      : [...debate.messages, { role: 'user', content: opponentMessage }];

    // Generate response using thread context
    let response = await generateDebateResponse(messages, debate.subject);

    if (response.includes('[VICTORY]')) {
      debate.status = 'won';
      response = response.replace('[VICTORY]', '').trim();
    }

    // formatWithSources already handles condensing
    return response;
  }

  isNonSubstantive(message) {
    if (!message || message.length < MIN_RESPONSE_LENGTH) return true;

    const patterns = [
      /^(ok|okay|sure|whatever|fine|lol|lmao|idk|nah)$/i,
      /^(i don'?t care|i give up|you win|nevermind)$/i,
      /^(haha|hehe|rofl|xd+)$/i,
      /^\.+$/,
    ];

    return patterns.some(p => p.test(message.toLowerCase().trim()));
  }

  getDebateStats(threadId) {
    const debate = this.debates.get(threadId);
    if (!debate) return null;

    return {
      subject: debate.subject,
      messageCount: debate.messages.length,
      fallaciesDetected: debate.fallacyCount,
      status: debate.status,
      duration: Date.now() - debate.createdAt,
    };
  }

  getActiveDebates() {
    return Array.from(this.debates.entries())
      .filter(([_, d]) => d.status === 'active')
      .map(([threadId, d]) => ({ threadId, subject: d.subject, participantId: d.participantId }));
  }
}
