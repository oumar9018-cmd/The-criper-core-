const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const config = require('./config.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Render health route
app.get('/', (req, res) => {
  res.send('Cipher Core bot is live.');
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

const bot = new TelegramBot(config.botToken, { polling: true });

const USERS_FILE = path.join(__dirname, 'users.json');
const MINING_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const MINING_REWARD = 50;

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      fs.writeFileSync(USERS_FILE, '[]');
    }
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('Error loading users:', err);
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Error saving users:', err);
  }
}

function getUser(users, tgId) {
  return users.find(u => u.tgId === String(tgId));
}

function createUser(from, referredBy = null) {
  return {
    tgId: String(from.id),
    username: from.username || '',
    firstName: from.first_name || 'Node',
    points: 0,
    referrals: 0,
    referredUsers: [],
    referredBy: referredBy || null,
    joinedAt: Date.now(),
    lastMineAt: 0,
    verifiedTelegram: false,
    verifiedX: false,
    waitlistTag: 'EARLY NODE',
    miningRate: MINING_REWARD
  };
}

function getReferralLink(botUsername, tgId) {
  return `https://t.me/${botUsername}?start=ref_${tgId}`;
}

function timeRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔓 Verify Access', callback_data: 'verify_access' }],
        [{ text: '⛏ Start Mining', callback_data: 'mine' }],
        [{ text: '👥 Referral', callback_data: 'referral' }],
        [{ text: '🏆 Leaderboard', callback_data: 'leaderboard' }],
        [{ text: '📘 Whitepaper', callback_data: 'whitepaper' }],
        [{ text: '📊 My Status', callback_data: 'status' }]
      ]
    }
  };
}

function verifyMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📢 Join Telegram Channel', url: `https://t.me/${config.channelUsername}` }],
        [{ text: '𝕏 Follow on X', url: config.xUrl }],
        [{ text: '✅ I Have Completed Both', callback_data: 'verify_done' }]
      ]
    }
  };
}

