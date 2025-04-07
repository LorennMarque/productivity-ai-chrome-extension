// API Configuration
const API_CONFIG = {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    max_tokens: 150
};

// Cache Configuration
const CACHE_CONFIG = {
    duration: 5 * 60 * 1000, // 5 minutes
    maxSize: 100
};

// Rate Limiting
const RATE_LIMIT = {
    maxRequests: 10,
    timeWindow: 60000
};

// Productive Domains
const PRODUCTIVE_DOMAINS = new Set([
    'github.com', 'stackoverflow.com', 'docs.google.com',
    'coursera.org', 'udemy.com', 'edx.org'
]);

// System Prompts
const PROMPTS = {
    system: "Analyze productivity. Return a JSON object with: {isUnproductive:boolean, title:string, message:string, reasoning:string}",
    user: (url) => `URL: ${url}`
};

export { API_CONFIG, CACHE_CONFIG, RATE_LIMIT, PRODUCTIVE_DOMAINS, PROMPTS }; 