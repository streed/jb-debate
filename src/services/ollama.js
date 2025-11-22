import { Ollama } from 'ollama';
import { logger } from './logger.js';
import { WEB_TOOLS, processToolCalls } from './webSearch.js';

const ollama = new Ollama({
  host: process.env.OLLAMA_HOST || 'http://localhost:11434',
});

const MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';

const SYSTEM_PROMPT = `You are a sharp, witty debater who knows their stuff. Confident but not obnoxious.

RULES:
- You ALWAYS oppose the user. If they're pro-X, you're anti-X. If they're anti-X, you're pro-X.
- State your position clearly upfront. DEFEND IT consistently throughout.
- NEVER flip-flop or agree with the opponent. Stay on your side.
- If they make a good point, acknowledge it briefly then counter with something stronger.
- MAX 2-3 sentences. Keep it punchy.
- Use web_search for facts. Be accurate.
- Be confident and a bit sarcastic, but not cringe. Light teasing is fine, no meme-speak.
- Call out logical fallacies when you spot them, but be classy about it.
- If they dodge your points or use weak arguments, press them on it.
- Declare [VICTORY] when: they contradict themselves, commit multiple fallacies, give up, or can't respond.

Be sharp. Be witty. Win with facts.`;

async function chatWithTools(messages, options = {}, retries = 2, collectedSources = []) {
  const startTime = Date.now();
  let sources = [...collectedSources];

  logger.debug('ollama', 'Sending chat request', { msgCount: messages.length, tools: WEB_TOOLS.length });

  let response = await ollama.chat({
    model: MODEL,
    messages,
    tools: WEB_TOOLS,
    options: { temperature: 0.8, top_p: 0.9, ...options },
  });

  logger.debug('ollama', 'Initial response', {
    hasContent: !!response.message.content,
    contentLen: response.message.content?.length || 0,
    hasToolCalls: !!response.message.tool_calls?.length,
  });

  // Handle tool calls
  if (response.message.tool_calls && response.message.tool_calls.length > 0) {
    logger.ollama('tool_calls', { count: response.message.tool_calls.length });

    for (const tc of response.message.tool_calls) {
      logger.debug('ollama', 'Tool call details', {
        name: tc.function?.name,
        args: JSON.stringify(tc.function?.arguments),
      });
    }

    // Add assistant's response with tool calls
    const updatedMessages = [...messages, response.message];

    // Execute tools and add results
    const { messages: toolMessages, sources: toolSources } = await processToolCalls(response.message.tool_calls);
    sources.push(...toolSources);

    logger.debug('ollama', 'Tool results', {
      count: toolMessages.length,
      sources: sources.length,
    });

    updatedMessages.push(...toolMessages);

    // Add a nudge to help the model respond after tool results
    updatedMessages.push({
      role: 'user',
      content: 'Use the results. 1-2 sentences max. Be insufferably Reddit about it.',
    });

    logger.debug('ollama', 'Sending follow-up after tools', { msgCount: updatedMessages.length });

    // Get final response after tool execution
    response = await ollama.chat({
      model: MODEL,
      messages: updatedMessages,
      options: { temperature: 0.8, top_p: 0.9, ...options },
    });

    logger.debug('ollama', 'Post-tool response', {
      hasContent: !!response.message.content,
      contentLen: response.message.content?.length || 0,
      raw: response.message.content?.substring(0, 100) || '(empty)',
    });
  }

  let content = response.message.content?.trim();

  // Retry if empty response, preserving collected sources
  if (!content && retries > 0) {
    logger.warn('ollama', `Empty response, retrying (${retries} left) with ${sources.length} sources`);
    return chatWithTools(messages, options, retries - 1, sources);
  }

  // Fallback if still empty
  if (!content) {
    logger.warn('ollama', 'Empty response after retries, using fallback');
    return { content: "I'm ready to debate this topic. Present your argument and let's see if it holds up to scrutiny.", sources: [] };
  }

  // Return content and sources separately (sources appended after condensing)
  const uniqueSources = sources.length > 0
    ? [...new Map(sources.map(s => [s.url, s])).values()].slice(0, 3)
    : [];

  logger.debug('ollama', 'Returning with sources', { total: sources.length, unique: uniqueSources.length });
  logger.ollama('complete', { ms: Date.now() - startTime, len: content.length, sources: sources.length });

  return { content, sources: uniqueSources };
}

