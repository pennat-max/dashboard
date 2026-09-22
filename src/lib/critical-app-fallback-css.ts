/**
 * Critical fallback ใน <head> — ใช้ :where() (specificity 0) เมื่อ Tailwind โหลดได้ utility จะ override ได้ตามปกติ
 * กันหน้า “เปลือย” เมื่อไฟล์ CSS หลักไม่ถูกโหลด / dev HMR พลาด
 */
export const CRITICAL_APP_CSS = `
:root{color-scheme:light}
:where(body[data-app-root]){
  margin:0;
  background:#f4f4f6;
  color:#171717;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
}
:where([data-app-root] a){color:inherit;text-decoration:none}
:where([data-app-root] .app-shell){
  min-height:100vh;
  background:#ececf2;
}
:where([data-app-root] .app-shell > main){
  max-width:72rem;
  margin-left:auto;
  margin-right:auto;
  padding:1.5rem 1rem;
}
@media (min-width:768px){
  :where([data-app-root] .app-shell > main){padding:2rem 2rem}
}
:where([data-app-root] .dashboard-stack){
  display:flex;
  flex-direction:column;
  gap:3rem;
  max-width:72rem;
  margin:0 auto;
  width:100%;
}
:where([data-app-root] .kpi-grid){
  display:grid;
  gap:0.75rem;
  grid-template-columns:1fr;
}
@media (min-width:640px){
  :where([data-app-root] .kpi-grid){grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (min-width:1024px){
  :where([data-app-root] .kpi-grid){grid-template-columns:repeat(4,minmax(0,1fr))}
}
:where([data-app-root] .two-col-grid){
  display:grid;
  gap:1.5rem;
}
@media (min-width:1024px){
  :where([data-app-root] .two-col-grid){grid-template-columns:repeat(2,minmax(0,1fr))}
}
:where([data-app-root] main header){
  border-bottom:1px solid #e5e7eb;
  padding-bottom:2rem;
}
:where([data-app-root] main h1){
  font-size:clamp(1.5rem,2vw,1.875rem);
  font-weight:600;
  margin:0.5rem 0 0;
  line-height:1.2;
}
:where([data-app-root] main h2){
  font-size:1.125rem;
  font-weight:600;
  margin:0.375rem 0 0;
}
:where([data-app-root] main section){
  display:flex;
  flex-direction:column;
  gap:1.25rem;
}
:where([data-app-root] [data-slot="card"]){
  background:#fff;
  border:1px solid #e5e7eb;
  border-radius:0.75rem;
  box-shadow:0 1px 2px rgba(0,0,0,0.06);
}
:where([data-app-root] code){
  font-family:ui-monospace,SFMono-Regular,monospace;
  font-size:0.75rem;
  padding:0.125rem 0.375rem;
  border:1px solid #e5e7eb;
  border-radius:0.25rem;
  background:#f4f4f5;
}
`;
