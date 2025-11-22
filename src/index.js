import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { DebateManager } from './services/debateManager.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const debateManager = new DebateManager();

// Patterns to trigger a debate
const DEBATE_TRIGGERS = [
  /^debate me\s+(.+)/i,
  /^let'?s fight about\s+(.+)/i,
  /^fight me on\s+(.+)/i,
  /^argue with me about\s+(.+)/i,
];

client.once('ready', () => {
  console.log(`Debate Bot logged in as ${client.user.tag}`);
  console.log(`Using Ollama model: ${process.env.OLLAMA_MODEL || 'gpt-oss:120b-cloud'}`);
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check if this is in an active debate thread
  if (message.channel.type === ChannelType.PublicThread ||
      message.channel.type === ChannelType.PrivateThread) {
    const debate = debateManager.getDebate(message.channel.id);
    if (debate && debate.participantId === message.author.id) {
      await handleDebateMessage(message, debate);
      return;
    }
  }

  // Check for debate triggers in regular channels
  for (const trigger of DEBATE_TRIGGERS) {
    const match = message.content.match(trigger);
    if (match) {
      const subject = match[1].trim();
      await startDebate(message, subject);
      return;
    }
  }
});

async function startDebate(message, subject) {
  try {
    // Create a thread for the debate
    const thread = await message.startThread({
      name: `Debate: ${subject.substring(0, 90)}`,
      autoArchiveDuration: 1440, // 24 hours
    });

    // Initialize the debate
    const debate = debateManager.createDebate(
      thread.id,
      message.author.id,
      subject
    );

    // Send opening message
    await thread.send(`⚔️ **DEBATE INITIATED** ⚔️\n\n**Subject:** ${subject}\n**Opponent:** ${message.author.username}\n\nPreparing my arguments...`);

    // Get the bot's opening argument
    const openingArgument = await debateManager.generateResponse(debate, null, true);

    await thread.send(openingArgument);

    console.log(`Started debate on "${subject}" with ${message.author.username}`);
  } catch (error) {
    console.error('Error starting debate:', error);
    await message.reply('Failed to start the debate. Please try again.');
  }
}

async function handleDebateMessage(message, debate) {
  try {
    // Show typing indicator
    await message.channel.sendTyping();

    // Generate response
    const response = await debateManager.generateResponse(debate, message.content);

    // Check if the debate should end
    if (debate.status === 'won') {
      await message.channel.send(response);
      await message.channel.send(`\n🏆 **DEBATE CONCLUDED** 🏆\n\nI believe I've made my case. Thank you for the intellectual sparring, ${message.author.username}!`);
      debateManager.endDebate(message.channel.id);
      return;
    }

    // Check for inactivity win condition
    if (debate.opponentInactiveCount >= 3) {
      await message.channel.send(`\n🏆 **DEBATE CONCLUDED** 🏆\n\nIt appears you've conceded through lack of substantive response. Victory by default!`);
      debateManager.endDebate(message.channel.id);
      return;
    }

    await message.channel.send(response);
  } catch (error) {
    console.error('Error handling debate message:', error);
    await message.channel.send('I encountered an error processing my argument. Please continue.');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down debate bot...');
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
