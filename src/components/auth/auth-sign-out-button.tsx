export function AuthSignOutButton({ email }: { email: string }) {
  return (
    <div className="flex max-w-[min(100%,14rem)] flex-col items-end gap-1 sm:max-w-none sm:flex-row sm:items-center sm:gap-2">
      <span className="truncate text-right text-xs text-muted-foreground" title={email}>
        {email}
      </span>
      <a className="inline-flex h-8 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent" href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign out</a>
    </div>
  );
}
