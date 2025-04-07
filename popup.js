import { API_CONFIG, CACHE_CONFIG, RATE_LIMIT, PRODUCTIVE_DOMAINS, PROMPTS } from './config.js';

// Cache management
const analysisCache = new Map();
const requests = [];

// Settings Management
async function loadSettings() {
    try {
        const { apiKey } = await chrome.storage.local.get(['apiKey']);
        if (apiKey) {
            document.getElementById('apiKey').value = apiKey;
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function saveSettings(apiKey) {
    try {
        await chrome.storage.local.set({ apiKey });
        showApiStatus('API key saved successfully', 'success');
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        showApiStatus('Error saving API key', 'error');
        return false;
    }
}

function showApiStatus(message, type) {
    const statusElement = document.getElementById('apiStatus');
    statusElement.textContent = message;
    statusElement.className = `api-status ${type}`;
    setTimeout(() => {
        statusElement.className = 'api-status';
    }, 3000);
}

// API Key Management
async function initializeApiKey() {
    try {
        const { apiKey } = await chrome.storage.local.get(['apiKey']);
        if (!apiKey) {
            showApiStatus('Please set your OpenAI API key in settings', 'error');
        }
    } catch (error) {
        console.error('Error initializing API key:', error);
    }
}

// Utility functions
function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

function isProductiveDomain(domain) {
    return PRODUCTIVE_DOMAINS.has(domain);
}

function isChromeSpecialPage(url) {
    return url.startsWith('chrome://') || 
           url.startsWith('chrome-extension://') || 
           url.startsWith('about:') ||
           url.startsWith('edge://') ||
           url.startsWith('brave://') ||
           url === 'chrome://newtab/';
}

function truncateResponse(response, maxLength = 200) {
    if (!response) return '';
    const str = String(response);
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
}

// Cache functions
async function getCachedAnalysis(url) {
    try {
        const result = await chrome.storage.local.get(['analysisCache']);
        if (result.analysisCache && result.analysisCache[url]) {
            const cached = result.analysisCache[url];
            if (Date.now() - cached.timestamp < CACHE_CONFIG.duration) {
                return cached.data;
            }
        }
        return null;
    } catch (error) {
        console.error('Cache error:', error);
        return null;
    }
}

async function saveToCache(url, analysis) {
    try {
        const result = await chrome.storage.local.get(['analysisCache']);
        const cache = result.analysisCache || {};
        
        // Clean old entries if cache is too large
        const entries = Object.entries(cache);
        if (entries.length >= CACHE_CONFIG.maxSize) {
            const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
            sorted.slice(CACHE_CONFIG.maxSize - 1).forEach(([key]) => delete cache[key]);
        }
        
        cache[url] = {
            data: analysis,
            timestamp: Date.now()
        };
        
        await chrome.storage.local.set({ analysisCache: cache });
    } catch (error) {
        console.error('Cache save error:', error);
    }
}

// API functions
function checkRateLimit() {
    const now = Date.now();
    const recentRequests = requests.filter(time => now - time < RATE_LIMIT.timeWindow);
    
    if (recentRequests.length >= RATE_LIMIT.maxRequests) {
        throw new Error('Rate limit exceeded');
    }
    
    requests.push(now);
}

async function analyzeURL(url) {
    try {
        // Check cache first
        const cached = await getCachedAnalysis(url);
        if (cached) return cached;

        // Check rate limit
        checkRateLimit();

        // Skip analysis for productive domains
        const domain = getDomain(url);
        if (isProductiveDomain(domain)) {
            return {
                isUnproductive: false,
                title: 'Productive Site',
                message: 'This is a known productive website.',
                reasoning: 'Domain is in productive list'
            };
        }

        // Get API key from storage
        const { apiKey } = await chrome.storage.local.get(['apiKey']);
        if (!apiKey) {
            throw new Error('API key not found. Please set your OpenAI API key in the extension settings.');
        }

        const response = await fetch(API_CONFIG.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: API_CONFIG.model,
                messages: [
                    { role: "system", content: PROMPTS.system },
                    { role: "user", content: PROMPTS.user(url) }
                ],
                temperature: API_CONFIG.temperature,
                max_tokens: API_CONFIG.max_tokens
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();
        
        // Validate and parse response
        if (!data.choices?.[0]?.message?.content) {
            throw new Error('Invalid API response format');
        }

        let analysis;
        try {
            const content = data.choices[0].message.content.trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {
                isUnproductive: content.toLowerCase().includes('unproductive'),
                title: 'Analysis Result',
                message: content,
                reasoning: 'Analysis based on content'
            };
        } catch (parseError) {
            console.error('Parse error:', parseError);
            analysis = {
                isUnproductive: false,
                title: 'Analysis Result',
                message: data.choices[0].message.content,
                reasoning: 'Raw analysis'
            };
        }

        // Validate and format analysis
        analysis = {
            isUnproductive: !!analysis.isUnproductive,
            title: analysis.title || 'Analysis Result',
            message: truncateResponse(analysis.message),
            reasoning: truncateResponse(analysis.reasoning)
        };
        
        // Cache the result
        await saveToCache(url, analysis);
        return analysis;

    } catch (error) {
        console.error('Analysis error:', error);
        return {
            isUnproductive: false,
            title: 'Analysis Error',
            message: error.message || 'Unable to analyze URL at this time.',
            reasoning: 'Error occurred during analysis'
        };
    }
}

// UI functions
function updateAnalysisDisplay(analysis) {
    const currentAnalysisDiv = document.getElementById('currentAnalysis');
    const currentAnalysisContainer = document.querySelector('.current-analysis');
    const loadingAnimation = document.getElementById('loadingAnimation');
    
    if (!currentAnalysisDiv || !currentAnalysisContainer || !loadingAnimation) {
        console.error('Required DOM elements not found');
        return;
    }

    loadingAnimation.style.display = 'none';
    
    const newContent = `
        <div class="analysis-message">
            <strong>${analysis.isUnproductive ? '⚠️' : '✅'} ${analysis.title}</strong><br>
            ${analysis.message}
            <div class="analysis-reasoning">${analysis.reasoning}</div>
        </div>
    `;

    if (currentAnalysisDiv.innerHTML !== newContent) {
        currentAnalysisContainer.classList.toggle('warning', analysis.isUnproductive);
        currentAnalysisContainer.classList.toggle('success', !analysis.isUnproductive);
        currentAnalysisDiv.innerHTML = newContent;
    }
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    let lastPromise = null;

    return function executedFunction(...args) {
        return new Promise((resolve, reject) => {
            const later = async () => {
                clearTimeout(timeout);
                try {
                    if (lastPromise) await lastPromise;
                    lastPromise = func(...args);
                    const result = await lastPromise;
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        });
    };
}

const debouncedAnalyze = debounce(analyzeURL, 1000);

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
    // Load settings first
    await loadSettings();
    
    // Initialize API key
    await initializeApiKey();
    
    const loadingAnimation = document.getElementById('loadingAnimation');
    if (loadingAnimation) loadingAnimation.style.display = 'block';
    
    // Settings form handler
    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const apiKey = document.getElementById('apiKey').value.trim();
        if (!apiKey) {
            showApiStatus('Please enter an API key', 'error');
            return;
        }
        await saveSettings(apiKey);
    });
    
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (isChromeSpecialPage(tab.url)) {
            document.getElementById('currentPageTitle').textContent = 'Chrome Internal Page';
            document.getElementById('currentPageUrl').textContent = tab.url;
            document.getElementById('currentAnalysis').innerHTML = 'This is a Chrome internal page. Analysis not available.';
            return;
        }
        
        document.getElementById('currentPageTitle').textContent = tab.title;
        document.getElementById('currentPageUrl').textContent = tab.url;
        
        try {
            const analysis = await debouncedAnalyze(tab.url);
            if (analysis) {
                updateAnalysisDisplay(analysis);
            }
        } catch (error) {
            console.error('Analysis error:', error);
            document.getElementById('currentAnalysis').innerHTML = 'Unable to analyze current page.';
        }

        // Shortcut handlers
        document.getElementById('closeTabBtn').addEventListener('click', async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && !isChromeSpecialPage(tab.url)) {
                    chrome.tabs.remove(tab.id);
                    window.close();
                }
            } catch (error) {
                console.error('Tab close error:', error);
            }
        });

        document.getElementById('refreshBtn').addEventListener('click', async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && !isChromeSpecialPage(tab.url)) {
                    chrome.tabs.reload(tab.id);
                }
            } catch (error) {
                console.error('Tab refresh error:', error);
            }
        });
    } catch (error) {
        console.error('Initialization error:', error);
        document.getElementById('currentAnalysis').innerHTML = 'Error initializing popup. Please try again.';
    }
});


