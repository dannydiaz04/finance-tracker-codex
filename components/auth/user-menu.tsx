"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

type UserMenuProps = {
  email?: string | null;
  name?: string | null;
};

export function UserMenu({ email, name }: UserMenuProps) {
  const label = name || email;

  return (
    <div className="flex items-center gap-3">
      {label ? (
        <span className="hidden text-sm text-slate-400 sm:inline">{label}</span>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => signOut({ callbackUrl: "/sign-in" })}
      >
        <LogOut className="mr-2 size-4" />
        Sign out
      </Button>
    </div>
  );
}
