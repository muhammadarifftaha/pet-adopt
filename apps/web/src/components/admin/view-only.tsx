"use client";

import React from "react";

import type { Role } from "@pet-adopt/plugin-sdk";
import { ROLE_INFO } from "@pet-adopt/plugin-sdk";

// View-only screens, for roles that can see an area but not change it (audit, or a developer on a
// screen they only read). The server refuses every change anyway; this keeps the screen honest:
//  - <ViewOnly value> marks a subtree; useViewOnly() reads it (the rich-text editor turns off
//    editing, which a disabled fieldset cannot do for a contenteditable).
//  - <ViewOnlyFieldset> disables every native control inside at once, without adding a box
//    (display: contents). Keep navigation that must still work (tabs) outside it.
//  - <ViewOnlyNotice> says so at the top of the screen.

const ViewOnlyContext = React.createContext(false);

export function ViewOnly({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <ViewOnlyContext.Provider value={value}>{children}</ViewOnlyContext.Provider>;
}

export const useViewOnly = () => React.useContext(ViewOnlyContext);

export function ViewOnlyFieldset({ children, className }: { children: React.ReactNode; className?: string }) {
  const viewOnly = useViewOnly();
  return (
    // Fieldsets draw a border, padding and a minimum width by default: reset them.
    <fieldset disabled={viewOnly} className={`m-0 min-w-0 border-0 p-0 ${className ?? "contents"}`}>
      {children}
    </fieldset>
  );
}

/** "Your role (Audit) can view the settings but cannot change anything here." Only in view-only mode. */
export function ViewOnlyNotice({ role, what = "this" }: { role: Role; what?: string }) {
  const viewOnly = useViewOnly();
  if (!viewOnly) return null;
  return (
    <p className="mb-4 rounded-md border bg-muted px-3 py-2 text-sm">
      <span className="font-medium">View only.</span> Your role ({ROLE_INFO[role].label}) can view {what} but cannot change anything here.
    </p>
  );
}
