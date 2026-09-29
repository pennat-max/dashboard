export const dynamic = "force-dynamic";

export default function LiffWorkPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 text-center text-slate-900">
      <div>
        <p className="text-lg font-bold">กำลังเปิดหน้า Order</p>
        <p className="mt-2 text-sm text-slate-500">ถ้าหน้าไม่เปลี่ยน ให้กดปุ่มด้านล่าง</p>
        <a className="mt-4 inline-flex rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white" href="/liff/orders">
          เปิดหน้า Order
        </a>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var params = new URLSearchParams(window.location.search);
              if (params.get("focusCarRowId")) {
                params.set("load", "full");
                if (!params.get("scope")) params.set("scope", "active");
              }
              var query = params.toString();
              window.location.replace("/liff/orders" + (query ? "?" + query : "") + window.location.hash);
            })();
          `,
        }}
      />
    </main>
  );
}
