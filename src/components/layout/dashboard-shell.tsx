import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { DashboardNavLinks } from "@/components/layout/dashboard-nav";
import { cn } from "@/lib/utils";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/40 md:flex-row">
      <aside
        className={cn(
          "hidden min-h-screen w-[17rem] shrink-0 flex-col border-b border-border bg-background md:flex md:border-b-0 md:border-r"
        )}
      >
        <div className="flex h-14 shrink-0 items-center border-b border-border px-5">
          <Link href="/dashboard" className="block">
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Operations
            </span>
            <span className="mt-0.5 block font-heading text-[0.95rem] font-semibold tracking-tight text-foreground">
              Export Cars
            </span>
          </Link>
        </div>
        <div className="flex-1 p-3">
          <p className="mb-2 px-3 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            เมนู
          </p>
          <DashboardNavLinks />
        </div>
        <div className="border-t border-border px-5 py-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            แดชบอร์ดสต็อก · อัปเดตจาก Supabase
          </p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 md:hidden">
          <Sheet>
            <SheetTrigger>
              <Button variant="outline" size="icon-sm" aria-label="เปิดเมนู">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-r bg-background p-0">
              <div className="border-b border-border px-5 py-4">
                <span className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Operations
                </span>
                <div className="font-heading text-base font-semibold">Export Cars</div>
              </div>
              <div className="p-3">
                <DashboardNavLinks />
              </div>
            </SheetContent>
          </Sheet>
          <span className="font-heading text-sm font-medium text-foreground">แดชบอร์ด</span>
          <span className="w-9" aria-hidden />
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
