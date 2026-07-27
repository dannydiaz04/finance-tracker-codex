"use client";

import type { Route } from "next";
import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { applyCategoryScope } from "@/lib/category-scope";

/**
 * Writes the category scope into the URL while leaving every other dashboard param — time
 * range, month, excludePlaid — untouched, so category selection composes with them instead of
 * replacing them.
 */
export function useCategoryScope() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setScope = useCallback(
    (categoryIds: string[]) => {
      const params = applyCategoryScope(
        new URLSearchParams(searchParams.toString()),
        categoryIds,
      );
      const queryString = params.toString();

      startTransition(() => {
        router.push(
          `${pathname}${queryString ? `?${queryString}` : ""}` as Route,
        );
      });
    },
    [pathname, router, searchParams],
  );

  return { setScope, isPending };
}
