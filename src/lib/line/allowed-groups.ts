export type LineAllowedGroupsPolicy = {
  allowAllGroups: boolean;
  groupIds: Set<string>;
};

const ALLOW_ALL_GROUP_MARKERS = new Set(["*", "ALL"]);

export function parseLineAllowedGroups(rawValue?: string | null): LineAllowedGroupsPolicy {
  const values = String(rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const allowAllGroups = values.some((value) => ALLOW_ALL_GROUP_MARKERS.has(value.toUpperCase()));
  const groupIds = new Set(
    values.filter((value) => !ALLOW_ALL_GROUP_MARKERS.has(value.toUpperCase()))
  );

  return { allowAllGroups, groupIds };
}

export function isLineGroupAllowed(
  groupId: string | null | undefined,
  policy: LineAllowedGroupsPolicy
): boolean {
  const gid = String(groupId ?? "").trim();
  if (!gid) return false;
  if (policy.allowAllGroups) return true;
  return policy.groupIds.has(gid);
}
