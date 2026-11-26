"use client";

import React from "react";
import { FiCopy, FiDownload } from "react-icons/fi";

import { Button } from "@pet-adopt/ui/components/button";

/** Ten one-time backup codes, shown once, with Copy and Download (a text file). */
export function BackupCodeList({ codes, siteName }: { codes: string[]; siteName: string }) {
  const [note, setNote] = React.useState("");
  const text = `${siteName}: two-factor backup codes\nEach code works once.\n\n${codes.join("\n")}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Codes copied.");
    } catch {
      setNote("Could not copy automatically. Select the codes and copy them, or use Download.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setNote("Codes downloaded as backup-codes.txt.");
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Backup codes" className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-md border bg-muted p-4 font-mono text-sm sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          <FiCopy aria-hidden />
          Copy codes
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <FiDownload aria-hidden />
          Download
        </Button>
      </div>
      <p aria-live="polite" className="text-sm">
        {note}
      </p>
    </div>
  );
}
