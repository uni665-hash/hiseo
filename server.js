require('dotenv').config();
const express = require('express');
const { Client } = require('@notionhq/client');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const notion = new Client({ auth: process.env.NOTION_TOKEN });

app.use(express.static(path.join(__dirname)));

// Notion 연결 테스트
app.get('/api/notion/test', async (req, res) => {
  try {
    const user = await notion.users.me();
    res.json({ ok: true, bot: user.name });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 내 워크스페이스에서 페이지/데이터베이스 검색
app.get('/api/notion/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const results = await notion.search({ query, page_size: 20 });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 특정 데이터베이스 항목 조회
app.get('/api/notion/databases/:id', async (req, res) => {
  try {
    const results = await notion.databases.query({
      database_id: req.params.id,
      page_size: 100,
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 특정 페이지 조회
app.get('/api/notion/pages/:id', async (req, res) => {
  try {
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
