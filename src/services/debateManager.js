import { generateDebateResponse, generateOpeningArgument, analyzeForFallacies } from './ollama.js';
import { researchDebateTopic, findCounterArguments } from './webSearch.js';

const FALLACY_THRESHOLD = 3; // Number of fallacies before declaring victory
const INACTIVITY_THRESHOLD = 3; // Non-substantive responses before victory
const MIN_RESPONSE_LENGTH = 20; // Minimum characters for a "real" response

export class DebateManager {
  constructor() {
    // Map of thread ID -> debate state
    this.debates = new Map();
  }

  /**
   * Create a new debate
   */
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
      researchCache: null,
    };

    this.debates.set(threadId, debate);
    return debate;
  }

  /**
   * Get an active debate by thread ID
   */
  getDebate(threadId) {
    return this.debates.get(threadId);
  }

  /**
   * End a debate
   */
  endDebate(threadId) {
    const debate = this.debates.get(threadId);
    if (debate) {
      debate.status = 'ended';
      // Keep it around for a bit for reference, then clean up
      setTimeout(() => this.debates.delete(threadId), 3600000); // 1 hour
    }
  }

  /**
   * Generate a response for the debate
   */
  async generateResponse(debate, opponentMessage, isOpening = false) {
    debate.lastActivity = Date.now();

    // Handle opening argument
    if (isOpening) {
      return this.generateOpening(debate);
    }

    // Check for non-substantive response (potential concession)
    if (this.isNonSubstantive(opponentMessage)) {
      debate.opponentInactiveCount++;
    } else {
      debate.opponentInactiveCount = 0; // Reset on substantive response
    }

    // Add opponent's message to history
    debate.messages.push({
      role: 'user',
      content: opponentMessage,
    });

    // Analyze opponent's message for fallacies
    const fallacyAnalysis = await analyzeForFallacies(opponentMessage);
    if (fallacyAnalysis && !fallacyAnalysis.includes('No significant fallacies')) {
      debate.fallacyCount++;
    }

    // Check for victory condition
    if (debate.fallacyCount >= FALLACY_THRESHOLD) {
      debate.status = 'won';
    }

    // Occasionally do additional research based on opponent's points
    let additionalResearch = null;
    if (Math.random() < 0.3 && opponentMessage.length > 50) {
      // Extract key claims and research counter-arguments
      additionalResearch = await findCounterArguments(opponentMessage.substring(0, 200));
    }

    // Combine cached research with any new research
    const researchContext = [debate.researchCache, additionalResearch]
      .filter(Boolean)
      .join('\n\n');

    // Generate response
    const response = await generateDebateResponse(
      debate.messages,
      debate.subject,
      researchContext || null
    );

    // Add bot's response to history
    debate.messages.push({
      role: 'assistant',
      content: response,
    });

    // Check if the response indicates victory
    if (response.includes('[VICTORY]')) {
      debate.status = 'won';
      return response.replace('[VICTORY]', '').trim();
    }

    // Trim history if it gets too long (keep last 20 messages)
    if (debate.messages.length > 20) {
      debate.messages = debate.messages.slice(-20);
    }

    return response;
  }

  /**
   * Generate opening argument with research
   */
  async generateOpening(debate) {
    // Research the topic for better arguments
    console.log(`Researching topic: ${debate.subject}`);
    debate.researchCache = await researchDebateTopic(debate.subject);

    const opening = await generateOpeningArgument(debate.subject, debate.researchCache);

    // Add to message history
    debate.messages.push({
      role: 'assistant',
      content: opening,
    });

    return opening;
  }

  /**
   * Check if a response is non-substantive
   */
  isNonSubstantive(message) {
    if (!message || message.length < MIN_RESPONSE_LENGTH) {
      return true;
    }

    const nonSubstantivePatterns = [
      /^(ok|okay|sure|whatever|fine|lol|lmao|idk|nah)$/i,
      /^(i don'?t care|i give up|you win|nevermind)$/i,
      /^(haha|hehe|rofl|xd+)$/i,
      /^\.+$/,
      /^emoji/i,
    ];

    const lowerMessage = message.toLowerCase().trim();
    return nonSubstantivePatterns.some(pattern => pattern.test(lowerMessage));
  }

  /**
   * Get stats for a debate
   */
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

  /**
   * List all active debates
   */
  getActiveDebates() {
    return Array.from(this.debates.entries())
      .filter(([_, debate]) => debate.status === 'active')
      .map(([threadId, debate]) => ({
        threadId,
        subject: debate.subject,
        participantId: debate.participantId,
      }));
  }
}
