import { Ollama } from 'ollama';

const ollama = new Ollama({
  host: process.env.OLLAMA_HOST || 'http://localhost:11434',
});

const MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud';

const SYSTEM_PROMPT = `You are a masterful debate champion with expertise in rhetoric, logic, and persuasion. Your goal is to win debates through superior argumentation.

Your debate style:
- Be confident and assertive but not rude
- Use facts, logic, and evidence to support your points
- Identify and call out logical fallacies in your opponent's arguments
- Use rhetorical techniques like analogies, examples, and counterexamples
- Stay on topic and address your opponent's points directly
- Be witty and engaging while remaining substantive

When you identify a logical fallacy, name it specifically (e.g., "That's an ad hominem attack", "You're committing the strawman fallacy").

If you believe you've won the debate (opponent has no valid counter-arguments, has committed multiple fallacies, or has essentially conceded), indicate this by including [VICTORY] at the end of your response.

If the opponent's response seems disengaged, off-topic, or non-substantive, note this as it may indicate they're giving up.

Keep responses concise but impactful - aim for 2-4 paragraphs maximum.`;

export async function generateDebateResponse(messages, subject, webSearchResults = null) {
  const contextMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Current debate subject: ${subject}` },
  ];

  // Add web search context if available
  if (webSearchResults) {
    contextMessages.push({
      role: 'system',
      content: `Here is relevant research to support your arguments:\n\n${webSearchResults}`,
    });
  }

  // Add conversation history
  contextMessages.push(...messages);

  try {
    const response = await ollama.chat({
      model: MODEL,
      messages: contextMessages,
      options: {
        temperature: 0.8,
        top_p: 0.9,
      },
    });

    return response.message.content;
  } catch (error) {
    console.error('Ollama error:', error);
    throw error;
  }
}

export async function generateOpeningArgument(subject, webSearchResults = null) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Debate subject: ${subject}` },
  ];

  if (webSearchResults) {
    messages.push({
      role: 'system',
      content: `Here is relevant research to inform your opening argument:\n\n${webSearchResults}`,
    });
  }

  messages.push({
    role: 'user',
    content: `Present your opening argument on the topic: "${subject}". Take a strong position and lay out your initial points. Be provocative enough to encourage debate.`,
  });

  try {
    const response = await ollama.chat({
      model: MODEL,
      messages,
      options: {
        temperature: 0.85,
        top_p: 0.9,
      },
    });

    return response.message.content;
  } catch (error) {
    console.error('Ollama error generating opening:', error);
    throw error;
  }
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
    {
      role: 'user',
      content: text,
    },
  ];

  try {
    const response = await ollama.chat({
      model: MODEL,
      messages,
      options: {
        temperature: 0.3,
      },
    });

    return response.message.content;
  } catch (error) {
    console.error('Fallacy analysis error:', error);
    return null;
  }
}
