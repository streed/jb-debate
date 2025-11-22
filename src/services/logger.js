const C = {
  r: '\x1b[0m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m',
  m: '\x1b[35m', c: '\x1b[36m', gr: '\x1b[90m', rd: '\x1b[31m',
};

const ts = () => new Date().toISOString().substring(11, 23);

const fmt = (data) => {
  if (!data || Object.keys(data).length === 0) return '';
  return Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
};

export const logger = {
  info(cat, msg, data = {}) {
    console.log(`${C.gr}${ts()}${C.r} ${C.g}INFO${C.r} ${C.c}${cat}${C.r} ${fmt(data)} ${msg}`);
  },

  warn(cat, msg, data = {}) {
    console.log(`${C.gr}${ts()}${C.r} ${C.y}WARN${C.r} ${C.c}${cat}${C.r} ${fmt(data)} ${msg}`);
  },

  error(cat, msg, data = {}) {
    console.log(`${C.gr}${ts()}${C.r} ${C.rd}ERR${C.r} ${C.c}${cat}${C.r} ${fmt(data)} ${msg}`);
  },

  debug(cat, msg, data = {}) {
    if (process.env.DEBUG) {
      console.log(`${C.gr}${ts()}${C.r} ${C.gr}DBG${C.r} ${C.c}${cat}${C.r} ${fmt(data)} ${msg}`);
    }
  },

  message(msg) {
    const ch = msg.channel.name || msg.channel.id;
    const content = msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content;
    console.log(`${C.gr}${ts()}${C.r} ${C.m}MSG${C.r} ${msg.author.tag} #${ch} "${content}"`);
  },

  debate(action, data = {}) {
    console.log(`${C.gr}${ts()}${C.r} ${C.b}DBT${C.r} ${action} ${fmt(data)}`);
  },

  ollama(action, data = {}) {
    console.log(`${C.gr}${ts()}${C.r} ${C.y}LLM${C.r} ${action} ${fmt(data)}`);
  },
};
