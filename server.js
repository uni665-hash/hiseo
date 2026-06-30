require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// ===== 카카오 토큰 관리 =====
const TOKEN_FILE = path.join(__dirname, 'kakao-tokens.json');

function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  return null;
}

function saveTokens(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
}

async function refreshKakaoToken() {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) throw new Error('카카오 로그인 필요');
  const res = await axios.post('https://kauth.kakao.com/oauth/token', null, {
    params: {
      grant_type: 'refresh_token',
      client_id: process.env.KAKAO_REST_API_KEY,
      refresh_token: tokens.refresh_token,
    }
  });
  const updated = {
    access_token: res.data.access_token,
    refresh_token: res.data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + res.data.expires_in * 1000,
  };
  saveTokens(updated);
  return updated.access_token;
}

async function getKakaoToken() {
  const t = loadTokens();
  if (!t) throw new Error('카카오 로그인 필요');
  if (Date.now() > t.expires_at - 60000) return await refreshKakaoToken();
  return t.access_token;
}

async function sendKakaoMessage(text) {
  const token = await getKakaoToken();
  await axios.post(
    'https://kapi.kakao.com/v2/api/talk/memo/default/send',
    new URLSearchParams({
      template_object: JSON.stringify({
        object_type: 'text',
        text,
        link: {
          web_url: `http://localhost:${PORT}/dashboard.html`,
          mobile_web_url: `http://localhost:${PORT}/dashboard.html`,
        }
      })
    }),
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
}

// ===== 노션 태스크 조회 =====
async function getPendingTasks() {
  if (!process.env.NOTION_TASK_DB_ID) return [];
  const results = await notion.databases.query({
    database_id: process.env.NOTION_TASK_DB_ID,
    filter: {
      or: [
        { property: '상태', select: { equals: '할 일' } },
        { property: '상태', select: { equals: '진행중' } },
        { property: '상태', select: { equals: '검토중' } },
      ]
    },
    sorts: [{ property: '마감일', direction: 'ascending' }],
    page_size: 10,
  });
  return results.results.map(p => ({
    title: p.properties['작업명']?.title?.[0]?.plain_text || '(제목없음)',
    status: p.properties['상태']?.select?.name || '-',
    deadline: p.properties['마감일']?.date?.start || '기한없음',
    priority: p.properties['우선순위']?.select?.name || '-',
    stage: p.properties['단계']?.select?.name || '-',
  }));
}

function buildMessage(tasks, type) {
  const meta = {
    morning:   { emoji: '🌅', label: '오전 업무 시작' },
    afternoon: { emoji: '☀️', label: '오후 중간 점검' },
    evening:   { emoji: '🌙', label: '오늘 마무리 확인' },
  }[type];

  if (!tasks.length) {
    return `${meta.emoji} [장학전산화] ${meta.label}\n\n✅ 처리할 항목이 없습니다. 수고하셨습니다!`;
  }

  const list = tasks.slice(0, 5).map((t, i) =>
    `${i + 1}. [${t.stage}] ${t.title}\n   ${t.status} | 마감: ${t.deadline} | ${t.priority}`
  ).join('\n\n');

  return `${meta.emoji} [장학전산화] ${meta.label}\n\n📋 미완료 ${tasks.length}건\n\n${list}\n\n👉 대시보드에서 확인하세요`;
}

// ===== 정적 파일 =====
app.use(express.static(path.join(__dirname)));

// ===== Notion API =====
app.get('/api/notion/test', async (req, res) => {
  try {
    const user = await notion.users.me();
    res.json({ ok: true, bot: user.name });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/notion/tasks', async (req, res) => {
  try {
    const tasks = await getPendingTasks();
    res.json({ ok: true, tasks });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/notion/search', async (req, res) => {
  try {
    const results = await notion.search({ query: req.query.q || '', page_size: 20 });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 카카오 OAuth =====
app.get('/api/kakao/auth', (req, res) => {
  const url = `https://kauth.kakao.com/oauth/authorize` +
    `?client_id=${process.env.KAKAO_REST_API_KEY}` +
    `&redirect_uri=${encodeURIComponent(process.env.KAKAO_REDIRECT_URI)}` +
    `&response_type=code`;
  res.redirect(url);
});

app.get('/api/kakao/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const r = await axios.post('https://kauth.kakao.com/oauth/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.KAKAO_REST_API_KEY,
        redirect_uri: process.env.KAKAO_REDIRECT_URI,
        code,
      }
    });
    saveTokens({
      access_token: r.data.access_token,
      refresh_token: r.data.refresh_token,
      expires_at: Date.now() + r.data.expires_in * 1000,
    });
    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h2>✅ 카카오톡 연결 완료!</h2>
      <p>이제 하루 3회 업무 알림을 카카오톡으로 받을 수 있습니다.</p>
      <a href="/dashboard.html" style="color:#1e88e5">대시보드로 이동</a>
    </body></html>`);
  } catch (err) {
    res.status(500).send(`카카오 연결 실패: ${err.message}`);
  }
});

app.get('/api/kakao/status', (req, res) => {
  const tokens = loadTokens();
  res.json({ connected: !!(tokens?.refresh_token) });
});

app.post('/api/kakao/test', async (req, res) => {
  try {
    const tasks = await getPendingTasks();
    await sendKakaoMessage(buildMessage(tasks, 'morning'));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== 크론 알림 (하루 3회) =====
cron.schedule('0 9 * * *', async () => {
  try {
    const tasks = await getPendingTasks();
    await sendKakaoMessage(buildMessage(tasks, 'morning'));
    console.log('[알림] 오전 9시 카카오 전송 완료');
  } catch (err) {
    console.error('[알림] 오전 실패:', err.message);
  }
}, { timezone: 'Asia/Seoul' });

cron.schedule('0 14 * * *', async () => {
  try {
    const tasks = await getPendingTasks();
    await sendKakaoMessage(buildMessage(tasks, 'afternoon'));
    console.log('[알림] 오후 2시 카카오 전송 완료');
  } catch (err) {
    console.error('[알림] 오후 실패:', err.message);
  }
}, { timezone: 'Asia/Seoul' });

cron.schedule('0 18 * * *', async () => {
  try {
    const tasks = await getPendingTasks();
    await sendKakaoMessage(buildMessage(tasks, 'evening'));
    console.log('[알림] 저녁 6시 카카오 전송 완료');
  } catch (err) {
    console.error('[알림] 저녁 실패:', err.message);
  }
}, { timezone: 'Asia/Seoul' });

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  console.log(`대시보드: http://localhost:${PORT}/dashboard.html`);
  console.log('알림 스케줄: 오전 9시 / 오후 2시 / 저녁 6시 (KST)');
});
