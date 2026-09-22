import { createSiteDataClient } from "@/lib/site/db-client";

/** Read/write D1 and R2 through the Site-native compatibility client. */
export function createSiteClient() { return createSiteDataClient(); }

// Transitional aliases keep the existing domain code compact while the storage backend is Site-native.
export const createAnonClient = createSiteClient;
export const createServiceRoleClient = createSiteClient;
