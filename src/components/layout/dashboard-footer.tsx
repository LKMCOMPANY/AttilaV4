export function DashboardFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t px-4 py-4 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>&copy; {year} ATTILA. All rights reserved.</span>
        <span>v4.0.0</span>
      </div>
    </footer>
  );
}
