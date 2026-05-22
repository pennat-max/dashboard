"use client";

import { createContext, useContext, type ReactNode } from "react";
import { canMutate, type UserRole } from "@/lib/auth/user-role";

const UserRoleContext = createContext<UserRole | null | undefined>(undefined);

type Props = { role: UserRole | null; children: ReactNode };

/** ส่ง role จาก layout (null = ยังไม่ล็อกอิน) */
export function UserRoleProvider({ role, children }: Props) {
  return <UserRoleContext.Provider value={role}>{children}</UserRoleContext.Provider>;
}

export function useSessionUserRole(): UserRole | null {
  const v = useContext(UserRoleContext);
  if (v === undefined) return null;
  return v;
}

export function useCanMutateInApp(): boolean {
  const r = useSessionUserRole();
  return r != null && canMutate(r);
}
