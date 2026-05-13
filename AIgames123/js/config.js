var SUPABASE_URL = 'https://bpaqjmwzdxdgitlwmamp.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwYXFqbXd6ZHhkZ2l0bHdtYW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyOTczMDMsImV4cCI6MjA4ODg3MzMwM30.7MVzlcoc3p46_b5jEn1aUr5LE2kF3EWlF89fqBH1MSM';
var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── 공유 상태 전역 변수 (auth.js, db.js, ui.js 에서 함께 사용) ──
// config.js가 가장 먼저 로드되므로 여기에 선언해야 모든 파일에서 접근 가능
var currentUser = null;
var currentTag = '';
var editingGameId = null;