const express = require("express");
const path = require("path");
const axios = require("axios");
const session = require("express-session"); // ✅ Dùng session
require("dotenv").config();

const app = express();
const PORT = 4444;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Cấu hình session
app.use(session({
  secret: "your_secret_key_here", // Đổi sang key bảo mật của bạn
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000 // 1 ngày
  }
}));
app.get("/clear-session", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, message: "Failed to clear session" });
    }
    res.json({ success: true, message: "Session cleared successfully" });
  });
});

// Serve static files
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "ads_manager.html"));
});

app.get("/read", (req, res) => {
  res.sendFile(path.join(__dirname, "ads_read.html"));
});

const scope = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  ''
].join(',');

const state = 'secure_login_2025';

const fbAuthUrl = `https://www.facebook.com/v23.0/dialog/oauth?client_id=${process.env.APP_ID}&redirect_uri=${process.env.REDIRECT_URI}&scope=${scope}&response_type=code&state=${state}`;

// Step 1: Facebook Login URL
app.get("/auth/facebook", (req, res) => {
  res.redirect(fbAuthUrl);
});

// Facebook OAuth Callback
app.get("/auth/facebook/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("❌ No code returned from Facebook");

  try {
    // 1️⃣ Lấy short-lived token
    const tokenResponse = await axios.get(
      "https://graph.facebook.com/v20.0/oauth/access_token",
      {
        params: {
          client_id: process.env.APP_ID,
          client_secret: process.env.APP_SECRET,
          redirect_uri: process.env.REDIRECT_URI,
          code,
        },
      }
    );

    const shortLivedToken = tokenResponse.data.access_token;

    // 2️⃣ Đổi sang long-lived token
    const longLivedTokenRes = await axios.get(
      "https://graph.facebook.com/v20.0/oauth/access_token",
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: process.env.APP_ID,
          client_secret: process.env.APP_SECRET,
          fb_exchange_token: shortLivedToken,
        },
      }
    );

    const longLivedToken = longLivedTokenRes.data.access_token;

    // 3️⃣ Lấy thông tin user
    const userRes = await axios.get(
      "https://graph.facebook.com/v20.0/me",
      {
        params: {
          access_token: longLivedToken,
          fields: "id,name,email,picture",
        },
      }
    );

    // ✅ Lưu vào session
    req.session.token = longLivedToken;
    req.session.userInfo = userRes.data;

    // 4️⃣ Lấy thông tin business
    const businessRes = await axios.get(
      "https://graph.facebook.com/v20.0/me/businesses",
      {
        params: {
          access_token: longLivedToken,
          fields: "id,name,verification_status",
        },
      }
    );

    req.session.business = businessRes.data.data?.[0] || null;

    res.redirect("/dashboard?connected=true");

  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
    res.redirect("/dashboard?error=connection_failed");
  }
});

// API: Verify Facebook token
app.get('/api/facebook/verify-token', (req, res) => {
  const providedToken = req.headers.authorization?.split(' ')[1];

  if (providedToken === req.session.token && req.session.token) {
    res.json({
      valid: true,
      user: req.session.userInfo,
      connected: true
    });
  } else {
    res.status(401).json({
      valid: false,
      connected: false
    });
  }
});

// API: Get connection status
app.get('/api/facebook/status', (req, res) => {
  res.json({
    connected: !!req.session.token,
    user: req.session.userInfo || null,
    hasToken: !!req.session.token
  });
});

