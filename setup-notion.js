// 노션 데이터베이스 최초 1회 생성 스크립트
// 실행: node setup-notion.js
require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function setup() {
  console.log('노션 연결 확인 중...');

  const search = await notion.search({
    filter: { value: 'page', property: 'object' },
    page_size: 5,
  });

  if (!search.results.length) {
    console.log('\n❌ 접근 가능한 노션 페이지가 없습니다.');
    console.log('노션에서 아무 페이지나 열고 우상단 "..." → "연결 추가" → "hiseo" 를 선택해주세요.');
    return;
  }

  const parent = search.results[0];
  const parentTitle = parent.properties?.title?.title?.[0]?.plain_text || parent.id;
  console.log(`✅ 부모 페이지: "${parentTitle}"`);
  console.log('태스크 데이터베이스 생성 중...');

  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: parent.id },
    title: [{ type: 'text', text: { content: '장학전산화 업무 태스크' } }],
    properties: {
      '작업명': { title: {} },
      '단계': {
        select: {
          options: [
            { name: '1단계: 현황파악', color: 'blue' },
            { name: '2단계: 요구분석', color: 'purple' },
            { name: '3단계: 설계', color: 'green' },
            { name: '4단계: 개발', color: 'orange' },
            { name: '5단계: 테스트', color: 'yellow' },
            { name: '6단계: 배포', color: 'red' },
          ]
        }
      },
      '상태': {
        select: {
          options: [
            { name: '할 일', color: 'gray' },
            { name: '진행중', color: 'blue' },
            { name: '검토중', color: 'yellow' },
            { name: '완료', color: 'green' },
            { name: '보류', color: 'red' },
          ]
        }
      },
      '우선순위': {
        select: {
          options: [
            { name: '높음', color: 'red' },
            { name: '중간', color: 'yellow' },
            { name: '낮음', color: 'gray' },
          ]
        }
      },
      '마감일': { date: {} },
      '담당자': { rich_text: {} },
      '메모': { rich_text: {} },
    }
  });

  console.log('\n✅ 데이터베이스 생성 완료!');
  console.log('\n⚠️  아래 줄을 .env 파일에 추가해주세요:\n');
  console.log(`NOTION_TASK_DB_ID=${db.id}`);
  console.log('\n그 다음 npm start 로 서버를 재시작하세요.');
}

setup().catch(err => {
  console.error('오류:', err.message);
});
