"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserRole } from "@/lib/auth/user-role";
import { ROLE_LABELS } from "./role-labels";

type RowUser = {
  id: string;
  email: string;
  created_at?: string;
  role: UserRole;
};

type Props = {
  /** Increment to reload the list after creating a user elsewhere */
  listVersion?: number;
};

export function UsersRoleTable({ listVersion = 0 }: Props) {
  const [users, setUsers] = useState<RowUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, UserRole>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        users?: RowUser[];
        currentUserId?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not load users");
        return;
      }
      const list = data.users ?? [];
      setUsers(list);
      setCurrentUserId(data.currentUserId ?? null);
      const init: Record<string, UserRole> = {};
      for (const u of list) init[u.id] = u.role;
      setPending(init);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, listVersion]);

  async function saveRole(userId: string) {
    const role = pending[userId];
    if (role == null) return;
    setSavingId(userId);
    setBanner(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      setPending((p) => ({ ...p, [userId]: role }));
      setBanner("Role updated");
    } catch {
      setError("Network error");
    } finally {
      setSavingId(null);
    }
  }

  function setPendingRole(userId: string, value: string | null) {
    const r = Number(value ?? "");
    if (r >= 1 && r <= 4) {
      setPending((p) => ({ ...p, [userId]: r as UserRole }));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-lg font-semibold text-foreground">Registered users</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Anyone who signs up appears here with role <strong>1</strong> until you change it.
        </p>
      </div>

      {banner ? (
        <p className="rounded-md border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          {banner}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading users…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead className="hidden sm:table-cell">Joined</TableHead>
              <TableHead className="w-[min(100%,14rem)]">Role</TableHead>
              <TableHead className="w-28 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No users yet.
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => {
                const isSelf = currentUserId === u.id;
                const selected = pending[u.id] ?? u.role;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.email || "(no email)"}
                      {isSelf ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {u.created_at
                        ? new Date(u.created_at).toLocaleString("en-GB", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={String(selected)}
                        onValueChange={(v) => setPendingRole(u.id, v)}
                        disabled={savingId === u.id}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].map((r) => (
                            <SelectItem key={r} value={String(r)} disabled={isSelf && r < 4}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isSelf ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          You cannot set your own role below 4 here.
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={savingId === u.id || selected === u.role}
                        onClick={() => void saveRole(u.id)}
                      >
                        {savingId === u.id ? "Saving…" : "Apply"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