async function isChannelMember(userId) {
  try {
    const member = await bot.getChatMember(`@${config.channelUsername}`, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error('Channel membership check failed:', err.message);
    return false;
  }
}

function leaderboardText(users) {
  const sorted = [...users].sort((a, b) => b.points - a.points).slice(0, 10);
  if (!sorted.length) return 'No nodes on the board yet.';
  return sorted.map((u, i) => {
    const name = u.username ? '@' + u.username : u.firstName || 'Node';
    return `${i + 1}. ${name} — ${u.points} CP`;
  }).join('\n');
}

function whitepaperText() {
  return `
⬛ *CIPHER CORE — GENESIS WAITLIST PAPER*

*1. Overview*
Cipher Core is a waitlist-first node activation system built around consistent participation.

*2. Waitlist Phase*
Early waitlist users receive:
• Early Node tag
• Priority positioning
• Pre-release CP accumulation
• Stronger early participation window

*3. Mining Logic*
• Mining cycle: every 2 hours
• Reward per cycle: *50 CP*
• Public release may reduce mining speed to protect long-term balance

*4. Early Positioning*
Early users may benefit from:
• better starting position
• stronger accumulation window
• leaderboard visibility
• special identity tags

*5. Referral Structure*
Each valid referral is tracked uniquely per Telegram account.

*6. User Identity*
Every node is mapped to a unique Telegram ID to avoid user mix-ups.

*7. Release Direction*
Waitlist is controlled. Public release is expected to be more competitive.

*8. Notes*
CP earned during waitlist represents pre-release participation points.

*The earliest nodes enter before the system becomes crowded.*
`;
}

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  try {
    const users = loadUsers();
    const from = msg.from;
    const startArg = match && match[1] ? match[1] : null;

    let referredBy = null;
    if (startArg && startArg.startsWith('ref_')) {
      referredBy = startArg.replace('ref_', '');
      if (referredBy === String(from.id)) referredBy = null;
    }

    let user = getUser(users, from.id);

    if (!user) {
      user = createUser(from, referredBy);

      if (referredBy) {
        const refUser = getUser(users, referredBy);
        if (refUser && !refUser.referredUsers.includes(String(from.id))) {
          refUser.referredUsers.push(String(from.id));
          refUser.referrals += 1;
          refUser.points += 100;
        }
      }

      users.push(user);
      saveUsers(users);
    }

    const welcome = `
⬛ *WELCOME TO CIPHER CORE*

Your node identity has been initialized.

*Status:* Waitlist Phase
*Mining Cycle:* 2 Hours
*Reward:* 50 CP per cycle
*Tag:* ${user.waitlistTag}

Use the controls below to verify access, mine, and track your waitlist status.
`;

    await bot.sendMessage(msg.chat.id, welcome, {
      parse_mode: 'Markdown',
      ...mainMenu()
    });
  } catch (err) {
    console.error('Start error:', err);
    bot.sendMessage(msg.chat.id, 'Something went wrong while starting your node.');
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const tgId = String(query.from.id);
  const users = loadUsers();
  const user = getUser(users, tgId);

  if (!user) {
    await bot.answerCallbackQuery(query.id, { text: 'Please restart with /start' });
    return;
  }

  try {
    if (query.data === 'verify_access') {
      await bot.sendMessage(chatId,
        `🔐 *Verification Required*\n\nComplete both steps below to unlock full waitlist access.`,
        { parse_mode: 'Markdown', ...verifyMenu() }
      );
    }

    if (query.data === 'verify_done') {
      const member = await isChannelMember(tgId);
      user.verifiedTelegram = member;

      // Placeholder X verification
      user.verifiedX = true;

      saveUsers(users);

      if (user.verifiedTelegram && user.verifiedX) {
        await bot.sendMessage(chatId,
          `✅ *Access Verified*\n\nYour node is now active in the waitlist system.`,
          { parse_mode: 'Markdown', ...mainMenu() }
        );
      } else {
        await bot.sendMessage(chatId,
          `❌ Verification incomplete.\nMake sure you've joined the Telegram channel, then try again.`,
          mainMenu()
        );
      }
    }

    if (query.data === 'mine') {
      if (!user.verifiedTelegram || !user.verifiedX) {
        await bot.sendMessage(chatId,
          `🔒 You must complete verification before mining.`,
          verifyMenu()
        );
        return;
      }

      const now = Date.now();
      const diff = now - user.lastMineAt;

      if (diff < MINING_COOLDOWN_MS) {
        const remain = MINING_COOLDOWN_MS - diff;
        await bot.sendMessage(chatId,
          `⏳ *Node Cooling Down*\n\nNext mining window opens in: *${timeRemaining(remain)}*`,
          { parse_mode: 'Markdown', ...mainMenu() }
        );
        return;
      }

      user.points += user.miningRate;
      user.lastMineAt = now;
      saveUsers(users);

      await bot.sendMessage(chatId,
        `⛏ *Mining Successful*\n\n+${user.miningRate} CP added.\n\n*Total Balance:* ${user.points} CP`,
        { parse_mode: 'Markdown', ...mainMenu() }
      );
    }

    if (query.data === 'referral') {
      const me = await bot.getMe();
      const link = getReferralLink(me.username, user.tgId);

      await bot.sendMessage(chatId,
        `👥 *Referral Center*\n\n` +
        `*Your referrals:* ${user.referrals}\n` +
        `*Referral reward:* 100 CP per valid new node\n\n` +
        `*Your link:*\n${link}`,
        { parse_mode: 'Markdown', ...mainMenu() }
      );
    }

    if (query.data === 'leaderboard') {
      await bot.sendMessage(chatId,
        `🏆 *Top Nodes*\n\n${leaderboardText(users)}`,
        { parse_mode: 'Markdown', ...mainMenu() }
      );
    }

    if (query.data === 'whitepaper') {
      await bot.sendMessage(chatId, whitepaperText(), {
        parse_mode: 'Markdown',
        ...mainMenu()
      });
    }

    if (query.data === 'status') {
      const canMineIn = user.lastMineAt
        ? Math.max(0, MINING_COOLDOWN_MS - (Date.now() - user.lastMineAt))
        : 0;

      const displayName = user.username ? '@' + user.username : user.firstName;

      await bot.sendMessage(chatId,
        `📊 *My Node Status*\n\n` +
        `*Name:* ${displayName}\n` +
        `*Points:* ${user.points} CP\n` +
        `*Referrals:* ${user.referrals}\n` +
        `*Telegram Verified:* ${user.verifiedTelegram ? 'Yes' : 'No'}\n` +
        `*X Verified:* ${user.verifiedX ? 'Yes' : 'No'}\n` +
        `*Next Mining:* ${canMineIn ? timeRemaining(canMineIn) : 'Ready now'}\n` +
        `*Tag:* ${user.waitlistTag}`,
        { parse_mode: 'Markdown', ...mainMenu() }
      );
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('Callback error:', err);
    try {
      await bot.answerCallbackQuery(query.id, { text: 'Something went wrong' });
    } catch {}
  }
});

bot.onText(/\/users/, (msg) => {
  if (!config.adminIds.includes(msg.from.id)) return;

  const users = loadUsers();
  const text = users.map((u, i) =>
    `${i + 1}. ${u.firstName || 'Node'} | ${u.username ? '@' + u.username : 'no_username'} | ${u.points} CP | refs:${u.referrals}`
  ).join('\n') || 'No users yet.';

  bot.sendMessage(msg.chat.id, text.slice(0, 4000));
});

bot.onText(/\/stats/, (msg) => {
  if (!config.adminIds.includes(msg.from.id)) return;

  const users = loadUsers();
  const verified = users.filter(u => u.verifiedTelegram && u.verifiedX).length;
  const totalPoints = users.reduce((sum, u) => sum + u.points, 0);

  bot.sendMessage(msg.chat.id,
    `📈 Admin Stats\n\n` +
    `Users: ${users.length}\n` +
    `Verified: ${verified}\n` +
    `Total CP: ${totalPoints}`
  );
});

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

console.log('Cipher Core bot is running...');
