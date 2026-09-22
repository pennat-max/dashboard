"use client";

import { useState } from "react";
import { UsersAdminForm } from "./users-admin-form";
import { UsersRoleTable } from "./users-role-table";

export function UsersManagement() {
  const [listVersion, setListVersion] = useState(0);

  return (
    <div className="space-y-12">
      <UsersRoleTable listVersion={listVersion} />
      <div>
        <h2 className="font-heading text-lg font-semibold text-foreground">Create user manually</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional — same as inviting from Supabase; self‑signup users appear in the table above.
        </p>
        <div className="mt-4">
          <UsersAdminForm onCreated={() => setListVersion((v) => v + 1)} />
        </div>
      </div>
    </div>
  );
}
