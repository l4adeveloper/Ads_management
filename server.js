const express = require("express");
const path = require("path");
const axios = require("axios");
const session = require("express-session"); // ✅ Thêm session
require("dotenv").config();

const app = express();
const PORT = 4444;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ✅ Cấu hình session
app.use(session({
  secret: "your_secret_key_here", // đổi thành key bảo mật
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000 // 1 ngày
  }
}));

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
    // 1️⃣ Exchange code for short-lived user token
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

    // 2️⃣ Exchange for long-lived token
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

    // 3️⃣ Get User Info
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

    // 4️⃣ Get Business Info (optional)
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

// Các API khác của bạn (accounts, campaigns, stats, ...)  
// ➡ Chỉ cần thay `token` thành `req.session.token` và `userInfo` thành `req.session.userInfo`

app.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);