function getCurrentDateTime() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

async function formatWithSources(result) {
  logger.debug('ollama', 'formatWithSources input', {
    hasContent: !!result?.content,
    contentLen: result?.content?.length || 0,
    sourcesCount: result?.sources?.length || 0,
    sources: JSON.stringify(result?.sources || []),
  });

  // Condense the content first (without sources)
  let content = await condenseIfNeeded(result.content);

  logger.debug('ollama', 'After condense', { contentLen: content.length });

  // Append sources AFTER condensing so they don't get lost
  if (result.sources && result.sources.length > 0) {
    const sourceLinks = result.sources.map(s => `[${s.title}](${s.url})`).join(' | ');
    content += `\n\n📎 ${sourceLinks}`;
    logger.debug('ollama', 'Sources appended to final output', { count: result.sources.length, finalLen: content.length });
  } else {
    logger.debug('ollama', 'No sources to append in formatWithSources');
  }

  return content;
}

export async function generateDebateResponse(messages, subject) {
  const contextMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Current date/time: ${getCurrentDateTime()}` },
    { role: 'system', content: `Current debate subject: ${subject}` },
    ...messages,
  ];

  const result = await chatWithTools(contextMessages);
  return formatWithSources(result);
}

export async function generateOpeningArgument(subject) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Current date/time: ${getCurrentDateTime()}` },
    { role: 'system', content: `Debate subject: ${subject}` },
    {
      role: 'user',
      content: `Topic: "${subject}"

IMPORTANT: The user wants to debate this topic. If their topic implies a position (e.g., "X is good", "X sucks", "I love X"), you MUST take the OPPOSITE side. If it's neutral (e.g., just "pineapple on pizza"), pick the more contrarian/spicy take.

State your position clearly upfront like "I'm arguing that X" or "My position: X". Then give your opening argument. Use web_search for facts. Be brief but make your stance crystal clear.`,
    },
  ];

  const result = await chatWithTools(messages, { temperature: 0.85 });
  return formatWithSources(result);
}

export async function analyzeForFallacies(text) {
  const messages = [
    {
      role: 'system',
      content: `You are a logic expert. Analyze the following text for logical fallacies.
If you find fallacies, list them with brief explanations.
If the text is logically sound, say "No significant fallacies detected."
Be concise.`,
    },
    { role: 'user', content: text },
  ];

  try {
    const startTime = Date.now();
    const response = await ollama.chat({
      model: MODEL,
      messages,
      options: { temperature: 0.3 },
    });

    const hasFallacies = !response.message.content.includes('No significant fallacies');
    logger.ollama('fallacy', { ms: Date.now() - startTime, found: hasFallacies });

    return response.message.content;
  } catch (error) {
    logger.error('ollama', `Fallacy analysis failed: ${error.message}`);
    return null;
  }
}

const MAX_DISCORD_LENGTH = 500; // Short, punchy responses

export async function condenseIfNeeded(text, maxLength = MAX_DISCORD_LENGTH) {
  if (text.length <= maxLength) return text;

  logger.ollama('condensing', { from: text.length, to: maxLength });

  const messages = [
    {
      role: 'system',
      content: `Condense to under ${maxLength} chars. Keep it snarky, Reddit-style. 1-2 sentences max. Preserve the burn and any facts. No preamble.`,
    },
    { role: 'user', content: text },
  ];

  try {
    const response = await ollama.chat({
      model: MODEL,
      messages,
      options: { temperature: 0.3 },
    });

    const condensed = response.message.content.trim();
    logger.ollama('condensed', { len: condensed.length });

    // If still too long, truncate with ellipsis
    if (condensed.length > maxLength) {
      return condensed.substring(0, maxLength - 3) + '...';
    }

    return condensed;
  } catch (error) {
    logger.error('ollama', `Condense failed: ${error.message}`);
    // Fallback: just truncate
    return text.substring(0, maxLength - 3) + '...';
  }
}
