import type { ReactNode } from "react";

export default function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#11203d,transparent_28%),linear-gradient(180deg,#030712,#020617_45%,#02050d)] px-4 py-12">
      {children}
    </div>
  );
}
