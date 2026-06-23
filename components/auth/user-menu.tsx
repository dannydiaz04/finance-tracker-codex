"use client";

import { useEffect, useRef, useState } from "react";

import { signOut } from "next-auth/react";
import { LogOut, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type UserMenuProps = {
  email?: string | null;
  name?: string | null;
};

export function UserMenu({ email, name }: UserMenuProps) {
  const label = name || email;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setConfirmOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [confirmOpen]);

  const handleSignOut = () => {
    signOut({ callbackUrl: "/sign-in" });
  };

  return (
    <div className="flex items-center gap-3" ref={containerRef}>
      {label ? (
        <span className="hidden text-sm text-slate-400 sm:inline">{label}</span>
      ) : null}
      <div className="relative">
        <Button
          variant="secondary"
          size="sm"
          className="h-8 w-8 justify-center p-0"
          onClick={() => setConfirmOpen((v) => !v)}
          aria-expanded={confirmOpen}
          aria-haspopup="dialog"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="size-4" />
        </Button>
        {confirmOpen ? (
          <div
            role="dialog"
            className="absolute right-0 top-full z-50 mt-2 w-44 rounded-2xl border border-white/10 bg-slate-950/95 p-2 text-sm shadow-2xl backdrop-blur"
          >
            <div className="flex items-center justify-between px-2 pb-2 pt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
              <span>Account</span>
              <button
                type="button"
                className="rounded p-1 text-slate-400 hover:text-white"
                onClick={() => setConfirmOpen(false)}
                aria-label="Close"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-start"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 size-4" />
              Sign out
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
