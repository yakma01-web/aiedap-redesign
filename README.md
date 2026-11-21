# AI 융합수업의 평가와 Re-design · 인터랙티브 연수

2026 AIEDAP 마스터교원 신규연수 영역 2 연수용 페이지입니다.

- `public/` 연수 페이지(정적 파일). `public/admin.html`은 강사용 데이터 확인 화면입니다.
- `src/worker.js` 정적 파일을 내보내고 연수생 응답을 모으는 API (Cloudflare Workers + D1).
- `wrangler.jsonc` Cloudflare Workers 설정과 D1 연결.
- `schema.sql` D1 테이블 정의.

## 배포

Cloudflare 대시보드에서 이 저장소를 Workers에 연결하면 푸시할 때마다 `npx wrangler deploy`로 배포됩니다.
