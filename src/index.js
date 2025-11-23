import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, ActivityType } from 'discord.js';
import { DebateManager } from './services/debateManager.js';
import { logger } from './services/logger.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

const debateManager = new DebateManager();

const DISCORD_MAX_LENGTH = 2000;

/**
 * Split a message into chunks that fit Discord's limit
 */
function splitMessage(text, maxLength = DISCORD_MAX_LENGTH) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a paragraph break
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Try to split at a sentence
      splitIndex = remaining.lastIndexOf('. ', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // Try to split at a space
        splitIndex = remaining.lastIndexOf(' ', maxLength);
        if (splitIndex === -1) {
          splitIndex = maxLength;
        }
      }
    }

    chunks.push(remaining.substring(0, splitIndex + 1).trim());
    remaining = remaining.substring(splitIndex + 1).trim();
  }

  return chunks;
}

/**
 * Send a potentially long message as multiple chunks
 */
async function sendLongMessage(channel, text) {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

// Patterns to trigger a debate
const DEBATE_TRIGGERS = [
  /^debate me\s+(.+)/i,
  /^let'?s fight about\s+(.+)/i,
  /^fight me on\s+(.+)/i,
  /^argue with me about\s+(.+)/i,
];

client.once('ready', () => {
  logger.info('bot', 'Bot logged in', {
    tag: client.user.tag,
    model: process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud',
    guilds: client.guilds.cache.size,
  });

  // Set bot presence/status
  client.user.setPresence({
    activities: [{ name: 'for "debate me"', type: ActivityType.Watching }],
    status: 'online',
  });
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Log all incoming messages
  logger.message(message);

  // Check if this is in an active debate thread
  if (message.channel.type === ChannelType.PublicThread ||
      message.channel.type === ChannelType.PrivateThread) {
    const debate = debateManager.getDebate(message.channel.id);
    if (debate && debate.participantId === message.author.id) {
      logger.debate('reply_received', {
        subject: debate.subject,
        messageCount: debate.messages.length,
      });
      await handleDebateMessage(message, debate);
      return;
    }
  }

  // Check for debate triggers in regular channels
  for (const trigger of DEBATE_TRIGGERS) {
    const match = message.content.match(trigger);
    if (match) {
      const subject = match[1].trim();
      logger.debate('trigger_matched', { trigger: trigger.source, subject });
      await startDebate(message, subject);
      return;
    }
  }

  // Check for bot mention
  if (message.mentions.has(client.user)) {
    // Remove the mention and use the rest as the subject
    const subject = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
      .trim();

    if (subject.length > 0) {
      logger.debate('trigger_matched', { trigger: 'mention', subject });
      await startDebate(message, subject);
    }
  }
});

async function startDebate(message, subject) {
  try {
    logger.debate('starting', {
      subject,
      opponent: message.author.tag,
      channel: message.channel.name,
    });

    // Check if message already has a thread
    if (message.thread) {
      logger.debug('debate', 'Thread already exists for this message');
      return;
    }

    // Create a thread for the debate
    let thread;
    try {
      thread = await message.startThread({
        name: `Debate: ${subject.substring(0, 90)}`,
        autoArchiveDuration: 60, // 1 hour (Discord minimum)
      });
    } catch (threadError) {
      if (threadError.message.includes('thread has already been created')) {
        logger.debug('debate', 'Thread already exists, skipping');
        return;
      }
      throw threadError;
    }

    // Initialize the debate
    const debate = debateManager.createDebate(
      thread.id,
      message.author.id,
      subject
    );

    logger.debate('thread_created', { threadId: thread.id, threadName: thread.name });

    // Send opening message
    await thread.send(`⚔️ **DEBATE INITIATED** ⚔️\n\n**Subject:** ${subject}\n**Opponent:** ${message.author.username}\n\nPreparing my arguments...`);

    // Keep typing indicator going while generating
    const typingInterval = setInterval(() => thread.sendTyping().catch(() => {}), 5000);
    await thread.sendTyping().catch(() => {});

    // Get the bot's opening argument
    logger.ollama('generating_opening', { subject });
    let openingArgument;
    try {
      openingArgument = await debateManager.generateResponse(debate, null, true);
    } finally {
      clearInterval(typingInterval);
    }
    logger.ollama('opening_generated', { length: openingArgument.length });

    await sendLongMessage(thread, openingArgument);

    logger.debate('started', {
      subject,
      opponent: message.author.tag,
      threadId: thread.id,
    });
  } catch (error) {
    logger.error('debate', 'Failed to start debate', { error: error.message, subject });
    await message.reply('Failed to start the debate. Please try again.').catch(() => {});
  }
}

async function handleDebateMessage(message, debate) {
  try {
    // Keep typing indicator going while generating
    const typingInterval = setInterval(() => message.channel.sendTyping().catch(() => {}), 5000);
    await message.channel.sendTyping().catch(() => {});

    // Fetch recent thread messages for context
    const threadMessages = await message.channel.messages.fetch({ limit: 20 });
    const messageHistory = threadMessages
      .reverse()
      .filter(m => !m.content.startsWith('⚔️') && !m.content.startsWith('🏆'))
      .map(m => ({
        role: m.author.bot ? 'assistant' : 'user',
        content: m.content,
        author: m.author.username,
      }));

    // Generate response
    logger.ollama('generating_response', {
      subject: debate.subject,
      historyCount: messageHistory.length,
    });
    let response;
    try {
      response = await debateManager.generateResponse(debate, message.content, false, messageHistory);
    } finally {
      clearInterval(typingInterval);
    }
    logger.ollama('response_generated', { length: response.length });

    // Check if the debate should end
    if (debate.status === 'won') {
      logger.debate('victory', {
        subject: debate.subject,
        reason: 'fallacies_detected',
        fallacyCount: debate.fallacyCount,
        turns: debate.messages.length,
      });
      await message.channel.send(response);
      await message.channel.send(`\n🏆 **DEBATE CONCLUDED** 🏆\n\nToo many logical fallacies there, ${message.author.username}. Better luck next time!`);
      debateManager.endDebate(message.channel.id);
      return;
    }

    // Check for inactivity win condition (2 weak responses = defeat)
    if (debate.opponentInactiveCount >= 2) {
      logger.debate('victory', {
        subject: debate.subject,
        reason: 'opponent_inactive',
        inactiveCount: debate.opponentInactiveCount,
        turns: debate.messages.length,
      });
      await message.channel.send(`\n🏆 **DEBATE CONCLUDED** 🏆\n\nLooks like you've run out of arguments, ${message.author.username}. I'll take that as a concession!`);
      debateManager.endDebate(message.channel.id);
      return;
    }

    await message.channel.send(response);
  } catch (error) {
    logger.error('debate', 'Error generating response', {
      error: error.message,
      subject: debate.subject,
    });
    await message.channel.send('I encountered an error processing my argument. Please continue.');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('bot', 'Shutting down...');
  client.destroy();
  process.exit(0);
});

// Login
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN environment variable is required');
  process.exit(1);
}

client.login(token);
