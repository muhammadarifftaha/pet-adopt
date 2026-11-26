"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@pet-adopt/ui/components/avatar";
import { initialsOf } from "@/lib/admin/initials";
import { cn } from "@/lib/utils";

/**
 * A person's avatar: their profile picture (src/server/avatars.ts), or their initials while it loads
 * or when they have none. Hidden from screen readers: the name next to it says the same.
 */
export function UserAvatar({ name, email, image, className }: { name: string; email: string; image?: string | null; className?: string }) {
  return (
    <Avatar aria-hidden="true" className={cn(className)}>
      {image ? <AvatarImage src={image} alt="" /> : null}
      <AvatarFallback>{initialsOf(name, email)}</AvatarFallback>
    </Avatar>
  );
}