// ✅ Logout API
app.get('/api/facebook/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// API: Get Facebook accounts
app.get('/api/accounts', async (req, res) => {
  try {
    const userToken = req.session.token;
    if (!userToken) return res.status(401).json({ error: 'Unauthorized' });

    const accountsRes = await axios.get('https://graph.facebook.com/v20.0/me/adaccounts', {
      params: {
        fields: 'id,name,account_status,business,amount_spent,currency',
        access_token: userToken
      }
    });

    const accounts = accountsRes.data.data || [];
    const today = new Date().toISOString().split('T')[0];

    const enrichedAccounts = await Promise.all(accounts.map(async acc => {
      const adAccountId = acc.id;
      
      try {
        const insightsRes = await axios.get(`https://graph.facebook.com/v20.0/${adAccountId}/insights`, {
          params: {
            time_range: `{"since":"${today}","until":"${today}"}`,
            fields: 'spend,actions',
            access_token: userToken
          }
        });

        const spendToday = insightsRes.data.data?.[0]?.spend || "0";
        let leads = 0;
        const actions = insightsRes.data.data?.[0]?.actions || [];
        actions.forEach(act => {
          if (act.action_type === 'lead') {
            leads += parseInt(act.value);
          }
        });

        return {
          id: adAccountId,
          name: acc.name,
          business: acc.business?.name || 'Không xác định',
          status: acc.account_status === 1 ? 'active' : 'inactive',
          campaigns: Math.floor(Math.random() * 10 + 1),
          spend: formatCurrency(acc.amount_spent, acc.currency),
          spendToday: formatCurrency(spendToday, acc.currency),
          leadsToday: leads,
          currency: acc.currency
        };
      } catch (err) {
        return {
          id: adAccountId,
          name: acc.name,
          business: acc.business?.name || 'Không xác định',
          status: acc.account_status === 1 ? 'active' : 'inactive',
          campaigns: 0,
          spend: formatCurrency(acc.amount_spent, acc.currency),
          spendToday: formatCurrency(0, acc.currency),
          leadsToday: 0,
          currency: acc.currency
        };
      }
    }));

    res.json({ accounts: enrichedAccounts });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy thông tin Facebook' });
  }
});

// API: Get recent campaigns for account
app.get('/api/accounts/:id/recent-campaigns', async (req, res) => {
  const accountId = req.params.id.replace(/^act_/, "");
  const accessToken = req.session.token;
  
  if (!accessToken) {
    return res.status(400).json({ error: 'Thiếu access token' });
  }

  const since = new Date();
  since.setMonth(since.getMonth() - 1);

  try {
    const response = await axios.get(`https://graph.facebook.com/v20.0/act_${accountId}/campaigns`, {
      params: {
        access_token: accessToken,
        fields: 'id,name,status,start_time',
        limit: 10
      }
    });

    const recentCampaigns = response.data.data
      .filter(c => new Date(c.start_time).getTime() >= since.getTime())
      .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
      .slice(0, 3);

    res.json(recentCampaigns);
  } catch (error) {
    res.status(500).json({ error: 'Không thể lấy chiến dịch gần đây' });
  }
});

// API: Create new campaign
app.post('/api/campaigns', async (req, res) => {
  try {
    const accessToken = req.session.token;
    if (!accessToken) {
      return res.status(401).json({ error: 'Unauthorized - No access token' });
    }

    const { name, objective, status, special_ad_categories, account_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Campaign name is required' });
    }

    let targetAccountId = account_id;
    if (!targetAccountId) {
      const accountsRes = await axios.get('https://graph.facebook.com/v20.0/me/adaccounts', {
        params: {
          fields: 'id',
          access_token: accessToken,
          limit: 1
        }
      });
      
      if (accountsRes.data.data.length === 0) {
        return res.status(400).json({ error: 'No ad accounts found' });
      }
      
      targetAccountId = accountsRes.data.data[0].id;
    }

    const campaignData = {
      name: name,
      objective: objective || 'LINK_CLICKS',
      status: status || 'PAUSED',
      access_token: accessToken
    };

    if (special_ad_categories && special_ad_categories[0] !== 'NONE') {
      campaignData.special_ad_categories = special_ad_categories;
    }

    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${targetAccountId}/campaigns`,
      campaignData
    );

    res.json({
      success: true,
      campaign_id: response.data.id,
      message: 'Campaign created successfully'
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to create campaign',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// API: Get dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const accessToken = req.session.token;
    if (!accessToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const accountsRes = await axios.get('https://graph.facebook.com/v20.0/me/adaccounts', {
      params: {
        fields: 'id,name,amount_spent,currency',
        access_token: accessToken
      }
    });

    const accounts = accountsRes.data.data || [];
    const today = new Date().toISOString().split('T')[0];
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lastMonthStr = lastMonth.toISOString().split('T')[0];

    let totalSpend = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversions = 0;

    for (const account of accounts) {
      try {
        const insightsRes = await axios.get(`https://graph.facebook.com/v20.0/${account.id}/insights`, {
          params: {
            time_range: `{"since":"${lastMonthStr}","until":"${today}"}`,
            fields: 'spend,impressions,clicks,actions',
            access_token: accessToken
          }
        });

        const insights = insightsRes.data.data[0];
        if (insights) {
          totalSpend += parseFloat(insights.spend || 0);
          totalImpressions += parseInt(insights.impressions || 0);
          totalClicks += parseInt(insights.clicks || 0);

          const actions = insights.actions || [];
          actions.forEach(action => {
            if (action.action_type === 'purchase' || action.action_type === 'lead') {
              totalConversions += parseInt(action.value || 0);
            }
          });
        }
      } catch {}
    }

    const conversionRate = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) : 0;

    res.json({
      totalSpend: `$${totalSpend.toFixed(2)}`,
      totalImpressions: formatNumber(totalImpressions),
      totalClicks: formatNumber(totalClicks),
      conversionRate: `${conversionRate}%`,
      accountsCount: accounts.length
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to get dashboard stats' });
  }
});

// Helper functions
function formatCurrency(amount, currency) {
  if (!amount) return '₫0';
  const value = parseFloat(amount);
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency || 'VND'
  }).format(value);
}

function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

app.listen(PORT, () =>
  console.log(`✅ Runon http://localhost:${PORT}`)
);
