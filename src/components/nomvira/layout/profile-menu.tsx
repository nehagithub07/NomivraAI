"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useTransition } from "react";
import { CircleHelp, LogOut, Settings, UserRound } from "lucide-react";
import { IconButton } from "@/components/nomvira/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UserIdentity } from "@/lib/auth/identity";
import { signOut } from "@/lib/auth/actions";

export function ProfileMenu({ identity }: { identity: UserIdentity }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Open profile menu" className="bg-secondary">
          {identity.avatarUrl && !avatarFailed ? (
            <Image
              src={identity.avatarUrl}
              alt=""
              width={32}
              height={32}
              unoptimized
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
              className="size-8 rounded-full object-cover"
            />
          ) : identity.initials ? (
            <span className="type-small" aria-hidden="true">
              {identity.initials}
            </span>
          ) : (
            <UserRound aria-hidden="true" />
          )}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="max-w-64 break-words">
          {identity.displayName}
        </DropdownMenuLabel>
        <DropdownMenuItem disabled>
          <UserRound aria-hidden="true" />
          Profile<span className="ml-auto text-xs">Soon</span>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/help">
            <CircleHelp aria-hidden="true" />
            Help
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          aria-busy={pending}
          onSelect={(event) => {
            event.preventDefault();
            setError(undefined);
            startTransition(async () => {
              const result = await signOut();
              setError(result.message);
            });
          }}
        >
          <LogOut aria-hidden="true" />
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
        {error && (
          <DropdownMenuLabel>
            <span
              role="alert"
              className="block max-w-52 font-normal text-destructive"
            >
              {error}
            </span>
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
