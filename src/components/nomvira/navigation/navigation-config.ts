import {
  CircleHelp,
  Compass,
  Heart,
  House,
  Luggage,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  label: string;
  mobileLabel: string;
  href: string;
  icon: LucideIcon;
};

export const primaryNavigation: NavigationItem[] = [
  { label: "Home", mobileLabel: "Home", href: "/", icon: House },
  { label: "My Trips", mobileLabel: "Trips", href: "/trips", icon: Luggage },
  { label: "Explore", mobileLabel: "Explore", href: "/explore", icon: Compass },
  {
    label: "AI Companion",
    mobileLabel: "AI",
    href: "/companion",
    icon: Sparkles,
  },
  { label: "Saved", mobileLabel: "Saved", href: "/saved", icon: Heart },
];

export const secondaryNavigation: NavigationItem[] = [
  {
    label: "Settings",
    mobileLabel: "Settings",
    href: "/settings",
    icon: Settings,
  },
  { label: "Help", mobileLabel: "Help", href: "/help", icon: CircleHelp },
];

export function isNavigationActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

export function getPageContext(pathname: string) {
  if (pathname === "/trips/new") return "Create Trip";
  return (
    [...primaryNavigation, ...secondaryNavigation].find((item) =>
      isNavigationActive(pathname, item.href),
    )?.label ?? "NomviraAI"
  );
}
