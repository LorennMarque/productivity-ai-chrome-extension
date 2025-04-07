// Listen for tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    // Only analyze when the page is fully loaded
    if (changeInfo.status === 'complete' && tab.url) {
      // Check if the URL is a special page
      if (tab.url.startsWith('chrome://') || 
          tab.url.startsWith('chrome-extension://') || 
          tab.url.startsWith('about:') ||
          tab.url.startsWith('edge://') ||
          tab.url.startsWith('brave://') ||
          tab.url === 'chrome://newtab/') {
        return;
      }

      // Get API key from storage
      const { apiKey } = await chrome.storage.local.get(['apiKey']);
      if (!apiKey) {
        console.error('API key not found');
        return;
      }

      // Get recent history
      const history = await new Promise((resolve) => {
        chrome.history.search(
          { text: '', maxResults: 3, startTime: 0 },
          resolve
        );
      });

      // Analyze the URL
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "Analyze productivity. Return a JSON object with: {isUnproductive:boolean, title:string, message:string}"
            },
            {
              role: "user",
              content: `URL: ${tab.url}\nHistory: ${JSON.stringify(history)}`
            }
          ]
        })
      });

      const data = await response.json();
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid API response format');
      }

      let analysis;
      try {
        analysis = JSON.parse(data.choices[0].message.content);
      } catch (parseError) {
        console.error('Error parsing API response:', parseError);
        throw new Error('Invalid JSON in API response');
      }

      // Only show notification if the site is unproductive
      if (analysis.isUnproductive) {
        try {
          // Create notification without icon to avoid image loading errors
          chrome.notifications.create({
            type: 'basic',
            title: 'Productivity Warning',
            message: analysis.message || 'This site may be unproductive.'
          });
        } catch (notificationError) {
          console.error('Error creating notification:', notificationError);
        }
      }
    }
  } catch (error) {
    console.error('Error in background script:', error);
  }
});

async function analyzeURL(url, pageTitle) {
  try {
    // Get API key from storage
    const { apiKey } = await chrome.storage.local.get(['apiKey']);
    if (!apiKey) {
      console.error('API key not found');
      return {
        isUnproductive: false,
        message: 'API key not configured',
        distractionLevel: 0,
        pattern: 'unknown'
      };
    }

    // Get last 5 visited pages with timestamps
    const history = await new Promise((resolve) => {
      chrome.history.search({ 
        text: '', 
        maxResults: 5, 
        startTime: Date.now() - (30 * 60 * 1000) // Last 30 minutes
      }, resolve);
    });

    // Format history data with timestamps
    const recentPages = history.map(page => ({
      url: page.url,
      title: page.title,
      visitTime: new Date(page.lastVisitTime).toISOString(),
      timeSpent: page.visitCount ? Math.round((Date.now() - page.lastVisitTime) / 1000) : 0
    }));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are an intelligent productivity assistant analyzing browsing patterns. Your task is to:

1. Analyze the current URL and page title
2. Review the last 5 pages visited and time spent on each
3. Detect patterns of distraction by considering:
   - Multiple visits to entertainment/social media sites
   - Extended time spent on potentially distracting sites
   - Context switches between work and entertainment
   - Time of day and duration of browsing sessions

Determine if the user is:
- Currently distracted
- Shows a pattern of distraction
- Taking reasonable breaks
- Maintaining productive focus

Respond with JSON containing:
- 'isUnproductive' (boolean)
- 'message' (friendly explanation with specific observations and actionable suggestions)
- 'distractionLevel' (number 1-5)
- 'pattern' (string describing the detected behavior pattern)`
          },
          {
            role: "user",
            content: `Current URL: ${url}
Page Title: ${pageTitle}
Recent browsing history (last 30 min): ${JSON.stringify(recentPages, null, 2)}`
          }
        ]
      })
    });

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    console.error('Error in URL analysis:', error);
    return {
      isUnproductive: false,
      message: 'Unable to analyze URL at this time.',
      distractionLevel: 0,
      pattern: 'unknown'
    };
  }
}