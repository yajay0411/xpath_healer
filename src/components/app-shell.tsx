import Link from "next/link";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * The chrome both pages share: title, one-line explanation, and the nav between the two
 * halves of the pipeline — what arrived (deliveries) and what was done about it (heals).
 */
export function AppShell({
  title,
  description,
  active,
  children,
}: {
  title: string;
  description: React.ReactNode;
  active: "deliveries" | "heals";
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
        </div>
        <nav className="flex items-center gap-1 text-sm" aria-label="Sections">
          <NavLink href="/" current={active === "deliveries"}>
            Deliveries
          </NavLink>
          <NavLink href="/heals" current={active === "heals"}>
            Heals
          </NavLink>
        </nav>
      </header>

      <Separator className="my-6" />
      {children}
    </div>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 transition-colors",
        current
          ? "bg-secondary text-secondary-foreground font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

/** Not an error. Most of the time there is simply nothing to show yet. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
      {children}
    </div>
  );
}
