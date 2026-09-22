type Props = {
  children: React.ReactNode;
};

export function StickyBottomActions({ children }: Props) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-border/70 bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur md:-mx-6 md:px-6">
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
