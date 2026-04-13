"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, Moon, Sun, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import type { UserProfile } from "@/types";

interface NavItem {
  label: string;
  href: string;
}

interface DashboardHeaderProps {
  profile: UserProfile;
  navigation: NavItem[];
}

function isNavActive(pathname: string, href: string, isFirst: boolean) {
  if (isFirst) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLinks({
  items,
  pathname,
  className,
}: {
  items: NavItem[];
  pathname: string;
  className?: string;
}) {
  return (
    <nav className={className}>
      {items.map((item, i) => (
        <Link
          key={item.href}
          href={item.href}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            isNavActive(pathname, item.href, i === 0)
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function DashboardHeader({
  profile,
  navigation,
}: DashboardHeaderProps) {
  const pathname = usePathname();
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
        <Sheet>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" className="md:hidden" />
            }
          >
            <Menu className="h-4 w-4" />
            <span className="sr-only">Menu</span>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-6">
            <NavLinks
              items={navigation}
              pathname={pathname}
              className="flex flex-col gap-1 pt-6"
            />
          </SheetContent>
        </Sheet>

        <Link href={profile.role === "admin" ? "/admin" : "/dashboard"}>
          <span className="text-lg font-bold tracking-[0.15em]">ATTILA</span>
        </Link>

        <NavLinks
          items={navigation}
          pathname={pathname}
          className="ml-4 hidden items-center gap-1 md:flex"
        />

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            <Sun className="h-4 w-4 scale-100 transition-transform dark:scale-0" />
            <Moon className="absolute h-4 w-4 scale-0 transition-transform dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" />}
            >
              <User className="h-4 w-4" />
              <span className="sr-only">User menu</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium truncate">
                  {profile.display_name || profile.email}
                </p>
                <p className="text-xs text-muted-foreground capitalize">
                  {profile.role}
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <form action={signOut} className="w-full">
                  <button type="submit" className="flex w-full items-center">
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
