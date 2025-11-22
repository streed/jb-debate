import 'dotenv/config';
import { logger } from './logger.js';

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const OLLAMA_API_BASE = 'https://ollama.com/api';

if (!OLLAMA_API_KEY) {
  logger.warn('tools', 'OLLAMA_API_KEY not set - web search/fetch will fail');
}

// Tool definitions for Ollama
export const WEB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information, facts, and statistics on a topic',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant information',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch and read the content from a specific webpage URL',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the webpage to fetch',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wikipedia',
      description: 'Search Wikipedia for factual information, definitions, and encyclopedic knowledge on a topic',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The topic to search for on Wikipedia',
          },
        },
        required: ['query'],
      },
    },
  },
];

/**
 * Ollama web search API
 */
async function webSearch(query, maxResults = 5) {
  const res = await fetch(`${OLLAMA_API_BASE}/web_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OLLAMA_API_KEY}`,
    },
    body: JSON.stringify({ query, max_results: maxResults }),
  });

  if (!res.ok) {
    throw new Error(`Web search failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Ollama web fetch API
 */
async function webFetch(url) {
  const res = await fetch(`${OLLAMA_API_BASE}/web_fetch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OLLAMA_API_KEY}`,
    },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    throw new Error(`Web fetch failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Query Wikipedia API for article summary
 */
async function queryWikipedia(query) {
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.query?.search?.length) {
      return { error: 'No Wikipedia article found' };
    }

    const title = searchData.query.search[0].title;
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await fetch(summaryUrl);
    const summaryData = await summaryRes.json();

    return {
      title: summaryData.title,
      extract: summaryData.extract,
      url: summaryData.content_urls?.desktop?.page,
    };
  } catch (error) {
    logger.error('tools', `Wikipedia failed: ${error.message}`);
    return { error: 'Wikipedia query failed' };
  }
}

/**
 * Execute a tool call and return the result
 */
export async function executeToolCall(toolCall) {
  const name = toolCall.function?.name;
  let args = toolCall.function?.arguments;

  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      logger.error('tools', `Failed to parse args: ${args}`);
      return { error: 'Invalid arguments' };
    }
  }

  logger.info('tools', `${name}`, args);

  try {
    switch (name) {
      case 'web_search': {
        const data = await webSearch(args.query);
        if (data.results?.length) {
          return {
            results: data.results.map(r => ({
              title: r.title,
              url: r.url,
              snippet: r.content?.substring(0, 500),
            })),
          };
        }
        return { error: 'No search results found' };
      }

      case 'web_fetch': {
        const data = await webFetch(args.url);
        return {
          title: data.title,
          content: data.content?.substring(0, 2000),
          url: args.url,
        };
      }

      case 'wikipedia':
        return await queryWikipedia(args.query);

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    logger.error('tools', `${name} failed: ${error.message}`);
    return { error: `${name} failed: ${error.message}` };
  }
}

/**
 * Process tool calls from an Ollama response
 * Returns { messages, sources } where sources is an array of URLs
 */
export async function processToolCalls(toolCalls) {
  if (!toolCalls || toolCalls.length === 0) return { messages: [], sources: [] };

  const messages = [];
  const sources = [];

  for (const call of toolCalls) {
    const result = await executeToolCall(call);
    messages.push({
      role: 'tool',
      content: JSON.stringify(result),
    });

    // Extract sources from results
    if (result.results) {
      for (const r of result.results) {
        if (r.url) sources.push({ title: r.title, url: r.url });
      }
    }
    if (result.url) {
      sources.push({ title: result.title || 'Source', url: result.url });
    }
  }

  return { messages, sources };
}
